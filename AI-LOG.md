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

## 2026-11-05 — Audit and Standardize Submission API Contract (Nguyễn Nhật Duy)
- **Tool**: Gemini 3.8 Flash / Antigravity.
- **Asked for**: Review and standardize `docs/contract/post-submissions.md` ensuring full compliance with PA#2 Criterion 5, including RFC 9457 Problem Details (`application/problem+json`), client idempotency retry semantics via `Idempotency-Key`, strict student ownership and class enrollment rules, and RFC 8594 versioning headers.
- **Kept**:
  - Explicit response headers: `Location: /labs/{labId}/submissions/{id}` and mirrored `Idempotency-Key`.
  - Comprehensive RFC 9457 error catalog with structured examples for `400` Bad Request (missing/empty code, payload > 64 KB, missing/invalid UUID v4 key), `401` Unauthorized, `403` Forbidden (cross-class student and non-student TA/Admin attempts), `404` Not Found, `409` Conflict (deadline passed & key conflict), `415` Unsupported Media Type, and `500` Internal Server Error.
  - Specified 24-hour TTL and SHA-256 payload hashing for idempotency handling.
  - Breaking change and API versioning policy with RFC 8594 `Sunset` and `Deprecation` headers.
- **Changed**:
  - Upgraded problem details fields to strictly conform to RFC 9457 members (`type`, `title`, `status`, `detail`, `instance`).
  - Specified that `Idempotency-Key` must strictly be a UUID v4 string.
- **Rejected**:
  - Rejected placing raw backend stack traces or internal database errors into client-facing problem details.
  - Rejected allowing non-student roles (`TA`, `ADMIN`) to submit code to preserve strict grading ownership.
- **By hand**:
  - Cross-referenced all error codes, status mappings, and enrollment constraints against `leetkob_class_project_brief.md` and the PA#2 rubric.

---

## 2026-11-05 — Implement Submission Endpoint Core & RFC 9457 Exception Filter (Nguyễn Nhật Duy)
- **Tool**: Gemini 3.8 Flash / Antigravity.
- **Asked for**: Set up the NestJS submission module structure under `gateway/src/submissions/`, implement a centralized RFC 9457 exception filter, define TypeScript domain types, and create in-memory decoupled repository fixtures for zero-dependency test execution.
- **Kept**:
  - Created domain types in `gateway/src/submissions/submissions.types.ts` (`Submission`, `Lab`, `ClassMembership`, `AuthenticatedUser`, `IdempotencyRecord`, `Rfc9457ProblemDetails`).
  - Created in-memory mock repository store and fixtures in `gateway/src/submissions/submissions.fixtures.ts`.
  - Implemented centralized `Rfc9457ExceptionFilter` in `gateway/src/common/filters/rfc9457-exception.filter.ts` bound globally in `gateway/src/app.module.ts`.
  - Implemented `SubmissionsController` (`gateway/src/submissions/submissions.controller.ts`) and `SubmissionsService` (`gateway/src/submissions/submissions.service.ts`) accepting valid submissions, returning `201 Created` with `Location` header, and enqueueing status `QUEUED`.
  - Wrote initial contract test in `gateway/test/submissions.contract.spec.ts` verifying `201 Created` and submission payload structure.
- **Changed**:
  - Handled Express route param types cleanly (`string | string[]`) to satisfy strict TypeScript compiler checks without `any` casts.
  - Used in-memory repository abstractions to enable lightning-fast (<5s) contract testing without requiring Docker or PostgreSQL in local/CI test gates.
- **Rejected**:
  - Rejected using default NestJS JSON error format; strictly enforced `Content-Type: application/problem+json`.
- **By hand**:
  - Verified controller and filter bindings via `npm run test --workspace=gateway`.

---

## 2026-11-05 — Implement Idempotency Interceptor & Retry Contract Tests (Nguyễn Nhật Duy)
- **Tool**: Gemini 3.8 Flash / Antigravity.
- **Asked for**: Implement client retry idempotency handling for `POST /labs/:labId/submissions` using SHA-256 payload fingerprinting and 24-hour cache lookup, and write contract tests to verify that retransmissions return cached responses without duplicate database records.
- **Kept**:
  - Implemented `IdempotencyInterceptor` in `gateway/src/common/interceptors/idempotency.interceptor.ts` bound to the submission route.
  - Calculated SHA-256 hash of normalized request body to detect payload mismatches.
  - Cached `201 Created` response body and headers (`Location`, `Idempotency-Key`) with 24-hour TTL.
  - Wrote contract tests in `gateway/test/submissions.contract.spec.ts`:
    - Identical retry returns cached 201 response and confirms zero duplicate records created in store (`submissionStore.getAllSubmissions().length === 1`).
    - Reused key with mismatched payload immediately returns `409 Conflict` with RFC 9457 Problem Details (`https://leetkob.edu.vn/errors/idempotency-conflict`).
- **Changed**:
  - Ensured only successful (2xx) responses are cached in the idempotency store, while error responses (4xx/5xx) are never cached.
  - Mirrored original `Idempotency-Key` and `Location` headers in cached responses.
- **Rejected**:
  - Rejected allowing duplicate submission entries or duplicate message queue events on network retries.
- **By hand**:
  - Ran Jest contract tests via `npm run test --workspace=gateway` and verified idempotency cache behavior.

---

## 2026-11-05 — Implement Class Ownership Guard & Role Boundary Contract Tests (Nguyễn Nhật Duy)
- **Tool**: Gemini 3.8 Flash / Antigravity.
- **Asked for**: Implement authentication, role-based authorization, and class enrollment ownership enforcement for `POST /labs/:labId/submissions`, and write contract tests verifying that unauthenticated or unauthorized callers are rejected with RFC 9457 error responses.
- **Kept**:
  - Implemented `ClassOwnershipGuard` in `gateway/src/common/guards/class-ownership.guard.ts` bound to `SubmissionsController`.
  - Extracted and verified Bearer JWT token from `Authorization` header.
  - Enforced role boundary: caller must have `STUDENT` role; non-student roles (`TA`, `ADMIN`) are rejected with `403 Forbidden`.
  - Enforced class enrollment boundary: student must be an active enrolled member of the class owning the specified lab; cross-class submissions are rejected with `403 Forbidden`.
  - Wrote contract tests in `gateway/test/submissions.contract.spec.ts` for:
    - `401 Unauthorized` when `Authorization` header is missing.
    - `401 Unauthorized` when Bearer token is invalid or expired.
    - `403 Forbidden` when student is authenticated but not enrolled in the owning class.
    - `403 Forbidden` when a TA attempts to submit code.
    - `403 Forbidden` when an Admin attempts to submit code.
- **Changed**:
  - Standardized error problem details to include exact failure explanations in the `detail` property while keeping internal user/class IDs safe.
- **Rejected**:
  - Rejected any mock token bypasses (e.g. hardcoded `dev-admin` tokens) in accordance with the project's non-negotiable security rules in `AGENTS.md`.
- **By hand**:
  - Executed contract test suite verifying all 5 security test cases pass green.

---

## 2026-11-05 — Implement Payload Validation, Deadline Enforcement & Boundary Contract Tests (Nguyễn Nhật Duy)
- **Tool**: Gemini 3.8 Flash / Antigravity.
- **Asked for**: Implement strict input validation for submission payload (code presence, 64 KB size limit, UUID v4 key, Content-Type) and deadline enforcement in `SubmissionsController` and `SubmissionsService`, and expand the contract test suite to cover all remaining RFC 9457 error codes.
- **Kept**:
  - Validated that `Content-Type` is strictly `application/json` (rejecting others with `415 Unsupported Media Type`).
  - Validated that `Idempotency-Key` exists and matches standard UUID v4 regex (rejecting invalid keys with `400 Bad Request`).
  - Validated that source code is non-empty and contains non-whitespace characters (rejecting empty code with `400 Bad Request`).
  - Validated that UTF-8 byte length of code does not exceed 64 KB / 65,536 bytes (rejecting oversized payloads with `400 Bad Request`).
  - Validated target lab existence (returning `404 Not Found` if labId does not exist).
  - Validated submission deadline against current server timestamp (returning `409 Conflict` with type `https://leetkob.edu.vn/errors/deadline-passed` if expired).
  - Wrote contract tests in `gateway/test/submissions.contract.spec.ts` for each condition:
    - 400 Bad Request (empty code, code > 64 KB, missing Idempotency-Key, malformed UUID key).
    - 404 Not Found (non-existent labId).
    - 409 Conflict (deadline passed).
    - 415 Unsupported Media Type (`Content-Type: text/plain`).
- **Changed**:
  - Used `Buffer.byteLength(code, 'utf8')` instead of `code.length` to guarantee accurate byte calculation for multi-byte Unicode characters.
- **Rejected**:
  - Rejected accepting late submissions with warnings; enforced strict `409 Conflict` rejection per course brief.
- **By hand**:
  - Ran full Gateway contract test suite via `npm run test --workspace=gateway` (all 16 tests passed).

---

## 2026-11-05 — Document Format Quality Check & Auto-Fix Commands (Nguyễn Nhật Duy)
- **Tool**: Gemini 3.8 Flash / Antigravity.
- **Asked for**: Create `command.md` at repository root documenting the exact commands for checking and auto-fixing code formatting across TypeScript and Python services for convenient developer execution.
- **Kept**:
  - Created `command.md` with:
    1. Read-only check command: `npm run format:check`
    2. Comprehensive auto-fix command: `npx prettier --write "gateway/src/**/*.ts" "gateway/test/**/*.ts" "web/src/**/*.{ts,tsx}" ; python -m ruff format checker`
    3. Quick reference for the other canonical quality gate commands.
- **Changed**:
  - Combined multi-service formatting into one cross-language command chain for PowerShell so both TypeScript and Python services format cleanly in one execution.
- **Rejected**:
  - Rejected creating complex separate scripts when direct CLI commands achieve identical results.
- **By hand**:
  - Executed and validated both commands from repository root on Windows PowerShell.
