"""Offline tests for LLM schema validation, evidence verification, and timeout guardrails."""

from __future__ import annotations

import json

from src.guardrails import validate_and_map_llm_output
from src.llm_client import LlmRawResponse
from src.models import ConstraintInput
from src.semantic_checker import check_submission

_SAMPLE_CODE = "int main() {\n    int x = 1; // comment\n    return 0;\n}\n"
_CONSTRAINTS: list[ConstraintInput] = [
    {"id": "C2", "text": "Use divide and conquer.", "deduction": 4}
]


class _StaticRawTransport:
    def __init__(self, raw_text: str) -> None:
        self._raw_text = raw_text

    def generate(self, prompt: str, model: str, timeout_seconds: float) -> LlmRawResponse:
        return LlmRawResponse(
            text=self._raw_text,
            request_id="req_guardrail_test",
            model=model,
            input_tokens=80,
            output_tokens=20,
            latency_ms=42,
        )


class _TimeoutTransport:
    def generate(self, prompt: str, model: str, timeout_seconds: float) -> LlmRawResponse:
        raise TimeoutError("Simulated provider timeout")


class _ErrorTransport:
    def generate(self, prompt: str, model: str, timeout_seconds: float) -> LlmRawResponse:
        raise RuntimeError("Simulated HTTP 503")


def test_invalid_json_becomes_unsure_schema_invalid() -> None:
    """Malformed JSON from the model must degrade to unsure with SCHEMA_INVALID."""
    res = check_submission(
        "sub_bad_json",
        "Problem statement",
        _SAMPLE_CODE,
        _CONSTRAINTS,
        transport=_StaticRawTransport("{not valid json"),
        model_off=False,
    )
    assert res["results"][0]["verdict"] == "unsure"
    assert res["results"][0]["unsureReason"] == "SCHEMA_INVALID"
    assert res["results"][0]["evidence"] == []
    assert res["callLogs"][0]["status"] == "SCHEMA_INVALID"


def test_forbidden_deduction_field_becomes_unsure_schema_invalid() -> None:
    """Any LLM output attempting to set deduction/score/marks must be rejected."""
    payload = {
        "results": [
            {
                "constraint": "C2",
                "verdict": "violation",
                "deduction": 4,
                "evidence": [{"line": 2, "text": "int x = 1;"}],
                "reason": "Violated.",
            }
        ]
    }
    res = check_submission(
        "sub_deduction",
        "Problem statement",
        _SAMPLE_CODE,
        _CONSTRAINTS,
        transport=_StaticRawTransport(json.dumps(payload)),
        model_off=False,
    )
    assert res["results"][0]["verdict"] == "unsure"
    assert res["results"][0]["unsureReason"] == "SCHEMA_INVALID"
    assert res["callLogs"][0]["status"] == "SCHEMA_INVALID"


def test_violation_with_empty_evidence_or_bad_verdict_becomes_schema_invalid() -> None:
    """Violation without evidence lines or unknown verdict string fails schema validation."""
    empty_ev = {
        "results": [
            {"constraint": "C2", "verdict": "violation", "evidence": [], "reason": "No lines"}
        ]
    }
    bad_verdict = {
        "results": [{"constraint": "C2", "verdict": "maybe", "evidence": [], "reason": "Unclear"}]
    }
    for payload in (empty_ev, bad_verdict):
        res = check_submission(
            "sub_schema",
            "Problem statement",
            _SAMPLE_CODE,
            _CONSTRAINTS,
            transport=_StaticRawTransport(json.dumps(payload)),
            model_off=False,
        )
        assert res["results"][0]["verdict"] == "unsure"
        assert res["results"][0]["unsureReason"] == "SCHEMA_INVALID"


def test_evidence_mismatch_out_of_bounds_or_wrong_text_becomes_unsure() -> None:
    """Hallucinated evidence lines or mismatched text must coerce verdict to EVIDENCE_MISMATCH."""
    wrong_text = {
        "results": [
            {
                "constraint": "C2",
                "verdict": "violation",
                "evidence": [{"line": 2, "text": "std::sort(a, a + n);"}],
                "reason": "Hallucinated line",
            }
        ]
    }
    out_of_bounds = {
        "results": [
            {
                "constraint": "C2",
                "verdict": "violation",
                "evidence": [{"line": 99, "text": "return 0;"}],
                "reason": "Out of bounds",
            }
        ]
    }
    for payload in (wrong_text, out_of_bounds):
        res = check_submission(
            "sub_ev_mismatch",
            "Problem statement",
            _SAMPLE_CODE,
            _CONSTRAINTS,
            transport=_StaticRawTransport(json.dumps(payload)),
            model_off=False,
        )
        assert res["results"][0]["verdict"] == "unsure"
        assert res["results"][0]["unsureReason"] == "EVIDENCE_MISMATCH"
        assert res["callLogs"][0]["status"] == "EVIDENCE_MISMATCH"


def test_missing_or_duplicate_constraint_becomes_schema_invalid() -> None:
    """Missing constraints or duplicate entries are flagged as SCHEMA_INVALID."""
    multi: list[ConstraintInput] = [
        {"id": "C2", "text": "Constraint 2"},
        {"id": "C3", "text": "Constraint 3"},
    ]
    missing_c3 = json.dumps(
        {"results": [{"constraint": "C2", "verdict": "pass", "evidence": [], "reason": "ok"}]}
    )
    findings, status = validate_and_map_llm_output(
        missing_c3,
        multi,
        original_lines=["int main() {}"],
        sanitized_lines=["int main() {}"],
    )
    assert status == "SCHEMA_INVALID"
    assert findings[0]["verdict"] == "pass"
    assert findings[1]["verdict"] == "unsure"
    assert findings[1]["unsureReason"] == "SCHEMA_INVALID"


def test_timeout_becomes_unsure_timeout_with_reason_and_audit_log() -> None:
    """Exceeding timeout must degrade to unsure with TIMEOUT reason for TA queue."""
    res = check_submission(
        "sub_timeout",
        "Problem statement",
        _SAMPLE_CODE,
        _CONSTRAINTS,
        transport=_TimeoutTransport(),
        timeout_seconds=0.5,
        model_off=False,
    )
    assert res["results"][0]["verdict"] == "unsure"
    assert res["results"][0]["unsureReason"] == "TIMEOUT"
    assert res["results"][0]["evidence"] == []
    assert res["results"][0]["reason"] is not None
    assert res["callLogs"][0]["status"] == "TIMEOUT"


def test_provider_error_and_cost_cap_become_unsure_with_reasons() -> None:
    """Provider HTTP failures and cost-cap breaches degrade safely to unsure."""
    err_res = check_submission(
        "sub_err",
        "Problem statement",
        _SAMPLE_CODE,
        _CONSTRAINTS,
        transport=_ErrorTransport(),
        model_off=False,
    )
    assert err_res["results"][0]["verdict"] == "unsure"
    assert err_res["results"][0]["unsureReason"] == "PROVIDER_ERROR"
    assert err_res["callLogs"][0]["status"] == "PROVIDER_ERROR"

    cap_res = check_submission(
        "sub_cap",
        "Problem statement",
        _SAMPLE_CODE,
        _CONSTRAINTS,
        transport=_ErrorTransport(),
        cost_cap_exceeded=True,
        model_off=False,
    )
    assert cap_res["results"][0]["verdict"] == "unsure"
    assert cap_res["results"][0]["unsureReason"] == "COST_CAP_EXCEEDED"
    assert cap_res["callLogs"] == []
