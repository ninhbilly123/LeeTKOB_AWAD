# LeeTKOB Engineering Rules (CSC13114 Course Standards)

This document consolidates the web engineering rules from CSC13114 Sessions 02–08 (Specifications for Agents, The Harness, Data, API Contracts, Security, Quality Gates, and Packaging & Release). Every team member and AI assistant must follow these rules when designing, coding, testing, and deploying LeeTKOB.

---

## 0. Feature Specifications (Session 02)

Source: CSC13114, *Specifications for Agents* (24 September 2026).

- Before implementation, turn the user story into a short spec that a teammate or assistant can implement from the document. Record the owner and status. Have a teammate read it, write down the questions they would need answered to implement it, and resolve those questions in the spec before coding.

| Spec section | What to record |
| --- | --- |
| Goal | The user outcome in one sentence. |
| Out of scope | Specific behavior or work this feature excludes. |
| Flow | The normal sequence of user and system actions. |
| Contract | The endpoints, payloads, status codes, or internal events the feature uses. Link to the detailed [endpoint contract](#3-api-contracts-session-05) where applicable. |
| Data | The tables or fields that change and the invariants that must hold. |
| Errors | What triggers each failure, what the caller sees, and what the system persists, rolls back, or retries. |
| Acceptance | Numbered criteria (`AC1`, `AC2`, …) with a concrete setup, action, and observable result. |
| Constraints | Applicable dependencies, schema or compatibility restrictions, budget, and deadline. |

- During spec review, check empty and first-run states, partial failure, roles and resource ownership, simultaneous or duplicate requests, and behavior at limits.
- Use each acceptance criterion's ID in its corresponding test name. Include observable state changes or invariants where they matter. For example, two concurrent submissions by the same student with the same valid `Idempotency-Key` and payload both return `201` with the same submission ID, and only one submission is stored. See the [submission contract](contract/post-submissions.md#6-idempotency-specification).

---

## 1. The Harness, Configuration & Environments (Session 03)

- **Rules File Discipline**: Keep `AGENTS.md` short, version-controlled, and structured in four sections (`Stack`, `Commands`, `Conventions`, `Never`). Every rule must earn its place from a real incident or project requirement.
- **Least Privilege & Three-Tier Permissions**:
  - Operate strictly within the three tiers in `AGENTS.md` (`Allowed`, `Ask First`, `Never`).
  - Scope every credential, DB role, and tool to the minimum privilege needed (e.g., expose narrow domain actions, never arbitrary SQL execution; use branches + reviewed PRs, never direct pushes to `main`).
- **Configuration & Secrets**:
  - One app, three environments (local, staging/CI, production): inject configuration and secrets strictly from the environment outside the image.
  - Read and validate all configuration **once at startup** into a single typed config object. Fail loudly on missing/invalid variables; **never** default a secret to a working fallback value.
  - Use `NODE_ENV` / explicit config rather than scattering `if (isDev)` checks across business logic.
  - `.env.example` is committed with **empty values**; `.env` is gitignored and never read/edited by assistants.
- **Reproducibility**: Pin runtime versions (Node 22, Python 3.12), commit lockfiles (`package-lock.json`, pinned `requirements-dev.txt`), and keep `README.md` accurate so a fresh clone gets green in one sequence.

---

## 2. Data Modelling, Transactions & Zero-Downtime Migrations (Session 04)

- **Database as the Final Enforcer**:
  - Enforce invariants in the database schema (`NOT NULL`, `CHECK`, `UNIQUE`, `FOREIGN KEY`). A check in application code is a suggestion; a schema constraint is a fact.
  - Store discrete/monetary units as **integers** in the smallest unit (never floating-point); convert only at API/UI edges.
- **Indexes**:
  - Create indexes for actual queries, never speculatively. Start from the query, order columns with equality filters first and range/sort columns last, and verify with `EXPLAIN ANALYZE` (`Index Scan`, not `Seq Scan`).
- **Transactions & Concurrency**:
  - Prevent lost updates at the database layer using atomic conditional updates (`UPDATE ... WHERE id = $1 AND status = 'pending'` + row-count check), `SELECT ... FOR UPDATE`, or `UNIQUE` constraints.
  - **Never** hold a database transaction open across network calls (LLM API, email, external webhooks) or user waits. Pattern: claim/mark row in a short transaction → perform external call → record result in a second transaction (and handle half-finished failure states).
- **Zero-Downtime Migrations (Expand → Migrate → Contract)**:
  - Old and new code overlap during deployment; every migration step must be compatible with both. Never rename or drop an active column in one step.
  - Run **expand** migrations before deploying code that uses new columns; run **contract** migrations only after all instances stop using old columns.
  - Backfill in small, idempotent, re-runnable batches (short transactions) only after no running instance writes the old column alone.
  - **PostgreSQL Lock Safety**: set `lock_timeout = '2s'` in every migration; add nullable columns without volatile defaults; use `CREATE INDEX CONCURRENTLY`; add constraints with `NOT VALID` → `VALIDATE CONSTRAINT` before `SET NOT NULL`.
  - Every `.up.sql` must have a `.down.sql` (or an explicit note explaining why it is irreversible). Review every migration PR for: *what it locks, for how long, and what currently running code expects*.
- **Backup & Restore**: Define RPO/RTO, take a backup before every contract migration step, and verify restores on a fresh database (an untested backup is only a hope).

---

## 3. API Contracts (Session 05)

- **Contract First**: Write and review the contract (`docs/contract/<endpoint>.md`) *before* implementation. If a contract test fails, fix the code — never loosen the test or silently drift from the contract.
- **Per-Endpoint Completeness**: Pin down request method/path/headers/body field rules, all response statuses/headers/bodies, complete error catalog, pagination rules (for lists), idempotency rules (for creates/publishes), and versioning policy.
- **Single Error Model (RFC 9457)**:
  - All HTTP errors return `Content-Type: application/problem+json` with `type`, `title`, `status`, `detail`, and `instance` (plus optional `errors[]` listing *every* invalid field, not only the first).
  - Clients branch on `type`, never on `title` or `detail`.
  - `500 Internal Server Error` must **never** expose SQL errors, table/column names, internal IPs, file paths, or stack traces. Return a fixed safe message and log the stack internally with a request ID.
- **Cursor Pagination**:
  - Use opaque **cursor pagination** (not `OFFSET`) for lists that change over time.
  - Fetch `limit + 1` rows so `nextCursor` is `null` if and only if no rows remain.
  - Use a unique, indexed sort key such as `(created_at, id)` — never `created_at` alone. Document default/max page size, sort order, and invalid-cursor `400` behavior.
- **Idempotency**:
  - `POST` and `PATCH` are not idempotent unless explicitly designed with `Idempotency-Key`.
  - In production, persist idempotency keys in the database (not an in-memory `Map`) inside the **same transaction** as the created resource, guarded by `PRIMARY KEY`/`UNIQUE`.
  - Same key + same canonical JSON payload (ignoring key order/whitespace) → replay stored success response; same key + different payload → `409`/`422` conflict; never cache `4xx`/`5xx` failures.
- **Versioning & Evolution**:
  - Use path versioning (`/v1`). Only additive changes are allowed within a version (clients must ignore unknown fields). Breaking changes require `/v2`.
  - Keep legacy versions' exact behavior (including legacy error shapes) until removal, and emit `Deprecation` (RFC 9745), `Sunset` (RFC 8594), and `Link: </v2/...>; rel="successor-version"`.

---

## 4. Security, Sandbox, Supply Chain & Prompt Injection (Session 06)

- **Authentication, Roles & Ownership (No IDOR)**:
  - Enforce **both** role and resource ownership on the server for every endpoint. Hiding a UI button is not a security check.
  - `401` = unauthenticated (missing/invalid/expired token); `403` = authenticated but forbidden role/action; `404` = resource does not exist or is not yours (same status and body so IDs never leak existence).
  - Scope every query by caller identity (`student_id = :me` or `class_id IN class_staff`), never by `id` alone.
- **Hardened C++ Judge Sandbox**:
  - Both **compilation and execution** must happen inside the isolated sandbox container.
  - Mandatory minimums (each backed by an automated attack test in CI):
    1. `--network none` (no network access).
    2. CPU time limit (`--cpus`).
    3. Wall-clock timeout that kills the **entire container** (not just one process, preventing fork-bomb pipe hangs).
    4. Memory limit with swap disabled (`--memory 256m --memory-swap 256m`); the memory attack test must read back allocated memory so the compiler cannot optimize it away.
    5. Process limit (`--pids-limit`).
    6. Output size cap.
    7. Non-root user (`--user 65534:65534`), `--cap-drop ALL`, `--security-opt no-new-privileges`.
    8. Read-only root filesystem (`--read-only` + bounded `--tmpfs`), no host volume mounts, and **never** `-v /var/run/docker.sock` or `--privileged`.
    9. Zero secrets: never pass `MODEL_API_KEY`, `.env`, `--env-file`, or host credentials into the sandbox environment or filesystem.
- **Secrets Hygiene**:
  - Model API keys stay strictly on trusted backend servers — never in frontend bundles (`VITE_*`), logs, sandbox containers, or git history.
  - If a secret ever leaks: **rotate/revoke first**, deploy the new key, clean up, and record the rotation in `AI-LOG.md`.
- **Supply Chain Security**:
  - Review every new package before installing (watch for typosquatting, slopsquatting, and `install`/`postinstall` scripts).
  - Always commit lockfiles, install with `npm ci` / pinned `requirements-dev.txt`, pin Docker base images by version/digest, and run dependency audits (`npm audit`, `pip-audit`) + full-history secret scans (`gitleaks`).
- **Prompt Injection Defense (LeeTKOB Checker)**:
  - Strip comments and student identity before sending code to the LLM while preserving original line-number mappings.
  - Run syntax-aware hard rules (AST) **first** for ban-list constraints (`Do not use` / `Do not call`); hard rules decide alone and never trigger the LLM, ignoring comments and string literals.
  - Validate LLM output against a strict JSON schema, verify evidence lines match the original code, enforce timeouts, and route any failure or checker-directed injection to `unsure`.
  - The checker has **no write tools** and **never sets marks or publishes grades**; all `violation`, all `unsure`, and 10% of `pass` verdicts go through the TA review queue before publishing.

---

## 5. Quality Gates & Testing (Session 07)

- **Testing Pyramid**: Push every promise down to the lowest layer that can genuinely catch a regression:
  - *Unit*: pure logic (score arithmetic, AST hard rules, schema/timeout guardrails with fake model & no network).
  - *Contract / Integration*: over HTTP against real routing/guards/DB — one test per contract sentence and per threat-table row.
  - *System*: real Docker sandbox attack suite (all 9 minimums) and queue/worker restart idempotency.
  - *E2E (Playwright)*: 1–2 critical journeys using accessible roles/labels (`getByRole`, `getByLabel`), never fixed sleeps (`waitForTimeout`) or brittle CSS `nth-child` selectors.
- **Tests That Bite**:
  - After every refusal (`403`, `404`, `409`), assert that **nothing changed** in the database/store.
  - Prove tests can fail via deliberate breaks. Never loosen or delete a test to make CI pass unless the contract itself is intentionally updated in the same PR.
  - Treat flaky tests as real bugs (races, shared state, fixed sleeps) — never hide them with `try/catch`, `.skip`, or blind retries.
- **Honest CI Gate**:
  - Run on `pull_request` (before merge), `push` to `main`, and release tags, with minimal `permissions: { contents: read }`.
  - Run the exact same canonical commands documented in `README.md` using `npm ci`.
  - **Never** silence failures with `|| true`, `continue-on-error: true`, `--passWithNoTests`, or `if: github.event_name == 'push'` skips.
  - **Never** use `pull_request_target` with a checkout of untrusted PR code.
  - Protect `main` with required status checks, required PR review, and no bypass.

---

## 6. Packaging, Containers & Zero-Downtime Release (Session 08)

- **Releasable Docker Images**:
  - Build once, run anywhere; configure exclusively via runtime environment variables.
  - Pin every base image to a specific version or digest (e.g., `node:22-alpine`, never `:latest`).
  - Maintain a strict `.dockerignore` so `.git`, `env/`, `test/`, `tools/`, and logs never enter the image.
  - Run container processes as a non-root `USER` with proper write permissions only on designated data/tmp paths.
  - Never bake secrets into `ENV`, `ARG`, or any intermediate layer (`docker history` must be clean).
- **Stateless Containers & Separate Migrations**:
  - Treat containers as disposable; persist all state in external databases/volumes.
  - Run database migrations as a **separate explicit step** before deploying new code — never automatically inside `npm start` / container entrypoint.
- **Graceful Lifecycle**:
  - Expose an accurate `HEALTHCHECK` that turns healthy only when the service can actually serve requests.
  - Use exec-form `CMD` (e.g., `CMD ["node", "dist/main.js"]`, never shell-form `CMD npm start`) so the app runs as PID 1 and handles `SIGTERM` cleanly (finish in-flight requests, refuse new ones, exit within seconds).
- **Safe Releases, Flags & Rollback**:
  - Separate **deploy** from **release** using runtime flags (stored in DB, not env vars) when rolling out risky behavior changes.
  - Wait for container health before shifting traffic; gate staged rollouts/canaries on real client error rates (not only `/health`); keep the previous slot/version ready for fast rollback.
  - Never modify verification/eval harnesses (`eval.mjs`, `labels.jsonl`, dev-set `.cpp` files, or course checking tools).
