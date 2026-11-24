"""Orchestrates hard rules first, then LLM semantic constraint checking."""

from __future__ import annotations

import json
import os
from collections.abc import Sequence
from datetime import UTC, datetime

from src.hard_rules import check_hard_rule
from src.llm_client import (
    DEFAULT_GEMINI_MODEL,
    DEFAULT_TIMEOUT_SECONDS,
    GeminiHttpTransport,
    LlmTransport,
    estimate_cost_usd,
)
from src.models import (
    CheckerResult,
    ConstraintFinding,
    ConstraintInput,
    EvidenceLine,
    ModelCallLog,
)
from src.sanitizer import PROMPT_VERSION, build_semantic_prompt, sanitize_cpp_source


def is_model_off() -> bool:
    """Return True when MODEL_OFF=1 (or truthy) disables all LLM calls."""
    return os.environ.get("MODEL_OFF", "").strip().lower() in {"1", "true", "yes"}


def _parse_simple_response(
    raw_text: str,
    semantic_constraints: Sequence[ConstraintInput],
    original_lines: list[str],
) -> list[ConstraintFinding]:
    """Parse LLM JSON output and map evidence back to original source lines."""
    data = json.loads(raw_text)
    by_id: dict[str, ConstraintFinding] = {}
    for item in data.get("results", []):
        cid = str(item["constraint"])
        verdict = item["verdict"]
        raw_ev = item.get("evidence", [])
        mapped_ev: list[EvidenceLine] = []
        for entry in raw_ev:
            line_no = int(entry["line"])
            line_text = (
                original_lines[line_no - 1].strip()
                if 1 <= line_no <= len(original_lines)
                else str(entry["text"]).strip()
            )
            mapped_ev.append({"line": line_no, "text": line_text})
        by_id[cid] = {
            "constraint": cid,
            "source": "LLM",
            "verdict": verdict,
            "evidence": mapped_ev,
            "unsureReason": "MODEL_UNSURE" if verdict == "unsure" else None,
            "reason": item.get("reason"),
        }
    return [by_id[c["id"]] for c in semantic_constraints]


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
        for c in semantic_constraints:
            findings_by_id[c["id"]] = {
                "constraint": c["id"],
                "source": "LLM",
                "verdict": "unsure",
                "evidence": [],
                "unsureReason": "MODEL_OFF",
                "reason": "Semantic checking skipped because MODEL_OFF=1.",
            }
        return {
            "submissionId": submission_id,
            "results": [findings_by_id[c["id"]] for c in constraints],
            "model": None,
            "promptVersion": None,
            "checkedAt": checked_at,
            "callLogs": [],
        }

    if cost_cap_exceeded:
        for c in semantic_constraints:
            findings_by_id[c["id"]] = {
                "constraint": c["id"],
                "source": "LLM",
                "verdict": "unsure",
                "evidence": [],
                "unsureReason": "COST_CAP_EXCEEDED",
                "reason": "Lab cost cap exceeded; routed to TA manual review.",
            }
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

    raw_resp = active_transport.generate(prompt, resolved_model, timeout_seconds)
    semantic_findings = _parse_simple_response(
        raw_resp.text, semantic_constraints, sanitized.original_lines
    )
    for finding in semantic_findings:
        findings_by_id[finding["constraint"]] = finding

    call_log: ModelCallLog = {
        "requestId": raw_resp.request_id,
        "model": raw_resp.model,
        "constraints": [c["id"] for c in semantic_constraints],
        "sanitizedPrompt": prompt,
        "inputTokens": raw_resp.input_tokens,
        "outputTokens": raw_resp.output_tokens,
        "latencyMs": raw_resp.latency_ms,
        "estimatedCostUsd": estimate_cost_usd(
            raw_resp.model, raw_resp.input_tokens, raw_resp.output_tokens
        ),
        "status": "OK",
    }

    return {
        "submissionId": submission_id,
        "results": [findings_by_id[c["id"]] for c in constraints],
        "model": raw_resp.model,
        "promptVersion": PROMPT_VERSION,
        "checkedAt": checked_at,
        "callLogs": [call_log],
    }
