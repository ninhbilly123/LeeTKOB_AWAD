# API Contract: Health, Authentication, Classes & Lab Management (Task D1)

- **Endpoints (Baseline & `/v1` Alias):**
  - `GET /health` (`GET /v1/health`) — Service & persistence readiness probe.
  - `POST /auth/login` (`POST /v1/auth/login`) — Authenticate user by `username` or `email` and issue HS256 Bearer JWT.
  - `GET /auth/me` (`GET /v1/auth/me`) — Retrieve authenticated caller profile (`email`, `displayName`, `role`, `classIds`).
  - `GET /classes` (`GET /v1/classes`) — Keyset cursor-paginated list of classes visible to caller role/ownership.
  - `POST /classes` (`POST /v1/classes`) — `ADMIN` creates a class and assigns TAs (`FAQ-01`), with optional DB-backed `Idempotency-Key`.
  - `GET /classes/{classId}/labs` (`GET /v1/classes/{classId}/labs`) — Keyset cursor-paginated list of labs inside a class (sanitized for students).
  - `POST /classes/{classId}/labs` (`POST /v1/classes/{classId}/labs`) — `TA` creates a lab inside an assigned class, with optional DB-backed `Idempotency-Key`.
  - `POST /labs` (`POST /v1/labs`) — Direct/legacy TA lab creation accepting `classId` in request body (preserved 100%, with optional `Idempotency-Key`).
  - `GET /labs` (`GET /v1/labs`) — Flat list of labs visible to caller role/classes (preserved 100%).
  - `GET /labs/{labId}` (`GET /v1/labs/{labId}`) — Retrieve lab details (sanitized for `STUDENT`, unredacted for `TA`/`ADMIN`).
- **Referenced FAQs & Contracts:** [FAQ-01](../proposal/FAQ.md#faq-01), [FAQ-02](../proposal/FAQ.md#faq-02), [FAQ-05](../proposal/FAQ.md#faq-05), [FAQ-06](../proposal/FAQ.md#faq-06), [post-submissions.md](post-submissions.md), [reviews-and-results.md](reviews-and-results.md), [queue-and-judge.md](queue-and-judge.md).

---

## 1. Conventions

### 1.1 Media Types, Identifiers, Time, Units & Unknown Fields
- **Request `Content-Type`:** `application/json` is required on all `POST` endpoints (`415 Unsupported Media Type` otherwise). Raw JSON transport bodies exceeding **524,288 bytes (512 KiB)** are rejected with `413 Payload Too Large`.
- **Success `Content-Type`:** `application/json`.
- **Error `Content-Type`:** `application/problem+json` ([RFC 9457](https://datatracker.ietf.org/doc/html/rfc9457)).
- **Path Versioning:** Every route is served equivalently at its baseline path (e.g., `/classes`) and under the `/v1` prefix (e.g., `/v1/classes`). RFC 9457 `instance` reflects the exact URL path requested by the caller.
- **Identifiers:** Opaque prefixed strings — users (`usr_<slug>` or `std_<id>`), classes (`class_<uuid|slug>`), labs (`lab_<uuid|slug>`), test cases (`tc_<slug>`), and constraint codes (`C1`, `C2`, …). Clients MUST treat IDs as opaque strings.
- **Timestamps:** ISO 8601 UTC strings (e.g. `2026-12-31T23:59:59.000Z`).
- **Units & Limits (`FAQ-05`):**
  - `deduction`: decimal number in `[0, 10]`, stored internally in PostgreSQL as integer centipoints `[0, 1000]`.
  - `cpuTimeLimitSec`: integer `1..5` (default `1`).
  - `memoryLimitMb`: integer `64..512` (default `256`).
  - `maxPayloadSize`: fixed `65536` bytes (64 KiB UTF-8 decoded C++17 code).
- **CORS & Headers:** Configurable `CORS_ORIGINS`; accepts `Authorization`, `Content-Type`, `Idempotency-Key`, `X-Request-Id` and exposes `Location`, `Idempotency-Key`, and `X-Request-Id` response headers to browser clients.
- **Unknown Fields:** Extra unrecognized JSON properties in request bodies are ignored unless a field validation rule explicitly rejects them.

### 1.2 Authentication, Roles & Ownership
Except for `GET /health` and `POST /auth/login`, every endpoint requires a valid signed `HS256` Bearer JWT (`Authorization: Bearer <token>`, 24h TTL, required claims `sub`, `role`, `classIds`, `exp`). Missing, malformed, invalid-signature, or expired tokens return `401 Unauthorized`. Raw user IDs or unsigned fixture tokens are strictly rejected (Verified Incident 2026-11-11).

**Authorization Status Policy:** Unauthenticated callers always receive `401`. Authenticated callers lacking role permission or class ownership receive `403 Forbidden` (pinned across PA#2/PA#3 contracts and `PA3_rubric.md` Criterion 1). Missing resources (`classId` on `GET /classes/{classId}/labs`, `labId` on `GET /labs/{labId}`) return `404 Not Found`. On `POST /classes/{classId}/labs` and `POST /labs`, the TA's assigned `class_staff` membership is verified before loading class details, so an unassigned or unknown `classId` returns `403 Forbidden`.

| Endpoint | Public | `STUDENT` (Enrolled) | `STUDENT` (Unenrolled) | `TA` (Owning Class) | `TA` (Other Class) | `ADMIN` |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `GET /health` | `200` / `503` | `200` / `503` | `200` / `503` | `200` / `503` | `200` / `503` | `200` / `503` |
| `POST /auth/login` | `200` / `401` | `200` / `401` | `200` / `401` | `200` / `401` | `200` / `401` | `200` / `401` |
| `GET /auth/me` | `401` | `200` | `200` | `200` | `200` | `200` |
| `GET /classes` | `401` | Own `ACTIVE` classes | Own `ACTIVE` classes (`[]`) | Assigned classes | Assigned classes | All classes |
| `POST /classes` | `401` | `403 Forbidden` | `403 Forbidden` | `403 Forbidden` | `403 Forbidden` | `201 Created` |
| `GET /classes/{classId}/labs` | `401` | `200` (sanitized) | `403 Forbidden` | `200` (full + counts) | `403 Forbidden` | `200` (full + counts) |
| `POST /classes/{classId}/labs` | `401` | `403 Forbidden` | `403 Forbidden` | `201 Created` | `403 Forbidden` | `403 Forbidden` |
| `POST /labs` | `401` | `403 Forbidden` | `403 Forbidden` | `201 Created` | `403 Forbidden` | `403 Forbidden` |
| `GET /labs` | `401` | Own classes (sanitized) | `[]` | Own classes (full) | Own classes (full) | All labs (full) |
| `GET /labs/{labId}` | `401` | `200` (sanitized) | `403 Forbidden` | `200` (full) | `403 Forbidden` | `200` (full) |

### 1.3 Visibility & Keyset Cursor Pagination Conventions
1. **Student Lab Redaction (`FAQ-02`, `FAQ-06`):** For `STUDENT` callers, hidden test cases (`isHidden: true`) and their inputs/expected outputs are stripped at the SQL layer (`WHERE is_hidden = FALSE`). Students always see public sample tests, every constraint with its `deduction`, runtime limits (`FAQ-05`), and `reviewNotice`.
2. **Keyset Cursor Pagination (`GET /classes`, `GET /classes/{classId}/labs`):**
   - Query params: `cursor` (optional opaque Base64URL string), `limit` (optional integer `1..100`, default `20`).
   - Ordering: deterministic unique keyset `(createdAt DESC, id DESC)` backed by composite indexes (`idx_classes_cursor`, `idx_labs_class_cursor`), **never `OFFSET`**.
   - Server fetches `limit + 1` rows; `nextCursor` is `null` if and only if no items remain.
   - **Cursor Scope:** Each cursor binds its endpoint/filter scope (`classes` or `class-labs:{classId}`) and keyset tuple `(createdAt, id)`. Replaying a cursor on a different endpoint or `classId`, or passing a malformed cursor or out-of-range `limit`, returns `400 Bad Request`.
   - **Mutations Between Pages:** Because traversal seeks strictly past `(createdAt, id)` (`WHERE (created_at, id) < ($t, $id)`), inserting newer records ahead of the cursor never shifts or duplicates previously seen items on subsequent pages; deleted rows simply do not appear.

---

## 2. Errors

Every error response returns `Content-Type: application/problem+json` with required RFC 9457 members `type`, `title`, `status`, `detail`, and `instance`. Clients branch on `type`, never on `title` or `detail`.

- **Field-Level Validation Reporting (`errors[]`):** For multi-field request validation errors (`400 Bad Request` on `POST /auth/login`, `POST /classes`, `POST /classes/{classId}/labs`, `POST /labs`), the response includes an optional extension array `errors: Array<{ field: string; message: string }>` listing **every** invalid field (not only the first). `detail` carries the first error summary for backward compatibility.
- **Internal Server Errors (`500`):** Never expose SQL errors, table/column names, file paths, or stack traces. The server returns a fixed safe `detail`, attaches an `X-Request-Id` response header, and logs the full stack trace internally keyed by that `requestId`.

| Status | `type` URI | `title` | Triggering Conditions | Extensions / Headers |
|:---:|---|---|---|---|
| `400` | `https://leetkob.edu.vn/errors/bad-request` | `Bad Request` | Malformed JSON; invalid/out-of-scope `cursor` or `limit` outside `1..100`; invalid optional `Idempotency-Key` (non-UUID-v4); missing/invalid fields on `POST /auth/login`, `POST /classes`, `POST /labs`, or `POST /classes/{classId}/labs` (`openedAt >= deadline`, `cpuTimeLimitSec` outside `1..5`, `memoryLimitMb` outside `64..512`, empty `testCases`/`constraints`, `deduction` outside `[0, 10]`). | `errors[]` on body field validation errors |
| `401` | `https://leetkob.edu.vn/errors/unauthorized` | `Unauthorized` | Invalid `username`/`email` or `password` on `POST /auth/login`; missing, malformed, unsigned, invalid-signature, or expired Bearer JWT on protected endpoints. | — |
| `403` | `https://leetkob.edu.vn/errors/forbidden` | `Forbidden` | Non-`ADMIN` calling `POST /classes`; non-`TA` calling `POST /labs` or `POST /classes/{classId}/labs`; cross-class TA or unenrolled student accessing a class or lab (`FAQ-01`). | — |
| `404` | `https://leetkob.edu.vn/errors/not-found` | `Not Found` | Requested `classId` (on `GET /classes/{classId}/labs`), `labId` (on `GET /labs/{labId}`), or unknown HTTP route. | — |
| `409` | `https://leetkob.edu.vn/errors/conflict` | `Conflict` | `POST /classes` attempted with a `code` that already exists (case-insensitive, enforced atomically in DB via `LOWER(code)` unique index). | — |
| `409` | `https://leetkob.edu.vn/errors/idempotency-conflict` | `Conflict` | Optional `Idempotency-Key` reused by the same caller within 24h with a different payload or on a different route/target class. | — |
| `413` | `https://leetkob.edu.vn/errors/payload-too-large` | `Payload Too Large` | Raw JSON HTTP body exceeds 512 KiB transport limit. | — |
| `415` | `https://leetkob.edu.vn/errors/unsupported-media-type` | `Unsupported Media Type` | `POST` request missing `Content-Type: application/json`. | — |
| `500` | `https://leetkob.edu.vn/errors/internal-server-error` | `Internal Server Error` | Unexpected server/database failure (safe fixed detail; stack logged internally with `requestId`). | Header `X-Request-Id` |
| `503` | `https://leetkob.edu.vn/errors/service-unavailable` | `Service Unavailable` | `GET /health` when PostgreSQL connectivity check fails (`detail: "Database connectivity check failed."`). | — |

### Example Problem Responses (`application/problem+json`)

- **400 Validation Error (Multi-Field `errors[]`):**
```json
{
  "type": "https://leetkob.edu.vn/errors/bad-request",
  "title": "Bad Request",
  "status": 400,
  "detail": "Field 'code' must be a non-empty string.",
  "instance": "/classes",
  "errors": [
    { "field": "code", "message": "Field 'code' must be a non-empty string." },
    { "field": "term", "message": "Field 'term' must be a non-empty string." }
  ]
}
```

- **403 Forbidden:**
```json
{
  "type": "https://leetkob.edu.vn/errors/forbidden",
  "title": "Forbidden",
  "status": 403,
  "detail": "You are not authorized to access labs in this class.",
  "instance": "/labs/lab_018f2d5e-7a91-7f3c-b26a-98124d63e001"
}
```

---

## 3. Resources

### 3.1 `HealthResponse`
```json
{
  "status": "ok",
  "persistence": "postgres"
}
```

| Field | Type | Nullable | Rules |
|---|---|:---:|---|
| `status` | `"ok"` | No | Always `"ok"` when HTTP `200`. |
| `persistence` | `"postgres" \| "memory"` | No | Active persistence adapter mode. |

### 3.2 `LoginResponse` & `UserProfile`
- **`POST /auth/login` response (`LoginResponse`):** preserves exact compact `user` shape (`id`, `username`, `role`, `classIds`):
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "usr_ta_01",
    "username": "ta1",
    "role": "TA",
    "classIds": ["class_cs101"]
  }
}
```
- **`GET /auth/me` response (`UserProfile`):** returns full profile including `email` and `displayName` (**strictly omits** `passwordHash`):
```json
{
  "id": "usr_ta_01",
  "username": "ta1",
  "email": "ta1@leetkob.edu.vn",
  "displayName": "TA One",
  "role": "TA",
  "classIds": ["class_cs101"]
}
```

| Field | Type | Optional / Nullable | Rules |
|---|---|:---:|---|
| `id` | `string` | Required, non-null | Opaque user identifier. |
| `username` | `string` | Required, non-null | Unique login username. |
| `email` | `string` | Present on `GET /auth/me` | Unique user email address. |
| `displayName` | `string` | Present on `GET /auth/me` | Human-readable display name. |
| `role` | `"STUDENT" \| "TA" \| "ADMIN"` | Required, non-null | Caller role enum. |
| `classIds` | `string[]` | Required, non-null | Active enrolled classes (`STUDENT`), assigned classes (`TA`), or `[]` (`ADMIN`). |

### 3.3 `ClassSummaryRecord`
```json
{
  "id": "class_cs101",
  "code": "CSC10002-24CLC1",
  "name": "Kỹ thuật lập trình — Nhóm 1",
  "term": "HK1 2026-2027",
  "inviteCode": null,
  "createdBy": "usr_admin_01",
  "taIds": ["usr_ta_01"],
  "studentCount": 2,
  "labCount": 1,
  "createdAt": "2026-11-01T00:00:00.000Z"
}
```

| Field | Type | Nullable | Rules |
|---|---|:---:|---|
| `id` | `string` | No | Opaque class ID (`class_*`). |
| `code` | `string` | No | Non-empty unique class code (case-insensitive). |
| `name` | `string` | No | Non-empty class title. |
| `term` | `string` | No | Academic term label. |
| `inviteCode` | `string \| null` | Yes | Optional class join code or `null`. |
| `createdBy` | `string \| null` | Yes | Creator `ADMIN` user ID or `null`. |
| `taIds` | `string[]` | No | Assigned TA user IDs (`class_staff`). |
| `studentCount` | `integer` | No | Count of `ACTIVE` enrolled students (`>= 0`). |
| `labCount` | `integer` | No | Count of labs belonging to the class (`>= 0`). |
| `createdAt` | `string (ISO 8601)` | No | UTC creation timestamp used in keyset pagination. |

### 3.4 `Lab` (TA / Admin View) vs `LabStudentView` (Student View)
- **TA / Admin View (`Lab`):** includes all `testCases` (`isHidden: false` and `isHidden: true`), all `constraints`, `createdAt`, and optional counts (`submissionCount`, `pendingReviewCount`) in `GET /classes/{classId}/labs`.
```json
{
  "id": "lab_018f2d5e-7a91-7f3c-b26a-98124d63e001",
  "classId": "class_cs101",
  "title": "Sorting Lab — Merge Sort",
  "statement": "Implement merge sort in C++17 adhering to the constraints below.",
  "openedAt": "2026-11-01T00:00:00.000Z",
  "deadline": "2026-12-31T23:59:59.000Z",
  "cpuTimeLimitSec": 1,
  "memoryLimitMb": 256,
  "maxPayloadSize": 65536,
  "isActive": true,
  "publishedAt": null,
  "isPublished": false,
  "createdBy": "usr_ta_01",
  "createdAt": "2026-11-01T00:00:00.000Z",
  "testCases": [
    { "id": "tc_1", "input": "5\n4 2 1 5 3\n", "expectedOutput": "1 2 3 4 5\n", "isHidden": false },
    { "id": "tc_2", "input": "4\n9 7 5 3\n", "expectedOutput": "3 5 7 9\n", "isHidden": true }
  ],
  "constraints": [
    {
      "id": "C1",
      "text": "Do not call a library sort function: `std::sort`, `std::stable_sort`, `std::partial_sort`, `std::ranges::sort`, `std::ranges::stable_sort`, `qsort`.",
      "deduction": 3
    },
    {
      "id": "C2",
      "text": "Sort with a merge sort you wrote yourself.",
      "deduction": 4
    }
  ]
}
```
- **Student View (`LabStudentView`):** strictly omits all `testCases` where `isHidden === true` (`FAQ-02`), omits `createdBy` / `submissionCount` / `pendingReviewCount`, includes runtime limits (`FAQ-05`) and every constraint with its `deduction`, and adds `reviewNotice` (`FAQ-06`):
```json
{
  "id": "lab_018f2d5e-7a91-7f3c-b26a-98124d63e001",
  "classId": "class_cs101",
  "title": "Sorting Lab — Merge Sort",
  "statement": "Implement merge sort in C++17 adhering to the constraints below.",
  "openedAt": "2026-11-01T00:00:00.000Z",
  "deadline": "2026-12-31T23:59:59.000Z",
  "cpuTimeLimitSec": 1,
  "memoryLimitMb": 256,
  "maxPayloadSize": 65536,
  "isActive": true,
  "publishedAt": null,
  "isPublished": false,
  "testCases": [
    { "id": "tc_1", "input": "5\n4 2 1 5 3\n", "expectedOutput": "1 2 3 4 5\n", "isHidden": false }
  ],
  "constraints": [
    { "id": "C1", "text": "Do not call a library sort function: `std::sort`...", "deduction": 3 },
    { "id": "C2", "text": "Sort with a merge sort you wrote yourself.", "deduction": 4 }
  ],
  "reviewNotice": "Submitted code is checked by syntax hard rules and an anonymized LLM constraint checker (comments, names, and student IDs are removed). A TA reviews all deductions before grades are published."
}
```

| Field | Type | Visibility / Optionality | Rules |
|---|---|---|---|
| `id` | `string` | All roles | Opaque lab ID (`lab_*`). |
| `classId` | `string` | All roles | Owning class ID. |
| `title` | `string` | All roles | Non-empty lab title. |
| `statement` | `string` | All roles | Markdown problem statement. |
| `openedAt` | `string (ISO 8601)` | Optional (`string \| undefined`) | Lab opening time; strictly before `deadline` when set. |
| `deadline` | `string (ISO 8601)` | All roles | Submission cutoff timestamp (`FAQ-03`). |
| `cpuTimeLimitSec` | `integer` | All roles | Seconds per test case, `1..5` (default `1`, `FAQ-05`). |
| `memoryLimitMb` | `integer` | All roles | Megabytes per test case, `64..512` (default `256`, `FAQ-05`). |
| `maxPayloadSize` | `integer` | All roles | Fixed `65536` bytes (64 KiB, `FAQ-05`). |
| `isActive` | `boolean` | All roles | Active lab flag. |
| `publishedAt` | `string \| null` | All roles | UTC publish timestamp or `null` before Publish. |
| `isPublished` | `boolean` | All roles | `true` iff `publishedAt !== null`. |
| `createdAt` | `string (ISO 8601)` | Optional (present on created/DB labs) | UTC creation timestamp used in keyset pagination. |
| `createdBy` | `string \| null` | `TA` / `ADMIN` only (omitted for `STUDENT`) | Creator TA user ID. |
| `testCases` | `LabTestCase[]` | `STUDENT`: `isHidden === false` only | `{ id, ordinal?, input, expectedOutput, isHidden }`. |
| `constraints` | `LabConstraint[]` | All roles | `{ id, code?, checkType?, text, banPatterns?, deduction (0..10) }`. |
| `reviewNotice` | `string` | `STUDENT` only | Mandatory transparency disclosure (`FAQ-06`). |
| `submissionCount` | `integer` | `TA` / `ADMIN` on `GET /classes/{classId}/labs` | Total submissions in lab (`>= 0`). |
| `pendingReviewCount` | `integer` | `TA` / `ADMIN` on `GET /classes/{classId}/labs` | Count of `PENDING_REVIEW` queue items (`>= 0`). |

---

## 4. Endpoints

### 4.1 `GET /health`
- **Auth:** Public.
- **Response (`200 OK`):** `HealthResponse` (`{ "status": "ok", "persistence": "postgres" | "memory" }`).
- **Failure (`503 Service Unavailable`):** When PostgreSQL mode is enabled and `SELECT 1` fails (`type: https://leetkob.edu.vn/errors/service-unavailable`, `detail: "Database connectivity check failed."`).

### 4.2 `POST /auth/login`
- **Auth:** Public.
- **Headers:** `Content-Type: application/json` (required, else `415`).
- **Request Body:** Accepts `username` **or** `email` (if both are provided, non-empty `username` takes precedence) plus non-empty `password`.
```json
{
  "email": "ta1@leetkob.edu.vn",
  "password": "ta123"
}
```
- **Validation Order & Persistence:** Body parser (`413`/`400`) → `Content-Type` (`415`) → field validation (`400` with `errors[]` for missing identifier and/or password) → timing-safe `scrypt` password check (`401`). No state is mutated on failure.
- **Response (`200 OK`):** `LoginResponse` (Section 3.2).

### 4.3 `GET /auth/me`
- **Auth:** Any authenticated user (`STUDENT`, `TA`, `ADMIN`).
- **Response (`200 OK`):** `UserProfile` (Section 3.2).

### 4.4 `GET /classes`
- **Auth:** Any authenticated user (`ADMIN` sees all; `TA` sees assigned `class_staff`; `STUDENT` sees `ACTIVE` `class_enrollments`).
- **Query Params:** `cursor` (optional opaque Base64URL keyset cursor bound to scope `classes`), `limit` (optional `1..100`, default `20`).
- **Ordering:** `createdAt DESC, id DESC`.
- **Response (`200 OK`):** `{ "items": ClassSummaryRecord[], "nextCursor": "<opaque>" | null }`. Empty result returns `{ "items": [], "nextCursor": null }`.

### 4.5 `POST /classes`
- **Auth:** Strictly `ADMIN` (`TA`/`STUDENT` → `403 Forbidden`, checked before body validation).
- **Headers:**
  - `Authorization: Bearer <admin_jwt>` (required)
  - `Content-Type: application/json` (required, else `415`)
  - `Idempotency-Key: <UUID v4>` (optional; if supplied, must be valid UUID v4 else `400`).
- **Request Body:**
```json
{
  "code": "CS201",
  "name": "Data Structures and Algorithms",
  "term": "2026-Fall",
  "taIds": ["usr_ta_01"]
}
```
| Field | Type | Required | Validation Rules |
|---|---|:---:|---|
| `code` | `string` | **Yes** | Non-empty trimmed string; must be unique case-insensitively (`409 Conflict` if duplicate). |
| `name` | `string` | **Yes** | Non-empty trimmed string. |
| `term` | `string` | **Yes** | Non-empty trimmed string. |
| `taIds` | `string[]` | No | Optional array of TA user IDs (default `[]`). |
- **Validation Order:** Body parser (`413`/`400`) → JWT (`401`) → `ADMIN` role (`403`) → `Content-Type` (`415`) → optional `Idempotency-Key` UUID v4 format (`400`) → multi-field body validation (`400` with `errors[]`) → atomic idempotency lookup (`201` replay / `409 idempotency-conflict`) & case-insensitive uniqueness check (`409 conflict`).
- **Persistence & Optional Idempotency:** Atomically inserts `classes`, `class_staff`, and (when `Idempotency-Key` is provided) `idempotency_records` in one transaction (`24h` TTL, scoped to `(actorId, Idempotency-Key)`, canonical SHA-256 fingerprint of `{ scope: "POST /classes", code, name, term, taIds }`). On any `4xx`/`5xx` refusal, zero rows change and nothing is cached.
- **Response (`201 Created`):** Header `Location: /classes/{classId}` (plus mirrored `Idempotency-Key` when supplied) and body `ClassSummaryRecord`.

### 4.6 `GET /classes/{classId}/labs`
- **Auth:** `ADMIN` (all); `TA`/`STUDENT` must belong to `classId` (`404` if `classId` unknown; `403` if caller lacks access).
- **Query Params:** `cursor` (optional opaque Base64URL keyset cursor bound to scope `class-labs:{classId}`), `limit` (optional `1..100`, default `20`).
- **Ordering:** `createdAt DESC, id DESC`.
- **Response (`200 OK`):** `{ "items": (Lab | LabStudentView)[], "nextCursor": "<opaque>" | null }`. For `TA`/`ADMIN`, each item also includes `submissionCount` and `pendingReviewCount`. Empty result returns `{ "items": [], "nextCursor": null }`.

### 4.7 `POST /classes/{classId}/labs` & `POST /labs`
- **Auth:** Strictly `TA` assigned to target `classId` (`STUDENT`/`ADMIN` or TA of another class → `403 Forbidden`).
- **Headers:**
  - `Authorization: Bearer <ta_jwt>` (required)
  - `Content-Type: application/json` (required, else `415`)
  - `Idempotency-Key: <UUID v4>` (optional; if supplied, must be valid UUID v4 else `400`).
- **Request Body:** `POST /classes/{classId}/labs` takes `classId` from the path parameter; `POST /labs` requires `classId` in the JSON body. Both share identical validation rules:
| Field | Type | Required | Validation Rules |
|---|---|:---:|---|
| `classId` | `string` | Path / Body | Must belong to the caller's assigned `class_staff` (`403` otherwise). |
| `title` | `string` | **Yes** | Non-empty trimmed string. |
| `statement` | `string` | **Yes** | Non-empty string (Markdown problem description). |
| `openedAt` | `string (ISO 8601)` | No | Valid ISO 8601 timestamp; if provided, `deadline` MUST be strictly after `openedAt`. |
| `deadline` | `string (ISO 8601)` | **Yes** | Valid ISO 8601 timestamp. |
| `cpuTimeLimitSec` | `integer` | No | Integer `1..5` (default `1`, `FAQ-05`). |
| `memoryLimitMb` | `integer` | No | Integer `64..512` (default `256`, `FAQ-05`). |
| `testCases` | `array` | **Yes** | Non-empty array; each item requires non-empty `id`, string `input`, string `expectedOutput`, boolean `isHidden`. |
| `constraints` | `array` | **Yes** | Non-empty array; each item requires non-empty `id`, non-empty `text`, finite `deduction` in `[0, 10]`. |
- **Validation Order:** Body parser (`413`/`400`) → JWT (`401`) → `TA` role (`403`) → `Content-Type` (`415`) → optional `Idempotency-Key` UUID v4 format (`400`) → multi-field body validation (`400` with `errors[]`) → `class_staff` ownership (`403`) → atomic idempotency lookup & persistence.
- **Persistence & Optional Idempotency:** Atomically saves `labs`, `lab_test_cases`, `lab_constraints` (`deduction_centipoints` integer), and (when `Idempotency-Key` is provided) `idempotency_records` in one transaction (`24h` TTL, scoped to `(taUserId, Idempotency-Key)`, canonical SHA-256 fingerprint of `{ scope: "CREATE_LAB", classId, title, statement, openedAt, deadline, cpuTimeLimitSec, memoryLimitMb, testCases, constraints }`). On any `4xx`/`5xx` refusal, zero rows change and nothing is cached.
- **Response (`201 Created`):** Header `Location: /labs/{labId}` (plus mirrored `Idempotency-Key` when supplied) and body `Lab` (Section 3.4).

### 4.8 `GET /labs` & `GET /labs/{labId}`
- **`GET /labs` (`200 OK`):** Returns `{ "labs": (Lab | LabStudentView)[] }` ordered by `createdAt DESC, id DESC`, scoped to caller role/classes (preserved 100% as legacy flat listing alongside paginated `GET /classes/{classId}/labs`).
- **`GET /labs/{labId}` (`200 OK`):** Returns `LabStudentView` for `STUDENT` (hidden test cases redacted in SQL) or `Lab` for owning-class `TA`/`ADMIN`. Returns `404` if `labId` does not exist; `403` if caller is a TA of another class or an unenrolled student.

---

## 5. Versions and the Legacy API

1. **Active Path Versioning (`/v1` & Baseline Alias):** All endpoints in this contract are served identically under `/v1/...` (e.g., `GET /v1/classes`, `POST /v1/classes/{classId}/labs`) and their unprefixed baseline paths (`/classes`, `/classes/{classId}/labs`) so PA#2/PA#3 clients, Web UI, and versioned clients interoperate seamlessly.
2. **Compatible (Non-Breaking) Additions:** Adding optional fields to lab/class creation requests (e.g., `cpuTimeLimitSec`, `memoryLimitMb`, `openedAt`), optional headers (e.g., `Idempotency-Key`, `X-Request-Id`), optional `errors[]` extensions on multi-field `400` problems, or additive metadata fields in responses without altering required keys or `POST /auth/login`'s `user` shape. Clients MUST ignore unknown JSON fields.
3. **Breaking Changes:** Altering mandatory RFC 9457 error members, JWT HS256 signing requirements, deduction bounds `[0, 10]`, or removing hidden-test redaction requires path versioning (`/v2/...`).
4. **Legacy Route Preservation & Deprecation Policy:** `POST /labs`, `GET /labs`, and `GET /labs/{labId}` are preserved alongside `GET/POST /classes/{classId}/labs`. If a legacy route is ever scheduled for retirement, it will retain its exact behavior during a minimum 6-month grace period while emitting `Deprecation` (RFC 9745), `Sunset` (RFC 8594), and `Link: </v2/...>; rel="successor-version"` headers.
