"""Syntax-aware C++ hard-rule checker using tree-sitter-cpp."""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, field

import tree_sitter_cpp as tscpp
from tree_sitter import Language, Node, Parser

from src.models import ConstraintFinding, ConstraintInput, EvidenceLine

_CPP_LANGUAGE = Language(tscpp.language())

_BAN_LIST_PREFIX_RE = re.compile(r"^\s*do\s+not\s+(?:use|call)\b", re.IGNORECASE)
_BACKTICK_ITEM_RE = re.compile(r"`([^`]+)`")
_IDENTIFIER_TOKEN_RE = re.compile(r"(?:::)?[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*")

_IGNORED_SUBTREE_TYPES = frozenset(
    {
        "comment",
        "string_literal",
        "raw_string_literal",
        "char_literal",
        "concatenated_string",
    }
)

_KEYWORD_NODE_MAP: dict[str, str] = {
    "goto_statement": "goto",
    "new_expression": "new",
    "delete_expression": "delete",
    "for_statement": "for",
    "for_range_loop": "for",
    "while_statement": "while",
    "do_statement": "do",
}

# Non-swap <algorithm> symbols used to distinguish "<algorithm> included only for swap".
_NON_SWAP_ALGORITHM_SYMBOLS = frozenset(
    {
        "sort",
        "stable_sort",
        "partial_sort",
        "partial_sort_copy",
        "nth_element",
        "is_sorted",
        "is_sorted_until",
        "reverse",
        "reverse_copy",
        "rotate",
        "rotate_copy",
        "shuffle",
        "random_shuffle",
        "min_element",
        "max_element",
        "minmax_element",
        "lower_bound",
        "upper_bound",
        "binary_search",
        "equal_range",
        "merge",
        "inplace_merge",
        "unique",
        "unique_copy",
        "find",
        "find_if",
        "find_if_not",
        "count",
        "count_if",
        "copy",
        "copy_if",
        "fill",
        "fill_n",
        "transform",
        "replace",
        "replace_if",
        "remove",
        "remove_if",
        "partition",
        "stable_partition",
        "next_permutation",
        "prev_permutation",
        "make_heap",
        "push_heap",
        "pop_heap",
        "sort_heap",
        "for_each",
        "all_of",
        "any_of",
        "none_of",
    }
)

_C_STDLIB_HEADER_ALIASES: dict[str, tuple[str, ...]] = {
    "cstdlib": ("cstdlib", "stdlib.h"),
    "cstring": ("cstring", "string.h"),
    "cstdio": ("cstdio", "stdio.h"),
    "cmath": ("cmath", "math.h"),
}


def is_ban_list_constraint(text: str) -> bool:
    """Return True if the constraint text declares a 'Do not use/call' ban list."""
    return bool(_BAN_LIST_PREFIX_RE.match(text)) and bool(_BACKTICK_ITEM_RE.search(text))


def parse_ban_list(text: str) -> list[str] | None:
    """Extract backtick-quoted banned names from a ban-list constraint, or None."""
    if not _BAN_LIST_PREFIX_RE.match(text):
        return None
    items = [item.strip() for item in _BACKTICK_ITEM_RE.findall(text) if item.strip()]
    return items or None


@dataclass(slots=True)
class _Occurrence:
    canonical_name: str
    line: int
    qualified: bool
    enclosing_namespace: str
    member_access: bool = False


@dataclass(slots=True)
class _CppProgramIndex:
    lines: list[str]
    includes: list[tuple[str, int]] = field(default_factory=list)
    using_namespaces: set[str] = field(default_factory=set)
    using_symbols: dict[str, str] = field(default_factory=dict)
    namespace_aliases: dict[str, str] = field(default_factory=dict)
    macro_bodies: dict[str, str] = field(default_factory=dict)
    user_defined_global: set[str] = field(default_factory=set)
    user_defined_by_ns: dict[str, set[str]] = field(default_factory=dict)
    user_defined_methods: set[str] = field(default_factory=set)
    occurrences: list[_Occurrence] = field(default_factory=list)
    keyword_lines: dict[str, list[int]] = field(default_factory=dict)
    uses_swap: bool = False
    uses_other_algorithm: bool = False

    def resolve_namespace(self, ns: str) -> str:
        seen: set[str] = set()
        current = ns
        while current in self.namespace_aliases and current not in seen:
            seen.add(current)
            current = self.namespace_aliases[current]
        return current

    def has_user_definition(self, short_name: str, enclosing_ns: str) -> bool:
        if enclosing_ns and short_name in self.user_defined_by_ns.get(enclosing_ns, set()):
            return True
        return short_name in self.user_defined_global


def _node_text(source_bytes: bytes, node: Node) -> str:
    return source_bytes[node.start_byte : node.end_byte].decode("utf-8", errors="replace")


def _extract_qualified_parts(source_bytes: bytes, node: Node) -> list[str]:
    """Flatten qualified_identifier / template_type into namespace/symbol segments."""
    parts: list[str] = []
    for child in node.children:
        if child.type in {"::", "template_argument_list"}:
            continue
        if child.type == "qualified_identifier":
            parts.extend(_extract_qualified_parts(source_bytes, child))
        elif child.type in {"template_type", "template_function"}:
            for sub in child.children:
                if sub.type in {"identifier", "type_identifier", "namespace_identifier"}:
                    parts.append(_node_text(source_bytes, sub))
                    break
        elif child.type in {
            "identifier",
            "type_identifier",
            "namespace_identifier",
            "operator_name",
        }:
            parts.append(_node_text(source_bytes, child))
    return parts


def _extract_declarator_name(source_bytes: bytes, node: Node) -> str | None:
    """Extract the declared function or identifier name from a declarator subtree."""
    if node.type in {"identifier", "field_identifier"}:
        return _node_text(source_bytes, node)
    for child in node.children:
        if child.type in {
            "function_declarator",
            "pointer_declarator",
            "reference_declarator",
            "parenthesized_declarator",
            "identifier",
            "field_identifier",
        }:
            name = _extract_declarator_name(source_bytes, child)
            if name:
                return name
    return None


def _is_declaration_name(node: Node) -> bool:
    """Return True if identifier/type_identifier is a declaration target, not a usage."""
    parent = node.parent
    if parent is None:
        return False
    if parent.type in {
        "function_declarator",
        "struct_specifier",
        "class_specifier",
        "union_specifier",
        "enum_specifier",
        "namespace_definition",
        "namespace_alias_definition",
        "alias_declaration",
        "type_parameter_declaration",
        "parameter_declaration",
        "preproc_def",
        "preproc_function_def",
        "labeled_statement",
        "goto_statement",
    }:
        # For function_declarator, the declarator name is the child before parameter_list.
        if parent.type == "function_declarator":
            return parent.child_by_field_name("declarator") == node
        if parent.type in {"struct_specifier", "class_specifier", "union_specifier"}:
            return parent.child_by_field_name("name") == node
        if parent.type == "parameter_declaration":
            return parent.child_by_field_name("declarator") == node
        return True
    if parent.type == "init_declarator":
        return parent.child_by_field_name("declarator") == node
    if parent.type == "declaration":
        return parent.child_by_field_name("declarator") == node
    return False


def _index_cpp(source_code: str) -> _CppProgramIndex:
    parser = Parser(_CPP_LANGUAGE)
    source_bytes = source_code.encode("utf-8")
    tree = parser.parse(source_bytes)
    index = _CppProgramIndex(lines=source_code.splitlines())

    def record_user_def(name: str, ns_stack: list[str]) -> None:
        ns = "::".join(ns_stack)
        if ns == "std" or ns.startswith("std::"):
            return
        if ns:
            index.user_defined_by_ns.setdefault(ns, set()).add(name)
        else:
            index.user_defined_global.add(name)

    def collect_user_defs(node: Node, ns_stack: list[str], in_record: bool = False) -> None:
        if node.type in _IGNORED_SUBTREE_TYPES:
            return
        if node.type == "namespace_definition":
            name_node = node.child_by_field_name("name")
            next_stack = ns_stack + ([_node_text(source_bytes, name_node)] if name_node else [])
            for child in node.children:
                collect_user_defs(child, next_stack, in_record)
            return
        if node.type in {"struct_specifier", "class_specifier"}:
            name_node = node.child_by_field_name("name")
            if name_node is not None:
                record_user_def(_node_text(source_bytes, name_node), ns_stack)
            for child in node.children:
                collect_user_defs(child, ns_stack, in_record=True)
            return
        if node.type == "function_definition":
            decl = node.child_by_field_name("declarator")
            if decl is not None:
                fn_name = _extract_declarator_name(source_bytes, decl)
                if fn_name:
                    if in_record:
                        index.user_defined_methods.add(fn_name)
                    else:
                        record_user_def(fn_name, ns_stack)
        elif node.type == "alias_declaration":
            name_node = node.child_by_field_name("name")
            if name_node is not None:
                record_user_def(_node_text(source_bytes, name_node), ns_stack)
        for child in node.children:
            collect_user_defs(child, ns_stack, in_record)

    collect_user_defs(tree.root_node, [])

    def walk(node: Node, ns_stack: list[str]) -> None:
        if node.type in _IGNORED_SUBTREE_TYPES:
            return

        line = node.start_point.row + 1

        if node.type == "preproc_include":
            path_node = node.child_by_field_name("path")
            if path_node is not None:
                index.includes.append((_node_text(source_bytes, path_node).strip(), line))
            return

        if node.type in {"preproc_def", "preproc_function_def"}:
            name_node = node.child_by_field_name("name")
            val_node = node.child_by_field_name("value")
            if name_node is not None and val_node is not None:
                index.macro_bodies[_node_text(source_bytes, name_node)] = _node_text(
                    source_bytes, val_node
                )
            return

        if node.type == "namespace_alias_definition":
            alias_node = node.child_by_field_name("name")
            ns_nodes = [
                c
                for c in node.children
                if c.type in {"namespace_identifier", "qualified_identifier"}
            ]
            if alias_node is not None and len(ns_nodes) >= 2:
                alias_name = _node_text(source_bytes, alias_node)
                target_node = ns_nodes[-1]
                target = (
                    "::".join(_extract_qualified_parts(source_bytes, target_node))
                    if target_node.type == "qualified_identifier"
                    else _node_text(source_bytes, target_node)
                )
                index.namespace_aliases[alias_name] = target
            return

        if node.type == "using_declaration":
            has_namespace_kw = any(c.type == "namespace" for c in node.children)
            if has_namespace_kw:
                for c in node.children:
                    if c.type == "identifier":
                        index.using_namespaces.add(_node_text(source_bytes, c))
                    elif c.type == "qualified_identifier":
                        index.using_namespaces.add(
                            "::".join(_extract_qualified_parts(source_bytes, c))
                        )
            else:
                for c in node.children:
                    if c.type == "qualified_identifier":
                        parts = _extract_qualified_parts(source_bytes, c)
                        if parts:
                            resolved_ns = index.resolve_namespace("::".join(parts[:-1]))
                            canonical = f"{resolved_ns}::{parts[-1]}" if resolved_ns else parts[-1]
                            index.using_symbols[parts[-1]] = canonical
            return

        if node.type == "namespace_definition":
            name_node = node.child_by_field_name("name")
            next_stack = ns_stack + ([_node_text(source_bytes, name_node)] if name_node else [])
            for child in node.children:
                walk(child, next_stack)
            return

        if node.type in _KEYWORD_NODE_MAP:
            kw = _KEYWORD_NODE_MAP[node.type]
            index.keyword_lines.setdefault(kw, []).append(line)

        if node.type == "qualified_identifier":
            parts = _extract_qualified_parts(source_bytes, node)
            if parts:
                head = index.resolve_namespace(parts[0])
                tail = parts[1:]
                full_parts = head.split("::") + tail
                if "std" in index.using_namespaces and full_parts[0] != "std":
                    candidate_std = "::".join(["std", *full_parts])
                    if full_parts[-1] == "swap" and full_parts[0] == "std":
                        index.uses_swap = True
                    canonical = (
                        candidate_std if full_parts[0] == "ranges" else "::".join(full_parts)
                    )
                else:
                    canonical = "::".join(full_parts)
                if canonical == "std::swap":
                    index.uses_swap = True
                elif canonical.startswith("std::") and parts[-1] in _NON_SWAP_ALGORITHM_SYMBOLS:
                    index.uses_other_algorithm = True
                index.occurrences.append(
                    _Occurrence(
                        canonical_name=canonical,
                        line=line,
                        qualified=True,
                        enclosing_namespace="::".join(ns_stack),
                    )
                )
            for child in node.children:
                if child.type in {"template_type", "template_function"}:
                    for sub in child.children:
                        if sub.type == "template_argument_list":
                            walk(sub, ns_stack)
            return

        if node.type in {
            "identifier",
            "type_identifier",
            "field_identifier",
        } and not _is_declaration_name(node):
            parent = node.parent
            is_member_field = (
                parent is not None
                and parent.type == "field_expression"
                and parent.child_by_field_name("field") == node
            )
            name = _node_text(source_bytes, node)
            if is_member_field:
                if name not in index.user_defined_methods:
                    index.occurrences.append(
                        _Occurrence(
                            canonical_name=name,
                            line=line,
                            qualified=False,
                            enclosing_namespace="::".join(ns_stack),
                            member_access=True,
                        )
                    )
                return
            enclosing_ns = "::".join(ns_stack)
            if name == "swap" and (
                "std" in index.using_namespaces or index.using_symbols.get("swap") == "std::swap"
            ):
                index.uses_swap = True
            elif name in _NON_SWAP_ALGORITHM_SYMBOLS and (
                "std" in index.using_namespaces or name in index.using_symbols
            ):
                index.uses_other_algorithm = True

            if name in index.macro_bodies:
                body = index.macro_bodies[name]
                cleaned_body = re.sub(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'', " ", body)
                for tok in _IDENTIFIER_TOKEN_RE.findall(cleaned_body):
                    clean_tok = tok.lstrip(":")
                    if clean_tok in _KEYWORD_NODE_MAP.values():
                        index.keyword_lines.setdefault(clean_tok, []).append(line)
                    index.occurrences.append(
                        _Occurrence(
                            canonical_name=clean_tok,
                            line=line,
                            qualified="::" in clean_tok,
                            enclosing_namespace=enclosing_ns,
                        )
                    )
                return

            if name in index.using_symbols and not index.has_user_definition(name, enclosing_ns):
                index.occurrences.append(
                    _Occurrence(
                        canonical_name=index.using_symbols[name],
                        line=line,
                        qualified=True,
                        enclosing_namespace=enclosing_ns,
                    )
                )
                return

            index.occurrences.append(
                _Occurrence(
                    canonical_name=name,
                    line=line,
                    qualified=False,
                    enclosing_namespace=enclosing_ns,
                )
            )
            return

        for child in node.children:
            walk(child, ns_stack)

    walk(tree.root_node, [])
    return index


def _matches_banned_header(index: _CppProgramIndex, header_item: str) -> list[int]:
    """Check if a banned header like '<algorithm>' or '<bits/stdc++.h>' is violated."""
    normalized = header_item.strip('<>" ')
    candidate_names = {normalized}
    for aliases in _C_STDLIB_HEADER_ALIASES.values():
        if normalized in aliases:
            candidate_names.update(aliases)

    matched_lines = [line for inc, line in index.includes if inc.strip('<>" ') in candidate_names]
    if not matched_lines:
        return []

    # Trap: <algorithm> included solely for std::swap (or swap) must not violate.
    if normalized == "algorithm" and index.uses_swap and not index.uses_other_algorithm:
        return []

    return matched_lines


def _matches_banned_symbol(index: _CppProgramIndex, target: str) -> list[int]:
    """Match a banned C++ function, type, or keyword against the indexed AST."""
    if target in _KEYWORD_NODE_MAP.values():
        return index.keyword_lines.get(target, [])

    lines: list[int] = []
    is_qualified_target = "::" in target
    short_name = target.split("::")[-1]
    target_ns = "::".join(target.split("::")[:-1]) if is_qualified_target else ""

    for occ in index.occurrences:
        if is_qualified_target:
            if occ.qualified and occ.canonical_name == target:
                lines.append(occ.line)
            elif (
                not occ.qualified
                and not occ.member_access
                and occ.canonical_name == short_name
                and target_ns in index.using_namespaces
                and not index.has_user_definition(short_name, occ.enclosing_namespace)
            ):
                lines.append(occ.line)
        else:
            if occ.qualified and occ.canonical_name in {target, f"std::{target}"}:
                lines.append(occ.line)
            elif occ.member_access and occ.canonical_name == target:
                lines.append(occ.line)
            elif (
                not occ.qualified
                and not occ.member_access
                and occ.canonical_name == target
                and not index.has_user_definition(target, occ.enclosing_namespace)
            ):
                lines.append(occ.line)

    return lines


def _build_evidence(index: _CppProgramIndex, line_numbers: Sequence[int]) -> list[EvidenceLine]:
    seen: set[int] = set()
    evidence: list[EvidenceLine] = []
    for line_no in sorted(line_numbers):
        if line_no in seen or line_no < 1 or line_no > len(index.lines):
            continue
        seen.add(line_no)
        evidence.append({"line": line_no, "text": index.lines[line_no - 1].strip()})
    return evidence


def _evaluate_ban_list(
    index: _CppProgramIndex, constraint_id: str, ban_items: list[str]
) -> ConstraintFinding:
    matched_lines: list[int] = []
    matched_items: list[str] = []

    for item in ban_items:
        if item.startswith("<") and item.endswith(">"):
            hits = _matches_banned_header(index, item)
        else:
            hits = _matches_banned_symbol(index, item.lstrip(":"))
        if hits:
            matched_items.append(item)
            matched_lines.extend(hits)

    if matched_lines:
        items_desc = ", ".join(f"`{item}`" for item in matched_items)
        return {
            "constraint": constraint_id,
            "source": "HARD_RULE",
            "verdict": "violation",
            "evidence": _build_evidence(index, matched_lines),
            "unsureReason": None,
            "reason": f"C++ AST detected banned usage of {items_desc}.",
        }

    return {
        "constraint": constraint_id,
        "source": "HARD_RULE",
        "verdict": "pass",
        "evidence": [],
        "unsureReason": None,
        "reason": "No banned identifier or header usage detected in C++ AST.",
    }


def check_hard_rule(source_code: str, constraint: ConstraintInput) -> ConstraintFinding | None:
    """Evaluate a single constraint if it is a ban list; return None for semantic rules."""
    ban_items = parse_ban_list(constraint["text"])
    if ban_items is None:
        return None
    index = _index_cpp(source_code)
    return _evaluate_ban_list(index, constraint["id"], ban_items)


def check_hard_rules(
    source_code: str, constraints: Sequence[ConstraintInput]
) -> list[ConstraintFinding]:
    """Check source code against 'Do not use/call' constraints via C++ AST.

    Semantic constraints that are not ban lists return 'unsure' with
    unsureReason='MODEL_OFF' when evaluated without an LLM step.
    """
    if not constraints:
        return []

    index = _index_cpp(source_code)
    findings: list[ConstraintFinding] = []
    for constraint in constraints:
        ban_items = parse_ban_list(constraint["text"])
        if ban_items is None:
            findings.append(
                {
                    "constraint": constraint["id"],
                    "source": "LLM",
                    "verdict": "unsure",
                    "evidence": [],
                    "unsureReason": "MODEL_OFF",
                    "reason": "Semantic constraint requires LLM evaluation.",
                }
            )
            continue
        findings.append(_evaluate_ban_list(index, constraint["id"], ban_items))
    return findings
