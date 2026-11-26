---
name: checker-eval-runner
description: >-
  Validates LeeTKOB's constraint checker, hard rules, dev-set integrity, offline
  MODEL_OFF=1 execution, and real-model eval artifacts. Use this skill whenever
  modifying checker code, prompts, AST rules, Dockerfile, or eval datasets.
---

# Checker & Eval Verification

Use this runbook to verify PA#3/PA#4 Criteria 3, 4, 5, and 6 for `checker/`.

## Steps

1. **Verify Published Dev-Set Integrity (SHA-256)**
   Check that the lecturer's published dev set has not been modified byte-for-byte:
   - `eval.mjs` SHA-256 must start with `c836edd8713521bb`.
   - `labels.jsonl` SHA-256 must start with `262cda7b0ef5612e`.
   - Confirm team-authored cases (at least 5 Accepted solutions, including >=1 trap and >=1 injection) live in a **separate directory** with the same layout.

2. **Scan for Dev-Set Overfitting**
   Search `checker/` source and prompts to confirm no dev-set problem IDs (`sort-merge`, `s01`..`s05`, etc.) or quoted dev-set code appear in rules or prompts.

3. **Run Offline Unit & Guardrail Tests**
   Run `npm run test` (or `python -m pytest checker`) with no network:
   - Ban-list (`Do not use` / `Do not call`) traps pass with 0 wrongful deductions: student's own `sort` in a namespace, banned names in comments/strings, `<algorithm>` included only for `std::swap`.
   - Fake-model tests prove invalid JSON schema -> `unsure` and timeout -> `unsure`.
   - No real LLM API call occurs during unit tests.

4. **Run Dockerized Checker with `MODEL_OFF=1` and `--network none`**
   Build the checker image from the README command and execute it against the dev set with:
   - `--network none`, `MODEL_OFF=1`, memory and PID limits, and a 10-minute timeout.
   - Re-score the generated JSONL with `eval.mjs`: exit code must be `0` or `1` (never `2`).
   - Confirm every ban-list pair is decided with 0 wrongful deductions and every semantic pair outputs `unsure`.

5. **Audit Committed Real-Model Run Artifacts**
   Confirm the committed real-run folder contains all three files from the **same** run:
   - `predictions.jsonl` (re-score with `eval.mjs` to verify reported metrics match exactly).
   - `eval.mjs` report output.
   - Call log containing: stripped prompt (no comments, no student ID/name), real provider `request_id`, `model`, token counts, latency, and cost per call.
   - Verify `README.md` and `AI-LOG.md` document the model name and arithmetic for an 80-submission lab cost.
