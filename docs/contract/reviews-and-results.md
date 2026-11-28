# API Contract: Student Results, TA Review Queue & Grade Publishing (Task D2)

- **Endpoints:**
  - `GET /labs/{labId}/submissions` (List submissions in a lab — scoped by caller role)
  - `GET /labs/{labId}/submissions/{submissionId}` (Retrieve submission result — Syllabus Rule sanitized for students)
  - `GET /labs/{labId}/review-queue` (TA review queue for counted `AC` submissions)
  - `GET /labs/{labId}/submissions/{submissionId}/review` (TA full inspection of any submission in the lab)
  - `PATCH /labs/{labId}/submissions/{submissionId}/findings/{findingId}` (TA reviews/decides a constraint finding)
  - `POST /labs/{labId}/publish` (TA publishes lab grades after deadline and full review)
- **Standard Error Format:** [RFC 9457 Problem Details for HTTP APIs](https://datatracker.ietf.org/doc/html/rfc9457)
- **Request Content-Type:** `application/json` (for `PATCH` and `POST` writes)
- **Success Content-Type:** `application/json`
- **Error Content-Type:** `application/problem+json`
- **Referenced FAQs & Rules:** [FAQ-02](../proposal/FAQ.md#faq-02), [FAQ-04](../proposal/FAQ.md#faq-04), [FAQ-08](../proposal/FAQ.md#faq-08), [FAQ-09](../proposal/FAQ.md#faq-09), [FAQ-10](../proposal/FAQ.md#faq-10), [FAQ-11](../proposal/FAQ.md#faq-11), [FAQ-12](../proposal/FAQ.md#faq-12), [checker-output.md](checker-output.md), PA#3 Syllabus Rule.

---

## 1. Description & Syllabus Rule Invariants

This contract defines the student result viewing, TA constraint review queue, and grade publishing endpoints for LeeTKOB (PA#3 Task D2).

### Non-Negotiable Privacy & Grading Invariants
1. **Student Visibility Before Publish (`FAQ-02`, `FAQ-08`):**
   - While `lab.isPublished === false`, student-facing APIs MUST return **only** pipeline status, `overallVerdict` (`AC`, `WA`, `TLE`, `MLE`, `RE`, `CE`), `isCounting`, and per-test verdicts (`testVerdicts[]` with `ordinal`, `verdict`, `timeMs`, `memoryKb`).
   - Student responses MUST **hide** all test inputs, expected outputs, actual outputs, compiler/runtime internals, and **all** constraint checker data (`findings`, `verdict`, `source`, `evidence`, `unsureReason`, `reason`, proposed `deduction`, and `finalScore`).
2. **Student Visibility After Publish (`FAQ-04`, `FAQ-08`, `FAQ-11`):**
   - Once `lab.isPublished === true`, student-facing APIs return `finalScore` and `deductions[]`.
   - `finalScore` formula:
     - If `overallVerdict === 'AC'`: $\max(0, 10 - \sum \text{taDeduction})$ across distinct constraints with `reviewStatus === 'APPROVED_VIOLATION'` (each constraint deducted at most once).
     - If `overallVerdict !== 'AC'`: `0` (`FAQ-04`).
   - `deductions[]` contains **only** constraints approved by a TA as `APPROVED_VIOLATION` (`taDecision === 'VIOLATION'`).
   - Students **NEVER** see `unsure` verdicts, dismissed proposals (`DISMISSED_PASS`), raw checker `source`, `unsureReason`, or whether a `pass` finding was sampled in the 10% TA audit (`isSampledPass`).
3. **TA Review Queue Sampling (`FAQ-02`, `FAQ-10`):**
   - The default queue (`scope=counted`) evaluates only each student's **counted** (`isCounting === true`) `AC` submission.
   - Included findings: **100%** of `violation`, **100%** of `unsure`, and **10% rounded up** (`Math.ceil(0.10 * totalPassFindings)`) of `pass` findings across counted `AC` submissions in the lab.
   - TAs can inspect **any** submission in their lab (including non-sampled `pass` findings or superseded submissions) via `GET /labs/{labId}/review-queue?scope=all` or `GET /labs/{labId}/submissions/{submissionId}/review`.
4. **TA Decision & Evidence Gate (`FAQ-09`, `FAQ-10`):**
   - A TA must explicitly decide `PASS` or `VIOLATION` for every queued finding (including `unsure`).
   - Selecting `VIOLATION` **requires** at least one `evidence` line (`{ line, text }`); otherwise `400 Bad Request`.
   - Every review decision is recorded in `audit_logs`.
5. **Publish Gate (`FAQ-12`):**
   - `POST /labs/{labId}/publish` MUST fail with `409 Conflict` if:
     - The lab deadline has not passed yet (`now < deadline`), **OR**
     - Any counted `AC` submission still has `checkerStatus !== 'COMPLETED'`, **OR**
     - Any finding on a counted submission still has `reviewStatus === 'PENDING_REVIEW'`.
   - Once published, repeated `POST /labs/{labId}/publish` calls are idempotent and return `200 OK` with the original `publishedAt`.

---

## 2. Authorization & Ownership Rules

All endpoints require a valid signed HS256 Bearer JWT (`Authorization: Bearer <token>`). Missing, expired, or invalid tokens return `401 Unauthorized`.

| Endpoint | `STUDENT` | `TA` (Owning Class) | `TA` (Other Class) | `ADMIN` |
|---|:---:|:---:|:---:|:---:|
| `GET /labs/{labId}/submissions` | Own submissions only (`200`) | All lab submissions (`200`) | `403 Forbidden` | All (`200`) |
| `GET /labs/{labId}/submissions/{submissionId}` | Own submission only (`200`); other student's $\rightarrow$ `403` | `200` (sanitized view) | `403 Forbidden` | `200` |
| `GET /labs/{labId}/review-queue` | `403 Forbidden` | `200 OK` | `403 Forbidden` | `200 OK` |
| `GET /labs/{labId}/submissions/{submissionId}/review` | `403 Forbidden` | `200 OK` | `403 Forbidden` | `200 OK` |
| `PATCH /labs/{labId}/submissions/{submissionId}/findings/{findingId}` | `403 Forbidden` | `200 OK` | `403 Forbidden` | `200 OK` |
| `POST /labs/{labId}/publish` | `403 Forbidden` | `200 OK` | `403 Forbidden` | `200 OK` |

- Students not actively enrolled (`ACTIVE`) in the lab's class receive `403 Forbidden`.
- Non-existent `labId`, `submissionId`, or `findingId` returns `404 Not Found`.

---

## 3. Endpoint Specifications

### 3.1 List Submissions (`GET /labs/{labId}/submissions`)

#### Success Response (`200 OK`)
Returns submissions ordered by `submittedAt DESC`. For `STUDENT`, returns only the caller's submissions (sanitized, without `code` or checker findings). For `TA`/`ADMIN`, returns all submissions in the lab (metadata summary for lookup).

```json
{
  "labId": "lab_018f2d5e-7a91-7f3c-b26a-98124d63e001",
  "isPublished": false,
  "submissions": [
    {
      "id": "sub_9f8c1b82-412e-4b68-8a8b-18a7c6f0923e",
      "labId": "lab_018f2d5e-7a91-7f3c-b26a-98124d63e001",
      "studentId": "std_23120244",
      "status": "COMPLETED",
      "overallVerdict": "AC",
      "passedTests": 2,
      "totalTests": 2,
      "isCounting": true,
      "submittedAt": "2026-11-21T07:30:00.000Z"
    }
  ]
}
```

---

### 3.2 Retrieve Student Submission Result (`GET /labs/{labId}/submissions/{submissionId}`)

#### Case A — Before Publish (`isPublished: false`) (`200 OK`)
Strictly omits `testCases` I/O, `findings`, `evidence`, `unsureReason`, `deductions`, and `finalScore`:

```json
{
  "id": "sub_9f8c1b82-412e-4b68-8a8b-18a7c6f0923e",
  "labId": "lab_018f2d5e-7a91-7f3c-b26a-98124d63e001",
  "studentId": "std_23120244",
  "status": "COMPLETED",
  "overallVerdict": "AC",
  "passedTests": 2,
  "totalTests": 2,
  "isCounting": true,
  "isPublished": false,
  "submittedAt": "2026-11-21T07:30:00.000Z",
  "testVerdicts": [
    { "ordinal": 1, "verdict": "AC", "timeMs": 12, "memoryKb": 3200 },
    { "ordinal": 2, "verdict": "AC", "timeMs": 15, "memoryKb": 3400 }
  ]
}
```

#### Case B — After Publish (`isPublished: true`) (`200 OK`)
Includes `finalScore` and TA-approved `deductions[]` only (never exposes `unsure`, `DISMISSED_PASS`, or `isSampledPass`):

```json
{
  "id": "sub_9f8c1b82-412e-4b68-8a8b-18a7c6f0923e",
  "labId": "lab_018f2d5e-7a91-7f3c-b26a-98124d63e001",
  "studentId": "std_23120244",
  "status": "COMPLETED",
  "overallVerdict": "AC",
  "passedTests": 2,
  "totalTests": 2,
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

---

### 3.3 TA Review Queue (`GET /labs/{labId}/review-queue`)

- **Query Parameters:**
  - `scope`: `"counted"` (default) | `"all"`.
    - When `scope=counted`: returns only `isCounting === true` `AC` submissions and only findings that are queued (`verdict === 'violation' || verdict === 'unsure' || isSampledPass === true || reviewStatus !== 'NOT_QUEUED'`).
    - When `scope=all`: returns all `AC` submissions in the lab with all of their findings (including non-sampled `pass` findings).

#### Success Response (`200 OK`)
```json
{
  "labId": "lab_018f2d5e-7a91-7f3c-b26a-98124d63e001",
  "scope": "counted",
  "isPublished": false,
  "pendingReviewCount": 2,
  "items": [
    {
      "findingId": "fnd_sub1_C1",
      "submissionId": "sub_9f8c1b82-412e-4b68-8a8b-18a7c6f0923e",
      "studentId": "std_23120244",
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
  ]
}
```
> **Note (`FAQ-11`):** `configuredDeduction` is always the TA-configured deduction for that constraint; `proposedDeduction` is `configuredDeduction` when `verdict === 'violation'` and `0` when `verdict` is `'pass'` or `'unsure'` (never auto-proposed for `unsure`).

---

### 3.4 TA Single Submission Inspection (`GET /labs/{labId}/submissions/{submissionId}/review`)

Allows a TA of the owning class (or Admin) to inspect **any** submission in the lab during review or live demo (`FAQ-10`), including full source code, test verdicts, and every constraint finding (even non-sampled `pass` findings).

#### Success Response (`200 OK`)
```json
{
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
  "findings": [
    {
      "findingId": "fnd_sub1_C1",
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
  ]
}
```

---

### 3.5 TA Review Decision (`PATCH /labs/{labId}/submissions/{submissionId}/findings/{findingId}`)

#### Request Headers
- `Content-Type: application/json` (mandatory; otherwise `415 Unsupported Media Type`)
- `Authorization: Bearer <ta_jwt>`

#### Request Body
```json
{
  "decision": "VIOLATION",
  "deduction": 3,
  "evidence": [
    { "line": 12, "text": "std::sort(a, a + n);" }
  ],
  "reason": "Confirmed direct call to std::sort."
}
```

| Field | Type | Required | Validation Rules |
|---|---|:---:|---|
| `decision` | `"PASS" \| "VIOLATION"` | **Yes** | Strictly `"PASS"` or `"VIOLATION"`. |
| `deduction` | `number` | No | Finite number in `[0, 10]`. Defaults to the lab constraint's configured `deduction` when `decision === "VIOLATION"`; forced to `0` when `decision === "PASS"`. |
| `evidence` | `EvidenceLine[]` | Conditional | **Required (`length >= 1`)** when `decision === "VIOLATION"` (`FAQ-09`). Each item must have integer `line >= 1` and non-empty `text`. |
| `reason` | `string \| null` | No | Optional TA explanation stored in finding and `audit_logs`. |

#### Success Response (`200 OK`)
Returns the updated `ConstraintFindingRecord` with `reviewStatus` set to `"APPROVED_VIOLATION"` (if `VIOLATION`) or `"DISMISSED_PASS"` (if `PASS`), `reviewedBy`, and `reviewedAt`.

---

### 3.6 Publish Lab Grades (`POST /labs/{labId}/publish`)

#### Request Headers
- `Authorization: Bearer <ta_jwt>`

#### Success Response (`200 OK`)
```json
{
  "labId": "lab_018f2d5e-7a91-7f3c-b26a-98124d63e001",
  "isPublished": true,
  "publishedAt": "2026-11-25T10:00:00.000Z"
}
```

#### Error Responses (`409 Conflict` — `application/problem+json`)
- **Before deadline (`FAQ-12`):**
```json
{
  "type": "https://leetkob.edu.vn/errors/conflict",
  "title": "Conflict",
  "status": 409,
  "detail": "Cannot publish grades before the lab deadline has passed (FAQ-12).",
  "instance": "/labs/lab_018f2d5e-7a91-7f3c-b26a-98124d63e001/publish"
}
```
- **Unreviewed items remaining (`FAQ-12`):**
```json
{
  "type": "https://leetkob.edu.vn/errors/conflict",
  "title": "Conflict",
  "status": 409,
  "detail": "Cannot publish grades while 2 review item(s) remain PENDING_REVIEW (FAQ-12).",
  "instance": "/labs/lab_018f2d5e-7a91-7f3c-b26a-98124d63e001/publish"
}
```
- **Checker still pending on counted `AC` submissions:**
```json
{
  "type": "https://leetkob.edu.vn/errors/conflict",
  "title": "Conflict",
  "status": 409,
  "detail": "Cannot publish grades while 1 counted AC submission(s) have not finished constraint checking.",
  "instance": "/labs/lab_018f2d5e-7a91-7f3c-b26a-98124d63e001/publish"
}
```
