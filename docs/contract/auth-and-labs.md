# API Contract: Health, Authentication, Classes & Lab Management (Task D1)

- **Endpoints:**
  - `GET /health` — Service & persistence readiness probe.
  - `POST /auth/login` — Authenticate user by `username` or `email` and issue HS256 Bearer JWT.
  - `GET /auth/me` — Retrieve authenticated caller profile (`email`, `displayName`, `role`, `classIds`).
  - `GET /classes` — Cursor-paginated list of classes visible to caller role/ownership.
  - `POST /classes` — `ADMIN` creates a class and assigns TAs (`FAQ-01`).
  - `GET /classes/{classId}/labs` — Cursor-paginated list of labs inside a class (sanitized for students).
  - `POST /classes/{classId}/labs` — `TA` creates a lab inside an assigned class.
  - `POST /labs` — Direct/legacy TA lab creation accepting `classId` in request body (preserved 100%).
  - `GET /labs` — Flat list of labs visible to caller role/classes (preserved 100%).
  - `GET /labs/{labId}` — Retrieve lab details (sanitized for `STUDENT`, unredacted for `TA`/`ADMIN`).
- **Referenced FAQs & Contracts:** [FAQ-01](../proposal/FAQ.md#faq-01), [FAQ-02](../proposal/FAQ.md#faq-02), [FAQ-05](../proposal/FAQ.md#faq-05), [FAQ-06](../proposal/FAQ.md#faq-06), [post-submissions.md](post-submissions.md), [reviews-and-results.md](reviews-and-results.md), [queue-and-judge.md](queue-and-judge.md).

---

## 1. Conventions

### 1.1 Media Types, Identifiers, Time, Units & Unknown Fields
- **Request `Content-Type`:** `application/json` is required on all `POST` endpoints (`415 Unsupported Media Type` otherwise).
- **Success `Content-Type`:** `application/json`.
- **Error `Content-Type`:** `application/problem+json` ([RFC 9457](https://datatracker.ietf.org/doc/html/rfc9457)).
- **Timestamps:** ISO 8601 UTC strings (e.g. `2026-12-31T23:59:59.000Z`).
- **Units & Limits (`FAQ-05`):**
  - `deduction`: decimal number in `[0, 10]`, stored internally in PostgreSQL as integer centipoints `[0, 1000]`.
  - `cpuTimeLimitSec`: integer `1..5` (default `1`).
  - `memoryLimitMb`: integer `64..512` (default `256`).
  - `maxPayloadSize`: fixed `65536` bytes (64 KiB UTF-8 decoded C++17 code).
- **CORS:** Configurable `CORS_ORIGINS`; exposes `Location` and `Idempotency-Key` response headers to browser clients.
- **Unknown Fields:** Extra unrecognized JSON properties in request bodies are ignored unless a field validation rule explicitly rejects them.

### 1.2 Authentication, Roles & Ownership
Except for `GET /health` and `POST /auth/login`, every endpoint requires a valid signed `HS256` Bearer JWT (`Authorization: Bearer <token>`, 24h TTL, required claims `sub`, `role`, `classIds`, `exp`). Missing, malformed, invalid-signature, or expired tokens return `401 Unauthorized`. Raw user IDs or unsigned fixture tokens are strictly rejected (Verified Incident 2026-11-11).

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

### 1.3 Visibility & Pagination Conventions
1. **Student Lab Redaction (`FAQ-02`, `FAQ-06`):** For `STUDENT` callers, hidden test cases (`isHidden: true`) and their inputs/expected outputs are stripped at the SQL layer (`WHERE is_hidden = FALSE`). Students always see public sample tests, every constraint with its `deduction`, and `reviewNotice`.
2. **Cursor Pagination (`GET /classes`, `GET /classes/{classId}/labs`):**
   - Query params: `cursor` (optional opaque Base64URL string), `limit` (optional integer `1..100`, default `20`).
   - Ordering: deterministic `createdAt DESC, id DESC`.
   - Server fetches `limit + 1` items; `nextCursor` is `null` if and only if no items remain.
   - Invalid/malformed `cursor` or out-of-range `limit` returns `400 Bad Request`.
   - If records are inserted or removed between page requests, clients may observe shifted boundaries on subsequent pages.

---

## 2. Errors

Every error response returns `Content-Type: application/problem+json` with required RFC 9457 members `type`, `title`, `status`, `detail`, and `instance`. Clients branch on `type`, never on `detail`.

| Status | `type` URI | `title` | Triggering Conditions |
|:---:|---|---|---|
| `400` | `https://leetkob.edu.vn/errors/bad-request` | `Bad Request` | Missing/empty login credentials; malformed JSON; invalid `cursor` or `limit` outside `1..100`; missing `code`/`name`/`term` or non-string `taIds` on `POST /classes`; invalid lab fields (`title`, `statement`, `deadline`, `openedAt >= deadline`, `cpuTimeLimitSec` outside `1..5`, `memoryLimitMb` outside `64..512`, empty `testCases`/`constraints`, `deduction` outside `[0, 10]`). |
| `401` | `https://leetkob.edu.vn/errors/unauthorized` | `Unauthorized` | Invalid `username`/`email` or `password` on `POST /auth/login`; missing, malformed, unsigned, invalid-signature, or expired Bearer JWT on protected endpoints. |
| `403` | `https://leetkob.edu.vn/errors/forbidden` | `Forbidden` | Non-`ADMIN` calling `POST /classes`; non-`TA` calling `POST /labs` or `POST /classes/{classId}/labs`; cross-class TA or unenrolled student accessing a class or lab (`FAQ-01`). |
| `404` | `https://leetkob.edu.vn/errors/not-found` | `Not Found` | Requested `classId`, `labId`, or authenticated user record does not exist. |
| `409` | `https://leetkob.edu.vn/errors/conflict` | `Conflict` | `POST /classes` attempted with a `code` that already exists (case-insensitive). |
| `415` | `https://leetkob.edu.vn/errors/unsupported-media-type` | `Unsupported Media Type` | `POST` request missing `Content-Type: application/json`. |
| `500` | `https://leetkob.edu.vn/errors/internal-error` | `Internal Server Error` | Unexpected server/database failure (safe fixed detail; never leaks SQL, paths, or stack traces). |
| `503` | `https://leetkob.edu.vn/errors/service-unavailable` | `Service Unavailable` | `GET /health` when PostgreSQL connectivity check fails. |

### Example Problem Response (`403 Forbidden`)
```json
{
  "type": "https://leetkob.edu.vn/errors/forbidden",
  "title": "Forbidden",
  "status": 403,
  "detail": "You do not have permission to access resources in this class.",
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
- `status`: `"ok"`.
- `persistence`: `"postgres" | "memory"`.

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
- **`GET /auth/me` response (`UserProfile`):** returns full profile including `email` and `displayName` (never returns `passwordHash`):
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

### 3.3 `ClassSummaryRecord`
```json
{
  "id": "class_cs101",
  "code": "CS101",
  "name": "Introduction to Programming",
  "term": "2026-Fall",
  "inviteCode": null,
  "createdBy": "usr_admin_01",
  "taIds": ["usr_ta_01"],
  "studentCount": 2,
  "labCount": 1,
  "createdAt": "2026-11-01T00:00:00.000Z"
}
```

### 3.4 `Lab` (TA / Admin View) vs `LabStudentView` (Student View)
- **TA / Admin View (`Lab`):** includes all `testCases` (both `isHidden: false` and `isHidden: true`), all `constraints`, and optional counts (`submissionCount`, `pendingReviewCount`) in `GET /classes/{classId}/labs`.
```json
{
  "id": "lab_018f2d5e-7a91-7f3c-b26a-98124d63e001",
  "classId": "class_cs101",
  "title": "Sorting Lab — Merge Sort",
  "statement": "Implement merge sort in C++17 adhering to the constraints below.",
  "deadline": "2026-12-31T23:59:59.000Z",
  "cpuTimeLimitSec": 1,
  "memoryLimitMb": 256,
  "maxPayloadSize": 65536,
  "isActive": true,
  "isPublished": false,
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
- **Student View (`LabStudentView`):** strictly omits all `testCases` where `isHidden === true` (`FAQ-02`), includes every constraint and its `deduction`, and adds `reviewNotice` (`FAQ-06`):
```json
{
  "id": "lab_018f2d5e-7a91-7f3c-b26a-98124d63e001",
  "classId": "class_cs101",
  "title": "Sorting Lab — Merge Sort",
  "statement": "Implement merge sort in C++17 adhering to the constraints below.",
  "deadline": "2026-12-31T23:59:59.000Z",
  "maxPayloadSize": 65536,
  "isActive": true,
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

---

## 4. Endpoints

### 4.1 `GET /health`
- **Auth:** Public.
- **Response (`200 OK`):** `HealthResponse` (`{ "status": "ok", "persistence": "postgres" | "memory" }`).
- **Failure (`503 Service Unavailable`):** When PostgreSQL mode is enabled and `SELECT 1` fails.

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
- **Validation & Persistence:** Password verified with timing-safe `scrypt`. No state is mutated on failure.
- **Response (`200 OK`):** `LoginResponse` (Section 3.2).

### 4.3 `GET /auth/me`
- **Auth:** Any authenticated user (`STUDENT`, `TA`, `ADMIN`).
- **Response (`200 OK`):** `UserProfile` (Section 3.2).

### 4.4 `GET /classes`
- **Auth:** Any authenticated user (`ADMIN` sees all; `TA` sees assigned `class_staff`; `STUDENT` sees `ACTIVE` `class_enrollments`).
- **Query Params:** `cursor` (optional opaque Base64URL), `limit` (optional `1..100`, default `20`).
- **Response (`200 OK`):** `{ "items": ClassSummaryRecord[], "nextCursor": "<opaque>" | null }`.

### 4.5 `POST /classes`
- **Auth:** Strictly `ADMIN` (`TA`/`STUDENT` → `403 Forbidden`, checked before body validation).
- **Headers:** `Content-Type: application/json` (required, else `415`), `Authorization: Bearer <admin_jwt>`.
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
- **Persistence:** Atomically inserts `classes` and `class_staff` rows; on any `4xx` failure, zero rows change.
- **Response (`201 Created`):** Header `Location: /classes/{classId}` and body `ClassSummaryRecord`.

### 4.6 `GET /classes/{classId}/labs`
- **Auth:** `ADMIN` (all); `TA`/`STUDENT` must belong to `classId` (`404` if `classId` unknown; `403` if caller lacks access).
- **Query Params:** `cursor` (optional opaque Base64URL), `limit` (optional `1..100`, default `20`).
- **Response (`200 OK`):** `{ "items": (Lab | LabStudentView)[], "nextCursor": "<opaque>" | null }`. For `TA`/`ADMIN`, each item also includes `submissionCount` and `pendingReviewCount`.

### 4.7 `POST /classes/{classId}/labs` & `POST /labs`
- **Auth:** Strictly `TA` assigned to target `classId` (`STUDENT`/`ADMIN` or TA of another class → `403 Forbidden`).
- **Headers:** `Content-Type: application/json` (required, else `415`), `Authorization: Bearer <ta_jwt>`.
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
- **Persistence:** Atomically saves `labs`, `lab_test_cases`, and `lab_constraints` (`deduction_centipoints` integer). On any `4xx` refusal, zero rows change.
- **Response (`201 Created`):** Header `Location: /labs/{labId}` and body `Lab` (Section 3.4).

### 4.8 `GET /labs` & `GET /labs/{labId}`
- **`GET /labs` (`200 OK`):** Returns `{ "labs": (Lab | LabStudentView)[] }` scoped to caller role/classes (preserved 100% for backward compatibility).
- **`GET /labs/{labId}` (`200 OK`):** Returns `LabStudentView` for `STUDENT` (hidden test cases redacted in SQL) or `Lab` for owning-class `TA`/`ADMIN`. Returns `404` if `labId` does not exist; `403` if caller is a TA of another class or an unenrolled student.

---

## 5. Versions and the Legacy API

1. **Compatible (Non-Breaking) Additions:** Adding optional fields to lab/class creation requests (e.g., `cpuTimeLimitSec`, `memoryLimitMb`, `openedAt`) or optional metadata fields to responses (e.g., `submissionCount`, `pendingReviewCount`) without altering existing required keys or `POST /auth/login`'s `user` shape.
2. **Breaking Changes:** Altering mandatory RFC 9457 error members, JWT HS256 signing requirements, deduction bounds `[0, 10]`, or removing hidden-test redaction requires path versioning (`/v2/...`).
3. **Legacy Route Preservation & Deprecation Policy:** `POST /labs`, `GET /labs`, and `GET /labs/{labId}` are preserved alongside `GET/POST /classes/{classId}/labs`. If a legacy route is ever scheduled for retirement, it will emit `Deprecation` (RFC 9745), `Sunset` (RFC 8594), and `Link: </v2/...>; rel="successor-version"` headers during the grace period.
