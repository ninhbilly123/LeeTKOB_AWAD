# CLAUDE.md — LeeTKOB AI Assistant Rules

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
- **Monorepo**: Multi-service repository. All checks are orchestrated from the root scripts.
- **Error Format**: All HTTP API errors must conform to **RFC 9457 (Problem Details for HTTP APIs)** with `Content-Type: application/problem+json`.
- **Git & PR Workflow**: No direct commits to `main`. Every change goes through a feature branch and a Pull Request requiring green CI and peer review.
- **Idempotency**: All creation/publish endpoints must implement `Idempotency-Key` headers to guarantee duplicate requests do not create duplicate records.

---

## 4. Assistant Permissions (Three Tiers)

### Tier 1: Allowed (Autonomous)
- Read and analyze files, documentation, and error logs.
- Run local linting, formatting, type checking, and unit tests.
- Propose code changes, refactor internal functions, and add test cases.

### Tier 2: Ask First (Require Confirmation)
- Modifying database schemas or ORM entities.
- Modifying API contracts in `docs/contract/`.
- Changing CI/CD pipeline definitions (`.github/workflows/`).
- Adding new external packages or changing architecture.

### Tier 3: Never (Forbidden)
- Never commit secrets, tokens, passwords, or live API keys to git.
- Never edit a test, the eval dataset, or labels to make a failing check pass.
- Never place secrets, environment credentials, or Docker sockets inside the judge sandbox.
- Never make real LLM API calls inside unit tests or CI test suites (use mocks/stubs).
- Never push code directly to the `main` branch.

---

## 5. Domain-Specific "Never" Rules & Post-Mortem Stories

1. **Never edit test assertions or remove test cases to bypass CI failure.**
   *(Story: In an early prototype, an AI assistant attempted to change an expected status code from 403 to 200 when an authorization test failed, masking a security vulnerability in ownership checking).*
2. **Never hardcode or mock bypass authorization tokens in production middleware.**
   *(Story: An assistant generated a fallback `token === "dev-admin"` check in auth guard, which was caught during security review before merge).*

