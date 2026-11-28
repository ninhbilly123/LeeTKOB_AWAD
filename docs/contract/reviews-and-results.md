# API Contract: Student Results, TA Review Queue & Grade Publishing (Task D2)

- **Endpoints (Baseline & `/v1` Alias):**
  - `GET /labs/{labId}/submissions` (`GET /v1/labs/{labId}/submissions`) — Keyset cursor-paginated list of submissions in a lab (role-scoped summary).
  - `GET /labs/{labId}/submissions/{submissionId}` (`GET /v1/labs/{labId}/submissions/{submissionId}`) — Student-safe submission result (Syllabus Rule sanitized).
  - `GET /submissions/{submissionId}` (`GET /v1/submissions/{submissionId}`) — Direct role-dispatched submission lookup (`STUDENT` → sanitized result; `TA`/`ADMIN` → full review view).
  - `GET /labs/{labId}/review-queue` (`GET /v1/labs/{labId}/review-queue`) — Keyset cursor-paginated TA constraint review queue (`scope=counted` default | `scope=all`).
  - `GET /labs/{labId}/submissions/{submissionId}/review` (`GET /v1/labs/{labId}/submissions/{submissionId}/review`) — TA single-submission inspection (full C++ source, test verdicts, all findings).
  - `PATCH /labs/{labId}/submissions/{submissionId}/findings/{findingId}` (`PATCH /v1/labs/{labId}/submissions/{submissionId}/findings/{findingId}`) — TA review decision (`PASS` / `VIOLATION`) with evidence and audit logging.
  - `POST /labs/{labId}/publish` (`POST /v1/labs/{labId}/publish`) — Atomic, state-idempotent lab grade publishing gated by deadline, judge/checker completion, and zero pending reviews.
- **Referenced FAQs & Contracts:** [FAQ-01](../proposal/FAQ.md#faq-01), [FAQ-02](../proposal/FAQ.md#faq-02), [FAQ-03](../proposal/FAQ.md#faq-03), [FAQ-04](../proposal/FAQ.md#faq-04), [FAQ-08](../proposal/FAQ.md#faq-08), [FAQ-09](../proposal/FAQ.md#faq-09), [FAQ-10](../proposal/FAQ.md#faq-10), [FAQ-11](../proposal/FAQ.md#faq-11), [FAQ-12](../proposal/FAQ.md#faq-12), [checker-output.md](checker-output.md), [post-submissions.md](post-submissions.md), PA#3 Syllabus Rule.

---

## 1. Conventions

### 1.1 Media Types, Identifiers, Time & Units
- **Request `Content-Type`:** `application/json` is mandatory on `PATCH` writes (`415 Unsupported Media Type` otherwise). `POST /labs/{labId}/publish` accepts an empty body or `application/json`. Raw JSON bodies > **512 KiB** return `413 Payload Too Large`.
- **Success `Content-Type`:** `application/json`.
- **Error `Content-Type`:** `application/problem+json` ([RFC 9457](https://datatracker.ietf.org/doc/html/rfc9457)).
- **Path Versioning:** Every route is served equivalently at its baseline path and under the `/v1` prefix (e.g., `/v1/labs/{labId}/review-queue`). RFC 9457 `instance` reflects the requested URL path.
- **Identifiers:** Opaque prefixed strings — labs (`lab_*`), submissions (`sub_<uuid>`), constraint findings (`fnd_*`), constraints (`con_*` / `C1..Cn`), users (`usr_*` / `std_*`).
- **Timestamps:** ISO 8601 UTC strings (e.g. `2026-11-25T10:00:00.000Z`).
- **Scores & Deductions:** Decimal points in `[0, 10]` at HTTP edges; stored internally in PostgreSQL as integer centipoints `[0, 1000]` to prevent floating-point drift.
- **Execution Metrics:** `timeMs` in milliseconds (`>= 0`), `memoryKb` in kilobytes (`>= 0`).
- **Unknown Fields:** Extra unrecognized JSON properties in request bodies are ignored unless a field-level validation rule explicitly rejects them.

### 1.2 Authentication, Roles & Ownership
All endpoints in this contract require a signed `HS256` Bearer JWT (`Authorization: Bearer <token>`). Missing, malformed, invalid-signature, or expired tokens return `401 Unauthorized`.

**Authorization Status Policy:** Unauthenticated callers receive `401`. Authenticated callers lacking role permission or class/submission ownership receive `403 Forbidden` (pinned across PA#2/PA#3 contracts and `PA3_rubric.md` Criterion 1). Missing `labId`, `submissionId` (or belonging to a different lab), or `findingId` returns `404 Not Found`.

| Endpoint | `STUDENT` (Enrolled) | `STUDENT` (Not Enrolled) | `TA` (Owning Class) | `TA` (Other Class) | `ADMIN` |
|---|:---:|:---:|:---:|:---:|:---:|
| `GET /labs/{labId}/submissions` | Own submissions only (`200`) | `403 Forbidden` | All lab submissions (`200`) | `403 Forbidden` | All (`200`) |
| `GET /labs/{labId}/submissions/{submissionId}` | Own submission (`200`); other student's → `403` | `403 Forbidden` | `200` (sanitized view) | `403 Forbidden` | `200` |
| `GET /submissions/{submissionId}` | Own submission sanitized (`200`); other → `403` | `403 Forbidden` | Full TA review (`200`) | `403 Forbidden` | Full TA review (`200`) |
| `GET /labs/{labId}/review-queue` | `403 Forbidden` | `403 Forbidden` | `200 OK` | `403 Forbidden` | `200 OK` |
| `GET /labs/{labId}/submissions/{submissionId}/review` | `403 Forbidden` | `403 Forbidden` | `200 OK` | `403 Forbidden` | `200 OK` |
| `PATCH /labs/{labId}/submissions/{submissionId}/findings/{findingId}` | `403 Forbidden` | `403 Forbidden` | `200 OK` | `403 Forbidden` | `200 OK` |
| `POST /labs/{labId}/publish` | `403 Forbidden` | `403 Forbidden` | `200 OK` | `403 Forbidden` | `200 OK` |

### 1.3 Privacy, Grading Visibility & Keyset Pagination Conventions
1. **Student Before Publish (`isPublished === false`, `FAQ-02`, `FAQ-08`):**
   - Student responses return **only** pipeline status, `overallVerdict`, `passedTests`, `totalTests`, `maxTimeMs`, `maxMemoryKb`, `isCounting`, `submittedAt`, and `testVerdicts[]` (`ordinal`, `verdict`, `timeMs`, `memoryKb`).
   - Student responses **strictly omit** `code`, test `input`, `expectedOutput`, `actualOutput`, compiler/runtime internals, and **all** checker/review fields (`findings`, `verdict`, `source`, `evidence`, `unsureReason`, `reason`, `proposedDeduction`, `deductions`, `finalScore`, `isSampledPass`).
2. **Student After Publish (`isPublished === true`, `FAQ-04`, `FAQ-08`, `FAQ-11`):**
   - Adds `publishedAt`, `finalScore`, and `deductions[]`.
   - `finalScore`: if `manualScore` was explicitly set by a TA (`FAQ-04`), returns `manualScore`; otherwise for `overallVerdict === 'AC'`, $\max(0, 10 - \sum \text{taDeduction})$ across distinct `constraintCode` entries with `reviewStatus === 'APPROVED_VIOLATION' && taDecision === 'VIOLATION'` (each constraint deducted at most once); for non-`AC`, `0`.
   - `deductions[]` includes **only** TA-approved violations (`APPROVED_VIOLATION`). Students **never** see `unsure` verdicts, `DISMISSED_PASS` proposals, checker `source`, `unsureReason`, or `isSampledPass`.
3. **TA Review Queue Sampling (`FAQ-02`, `FAQ-10`):**
   - Default queue (`scope=counted`) evaluates only each student's **counted** (`isCounting === true`) `AC` submission.
   - Included findings: **100%** of `violation`, **100%** of `unsure`, and **10% rounded up** (`Math.ceil(0.10 * totalPassFindings)`) of `pass` findings across counted `AC` submissions in the lab, selected randomly (at least 1 when `totalPassFindings >= 1`).
   - TAs can inspect **any** submission in their lab (including non-`AC`, superseded, or non-sampled `pass` submissions) via `GET /labs/{labId}/submissions` + `GET /labs/{labId}/submissions/{submissionId}/review` (or `GET /submissions/{submissionId}`) and override any finding (`FAQ-10`).
4. **Keyset Cursor Pagination (`GET /labs/{labId}/submissions`, `GET /labs/{labId}/review-queue`):**
   - Query params: `cursor` (optional opaque Base64URL string), `limit` (optional integer `1..100`, default `50`).
   - Stable unique sort keys (never `OFFSET`):
     - `GET /labs/{labId}/submissions`: `(submittedAt DESC, id DESC)`, scope `lab-submissions:{labId}:{studentId | all}`.
     - `GET /labs/{labId}/review-queue`: `(submittedAt DESC, submissionId DESC, constraintCode ASC)`, scope `review-queue:{labId}:{scope}`.
   - Server fetches `limit + 1` rows; `nextCursor` is `null` iff no further rows remain.
   - Malformed cursors, cursors replayed across a different `labId` / `scope` / endpoint, or `limit` outside `1..100` return `400 Bad Request`.
   - Inserting newer submissions ahead of the cursor never shifts or duplicates items already returned on earlier pages; records removed or excluded by filter changes simply do not appear on subsequent pages.

---

## 2. Errors

Every error response returns `Content-Type: application/problem+json` with required members `type`, `title`, `status`, `detail`, and `instance`. Clients branch on `type`, never on `title` or `detail`.

- **Field-Level Validation Reporting (`errors[]`):** For body validation failures on `PATCH /labs/{labId}/submissions/{submissionId}/findings/{findingId}`, the `400 Bad Request` problem includes `errors: Array<{ field: string; message: string }>` listing **every** invalid field, while `detail` carries the first message.
- **Internal Server Errors (`500`):** Fixed safe detail only; attaches response header `X-Request-Id` and logs full stack internally without exposing SQL, paths, or stack traces.

| Status | `type` URI | `title` | Triggering Conditions | Extensions / Headers |
|:---:|---|---|---|---|
| `400` | `https://leetkob.edu.vn/errors/bad-request` | `Bad Request` | Malformed JSON; invalid `scope` query param; malformed/out-of-scope `cursor` or `limit` outside `1..100`; invalid `decision` / `deduction` / `evidence` / `reason`; `decision === 'VIOLATION'` without $\ge 1$ evidence line (`FAQ-09`); modifying a finding after Publish without a non-empty `reason` (`FAQ-12`). | `errors[]` on `PATCH` body validation errors |
| `401` | `https://leetkob.edu.vn/errors/unauthorized` | `Unauthorized` | Missing, malformed, invalid-signature, or expired Bearer JWT. | — |
| `403` | `https://leetkob.edu.vn/errors/forbidden` | `Forbidden` | Student accessing another student's submission (IDOR) or TA review/publish endpoints; TA accessing a lab outside assigned `class_staff`; unenrolled student accessing class lab. | — |
| `404` | `https://leetkob.edu.vn/errors/not-found` | `Not Found` | Unknown `labId`, `submissionId` (or not belonging to `labId`), `findingId`, or unknown route. | — |
| `409` | `https://leetkob.edu.vn/errors/conflict` | `Conflict` | `POST /labs/{labId}/publish` refused because: (a) `now < deadline` (`FAQ-12`), (b) any counted submission is not yet `COMPLETED` (`FAQ-03`), (c) any counted `AC` submission has `checkerStatus !== 'COMPLETED'`, or (d) any counted finding still has `reviewStatus === 'PENDING_REVIEW'` (`FAQ-12`). | — |
| `413` | `https://leetkob.edu.vn/errors/payload-too-large` | `Payload Too Large` | Raw JSON HTTP body exceeds 512 KiB transport limit. | — |
| `415` | `https://leetkob.edu.vn/errors/unsupported-media-type` | `Unsupported Media Type` | `PATCH` write missing `Content-Type: application/json`. | — |
| `500` | `https://leetkob.edu.vn/errors/internal-server-error` | `Internal Server Error` | Unexpected server/database failure (fixed safe detail; stack logged internally with `requestId`). | Header `X-Request-Id` |

### Example Problem Responses (`application/problem+json`)
- **400 Validation Error (`PATCH` with `errors[]`):**
```json
{
  "type": "https://leetkob.edu.vn/errors/bad-request",
  "title": "Bad Request",
  "status": 400,
  "detail": "Field 'decision' is required and must be 'PASS' or 'VIOLATION'.",
  "instance": "/labs/lab_1/submissions/sub_1/findings/fnd_1",
  "errors": [
    { "field": "decision", "message": "Field 'decision' is required and must be 'PASS' or 'VIOLATION'." },
    { "field": "deduction", "message": "Field 'deduction' must be a finite number between 0 and 10." }
  ]
}
```
- **409 Conflict (`POST /labs/{labId}/publish`):**
```json
{
  "type": "https://leetkob.edu.vn/errors/conflict",
  "title": "Conflict",
  "status": 409,
  "detail": "Cannot publish grades while 2 review item(s) remain PENDING_REVIEW (FAQ-12).",
  "instance": "/labs/lab_018f2d5e-7a91-7f3c-b26a-98124d63e001/publish"
}
```

---

## 3. Resources

### 3.1 `SubmissionSummaryItem`
Used inside `GET /labs/{labId}/submissions`:
```json
{
  "id": "sub_9f8c1b82-412e-4b68-8a8b-18a7c6f0923e",
  "labId": "lab_018f2d5e-7a91-7f3c-b26a-98124d63e001",
  "studentId": "std_23120244",
  "studentName": "Student One",
  "status": "COMPLETED",
  "overallVerdict": "AC",
  "passedTests": 2,
  "totalTests": 2,
  "maxTimeMs": 15,
  "maxMemoryKb": 3400,
  "isCounting": true,
  "submittedAt": "2026-11-21T07:30:00.000Z"
}
```

| Field | Type | Nullable | Rules |
|---|---|:---:|---|
| `id` | `string` | No | Opaque submission ID (`sub_*`). |
| `labId` | `string` | No | Owning lab ID. |
| `studentId` | `string` | No | Submitting student ID. |
| `studentName` | `string` | Optional | Display name fallback to username/ID. |
| `status` | `"QUEUED" \| "JUDGING" \| "COMPLETED" \| "JUDGE_ERROR"` | No | Execution pipeline state. |
| `overallVerdict` | `"AC" \| "WA" \| "TLE" \| "MLE" \| "RE" \| "CE" \| null` | Yes | Non-null iff `status === "COMPLETED"`. |
| `passedTests` | `integer` | No | `0 <= passedTests <= totalTests`. |
| `totalTests` | `integer` | No | Total test count (`>= 0`). |
| `maxTimeMs` | `integer \| null` | Yes | Peak test runtime in ms (`>= 0`) or `null`. |
| `maxMemoryKb` | `integer \| null` | Yes | Peak test memory in KB (`>= 0`) or `null`. |
| `isCounting` | `boolean` | No | `true` iff latest counted submission (`FAQ-02`). |
| `submittedAt` | `string (ISO 8601)` | No | Server receipt UTC timestamp. |

- **Omitted fields:** `code` and all checker findings are always omitted.

### 3.2 `StudentSubmissionResultView`
- **Before Publish (`isPublished: false`):** Strictly omits `code`, `publishedAt`, `finalScore`, `deductions`, `findings`, `evidence`, `unsureReason`, `isSampledPass`, and any test `input`/`expectedOutput`/`actualOutput`.
```json
{
  "id": "sub_9f8c1b82-412e-4b68-8a8b-18a7c6f0923e",
  "labId": "lab_018f2d5e-7a91-7f3c-b26a-98124d63e001",
  "studentId": "std_23120244",
  "status": "COMPLETED",
  "overallVerdict": "AC",
  "passedTests": 2,
  "totalTests": 2,
  "maxTimeMs": 15,
  "maxMemoryKb": 3400,
  "isCounting": true,
  "isPublished": false,
  "submittedAt": "2026-11-21T07:30:00.000Z",
  "testVerdicts": [
    { "ordinal": 1, "verdict": "AC", "timeMs": 12, "memoryKb": 3200 },
    { "ordinal": 2, "verdict": "AC", "timeMs": 15, "memoryKb": 3400 }
  ]
}
```
- **After Publish (`isPublished: true`):** Adds `publishedAt`, `finalScore`, and TA-approved `deductions[]`:
```json
{
  "id": "sub_9f8c1b82-412e-4b68-8a8b-18a7c6f0923e",
  "labId": "lab_018f2d5e-7a91-7f3c-b26a-98124d63e001",
  "studentId": "std_23120244",
  "status": "COMPLETED",
  "overallVerdict": "AC",
  "passedTests": 2,
  "totalTests": 2,
  "maxTimeMs": 15,
  "maxMemoryKb": 3400,
  "isCounting": true,
  "isPublished": true,
  "publishedAt": "2026-11-25T10:00:00.000Z",
  "submittedAt": "2026-11-21T07:30:00.000Z",
  "testVerdicts": [
    { "ordinal": 1, "verdict": "AC", "timeMs": 12, "memoryKb": 3200 },
    { "ordinal": 2, "verdict": "AC", "timeMs": 15, "memoryKb": 3400 }
  ],
  "finalScore": 7,
  "deductions": [
    {
      "constraintCode": "C1",
      "constraintText": "Do not call a library sort function: `std::sort`...",
      "deduction": 3,
      "evidence": [{ "line": 12, "text": "std::sort(a, a + n);" }],
      "reason": "Called std::sort directly instead of implementing merge sort."
    }
  ]
}
```

### 3.3 `TaReviewFindingView`
Used in `GET /labs/{labId}/review-queue` (`items[]`) and `GET /labs/{labId}/submissions/{submissionId}/review` (`findings[]`):
```json
{
  "findingId": "fnd_sub1_C1",
  "submissionId": "sub_9f8c1b82-412e-4b68-8a8b-18a7c6f0923e",
  "studentId": "std_23120244",
  "studentName": "Student One",
  "isCounting": true,
  "submittedAt": "2026-11-21T07:30:00.000Z",
  "constraintId": "con_lab1_C1",
  "constraintCode": "C1",
  "constraintText": "Do not call a library sort function: `std::sort`...",
  "configuredDeduction": 3,
  "proposedDeduction": 3,
  "source": "HARD_RULE",
  "verdict": "violation",
  "unsureReason": null,
  "evidence": [{ "line": 12, "text": "std::sort(a, a + n);" }],
  "reason": "AST detected banned call to std::sort.",
  "isSampledPass": false,
  "reviewStatus": "PENDING_REVIEW",
  "taDecision": null,
  "taDeduction": null,
  "taEvidence": null,
  "taReason": null,
  "reviewedBy": null,
  "reviewedAt": null
}
```
- `unsureReason`: one of `MODEL_UNSURE | SCHEMA_INVALID | EVIDENCE_MISMATCH | TIMEOUT | COST_CAP_EXCEEDED | MODEL_OFF | PROVIDER_ERROR | null` (`FAQ-09`, [checker-output.md](checker-output.md)). Non-null iff `verdict === "unsure"`.
- `proposedDeduction`: equals `configuredDeduction` when `verdict === "violation"`, and `0` when `verdict` is `"pass"` or `"unsure"`.
- `reviewStatus`: `"NOT_QUEUED" | "PENDING_REVIEW" | "APPROVED_VIOLATION" | "DISMISSED_PASS" | "OVERRIDDEN"`.

### 3.4 `ConstraintFindingRecord` (`PATCH .../findings/{findingId}` Response)
Returned by `PATCH /labs/{labId}/submissions/{submissionId}/findings/{findingId}`. Note that this persisted record uses `id` (the primary key of `constraint_findings`), whereas the joined `TaReviewFindingView` projects it as `findingId`.
```json
{
  "id": "fnd_sub1_C1",
  "submissionId": "sub_9f8c1b82-412e-4b68-8a8b-18a7c6f0923e",
  "labId": "lab_018f2d5e-7a91-7f3c-b26a-98124d63e001",
  "constraintId": "con_lab1_C1",
  "constraintCode": "C1",
  "source": "HARD_RULE",
  "verdict": "violation",
  "unsureReason": null,
  "evidence": [{ "line": 12, "text": "std::sort(a, a + n);" }],
  "reason": "AST detected banned call to std::sort.",
  "isSampledPass": false,
  "reviewStatus": "APPROVED_VIOLATION",
  "taDecision": "VIOLATION",
  "taDeduction": 3,
  "taEvidence": [{ "line": 12, "text": "std::sort(a, a + n);" }],
  "taReason": "Confirmed direct call to std::sort.",
  "reviewedBy": "usr_ta_01",
  "reviewedAt": "2026-11-25T09:50:00.000Z"
}
```

### 3.5 `PublishLabResponse`
```json
{
  "labId": "lab_018f2d5e-7a91-7f3c-b26a-98124d63e001",
  "isPublished": true,
  "publishedAt": "2026-11-25T10:00:00.000Z"
}
```

---

## 4. Endpoints

### 4.1 `GET /labs/{labId}/submissions`
- **Auth:** `STUDENT` (enrolled), `TA` (owning class), `ADMIN`.
- **Query Params:** `cursor` (optional opaque Base64URL keyset cursor), `limit` (optional integer `1..100`, default `50`).
- **Ordering:** `submittedAt DESC, id DESC`.
- **Response (`200 OK`):**
```json
{
  "labId": "lab_018f2d5e-7a91-7f3c-b26a-98124d63e001",
  "isPublished": false,
  "submissions": [],
  "nextCursor": null
}
```
For `STUDENT`, contains only caller's own submissions; for `TA`/`ADMIN`, contains all submissions in the lab.

### 4.2 `GET /labs/{labId}/submissions/{submissionId}`
- **Auth:** `STUDENT` (own submission in enrolled class; other student's → `403`), `TA` (owning class), `ADMIN`.
- **Response (`200 OK`):** `StudentSubmissionResultView` (Section 3.2).

### 4.3 `GET /submissions/{submissionId}`
- **Auth:** Any authenticated user with access to the submission's owning lab.
- **Behavior:** Direct lookup alias used by the Web UI (`web/src/api/http-client.ts`):
  - If caller role is `STUDENT` → delegates to `GET /labs/{labId}/submissions/{submissionId}` (`StudentSubmissionResultView`, enforcing IDOR `403` and Syllabus Rule redaction).
  - If caller role is `TA` or `ADMIN` → delegates to `GET /labs/{labId}/submissions/{submissionId}/review` (`TaSubmissionReviewResponse`, enforcing cross-class TA `403`).

### 4.4 `GET /labs/{labId}/review-queue`
- **Auth:** `TA` (owning class) or `ADMIN` (`STUDENT` and other-class `TA` → `403`).
- **Query Params:**
  - `scope`: `"counted"` (default) | `"all"`. Any other value → `400 Bad Request`.
  - `cursor`: optional opaque Base64URL keyset cursor bound to `(labId, scope)`.
  - `limit`: optional integer `1..100` (default `50`).
- **Ordering:** `(submittedAt DESC, submissionId DESC, constraintCode ASC)`.
- **Response (`200 OK`):**
```json
{
  "labId": "lab_018f2d5e-7a91-7f3c-b26a-98124d63e001",
  "labTitle": "Sorting Lab — Merge Sort",
  "scope": "counted",
  "isPublished": false,
  "publishedAt": null,
  "pendingReviewCount": 2,
  "items": [],
  "nextCursor": null
}
```
- `pendingReviewCount` always reflects the total `PENDING_REVIEW` count across the entire matching queue (not only the current page) so TA Publish readiness stays accurate during pagination.
- When `scope=counted`: includes only `isCounting === true` `AC` submissions and queued findings (`verdict === 'violation' || verdict === 'unsure' || isSampledPass === true || reviewStatus !== 'NOT_QUEUED'`).
- When `scope=all`: includes all `AC` submissions in the lab and all of their findings.

### 4.5 `GET /labs/{labId}/submissions/{submissionId}/review`
- **Auth:** `TA` (owning class) or `ADMIN` (`STUDENT` and other-class `TA` → `403`).
- **Response (`200 OK`):** `TaSubmissionReviewResponse`:
```json
{
  "labTitle": "Sorting Lab — Merge Sort",
  "isPublished": false,
  "publishedAt": null,
  "studentName": "Student One",
  "submission": {
    "id": "sub_9f8c1b82-412e-4b68-8a8b-18a7c6f0923e",
    "labId": "lab_018f2d5e-7a91-7f3c-b26a-98124d63e001",
    "studentId": "std_23120244",
    "code": "#include <iostream>\n...",
    "status": "COMPLETED",
    "overallVerdict": "AC",
    "checkerStatus": "COMPLETED",
    "passedTests": 2,
    "totalTests": 2,
    "isCounting": true,
    "submittedAt": "2026-11-21T07:30:00.000Z"
  },
  "testVerdicts": [
    { "ordinal": 1, "verdict": "AC", "timeMs": 12, "memoryKb": 3200 }
  ],
  "findings": []
}
```

### 4.6 `PATCH /labs/{labId}/submissions/{submissionId}/findings/{findingId}`
- **Auth:** `TA` (owning class) or `ADMIN` (`STUDENT` and other-class `TA` → `403`).
- **Headers:** `Content-Type: application/json` (required, else `415`), `Authorization: Bearer <jwt>`.
- **Request Body:**
```json
{
  "decision": "VIOLATION",
  "deduction": 3,
  "evidence": [{ "line": 12, "text": "std::sort(a, a + n);" }],
  "reason": "Confirmed direct call to std::sort."
}
```
- **Validation Order & Rules:**
  1. Body parser (`413`/`400`) → JWT (`401`) → `Content-Type: application/json` (`415`).
  2. Multi-field body validation (collects all invalid fields into `errors[]`, returns `400`):
     - `decision`: required `"PASS"` or `"VIOLATION"`.
     - `deduction` (optional): finite number in `[0, 10]`. Defaults to the lab constraint's `configuredDeduction` when `decision === "VIOLATION"`, forced to `0` when `decision === "PASS"`.
     - `evidence`: array of `{ line: int >= 1, text: non-empty string }`; required non-empty (`length >= 1`) when `decision === "VIOLATION"` (`FAQ-09`).
     - `reason`: optional string or `null` before Publish; **required non-empty string after Publish** (`lab.isPublished === true`, else `400`, `FAQ-12`).
  3. Authorization (`TA` owning class or `ADMIN` → `403`) → existence of `labId` / `submissionId` / `findingId` (`404`).
- **Persistence & Audit:** Atomically updates `constraint_findings` (`reviewStatus` → `"APPROVED_VIOLATION"` or `"DISMISSED_PASS"`) and inserts a `TA_REVIEW_FINDING` row into `audit_logs` capturing both `before_state` and `after_state` (`FAQ-10`, `FAQ-12`). On any `4xx`/`5xx` refusal, zero rows change.
- **Response (`200 OK`):** Updated `ConstraintFindingRecord` (Section 3.4).

### 4.7 `POST /labs/{labId}/publish`
- **Auth:** `TA` (owning class) or `ADMIN` (`STUDENT` and other-class `TA` → `403`).
- **Transactional Gate & State Idempotency (`FAQ-03`, `FAQ-10`, `FAQ-12`):**
  1. Lock the lab row (`SELECT ... FOR UPDATE`). If already published (`publishedAt !== null`), commit and return `200 OK` with the original `publishedAt` (safe idempotent retry without needing a client key).
  2. If `now < deadline` → `409 Conflict` (`ROLLBACK`, no mutation).
  3. If any counted submission (`isCounting === true`) has `status !== 'COMPLETED'` (still `QUEUED`, `JUDGING`, or `JUDGE_ERROR`) → `409 Conflict` (`ROLLBACK`, no mutation).
  4. If any counted `AC` submission has `checkerStatus !== 'COMPLETED'` → `409 Conflict` (`ROLLBACK`, no mutation).
  5. Rebalance the `FAQ-10` 10% `pass` sample across counted `AC` submissions.
  6. If any finding on a counted submission has `reviewStatus === 'PENDING_REVIEW'` → `409 Conflict` (`ROLLBACK`, no mutation).
  7. Set `labs.published_at = NOW()`, insert `PUBLISH_LAB_GRADES` into `audit_logs`, commit, and return `200 OK` (`PublishLabResponse`, Section 3.5).

---

## 5. Versions and the Legacy API

1. **Active Path Versioning (`/v1` & Baseline Alias):** All endpoints in this contract are served identically at `/v1/...` and their unprefixed baseline paths.
2. **Compatible (Non-Breaking) Additions:** Adding optional query params (`cursor`, `limit`), additive response pagination (`nextCursor`), optional `errors[]` extensions on `400`, `X-Request-Id` header on `500`, or additive metadata fields (`labTitle`, `studentName`, `maxTimeMs`, `maxMemoryKb`, `publishedAt`) without altering existing required keys or pre-publish student redaction invariants. Clients MUST ignore unknown JSON fields.
3. **Breaking Changes:** Changing RFC 9457 error `type` URIs, weakening pre-publish student redaction, altering `decision` / `verdict` / `unsureReason` enums, or changing `POST /labs/{labId}/publish` idempotency semantics requires path versioning (`/v2/...`) with `Deprecation` (RFC 9745), `Sunset` (RFC 8594), and `Link` headers during migration.
4. **Legacy Route Compatibility:** Both `GET /labs/{labId}/submissions/{submissionId}` (PA#3 canonical) and `GET /submissions/{submissionId}` (Web UI direct alias) are supported concurrently with identical authorization and Syllabus Rule enforcement.
