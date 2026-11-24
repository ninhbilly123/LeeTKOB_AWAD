"""Tests for the C++ AST hard-rule checker (K1)."""

from src.hard_rules import check_hard_rules, is_ban_list_constraint, parse_ban_list
from src.models import ConstraintInput


def test_parse_ban_list_recognizes_do_not_use_and_call() -> None:
    """Only constraints starting with 'Do not use' or 'Do not call' are ban lists."""
    assert is_ban_list_constraint("Do not call `std::sort` or `std::stable_sort`")
    assert is_ban_list_constraint("  do not use `<algorithm>` or `qsort`")
    assert not is_ban_list_constraint("Sort with a merge sort you wrote yourself")

    assert parse_ban_list("Do not call `std::sort`, `std::stable_sort`, or `qsort`.") == [
        "std::sort",
        "std::stable_sort",
        "qsort",
    ]
    assert parse_ban_list("Sort with a merge sort you wrote yourself") is None


def test_semantic_constraint_is_deferred_with_unsure() -> None:
    """Hard rules must not decide semantic constraints; they return unsure/MODEL_OFF."""
    constraints: list[ConstraintInput] = [
        {"id": "C1", "text": "Do not call `std::sort`"},
        {"id": "C2", "text": "Sort with a merge sort you wrote yourself"},
    ]
    findings = check_hard_rules("int main() { return 0; }", constraints)
    assert len(findings) == 2

    assert findings[0]["constraint"] == "C1"
    assert findings[0]["source"] == "HARD_RULE"
    assert findings[0]["verdict"] == "pass"
    assert findings[0]["evidence"] == []
    assert findings[0]["unsureReason"] is None

    assert findings[1]["constraint"] == "C2"
    assert findings[1]["source"] == "LLM"
    assert findings[1]["verdict"] == "unsure"
    assert findings[1]["unsureReason"] == "MODEL_OFF"


def test_empty_constraints_returns_empty() -> None:
    """No constraints means no findings."""
    assert check_hard_rules("int main() {}", []) == []


def test_ignores_banned_names_in_comments_and_strings() -> None:
    """Trap: banned names inside comments or string literals must never trigger violation."""
    code = """
#include <iostream>
int main() {
    // Do not call std::sort(a, a + n);
    /* std::stable_sort(a, a + n); qsort(a, n, sizeof(int), cmp); */
    const char* hint = "std::sort(a, a + n)";
    const char* raw = R"(std::sort and std::qsort)";
    std::cout << hint << raw << "\\n";
    return 0;
}
""".lstrip()
    constraints: list[ConstraintInput] = [
        {"id": "C1", "text": "Do not call `std::sort`, `std::stable_sort`, `qsort`"}
    ]
    findings = check_hard_rules(code, constraints)
    assert findings[0]["verdict"] == "pass"
    assert findings[0]["evidence"] == []


def test_allows_student_own_sort_in_namespace_and_global_scope() -> None:
    """Trap: student-defined sort in a namespace or global/method scope must pass."""
    code = """
#include <iostream>
using namespace std;

namespace student_impl {
void sort(int* a, int n) {
    if (n <= 1) return;
}
}

void custom_helper() {}

struct Sorter {
    void sort(int* a, int n) {
        if (n <= 1) return;
    }
};

int main() {
    int a[3] = {3, 1, 2};
    student_impl::sort(a, 3);
    Sorter s;
    s.sort(a, 3);
    return 0;
}
""".lstrip()
    constraints: list[ConstraintInput] = [{"id": "C1", "text": "Do not call `std::sort`"}]
    findings = check_hard_rules(code, constraints)
    assert findings[0]["verdict"] == "pass"
    assert findings[0]["evidence"] == []


def test_allows_global_user_defined_sort_even_with_using_namespace_std() -> None:
    """Trap: calling student's own global sort function must not trigger std::sort."""
    code = """
#include <iostream>
using namespace std;

void sort(int* a, int n) {
    for (int i = 0; i < n; ++i) {}
}

int main() {
    int a[2] = {2, 1};
    sort(a, 2);
    return 0;
}
""".lstrip()
    constraints: list[ConstraintInput] = [{"id": "C1", "text": "Do not call `std::sort`"}]
    findings = check_hard_rules(code, constraints)
    assert findings[0]["verdict"] == "pass"


def test_allows_algorithm_header_included_only_for_std_swap() -> None:
    """Trap: #include <algorithm> used solely for std::swap must pass."""
    code = """
#include <algorithm>
#include <iostream>

int main() {
    int a = 1, b = 2;
    std::swap(a, b);
    return 0;
}
""".lstrip()
    constraints: list[ConstraintInput] = [
        {"id": "C1", "text": "Do not use `<algorithm>` or `std::sort`"}
    ]
    findings = check_hard_rules(code, constraints)
    assert findings[0]["verdict"] == "pass"
    assert findings[0]["evidence"] == []


def test_catches_algorithm_header_when_non_swap_algorithm_is_used() -> None:
    """Including <algorithm> and calling std::reverse violates a ban on `<algorithm>`."""
    code = """
#include <algorithm>

int main() {
    int a[3] = {1, 2, 3};
    std::reverse(a, a + 3);
    return 0;
}
""".lstrip()
    constraints: list[ConstraintInput] = [{"id": "C1", "text": "Do not use `<algorithm>`"}]
    findings = check_hard_rules(code, constraints)
    assert findings[0]["verdict"] == "violation"
    assert findings[0]["source"] == "HARD_RULE"
    assert findings[0]["unsureReason"] is None
    assert len(findings[0]["evidence"]) >= 1


def test_catches_direct_and_qualified_calls_with_exact_line_evidence() -> None:
    """Direct std::sort / ::std::sort / std::stable_sort calls must be caught."""
    code = """
#include <algorithm>
int main() {
    int a[2] = {2, 1};
    std::sort(a, a + 2);
    return 0;
}
""".lstrip()
    constraints: list[ConstraintInput] = [{"id": "C1", "text": "Do not call `std::sort`"}]
    findings = check_hard_rules(code, constraints)
    assert findings[0]["verdict"] == "violation"
    assert findings[0]["evidence"] == [{"line": 4, "text": "std::sort(a, a + 2);"}]


def test_catches_using_namespace_std_and_using_declaration_and_alias_and_macro() -> None:
    """Disguised violations (using, alias, macro, fn pointer) must be caught."""
    using_ns_code = """
#include <algorithm>
using namespace std;
int main() {
    int a[2] = {2, 1};
    sort(a, a + 2);
}
""".lstrip()
    using_decl_code = """
#include <algorithm>
using std::sort;
int main() {
    int a[2] = {2, 1};
    sort(a, a + 2);
}
""".lstrip()
    ns_alias_code = """
#include <algorithm>
namespace my_std = std;
int main() {
    int a[2] = {2, 1};
    my_std::sort(a, a + 2);
}
""".lstrip()
    macro_code = """
#include <algorithm>
#define MY_SORT std::sort
int main() {
    int a[2] = {2, 1};
    MY_SORT(a, a + 2);
}
""".lstrip()
    fn_ptr_code = """
#include <algorithm>
int main() {
    int a[2] = {2, 1};
    auto fn = &std::sort<int*>;
    fn(a, a + 2);
}
""".lstrip()
    constraints: list[ConstraintInput] = [{"id": "C1", "text": "Do not call `std::sort`"}]

    for variant, expected_line in [
        (using_ns_code, 5),
        (using_decl_code, 5),
        (ns_alias_code, 5),
        (macro_code, 5),
        (fn_ptr_code, 4),
    ]:
        findings = check_hard_rules(variant, constraints)
        assert findings[0]["verdict"] == "violation"
        assert any(ev["line"] == expected_line for ev in findings[0]["evidence"])


def test_catches_banned_containers_c_functions_and_keywords() -> None:
    """Ban lists may forbid std::vector, qsort, malloc, new, goto, or <bits/stdc++.h>."""
    code = """
#include <bits/stdc++.h>
int main() {
    std::vector<int> v = {1, 2};
    int* p = (int*)malloc(sizeof(int));
    int* q = new int(1);
    goto done;
done:
    free(p);
    delete q;
    return 0;
}
""".lstrip()
    constraints: list[ConstraintInput] = [
        {"id": "C1", "text": "Do not use `<bits/stdc++.h>`"},
        {"id": "C2", "text": "Do not use `std::vector`"},
        {"id": "C3", "text": "Do not call `malloc`"},
        {"id": "C4", "text": "Do not use `new` or `goto`"},
    ]
    findings = check_hard_rules(code, constraints)
    assert [f["verdict"] for f in findings] == ["violation", "violation", "violation", "violation"]
    assert findings[0]["evidence"] == [{"line": 1, "text": "#include <bits/stdc++.h>"}]
    assert findings[1]["evidence"] == [{"line": 3, "text": "std::vector<int> v = {1, 2};"}]
    assert findings[2]["evidence"] == [{"line": 4, "text": "int* p = (int*)malloc(sizeof(int));"}]
    assert {ev["line"] for ev in findings[3]["evidence"]} == {5, 6}
