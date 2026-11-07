# LeeTKOB

LeeTKOB is an automated grading platform for C++ programming labs, featuring an LLM-assisted pipeline that **checks problem constraints and suggests point deductions** with exact offending code lines as evidence. Teaching Assistants (TAs) review and approve suggestions before grades are published; the LLM never decides deduction amounts.

Course Project: **CSC13114 — Advanced Web Application Development (Capstone Course)**.

---

## 1. Team Members

- **Phạm An Ninh** (Leader — DevOps, CI/CD, Quality Gate & Branch Protection)
- **Huỳnh Đăng Khoa** (AI Harness, Rules, Permissions & Security)
- **Nguyễn Nhật Duy** (Backend API, Contract Specification & Contract Tests)

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
- **Node.js**: >= 20 (Node 22 LTS recommended)
- **npm**: >= 10
- **Python**: >= 3.11 (Python 3.12 recommended)

### Installation Steps
```bash
# 1. Install dependencies for Node.js workspaces (gateway, web)
npm install

# 2. Install quality check tools for Python (checker)
pip install ruff mypy pytest
```

---

## 4. Quality Gate Commands (One Command for Every Check)

In strict accordance with **Criterion 3 of PA#2**, each quality check runs with **one documented command**, identical locally and in CI:

| Check Type | Canonical Command | Description |
|---|---|---|
| **Lint** | `npm run lint` | Runs ESLint across `gateway`, `web` and Ruff Lint across `checker` |
| **Format Check** | `npm run format:check` | Checks formatting via Prettier on `gateway`, `web` and Ruff Format on `checker` |
| **Type Check** | `npm run typecheck` | Checks static types with `tsc --noEmit` (`gateway`, `web`) and `mypy` (`checker`) |
| **Tests** | `npm run test` | Runs Jest unit/contract tests (`gateway`), Vitest (`web`), and Pytest (`checker`) |

> **Guarantee:** Any fresh clone that follows Section 3 and executes these 4 commands will achieve green status (Exit code 0).

---

## 5. Security & Spending Cap Policy (Criterion 2)

- **No Secrets in History:** All sensitive credentials are managed strictly through environment variables. The `.env.example` file documents every required variable without sensitive values. Git history is verified 100% clean of any keys or tokens.
- **Model Spending Cap:** The LLM API key (Gemini 3.1 Flash-Lite) has a configured **hard spending limit (spending cap) of $10 USD** in Google AI Studio / Google Cloud to prevent runaway costs.
