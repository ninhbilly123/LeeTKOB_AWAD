# PA#2 submission and account-owner checklist

## Model project and cap (not completed)

The owner confirmed on 2026-11-11 that there is no dedicated LeeTKOB project and no configured spending cap. This cannot be truthfully marked complete from repository configuration.

1. In Google AI Studio, select or create the intended LeeTKOB project under the owner's account. Do not use an unrelated project's credentials.
2. In that project's **Spend** page, use **Monthly spend cap > Edit spend cap** to configure the proposed **$10 USD/month** cap, if available for that account/plan. Do not enable paid usage or link a payment method merely to obtain this screenshot without the owner's decision.
3. Save evidence with API keys, billing identifiers and unrelated projects hidden. Record the project, date, limit and enforcement mechanism; then update README, PA2 and the self-assessment only to reflect what was actually configured.
4. An alerts-only Cloud Billing budget is not a spend cap. Follow [Gemini billing](https://ai.google.dev/gemini-api/docs/billing) or the eligible-service [Cloud Billing spend-cap instructions](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps).

The PA#2 tests and placeholder checker do not call the model. Keep paid calls disabled until this account setup is complete.

## Protected-main review and tag

- Review the repair PR and its required quality gate. A team member other than the author must approve before merging; preserve the ruleset.
- Run the four documented commands and use `pa2` only for the intended submission commit. Never force-move an existing submission tag.
- Confirm the tag-triggered CI run is green. [Tag checks](https://github.com/ninhbilly123/LeeTKOB_AWAD/commit/pa2/checks) and [tag workflow runs](https://github.com/ninhbilly123/LeeTKOB_AWAD/actions/workflows/ci.yml?query=branch%3Apa2) are linked in PA2.md.
- Submit `23120244-23120285-23120314_96.zip`, including `.git` and `SELF_ASSESSMENT_REPORT.md`, from a team member's student account. Exclude `.env`, dependencies, caches and generated build artifacts.
