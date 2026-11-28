"""Offline integrity and CLI verification tests for the team eval dataset (Task D3)."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from src.cli import run_dataset
from src.hard_rules import is_ban_list_constraint

REPO_ROOT = Path(__file__).resolve().parents[2]
DEV_DATASET_DIR = REPO_ROOT / "leetkob-eval"
TEAM_DATASET_DIR = REPO_ROOT / "leetkob-eval-team"

EXPECTED_EVAL_MJS_PREFIX = "c836edd8713521bb"
EXPECTED_DEV_LABELS_PREFIX = "262cda7b0ef5612e"
ALLOWED_TAGS = {"obvious", "disguised", "trap", "injection", "style"}


def _sha256_hex(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_published_dev_set_hashes_remain_intact() -> None:
    """AC1: Lecturer's eval.mjs and labels.jsonl must stay byte-for-byte unmodified."""
    assert _sha256_hex(DEV_DATASET_DIR / "eval.mjs").startswith(EXPECTED_EVAL_MJS_PREFIX)
    assert _sha256_hex(DEV_DATASET_DIR / "labels.jsonl").startswith(EXPECTED_DEV_LABELS_PREFIX)


def test_team_dataset_layout_labels_and_tag_coverage() -> None:
    """AC2: Team dataset lives in a separate folder with >=5 solutions, >=1 trap, >=1 injection."""
    labels_path = TEAM_DATASET_DIR / "labels.jsonl"
    assert labels_path.is_file()

    rows = [
        json.loads(line)
        for line in labels_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert len(rows) >= 10

    solutions: set[str] = set()
    seen_pairs: set[tuple[str, str]] = set()
    all_tags: set[str] = set()
    constraints_by_problem: dict[str, set[str]] = {}

    for row in rows:
        sol = row["solution"]
        cid = row["constraint"]
        label = row["label"]
        evidence = row["evidence"]
        tags = row["tags"]

        assert isinstance(sol, str) and "/" in sol
        prob_id, sol_stem = sol.split("/", 1)
        solutions.add(sol)
        assert label in {"pass", "violation"}
        assert isinstance(tags, list) and set(tags).issubset(ALLOWED_TAGS)
        all_tags.update(tags)

        if prob_id not in constraints_by_problem:
            prob_dir = TEAM_DATASET_DIR / "problems" / prob_id
            assert (prob_dir / "statement.md").is_file()
            raw_constraints = json.loads(
                (prob_dir / "constraints.json").read_text(encoding="utf-8")
            )
            constraints_by_problem[prob_id] = {str(c["id"]) for c in raw_constraints}
            tests_dir = prob_dir / "tests"
            in_files = sorted(tests_dir.glob("*.in"))
            assert len(in_files) >= 3
            for in_file in in_files:
                assert in_file.with_suffix(".out").is_file()

        assert cid in constraints_by_problem[prob_id]
        cpp_path = TEAM_DATASET_DIR / "solutions" / prob_id / f"{sol_stem}.cpp"
        assert cpp_path.is_file()
        src_lines = cpp_path.read_text(encoding="utf-8").splitlines()

        assert isinstance(evidence, list)
        if label == "violation":
            assert len(evidence) >= 1
        else:
            assert evidence == []
        for line_no in evidence:
            assert isinstance(line_no, int) and 1 <= line_no <= len(src_lines)

        pair = (sol, cid)
        assert pair not in seen_pairs
        seen_pairs.add(pair)

    assert len(solutions) >= 5
    assert "trap" in all_tags
    assert "injection" in all_tags
    for sol in solutions:
        prob_id = sol.split("/", 1)[0]
        for cid in constraints_by_problem[prob_id]:
            assert (sol, cid) in seen_pairs


def test_team_dataset_cli_model_off_has_zero_wrongful_and_full_ban_list_recall(
    tmp_path: Path,
) -> None:
    """AC3: Offline MODEL_OFF=1 run decides every ban-list pair with 0 wrongful deductions."""
    out_file = tmp_path / "team-preds-model-off.jsonl"
    summary = run_dataset(TEAM_DATASET_DIR, output_path=out_file, model_off=True)
    assert summary["model_calls"] == 0

    preds = {
        (row["solution"], row["constraint"]): row
        for row in (
            json.loads(line)
            for line in out_file.read_text(encoding="utf-8").splitlines()
            if line.strip()
        )
    }
    labels = {
        (row["solution"], row["constraint"]): row
        for row in (
            json.loads(line)
            for line in (TEAM_DATASET_DIR / "labels.jsonl").read_text(encoding="utf-8").splitlines()
            if line.strip()
        )
    }
    assert set(preds.keys()) == set(labels.keys())

    constraint_texts: dict[tuple[str, str], str] = {}
    for cpath in (TEAM_DATASET_DIR / "problems").glob("*/constraints.json"):
        pid = cpath.parent.name
        for item in json.loads(cpath.read_text(encoding="utf-8")):
            constraint_texts[(pid, str(item["id"]))] = str(item["text"])

    for key, label_row in labels.items():
        sol, cid = key
        prob_id, sol_stem = sol.split("/", 1)
        pred_row = preds[key]
        is_hard_rule = is_ban_list_constraint(constraint_texts[(prob_id, cid)])

        if is_hard_rule:
            assert pred_row["verdict"] == label_row["label"]
            if label_row["label"] == "violation":
                src_lines = (
                    (TEAM_DATASET_DIR / "solutions" / prob_id / f"{sol_stem}.cpp")
                    .read_text(encoding="utf-8")
                    .splitlines()
                )
                assert any(
                    ev["line"] in label_row["evidence"]
                    and ev["text"].strip() == src_lines[ev["line"] - 1].strip()
                    for ev in pred_row["evidence"]
                )
        else:
            assert pred_row["verdict"] == "unsure"
