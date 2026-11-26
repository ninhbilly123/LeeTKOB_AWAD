---
name: feature-workflow
description: >-
  Guides end-to-end feature development for LeeTKOB from scoping through PR
  handover. Use this skill whenever starting a new feature, endpoint, worker,
  checker capability, or UI flow (e.g., D1-D3, N1-N3, K1-K3).
---

# LeeTKOB Feature Development Workflow

Follow these 7 stages in order for every feature task.

## 1. Scope, Authority & Tier-2 Check
- Identify the feature code in `docs/proposal/proposal-detail.md` and active rubric criteria (`docs/rubric/PA3_rubric.md`).
- Resolve any ambiguity using strict precedence: **Class Brief > PO FAQ (`docs/proposal/FAQ.md`) > Proposal**.
- If the task changes DB schemas, API/internal contracts (`docs/contract/`), CI workflows (`.github/workflows/`), or adds packages, ask the user for **Tier 2 confirmation** before editing.

## 2. Sync `main` & Checkout Dedicated Branch
- Never work on `main`. Sync `origin/main` and checkout a dedicated branch matching the task:
  `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`, or `test/<slug>`.

## 3. Contract & Schema First
- **HTTP API**: Write or update `docs/contract/<endpoint>.md` first — define roles + ownership, request/response field rules, complete **RFC 9457** error catalog (`application/problem+json`), cursor pagination or DB-backed `Idempotency-Key`, and versioning. Cite applicable FAQ entries (`FAQ-02`, `FAQ-08`, `FAQ-09`, `FAQ-10`).
- **Cross-service messages** (`Gateway <-> Queue/Judge <-> Checker`): Pin the shared JSON schema (including `unsureReason` per `FAQ-09`) before parallel coding; use stubs/mocks so teammates are unblocked.
- **Database**: Enforce invariants in schema (`NOT NULL`, `UNIQUE`, `CHECK`, `FK`) and design migrations as **Expand -> Migrate -> Contract** with `.up.sql` / `.down.sql`.

## 4. Tests First, One Part Per Commit
- Write tests directly from the contract and threat table — never copy buggy code output as expected values:
  - Cover happy path, every RFC 9457 error type, and role/ownership refusals (assert DB/store state did **not** change after every `403`/`404`/`409`).
  - For `checker/`: include ban-list trap tests and offline fake-model tests for schema validation and timeout limits.
- **Commit discipline (PA#3 Criterion 7)**: Keep **one logical part per commit** (`sandbox`, `queue`, `hard rules`, `model call`, `limits`), landing tests **before or in the same commit** as the implementation. Never loosen tests to pass CI or rewrite git history to fake incremental commits.

## 5. Implement & Verify Locally
- Implement strictly against the contract:
  - Enforce auth and ownership on the server (never rely on hidden UI controls).
  - Never expose SQL/stack traces in `500` responses; never hold DB transactions across network/LLM calls.
  - Uphold the **Syllabus Rule**: before Publish, student APIs return only `overallVerdict` and `testVerdicts[]` (`FAQ-02`, `FAQ-08`); LLM verdicts land only in the TA review queue (`PENDING_REVIEW`) with schema validation and timeout enforced.
- Run domain-specific verification skills when applicable:
  - Touched `checker/` or eval datasets -> activate [`checker-eval-runner`](../checker-eval-runner/SKILL.md).
  - Touched `judge/`, Docker sandbox, or CI sandbox tests -> activate [`sandbox-security-audit`](../sandbox-security-audit/SKILL.md).

## 6. Quality Gates & Handover
- Activate [`post-task-handover`](../post-task-handover/SKILL.md) to:
  1. Run all four offline root gates (`npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run test`).
  2. Audit `git diff` against `AGENTS.md` Never rules and sync `README.md` / `.env.example` if setup, data, or commands changed.
  3. Append an honest entry to `AI-LOG.md` (`Tool`, `Asked for`, `Kept`, `Changed`, `Rejected`, `Validation`).
  4. Log the task to the `phân chia công việc` tab of the project Google Sheet (12 columns).

## 7. Confirm Commit, Push & Pull Request
- Ask the user for confirmation before committing, pushing the branch, and opening a Pull Request to `main`.
- Ensure required CI is green and at least one teammate reviews the diff before merging.
