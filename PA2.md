# PA#2 — Harness and Quality Gate Evidence

- Project: **LeeTKOB**, CSC13114 — Advanced Web Application Development.
- Public repository: [https://github.com/ninhbilly123/LeeTKOB_AWAD](https://github.com/ninhbilly123/LeeTKOB_AWAD).
- Submission reference: [`pa2`](https://github.com/ninhbilly123/LeeTKOB_AWAD/tree/pa2).

## 1. Team

| Member | Student ID | Role |
|---|---|---|
| Phạm An Ninh | 23120314 | Leader, DevOps and quality gate |
| Huỳnh Đăng Khoa | 23120285 | AI harness, permissions and security |
| Nguyễn Nhật Duy | 23120244 | Backend, API contract and contract tests |

## 2. Protected main

- [Active ruleset: Protect main branch](https://github.com/ninhbilly123/LeeTKOB_AWAD/rules/26341754).
- [Public ruleset API](https://api.github.com/repos/ninhbilly123/LeeTKOB_AWAD/rulesets/26341754).
- [Saved ruleset evidence](docs/evidence/main-ruleset.json).
- Requires a pull request, one approving review, an up-to-date branch, and the exact status context **Quality Gate (Lint, Format, Typecheck, Test)**.
- Main's first-parent history after the initial bootstrap consists of PR merges. This repair is submitted through a feature branch; it does not bypass review or push directly to main.

## 3. A red gate and its green repair

- [PR #3: Feat/submissions](https://github.com/ninhbilly123/LeeTKOB_AWAD/pull/3).
- [Red run 41995017261](https://github.com/ninhbilly123/LeeTKOB_AWAD/actions/runs/41995017261), commit [`cf040c6`](https://github.com/ninhbilly123/LeeTKOB_AWAD/commit/cf040c66eeb7159dada9fd76e2a0ca6f0e503394): **Format Check failed**; the required quality gate was red.
- [Repair commit `cb589cd`](https://github.com/ninhbilly123/LeeTKOB_AWAD/commit/cb589cdad732db9f3d05e7be46a71c0dbd37d22d): corrects formatting without changing assertions or expected status codes.
- [Green run 41996690537](https://github.com/ninhbilly123/LeeTKOB_AWAD/actions/runs/41996690537) on that repair commit.
- PR #3 was later closed and the branch was submitted as [PR #4](https://github.com/ninhbilly123/LeeTKOB_AWAD/pull/4), which was merged. It is not claimed that PR #3 itself was merged.
- A separate [deliberate TypeScript failure, PR #1](https://github.com/ninhbilly123/LeeTKOB_AWAD/pull/1), remains red. The red-to-green evidence above is PR #3, not an invented repair of PR #1.

## 4. A deliberate contract break caught by CI

- [PR #5](https://github.com/ninhbilly123/LeeTKOB_AWAD/pull/5), commit [`da5c3df`](https://github.com/ninhbilly123/LeeTKOB_AWAD/commit/da5c3df8c1872fe99342accab7ea9c8b2a9bd90b).
- [Failing run 42001642652](https://github.com/ninhbilly123/LeeTKOB_AWAD/actions/runs/42001642652).
- The code changed the cross-class rejection from `403` to `200`; tests were unchanged. Lint, format and typecheck passed; **Tests failed**. The broken change was not merged.
- [Saved run and step results](docs/evidence/ci-evidence.json).

## 5. Checks and submission tag

| Check | Local and CI command |
|---|---|
| Lint | `npm run lint` |
| Format | `npm run format:check` |
| Types | `npm run typecheck` |
| Tests | `npm run test` |

- [Local and clean-clone validation](docs/evidence/local-validation.json).
- Setup: [README](README.md#3-fresh-clone-setup); Node dependencies use the lockfile and Python tools use pinned requirements.
- [Workflow](.github/workflows/ci.yml) runs for PRs to main, pushes to main, and pushes of tag **pa2**.
- [CI checks for the submitted tag](https://github.com/ninhbilly123/LeeTKOB_AWAD/commit/pa2/checks).
- [Tag-triggered workflow runs](https://github.com/ninhbilly123/LeeTKOB_AWAD/actions/workflows/ci.yml?query=branch%3Apa2). Open the **Quality Gate CI** run for `pa2`; these stable links resolve to the tagged commit and its actual runs without a self-referential run ID embedded in that same commit. The submission ZIP also includes `PA2_CI_RUN.txt` with the direct run URL, generated after the tag run passes.

## 6. Contract and reproducible tests

- [Endpoint contract](docs/contract/post-submissions.md).
- [Original success/error/ownership/idempotency tests](gateway/test/submissions.contract.spec.ts).
- [Security, concurrency, TTL and error boundary regressions](gateway/test/submission-boundaries.contract.spec.ts).
- Tests exercise the real guard, controller, service and exception filter through HTTP. Only repository data and the signing secret are injected; the guard is not bypassed. Test JWTs are signed with an ephemeral secret.
- The PA#2 repository is in memory and starts empty outside tests. RabbitMQ, durable storage, sandboxing and LLM integration are not claimed as complete.

## 7. Secrets, spending and remaining limitation

- [Three-tier assistant permissions](AGENTS.md#41-assistant-permissions-three-tiers).
- [Secret scan and redacted report](docs/evidence/secret-scan.md).
- **Current usage plan: Gemini API free tier**, confirmed by the team on 2026-11-11. The team may change plans later if necessary. The PA#2 checker/tests make no real model calls; their model API cost is $0, while a production per-lab cost has not been measured.
- Free-tier quotas and billing restrictions should be supported by redacted account evidence. Their configuration has not been independently verified in this review; no configured monetary cap or $10 limit is claimed. The class brief permits free tiers, and the rubric does not prescribe a dollar amount. Any later switch to paid usage requires a deliberate limit and an update to the documented cost controls.
- The team confirms that it has created an API key. [Free-tier account evidence](docs/evidence/free-tier.md) is **pending**: the team will add screenshots with the key hidden before final submission.
- [Account-owner completion steps](docs/pa2-submission-checklist.md).
- [Self-assessment](SELF_ASSESSMENT_REPORT.md): **100/100 claimed by the team**, with pending evidence and limitations stated explicitly; this is not a confirmed grade.
