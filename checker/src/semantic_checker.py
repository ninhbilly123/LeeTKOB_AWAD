"""Orchestrates hard rules first, then LLM semantic constraint checking with guardrails."""

from __future__ import annotations

import os
import time
from collections.abc import Sequence
from datetime import UTC, datetime

from src.guardrails import make_unsure_findings, validate_and_map_llm_output
from src.hard_rules import check_hard_rule
from src.llm_client import (
    DEFAULT_GEMINI_MODEL,
    DEFAULT_TIMEOUT_SECONDS,
    GeminiHttpTransport,
    LlmTransport,
    estimate_cost_usd,
)
from src.models import (
    CallStatus,
    CheckerResult,
    ConstraintFinding,
    ConstraintInput,
    ModelCallLog,
)
from src.sanitizer import PROMPT_VERSION, build_semantic_prompt, sanitize_cpp_source


def is_model_off() -> bool:
    """Return True when MODEL_OFF=1 (or truthy) disables all LLM calls."""
    return os.environ.get("MODEL_OFF", "").strip().lower() in {"1", "true", "yes"}


def check_submission(
    submission_id: str,
    statement: str,
    source_code: str,
    constraints: Sequence[ConstraintInput],
    *,
    student_identifiers: Sequence[str] = (),
    transport: LlmTransport | None = None,
    model: str | None = None,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    model_off: bool | None = None,
    cost_cap_exceeded: bool = False,
) -> CheckerResult:
    """Run hard rules first, then evaluate semantic constraints via the LLM."""
    checked_at = datetime.now(UTC).isoformat()
    resolved_model = model or os.environ.get("GEMINI_MODEL") or DEFAULT_GEMINI_MODEL
    off = is_model_off() if model_off is None else model_off

    findings_by_id: dict[str, ConstraintFinding] = {}
    semantic_constraints: list[ConstraintInput] = []

    for constraint in constraints:
        hard_finding = check_hard_rule(source_code, constraint)
        if hard_finding is not None:
            findings_by_id[constraint["id"]] = hard_finding
        else:
            semantic_constraints.append(constraint)

    if not semantic_constraints:
        return {
            "submissionId": submission_id,
            "results": [findings_by_id[c["id"]] for c in constraints],
            "model": None,
            "promptVersion": None,
            "checkedAt": checked_at,
            "callLogs": [],
        }

    if off:
        for f in make_unsure_findings(
            semantic_constraints,
            "MODEL_OFF",
            "Semantic checking skipped because MODEL_OFF=1.",
        ):
            findings_by_id[f["constraint"]] = f
        return {
            "submissionId": submission_id,
            "results": [findings_by_id[c["id"]] for c in constraints],
            "model": None,
            "promptVersion": None,
            "checkedAt": checked_at,
            "callLogs": [],
        }

    if cost_cap_exceeded:
        for f in make_unsure_findings(
            semantic_constraints,
            "COST_CAP_EXCEEDED",
            "Lab cost cap exceeded; routed to TA manual review.",
        ):
            findings_by_id[f["constraint"]] = f
        return {
            "submissionId": submission_id,
            "results": [findings_by_id[c["id"]] for c in constraints],
            "model": None,
            "promptVersion": None,
            "checkedAt": checked_at,
            "callLogs": [],
        }

    sanitized = sanitize_cpp_source(source_code, student_identifiers=student_identifiers)
    prompt = build_semantic_prompt(statement, semantic_constraints, sanitized)
    active_transport = transport if transport is not None else GeminiHttpTransport()

    started = time.monotonic()
    call_status: CallStatus
    request_id = ""
    actual_model = resolved_model
    input_tokens = 0
    output_tokens = 0
    latency_ms = 0

    try:
        raw_resp = active_transport.generate(prompt, resolved_model, timeout_seconds)
        request_id = raw_resp.request_id
        actual_model = raw_resp.model
        input_tokens = raw_resp.input_tokens
        output_tokens = raw_resp.output_tokens
        latency_ms = raw_resp.latency_ms
        semantic_findings, call_status = validate_and_map_llm_output(
            raw_resp.text,
            semantic_constraints,
            sanitized.original_lines,
            sanitized.sanitized_lines,
        )
    except TimeoutError:
        latency_ms = int((time.monotonic() - started) * 1000)
        call_status = "TIMEOUT"
        semantic_findings = make_unsure_findings(
            semantic_constraints,
            "TIMEOUT",
            f"Model call exceeded {timeout_seconds}s timeout limit; routed to TA manual review.",
        )
    except Exception as exc:
        latency_ms = int((time.monotonic() - started) * 1000)
        call_status = "PROVIDER_ERROR"
        semantic_findings = make_unsure_findings(
            semantic_constraints,
            "PROVIDER_ERROR",
            f"Model call failed ({type(exc).__name__}); routed to TA manual review.",
        )

    for finding in semantic_findings:
        findings_by_id[finding["constraint"]] = finding

    call_log: ModelCallLog = {
        "requestId": request_id,
        "model": actual_model,
        "constraints": [c["id"] for c in semantic_constraints],
        "sanitizedPrompt": prompt,
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "latencyMs": latency_ms,
        "estimatedCostUsd": estimate_cost_usd(actual_model, input_tokens, output_tokens),
        "status": call_status,
    }

    return {
        "submissionId": submission_id,
        "results": [findings_by_id[c["id"]] for c in constraints],
        "model": actual_model,
        "promptVersion": PROMPT_VERSION,
        "checkedAt": checked_at,
        "callLogs": [call_log],
    }
