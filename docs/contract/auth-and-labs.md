# API Contract: Authentication & Lab Management (Task D1)

- **Endpoints:**
  - `POST /auth/login` (Authenticate user & issue JWT)
  - `POST /labs` (TA creates lab with constraints & test cases)
  - `GET /labs` (List labs visible to the caller's role and classes)
  - `GET /labs/{labId}` (Retrieve sanitized lab details for students / full for TA)
- **Standard Error Format:** [RFC 9457 Problem Details for HTTP APIs](https://datatracker.ietf.org/doc/html/rfc9457)
- **Request Content-Type:** `application/json`
- **Success Content-Type:** `application/json`
- **Error Content-Type:** `application/problem+json`

---

## 1. Description & Purpose

This contract defines the core authentication and lab provisioning endpoints for LeeTKOB prototype (PA#3 Milestone):
1. **User Authentication (`POST /auth/login`):** Validates credentials using cryptographic `scrypt` hashing and issues signed HS256 JSON Web Tokens (JWT) containing student/TA roles and assigned class IDs.
2. **Lab Creation (`POST /labs`):** Enables authenticated Teaching Assistants (`TA`) to create new programming labs containing problem statements, reference test cases (public and hidden), and syntactic/semantic constraints with deductions ($0 \le deduction \le 10$).
3. **Lab Listing & Inspection (`GET /labs`, `GET /labs/{labId}`):** Sanitizes lab definitions according to user role. Prevents academic dishonesty by strictly redacting hidden test cases (`isHidden: true`) and expected outputs from student queries while displaying required semantic constraints and review notices ([FAQ-01](../proposal/FAQ.md#faq-01), [FAQ-06](../proposal/FAQ.md#faq-06)).

---

## 2. Who May Call (Authorization & Ownership Rules)

### 2.1 Role Requirements
- **`POST /auth/login`:** Publicly accessible endpoint. No credentials or prior tokens required.
- **`POST /labs`:**
  - Requires authenticated Bearer JWT with role `TA`.
  - Non-TA roles (`STUDENT`, `ADMIN`) are strictly prohibited from creating labs (`403 Forbidden`).
  - The caller MUST be assigned to the class specified in the request body (`classId`).
- **`GET /labs` and `GET /labs/{labId}`:**
  - Accessible to authenticated users (`STUDENT`, `TA`, `ADMIN`).
  - For `GET /labs/{labId}`, `TA` and `STUDENT` callers **MUST belong to the class owning the lab** (`classId` in user's `classIds` / active enrollment).
  - Requests from TAs or students of different classes are immediately rejected with `403 Forbidden` (`type: https://leetkob.edu.vn/errors/forbidden`).

### 2.2 Token Specification
- JWT signature algorithm MUST be `HS256`.
- Token expiration (`exp`) is set to 24 hours from issuance (`iat`).
- Mandatory JWT Claims:
  - `sub`: Unique user identifier (e.g., `usr_ta_01`, `std_23120244`).
  - `role`: One of `STUDENT`, `TA`, `ADMIN`.
  - `classIds`: Array of class IDs the user belongs to (e.g., `["class_cs101"]`).
  - `iat`, `exp`: Standard issued-at and expiration timestamps.
- Unsigned, expired, or malformed tokens trigger `401 Unauthorized`. Raw IDs or fixture tokens are strictly prohibited (Verified Incident 2026-11-11).

---

## 3. Headers

### 3.1 Request Headers

| Header | Endpoint | Required | Description |
|---|---|:---:|---|
| `Content-Type` | All | **Yes** | MUST be `application/json`. |
| `Authorization` | `/labs`, `/labs/{labId}` | **Yes** | Bearer JWT identifying the caller: `Bearer <jwt_token>`. |

### 3.2 Response Headers

| Header | Present In | Description |
|---|---|---|
| `Content-Type` | All | `application/json` for `200 OK` / `201 Created`; `application/problem+json` for `4xx` and `5xx` errors. |
| `Location` | `POST /labs` (`201 Created`) | Canonical URI of the created lab: `/labs/{labId}`. |

---

## 4. Endpoint Specifications

### 4.1 Endpoint 1: Authenticate User (`POST /auth/login`)

#### Request Body
```json
{
  "username": "ta1",
  "password": "ta123"
}
```

| Field | Type | Required | Validation Constraints |
|---|---|:---:|---|
| `username` | `string` | **Yes** | Non-empty, alphanumeric string, maximum 64 characters. |
| `password` | `string` | **Yes** | Non-empty string, maximum 128 characters. |

#### Success Response (`200 OK`)
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

---

### 4.2 Endpoint 2: Create Lab (`POST /labs`)

#### Request Body
```json
{
  "classId": "class_cs101",
  "title": "Sorting Lab — Merge Sort",
  "statement": "Implement merge sort in C++17 adhering to the constraints below.",
  "deadline": "2026-12-31T23:59:59.000Z",
  "testCases": [
    {
      "id": "tc_1",
      "input": "5\n4 2 1 5 3\n",
      "expectedOutput": "1 2 3 4 5\n",
      "isHidden": false
    },
    {
      "id": "tc_2",
      "input": "4\n9 7 5 3\n",
      "expectedOutput": "3 5 7 9\n",
      "isHidden": true
    }
  ],
  "constraints": [
    {
      "id": "C1",
      "text": "Do not call a library sort function: `std::sort`, `std::stable_sort`, `std::partial_sort`, `std::nth_element`, `qsort`, `std::ranges::sort`, `std::ranges::stable_sort`.",
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

#### Field Validation Rules
| Field | Type | Required | Validation Constraints |
|---|---|:---:|---|
| `classId` | `string` | **Yes** | Non-empty string. Must match one of the caller's assigned `classIds`. |
| `title` | `string` | **Yes** | Length: 1–255 characters. |
| `statement` | `string` | **Yes** | Non-empty string describing the problem requirements. |
| `deadline` | `string (ISO 8601)` | **Yes** | Valid future ISO 8601 timestamp. |
| `testCases` | `array` | **Yes** | Minimum 1 test case. Each test case MUST define `id`, `input`, `expectedOutput`, and `isHidden` (`boolean`). |
| `constraints` | `array` | **Yes** | Minimum 1 constraint. Each constraint MUST define `id`, `text`, and `deduction` ($0 \le deduction \le 10$). |

#### Success Response (`201 Created`)
- **Headers:**
  - `Content-Type: application/json`
  - `Location: /labs/lab_018f2d5e-7a91-7f3c-b26a-98124d63e001`

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
    {
      "id": "tc_1",
      "input": "5\n4 2 1 5 3\n",
      "expectedOutput": "1 2 3 4 5\n",
      "isHidden": false
    },
    {
      "id": "tc_2",
      "input": "4\n9 7 5 3\n",
      "expectedOutput": "3 5 7 9\n",
      "isHidden": true
    }
  ],
  "constraints": [
    {
      "id": "C1",
      "text": "Do not call a library sort function: `std::sort`...",
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

---

### 4.3 Endpoint 3: List Labs (`GET /labs`) & Retrieve Lab (`GET /labs/{labId}`)

#### `GET /labs` (`200 OK`)
Returns `{ "labs": [...] }` filtered by the caller's role and assigned/enrolled classes (`STUDENT` entries use the sanitized student view; `TA`/`ADMIN` entries return full lab objects).

#### `GET /labs/{labId}` — Success Response for Student (`200 OK`)
Hidden test cases (`isHidden: true`) and their expected outputs are completely stripped to preserve test integrity. Public sample test cases, semantic constraints, deductions, and review notices are returned:

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
    {
      "id": "tc_1",
      "input": "5\n4 2 1 5 3\n",
      "expectedOutput": "1 2 3 4 5\n",
      "isHidden": false
    }
  ],
  "constraints": [
    {
      "id": "C1",
      "text": "Do not call a library sort function: `std::sort`...",
      "deduction": 3
    },
    {
      "id": "C2",
      "text": "Sort with a merge sort you wrote yourself.",
      "deduction": 4
    }
  ],
  "reviewNotice": "Submitted code is checked by syntax hard rules and an anonymized LLM constraint checker (comments, names, and student IDs are removed). A TA reviews all deductions before grades are published."
}
```

#### Success Response for TA / Admin (`200 OK`)
Teaching Assistants assigned to the owning class receive the complete unredacted lab definition (including hidden evaluation tests).

---

## 5. Standard Error Responses (RFC 9457 Problem Details)

All error payloads return `Content-Type: application/problem+json` containing standard members: `type`, `title`, `status`, `detail`, and `instance`.

### 5.1 400 Bad Request
- **Scenario A — Missing Credentials (`POST /auth/login`):**
```json
{
  "type": "https://leetkob.edu.vn/errors/bad-request",
  "title": "Bad Request",
  "status": 400,
  "detail": "Username and password are required.",
  "instance": "/auth/login"
}
```
- **Scenario B — Invalid Lab Definition (`POST /labs`):**
```json
{
  "type": "https://leetkob.edu.vn/errors/bad-request",
  "title": "Bad Request",
  "status": 400,
  "detail": "Constraint deduction must be a number between 0 and 10.",
  "instance": "/labs"
}
```

### 5.2 401 Unauthorized
- **Scenario A — Invalid Credentials (`POST /auth/login`):**
```json
{
  "type": "https://leetkob.edu.vn/errors/unauthorized",
  "title": "Unauthorized",
  "status": 401,
  "detail": "Invalid username or password.",
  "instance": "/auth/login"
}
```
- **Scenario B — Missing or Expired Bearer Token (`/labs`, `/labs/{labId}`):**
```json
{
  "type": "https://leetkob.edu.vn/errors/unauthorized",
  "title": "Unauthorized",
  "status": 401,
  "detail": "Authentication token is missing, invalid, or has expired.",
  "instance": "/labs/lab_018f2d5e-7a91-7f3c-b26a-98124d63e001"
}
```

### 5.3 403 Forbidden
- **Scenario A — Cross-Class Access Violation (Verified Incident 2026-11-11):** TA or student attempting to view or manage a lab belonging to a different class.
```json
{
  "type": "https://leetkob.edu.vn/errors/forbidden",
  "title": "Forbidden",
  "status": 403,
  "detail": "You do not have permission to access resources in this class.",
  "instance": "/labs/lab_018f2d5e-7a91-7f3c-b26a-98124d63e001"
}
```
- **Scenario B — Non-TA Role Creating Lab:** A student or admin attempting to invoke `POST /labs`.
```json
{
  "type": "https://leetkob.edu.vn/errors/forbidden",
  "title": "Forbidden",
  "status": 403,
  "detail": "Only TAs may create labs.",
  "instance": "/labs"
}
```

### 5.4 404 Not Found
- **Scenario — Lab Does Not Exist:**
```json
{
  "type": "https://leetkob.edu.vn/errors/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "The requested lab with ID 'lab_999' does not exist.",
  "instance": "/labs/lab_999"
}
```

### 5.5 415 Unsupported Media Type
- **Scenario — Non-JSON Content-Type:**
```json
{
  "type": "https://leetkob.edu.vn/errors/unsupported-media-type",
  "title": "Unsupported Media Type",
  "status": 415,
  "detail": "Requests must use Content-Type: application/json.",
  "instance": "/auth/login"
}
```

---

## 6. Durable Storage & Queue Job Contract (Worker Handoff)

### 6.1 Database Schema (PostgreSQL 16)
When `DATABASE_URL` is configured, Gateway ensures tables exist idempotently (`gateway/src/persistence/schema.ts`):
1. `users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL, class_ids JSONB NOT NULL DEFAULT '[]'::jsonb)`
2. `class_memberships (id TEXT PRIMARY KEY, student_id TEXT NOT NULL, class_id TEXT NOT NULL, status TEXT NOT NULL)`
3. `labs (id TEXT PRIMARY KEY, class_id TEXT NOT NULL, title TEXT NOT NULL, statement TEXT NOT NULL DEFAULT '', deadline TIMESTAMPTZ NOT NULL, max_payload_size INTEGER NOT NULL DEFAULT 65536, is_active BOOLEAN NOT NULL DEFAULT TRUE, test_cases JSONB NOT NULL DEFAULT '[]'::jsonb, constraints JSONB NOT NULL DEFAULT '[]'::jsonb, is_published BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
4. `submissions (id TEXT PRIMARY KEY, lab_id TEXT NOT NULL, student_id TEXT NOT NULL, code TEXT NOT NULL, status TEXT NOT NULL, is_counting BOOLEAN NOT NULL DEFAULT TRUE, submitted_at TIMESTAMPTZ NOT NULL, idempotency_key TEXT NOT NULL)`
5. `submission_jobs (id TEXT PRIMARY KEY, submission_id TEXT NOT NULL UNIQUE, lab_id TEXT NOT NULL, payload JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
6. `idempotency_records (student_id TEXT NOT NULL, key TEXT NOT NULL, lab_id TEXT NOT NULL, payload_hash TEXT NOT NULL, status_code INTEGER NOT NULL, response_headers JSONB NOT NULL, response_body JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (student_id, key))`

### 6.2 Submission Queue Outbox Payload (Handed off to Task N1 Worker)
Upon accepting a submission via `POST /labs/{labId}/submissions`, Gateway atomically stores a `PENDING` job into `submission_jobs` containing the payload required by the C++ Sandbox Worker:

```json
{
  "id": "job_4b2a9d10-3c1f-4e8a-9b72-123456789abc",
  "submissionId": "sub_9f8c1b82-412e-4b68-8a8b-18a7c6f0923e",
  "labId": "lab_018f2d5e-7a91-7f3c-b26a-98124d63e001",
  "studentId": "std_23120244",
  "code": "#include <iostream>\nint main() { ... }",
  "submittedAt": "2026-11-26T07:30:00.000Z",
  "limits": {
    "cpuTimeSec": 1,
    "wallTimeSec": 3,
    "memoryMb": 256,
    "maxProcesses": 16,
    "outputLimitBytes": 1048576
  },
  "testCases": [
    {
      "id": "tc_1",
      "input": "5\n4 2 1 5 3\n",
      "expectedOutput": "1 2 3 4 5\n"
    },
    {
      "id": "tc_2",
      "input": "4\n9 7 5 3\n",
      "expectedOutput": "3 5 7 9\n"
    }
  ],
  "constraints": [
    {
      "id": "C1",
      "text": "Do not call a library sort function: `std::sort`...",
      "deduction": 3
    },
    {
      "id": "C2",
      "text": "Sort with a merge sort you wrote yourself.",
      "deduction": 4
    }
  ],
  "status": "PENDING",
  "createdAt": "2026-11-26T07:30:00.000Z"
}
```

---

## 7. Evolution & Versioning Policy

1. **Non-Breaking Changes:**
   - Adding optional fields to the lab creation body (e.g., `cpuTimeLimitMs?: number`, `memoryLimitMb?: number`).
   - Adding non-sensitive metadata fields to the `GET /labs/{labId}` response.
2. **Breaking Changes:**
   - Any modification to mandatory RFC 9457 error members, altering JWT signing algorithm from HS256, or altering deduction constraints requires path versioning (`/v2/labs`).
3. **Deprecation Policy:**
   - Follows RFC 8594 standard headers (`Deprecation`, `Sunset`).
