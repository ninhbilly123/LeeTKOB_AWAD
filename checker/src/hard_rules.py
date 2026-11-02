"""Placeholder: hard-rule checker using tree-sitter-cpp AST."""


def check_hard_rules(source_code: str, constraints: list[dict[str, str]]) -> list[dict[str, str]]:
    """Check source code against 'Do not use/call' constraints.

    Args:
        source_code: The C++ source code to check.
        constraints: List of constraint dicts with 'id' and 'text' keys.

    Returns:
        List of findings, each with 'constraint', 'verdict', and 'evidence'.
    """
    findings: list[dict[str, str]] = []
    for constraint in constraints:
        findings.append(
            {
                "constraint": constraint["id"],
                "verdict": "unsure",
                "evidence": "[]",
                "reason": "Hard-rule checker not yet implemented.",
            }
        )
    return findings
