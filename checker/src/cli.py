"""Command-line interface for running LeeTKOB checker on a dataset directory."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import TextIO

from src.llm_client import DEFAULT_GEMINI_MODEL, DEFAULT_TIMEOUT_SECONDS, LlmTransport
from src.models import ConstraintInput
from src.semantic_checker import check_submission


def _parse_bool_env(env: Mapping[str, str], key: str) -> bool:
    return env.get(key, "").strip().lower() in {"1", "true", "yes"}


def _load_problem_assets(dataset_root: Path, problem_id: str) -> tuple[str, list[ConstraintInput]]:
    problem_dir = dataset_root / "problems" / problem_id
    statement_path = problem_dir / "statement.md"
    constraints_path = problem_dir / "constraints.json"
    if not statement_path.is_file():
        raise FileNotFoundError(f"Missing statement file: {statement_path}")
    if not constraints_path.is_file():
        raise FileNotFoundError(f"Missing constraints file: {constraints_path}")

    statement = statement_path.read_text(encoding="utf-8")
    raw_constraints = json.loads(constraints_path.read_text(encoding="utf-8"))
    if not isinstance(raw_constraints, list):
        raise ValueError(f"Invalid constraints.json format in {constraints_path}")

    constraints: list[ConstraintInput] = [
        {"id": str(item["id"]), "text": str(item["text"])} for item in raw_constraints
    ]
    return statement, constraints


def run_dataset(
    dataset_dir: Path,
    *,
    output_path: Path | None = None,
    call_log_path: Path | None = None,
    transport: LlmTransport | None = None,
    model: str | None = None,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    model_off: bool = False,
    delay_ms: int = 0,
    stdout_stream: TextIO | None = None,
) -> dict[str, int | float]:
    """Evaluate all C++ solutions in dataset_dir and emit JSONL predictions."""
    root = dataset_dir.resolve()
    problems_dir = root / "problems"
    solutions_dir = root / "solutions"
    if not problems_dir.is_dir() or not solutions_dir.is_dir():
        raise FileNotFoundError(
            f"Dataset directory '{root}' must contain 'problems/' and 'solutions/'."
        )

    cpp_files = sorted(solutions_dir.glob("*/*.cpp"))
    problem_cache: dict[str, tuple[str, list[ConstraintInput]]] = {}

    prediction_lines: list[str] = []
    call_log_lines: list[str] = []
    total_calls = 0
    total_in_tokens = 0
    total_out_tokens = 0
    total_cost_usd = 0.0

    for idx, cpp_path in enumerate(cpp_files):
        problem_id = cpp_path.parent.name
        solution_id = f"{problem_id}/{cpp_path.stem}"
        if problem_id not in problem_cache:
            problem_cache[problem_id] = _load_problem_assets(root, problem_id)
        statement, constraints = problem_cache[problem_id]
        source_code = cpp_path.read_text(encoding="utf-8")

        result = check_submission(
            submission_id=solution_id,
            statement=statement,
            source_code=source_code,
            constraints=constraints,
            transport=transport,
            model=model,
            timeout_seconds=timeout_seconds,
            model_off=model_off,
        )

        for finding in result["results"]:
            row = {
                "solution": solution_id,
                "constraint": finding["constraint"],
                "verdict": finding["verdict"],
                "evidence": finding["evidence"],
            }
            prediction_lines.append(json.dumps(row, ensure_ascii=False))

        for log_entry in result["callLogs"]:
            total_calls += 1
            total_in_tokens += log_entry["inputTokens"]
            total_out_tokens += log_entry["outputTokens"]
            total_cost_usd += log_entry["estimatedCostUsd"]
            call_log_lines.append(
                json.dumps({"solution": solution_id, **log_entry}, ensure_ascii=False)
            )

        if delay_ms > 0 and result["callLogs"] and idx + 1 < len(cpp_files):
            time.sleep(delay_ms / 1000.0)

    rendered = "\n".join(prediction_lines) + ("\n" if prediction_lines else "")
    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(rendered, encoding="utf-8")
    else:
        target = stdout_stream if stdout_stream is not None else sys.stdout
        target.write(rendered)

    if call_log_path is not None:
        call_log_path.parent.mkdir(parents=True, exist_ok=True)
        rendered_logs = "\n".join(call_log_lines) + ("\n" if call_log_lines else "")
        call_log_path.write_text(rendered_logs, encoding="utf-8")

    return {
        "predictions": len(prediction_lines),
        "model_calls": total_calls,
        "input_tokens": total_in_tokens,
        "output_tokens": total_out_tokens,
        "estimated_cost_usd": round(total_cost_usd, 8),
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m src",
        description="Run LeeTKOB constraint checker on a dataset folder and write JSONL.",
    )
    parser.add_argument(
        "dataset",
        nargs="?",
        help="Path to dataset directory containing problems/ and solutions/.",
    )
    parser.add_argument(
        "--data",
        dest="data_flag",
        help="Path to dataset directory (alternative to positional argument).",
    )
    parser.add_argument(
        "-o",
        "--output",
        help="Output JSONL file path (writes to stdout if omitted).",
    )
    parser.add_argument(
        "--call-log",
        help="Optional JSONL path to record per-call prompts, request IDs, tokens, and cost.",
    )
    parser.add_argument(
        "--model",
        default=None,
        help=f"Gemini model ID (defaults to GEMINI_MODEL env or {DEFAULT_GEMINI_MODEL}).",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT_SECONDS,
        help=f"Per-call timeout in seconds (default: {DEFAULT_TIMEOUT_SECONDS}).",
    )
    parser.add_argument(
        "--delay-ms",
        type=int,
        default=0,
        help="Optional delay in milliseconds between real LLM API calls.",
    )
    return parser


def main(
    argv: Sequence[str] | None = None,
    env: Mapping[str, str] | None = None,
) -> int:
    """CLI entrypoint returning process exit code (0=success, 2=invalid input)."""
    active_env = os.environ if env is None else env
    parser = _build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)

    dataset_arg = args.data_flag or args.dataset
    if not dataset_arg:
        parser.print_usage(sys.stderr)
        print("error: dataset directory is required (--data <dir> or positional)", file=sys.stderr)
        return 2

    model_off = _parse_bool_env(active_env, "MODEL_OFF")
    resolved_model = args.model or active_env.get("GEMINI_MODEL") or DEFAULT_GEMINI_MODEL

    try:
        run_dataset(
            Path(dataset_arg),
            output_path=Path(args.output) if args.output else None,
            call_log_path=Path(args.call_log) if args.call_log else None,
            model=resolved_model,
            timeout_seconds=args.timeout,
            model_off=model_off,
            delay_ms=args.delay_ms,
        )
    except (FileNotFoundError, ValueError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    return 0
