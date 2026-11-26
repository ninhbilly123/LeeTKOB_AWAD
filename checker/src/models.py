"""Typed schema models aligned with docs/contract/checker-output.md."""

from typing import Literal, NotRequired, TypedDict

Verdict = Literal["pass", "violation", "unsure"]
FindingSource = Literal["HARD_RULE", "LLM"]
UnsureReason = Literal[
    "MODEL_UNSURE",
    "SCHEMA_INVALID",
    "EVIDENCE_MISMATCH",
    "TIMEOUT",
    "COST_CAP_EXCEEDED",
    "MODEL_OFF",
    "PROVIDER_ERROR",
]
CallStatus = Literal["OK", "SCHEMA_INVALID", "EVIDENCE_MISMATCH", "TIMEOUT", "PROVIDER_ERROR"]


class ConstraintInput(TypedDict):
    """Input constraint definition."""

    id: str
    text: str
    deduction: NotRequired[int]


class EvidenceLine(TypedDict):
    """1-based source code line cited as evidence."""

    line: int
    text: str


class ConstraintFinding(TypedDict):
    """Output finding for a single (submission, constraint) pair."""

    constraint: str
    source: FindingSource
    verdict: Verdict
    evidence: list[EvidenceLine]
    unsureReason: UnsureReason | None
    reason: str | None


class ModelCallLog(TypedDict):
    """Audit log entry for one LLM provider call."""

    requestId: str
    model: str
    constraints: list[str]
    sanitizedPrompt: str
    inputTokens: int
    outputTokens: int
    latencyMs: int
    estimatedCostUsd: float
    status: CallStatus


class CheckerResult(TypedDict):
    """Service-to-service checker result for one submission."""

    submissionId: str
    results: list[ConstraintFinding]
    model: str | None
    promptVersion: str | None
    checkedAt: str
    callLogs: list[ModelCallLog]
