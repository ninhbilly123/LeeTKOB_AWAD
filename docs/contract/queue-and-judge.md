# Internal Service Contract: Durable Queue, Judge Worker, and Checker HTTP Bridge (Task N1)

- **Scope:** Internal data & RPC contracts synchronizing `gateway/` (D1/D2), PostgreSQL 16 Durable Queue (`submission_jobs`), `judge/` (standalone worker N1/N2), and `checker/` (Python AST + Gemini semantic checker K1–K3).
- **References:** [auth-and-labs.md](auth-and-labs.md), [checker-output.md](checker-output.md), [FAQ.md](../proposal/FAQ.md) (`FAQ-02`, `FAQ-04`, `FAQ-05`, `FAQ-06`, `FAQ-08`, `FAQ-09`, `FAQ-10`), [engineering-rules.md](../engineering-rules.md).

---

## 1. Queue Architecture (PostgreSQL 16 Durable Queue)

LeeTKOB uses the normalized `submission_jobs` table as a transactional outbox and durable queue (zero dual-write gap, zero extra broker RAM):

1. **Enqueue (Gateway):** Inside `createSubmissionAtomic()`, Gateway atomically inserts `submissions` (`pipeline_status = 'QUEUED'`), `submission_jobs` (`stage = 'JUDGE'`, `status = 'PENDING'`), `idempotency_records`, and fires `SELECT pg_notify('submission_jobs_ready', job_id)` before `COMMIT`.
2. **Claim (Judge Worker):** Worker claims at most one job per short transaction via:
   ```sql
   SELECT id, payload
   FROM submission_jobs
   WHERE stage = $1 AND status = 'PENDING' AND available_at <= NOW()
   ORDER BY available_at ASC, created_at ASC
   FOR UPDATE SKIP LOCKED
   LIMIT 1
   ```
   and marks `status = 'PROCESSING'`, `attempts = attempts + 1`, `locked_by = workerId`, `locked_at = NOW()`. For `stage = 'JUDGE'`, `submissions.pipeline_status` transitions from `'QUEUED'` to `'JUDGING'`.
3. **Wakeup & Recovery:** Worker maintains a dedicated `LISTEN submission_jobs_ready` connection with a 1-second fallback poll and a periodic `requeueStaleJobs(staleAfterSeconds)` sweep to reclaim jobs whose worker crashed mid-run.
4. **No Long Transactions:** Database connections and transactions are NEVER held open while compiling/executing C++ code or calling the `checker` HTTP endpoint.

---

## 2. Job Payload Contract (`submission_jobs.payload`)

```json
{
  "id": "job_4b2a9d10-3c1f-4e8a-9b72-123456789abc",
  "submissionId": "sub_9f8c1b82-412e-4b68-8a8b-18a7c6f0923e",
  "labId": "lab_018f2d5e-7a91-7f3c-b26a-98124d63e001",
  "studentId": "std_23120244",
  "studentIdentifiers": [
    "std_23120244",
    "student1",
    "student1@leetkob.edu.vn",
    "Student One"
  ],
  "statement": "# Sorting Lab — Merge Sort\n...",
  "code": "#include <iostream>\nint main() { ... }",
  "submittedAt": "2026-11-28T07:30:00.000Z",
  "limits": {
    "cpuTimeSec": 1,
    "wallTimeSec": 3,
    "memoryMb": 256,
    "maxProcesses": 16,
    "outputLimitBytes": 1048576
  },
  "testCases": [
    { "id": "tc_1", "input": "3\n3 1 2\n", "expectedOutput": "1 2 3\n" }
  ],
  "constraints": [
    { "id": "C1", "code": "C1", "text": "Do not call `std::sort`.", "deduction": 3 }
  ],
  "stage": "JUDGE",
  "status": "PENDING",
  "attempts": 0,
  "lastError": null,
  "createdAt": "2026-11-28T07:30:00.000Z"
}
```

---

## 3. Judge Result & Verdict Rules (`FAQ-02`, `FAQ-04`, `FAQ-05`)

- **Compiler:** `g++ -std=c++17 -O2`, 10-second compile timeout (`CE`). All temporary host/container paths are scrubbed to `solution.cpp` in `compile_output`.
- **Per-Test Evaluation:** All `K` test cases run sequentially; stdout comparison trims trailing spaces/tabs per line (`rtrim`) and trailing blank lines. Stdout exceeding `limits.outputLimitBytes` (1 MB) returns `RE`.
- **No Test I/O Persisted:** Only `(submission_id, ordinal, verdict, time_ms, memory_kb)` is written to `submission_test_results` (`FAQ-02`).
- **Overall Verdict & Stage Transition:**
  - All tests `AC` → `overall_verdict = 'AC'`, `checker_status = 'PENDING'`, `submission_jobs.stage = 'CHECK'`, `status = 'PENDING'`, `pg_notify('submission_jobs_ready', submission_id)`.
  - Any non-`AC` test → `overall_verdict` = first non-`AC` verdict, `checker_status = 'NOT_APPLICABLE'`, `submission_jobs.status = 'DONE'`. Checker is **not** invoked (`FAQ-04`). `rebalanceLabPassSample()` runs so `FAQ-10` 10% sampling stays balanced if a non-`AC` resubmission superseded an earlier `AC` submission.

---

## 4. Internal Checker HTTP Contract (`checker/src/server.py`)

`checker` runs as an isolated internal service holding `GEMINI_API_KEY`. Neither `judge-worker` nor the C++ sandbox ever receives `GEMINI_API_KEY` or `MODEL_API_KEY`.

### 4.1 `GET /health`
- Returns `200 OK`:
  ```json
  { "status": "ok", "service": "checker", "modelOff": false }
  ```

### 4.2 `POST /check`
- **Transport Limits & Headers:**
  - `Content-Length` header MUST be a valid integer in `[1, 1048576]` (**1 MiB** `MAX_REQUEST_BYTES` safety cap); otherwise returns `400 Bad Request`.
  - Request and response `Content-Type`: `application/json; charset=utf-8`.
- **Request Body (`application/json`):**
  ```json
  {
    "submissionId": "sub_123",
    "statement": "# Problem...",
    "sourceCode": "#include <iostream>\n...",
    "constraints": [
      { "id": "C1", "text": "Do not call `std::sort`." },
      { "id": "C2", "text": "Use merge sort." }
    ],
    "studentIdentifiers": ["std_23120244", "student1", "student1@leetkob.edu.vn", "Student One"],
    "costCapExceeded": false,
    "timeoutSeconds": 15,
    "model": "gemini-3.1-flash-lite-preview"
  }
  ```
  | Field | Type | Required | Rules & Defaults |
  |---|---|:---:|---|
  | `submissionId` | `string` | **Yes** | Non-empty trimmed string. |
  | `sourceCode` | `string` | **Yes** | Non-empty C++17 source code. |
  | `statement` | `string` | No | Problem Markdown statement (default `""`). |
  | `constraints` | `Array<{ id: string; text: string }>` | **Yes** | Array of constraint objects; each requires non-empty `id` and `text`. |
  | `studentIdentifiers` | `string[]` | No | Identifiers to scrub before prompting (default `[]`). |
  | `costCapExceeded` | `boolean` | No | When `true`, skips LLM calls and emits `unsure` (`COST_CAP_EXCEEDED`; default `false`). |
  | `timeoutSeconds` | `number` | No | Strictly positive timeout in seconds (`> 0`; default `15`). |
  | `model` | `string \| null` | No | Optional model override; non-empty string when provided, else `GEMINI_MODEL` env default. |
- **Response (`200 OK`, `application/json`):** Exact `CheckerResult` schema from [checker-output.md](checker-output.md):
  ```json
  {
    "submissionId": "sub_123",
    "results": [
      {
        "constraint": "C1",
        "source": "HARD_RULE",
        "verdict": "pass",
        "evidence": [],
        "unsureReason": null,
        "reason": null
      }
    ],
    "model": "gemini-3.1-flash-lite-preview",
    "promptVersion": "v1",
    "checkedAt": "2026-11-28T07:31:00.000Z",
    "callLogs": []
  }
  ```
- **Error Responses (Internal Service Schema):**
  - `400 Bad Request` (`{"error": "<validation message>"}`): Missing/invalid `Content-Length`, body > 1 MiB, invalid UTF-8/JSON, or missing/invalid request field.
  - `404 Not Found` (`{"error": "Not Found"}`): Unknown `GET` or `POST` path on the internal server.
- **Compatibility, Retry & Fail-Safe Guardrail in Worker:**
  - Unknown extra JSON properties on `POST /check` are ignored by `parse_check_request()`, allowing additive producer updates without lockstep deploys.
  - `POST /check` is stateless and side-effect-free on the checker side; worker retries on transient failures are safely deduplicated on persistence via `UNIQUE (submission_id, constraint_id)` and `UNIQUE (submission_id, call_ordinal)` (Section 5).
  - If `POST /check` times out or returns HTTP 5xx / invalid JSON, the worker degrades every constraint safely to `verdict: "unsure"` (`unsureReason: "TIMEOUT"` or `"PROVIDER_ERROR"`) instead of dropping the submission or inventing a deduction (`FAQ-09`, Syllabus Rule).

---

## 5. Idempotency & Redelivery Invariant (`PA#3 Criterion 2`)

Even if a worker crashes mid-processing and a job is reclaimed and executed a second time:
- `submissions`: updated in place by primary key `id`.
- `submission_test_results`: `PRIMARY KEY (submission_id, ordinal)` with `ON CONFLICT DO UPDATE` + `DELETE WHERE ordinal > total_tests` guarantees exactly one per-test verdict set.
- `constraint_findings`: `UNIQUE (submission_id, constraint_id)` with `ON CONFLICT DO UPDATE` guarantees exactly one finding per constraint.
- `model_call_logs`: `UNIQUE (submission_id, call_ordinal)` with `ON CONFLICT DO UPDATE` + partial unique index `uniq_model_call_logs_req_id` prevents duplicate call logs while safely recording `TIMEOUT` / `PROVIDER_ERROR` entries with empty `request_id`.
