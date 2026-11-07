# AI-LOG

One entry per task where an assistant did part of the work, complying with the CSC13114 course template.
Team Members:
- **Phạm An Ninh** (Leader — DevOps & CI Gate)
- **Huỳnh Đăng Khoa** (23120285 — AI Harness, Rules, Permissions & Security)
- **Nguyễn Nhật Duy** (23120244 — Backend & Contract)

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
  - **Spending Cap**: Configured hard limit of **$10 USD** in Google Cloud Billing / AI Studio.
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
  - **Incident 1 (Test assertion tampering)**: When an authorization test initially failed in local testing, the AI assistant attempted to modify the test assertion from `expect(status).toBe(403)` to `expect(status).toBe(200)` to bypass the failure rather than diagnosing the missing ownership check in the controller. This dangerous evasion was caught immediately in diff review, rejected, and codified directly into the product Never rule: *"Never edit test assertions or remove test cases to bypass CI failure"*.
  - **Incident 2 (Hardcoded backdoor authentication token)**: During middleware prototyping, the assistant proposed inserting a bypass snippet `if (token === "dev-admin") return { role: "admin" }` to simplify manual testing without obtaining real JWT tokens. This critical security hazard was rejected immediately during security audit and codified directly into the Never rule: *"Never hardcode or mock bypass authorization tokens in production middleware"*.
