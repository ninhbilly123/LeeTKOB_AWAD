# LeeTKOB

LeeTKOB is an automated grading platform for C++ programming labs, featuring an LLM-assisted pipeline that **checks problem constraints and suggests point deductions** with exact offending code lines as evidence. Teaching Assistants (TAs) review and approve suggestions before grades are published; the LLM never decides deduction amounts.

Course Project: **CSC13114 — Advanced Web Application Development (Capstone Course)**.

---

## 1. Team Members

- **Phạm An Ninh** (23120314 — Leader, DevOps, CI/CD, Quality Gate & Branch Protection)
- **Huỳnh Đăng Khoa** (23120285 — AI Harness, Rules, Permissions & Security)
- **Nguyễn Nhật Duy** (23120244 — Backend API, Contract Specification & Contract Tests)

---

## 2. Monorepo Architecture

The repository is structured as a multi-service monorepo:
- `gateway/`: Gateway and Core API built with Node.js / NestJS (Authentication, Labs, Submissions, Review Queue).
- `checker/`: Constraint-checking service in Python (Tree-sitter C++ AST parser for hard rules & LLM semantic checker).
- `web/`: Frontend user interface built with React + Vite + TypeScript (TA review dashboard & Student submission portal).
- `judge/`: Multi-threaded grading worker with isolated Docker sandbox.
- `docs/contract/`: API contract documentation complying with RFC 9457 (Problem Details for HTTP APIs).

---

## 3. Fresh Clone Setup

### Prerequisites
- **Node.js**: 22.x (matches CI)
- **npm**: >= 10
- **Python**: 3.12.x (matches CI)

### Installation Steps
```bash
# Run from the repository root.
# 1. Install the exact Node.js dependencies from package-lock.json, as CI does.
npm ci

# 2. Install quality check tools for Python (checker)
python -m pip install -r checker/requirements-dev.txt
```

On systems where Python is named `python3`, use `python3 -m pip install -r checker/requirements-dev.txt` instead. Install the Python tools with the same interpreter used by the checks: `python` on Windows and `python3` on Linux/macOS. The `PYTHON` environment variable can select a different interpreter. Python tool versions are pinned to match CI.

---

## 4. Quality Gate Commands (One Command for Every Check)

In strict accordance with **Criterion 3 of PA#2**, each quality check runs with **one documented command**, identical locally and in CI:

| Check Type | Canonical Command | Description |
|---|---|---|
| **Lint** | `npm run lint` | Runs ESLint across `gateway`, `web` and Ruff Lint across `checker` |
| **Format Check** | `npm run format:check` | Checks formatting via Prettier on `gateway`, `web` and Ruff Format on `checker` |
| **Type Check** | `npm run typecheck` | Checks static types with `tsc --noEmit` (`gateway`, `web`) and `mypy` (`checker`) |
| **Tests** | `npm run test` | Runs Jest unit/contract tests (`gateway`), Vitest (`web`), and Pytest (`checker`) |

After installation, run all four commands from the repository root:

```bash
npm run lint
npm run format:check
npm run typecheck
npm run test
```

Each command checks `gateway`, `web`, and `checker`, and exits with a nonzero status when a step fails. CI runs these same four commands.

### Line endings on Windows and Linux

`.gitattributes` checks out text files with LF line endings even when Git's `core.autocrlf` is enabled. Both Prettier configurations explicitly require LF, so Windows and Linux use the same format check. Windows `.bat` and `.cmd` files use CRLF.

For an existing checkout with CRLF files, normalize the checked source files with the installed formatters, then rerun the format check:

```bash
npm exec --workspace=gateway -- prettier --write "src/**/*.ts" "test/**/*.ts"
npm exec --workspace=web -- prettier --write "src/**/*.{ts,tsx}"
python -m ruff format checker
npm run format:check
```

---

## 5. Security & Spending Cap Policy (Criterion 2)

- **Secrets:** Credentials belong in environment variables. `.env.example` contains variable names with empty values. The history scan and its limits are recorded in [PA2.md](PA2.md); a scan does not prove the absence of every possible credential.
- **Current plan (confirmed by the team on 2026-11-11): Gemini API free tier.** The team will reconsider the plan in the future if its needs change. Moving to a paid plan is not part of this PA#2 update.
- **Model and costs:** Gemini 3.1 Flash-Lite remains the planned model, subject to availability in the selected plan when integration is implemented. The PA#2 checker is a placeholder and the test suites make no real model calls, so their model cost is **$0**. This test cost is not a measured production cost per lab; that figure will be recorded when the pipeline is implemented.
- **Current cost controls:** use the free plan within its provider-enforced quotas; record the account's actual plan, quota and billing restrictions as evidence without exposing credentials. Those account settings have not been independently verified in this repository review. A free-tier quota is not itself a configured monetary spending cap, and no $10 cap is claimed.
- **Future paid usage:** if the team decides to enable paid usage, first agree on an appropriate spending limit, configure the provider's actual control, and update README/AI-LOG with evidence. The class brief allows free tiers, and neither it nor the PA#2 rubric fixes a $10 amount or monthly period. See [Gemini billing](https://ai.google.dev/gemini-api/docs/billing); an alerts-only [Cloud Billing budget](https://docs.cloud.google.com/billing/docs/how-to/budgets) does not automatically cap spending.

## 6. PA#2 runtime boundaries

The submission endpoint verifies HS256 JWT signatures and expiration using `@nestjs/jwt`. Set `JWT_SECRET` to a private random value of at least 32 bytes before starting the Gateway; startup refuses a missing or short secret. Tokens must carry a nonempty `sub`, a `role` (`STUDENT`, `TA`, or `ADMIN`), and an `exp` claim. Token issuance and account management are later checkpoint work.

Contract tests generate an ephemeral signing secret and signed JWTs. They inject seeded repositories through Nest's testing module; the application starts with an empty in-memory repository and imports no test fixtures. No API key is needed to run the checks.

Persistence, RabbitMQ delivery, sandbox execution, and the LLM pipeline remain PA#3 work. `QUEUED` is currently the accepted submission state, not evidence of a message delivered to RabbitMQ. Idempotency is atomic for this single-process repository; deployment across processes requires durable storage and a transaction/unique constraint.
