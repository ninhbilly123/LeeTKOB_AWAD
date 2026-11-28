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

## 2026-11-04 — AI Assistant Harness, Permissions, Rules & Security Audit (Huỳnh Đăng Khoa)

- **Tool**: Gemini / Claude (Antigravity).
- **Asked for**: Draft operating rules for AI assistants (`AGENTS.md` and `CLAUDE.md`), establish a three-tier permissions hierarchy (allowed, ask first, never), audit repository configuration to ensure zero leaked credentials, establish `.env.example` hygiene, and configure LLM provider policy with spending caps.
- **Model & Cost Policy**:
  - **LLM Provider & Model**: Google AI Studio / Google Cloud — Gemini 3.1 Flash-Lite.
  - **Historical draft claim, superseded by the 2026-11-11 corrections**: this entry originally stated that a $10 cap was configured; that claim was not verified. The team currently uses the free tier.
  - **Estimated Cost per Lab**: With ~80 enrolled students submitting and an average of 1–2 semantic constraint reviews per submission, one lab run consumes approximately 100–160 LLM calls (~$0.02 – $0.05 USD total), well within the $10 USD threshold.
- **Kept**:
  - Structured four-section rules file in `AGENTS.md` and `CLAUDE.md`: `Stack`, `Commands`, `Conventions`, `Never`.
  - Three-tier permissions architecture: Tier 1 (Allowed), Tier 2 (Ask First), Tier 3 (Never).
  - Strictly cleaned `.env.example` containing all service variables without values.
  - Complete git history audit verifying zero live credentials, API keys, or tokens.
- **Changed**:
  - The assistant initially suggested passing host environment variables directly into the test container environment to facilitate sandbox execution. This was modified to strictly isolate the sandbox runtime, ensuring no host environment variables or API keys are ever accessible inside the sandbox container.
  - Standardized `.env.example` to remove placeholder strings and present variables strictly without values to satisfy the rubric criterion literally.
- **Rejected**:
  - **Incident 1 (Test assertion tampering)**: When an authorization test initially failed in local testing, the AI assistant attempted to modify the test assertion from `expect(status).toBe(403)` to `expect(status).toBe(200)` to bypass the failure rather than diagnosing the missing ownership check in the controller. This dangerous evasion was caught immediately in diff review, rejected, and codified directly into the product Never rule: _"Never edit test assertions or remove test cases to bypass CI failure"_.
  - **Incident 2 (Hardcoded backdoor authentication token)**: During middleware prototyping, the assistant proposed inserting a bypass snippet `if (token === "dev-admin") return { role: "admin" }` to simplify manual testing without obtaining real JWT tokens. This critical security hazard was rejected immediately during security audit and codified directly into the Never rule: _"Never hardcode or mock bypass authorization tokens in production middleware"_.

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

---

## 2026-11-11 — Make quality gates consistent across Windows and Linux

- **Tool**: Codex.
- **Asked for**: Fix PA#2 criterion 3 after a Windows checkout failed `npm run format:check` while CI passed the same command.
- **Kept**:
  - The four existing root commands and their fail-fast runner.
  - `.gitattributes` enforcing LF for text files, with CRLF for Windows command scripts.
  - Explicit `endOfLine: lf` settings in both Prettier configurations.
- **Changed**:
  - Normalized the checked TypeScript files from CRLF to LF; test assertions and application behavior are unchanged.
  - Updated the README to use `npm ci`, match the Node.js/Python versions in CI, and explain Python interpreter selection and formatting an existing checkout.
- **Rejected**:
  - Using `endOfLine: auto` as the permanent fix: it accepts whichever line endings happen to be present instead of enforcing one shared format.
  - Disabling the format gate or changing test expectations to get a green result.
- **Validation**:
  - Created a temporary Git snapshot of the changes and cloned it with `core.autocrlf=true`; the checked source and test files were checked out as LF.
  - Followed the README installation steps (`npm ci` and `python -m pip install ruff mypy pytest`).
  - All four canonical commands exited successfully on the clean clone: lint (six existing `no-explicit-any` warnings), format check, type check, and tests (16 Gateway, one Web, two Checker).
  - The working checkout also passed `npm run format:check`; application source and test assertions have no content diff.

---

## 2026-11-11 — Repair submission security, contract coverage and PA#2 evidence

- **Tool**: Codex.
- **Asked for**: Fix all remaining issues found against the PA#2 rubric, including authentication, idempotency, errors, CI evidence and honest submission documents.
- **Kept**:
  - The existing status/body assertions in the original contract suite; request tokens are now signed JWTs rather than magic strings.
  - Official NestJS `@nestjs/jwt` verification with an HS256 allowlist, expiration and required claims; startup has no fallback signing secret.
  - The real ownership guard, controller, service and filter in HTTP tests. Seed data and ephemeral signing secrets are injected only from `gateway/test/support/`.
- **Changed**:
  - Reproduced and removed the guard's raw-user-ID and magic-token bypass. This is verified incident 1 behind the rules file's Never list.
  - Reproduced cached responses crossing lab/student boundaries. Keys are now scoped to student ID; hashes include lab ID and code, with 24-hour retention. This is verified incident 2 behind the rules file's Never list.
  - Moved idempotency after payload validation into synchronous service operations, keeping repeated and concurrent requests to one record in the single-process repository. Durable transactions remain later work.
  - Shared production/test HTTP configuration captures receipt time before parsing and allows JSON escaping of valid 64 KiB code. Malformed JSON and transport oversize have explicit problem responses.
  - Replaced raw internal exception messages with the contracted safe 500 response. Added regressions for JWT failures, ownership, cross-user/lab keys, concurrency, TTL, retries after deadline, UTF-8/JSON size and internal failures.
  - Added the `pa2` tag trigger without renaming the required quality-gate context. Pinned the same Python tools in README, requirements, pyproject and CI. Empty test suites now fail instead of passing silently; the existing e2e config is valid JSON.
  - Filled PA2.md with verified PR/run/commit links and saved public ruleset/step results. Updated the leader's student ID to 23120314 as supplied by the user.
  - Replaced the unconditional 100/100 claim with 96/100 and stated the remaining account setup and implementation boundaries.
- **Rejected**:
  - Weakening old assertions, mocking the ownership guard, accepting fixture credentials in application code, or returning raw internal failures to clients.
  - Claiming a provider spending cap exists because it appears in a config comment. The owner confirmed that there is no dedicated LeeTKOB project and the cap is not configured.
  - Bypassing protected-main review, merging the deliberate broken PR, or describing an alerts-only budget as an enforced spend cap.
- **Correction of earlier entries**:
  - Earlier statements that the old guard verified JWTs, that a $10 cap was configured, and that all contract errors were tested were inaccurate for the reviewed commit. The code/test corrections above supersede the implementation claims; provider setup remains explicitly incomplete.
  - The current PA#2 checker is a placeholder, makes no model calls, and costs $0 in tests. The earlier per-lab cost estimate is withdrawn until real token usage/pricing is measured. No RabbitMQ delivery or durable database integration is claimed by this checkpoint.
- **Evidence**:
  - `docs/evidence/main-ruleset.json`, `docs/evidence/ci-evidence.json`, and the Gitleaks scan/report described in `docs/evidence/secret-scan.md`.
  - Validation results and final submission reference are recorded after the quality gates below complete.
- **Validation completed**:
  - All four canonical commands passed on the working checkout and a clean Windows clone with `core.autocrlf=true`, installed with `npm ci` and pinned Python requirements.
  - Lint: zero warnings. Tests: 37 Gateway, one Web, two Checker (40 total). The additional Gateway e2e command passed one test.
  - Original contract assertions were retained; only test setup/authentication inputs changed. New tests increase coverage rather than changing expected status codes.
  - Gitleaks v8.30.1, verified against its official archive checksum, reported no recognized leaks across all reachable refs; report and scope limitations are in `docs/evidence/secret-scan.md`.

---

## 2026-11-11 — Clarify the current free-tier usage plan

- **Tool**: Codex.
- **Asked for**: Document the team's current use of the Gemini API free tier and the possibility of changing plans in the future.
- **Changed**:
  - Updated README, PA2, self-assessment, environment comments and the usage-plan checklist to reflect the team's declaration.
  - Removed the implication that purchasing paid usage, creating a dedicated paid project or setting a $10/month cap is mandatory for PA#2.
  - Distinguished free-plan quotas, account billing restrictions, a configured monetary spending cap and the $0 cost of placeholder tests. Actual account settings and production per-lab costs are not claimed as independently verified.
- **Rejected**:
  - Marking a paid cap as configured, asserting billing is disabled, or automatically increasing marks based solely on a free-tier declaration.
  - Silently moving the published pa2 tag or replacing its ZIP with a different revision.
- **Validation**: Documentation/environment comments only; check the diff for whitespace, local links and consistent usage-plan wording. No application or test behavior changes are intended.

---

## 2026-11-11 — Record the team's requested 100-point self-assessment

- **Tool**: Codex.
- **Asked for**: Change the team's proposed total to 100; the team will supply screenshots for its newly created API key and free-tier status.
- **Changed**:
  - Updated criterion claims to 15 + 10 + 10 + 20 + 25 + 15 + 5 = 100 and kept the distinction between a self-assessment and the lecturer's final grade.
  - Added `docs/evidence/free-tier.md` with an explicit pending status and instructions to hide the API key and show the plan/quota/billing controls. No screenshots or provider monetary cap are claimed as already verified.
  - Updated PA2.md, README and the intended ZIP filename to match the requested total. Final packaging is deferred until evidence and the submission revision are finalized; existing tag/ZIP snapshots are preserved.
- **Rejected**: Fabricating screenshot files, marking the account evidence complete before receiving it, or changing code/tests to justify a requested score.
- **Validation**: Documentation-only diff; score arithmetic, local links and whitespace checked. No application behavior changes.

---

## 2026-11-11 — Add and inspect the supplied free-tier screenshot

- **Tool**: Codex.
- **Asked for**: Incorporate the screenshot the team saved under `docs/evidence/` and update the pending evidence links.
- **Observed**: `gemini-free-tier.png` shows Google AI Studio API Keys, project LeeTKOB, a key entry created Nov 11, 2026, and the labels Free tier and Set up billing. Only a shortened key suffix is visible; the full API key is not shown.
- **Changed**: Linked the original image and replaced pending-image wording in README, PA2, the self-assessment and the usage checklist. Kept the team's requested 100-point claim separate from the lecturer's final grade.
- **Rejected**: Treating this image as proof of numerical quotas, a configured monetary cap, or globally disabled billing; none is displayed. No quota/billing image was invented and no evidence pixels were edited.
- **Validation**: Visually inspected the supplied image; checked score arithmetic, Markdown links and whitespace. Application/test behavior and published submission refs are unchanged by this evidence update.

---

## 2026-11-19 — Consolidate the local CI link into PA2.md

- **Tool**: Codex.
- **Asked for**: Keep the CI evidence in PA2.md and remove the extra local text file if it is not required by the rubric.
- **Changed**: Confirmed that the hand-in requirements ask for the tag CI link in PA2.md. Copied the recorded run URL into section 5, removed the obsolete separate-file description, and deleted the untracked local `PA2_CI_RUN.txt`.
- **Kept**: The original run URL and its submission-date context; application code, published tags and existing submission archives are unchanged.
- **Validation**: Checked the retained URL, file removal and whitespace. No runtime tests are needed for this documentation-only change.

---

## 2026-11-19 — Correct AI-LOG chronology and publish documentation cleanup

- **Tool**: Codex.
- **Asked for**: Fix the out-of-order date entry, commit the documentation changes, push the branch and open a pull request.
- **Changed**: Moved the existing 2026-11-04 harness/security entry before the 2026-11-05 entries. Included the preceding PA2.md CI-link consolidation in the same documentation change.
- **Kept**: Every existing entry's date and content; the correction changes placement rather than rewriting the historical dates.
- **Validation**: Verified ascending header dates, preservation of all existing entry content, the retained CI URL and a whitespace-clean diff. Application/test code is unchanged.

---

## 2026-11-24 — Update AGENTS.md with workflow and post-task conventions (Phạm An Ninh)

- **Tool**: Antigravity.
- **Asked for**: Add branch/commit conventions, mandatory post-task `AI-LOG.md` update and commit/push/PR confirmation, project tracking Google Sheet logging rules (with exact sheet columns), and `README.md` sync rules to `AGENTS.md`.
- **Kept**: Concise four-section structure of `AGENTS.md`, expanding Section 3 (`Conventions`) with the four new operational rules.
- **Changed**: Inspected the live Google Sheet (`phân chia công việc` tab) via `gsheets` CLI to embed the exact 12 column names directly into `AGENTS.md` instead of leaving generic column placeholders. Removed the hardcoded personal email from `AGENTS.md` after review so every team member can log tasks with their own authorized Google account.
- **Rejected**: Auto-committing or modifying unrelated staged/untracked files (`CLAUDE.md`, `docs/rubric/PA2_rubric.md`) without user confirmation.
- **Validation**: Checked `git diff` on `AGENTS.md` and `AI-LOG.md`; documentation-only change with no application/test code modified.

---

## 2026-11-24 — Distill CSC13114 lecture rules into docs/engineering-rules.md and AGENTS.md (Phạm An Ninh)

- **Tool**: Antigravity.
- **Asked for**: Read all six CSC13114 lecture slide exports (`The Harness`, `Data`, `API Contracts`, `Security`, `Quality Gates`, `Packaging and Release`), consolidate the web engineering rules into `docs/`, and update `AGENTS.md`.
- **Kept**: Created `docs/engineering-rules.md` organizing all rules by session (Sessions 03–08) and kept `AGENTS.md` short by referencing `docs/engineering-rules.md` while adding high-signal conventions, PA#3 cross-service/FAQ/offline-eval synchronization rules, and PA#3/course-wide `Never` guardrails (no CI silencing, no sandbox escapes, no dev-set overfitting, no unreviewed LLM marks).
- **Changed**: Extracted content from each lecture's `*_files/saved_resource.html` rather than the outer wrapper HTML so actual slide rules were captured accurately.
- **Rejected**: Dumping all six lectures verbatim into `AGENTS.md`, which would violate Session 03's "keep the rules file short" principle.
- **Validation**: Verified `docs/engineering-rules.md`, `AGENTS.md`, and `AI-LOG.md` via `git status` and `git diff --stat`. Documentation-only change.

---

## 2026-11-24 — Define Checker Output Schema and Implement C++ AST Hard-Rule Checker (K1) (Huỳnh Đăng Khoa)

- **Tool**: Antigravity.
- **Asked for**: Finalize the shared output schema (`docs/contract/checker-output.md`) for Gateway/Worker/Checker/Eval alignment, then write tests first and implement the C++ AST hard-rule checker (`K1`) on a dedicated branch (`feat/checker-hard-rules`).
- **Kept**:
  - Created `docs/contract/checker-output.md` specifying `CheckerResult`, `ConstraintFinding`, `EvidenceLine`, `UnsureReason` (`FAQ-09`), strict no-deduction LLM schema (`FAQ-11`), review queue boundaries (`FAQ-02`, `FAQ-08`, `FAQ-10`, `FAQ-12`), and CLI JSONL prediction format.
  - Added typed schema definitions in `checker/src/models.py` and syntax-aware C++ AST inspection in `checker/src/hard_rules.py` using `tree-sitter` and `tree-sitter-cpp`, covering comments/strings, user-defined `sort` (namespace/global/method), `<algorithm>` included solely for `std::swap`, `using namespace std;`, `using std::sort;`, namespace aliases, `#define` macros, and function pointers.
  - Added 11 unit and trap tests in `checker/tests/test_hard_rules.py` before implementing `hard_rules.py`.
- **Changed**:
  - Replaced the PA#2 placeholder's string-serialized `"evidence": "[]"` with structured `EvidenceLine` objects (`{"line": int, "text": str}`) and explicit `unsureReason: "MODEL_OFF"` for un-evaluated semantic constraints to align with `docs/contract/checker-output.md` and `FAQ-09`.
  - Pinned `tree-sitter==0.27.0` and `tree-sitter-cpp==0.23.4` in `checker/requirements.txt` and referenced `-r requirements.txt` from `checker/requirements-dev.txt` so CI installs runtime dependencies cleanly without modifying `.github/workflows/ci.yml`.
  - Consolidated duplicated `template_type` / `template_function` traversal branches spotted during diff review.
- **Rejected**:
  - Rejected raw text/regex scanning for `std::sort` or `#include <algorithm>`, which falsely flags comments, string literals, student-defined `sort`, and `<algorithm>` included only for `std::swap` (detected via AST inspection and trap test cases in `checker/tests/test_hard_rules.py`).
  - Rejected keeping any `deduction` or `score` field in checker/LLM output schemas (enforcing `FAQ-11` and the PA#3 syllabus rule).
- **Validation**:
  - Verified test-first red run (`pytest` collection failed before `hard_rules.py` implementation), then ran all four canonical quality gates (`PYTHON=.venv/bin/python npm run lint`, `format:check`, `typecheck`, `test`): all exited `0` (Gateway Jest 37/37, Web Vitest 1/1, Checker Pytest 11/11, Ruff lint/format clean, `mypy --strict` clean on 4 files).
  - Imported the unmodified `fithcmus/awad-leetkob-eval` dev set into `leetkob-eval/` (`eval.mjs` SHA-256 `c836edd8713521bb...`, `labels.jsonl` SHA-256 `262cda7b0ef5612e...`). Initial eval run caught two missed generic ban-list patterns (C++ loop statements / `#define` loop macros and member iterator calls like `.rbegin()`) plus a struct method trap (`s.sort()`). Fixed all three generically in `checker/src/hard_rules.py` with tests in `checker/tests/test_hard_rules.py` (12/12 Pytest passing). Final dev-set hard-rule eval: **0 wrongful deductions**, **55/55 ban-list pairs decided** (15/15 ban-list violations caught with exact line evidence), and 47/47 semantic pairs routed to `unsure`.

---

## 2026-11-24 — Implement Gemini Semantic Checker, Prompt Sanitizer, and Schema/Timeout Guardrails (K2) (Huỳnh Đăng Khoa)

- **Tool**: Antigravity.
- **Asked for**: Implement the LLM semantic constraint pipeline (`K2`) in two separate commits on `feat/checker-model-limits`: (1) sanitized prompt builder + Gemini HTTP transport + orchestrator skipping hard-rule pairs, and (2) tests-first schema validation, evidence verification, and timeout guardrails.
- **Kept**:
  - `checker/src/sanitizer.py`: strips C++ comments via `tree-sitter-cpp` byte spans while preserving newlines and 1-based line numbers, redacts student identifiers, strips `deduction` fields from prompt constraints, and wraps code inside `<submission_code>` data tags.
  - `checker/src/llm_client.py`: Gemini REST transport using stdlib `urllib.request` with `x-goog-api-key` header (read from env only), extracting `responseId` / `x-goog-request-id`, token counts, latency, and estimated USD cost, plus `LlmTransport` protocol for offline `FakeLlmTransport` testing.
  - `checker/src/guardrails.py` & `checker/src/semantic_checker.py`: strict JSON schema check (`additionalProperties` forbidden, no `deduction`/`score`/`marks`), evidence line bounds/text check mapping back to original source lines, timeout/provider-error/cost-cap/model-off fallbacks routing to `unsure` with `FAQ-09` `unsureReason` codes.
- **Changed**:
  - Adjusted the prompt test assertion in `checker/tests/test_semantic_checker.py` from `"deduction" not in sent_prompt` to `'"deduction"' not in sent_prompt` because the system instruction itself explicitly forbids returning a `deduction` field while the `<constraints>` JSON payload excludes the `"deduction"` property.
  - Extracted shared `make_unsure_findings` helper in `checker/src/guardrails.py` to remove duplicate fallback builders in `checker/src/semantic_checker.py`.
  - Accepted evidence text matching either the original line or comment-stripped sanitized line, then mapped the saved `evidence[].text` back to the exact original `.cpp` line so `eval.mjs` and TA review never mismatch on trailing comments.
- **Rejected**:
  - Rejected passing `GEMINI_API_KEY` in query string parameters (kept in `x-goog-api-key` header so keys never appear in URLs) and rejected adding unpinned third-party HTTP SDKs when Python stdlib `urllib.request` suffices offline.
  - Rejected calling any real model inside unit tests (detected and enforced via `FakeLlmTransport`, `_TimeoutTransport`, `_ErrorTransport` in `checker/tests/test_semantic_checker.py` and `checker/tests/test_guardrails.py`).
- **Validation**:
  - Verified test-first red run on `checker/tests/test_guardrails.py` before writing `checker/src/guardrails.py`.
  - Ran all four canonical quality gates (`PYTHON=.venv/bin/python npm run lint`, `format:check`, `typecheck`, `test`) after final edits: all passed (Gateway Jest 37/37, Web Vitest 1/1, Checker Pytest 23/23, `mypy --strict` clean on 10 source files).

---

## 2026-11-24 — Add Checker Dataset CLI, Non-Root Dockerfile, and Offline MODEL_OFF=1 Verification (K3) (Huỳnh Đăng Khoa)

- **Tool**: Antigravity.
- **Asked for**: Implement a single-command dataset CLI (`checker/src/cli.py`), non-root pinned `Dockerfile`, and `MODEL_OFF=1` offline mode on branch `feat/checker-cli-eval`, updating `README.md` with CLI and Docker instructions.
- **Kept**:
  - Added `checker/src/cli.py` and `checker/src/__main__.py` accepting `--data` (or positional path), `-o/--output`, `--call-log`, `--model`, `--timeout`, `--delay-ms`, and `MODEL_OFF=1`, reading only `problems/<id>/statement.md`, `problems/<id>/constraints.json`, and `solutions/<id>/*.cpp` (never `labels.jsonl`).
  - Added `checker/tests/test_cli.py` (3 offline tests written before `cli.py`).
  - Added `checker/Dockerfile` pinned to `python:3.12-slim-bookworm`, running as non-root `USER 10001:10001`, with `checker/.dockerignore` excluding caches, tests, and `.env*`.
  - Documented local CLI, Docker build, `docker run --network none` with `MODEL_OFF=1`, and `eval.mjs` verification in `README.md`.
- **Changed**:
  - Supported both file output (`--output`) and stdout streaming in `checker/src/cli.py` so `docker run ... -v /path:/data:ro` works cleanly even when the host dataset mount is read-only and the container runs as non-root `10001:10001`.
- **Rejected**:
  - Rejected using `:latest` base image or running container as `root`, and rejected baking `.env` or `GEMINI_API_KEY` into the Docker image (enforced via `.dockerignore` and `docs/engineering-rules.md` checks).
- **Validation**:
  - Verified test-first red run on `checker/tests/test_cli.py` before creating `checker/src/cli.py`.
  - Built `leetkob-checker:pa3` and ran `docker run --rm --network none --memory 512m --pids-limit 64 -e MODEL_OFF=1 -v "$(pwd)/leetkob-eval:/data:ro" leetkob-checker:pa3 --data /data`, scored by `node leetkob-eval/eval.mjs`: 0 wrongful deductions, 15/15 ban-list violations caught, 47/47 semantic pairs `unsure` (exit code `1`, zero schema errors).
  - Ran all four canonical quality gates (`PYTHON=.venv/bin/python npm run lint`, `format:check`, `typecheck`, `test`): all passed (Gateway Jest 37/37, Web Vitest 1/1, Checker Pytest 26/26, `mypy --strict` clean on 13 source files).

---

## 2026-11-24 — Commit Real-Model Dev-Set Eval Run and 80-Submission Cost Arithmetic (K3) (Huỳnh Đăng Khoa)

- **Tool**: Antigravity (CLI orchestration) + Gemini API (`gemini-3.1-flash-lite` via `gemini-3.1-flash-lite-preview`).
- **Asked for**: Record the real Gemini API dev-set run (`predictions.jsonl`, `eval.mjs` report/summary, and `call-log.jsonl` with real provider request IDs), compute the 80-submission lab cost arithmetic in `README.md` and `AI-LOG.md`, commit the evidence, push `feat/checker-cli-eval`, and update `TASK-08` on the tracking sheet.
- **Model & Cost Arithmetic**:
  - **Model used**: `gemini-3.1-flash-lite` (`gemini-3.1-flash-lite-preview`), free tier (`GEMINI_API_KEY` loaded from gitignored `.env` into shell env only).
  - **Measured across `32` `OK` semantic calls (`39` semantic calls attempted; `8` `reverse-recursive` solutions decided 100% by AST hard rules with `0` LLM calls)**: `27,308` input tokens (`853.375` avg/call) and `3,911` output tokens (`122.219` avg/call).
  - **Actual free-tier spend**: `$0.00`.
  - **Estimated paid-tier equivalent** (`$0.10 / 1M` input, `$0.40 / 1M` output): `$0.0042952` for the `32` `OK` calls (`$0.000134225` per semantic submission). Scaled to **1 lab of 80 Accepted submissions** (assuming all 80 require an LLM semantic check): `80 × (27,308 / 32) = 68,270` input tokens (`$0.006827`) + `80 × (3,911 / 32) = 9,777.5` output tokens (`$0.003911`) = **`$0.010738` (~`$0.011 USD` per lab)**.
- **Kept**:
  - Committed the exact run artifacts from `docs/evidence/pa3-real-run/` (`predictions.jsonl`, `call-log.jsonl`, `eval-report.txt`, `eval-summary.json`), reporting `wrongful = 0`, `recall = 86.5% (32/37)`, `unsure = 6.9% (7/102)`.
  - Verified all `32` `OK` entries in `call-log.jsonl` carry real provider `requestId` values (e.g., `FlEFa7y8EO231e8Pj7aXoQg`), and `0` prompts contain comments (`//`, `/*`) or hard-rule ban-list constraints (`reverse-recursive` had `0` calls).
- **Changed**:
  - Updated `README.md` Section 7 with the exact dev-set real-run folder, reported metrics, and 80-submission cost calculation (separating `$0.00` free-tier actual spend from paid-tier estimates).
- **Rejected**:
  - Rejected cherry-picking or manually editing `predictions.jsonl` / `eval-report.txt` after the command was pasted twice and the second run hit `5 PROVIDER_ERROR` + `2 TIMEOUT` burst failures on the free tier; kept the actual files on disk and verified that guardrails safely routed all 7 failed calls to `unsure` with `0` wrongful deductions (detected by inspecting `statuses` and `requestId` counts in `call-log.jsonl`).
- **Validation**:
  - Re-scored `docs/evidence/pa3-real-run/predictions.jsonl` with `node leetkob-eval/eval.mjs` (`exit 1` in PA#3, matching `0` wrongful, `86.5%` recall, `6.9%` unsure) and verified `eval.mjs`/`labels.jsonl` SHA-256 prefixes remain unmodified (`c836edd8713521bb`, `262cda7b0ef5612e`).
  - Re-ran all four canonical quality gates (`PYTHON=.venv/bin/python npm run lint`, `format:check`, `typecheck`, `test`): all passed.

## 2026-11-24 — Add standardized workspace skills directory under .agents/skills/ (Phạm An Ninh)

- **Tool**: Antigravity.
- **Asked for**: Create a properly structured workspace skills directory for the team based on the proposal and PA#3 rubric.
- **Kept**: Created `.agents/skills/README.md` and five progressive-disclosure skills (`feature-workflow`, `post-task-handover`, `checker-eval-runner`, `sandbox-security-audit`, `checkpoint-packaging`), each with standard YAML frontmatter (`name`, `description`) and actionable verification steps.
- **Changed**: Followed Antigravity's `.agents/skills/<skill-name>/SKILL.md` discovery convention so all three team members automatically inherit the skills upon pulling the repo without bloating `AGENTS.md`.
- **Rejected**: Duplicating general coding conventions inside skill files or packing empty placeholder `scripts/`/`examples/` folders with no content.
- **Validation**: Verified directory tree, YAML frontmatter, and `git status` on branch `chore/add-workspace-skills`. Documentation/skills-only change.

---

## 2026-11-26 — Design and implement PA#3 Frontend UI (`web/`) and plan doc (`docs/web-ui-plan.md`) (Phạm An Ninh)

- **Tool**: Antigravity.
- **Asked for**: Audit `gateway/`, `web/`, proposal, FAQ, and PA#3 rubric; document the frontend UI plan in `docs/web-ui-plan.md` strictly following the documentation rules (`Brief > FAQ > Proposal > engineering-rules.md`); and build the `web/` frontend covering Admin, TA, and Student PA#3 flows with a shared `MockApiClient` / `HttpApiClient` interface preserving FAQ privacy boundaries.
- **Kept**:
  - Created `docs/web-ui-plan.md` mapping all roles/screens across PA#3–PA#5, wireframes + 5 UI states, Modern Web Guidance principles, and 9 backend API alignment items.
  - Restored Vite 5 entry files (`web/index.html`, `web/src/main.tsx`), fixed `web/package.json` build script (`tsc --noEmit && vite build`), and configured `/api` dev proxy in `web/vite.config.ts` with zero new npm packages.
  - Implemented shared TypeScript domain types (`web/src/types/`), unified `LeeTkobApiClient` interface (`MockApiClient` with 5 PA#3 demo accounts + `HttpApiClient` with Bearer JWT, `Idempotency-Key`, and RFC 9457 parsing), role/class-ownership routing, `SafeMarkdown` (no `dangerouslySetInnerHTML`), `CodeViewer` preserving exact 1-based line numbers, Admin classes page, TA 4-step lab creation page, Student C++17 submission/tracking page, and TA 3-column Review Queue page.
  - Enforced `FAQ-02` and `FAQ-08` / Syllabus Rule in both TypeScript types and `MockApiClient`: before Publish, Student endpoints strip all test I/O and all constraint verdicts/evidence/`unsureReason`/deductions, and TA LLM flags have no "Approve All" action.
  - Updated `README.md` and `.env.example` (empty variable names only, zero secrets).
- **Changed**:
  - Separated `SubmissionPipelineStatus` (`QUEUED | JUDGING | COMPLETED | JUDGE_ERROR`) from `JudgeVerdict` (`AC | WA | TLE | MLE | RE | CE`), added `errors[]` RFC 9457 field validation support, and added cursor pagination (`PaginatedResponse<T>`) per documentation rules rather than mirroring legacy drifted types in `gateway/src/submissions/submissions.types.ts`.
  - Tightened three overly broad Testing Library queries in `web/src/App.spec.tsx` (`getByRole('textbox', ...)`, `await waitFor(...)` for async TA detail panel, exact `getByText('sub_101')`) without weakening any privacy or authorization assertions.
- **Rejected**:
  - Adding third-party routing/Markdown npm packages (Tier-2) when zero-dependency History API routing and React-node Markdown rendering satisfy PA#3 cleanly without XSS risk.
  - Exposing hidden test cases or pre-publish checker verdicts in Student mock payloads or hiding them only with CSS.
- **Validation**: Ran all four canonical root commands (`npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run test` covering `gateway` 37 Jest tests, `web` 8 Vitest tests including negative privacy assertions, and `checker` Pytest) plus `npm run build --workspace=web` offline on branch `feat/web-pa3-ui`.

---

## 2026-11-27 — Audit and harden PostgreSQL schema, migrations, worker outbox, and Docker packaging (`feat/database-hardening`) (Phạm An Ninh)

- **Tool**: Antigravity.
- **Asked for**: Review the database design and configuration on `origin/feat/auth_and_labs` against project docs/rules (`AGENTS.md`, `docs/engineering-rules.md`, `PA3_rubric.md`, `FAQ.md`, `docs/contract/checker-output.md`), document findings and a remediation plan in `docs/database-plan.md`, and implement the approved fixes on a new branch.
- **Kept**:
  - Merged `origin/feat/auth_and_labs` cleanly onto `feat/database-hardening` (branched from `main`) and preserved dual-mode in-memory fallback for 100% offline unit/contract tests.
  - Replaced runtime `CREATE TABLE` + auto-seeding in `onModuleInit()` with explicit paired SQL migrations (`gateway/migrations/0001_init_pa3_schema.up.sql` and `.down.sql`, `SET lock_timeout = '2s'`), migration CLI (`db:migrate`, `db:migrate:down`), and guarded demo seed CLI (`db:seed:demo`, blocked in production unless `ALLOW_DEMO_SEED=true`).
  - Normalized the PostgreSQL 16 schema to 14 tables with full `FOREIGN KEY`, `CHECK`, `UNIQUE`, integer `deduction_centipoints` (`0..1000`), SQL-level `is_hidden = FALSE` filtering in `getStudentLab()`, Partial Unique Index `uniq_submissions_counting` (`FAQ-04`), 9 query-driven indexes, and full `constraint_findings` / `model_call_logs` / `audit_logs` tables aligned with `docs/contract/checker-output.md`.
  - Fixed the `is_counting` concurrency race via per-student `pg_advisory_xact_lock`, added 3-phase worker outbox methods (`claimNextJob` with `FOR UPDATE SKIP LOCKED`, `requeueStaleJobs`, `recordJobFailure` with retry/backoff & terminal `JUDGE_ERROR`, idempotent `recordJudgeResult` & `recordCheckerResult` with `UNIQUE (submission_id, request_id)` and automatic `FAQ-10` 10% `pass` sampling), added `statement` to `SubmissionJob` for `checker/`, eliminated the $N+1$ query in `getAllLabs()` via `ANY($1::text[])` batching, converted `saveLab()` to non-destructive upserts (`ON CONFLICT (id) DO UPDATE`) so `constraint_findings` are never cascade-deleted, added D2 read/review/publish methods (`getSubmissionTestResults`, `listStudentSubmissions`, `listLabReviewQueue`, `reviewConstraintFinding` with DB-enforced `FAQ-09` `ta_evidence` check, `publishLabAtomic`), added startup config validation (`gateway/src/common/config.ts`), upgraded `GET /health` to verify `SELECT 1` (`503` on DB failure), created multi-stage non-root `gateway/Dockerfile`, fixed `.dockerignore`, and added the one-shot `gateway-migrate` service to `docker-compose.yml`.
- **Changed**:
  - Kept `idempotency_records` `PRIMARY KEY (student_id, idempotency_key)` with `lab_id REFERENCES labs(id)` and per-student advisory lock after verifying PA#2 regression test `gateway/test/submission-boundaries.contract.spec.ts` explicitly requires cross-lab reuse of the same key by the same student to return `409 idempotency-conflict`.
  - Removed obsolete `MONGODB_URI=` from `.env.example` and removed deprecated `gateway/src/persistence/schema.ts`.
- **Rejected**:
  - Keeping auto-DDL or weak demo password seeding inside `onModuleInit()` (violates Session 04/08 separate migrations and production security hygiene).
  - Storing lab deductions/scores as floating-point columns or keeping hidden test cases embedded in a `labs.test_cases` JSONB blob.
- **Validation**: Ran `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run test` (all Gateway Jest suites including new `database-hardening.spec.ts`, Web Vitest, and Checker Pytest), and `npm run build --workspace=gateway` offline on branch `feat/database-hardening`.

---

## 2026-11-28 — Implement Student Results, TA Review Queue, and Publish Gate API (Task D2) (Nguyễn Nhật Duy)

- **Tool**: Antigravity.
- **Asked for**: Write the Task D2 API contract (`docs/contract/reviews-and-results.md`) first, then implement D2.1–D2.3 Gateway endpoints (student-safe submission results enforcing Syllabus Rule before/after Publish, TA review queue with 100% violation/unsure + `ceil(10%)` pass sampling on counted AC submissions, single-submission TA inspection, TA review decision with mandatory evidence on violation, and Publish gate rejecting before deadline or while `PENDING_REVIEW` items remain) and contract tests on branch `feat/review_and_results`.
- **Kept**:
  - `docs/contract/reviews-and-results.md`: Contract-first specification aligned with RFC 9457, `docs/contract/checker-output.md`, and `FAQ-02`, `FAQ-04`, `FAQ-08`, `FAQ-09`, `FAQ-10`, `FAQ-11`, `FAQ-12`.
  - `gateway/src/persistence/postgres.store.ts` & `gateway/src/submissions/submissions.store.ts`: Added `listLabSubmissions` / `listLabSubmissionsAsync`, `getSubmissionFindingsAsync`, and `publishLabAtomicAsync` (dual-mode PostgreSQL + in-memory).
  - `gateway/src/submissions/submissions.service.ts` & `submissions.controller.ts`: Implemented six D2 endpoints (`GET /labs/:labId/submissions`, `GET /labs/:labId/submissions/:submissionId`, `GET /labs/:labId/review-queue`, `GET /labs/:labId/submissions/:submissionId/review`, `PATCH /labs/:labId/submissions/:submissionId/findings/:findingId`, `POST /labs/:labId/publish`) with class-ownership checks and Syllabus Rule DTO sanitization.
  - `gateway/test/reviews-and-results.contract.spec.ts`: Contract tests covering pre-Publish redaction, IDOR `403`, cross-class TA `403`, `ceil(10%)` pass sampling, `400` on `VIOLATION` without evidence, `409` on early/unreviewed Publish, idempotent Publish, and post-Publish `finalScore` calculation.
- **Changed**:
  - Kept `PostgresPersistence.publishLabAtomic` SQL query order intact so existing `database-hardening.spec.ts` mock-pool assertions continue to pass without touching existing tests, while adding in-memory parity in `SubmissionStore.publishLabAtomicAsync`.
  - Explicitly gated `proposedDeduction` in TA review queue responses to `configuredDeduction` only when `verdict === 'violation'` (and `0` for `unsure`/`pass`) per `FAQ-11`.
- **Rejected**:
  - Rejected exposing raw checker `findings`, `evidence`, `unsureReason`, `DISMISSED_PASS`, or `isSampledPass` to student responses (enforcing PA#3 Syllabus Rule and `FAQ-08`).
  - Rejected weakening or modifying any existing PA#2/PA#3 contract tests (`submissions.contract.spec.ts`, `database-hardening.spec.ts`).
  - Deferred `web/` UI changes so frontend work stays separate from backend API commits.
- **Validation**:
  - Ran `npm run lint`, `npm run format:check`, `npm run typecheck`, and `npm run test` across `gateway` and `web`: all passed (`gateway` Jest 8/8 suites, 85/85 tests; `web` Vitest 1/1 file, 1/1 test; ESLint, Prettier, `tsc --noEmit` clean).

---

## 2026-11-28 — Add feature specification guidance from CSC13114 Session 02

- **Tool**: Codex.
- **Asked for**: Compare the Specifications for Agents lecture with `docs/engineering-rules.md` and add the guidance the document was missing.
- **Kept**: The Session 05 endpoint-contract rules and the existing submission API contract.
- **Changed**: Added the feature spec outline, the five areas to check during spec review, and the mapping from numbered acceptance criteria to tests. Used submission idempotency as a LeeTKOB example and checked it against the contract and the existing concurrency test.
- **Rejected**: Copying the restaurant example's endpoint and error format into LeeTKOB. Its API behavior is specific to the classroom example.
- **Validation**: Verified the eight spec sections, both Markdown links, and a clean `git diff --check`. Application tests were skipped for this documentation edit.

## 2026-11-28 — Sync PostgreSQL 16 migrations and Gateway persistence with `checker/`, FAQ, and Proposal (Phạm An Ninh)

- **Tool**: Antigravity.
- **Asked for**: Audit `gateway/migrations/0001_init_pa3_schema.{up,down}.sql` and `gateway/src/persistence/` against the merged `checker/` implementation (`models.py`, `hard_rules.py`, `sanitizer.py`, `guardrails.py`, `llm_client.py`, `semantic_checker.py`), `docs/contract/checker-output.md`, `docs/proposal/FAQ.md` (`FAQ-01`..`FAQ-14`), and `docs/proposal/proposal-detail.md` (§2, §4.2), document discrepancies in `docs/database-checker-sync-plan.md`, and apply the approved Option 1 consolidation directly into `0001_init_pa3_schema`.
- **Kept**:
  - Updated `gateway/migrations/0001_init_pa3_schema.up.sql` & `.down.sql` to 16 normalized tables with `SET lock_timeout = '2s'` and strict reverse-FK drops.
  - Fixed a critical `model_call_logs` crash bug where `TIMEOUT` / `PROVIDER_ERROR` calls emit empty `request_id` (`""`) in `checker/src/semantic_checker.py`: replaced `CHECK (btrim(request_id) <> '')` with `CHECK (status <> 'OK' OR btrim(request_id) <> '')`, added `call_ordinal` (`UNIQUE (submission_id, call_ordinal)`), `prompt_version`, `raw_response`, and partial unique index `uniq_model_call_logs_req_id` when `request_id <> ''`.
  - Preserved top-level `CheckerResult` metadata (`checker_model`, `prompt_version`, `checked_at`) and added manual grade override columns (`manual_score_centipoints`, `manual_score_reason`, `manual_scored_by`, `manual_scored_at`) plus `UNIQUE (student_id, lab_id, idempotency_key)` on `submissions`.
  - Added DB-level `CHECK` constraints on `constraint_findings` requiring non-empty `evidence` when `verdict = 'violation'` and synchronizing `review_status` with `ta_decision`, added `lab_id` with composite `FOREIGN KEY (lab_id, constraint_code)` and `idx_findings_lab_review`, and aligned `lab_constraints.check_type` with `'HARD_RULE' | 'LLM' | 'SEMANTIC_LLM'`.
  - Added `classes.invite_code` (`FAQ-01`), `labs.constraints_updated_at` & `lab_constraint_revisions` (`FAQ-07` non-increasing deduction check), and `grade_appeals` (`FAQ-13`/`FAQ-14` `UNIQUE (finding_id)` and mandatory TA resolution reason) with `idx_appeals_lab_status`.
  - Added `studentIdentifiers` to `SubmissionJob` (`buildSubmissionJob`, `createSubmissionAtomic`, `SubmissionStore`) for `checker/src/sanitizer.py` prompt redaction (`FAQ-06`), and extracted reusable `rebalanceLabPassSample()` called from `recordCheckerResult()`, non-AC `recordJudgeResult()`, and `publishLabAtomic()` (`FAQ-02`, `FAQ-10`).
  - Synced `docs/contract/auth-and-labs.md` (§6.1–§6.2) and `docs/database-plan.md`, and expanded `gateway/test/database-hardening.spec.ts`.
- **Changed**:
  - Kept `idempotency_records` `PRIMARY KEY (student_id, idempotency_key)` unchanged so cross-lab `Idempotency-Key` reuse continues returning `409 idempotency-conflict` per PA#2 regression test `gateway/test/submission-boundaries.contract.spec.ts`.
- **Rejected**:
  - Splitting the pre-deployment alignment into a `0002` `ALTER TABLE` migration after the user explicitly approved Option 1 (single clean `0001_init_pa3_schema` before PA#3 server deployment).
  - Weakening `CHECK (status <> 'OK' OR btrim(request_id) <> '')` to drop `request_id` enforcement on `OK` calls (PA#3 Criterion 4 still requires real provider request IDs for every successful model call).
- **Validation**:
  - Ran all four canonical quality gates plus Gateway e2e and NestJS build offline: `npm run lint` (0 errors/warnings across Gateway, Web, Checker), `npm run format:check` (all clean), `npm run typecheck` (`tsc --noEmit` + `mypy` 13 files clean), `npm run test` (Gateway Jest 7 suites / 82 tests, Web Vitest 2 suites / 8 tests, Checker Pytest 26 tests = 116 passed), `npm run test:e2e --workspace=gateway` (1/1 passed), and `npm run build --workspace=gateway` (exit 0).

---

## 2026-11-28 — Implement Task N1: Durable PostgreSQL Queue, Standalone Judge Worker & Internal Checker HTTP Bridge (Phạm An Ninh)

- **Tool**: Antigravity.
- **Asked for**: Implement Task N1 (`pa3-team-tasks.md`) on branch `feat/judge-queue-worker`: agree and document the internal job/result contract, build a standalone `judge/` worker consuming the PostgreSQL durable queue (`submission_jobs` via `FOR UPDATE SKIP LOCKED` + `LISTEN/NOTIFY` + stale-lease recovery), store overall and per-test verdicts, trigger the isolated internal `checker` service for `AC` submissions only, guarantee single-verdict/finding idempotency on redelivery, and provide stop → submit → restart verification tests and script.
- **Kept**:
  - Added internal contract [docs/contract/queue-and-judge.md](docs/contract/queue-and-judge.md) aligning Gateway, PostgreSQL 16 durable queue, `judge/`, and `checker/`.
  - Added stdlib HTTP server `checker/src/server.py` (`GET /health`, `POST /check` delegating to `check_submission()`) and 4 offline contract tests in `checker/tests/test_server.py` (0 new Python packages; CLI `python -m src` preserved).
  - Updated `gateway/src/persistence/postgres.store.ts` to emit `SELECT pg_notify('submission_jobs_ready', ...)` on enqueue and `AC` → `CHECK` stage promotion, and added `countLabModelCalls(labId)` with test coverage in `gateway/test/persistence-and-queue.spec.ts`.
  - Built standalone Node.js 22 + TypeScript workspace `judge/` (0 new npm packages — reusing pinned `pg`, `typescript`, `eslint`, `prettier`, `jest`, `ts-jest`):
    - `judge/src/config.ts`: startup config validation that refuses to start if `GEMINI_API_KEY`, `MODEL_API_KEY`, or `GOOGLE_API_KEY` is present in `judge-worker`'s environment (PA#3 Criterion 2 secret isolation).
    - `judge/src/sandbox/` (`runner.interface.ts`, `output-compare.ts`, `process-runner.ts`): pluggable `SandboxRunner` boundary for Task N2, `FAQ-05` output normalization, temporary path scrubbing in `compile_output`, and `FAQ-04` overall verdict calculation.
    - `judge/src/checker/checker-http.client.ts`: HTTP client calling internal `checker` with timeout/schema validation and fail-safe degradation to `unsure` (`TIMEOUT` / `PROVIDER_ERROR` / `SCHEMA_INVALID` per `FAQ-09`).
    - `judge/src/queue/job-store.ts` & `worker.ts` & `main.ts`: 3-phase short-transaction `PostgresJobStore` (`FOR UPDATE SKIP LOCKED`, `LISTEN submission_jobs_ready`, `ON CONFLICT DO UPDATE` idempotency, `rebalanceLabPassSample`), `InMemoryJobStore`, and `JudgeWorker` with graceful `SIGTERM`/`SIGINT` drain and lab LLM call cap (`MAX_LLM_CALLS_PER_LAB`).
    - 14 offline Jest tests across `judge/test/{output-compare,checker-client,worker-lifecycle}.spec.ts` proving stop → submit → restart durability, non-AC checker bypass, double-delivery single-verdict/finding idempotency, lab LLM call cap, and secret isolation.
  - Wired `judge` into root `package.json` workspaces, `package-lock.json`, `scripts/run-check.mjs` (all 4 canonical gates), `judge/Dockerfile`, `gateway/Dockerfile`, `docker-compose.yml` (`checker` + `judge-worker` with zero LLM keys in `judge-worker`), `.env.example` (empty variable names only), `README.md`, and `scripts/verify-n1-worker.mjs`.
- **Changed**:
  - Updated `gateway/Dockerfile` to copy `judge/package.json` alongside `gateway/package.json` and `web/package.json` so workspace `npm ci` remains in sync with the root `package-lock.json`.
  - Formatted workspace TypeScript files using each workspace's `.prettierrc` (`npx prettier --config <ws>/.prettierrc --write`) after root-level formatting flagged LF/config drift in `gateway/test/persistence-and-queue.spec.ts`.
- **Rejected**:
  - Passing `GEMINI_API_KEY` into `judge-worker` or calling Gemini directly from `judge/` (violates Criterion 2 secret isolation; isolated behind internal `checker/src/server.py` instead).
  - Adding an external message broker container (RabbitMQ) or new npm/Python packages when PostgreSQL 16 `FOR UPDATE SKIP LOCKED` + `LISTEN/NOTIFY` provides transactional outbox durability with zero dual-write risk and zero extra RAM.
- **Validation**:
  - Ran all four canonical root commands plus builds and e2e offline: `npm run lint` (Gateway, Web, Judge ESLint + Checker Ruff — 0 errors/warnings), `npm run format:check` (Gateway, Web, Judge Prettier + Checker Ruff Format 15 files clean), `npm run typecheck` (`tsc --noEmit` on Gateway/Web/Judge + `mypy --strict` on 15 Checker files clean), `npm run test` (Gateway Jest 7 suites / 82 tests, Web Vitest 2 suites / 8 tests, Judge Jest 3 suites / 14 tests, Checker Pytest 30 tests = **134 passed**), `npm run build --workspace=judge`, `npm run build --workspace=gateway`, and `npm run test:e2e --workspace=gateway` (1/1 passed). Live Docker Compose verification (`node scripts/verify-n1-worker.mjs`) is ready to run whenever Docker Desktop is started.

---

## 2026-11-28 — Implement Task N2: Hardened C++17 Docker Sandbox (9 Minimums), Attack Suite & `pa3` Tag CI (Phạm An Ninh)

- **Tool**: Antigravity.
- **Asked for**: Implement Task N2 (`pa3-team-tasks.md`) on branch `feat/n2-cpp-sandbox-ci`: compile and execute untrusted C++17 code inside isolated Docker containers enforcing all 9 PA#3 Criterion 2 minimums, add all 9 rubric attack `.cpp` submissions with expected assertions, configure `.github/workflows/ci.yml` to run the Docker sandbox suite on `pull_request`, `main`, and tag `pa3` with a 9-row CI summary table while keeping the 4 README quality gate commands 100% offline, and isolate Docker daemon access for `judge-worker` via `docker-socket-proxy`.
- **Kept**:
  - Created 11 C++17 test programs under `judge/attacks/`: `00_sanity_ac.cpp` (AC sanity check) + all 9 rubric attacks (`01_network_egress.cpp`, `02_cpu_time_limit.cpp`, `03_wall_clock_container_kill.cpp`, `04_memory_no_swap_readback.cpp` with mandatory volatile read-back pass, `05_fork_bomb_pids.cpp`, `06_output_flood.cpp`, `07_non_root_uid.cpp`, `08_no_host_mount_or_docker_sock.cpp`, `09a_no_secrets_env_and_files.cpp`, `09b_no_secrets_include.cpp`).
  - Built isolated sandbox image `judge/sandbox/Dockerfile` (`gcc:12.4.0-bookworm`, `USER 65534:65534`) with C entrypoint `judge/sandbox/sandbox-exec.c` (`compile` & `run` modes streaming code, compiled ELF binary, and test input over `stdin` into bounded `--tmpfs /tmp` — **zero host mounts**, zero repository files, `RLIMIT_CPU`/`RLIMIT_FSIZE`/`RLIMIT_CORE`, and descendant reaping so orphan sleeping children keep the container alive until wall-clock `docker rm -f`).
  - Implemented `DockerSandboxRunner` (`judge/src/sandbox/docker-runner.ts`) enforcing `--network none`, `--read-only`, `--tmpfs`, `--user 65534:65534`, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--memory=<M>m --memory-swap=<M>m`, `--pids-limit 16`, `--cpus 1`, wall-clock container kill (`docker rm -f`), `State.OOMKilled` inspection -> `MLE`, and sanitized CLI env. Wired `SANDBOX_MODE=docker` (default) into `judge/src/config.ts` and `judge/src/main.ts`.
  - Added 5 offline unit specs in `judge/test/docker-runner.spec.ts` and real Docker runner script `judge/scripts/run-sandbox-suite.mjs` emitting a 9-row Markdown summary table to stdout and `$GITHUB_STEP_SUMMARY`.
  - Updated `judge/Dockerfile` (multi-stage copying static `docker:27.5.1-cli`), `docker-compose.yml` (internal `tecnativa/docker-socket-proxy:0.3.0` on `sandbox_ctrl` network with `CONTAINERS=1, VOLUMES=0, EXEC=0, SECRETS=0`), `.github/workflows/ci.yml` (`tags: [pa2, pa3]`, `permissions: { contents: read }`, keeping `Quality Gate (Lint, Format, Typecheck, Test)` intact and adding `Sandbox Security Suite (9 Minimums — Docker)`), `.env.example`, and `README.md`.
- **Changed**:
  - Refined Row 2 (`02_cpu_time_limit.cpp`) assertion in `judge/scripts/run-sandbox-suite.mjs` after the first real Docker run measured `3220ms` total (compile + run) to assert specifically on the execution phase `res.testResults[0].timeMs < 4000` (vs `5s` wall-clock), preventing CI flakiness on slower compile runners while still proving `RLIMIT_CPU` fired before wall-clock.
  - Changed `sandbox-exec.c` from direct `execve` as PID 1 to a minimal PID 1 wrapper (`fork` + `waitpid(-1)` loop) after analyzing Linux PID-1 exit semantics: when Row 3's parent calls `_exit(0)` after forking a sleeping child, a minimal PID 1 keeps the container alive so the runner genuinely proves wall-clock `docker rm -f` kills the entire container.
- **Rejected**:
  - Using `-v /tmp/...:/work` host bind mounts to pass `solution.cpp` into the sandbox (violates Criterion 2 Row 8 "no host mounts" and breaks sibling containers); replaced with zero-mount `stdin` framing into `--tmpfs`.
  - Exposing raw `/var/run/docker.sock` directly to `judge-worker` or sandbox containers; routed `judge-worker` through an internal narrow-privilege `docker-socket-proxy` while sandbox containers receive zero mounts and zero sockets.
- **Validation**:
  - Offline canonical gates: `npm run lint` (0 errors/warnings across all 4 services), `npm run format:check` (all clean), `npm run typecheck` (3 TS workspaces + `mypy --strict` 15 Python files), `npm run test` (Gateway 82 Jest + Web 8 Vitest + Judge 19 Jest + Checker 30 Pytest = **139 passed**), `npm run build --workspace=judge`, `npm run build --workspace=gateway`, and red-flag grep scan (0 matches).
  - Real Docker verification (`npm run sandbox:build --workspace=judge` & `npm run test:sandbox --workspace=judge` on local Docker Desktop): `00_sanity_ac.cpp` -> `AC`, and **9/9 rubric attack rows PASSED** (`1=RE/0 canary hits`, `2=TLE via RLIMIT_CPU`, `3=TLE/0 lingering containers`, `4=MLE via OOMKilled`, `5=RE/0 lingering`, `6=RE`, `7=RE`, `8=RE`, `9a=RE & 9b=CE/0 canary leaks`).

## 2026-11-28 — Add a skill for writing API contracts and contract tests

- **Tool**: Codex.
- **Asked for**: Combine the IA#3 CONTRACT.md, the applicable rubric, and LeeTKOB engineering rules into a reusable skill and require it in AGENTS.md.
- **Kept**: The LeeTKOB submission contract's own authorization and replay behavior.
- **Changed**: Added the five-section HTTP outline, a separate path for internal payloads, and a test workflow that checks both responses and persisted outcomes. Registered the skill in the repo catalog and AGENTS.md.
- **Rejected**: Copying the IA#3 menu service's status codes and replay headers into LeeTKOB. These details belong to each endpoint's approved contract.
- **Validation**: The skill-creator validator passed. Verified the five IA#3 sections, ten links, and the submission examples against the existing contract and test sources. Application tests were skipped for this documentation-only change.

---

## 2026-11-28 — Complete Task D1: Sync Web HTTP Client with Gateway Auth, Classes, Labs & Trackable Submissions (Phạm An Ninh)

- **Tool**: Antigravity.
- **Asked for**: Audit Task D1 (`pa3-team-tasks.md`) against current code/docs and complete the remaining ~30% so `web/` (`VITE_API_MODE=http`) works end-to-end against `gateway/` (on top of PR #22 `feat/review_and_results`), including demo login by `username` or `email`, `GET /auth/me`, `GET/POST /classes`, `GET/POST /classes/:classId/labs`, `GET /submissions/:submissionId`, CORS headers, official `sort-merge` acceptance test, and contract updates per `write-api-contract`.
- **Kept**:
  - Updated [docs/contract/auth-and-labs.md](docs/contract/auth-and-labs.md) following `.agents/skills/write-api-contract/SKILL.md` to specify `POST /auth/login` (`username` or `email`), `GET /auth/me`, `GET/POST /classes`, `GET/POST /classes/{classId}/labs`, cursor pagination, and role visibility while preserving 100% backward compatibility for `POST /labs`, `GET /labs`, and `GET /labs/{labId}`.
  - Added `GET /auth/me`, email-or-username login in `gateway/src/auth/`, `ClassesModule` (`GET /classes`, `POST /classes`, `GET /classes/:classId/labs`, `POST /classes/:classId/labs` with opaque Base64URL cursor pagination and PostgreSQL summary queries `listClassSummariesForUser` + `createClass`), `GET /submissions/:submissionId` delegating to D2's student/TA visibility services, and configurable CORS (`CORS_ORIGINS`) exposing `Location` and `Idempotency-Key` in `gateway/src/configure-app.ts` and `.env.example`.
  - Updated `web/src/api/http-client.ts` (full two-way DTO adapter for auth, classes, labs, submissions, and TA review queue), `web/src/pages/LoginPage.tsx` (accepting email or username), `web/src/pages/ta/TaCreateLabPage.tsx` (aligning default `C1`/`C2` constraint wording with `checker/src/hard_rules.py` backtick convention and deductions `3`/`4`), and added `web/src/api/http-client.spec.ts` (3 Vitest tests).
  - Added `gateway/test/d1-acceptance.contract.spec.ts` (3 Jest tests) verifying official `leetkob-eval/problems/sort-merge` creation, trackable `Location` + `GET /submissions/:id`, identical `Idempotency-Key` replay, cross-class TA `403`, and `ADMIN`/`TA`/`STUDENT` class scoping.
  - Also resolved the `AI-LOG.md` merge conflict on PR #22 (`feat/review_and_results`, commit `5a710e1`) by merging `origin/main` so `feat/d1-web-gateway-sync` stacks cleanly on top of D2 with zero conflicts.
- **Changed**:
  - Replaced placeholder `taIds: []` / `studentCount: 0` / `labCount: 0` / `new Date().toISOString()` in `gateway/src/classes/classes.store.ts` with a real PostgreSQL aggregate query `PostgresPersistence.listClassSummariesForUser` after reviewing cursor-pagination stability in PostgreSQL mode.
  - Wired `cursor` query forwarding in `HttpApiClient.listMySubmissions` after Web ESLint flagged unused `_cursor`.
- **Rejected**:
  - Adding `email` and `displayName` directly onto the `POST /auth/login` response `user` object (would break existing strict contract test `gateway/test/auth.contract.spec.ts`); served them via `GET /auth/me` instead.
  - Changing mock seed passwords in `web/src/api/mock-seed.ts` (would break existing UI test `web/src/App.spec.tsx`); kept mock seed intact while using real `scrypt` demo credentials for HTTP mode.
- **Validation**:
  - Ran all four canonical root quality gates plus builds and Gateway e2e offline: `npm run lint` (Gateway, Web, Judge ESLint + Checker Ruff — 0 errors/warnings), `npm run format:check` (all 4 services clean), `npm run typecheck` (Gateway, Web, Judge `tsc --noEmit` + Checker `mypy --strict` 15 files clean), `npm run test` (Gateway Jest 9 suites / **88 tests**, Web Vitest 2 suites / **9 tests**, Judge Jest 4 suites / **19 tests**, Checker Pytest **30 tests** = **146 passed**), `npm run build --workspace=gateway`, `npm run build --workspace=web`, and `npm run test:e2e --workspace=gateway` (1/1 passed).

---

## 2026-11-28 — Complete Task D2: PostgreSQL Publish Gate Fix, FAQ-10 Random Sampling, Audit Logs & Web TA Review / Student Published UI (Phạm An Ninh)

- **Tool**: Antigravity.
- **Asked for**: Audit Task D2 (`pa3-team-tasks.md`) against `main` (`e507d51`), `PA3_rubric.md`, `FAQ-02/03/04/08/09/10/11/12`, `checker-output.md`, and `.agents/skills/write-api-contract/SKILL.md`, and complete the remaining ~25% gaps across Contract, Gateway, PostgreSQL persistence, Judge worker, and Web UI.
- **Kept**:
  - Upgraded [docs/contract/reviews-and-results.md](docs/contract/reviews-and-results.md) to the 5-section IA#3 outline (`Conventions`, `Errors`, `Resources`, `Endpoints`, `Versions`) documenting `GET /submissions/{submissionId}`, full `POST /labs/{labId}/publish` refusal gates (`FAQ-03`/`FAQ-12`), post-publish TA modification `reason` rule, and additive UI metadata while preserving 100% backward compatibility.
  - Fixed a PostgreSQL publish-gate bug in `gateway/src/persistence/postgres.store.ts` (`publishLabAtomic`) and aligned `gateway/src/submissions/submissions.store.ts` so Publish rejects (`409 Conflict` + `ROLLBACK`) whenever any counted submission is unjudged (`pipeline_status <> 'COMPLETED'`) or any counted `AC` submission has `checker_status <> 'COMPLETED'`.
  - Updated `rebalanceLabPassSample` in `gateway/src/persistence/postgres.store.ts`, `gateway/src/submissions/submissions.store.ts`, and `judge/src/queue/job-store.ts` to select the `ceil(10%)` `pass` sample randomly (`ORDER BY RANDOM()` / cryptographic Fisher-Yates `randomInt` per `FAQ-10`).
  - Added `before_state` + `after_state` audit logging on TA finding reviews (`PostgresPersistence.reviewConstraintFinding` with `FOR UPDATE` + in-memory `SubmissionStore.auditLogs`), enforced non-empty `reason` when editing findings after Publish (`FAQ-12`), honored `manualScore` (`FAQ-04`), and added additive metadata (`studentName`, `labTitle`, `publishedAt`, `maxTimeMs`, `maxMemoryKb`, `submissionCount`, `pendingReviewCount`).
  - Completed `web/` interactive D2 experience in both `HttpApiClient` and `MockApiClient`: expanded `UnsureReason` to all 7 official `checker-output.md`/`FAQ-09` codes, added `listLabSubmissions`, `reviewFinding` (`PATCH`), and `publishLab` (`POST`), built per-finding TA decision/deduction/evidence form, direct submission lookup bar for live demo, and Publish action in `web/src/pages/ta/TaReviewQueuePage.tsx` (strictly keeping no "Approve All" button), and added post-publish official score & confirmed deductions display in `web/src/pages/student/StudentLabSolvePage.tsx`.
  - Added `AC2`–`AC7` tests across `gateway/test/reviews-and-results.contract.spec.ts`, `gateway/test/database-hardening.spec.ts`, `web/src/api/http-client.spec.ts`, and `web/src/App.spec.tsx`.
- **Changed**:
  - Kept `TaReviewQueuePage.tsx` initial UI dropdown default at `scope = 'all'` (while the API default remains `scope = 'counted'` with a 1-click toggle) after verifying `web/src/App.spec.tsx` asserts 3 demo submissions on initial render and PA#3 Criterion 1's demo submits 3 solutions from one student to the same lab.
  - Preserved legacy mock `UnsureReason` aliases alongside the 7 official `FAQ-09` codes in `web/src/types/review.ts` so existing offline UI specs remain green while HTTP mode renders exact backend codes without lossy mapping.
- **Rejected**:
  - Adding `code` to `GET /labs/:labId/submissions/:submissionId` to fix the empty student source modal in HTTP mode (would violate existing contract assertion `expect(res.body.code).toBeUndefined()` in `reviews-and-results.contract.spec.ts`); hid the modal button when `activeSub.code` is empty instead.
  - Adding any bulk "Approve All" button for LLM flags on `TaReviewQueuePage.tsx` (forbidden by PA#3 Syllabus Rule).
- **Validation**:
  - Ran all four canonical root quality gates plus all 3 TS workspace builds and Gateway e2e offline: `npm run lint` (0 errors/warnings across all 4 services), `npm run format:check` (all 4 services clean), `npm run typecheck` (Gateway, Web, Judge `tsc --noEmit` + Checker `mypy --strict` 15 files clean), `npm run test` (Gateway Jest 9 suites / **92 tests**, Web Vitest 2 suites / **11 tests**, Judge Jest 4 suites / **19 tests**, Checker Pytest **30 tests** = **152 passed**), `npm run build --workspace=gateway`, `npm run build --workspace=web`, `npm run build --workspace=judge`, and `npm run test:e2e --workspace=gateway` (1/1 passed).

---

## 2026-11-28 — Implement Task D3: Team-Authored Eval Dataset (`leetkob-eval-team/`) & Offline Integrity Tests (Phạm An Ninh)

- **Tool**: Antigravity.
- **Asked for**: Implement Task D3 (`pa3-team-tasks.md`) on branch `feat/d3-team-eval-cases`: create a separate team-authored eval dataset matching the `leetkob-eval/` layout (`problems/`, `solutions/`, `labels.jsonl`) with at least 5 genuinely Accepted C++17 solutions, accurate labels, tags, and evidence lines (including >=1 `trap` and >=1 `injection`), verify zero diff on the lecturer's `leetkob-eval/` files, and hand off for Khoa's Checker CLI run.
- **Kept**:
  - Created `leetkob-eval-team/` alongside `leetkob-eval/` with 2 brand-new unseen problems (`stack-brackets` and `kth-element`), 10 test pairs (`01..05.{in,out}` per problem), **8 Accepted C++17 solutions** (`16` `(solution, constraint)` pairs: `10 pass`, `6 violation`), `labels.jsonl`, and `leetkob-eval-team/README.md`:
    - Covers all 5 official `eval.mjs` tags (`obvious`, `disguised`, `trap`, `injection`, `style`), including **2 traps** (`my::stack` linked list + comment/string mentions; `<algorithm>` solely for `std::swap` + `custom::nth_element`) and **2 prompt injections** (comment + string literal injections disguising pair-erasure and full selection sort).
  - Added offline verification suite `checker/tests/test_team_dataset.py` (3 pytest tests) asserting SHA-256 integrity of `leetkob-eval/eval.mjs` (`c836edd8713521bb...`) and `leetkob-eval/labels.jsonl` (`262cda7b0ef5612e...`), team dataset schema/coverage, and `MODEL_OFF=1` hard-rule accuracy (`0` wrongful deductions, `100%` ban-list recall with exact line evidence).
  - Updated `README.md` §7 with CLI + `eval.mjs` commands for `leetkob-eval-team/` and marked Task D3 complete in `docs/task/pa3-team-tasks.md`.
- **Changed**:
  - Replaced initial `power-mod` problem idea with `stack-brackets` + `kth-element` during design review because `std::pow` overflows `double` on large modular exponents and would fail to compile/pass as an Accepted solution.
  - Corrected the pass/violation summary table count in `leetkob-eval-team/README.md` (`10 pass / 6 violation`, matching `eval.mjs` output) after running the unmodified scorer.
- **Rejected**:
  - Placing team-authored cases inside `leetkob-eval/` or editing `leetkob-eval/labels.jsonl` (strictly forbidden by PA#3 Criterion 6 and `AGENTS.md` §4.1 Tier 3).
- **Validation**:
  - Compiled all 8 `.cpp` files with `g++ -std=c++17 -O2 -Wall -Wextra -Werror` inside Docker (`leetkob-cpp-sandbox:pa3`, `--network none`) and ran all 40 test executions with token-by-token comparison (`8/8 Accepted`, 0 warnings).
  - Ran `MODEL_OFF=1 python -m src --data ../leetkob-eval-team` and scored with unmodified `node leetkob-eval/eval.mjs --data leetkob-eval-team`: `exit 1` (valid dataset/predictions, never `exit 2`), `0` wrongful deductions, `2/2` ban-list violations caught with exact line text (`stack-brackets/s03 C1` line 7, `kth-element/s03 C1` line 8), `0` false positives on traps, and `8/8` semantic pairs returned `unsure`.
  - Verified `git diff leetkob-eval/` is empty (`DEV_DIFF_LENGTH=0`) and SHA-256 hashes match byte-for-byte.
  - Ran all four canonical offline quality gates: `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run test` (**155/155 passed**: 92 Gateway + 11 Web + 19 Judge + 33 Checker).

---

## 2026-11-28 — Align All HTTP API Contracts with `write-api-contract` Skill (Phạm An Ninh)
- **Tool**: Antigravity.
- **Asked for**: Audit all implemented HTTP endpoints across `gateway/` and `checker/` against `docs/contract/` and `.agents/skills/write-api-contract/SKILL.md`, then standardize `docs/contract/auth-and-labs.md` and `docs/contract/post-submissions.md` to the exact 5-section IA#3 format with complete endpoint specifications.
- **Kept**:
  - Preserved 100% of existing endpoint behavior, status codes, RFC 9457 error `type` URIs, idempotency semantics, and the `#6-idempotency-specification` HTML anchor referenced by `docs/engineering-rules.md`.
  - Kept `reviews-and-results.md` (already 5-section IA#3), `checker-output.md`, and `queue-and-judge.md` (producer/consumer internal contracts) unchanged.
- **Changed**:
  - Restructured `docs/contract/auth-and-labs.md` into the 5-section IA#3 outline (`1. Conventions`, `2. Errors`, `3. Resources`, `4. Endpoints`, `5. Versions and the Legacy API`) and added full request/response specifications for `GET /health`, `GET /auth/me`, `GET/POST /classes`, `GET/POST /classes/{classId}/labs`, `email` login support, `409` duplicate class code, and `503` unhealthy DB probe.
  - Restructured `docs/contract/post-submissions.md` into the same 5-section IA#3 outline and updated Section 1 to accurately describe the PA#3 PostgreSQL 16 atomic transaction + `submission_jobs` outbox while preserving all PA#2 error URIs and idempotency guarantees.
- **Rejected**:
  - Altering any existing RFC 9457 error URI (`deadline-passed`, `idempotency-conflict`, `internal-server-error`) or modifying application/test code in this documentation-only alignment PR.
- **Validation**:
  - Audited all 17 Gateway controller routes + 2 Checker internal HTTP routes against all 5 files in `docs/contract/` (19/19 routes covered). Documentation-only change; verified `git diff` and internal markdown anchors.
