# Self-Assessment Report — PA#2: Harness and Quality Gate

- **Team**: LeeTKOB Team (Phạm An Ninh, Huỳnh Đăng Khoa, Nguyễn Nhật Duy)
- **Repository**: https://github.com/ninhbilly123/LeeTKOB_AWAD
- **Claimed Total Score**: 100 / 100 points

---

## 1. Detailed Self-Assessment Breakdown

| # | Criterion | Max Points | Claimed Marks | Evidence & Justification |
|---|---|:---:|:---:|---|
| **1** | **Rules file** | 15 | 15 | `AGENTS.md` and `CLAUDE.md` at root with four required sections: *stack, commands, conventions, never*. The *never* list is product-specific (no secrets in sandbox, no real LLM calls in unit tests, never edit tests/eval data/labels to pass checks). Contains two traceable incident stories. |
| **2** | **Permissions and secrets** | 10 | 10 | Assistant permissions explicitly documented in three tiers (*allowed, ask first, never*) in `AGENTS.md`. `.env.example` lists all configuration variables without values. Git history is 100% clean of credentials. `README.md` documents Gemini 3.1 Flash-Lite spending cap of $10 USD. |
| **3** | **One command for every check** | 10 | 10 | Four canonical commands at root: `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run test`. Local and CI (`.github/workflows/ci.yml`) commands are 100% identical. Fresh clone following `README.md` runs completely green. |
| **4** | **CI that blocks a merge** | 20 | 20 | `main` branch is protected with mandatory status check `Quality Gate (Lint, Format, Typecheck, Test)`. Blocked PR with red status and resolving green commit linked in `PA2.md`. No direct pushes to `main`. |
| **5** | **The contract of one endpoint** | 25 | 25 | `docs/contract/post-submissions.md` specifies `POST /labs/{labId}/submissions`. Explicit role/ownership rules (enrolled student only), RFC 9457 Problem Details error model with all status codes, and `Idempotency-Key` duplicate prevention. |
| **6** | **Contract tests that bite** | 15 | 15 | Comprehensive test suite covering every RFC 9457 error code, ownership enforcement, and idempotency. Runs in mandatory CI. Deliberate contract break commit/PR linked in `PA2.md`. |
| **7** | **AI-LOG.md** | 5 | 5 | Root `AI-LOG.md` logs each task with Tool, Asked for, Kept, and concrete Changed/Rejected entries detailing assistant missteps caught by the team. |
| **TOTAL** | | **100** | **100** | |

---

## 2. What We Did Not Manage

- The `judge` worker service (Java Spring Boot) currently has its architectural skeleton in place; detailed sandbox testing pipelines will be completed in the next milestone (PA#3) per the proposal roadmap.
- RabbitMQ messaging queue and submission forwarding to workers use mock/stub verification within the scope of the PA#2 contract tests.
