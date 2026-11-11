# PA#2 submission and usage-plan checklist

## Current plan: free tier

The team confirmed on 2026-11-11 that it currently uses the Gemini API free tier. It may change plans in the future if necessary. PA#2 does not require purchasing API usage or selecting a $10/month budget.

- Record the actual provider, plan, available quotas and billing restrictions. Save redacted evidence from the account console; do not expose API keys or billing identifiers.
- The team has supplied a [reviewed API Keys screenshot](evidence/free-tier.md) showing project LeeTKOB, an existing key entry, Free tier and Set up billing. The full credential is not visible.
- Do not describe a quota as a configured monetary cap, or claim that billing is disabled without checking the account. The supplied image does not show numerical quotas or a monetary-cap configuration; record further evidence only if it is actually provided.
- The class brief explicitly permits free tiers. If the team relies on free-plan restrictions to satisfy the PA#2 spending-cap criterion, confirm the grading interpretation with the lecturer and cite the answer.
- The PA#2 placeholder checker and tests make no real model calls, so their model API cost is $0. This is not a measured cost per production lab.

## If the team later chooses paid usage

1. Confirm the provider/project and decide on a suitable spending limit before enabling paid usage. No fixed $10 amount or monthly period is imposed by the class brief or PA#2 rubric.
2. Configure the provider's actual spend control for that plan. An alerts-only billing budget is not an enforced cap. Follow [Gemini billing](https://ai.google.dev/gemini-api/docs/billing) or the eligible-service [Cloud Billing spend-cap instructions](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps).
3. Update README, PA2, AI-LOG and the self-assessment with what was actually configured and evidence with credentials hidden. Measure and document the per-lab cost when real integration exists.

## Protected-main review and submission reference

- Changes go through a reviewed PR and the required quality gate. Preserve the main ruleset.
- Run the four documented commands for the intended submission revision. The published `pa2` tag and ZIP are snapshots: documentation edits after that tag are not automatically included in them. Do not silently move a published submission tag.
- Confirm the tag-triggered CI is green for the chosen submission commit. [Tag checks](https://github.com/ninhbilly123/LeeTKOB_AWAD/commit/pa2/checks) and [tag workflow runs](https://github.com/ninhbilly123/LeeTKOB_AWAD/actions/workflows/ci.yml?query=branch%3Apa2) are linked in PA2.md.
- The team's proposed total is now **100**. Finalize the submission revision with the supplied image, then build `23120244-23120285-23120314_100.zip`. The final ZIP must match that commit, include `.git` and `SELF_ASSESSMENT_REPORT.md`, and exclude `.env`, dependencies, caches and generated builds. The earlier `_96.zip` and published tag are not automatically updated by this documentation change.
