# AGENTS.md — LeeTKOB AI Assistant Rules

This document specifies the operating constraints, coding conventions, and permissions for AI assistants working on the LeeTKOB codebase.

---

## 1. Stack
- **Gateway / Core API**: Node.js 22 LTS, NestJS 11, TypeScript 5.7, Jest, Supertest.
- **Frontend**: React 18, Vite 5, TypeScript 5.6, Vitest.
- **Constraint Checker**: Python 3.12, tree-sitter C++ AST parser, Ruff (linter/formatter), mypy, pytest.
- **Data & Infrastructure**: PostgreSQL 16, Redis 7, RabbitMQ 3, Docker, GitHub Actions.

---

## 2. Commands (Canonical Quality Gate)
Every check must be runnable via one exact command, identical locally and in CI:
- **Lint**: `npm run lint`
- **Format Check**: `npm run format:check`
- **Type Check**: `npm run typecheck`
- **Test**: `npm run test`

---

## 3. Conventions
- **Course Engineering Standards**: Follow [docs/engineering-rules.md](docs/engineering-rules.md) (CSC13114 Sessions 03–08: harness/config, DB constraints & zero-downtime migrations, RFC 9457 contracts & cursor pagination, security/sandbox/prompt-injection defense, honest CI gates, and Docker packaging/release).
- **Monorepo**: Multi-service repository. All checks are orchestrated from the root scripts.
- **Config & Data**: Validate env config once at startup (fail loudly on missing secrets, no fallback defaults); enforce invariants in DB schema (`NOT NULL`, `UNIQUE`, `CHECK`, `FK`); never hold DB transactions across network/LLM calls; use expand-migrate-contract for schema changes.
- **API & Auth**: Contract first (`docs/contract/`). All errors use **RFC 9457** (`application/problem+json`, never leaking SQL/stack traces on `500`). Enforce both role and resource ownership on the server (no IDOR). Use cursor pagination for lists and DB-backed `Idempotency-Key` for `POST`/`PATCH` writes.
- **Contract authoring**: Before writing or updating any API contract or contract test, read and follow the [`write-api-contract` skill](.agents/skills/write-api-contract/SKILL.md).
- **Cross-Service Sync & FAQ Privacy**:
  - Define shared internal schemas (`Gateway ↔ Queue/Judge ↔ Checker`, including `unsureReason` per `FAQ-09`) in `docs/contract/` before parallel coding; changes are Tier 2 (Ask First).
  - Enforce the PA#3 Syllabus Rule & FAQ boundaries: before Publish, student APIs return only `overallVerdict` and `testVerdicts[]` (hide test I/O per `FAQ-02`, hide checker verdicts/evidence/deductions per `FAQ-08`). Checker verdicts land only in the TA review queue (`PENDING_REVIEW`) and always enforce both schema validation and timeout. Cite FAQ IDs in code/contracts.
- **Offline Gate & Eval Integrity**: All four quality-gate commands and `checker` with `MODEL_OFF=1` must run 100% offline (`--network none`). Keep the published dev set byte-for-byte intact (`eval.mjs` SHA-256 `c836edd8713521bb…`, `labels.jsonl` `262cda7b0ef5612e…`) and store team-authored cases (≥5, with trap + injection) in a separate folder.
- **Docker & Lifecycle**: Pin base images (never `:latest`), use `.dockerignore`, run as non-root `USER`, run migrations separately from app startup, use exec-form `CMD` with graceful `SIGTERM` handling, and keep `HEALTHCHECK` honest.
- **Branch & Commit Workflow**:
  - Never work or commit directly on `main`. Before starting any task, sync `main` and checkout a dedicated branch matching the task type: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`, or `test/<slug>`.
  - Use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`) with optional scope (e.g., `feat(gateway): ...`). Keep one logical part per commit (`sandbox`, `queue`, `hard rules`, `model call`, `limits`) and land tests before or in the same commit as the code they test.
- **Documentation Sync (`README.md`)**: Whenever setup steps, datasets, environment variables, or CLI/check commands change, update `README.md` in the same task so a fresh clone stays green.
- **Post-Task Completion Checklist** (required after finishing every task):
  1. **Update `AI-LOG.md`**: Append an entry using the course format (`Tool`, `Asked for`, `Kept`, `Changed`, `Rejected`, `By hand`/`Validation`).
  2. **Log to Project Tracking Sheet**: Record the completed task in the `phân chia công việc` tab of [Sheet quản lí project](https://docs.google.com/spreadsheets/d/1fGDnFNxfv2c1UpYIcn_WAyc3K33coM-0vgQ9-sObxys/edit) (using the member's authorized Google account) filling all columns: `Mã Task`, `Mốc dự án`, `Tên công việc`, `Người thực hiện`, `Độ ưu tiên`, `Trạng thái`, `Ngày bắt đầu`, `Hạn chót`, `Độ khó (1-5)`, `Tiêu chuẩn hoàn thành (DoD)`, `Link PR / Tài liệu`, `Ghi chú`.
  3. **Confirm Git Actions**: Ask the user whether they want to commit, push the branch, and create a Pull Request before running those git/PR actions.

---

## 4. Never (Permissions & Invariants)

### 4.1 Assistant Permissions (Three Tiers)

#### Tier 1: Allowed (Autonomous)
- Read and analyze files, documentation, and error logs.
- Run local linting, formatting, type checking, and unit tests.
- Propose code changes, refactor internal functions, and add test cases.

#### Tier 2: Ask First (Require Confirmation)
- Modifying database schemas or ORM entities.
- Modifying API contracts in `docs/contract/`.
- Changing CI/CD pipeline definitions (`.github/workflows/`).
- Adding new external packages or changing architecture.

#### Tier 3: Never (Forbidden)
- Never commit secrets, tokens, passwords, or live API keys to git, bake them into Docker images, or expose them to frontend bundles (`VITE_*`).
- Never edit a test, `eval.mjs`, `labels.jsonl`, or dev-set `.cpp` files to make a failing check pass.
- Never tune prompts or hard rules to dev-set problem IDs/filenames (e.g., `sort-merge`/`s05`) or quote dev-set solutions.
- Never silence CI or tests with `|| true`, `continue-on-error: true`, `--passWithNoTests`, `.skip`, or `try/catch` around assertions.
- Never place secrets, `--env-file`, `-e MODEL_API_KEY`, host mounts, `--privileged`, or `/var/run/docker.sock` inside the judge sandbox.
- Never make real LLM API calls inside unit/contract tests (use fake models/stubs) or commit a "real" eval run without provider request IDs.
- Never let an LLM verdict set a mark, publish grades, or reach a student as a deduction without TA review.
- Never push code directly to the `main` branch or rewrite/split git history after the fact to fake incremental commits.

### 4.2 Product-Specific Never Rules & Verified Incidents

1. **Never authorize an HTTP request with fixture tokens or a raw user ID.**
   On 2026-11-11, review found that the live guard accepted `valid_student_token` and a student ID without verifying a JWT. Contract tests now use signed tokens and exercise expired/incorrect signatures. See the 2026-11-11 repair entry in `AI-LOG.md`.
2. **Never replay a cached submission across student or lab boundaries.**
   On 2026-11-11, review reproduced a same-key request returning another lab's response and another student's submission metadata. Keys are now scoped to the student and the fingerprint includes the lab. See the 2026-11-11 repair entry in `AI-LOG.md`.
