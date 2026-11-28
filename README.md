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

# 3. Database migrations & optional PA#3 demo seed (explicit step, never inside npm start)
npm run db:migrate --workspace=gateway
npm run db:seed:demo --workspace=gateway
# Rollback latest migration if needed:
npm run db:migrate:down --workspace=gateway

# 4. Run the Frontend UI locally (defaults to offline MockApiClient with 5 PA#3 demo accounts)
npm run dev --workspace=web
```

With Docker Compose (`docker compose up --build`), `postgres` starts first, `gateway-migrate` runs `0001_init_pa3_schema.up.sql`, `gateway-seed` optionally seeds the 5 PA#3 demo accounts when `ALLOW_DEMO_SEED=true` (otherwise exits `0`), `gateway` serves the REST API, `judge-worker` + `checker` process async C++17 judging and constraint checking, and `web` serves the React SPA at `http://localhost:8080` (`${WEB_PORT:-8080}`) with a same-origin Nginx reverse proxy (`/api/* -> http://gateway:3000/*`). Set `VITE_SHOW_DEMO_ACCOUNTS=true` when building the `web` container if you want the 5 PA#3 quick-login demo buttons on `/login`. See [docs/database-plan.md](docs/database-plan.md) for the full normalized PostgreSQL 16 schema and index design.

For local development with Vite connected directly to a running Gateway:

```bash
# Terminal 1 — Start NestJS Gateway (configure .env with JWT_SECRET, DATABASE_URL or PERSISTENCE_MODE=memory)
npm run dev:gateway

# Terminal 2 — Start React Web UI in live HTTP mode (proxies /api/* -> VITE_GATEWAY_PROXY_TARGET, default http://localhost:3000)
npm run dev:web:http
```

See [docs/web-ui-plan.md](docs/web-ui-plan.md) for the full screen map, FAQ visibility boundaries, and backend API alignment list.

On systems where Python is named `python3`, use `python3 -m pip install -r checker/requirements-dev.txt` instead. Install the Python tools with the same interpreter used by the checks: `python` on Windows and `python3` on Linux/macOS. The `PYTHON` environment variable can select a different interpreter. Python tool versions are pinned to match CI.

---

## 4. Quality Gate Commands (One Command for Every Check)

In strict accordance with **Criterion 3 of PA#2**, each quality check runs with **one documented command**, identical locally and in CI:

| Check Type       | Canonical Command      | Description                                                                                |
| ---------------- | ---------------------- | ------------------------------------------------------------------------------------------ |
| **Lint**         | `npm run lint`         | Runs ESLint across `gateway`, `web`, `judge` and Ruff Lint across `checker`                |
| **Format Check** | `npm run format:check` | Checks formatting via Prettier on `gateway`, `web`, `judge` and Ruff Format on `checker`   |
| **Type Check**   | `npm run typecheck`    | Checks static types with `tsc --noEmit` (`gateway`, `web`, `judge`) and `mypy` (`checker`) |
| **Tests**        | `npm run test`         | Runs Jest unit/contract tests (`gateway`, `judge`), Vitest (`web`), and Pytest (`checker`) |

After installation, run all four commands from the repository root:

```bash
npm run lint
npm run format:check
npm run typecheck
npm run test
```

Each command checks `gateway`, `web`, `judge`, and `checker`, and exits with a nonzero status when a step fails. CI runs these same four commands.

### Line endings on Windows and Linux

`.gitattributes` checks out text files with LF line endings even when Git's `core.autocrlf` is enabled. All Prettier configurations explicitly require LF, so Windows and Linux use the same format check. Windows `.bat` and `.cmd` files use CRLF.

For an existing checkout with CRLF files, normalize the checked source files with the installed formatters, then rerun the format check:

```bash
npm exec --workspace=gateway -- prettier --write "src/**/*.ts" "test/**/*.ts"
npm exec --workspace=web -- prettier --write "src/**/*.{ts,tsx}"
npm exec --workspace=judge -- prettier --write "src/**/*.ts" "test/**/*.ts"
python -m ruff format checker
npm run format:check
```

---

## 5. Security & Spending Cap Policy (Criterion 2)

- **Secrets:** Credentials belong in environment variables. `.env.example` contains variable names with empty values. The history scan and its limits are recorded in [PA2.md](PA2.md); a scan does not prove the absence of every possible credential.
- **Current plan (confirmed by the team on 2026-11-11): Gemini API free tier.** The team will reconsider the plan in the future if its needs change. Moving to a paid plan is not part of this PA#2 update.
- **Model and costs:** Gemini 3.1 Flash-Lite remains the planned model, subject to availability in the selected plan when integration is implemented. The PA#2 checker is a placeholder and the test suites make no real model calls, so their model cost is **$0**. This test cost is not a measured production cost per lab; that figure will be recorded when the pipeline is implemented.
- **Current cost controls:** use the free plan within its provider-enforced quotas; record the account's actual plan, quota and billing restrictions as evidence without exposing credentials. The supplied screenshot verifies the displayed Free tier and Set up billing labels; numerical quotas and monetary-cap settings are not shown. A free-tier quota is not itself a configured monetary spending cap, and no $10 cap is claimed.
- **Account evidence:** the [reviewed Google AI Studio screenshot](docs/evidence/free-tier.md) shows project LeeTKOB, a created key entry, Free tier and Set up billing. The complete API key is not visible. The evidence page states the image's limits.
- **Future paid usage:** if the team decides to enable paid usage, first agree on an appropriate spending limit, configure the provider's actual control, and update README/AI-LOG with evidence. The class brief allows free tiers, and neither it nor the PA#2 rubric fixes a $10 amount or monthly period. See [Gemini billing](https://ai.google.dev/gemini-api/docs/billing); an alerts-only [Cloud Billing budget](https://docs.cloud.google.com/billing/docs/how-to/budgets) does not automatically cap spending.

## 6. PA#2 runtime boundaries

The submission endpoint verifies HS256 JWT signatures and expiration using `@nestjs/jwt`. Set `JWT_SECRET` to a private random value of at least 32 bytes before starting the Gateway; startup refuses a missing or short secret. Tokens must carry a nonempty `sub`, a `role` (`STUDENT`, `TA`, or `ADMIN`), and an `exp` claim. Token issuance and account management are later checkpoint work.

Contract tests generate an ephemeral signing secret and signed JWTs. They inject seeded repositories through Nest's testing module; the application starts with an empty in-memory repository and imports no test fixtures. No API key is needed to run the checks.

Persistence, RabbitMQ delivery, sandbox execution, and the LLM pipeline remain PA#3 work. `QUEUED` is currently the accepted submission state, not evidence of a message delivered to RabbitMQ. Idempotency is atomic for this single-process repository; deployment across processes requires durable storage and a transaction/unique constraint.

---

## 7. Checker CLI & Docker Usage (PA#3)

The Python constraint checker reads `problems/<id>/statement.md`, `problems/<id>/constraints.json`, and `solutions/<id>/*.cpp` without reading labels or requiring per-problem settings.

### Run locally (from `checker/`)

```bash
# Offline mode (hard rules only, semantic constraints become "unsure")
MODEL_OFF=1 python3 -m src --data ../leetkob-eval --output ../predictions-model-off.jsonl

# Real Gemini API mode (requires GEMINI_API_KEY in backend environment)
GEMINI_API_KEY="$GEMINI_API_KEY" python3 -m src --data ../leetkob-eval --output ../predictions.jsonl --call-log ../call-log.jsonl
```

### Build and run with Docker (`MODEL_OFF=1`, offline)

```bash
# Build non-root checker image
docker build -t leetkob-checker ./checker

# Run completely offline with memory and process limits
docker run --rm --network none --memory 512m --pids-limit 64 \
  -e MODEL_OFF=1 \
  -v "$(pwd)/leetkob-eval:/data:ro" \
  leetkob-checker --data /data > predictions-model-off.jsonl

# Score predictions with the unmodified dev-set scorer
node leetkob-eval/eval.mjs --data leetkob-eval --predictions predictions-model-off.jsonl
```

### Team-Authored Eval Cases (`leetkob-eval-team/`, Task D3)

Additional team-authored Accepted C++17 solutions live in a separate directory [leetkob-eval-team/](leetkob-eval-team/) (matching the exact `problems/`, `solutions/`, `labels.jsonl` layout so `leetkob-eval/` stays byte-for-byte intact). It contains `2` unseen problems (`stack-brackets`, `kth-element`), `8` Accepted solutions (`16` pairs), and covers all `5` eval tags (`obvious`, `disguised`, `trap`, `injection`, `style`).

```bash
# Run offline checker (MODEL_OFF=1) on the team cases and score with unmodified eval.mjs
MODEL_OFF=1 python -m src --data ../leetkob-eval-team --output ../team-predictions-model-off.jsonl
node leetkob-eval/eval.mjs --data leetkob-eval-team --predictions team-predictions-model-off.jsonl
```

### Real-Model Dev-Set Run & 80-Submission Cost Arithmetic (PA#3)

- **Evidence folder:** [docs/evidence/pa3-real-run/](docs/evidence/pa3-real-run/)
  - [predictions.jsonl](docs/evidence/pa3-real-run/predictions.jsonl) (`102` pairs across `47` Accepted solutions)
  - [eval-report.txt](docs/evidence/pa3-real-run/eval-report.txt) & [eval-summary.json](docs/evidence/pa3-real-run/eval-summary.json)
  - [call-log.jsonl](docs/evidence/pa3-real-run/call-log.jsonl) (`39` semantic calls; `8` `reverse-recursive` solutions were decided entirely by AST hard rules with `0` LLM calls)
- **Model used:** Google Gemini API — `gemini-3.1-flash-lite` (invoked via `gemini-3.1-flash-lite-preview`).
- **Reported `eval.mjs` numbers (`exit 1` in PA#3, where no eval pass threshold applies yet):**
  - **Wrongful deductions:** `0` (`0/65` pass pairs flagged)
  - **Recall (violations caught with exact line evidence):** `86.5%` (`32/37`)
  - **Unsure rate:** `6.9%` (`7/102`, caused by `5` `PROVIDER_ERROR` and `2` `TIMEOUT` burst failures caught by guardrails)
- **Per-call & 80-submission lab cost arithmetic:**
  - Across the `32` `OK` calls in [call-log.jsonl](docs/evidence/pa3-real-run/call-log.jsonl) (each carrying a real provider `requestId`): `27,308` input tokens (`853.375` avg/call) and `3,911` output tokens (`122.219` avg/call).
  - **Actual spend on Gemini API Free tier:** **$0.00**.
  - **Estimated paid-tier equivalent** (using reference rates `$0.10 / 1M` input tokens, `$0.40 / 1M` output tokens):
    - Measured `32` `OK` calls: `(27,308 × 0.10 + 3,911 × 0.40) / 1,000,000 = $0.0042952` (`$0.0001342` per semantic submission).
    - **1 lab of 80 Accepted submissions** (worst case where all 80 require a semantic LLM call; hard-rule-only labs cost `$0.00`):
      - `80 × (27,308 / 32) = 68,270` input tokens → `$0.006827`
      - `80 × (3,911 / 32) = 9,777.5` output tokens → `$0.003911`
      - **Total estimated paid-tier cost per 80-submission lab: `$0.010738` (~`$0.011 USD`)**.

---

## 8. Standalone Judge Worker & Durable Queue (Task N1)

`judge/` runs as a standalone Node.js 22 + TypeScript worker consuming the PostgreSQL 16 durable queue (`submission_jobs` via `FOR UPDATE SKIP LOCKED` + `LISTEN submission_jobs_ready` + stale-lease recovery). See [docs/contract/queue-and-judge.md](docs/contract/queue-and-judge.md).

- **Secret isolation:** `GEMINI_API_KEY` is injected **only** into the internal `checker` HTTP service (`checker/src/server.py`, `POST /check` and `GET /health`). `judge-worker` validates its environment at startup and refuses to run if `GEMINI_API_KEY` / `MODEL_API_KEY` is present.
- **Stop → Submit → Restart verification:** With Docker Compose running (`docker compose up -d --build` and demo seed applied), verify durable queue handoff, `AC` checker trigger, and single-verdict idempotency via:

```bash
node scripts/verify-n1-worker.mjs
```

---

## 9. Hardened C++17 Docker Sandbox & 9-Row Attack Suite (Task N2)

Both compilation (`g++ -std=c++17 -O2`) and execution run inside fresh ephemeral `leetkob-cpp-sandbox:pa3` containers (`judge/sandbox/Dockerfile`, zero host mounts, `--network none`, `--read-only` + bounded `--tmpfs`, `--user 65534:65534`, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--memory=<M>m --memory-swap=<M>m`, `--pids-limit 16`, `--cpus 1` + `RLIMIT_CPU`, wall-clock container kill via `docker rm -f`, 1 MiB output cap, and zero secrets). In `docker-compose.yml`, `judge-worker` talks only to an internal narrow-privilege `docker-socket-proxy` (`CONTAINERS=1`, `VOLUMES=0`, `EXEC=0`).

### Run the 9 Rubric Attack Submissions Locally (Requires Docker)

```bash
npm run build --workspace=judge
npm run sandbox:build --workspace=judge
npm run test:sandbox --workspace=judge
```

The same suite runs automatically in GitHub Actions (`.github/workflows/ci.yml` — job `Sandbox Security Suite (9 Minimums — Docker)`) on pull requests, pushes to `main`, and the `pa3` release tag, publishing a 9-row Markdown summary table while keeping the 4 canonical README checks 100% offline.
