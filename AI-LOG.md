# AI-LOG

One entry per task where an assistant did part of the work, complying with the CSC13114 course template.
Team Members:
- **Phạm An Ninh (Leader — DevOps & CI Gate)**
- **Huỳnh Đăng Khoa (Backend & Contract)**
- **Nguyễn Nhật Duy (AI Harness & Security)**

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
