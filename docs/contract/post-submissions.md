# API Contract: Submit Code for a Lab

- **Endpoint:** `POST /labs/{labId}/submissions`
- **Standard Error Format:** [RFC 9457 Problem Details for HTTP APIs](https://datatracker.ietf.org/doc/html/rfc9457)
- **Request Content-Type:** `application/json`
- **Success Content-Type:** `application/json`
- **Error Content-Type:** `application/problem+json`

---

## 1. Description & Purpose

Allows an officially enrolled student to submit C++ solution code for an active lab assignment. When accepted, the code is recorded in `QUEUED` status and placed onto the grading message queue for isolated C++17 Docker sandbox compilation and evaluation.

---

## 2. Who May Call (Authorization & Ownership Rules)

### 2.1 Role Requirement
- The caller MUST be authenticated with a valid Bearer JWT possessing role `STUDENT`.
- Non-student roles (`TA`, `ADMIN`, `GUEST`) are strictly prohibited from submitting code to this endpoint. If a `TA` or `ADMIN` attempts to submit code, the server MUST reject the request with `403 Forbidden`.

### 2.2 Ownership & Enrollment Rule
- The authenticated student **MUST be an active enrolled member (`ClassMember`) of the class that owns the specified `labId`**.
- If the student is authenticated but enrolled in a different class, the server MUST immediately reject the request with `403 Forbidden` (`type: https://leetkob.edu.vn/errors/forbidden`).
- Students cannot inspect, submit solutions to, or query labs belonging to classes in which they are not enrolled.

---

## 3. Headers

### 3.1 Request Headers

| Header | Type | Required | Description |
|---|---|:---:|---|
| `Authorization` | `string` | **Yes** | Bearer JWT identifying the authenticated user: `Bearer <jwt_token>`. |
| `Idempotency-Key` | `string (UUID v4)` | **Yes** | Client-generated UUID to guarantee idempotent request retries over unreliable networks. |
| `Content-Type` | `string` | **Yes** | MUST be `application/json`. |

### 3.2 Response Headers

| Header | Present In | Description |
|---|---|---|
| `Content-Type` | All | `application/json` for `201 Created`; `application/problem+json` for `4xx` and `5xx` errors. |
| `Location` | `201 Created` | URI of the newly created submission resource: `/labs/{labId}/submissions/{id}`. |
| `Idempotency-Key` | `201 Created` | Mirrors the client-provided `Idempotency-Key`. |

---

## 4. Request Body

```json
{
  "code": "#include <iostream>\n\nint main() {\n    std::cout << \"Hello World!\\n\";\n    return 0;\n}\n"
}
```

### 4.1 Schema & Field Validation Rules

| Field | Type | Required | Validation Constraints |
|---|---|:---:|---|
| `code` | `string` | **Yes** | • Minimum length: 1 character (must NOT be empty or whitespace-only).<br>• Maximum payload size: **64 KB** (65,536 bytes UTF-8 encoded).<br>• Target language: Standard ISO C++17. |

- Malformed JSON syntax or missing `code` property triggers immediate `400 Bad Request`.

---

## 5. Success Response (`201 Created`)

Returned when the submission passes all authentication, ownership, payload, and deadline checks, and is accepted into the grading queue:

- **Status Code:** `201 Created`
- **Headers:**
  - `Content-Type: application/json`
  - `Location: /labs/lab_018f2d5e-7a91-7f3c-b26a-98124d63e001/submissions/sub_9f8c1b82-412e-4b68-8a8b-18a7c6f0923e`
  - `Idempotency-Key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d`

```json
{
  "id": "sub_9f8c1b82-412e-4b68-8a8b-18a7c6f0923e",
  "labId": "lab_018f2d5e-7a91-7f3c-b26a-98124d63e001",
  "studentId": "std_23120244",
  "submittedAt": "2026-11-05T06:30:00.000Z",
  "status": "QUEUED",
  "idempotencyKey": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
}
```

---

## 6. Idempotency Specification

Network dropouts and client retries are expected during peak submission periods. The server implements strict idempotency semantics:

1. **Storage & Fingerprinting:**
   - The server stores the `Idempotency-Key` associated with the student ID, the lab ID, a SHA-256 hash of the normalized request body (`code`), and the cached `201 Created` response.
   - Idempotency records have a time-to-live (TTL) of **24 hours**.
2. **Identical Retries (Cache Hit):**
   - If a subsequent request arrives with an existing `Idempotency-Key` and **identical request payload**:
     - The server MUST NOT create a duplicate submission record in the database.
     - The server MUST NOT emit a duplicate message to the queue.
     - The server MUST return the cached original `201 Created` response payload and headers.
3. **Payload Mismatch (Conflict):**
   - If a subsequent request reuses an existing `Idempotency-Key` with **different payload content or a different lab ID**:
     - The server MUST reject the request with `409 Conflict` (`type: https://leetkob.edu.vn/errors/idempotency-conflict`).
4. **Invalid Idempotency Key:**
   - If `Idempotency-Key` is missing or not a valid UUID v4 string:
     - The server MUST reject the request with `400 Bad Request` (`type: https://leetkob.edu.vn/errors/bad-request`).

---

## 7. Error Responses (RFC 9457 Problem Details)

All error responses return `Content-Type: application/problem+json` and include the mandatory RFC 9457 members: `type`, `title`, `status`, `detail`, and `instance`.

### 7.1 400 Bad Request
- **Scenario A — Missing or Empty Code:** Source code is missing or contains only whitespace.
```json
{
  "type": "https://leetkob.edu.vn/errors/bad-request",
  "title": "Bad Request",
  "status": 400,
  "detail": "Source code cannot be empty or whitespace-only.",
  "instance": "/labs/lab_123/submissions"
}
```
- **Scenario B — Payload Too Large:** Source code exceeds the 64 KB limit.
```json
{
  "type": "https://leetkob.edu.vn/errors/bad-request",
  "title": "Bad Request",
  "status": 400,
  "detail": "Source code exceeds the 64 KB limit (current: 72000 bytes).",
  "instance": "/labs/lab_123/submissions"
}
```
- **Scenario C — Missing / Malformed Idempotency-Key:**
```json
{
  "type": "https://leetkob.edu.vn/errors/bad-request",
  "title": "Bad Request",
  "status": 400,
  "detail": "Header 'Idempotency-Key' is required and must be a valid UUID v4.",
  "instance": "/labs/lab_123/submissions"
}
```

### 7.2 401 Unauthorized
- **Scenario:** The `Authorization` header is missing, malformed, or the JWT token is invalid or expired.
```json
{
  "type": "https://leetkob.edu.vn/errors/unauthorized",
  "title": "Unauthorized",
  "status": 401,
  "detail": "Authentication token is missing, invalid, or has expired.",
  "instance": "/labs/lab_123/submissions"
}
```

### 7.3 403 Forbidden
- **Scenario A — Not Enrolled in Class (Ownership Check):** Student is validly authenticated but does not belong to the class owning this lab.
```json
{
  "type": "https://leetkob.edu.vn/errors/forbidden",
  "title": "Forbidden",
  "status": 403,
  "detail": "You are not enrolled in the class owning this lab.",
  "instance": "/labs/lab_123/submissions"
}
```
- **Scenario B — Non-Student Role Attempt:** A Teaching Assistant (`TA`) or Administrator (`ADMIN`) attempts to submit.
```json
{
  "type": "https://leetkob.edu.vn/errors/forbidden",
  "title": "Forbidden",
  "status": 403,
  "detail": "Only students enrolled in this class may submit solution code.",
  "instance": "/labs/lab_123/submissions"
}
```

### 7.4 404 Not Found
- **Scenario:** The specified `labId` does not exist.
```json
{
  "type": "https://leetkob.edu.vn/errors/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "The requested lab with ID 'lab_123' does not exist.",
  "instance": "/labs/lab_123/submissions"
}
```

### 7.5 409 Conflict
- **Scenario A — Deadline Passed:** Submission timestamp is past the lab deadline.
```json
{
  "type": "https://leetkob.edu.vn/errors/deadline-passed",
  "title": "Conflict",
  "status": 409,
  "detail": "The submission deadline for this lab has passed. Late submissions are not accepted.",
  "instance": "/labs/lab_123/submissions"
}
```
- **Scenario B — Idempotency Key Conflict:** Existing key reused with mismatched payload.
```json
{
  "type": "https://leetkob.edu.vn/errors/idempotency-conflict",
  "title": "Conflict",
  "status": 409,
  "detail": "The provided Idempotency-Key has already been used with different request parameters.",
  "instance": "/labs/lab_123/submissions"
}
```

### 7.6 415 Unsupported Media Type
- **Scenario:** The client sends a request without `Content-Type: application/json`.
```json
{
  "type": "https://leetkob.edu.vn/errors/unsupported-media-type",
  "title": "Unsupported Media Type",
  "status": 415,
  "detail": "Requests must use Content-Type: application/json.",
  "instance": "/labs/lab_123/submissions"
}
```

### 7.7 500 Internal Server Error
- **Scenario:** Unexpected server exception or internal queue outage.
```json
{
  "type": "https://leetkob.edu.vn/errors/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "An unexpected error occurred while processing the submission. Please retry with the same Idempotency-Key.",
  "instance": "/labs/lab_123/submissions"
}
```

---

## 8. Evolution & Versioning Policy (What Happens When It Changes)

To prevent client breakage and guarantee API stability across multi-service deployments:

1. **Non-Breaking Changes (In-Place Evolution):**
   - Adding optional fields to the request body (e.g., custom compiler flags `compilerFlags?: string[]`).
   - Adding new informational fields to the `201 Created` response.
   - These changes maintain backward compatibility and MUST NOT change the endpoint URI.
2. **Breaking Changes (Versioned Path):**
   - Changing required request fields, altering the `code` size threshold below 64 KB, or modifying the RFC 9457 error schema or URI types is classified as a breaking change.
   - Breaking changes MUST introduce a new versioned URI: `POST /v2/labs/{labId}/submissions`.
3. **Deprecation Policy (RFC 8594):**
   - When an endpoint version is deprecated, the server MUST emit `Deprecation: @<timestamp>` and `Sunset: <date>` HTTP headers.
   - Deprecated versions MUST remain operational for a minimum grace period of **6 months** before removal.
