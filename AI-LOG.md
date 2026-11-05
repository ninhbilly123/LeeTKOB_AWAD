# AI-LOG

One entry per task where an assistant did part of the work, complying with the CSC13114 course template.
Team Members:
- **Phạm An Ninh (Leader — DevOps & CI Gate)**
- **Nguyễn Nhật Duy (MSSV: 23120244 — Backend & Contract)**
- **Huỳnh Đăng Khoa (AI Harness & Security)**

---

## 2026-11-02 — Establish Quality Gate CI and Monorepo Checks (Phạm An Ninh)
- **Tool**: Claude / Gemini (Antigravity).
- **Asked for**: Set up 4 standardized quality check commands for a multi-service polyglot monorepo (TypeScript + Python), configure a GitHub Actions CI pipeline that blocks bad merges into `main`, and prepare Branch Protection evidence per the PA#2 rubric.
- **Kept**: 
  - 4 canonical commands at root `package.json`: `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run test`.
  - GitHub Actions workflow `.github/workflows/ci.yml` provisioning dual runtimes (Node 22 LTS + Python 3.12) to test all services (`gateway`, `web`, `checker`).
  - Three-tier AI permissions model (`allowed`, `ask first`, `never`) and two post-mortem failure stories in `AGENTS.md` and `CLAUDE.md`.
- **Changed**:
  - The assistant initially chained commands with `&& (cd checker && ruff check .)`, which fails on Windows PowerShell due to syntax incompatibilities. The team required replacing this with a dedicated cross-platform Node script runner `scripts/run-check.mjs` using `node:child_process.spawnSync`, ensuring 100% identical behavior on local Windows machines and Linux GitHub Actions runners.
  - Adjusted `checker/pyproject.toml` to explicitly define `pythonpath = ["."]` so `pytest` resolves package imports when invoked from the repository root.
- **Rejected**:
  - Rejected the assistant's suggestion to split checks into 4 independent GitHub Actions workflows or skip Python checks locally; Criterion 3 strictly requires that a fresh clone gets all checks green with the exact same documented commands.
  - Rejected adding `continue-on-error: true` to CI steps: all quality checks must be strict and gating.
- **By hand**:
  - Configured Branch Protection on the GitHub web console (`Require status checks to pass before merging`, `Require branches to be up to date before merging`, `Require pull request reviews`).
  - Created a deliberate violation pull request to verify CI fails red and merge is blocked (Criterion 4 evidence).

---

## 2026-11-05 — Establish Project Constitution and Governance Rules (Nguyễn Nhật Duy)
- **Tool**: Gemini 3.8 Flash / Antigravity (`/speckit-constitution`).
- **Asked for**: Read `leetkob_class_project_brief.md`, synthesize core product principles, quality thresholds, sandbox security boundaries, and operational rules into `.specify/memory/constitution.md` using the Spec Kit template, and record all prompt interactions into `AI-LOG.md`.
- **Kept**:
  - 5 Core Non-Negotiable Principles: Zero Wrongful Deductions & Human Gate (TA review queue), Hard Rules First (Tree-sitter AST) then Semantic Model, Strict Sandbox Isolation (zero network, non-root, no secrets, no Docker socket), Contract-First API Development (RFC 9457 & Idempotency), and Privacy-Preserving LLM Input with $10 USD spending cap.
  - Scope Guardrails: Clear definition of In-Scope (C++17, Docker sandbox, TA review queue, 80 concurrent submissions, dev set CI gate) vs Out-of-Scope (no second language, no automated test generation, no plagiarism detection, no online IDE/RAG).
  - Multi-tier Governance hierarchy (Lecturer & Brief > Product Owners FAQ > Constitution & Rules).
- **Changed**:
  - Refined the template structure to directly embed numerical thresholds from the lecturer brief (Wrongful deductions = 0, Violations caught >= 90%, Unsure <= 20%, 10% random pass audit).
  - Clarified that the LLM only judges semantic constraints and never decides deduction scores or test suites.
- **Rejected**:
  - Rejected any vague guidance language (e.g. replacing generic "should" guidelines with strict, testable MUST / NON-NEGOTIABLE assertions).
  - Rejected scope expansion into online IDE or competitor contest ranking systems, keeping focus purely on TA lab grading assistance.
- **By hand**:
  - Audited `leetkob_class_project_brief.md` against existing repo configurations and verified that all constitution principles align with the PA#2 rubric and `AGENTS.md`.

---

## 2026-11-05 — Generate Specification for Submission API & Contract Tests (Nguyễn Nhật Duy)
- **Tool**: Gemini 3.8 Flash / Antigravity (`/speckit-specify`).
- **Asked for**: Generate a formal feature specification (`spec.md`) and requirements validation checklist (`requirements.md`) for PA#2 task M1 (Backend API, Contract Specification & Contract Tests) under `specs/001-submission-contract-api/`.
- **Kept**:
  - 5 user stories prioritizing core submission flow (P1), network retry idempotency (P1), authorization and class ownership boundaries (P1), payload/deadline validation (P2), and automated contract protection that bites (P1).
  - Complete RFC 9457 Problem Details specification for all error codes (`400`, `401`, `403`, `404`, `409`).
  - Key entities, measurable success criteria (SC-001 through SC-005), and quality checklist.
- **Changed**:
  - Structured the user stories to focus strictly on user and stakeholder outcomes (WHAT and WHY) while delegating implementation specifics (NestJS, Jest, Supertest) to planning and assumptions.
- **Rejected**:
  - Rejected generating non-standard custom error schemas; strictly mandated `Content-Type: application/problem+json` per project constitution.
- **By hand**:
  - Validated that the spec satisfies all 15 items in the Spec Quality Checklist and linked the specification directory in `.specify/feature.json`.

---

## 2026-11-05 — Audit and Enhance Submission API Contract (Nguyễn Nhật Duy)
- **Tool**: Gemini 3.8 Flash / Antigravity.
- **Asked for**: Review and enhance `docs/contract/post-submissions.md` ensuring strict adherence to the PA#2 rubric (Criterion 5), RFC 9457 Problem Details, Idempotency-Key specification, role/ownership enforcement, and versioning policy.
- **Kept**:
  - Refined `docs/contract/post-submissions.md` with explicit response headers (`Location`, mirrored `Idempotency-Key`).
  - Comprehensive RFC 9457 error catalog including detailed scenarios for `400` (missing code, oversized code, missing/invalid UUID Idempotency-Key), `401` Unauthorized, `403` Forbidden (both cross-class student and non-student TA/Admin attempts), `404` Not Found, `409` Conflict (deadline passed & key conflict), `415` Unsupported Media Type, and `500` Internal Server Error.
  - Specified 24-hour TTL and SHA-256 body hashing for idempotency handling.
  - Added RFC 8594 Sunset and Deprecation headers to the breaking change policy.
- **Changed**:
  - Upgraded problem detail fields to match RFC 9457 standards strictly (`type`, `title`, `status`, `detail`, `instance`).
- **Rejected**:
  - Rejected placing implementation-specific database error messages into public contract responses to prevent internal information leakage.
- **By hand**:
  - Cross-referenced all error codes and ownership rules against `leetkob_class_project_brief.md` and `PA2.md`.

---

## 2026-11-05 — Plan Implementation for Submission API & Contract Suite (Nguyễn Nhật Duy)
- **Tool**: Gemini 3.8 Flash / Antigravity (`/speckit-plan`).
- **Asked for**: Execute the implementation planning workflow to create `plan.md`, `research.md`, `data-model.md`, JSON contract schema, and `quickstart.md` for the submission API and contract test suite.
- **Kept**:
  - Concrete layout under `gateway/src/` (Exception Filter, Idempotency Interceptor, Ownership Guard, Submissions Module) and `gateway/test/submissions.contract.spec.ts`.
  - Architecture decisions: Global RFC 9457 exception filter, SHA-256 payload hashing for 24h idempotency caching, in-memory decoupling for zero-dependency CI runs, and Supertest contract suite.
  - 5 core entities in data model, ERD, and state machine transition diagram.
- **Changed**:
  - Chose in-memory repository abstractions for PA#2 to keep `npm run test` fast (<5s) and dependency-free, while maintaining production interfaces ready for PostgreSQL/Redis in PA#3.
- **Rejected**:
  - Rejected introducing heavyweight Docker Compose or real database setup into the local unit test gate.
- **By hand**:
  - Verified that all plan components satisfy the LeeTKOB constitution and quality gate constraints.

---

## 2026-11-05 — Generate Actionable Task Breakdown for Submission API & Contract Suite (Nguyễn Nhật Duy)
- **Tool**: Gemini 3.8 Flash / Antigravity (`/speckit-tasks`).
- **Asked for**: Generate a dependency-ordered, checklist-compliant task breakdown (`tasks.md`) covering Setup, Foundational infrastructure, and all 5 User Stories for the submission API and contract suite.
- **Kept**:
  - 26 actionable, finely grained tasks (T001 to T026) organized into 8 clear phases with strict markdown checklist format (`- [ ] [TaskID] [P?] [Story?] Description with file path`).
  - Clear user story mapping: US1 (Happy Path MVP), US2 (Idempotency), US3 (Ownership & Role bounds), US4 (Payload & Deadline bounds), US5 (Contract suite bite & deliberate break).
  - Explicit test-first sequencing where contract tests are drafted and verified before service logic.
  - Mermaid dependency flow diagram, parallel execution opportunities, and incremental delivery milestones.
- **Changed**:
  - Embedded exact validation constraints (1 byte to 64 KB, UUID v4, RFC 9457) directly into task descriptions so implementation requires no guessing.
- **Rejected**:
  - Rejected combining multiple components into single monolithic tasks to enable atomic progress tracking and clean Git commits.
- **By hand**:
  - Audited task ordering against PA#2 rubric requirements to ensure every deliverable (including deliberate break commit for Criterion 6) is scheduled.

---

## 2026-11-05 — Implement Phase 1 Setup for Submission API (Nguyễn Nhật Duy)
- **Tool**: Gemini 3.8 Flash / Antigravity (`/speckit-implement`).
- **Asked for**: Execute Phase 1 Setup tasks (T001 - T003): create directory structure, define TypeScript entity interfaces, and implement in-memory mock repository fixtures.
- **Kept**:
  - Created directories `gateway/src/common/filters/`, `gateway/src/common/guards/`, `gateway/src/common/interceptors/`, `gateway/src/submissions/dto/`.
  - Implemented `gateway/src/submissions/submissions.types.ts` with types for Submission, Lab, ClassMembership, AuthenticatedUser, IdempotencyRecord, and Rfc9457ProblemDetails.
  - Implemented `gateway/src/submissions/submissions.fixtures.ts` with mock labs, active/dropped memberships, mock users with roles (STUDENT, TA, ADMIN), and `InMemorySubmissionStore`.
  - Updated `tasks.md` marking T001, T002, T003 as `[X]`.
- **Changed**:
  - Configured future deadline for valid lab (2099) and past deadline (2020) for expired lab test cases.
- **Rejected**:
  - Rejected connecting to live database instances in local unit/contract setup.
- **By hand**:
  - Verified TypeScript interface signatures against `specs/001-submission-contract-api/data-model.md`.

---

## 2026-11-05 — Implement Foundational Infrastructure & User Story 1 MVP (Nguyễn Nhật Duy)
- **Tool**: Gemini 3.8 Flash / Antigravity (`/speckit-implement`).
- **Asked for**: Execute Phase 2 Foundational blocking tasks (T004 - T007) and Phase 3 User Story 1 Happy Path MVP (T008 - T012).
- **Kept**:
  - Implemented `gateway/src/common/filters/rfc9457-exception.filter.ts` ensuring all HTTP exceptions emit RFC 9457 Problem Details with `Content-Type: application/problem+json`.
  - Implemented `gateway/src/common/interceptors/idempotency.interceptor.ts` with SHA-256 fingerprinting and 24h caching.
  - Implemented `gateway/src/common/guards/class-ownership.guard.ts` with JWT extraction, role validation, and class membership check.
  - Implemented `CreateSubmissionDto` in `gateway/src/submissions/dto/create-submission.dto.ts`.
  - Implemented `SubmissionsService` in `gateway/src/submissions/submissions.service.ts` handling lab validation and queueing.
  - Implemented `SubmissionsController` in `gateway/src/submissions/submissions.controller.ts` handling `POST /labs/:labId/submissions` with status 201 and Location header.
  - Registered SubmissionsModule and APP_FILTER in `gateway/src/app.module.ts`.
  - Wrote Supertest contract test in `gateway/test/submissions.contract.spec.ts` validating 201 Created and QUEUED status.
  - Executed tests via `npm run test --workspace=gateway`: 100% GREEN (2 passed, 2 total).
  - Updated `tasks.md` marking T004 - T012 as `[X]`.
- **Changed**:
  - Handled Express route param types cleanly in `class-ownership.guard.ts` to ensure strict TypeScript compiler safety.
- **Rejected**:
  - Rejected default NestJS error structure in favor of RFC 9457.
- **By hand**:
  - Verified that the response body, Location header, and Idempotency-Key mirror header match `docs/contract/post-submissions.md`.

---

## 2026-11-05 — Implement User Story 2 Idempotency Contract Suite (Nguyễn Nhật Duy)
- **Tool**: Gemini 3.8 Flash / Antigravity (`/speckit-implement`).
- **Asked for**: Implement Phase 4 User Story 2 (T013 - T015) providing idempotency retry guarantees, payload mismatch conflict detection, and contract tests.
- **Kept**:
  - Wrote contract tests for identical retry returning cached 201 Created and verifying zero duplicate submissions in store (`submissionStore.getAllSubmissions().length === 1`).
  - Wrote contract tests for payload mismatch returning 409 Conflict with RFC 9457 `application/problem+json` (`type: https://leetkob.edu.vn/errors/idempotency-conflict`).
  - Verified `IdempotencyInterceptor` SHA-256 fingerprinting and 24h cache lookup.
  - Executed tests via `npm run test --workspace=gateway`: 100% GREEN (4 passed, 4 total).
  - Updated `tasks.md` marking T013, T014, T015 as `[X]`.
- **Changed**:
  - Normalized test payload strings and verified that response headers (Location, Idempotency-Key) are preserved on cache hits.
- **Rejected**:
  - Rejected permitting duplicate queue message generation on client retries.
- **By hand**:
  - Ran Jest contract suite via `npm run test --workspace=gateway`.

---

## 2026-11-05 — Implement User Story 3 Ownership & Role Boundaries (Nguyễn Nhật Duy)
- **Tool**: Gemini 3.8 Flash / Antigravity (`/speckit-implement`).
- **Asked for**: Implement Phase 5 User Story 3 (T016 - T018) enforcing authentication, class enrollment ownership, and student-only role boundaries with RFC 9457 error contracts.
- **Kept**:
  - Implemented comprehensive contract test coverage in `gateway/test/submissions.contract.spec.ts` for:
    - 401 Unauthorized when `Authorization` header is missing.
    - 401 Unauthorized when Bearer token is invalid or expired.
    - 403 Forbidden when a student is not enrolled in the class owning the lab (`type: https://leetkob.edu.vn/errors/forbidden-class-access`).
    - 403 Forbidden when a TA attempts to submit code (`detail: Only users with the STUDENT role may submit solutions.`).
    - 403 Forbidden when an Admin attempts to submit code.
  - All error assertions verified against RFC 9457 Problem Details schema (`application/problem+json`, `type`, `title`, `status`, `detail`, `instance`).
  - Executed tests via `npm run test --workspace=gateway`: 100% GREEN (9 passed, 9 total).
  - Updated `tasks.md` marking T016, T017, T018 as `[X]`.
- **Changed**:
  - Added explicit test cases verifying both unauthenticated states (missing vs invalid Bearer token) and role boundaries (TA and Admin forbidden).
- **Rejected**:
  - Rejected allowing any non-student role to submit code to preserve strict grading ownership boundaries.
- **By hand**:
  - Ran Jest test suite with `npm run test --workspace=gateway` and checked RFC 9457 conformity.

---

## 2026-11-05 — Implement User Story 4 Payload Validation & Deadline Enforcement (Nguyễn Nhật Duy)
- **Tool**: Gemini 3.8 Flash / Antigravity (`/speckit-implement`).
- **Asked for**: Implement Phase 6 User Story 4 (T019 - T021) validating payload constraints (empty code, 64 KB limit, UUID v4 key, Content-Type) and deadline enforcement with RFC 9457 error contracts.
- **Kept**:
  - Implemented comprehensive contract test coverage in `gateway/test/submissions.contract.spec.ts` for:
    - 400 Bad Request when code is empty or whitespace-only (`detail: Source code cannot be empty or whitespace-only.`).
    - 400 Bad Request when code payload exceeds 64 KB limit (`detail: Source code exceeds the 64 KB limit (current: 65537 bytes).`).
    - 400 Bad Request when `Idempotency-Key` header is missing.
    - 400 Bad Request when `Idempotency-Key` is not a valid UUID v4 format.
    - 404 Not Found when target `labId` does not exist (`detail: The requested lab with ID 'lab_not_found_999' does not exist.`).
    - 409 Conflict when submission deadline has passed (`type: https://leetkob.edu.vn/errors/deadline-passed`).
    - 415 Unsupported Media Type when `Content-Type` is not `application/json`.
  - Enforced strict `Content-Type: application/json` inspection in `gateway/src/submissions/submissions.controller.ts`.
  - Executed tests via `npm run test --workspace=gateway`: 100% GREEN (16 passed, 16 total).
  - Updated `tasks.md` marking T019, T020, T021 as `[X]`.
- **Changed**:
  - Refined Content-Type check to reject missing or non-JSON payloads with RFC 9457 Problem Details (`https://leetkob.edu.vn/errors/unsupported-media-type`).
- **Rejected**:
  - Rejected accepting submissions with expired deadlines or allowing arbitrary strings as idempotency keys.
- **By hand**:
  - Ran contract tests with `npm run test --workspace=gateway` and verified against `docs/contract/post-submissions.md` error specifications.

---

## 2026-11-05 — Execute Monorepo Quality Gate & Contract Suite Verification (Nguyễn Nhật Duy)
- **Tool**: Gemini 3.8 Flash / Antigravity (`/speckit-implement`).
- **Asked for**: Execute Phase 7 User Story 5 (T022 - T023) validating the monorepo test quality gate (`npm run test`), linting, formatting, and preparing deliberate contract break evidence for PA#2 Criterion 6.
- **Kept**:
  - Executed full monorepo quality gate `npm run test` validating Gateway (Jest: 16/16 passed), Web (Vitest: 1/1 passed), and Checker (Pytest: 2/2 passed) with 100% GREEN exit code.
  - Executed `npm run lint` across all three services with 0 errors.
  - Executed `npm run format:check` and auto-formatted code style across Gateway and Web with Prettier.
  - Executed `npm run typecheck` across TypeScript (`tsc --noEmit`) and Python (`mypy`) with 0 type errors.
  - Marked T022 as `[X]` in `specs/001-submission-contract-api/tasks.md`.
- **Changed**:
  - Installed missing development dependencies (`pytest`, `ruff`, `mypy`) into Python environment so the monorepo runner executes cleanly on local Windows environments.
  - Formatted Prettier styling in Gateway and Web files to ensure strict compliance with `npm run format:check`.
- **Rejected**:
  - Rejected skipping any monorepo check or running checks only on a single subproject; all 4 commands are verified from root.
- **By hand**:
  - Ran all 4 canonical checks (`lint`, `format:check`, `typecheck`, `test`) from repo root and verified 100% green pass.

---

## 2026-11-05 — Document Format Quality Check & Auto-Fix Commands (Nguyễn Nhật Duy)
- **Tool**: Gemini 3.8 Flash / Antigravity.
- **Asked for**: Create `command.md` documenting the exact 2 commands for format checking and auto-fixing across all monorepo services for convenient developer execution.
- **Kept**:
  - Created `command.md` specifying:
    1. Read-only check command: `npm run format:check`
    2. Comprehensive auto-fix command: `npx prettier --write "gateway/src/**/*.ts" "gateway/test/**/*.ts" "web/src/**/*.{ts,tsx}" ; python -m ruff format checker`
    3. Quick reference for the canonical quality gate commands (`lint`, `typecheck`, `test`).
- **Changed**:
  - Combined multi-service formatting into one cross-language command chain for PowerShell so both TypeScript and Python services format cleanly in one execution.
- **Rejected**:
  - Rejected creating complex separate scripts when direct CLI commands achieve identical results.
- **By hand**:
  - Executed and validated both commands from repository root on Windows PowerShell.




