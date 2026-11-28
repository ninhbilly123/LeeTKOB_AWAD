"""Offline tests for the checker dataset CLI (K3)."""

from __future__ import annotations

import json
from pathlib import Path

from src.cli import main, run_dataset
from src.llm_client import LlmRawResponse


class _FakeCliTransport:
    def __init__(self) -> None:
        self.calls: int = 0

    def generate(self, prompt: str, model: str, timeout_seconds: float) -> LlmRawResponse:
        self.calls += 1
        return LlmRawResponse(
            text=json.dumps(
                {
                    "results": [
                        {
                            "constraint": "C2",
                            "verdict": "pass",
                            "evidence": [],
                            "reason": "Semantic requirement satisfied.",
                        }
                    ]
                }
            ),
            request_id=f"req_cli_{self.calls}",
            model=model,
            input_tokens=100,
            output_tokens=30,
            latency_ms=25,
        )


def _create_sample_dataset(root: Path) -> None:
    prob_dir = root / "problems" / "sample-prob"
    sol_dir = root / "solutions" / "sample-prob"
    prob_dir.mkdir(parents=True)
    sol_dir.mkdir(parents=True)

    (prob_dir / "statement.md").write_text("# Sample\nImplement custom logic.\n", encoding="utf-8")
    (prob_dir / "constraints.json").write_text(
        json.dumps(
            [
                {"id": "C1", "text": "Do not call `std::sort`.", "deduction": 3},
                {"id": "C2", "text": "Use recursion only.", "deduction": 4},
            ]
        ),
        encoding="utf-8",
    )
    (sol_dir / "s01.cpp").write_text(
        "#include <algorithm>\nint main() { int a[2]{2,1}; std::sort(a, a+2); }\n",
        encoding="utf-8",
    )
    (sol_dir / "s02.cpp").write_text(
        "int main() { return 0; }\n",
        encoding="utf-8",
    )


def test_cli_runs_offline_with_model_off_without_labels_file(tmp_path: Path) -> None:
    """CLI must work from statement.md + constraints.json alone with MODEL_OFF=1."""
    dataset = tmp_path / "dataset"
    _create_sample_dataset(dataset)
    out_file = tmp_path / "preds.jsonl"

    exit_code = main(
        ["--data", str(dataset), "--output", str(out_file)],
        env={"MODEL_OFF": "1"},
    )
    assert exit_code == 0

    rows = [
        json.loads(line)
        for line in out_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert len(rows) == 4
    by_key = {(r["solution"], r["constraint"]): r for r in rows}

    assert by_key[("sample-prob/s01", "C1")]["verdict"] == "violation"
    assert by_key[("sample-prob/s01", "C1")]["evidence"] == [
        {"line": 2, "text": "int main() { int a[2]{2,1}; std::sort(a, a+2); }"}
    ]
    assert by_key[("sample-prob/s01", "C2")]["verdict"] == "unsure"
    assert by_key[("sample-prob/s02", "C1")]["verdict"] == "pass"
    assert by_key[("sample-prob/s02", "C2")]["verdict"] == "unsure"


def test_run_dataset_with_fake_transport_writes_call_log(tmp_path: Path) -> None:
    """With model enabled, semantic pairs invoke transport and emit call-log entries."""
    dataset = tmp_path / "dataset"
    _create_sample_dataset(dataset)
    out_file = tmp_path / "preds.jsonl"
    log_file = tmp_path / "calls.jsonl"
    transport = _FakeCliTransport()

    summary = run_dataset(
        dataset,
        output_path=out_file,
        call_log_path=log_file,
        transport=transport,
        model="gemini-3.1-flash-lite-preview",
        model_off=False,
    )
    assert summary["predictions"] == 4
    assert summary["model_calls"] == 2
    assert transport.calls == 2

    logs = [
        json.loads(line)
        for line in log_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert len(logs) == 2
    assert logs[0]["requestId"] == "req_cli_1"
    assert logs[0]["constraints"] == ["C2"]
    assert logs[0]["solution"] == "sample-prob/s01"


def test_cli_returns_nonzero_when_dataset_missing(tmp_path: Path) -> None:
    """Missing dataset directories must return exit code 2."""
    exit_code = main(["--data", str(tmp_path / "missing")], env={"MODEL_OFF": "1"})
    assert exit_code == 2
