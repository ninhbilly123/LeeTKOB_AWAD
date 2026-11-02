"""Tests for the hard-rule checker."""

from src.hard_rules import check_hard_rules


def test_returns_unsure_for_unimplemented_rules() -> None:
    """Placeholder rules should return 'unsure' for every constraint."""
    constraints = [
        {"id": "C1", "text": "Do not call `std::sort`"},
        {"id": "C2", "text": "Sort with a merge sort you wrote yourself"},
    ]
    findings = check_hard_rules("int main() { return 0; }", constraints)
    assert len(findings) == 2
    assert all(f["verdict"] == "unsure" for f in findings)


def test_empty_constraints_returns_empty() -> None:
    """No constraints means no findings."""
    findings = check_hard_rules("int main() {}", [])
    assert findings == []
