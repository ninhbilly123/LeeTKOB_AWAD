# PA#2 Self-Assessment

- Team: Nguyễn Nhật Duy (23120244), Huỳnh Đăng Khoa (23120285), Phạm An Ninh (23120314).
- Public repository: https://github.com/ninhbilly123/LeeTKOB_AWAD
- Claimed total: **96 / 100**. These are the team's proposed marks, not a confirmed lecturer grade.

| # | Criterion | Maximum | Claimed | Evidence and limits |
|---|---|---:|---:|---|
| 1 | Rules file | 15 | 15 | [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md): stack, commands, conventions, never; two concrete 2026-11-11 incidents traced to [AI-LOG.md](AI-LOG.md). |
| 2 | Permissions and secrets | 10 | 8 | Three explicit permission tiers, empty-valued [.env.example](.env.example), [Gitleaks history scan](docs/evidence/secret-scan.md). The team currently uses the **Gemini API free tier**; account-level quota/billing evidence has not been independently verified. This conservative claim is about incomplete evidence, not a requirement to purchase API usage. No configured monetary cap is claimed. |
| 3 | One command for every check | 10 | 10 | [README](README.md#3-fresh-clone-setup), [root runner](scripts/run-check.mjs), [CI](.github/workflows/ci.yml): same four commands; pinned Python tools; LF checkout policy and clean-clone verification recorded in AI-LOG. |
| 4 | CI that blocks a merge | 20 | 19 | [Protected-main snapshot](docs/evidence/main-ruleset.json); PR #3 red run, repair commit and green run are linked in [PA2.md](PA2.md#3-a-red-gate-and-its-green-repair). Review and required check remain enforced. |
| 5 | Contract of one endpoint | 25 | 24 | [POST submissions contract](docs/contract/post-submissions.md): role and active enrollment, field/transport limits, every error type and status, student-scoped idempotency, retention, concurrency and evolution policy. |
| 6 | Contract tests that bite | 15 | 15 | [Original contract suite](gateway/test/submissions.contract.spec.ts) and [boundary regressions](gateway/test/submission-boundaries.contract.spec.ts) cover error types, ownership, JWT verification, retries, concurrency and 500 redaction. [PR #5 deliberate break and failing CI](PA2.md#4-a-deliberate-contract-break-caught-by-ci). |
| 7 | AI-LOG | 5 | 5 | [AI-LOG.md](AI-LOG.md) identifies tools/tasks and concrete Changed/Rejected entries. The 2026-11-11 correction explicitly supersedes earlier inaccurate implementation and spending-cap claims. |
| | **Total** | **100** | **96** | |

## What we did not manage

- The team currently uses the Gemini API free tier and may change plans later. Redacted evidence of the actual account's plan, quotas and billing restrictions is not yet included. No paid plan or configured monetary cap is claimed. Free-tier eligibility is not treated as a paid-API requirement; acceptance of those controls under the spending-cap criterion should be confirmed with the lecturer.
- Tests make no real model calls and incur no model API cost. A production per-lab cost has not been measured.
- The PA#2 submission repository is in-memory and empty outside tests. It is not durable or safe across multiple processes; transaction-backed persistence is later work.
- RabbitMQ delivery, judge sandbox execution, account/token issuance and real constraint/model checking remain later-checkpoint work. A `QUEUED` response is not proof of queue delivery.
- A peer's review and merge remain governed by the protected-main ruleset. No bypass or direct push to main is used to finish this checkpoint.

The submission ZIP is named `23120244-23120285-23120314_96.zip`, includes `.git`, and uses the same total as this table.
