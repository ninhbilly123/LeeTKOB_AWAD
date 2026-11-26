---
name: checkpoint-packaging
description: >-
  Performs the final pre-submission audit, Syllabus Rule check, tag verification,
  and clean ZIP packaging for CSC13114 project checkpoints (PA#3, PA#4, PA#5). Use
  this skill before tagging a release or building the submission ZIP archive.
---

# Checkpoint Pre-Submission & Packaging

Use this runbook before tagging (`pa3`, `pa4`, `pa5`) and submitting the team ZIP.

## Steps

1. **Verify the Syllabus Rule (Zero-Tolerance Gate)**
   - Confirm no LLM verdict automatically alters a student's grade or appears to a student as a deduction without TA confirmation.
   - Confirm every LLM call enforces both **JSON schema validation** and a **timeout** (converting failures to `unsure`).
   - Confirm student endpoints before Publish return only `overallVerdict` and `testVerdicts[]` (citing `FAQ-02`, `FAQ-08`, `FAQ-09`, `FAQ-10`).

2. **Verify Offline Clean-Clone Reproducibility**
   - From a clean checkout following `README.md`, install dependencies, disconnect network (or run in a `--network none` container), and run all four canonical commands (`npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run test`).
   - Confirm all four exit `0` within 15 minutes.

3. **Verify Checkpoint Report (`PA3.md` / `PA4.md` / `PA5.md`)**
   Confirm the root milestone report links to every required artifact:
   - Public repository URL and live deployment URL.
   - Demo accounts (1 admin, 2 TAs in 2 different classes, 2 students in TA 1's class; no real user data).
   - Tag-triggered CI run URL (showing sandbox tests passing).
   - Checker CLI command, Docker build/run lines, and `MODEL_OFF=1` switch.
   - Committed real-model dev-set run folder (`predictions.jsonl`, `eval.mjs` report, call log).
   - Screen recording link (<= 5 minutes) demonstrating the full end-to-end flow on the deployment.

4. **Verify `SELF_ASSESSMENT_REPORT.md`**
   - One row per rubric criterion, claimed marks, concrete evidence links (file, commit, PR, or CI run), and a concise *What we did not manage* section.
   - Confirm the arithmetic total matches the ZIP filename.

5. **Tag & Build Clean Submission ZIP**
   - Push the milestone tag (`git tag <tag> && git push origin <tag>`) and confirm its CI run is green.
   - Build `23120244-23120285-23120314_<total>.zip` including `.git/`, `SELF_ASSESSMENT_REPORT.md`, `AI-LOG.md`, and `PA<N>.md`, while excluding `node_modules/`, `.env`, `dist/`, `coverage/`, and Python/tool caches.
   - Verify the ZIP contents before handing in from a `<StudentID>@student.hcmus.edu.vn` Google account.
