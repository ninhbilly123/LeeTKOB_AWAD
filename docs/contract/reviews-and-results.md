# API Contract: Student Results, TA Review Queue & Grade Publishing (Task D2)

- **Endpoints:**
  - `GET /labs/{labId}/submissions` — List submissions in a lab (role-scoped summary).
  - `GET /labs/{labId}/submissions/{submissionId}` — Student-safe submission result (Syllabus Rule sanitized).
  - `GET /submissions/{submissionId}` — Direct role-dispatched submission lookup (`STUDENT` → sanitized result; `TA`/`ADMIN` → full review view).
  - `GET /labs/{labId}/review-queue` — TA constraint review queue (`scope=counted` default | `scope=all`).
  - `GET /labs/{labId}/submissions/{submissionId}/review` — TA single-submission inspection (full C++ source, test verdicts, all findings).
  - `PATCH /labs/{labId}/submissions/{submissionId}/findings/{findingId}` — TA review decision (`PASS` / `VIOLATION`) with evidence and audit logging.
  - `POST /labs/{labId}/publish` — Atomic, idempotent lab grade publishing gated by deadline, judge/checker completion, and zero pending reviews.
- **Referenced FAQs & Contracts:** [FAQ-01](../proposal/FAQ.md#faq-01), [FAQ-02](../proposal/FAQ.md#faq-02), [FAQ-03](../proposal/FAQ.md#faq-03), [FAQ-04](../proposal/FAQ.md#faq-04), [FAQ-08](../proposal/FAQ.md#faq-08), [FAQ-09](../proposal/FAQ.md#faq-09), [FAQ-10](../proposal/FAQ.md#faq-10), [FAQ-11](../proposal/FAQ.md#faq-11), [FAQ-12](../proposal/FAQ.md#faq-12), [checker-output.md](checker-output.md), [post-submissions.md](post-submissions.md), PA#3 Syllabus Rule.

---

## 1. Conventions

### 1.1 Media Types, Identifiers, Time & Units
- **Request `Content-Type`:** `application/json` is mandatory on `PATCH` writes (returns `415 Unsupported Media Type` otherwise). `POST /labs/{labId}/publish` accepts an empty body or `application/json`.
- **Success `Content-Type`:** `application/json`.
- **Error `Content-Type`:** `application/problem+json` ([RFC 9457](https://datatracker.ietf.org/doc/html/rfc9457)).
- **Timestamps:** ISO 8601 UTC strings (e.g. `2026-11-25T10:00:00.000Z`).
- **Scores & Deductions:** Decimal points in `[0, 10]` at HTTP edges; stored internally in PostgreSQL as integer centipoints `[0, 1000]` to prevent floating-point drift.
- **Execution Metrics:** `timeMs` in milliseconds (`>= 0`), `memoryKb` in kilobytes (`>= 0`).
- **Unknown Fields:** Extra unrecognized JSON properties in request bodies are ignored unless a field-level validation rule explicitly rejects them.

### 1.2 Authentication, Roles & Ownership
All endpoints in this contract require a signed `HS256` Bearer JWT (`Authorization: Bearer <token>`). Missing, malformed, invalid-signature, or expired tokens return `401 Unauthorized`.

| Endpoint | `STUDENT` (Enrolled) | `STUDENT` (Not Enrolled) | `TA` (Owning Class) | `TA` (Other Class) | `ADMIN` |
|---|:---:|:---:|:---:|:---:|:---:|
| `GET /labs/{labId}/submissions` | Own submissions only (`200`) | `403 Forbidden` | All lab submissions (`200`) | `403 Forbidden` | All (`200`) |
| `GET /labs/{labId}/submissions/{submissionId}` | Own submission (`200`); other student's → `403` | `403 Forbidden` | `200` (sanitized view) | `403 Forbidden` | `200` |
| `GET /submissions/{submissionId}` | Own submission sanitized (`200`); other → `403` | `403 Forbidden` | Full TA review (`200`) | `403 Forbidden` | Full TA review (`200`) |
| `GET /labs/{labId}/review-queue` | `403 Forbidden` | `403 Forbidden` | `200 OK` | `403 Forbidden` | `200 OK` |
| `GET /labs/{labId}/submissions/{submissionId}/review` | `403 Forbidden` | `403 Forbidden` | `200 OK` | `403 Forbidden` | `200 OK` |
| `PATCH /labs/{labId}/submissions/{submissionId}/findings/{findingId}` | `403 Forbidden` | `403 Forbidden` | `200 OK` | `403 Forbidden` | `200 OK` |
| `POST /labs/{labId}/publish` | `403 Forbidden` | `403 Forbidden` | `200 OK` | `403 Forbidden` | `200 OK` |

### 1.3 Privacy & Grading Visibility Matrix (Syllabus Rule)
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

---

## 2. Errors

Every error response returns `Content-Type: application/problem+json` with required members `type`, `title`, `status`, `detail`, and `instance`. Clients branch on `type`, never on `detail` text.

| Status | `type` URI | `title` | Triggering Conditions |
|:---:|---|---|---|
| `400` | `https://leetkob.edu.vn/errors/bad-request` | `Bad Request` | Invalid `scope` query param; invalid `decision` / `deduction` / `evidence` item; `decision === 'VIOLATION'` without $\ge 1$ evidence line (`FAQ-09`); modifying a finding after Publish without a non-empty `reason` (`FAQ-12`). |
| `401` | `https://leetkob.edu.vn/errors/unauthorized` | `Unauthorized` | Missing, malformed, invalid-signature, or expired Bearer JWT. |
| `403` | `https://leetkob.edu.vn/errors/forbidden` | `Forbidden` | Student accessing another student's submission (IDOR) or TA review/publish endpoints; TA accessing a lab outside assigned `class_staff`; unenrolled student accessing class lab. |
| `404` | `https://leetkob.edu.vn/errors/not-found` | `Not Found` | Unknown `labId`, `submissionId` (or not belonging to `labId`), or `findingId`. |
| `409` | `https://leetkob.edu.vn/errors/conflict` | `Conflict` | `POST /labs/{labId}/publish` refused because: (a) `now < deadline` (`FAQ-12`), (b) any counted submission is not yet `COMPLETED` (`FAQ-03`), (c) any counted `AC` submission has `checkerStatus !== 'COMPLETED'`, or (d) any counted finding still has `reviewStatus === 'PENDING_REVIEW'` (`FAQ-12`). |
| `415` | `https://leetkob.edu.vn/errors/unsupported-media-type` | `Unsupported Media Type` | `PATCH` write missing `Content-Type: application/json`. |
| `500` | `https://leetkob.edu.vn/errors/internal-error` | `Internal Server Error` | Unexpected server/database failure (fixed safe detail; never exposes SQL, paths, or stack traces). |

### Example Problem Response (`409 Conflict`)
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
- `status`: `"QUEUED" | "JUDGING" | "COMPLETED" | "JUDGE_ERROR"`.
- `overallVerdict`: `"AC" | "WA" | "TLE" | "MLE" | "RE" | "CE" | null`.
- `code` and checker findings are always omitted.

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
- `unsureReason`: one of `MODEL_UNSURE | SCHEMA_INVALID | EVIDENCE_MISMATCH | TIMEOUT | COST_CAP_EXCEEDED | MODEL_OFF | PROVIDER_ERROR | null` (`FAQ-09`, [checker-output.md](checker-output.md)). Non-null if and only if `verdict === "unsure"`.
- `proposedDeduction`: equals `configuredDeduction` when `verdict === "violation"`, and `0` when `verdict` is `"pass"` or `"unsure"`.
- `reviewStatus`: `"NOT_QUEUED" | "PENDING_REVIEW" | "APPROVED_VIOLATION" | "DISMISSED_PASS" | "OVERRIDDEN"`.

---

## 4. Endpoints

### 4.1 `GET /labs/{labId}/submissions`
- **Auth:** `STUDENT` (enrolled), `TA` (owning class), `ADMIN`.
- **Ordering:** `submittedAt DESC, id DESC`.
- **Response (`200 OK`):** `{ "labId": "...", "isPublished": false, "submissions": SubmissionSummaryItem[] }`. For `STUDENT`, contains only caller's own submissions; for `TA`/`ADMIN`, contains all submissions in the lab (enabling live-demo lookup of any submission).

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
- **Query Params:** `scope` = `"counted"` (default) | `"all"`. Any other value → `400 Bad Request`.
- **Response (`200 OK`):**
```json
{
  "labId": "lab_018f2d5e-7a91-7f3c-b26a-98124d63e001",
  "labTitle": "Sorting Lab — Merge Sort",
  "scope": "counted",
  "isPublished": false,
  "publishedAt": null,
  "pendingReviewCount": 2,
  "items": []
}
```
- When `scope=counted`: includes only `isCounting === true` `AC` submissions and queued findings (`verdict === 'violation' || verdict === 'unsure' || isSampledPass === true || reviewStatus !== 'NOT_QUEUED'`).
- When `scope=all`: includes all `AC` submissions in the lab and all of their findings.

### 4.5 `GET /labs/{labId}/submissions/{submissionId}/review`
- **Auth:** `TA` (owning class) or `ADMIN` (`STUDENT` and other-class `TA` → `403`).
- **Response (`200 OK`):**
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
  1. `Content-Type` must be `application/json` (`415`).
  2. `decision` must be `"PASS"` or `"VIOLATION"` (`400`).
  3. `deduction` (optional): finite number in `[0, 10]` (`400`). Defaults to the lab constraint's `configuredDeduction` when `decision === "VIOLATION"`, forced to `0` when `decision === "PASS"`.
  4. `evidence`: required array (`length >= 1`, each `{ line: int >= 1, text: non-empty string }`) when `decision === "VIOLATION"` (`400`, `FAQ-09`).
  5. `reason`: optional string or `null` before Publish; **required non-empty string after Publish** (`lab.isPublished === true`, else `400`, `FAQ-12`).
- **Persistence & Audit:** Atomically updates `constraint_findings` (`reviewStatus` → `"APPROVED_VIOLATION"` or `"DISMISSED_PASS"`) and inserts a `TA_REVIEW_FINDING` row into `audit_logs` capturing both `before_state` (previous `reviewStatus`, `taDecision`, `taDeduction`) and `after_state` (`FAQ-10`, `FAQ-12`). On any `4xx` refusal, zero rows change.
- **Response (`200 OK`):** Updated `ConstraintFindingRecord`.

### 4.7 `POST /labs/{labId}/publish`
- **Auth:** `TA` (owning class) or `ADMIN` (`STUDENT` and other-class `TA` → `403`).
- **Transactional Gate & Idempotency (`FAQ-03`, `FAQ-10`, `FAQ-12`):**
  1. Lock the lab row (`SELECT ... FOR UPDATE`). If already published (`publishedAt !== null`), commit and return `200 OK` with the original `publishedAt` (safe idempotent retry).
  2. If `now < deadline` → `409 Conflict` (`ROLLBACK`, no mutation).
  3. If any counted submission (`isCounting === true`) has `status !== 'COMPLETED'` (still `QUEUED`, `JUDGING`, or `JUDGE_ERROR`) → `409 Conflict` (`ROLLBACK`, no mutation).
  4. If any counted `AC` submission has `checkerStatus !== 'COMPLETED'` → `409 Conflict` (`ROLLBACK`, no mutation).
  5. Rebalance the `FAQ-10` 10% `pass` sample across counted `AC` submissions.
  6. If any finding on a counted submission has `reviewStatus === 'PENDING_REVIEW'` → `409 Conflict` (`ROLLBACK`, no mutation).
  7. Set `labs.published_at = NOW()`, insert `PUBLISH_LAB_GRADES` into `audit_logs`, commit, and return `200 OK`:
```json
{
  "labId": "lab_018f2d5e-7a91-7f3c-b26a-98124d63e001",
  "isPublished": true,
  "publishedAt": "2026-11-25T10:00:00.000Z"
}
```

---

## 5. Versions and the Legacy API

1. **Compatible (Non-Breaking) Additions:** Adding optional metadata fields to summary/review responses (e.g., `labTitle`, `studentName`, `maxTimeMs`, `maxMemoryKb`, `publishedAt`) or optional query filters without altering existing required keys or pre-publish student redaction invariants.
2. **Breaking Changes:** Changing RFC 9457 error `type` URIs, weakening pre-publish student redaction, altering `decision` / `verdict` / `unsureReason` enums, or changing `POST /labs/{labId}/publish` idempotency semantics requires path versioning (`/v2/...`).
3. **Legacy Route Compatibility:** Both `GET /labs/{labId}/submissions/{submissionId}` (PA#3 canonical) and `GET /submissions/{submissionId}` (Web UI direct alias) are supported concurrently with identical authorization and Syllabus Rule enforcement.
