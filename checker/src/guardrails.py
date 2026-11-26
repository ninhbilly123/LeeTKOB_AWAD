"""Strict schema validation, evidence verification, and fallback guardrails."""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from typing import Any

from src.models import (
    CallStatus,
    ConstraintFinding,
    ConstraintInput,
    EvidenceLine,
    UnsureReason,
)

_ALLOWED_ITEM_KEYS = frozenset({"constraint", "verdict", "evidence", "reason"})
_ALLOWED_EVIDENCE_KEYS = frozenset({"line", "text"})
_ALLOWED_VERDICTS = frozenset({"pass", "violation", "unsure"})
_CODE_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*\n(.*?)\n```\s*$", re.DOTALL | re.IGNORECASE)


def _unsure_finding(
    constraint_id: str,
    unsure_reason: UnsureReason,
    reason: str,
) -> ConstraintFinding:
    return {
        "constraint": constraint_id,
        "source": "LLM",
        "verdict": "unsure",
        "evidence": [],
        "unsureReason": unsure_reason,
        "reason": reason,
    }


def make_unsure_findings(
    semantic_constraints: Sequence[ConstraintInput],
    unsure_reason: UnsureReason,
    reason: str,
) -> list[ConstraintFinding]:
    """Build uniform 'unsure' findings for all semantic constraints in a fallback path."""
    return [_unsure_finding(c["id"], unsure_reason, reason) for c in semantic_constraints]


def _extract_json_text(raw_text: str) -> str:
    stripped = raw_text.strip()
    match = _CODE_FENCE_RE.match(stripped)
    return match.group(1).strip() if match else stripped


def _validate_evidence_list(
    raw_evidence: Any,
    original_lines: Sequence[str],
    sanitized_lines: Sequence[str],
) -> tuple[list[EvidenceLine] | None, UnsureReason | None, str | None]:
    if not isinstance(raw_evidence, list):
        return None, "SCHEMA_INVALID", "Model 'evidence' field must be an array."

    mapped: list[EvidenceLine] = []
    for entry in raw_evidence:
        if not isinstance(entry, dict):
            return None, "SCHEMA_INVALID", "Evidence entry must be an object."
        if set(entry.keys()) != _ALLOWED_EVIDENCE_KEYS:
            return None, "SCHEMA_INVALID", "Evidence entry has invalid keys."
        line_no = entry["line"]
        text = entry["text"]
        if isinstance(line_no, bool) or not isinstance(line_no, int):
            return None, "SCHEMA_INVALID", "Evidence 'line' must be an integer."
        if not isinstance(text, str):
            return None, "SCHEMA_INVALID", "Evidence 'text' must be a string."
        if line_no < 1 or line_no > len(original_lines):
            return (
                None,
                "EVIDENCE_MISMATCH",
                f"Evidence line {line_no} is out of bounds (1..{len(original_lines)}).",
            )

        candidate = text.strip()
        orig_line = original_lines[line_no - 1].strip()
        san_line = (
            sanitized_lines[line_no - 1].strip() if line_no <= len(sanitized_lines) else orig_line
        )
        if not candidate or candidate not in {orig_line, san_line}:
            return (
                None,
                "EVIDENCE_MISMATCH",
                f"Evidence text on line {line_no} does not match submitted code.",
            )
        mapped.append({"line": line_no, "text": orig_line})

    return mapped, None, None


def _validate_item(
    item: Any,
    expected_ids: set[str],
    original_lines: Sequence[str],
    sanitized_lines: Sequence[str],
) -> tuple[str | None, ConstraintFinding | None, CallStatus]:
    if not isinstance(item, dict):
        return None, None, "SCHEMA_INVALID"

    keys = set(item.keys())
    if not keys.issubset(_ALLOWED_ITEM_KEYS) or not {"constraint", "verdict", "evidence"}.issubset(
        keys
    ):
        cid = item.get("constraint")
        if isinstance(cid, str) and cid in expected_ids:
            return (
                cid,
                _unsure_finding(
                    cid,
                    "SCHEMA_INVALID",
                    "Model output contained unexpected or missing schema fields.",
                ),
                "SCHEMA_INVALID",
            )
        return None, None, "SCHEMA_INVALID"

    cid = item["constraint"]
    verdict = item["verdict"]
    raw_reason = item.get("reason")
    if not isinstance(cid, str) or cid not in expected_ids:
        return None, None, "SCHEMA_INVALID"
    if not isinstance(verdict, str) or verdict not in _ALLOWED_VERDICTS:
        return (
            cid,
            _unsure_finding(cid, "SCHEMA_INVALID", f"Invalid verdict value: {verdict!r}."),
            "SCHEMA_INVALID",
        )
    if raw_reason is not None and not isinstance(raw_reason, str):
        return (
            cid,
            _unsure_finding(cid, "SCHEMA_INVALID", "Model 'reason' must be a string or null."),
            "SCHEMA_INVALID",
        )

    mapped_ev, ev_err_reason, ev_err_msg = _validate_evidence_list(
        item["evidence"], original_lines, sanitized_lines
    )
    if ev_err_reason is not None or mapped_ev is None:
        assert ev_err_reason is not None
        return (
            cid,
            _unsure_finding(cid, ev_err_reason, ev_err_msg or "Evidence verification failed."),
            "EVIDENCE_MISMATCH" if ev_err_reason == "EVIDENCE_MISMATCH" else "SCHEMA_INVALID",
        )

    if verdict == "violation" and not mapped_ev:
        return (
            cid,
            _unsure_finding(
                cid,
                "SCHEMA_INVALID",
                "Model returned 'violation' without at least one evidence line.",
            ),
            "SCHEMA_INVALID",
        )

    if verdict == "unsure":
        return (
            cid,
            {
                "constraint": cid,
                "source": "LLM",
                "verdict": "unsure",
                "evidence": mapped_ev,
                "unsureReason": "MODEL_UNSURE",
                "reason": raw_reason or "Model returned 'unsure'.",
            },
            "OK",
        )

    typed_verdict: ConstraintFinding = {
        "constraint": cid,
        "source": "LLM",
        "verdict": "pass" if verdict == "pass" else "violation",
        "evidence": mapped_ev,
        "unsureReason": None,
        "reason": raw_reason,
    }
    return cid, typed_verdict, "OK"


def validate_and_map_llm_output(
    raw_text: str,
    semantic_constraints: Sequence[ConstraintInput],
    original_lines: Sequence[str],
    sanitized_lines: Sequence[str],
) -> tuple[list[ConstraintFinding], CallStatus]:
    """Validate LLM JSON against strict schema & evidence lines; degrade failures to unsure."""
    if not semantic_constraints:
        return [], "OK"

    try:
        parsed = json.loads(_extract_json_text(raw_text))
    except json.JSONDecodeError:
        return (
            make_unsure_findings(
                semantic_constraints,
                "SCHEMA_INVALID",
                "Model output was not valid JSON; routed to TA manual review.",
            ),
            "SCHEMA_INVALID",
        )

    if not isinstance(parsed, dict) or set(parsed.keys()) != {"results"}:
        return (
            make_unsure_findings(
                semantic_constraints,
                "SCHEMA_INVALID",
                "Model JSON must contain only a top-level 'results' list.",
            ),
            "SCHEMA_INVALID",
        )

    raw_results = parsed["results"]
    if not isinstance(raw_results, list):
        return (
            make_unsure_findings(
                semantic_constraints,
                "SCHEMA_INVALID",
                "Model 'results' field must be an array.",
            ),
            "SCHEMA_INVALID",
        )

    expected_ids = {c["id"] for c in semantic_constraints}
    findings_by_id: dict[str, ConstraintFinding] = {}
    has_schema_err = False
    has_evidence_err = False

    for item in raw_results:
        cid, finding, item_status = _validate_item(
            item, expected_ids, original_lines, sanitized_lines
        )
        if item_status == "SCHEMA_INVALID":
            has_schema_err = True
        elif item_status == "EVIDENCE_MISMATCH":
            has_evidence_err = True

        if cid is None or finding is None:
            continue
        if cid in findings_by_id:
            has_schema_err = True
            findings_by_id[cid] = _unsure_finding(
                cid,
                "SCHEMA_INVALID",
                "Duplicate constraint entry in model output.",
            )
        else:
            findings_by_id[cid] = finding

    final_findings: list[ConstraintFinding] = []
    for c in semantic_constraints:
        cid = c["id"]
        if cid not in findings_by_id:
            has_schema_err = True
            final_findings.append(
                _unsure_finding(
                    cid,
                    "SCHEMA_INVALID",
                    f"Constraint '{cid}' was missing from model output.",
                )
            )
        else:
            final_findings.append(findings_by_id[cid])

    if has_schema_err:
        return final_findings, "SCHEMA_INVALID"
    if has_evidence_err:
        return final_findings, "EVIDENCE_MISMATCH"
    return final_findings, "OK"
