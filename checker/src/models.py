"""Typed schema models aligned with docs/contract/checker-output.md."""

from typing import Literal, TypedDict

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


class ConstraintInput(TypedDict):
    """Input constraint definition."""

    id: str
    text: str


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
