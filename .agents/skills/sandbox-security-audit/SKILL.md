---
name: sandbox-security-audit
description: >-
  Audits the LeeTKOB C++ judge sandbox and queue worker against the 9 mandatory
  isolation minimums and restart idempotency requirements. Use this skill when
  building, changing, or reviewing judge/, Dockerfiles, sandbox runners, or CI
  sandbox tests.
---

# Sandbox & Queue Security Audit

Use this runbook to verify PA#3 Criterion 2 (Queue and Sandbox) and Session 06 security rules.

## Steps

1. **Inspect Sandbox Invocation & Red-Flag Scan**
   Verify both `g++ -std=c++17 -O2` compilation and execution happen **inside** the sandbox container with:
   - `--network none`
   - `--user 65534:65534` (non-root)
   - `--read-only` + bounded `--tmpfs`
   - `--memory 256m --memory-swap 256m` (equal values, swap disabled)
   - `--pids-limit` (e.g., 16 or 64)
   - `--cpus 1`
   - `--cap-drop ALL --security-opt no-new-privileges`
   - Wall-clock timeout that kills the **entire container**, not only a child process.

   Grep `judge/` and `.github/` to confirm **zero** occurrences of:
   `-v /var/run/docker.sock`, `--privileged`, `--env-file`, `-e MODEL_API_KEY`, `-e GEMINI_API_KEY`, or host directory mounts into the sandbox.

2. **Verify All 9 Attack Submissions Exist and Fail as Expected**
   Confirm each minimum has a real attack `.cpp` test running in CI on tag `pa3`:
   1. Network connect attempt -> blocked.
   2. Infinite CPU loop -> `TLE`.
   3. Wall-clock hang (e.g., `sleep` / fork holding stdout) -> container killed cleanly.
   4. Memory exhaustion (e.g., 1 GiB allocation) **that reads back allocated memory** (prevents `g++ -O2` from optimizing allocation away) -> `MLE` or `RE`.
   5. Fork bomb (`for(;;) fork();`) -> capped by `--pids-limit`.
   6. Infinite stdout flood -> capped by output limit (`RE`).
   7. `getuid() == 0` check -> non-root UID confirmed.
   8. Host write / `/var/run/docker.sock` probe -> denied / missing.
   9. `getenv("GEMINI_API_KEY")` and `#include "/app/.env"` -> secret absent from output and compile errors.

3. **Verify Queue Worker "Judged Exactly Once"**
   Run or inspect the integration test / recording proving:
   - Stop worker -> submit code -> start worker again -> submission transitions `QUEUED` -> judged.
   - Redelivering the same job message stores **exactly one** verdict set for that submission.
