# API Contract: Submit Code for a Lab

**Endpoint:** `POST /labs/{labId}/submissions`  
**Standard Error Format:** [RFC 9457 Problem Details for HTTP APIs](https://datatracker.ietf.org/doc/html/rfc9457)  
**Content-Type:** `application/json` (Error Responses: `application/problem+json`)

---

## 1. Description & Purpose
Allows an enrolled student to submit C++ solution code for an active lab assignment. The submitted code is queued for automated execution inside an isolated C++17 Docker sandbox, which pushes per-test verdicts to the student in real time.

---

## 2. Who May Call (Authorization & Ownership Rules)
- **Role:** `STUDENT` (must present a valid Bearer JWT in the `Authorization` header).
- **Ownership Rule:** The authenticated student **must be an officially enrolled member (`ClassMember`) of the class** that owns the specified `labId`.
  - If the student is authenticated but belongs to a different class, the server immediately rejects the request with `403 Forbidden` per RFC 9457. Students cannot inspect or submit solutions to labs belonging to other classes.
- **Admin / TA Roles:** Forbidden from submitting code via this endpoint (grading and review only).

---

## 3. Headers

| Header | Type | Required | Description |
|---|---|---|---|
| `Authorization` | `string` | **Yes** | Bearer JWT identifying the authenticated student: `Bearer <jwt_token>` |
| `Idempotency-Key` | `string (UUID v4)` | **Yes** | Client-generated UUID to guarantee idempotent request retries over unreliable networks |
| `Content-Type` | `string` | **Yes** | Must be `application/json` |

---

## 4. Request Body

```json
{
  "code": "#include <iostream>\n\nint main() {\n    std::cout << \"Hello World!\\n\";\n    return 0;\n}\n"
}
```

### Field Validation Rules:
- `code`: `string`, required.
  - Minimum length: 1 character (must not be whitespace only).
  - Maximum payload size: **64 KB** (65,536 bytes).
  - Programming language: Standard ISO C++17.

---

## 5. Success Response (201 Created)

When the submission passes validation and is successfully accepted into the grading queue:

```json
{
  "id": "sub_9f8c1b82-412e-4b68-8a8b-18a7c6f0923e",
  "labId": "lab_018f2d5e-7a91-7f3c-b26a-98124d63e001",
  "studentId": "std_23120255",
  "submittedAt": "2026-11-02T06:30:00.000Z",
  "status": "QUEUED",
  "idempotencyKey": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
}
```

---

## 6. Idempotency Behavior
- **Identical Retries:** If a client retransmits a request with the **same `Idempotency-Key`** and **identical `code` payload**:
  - The server **does not create a duplicate submission**.
  - The server returns the cached original `201 Created` response.
- **Payload Mismatch:** If a client reuses an existing `Idempotency-Key` with **different request parameters or code**:
  - The server rejects the request with `409 Conflict` (`idempotency-conflict`).

---

## 7. Error Responses (RFC 9457 Problem Details)

All error responses return `Content-Type: application/problem+json` with RFC 9457 structured fields:

### 7.1 400 Bad Request
- **Scenario:** The source code string is missing, blank, or exceeds the 64 KB limit.
```json
{
  "type": "https://leetkob.edu.vn/errors/bad-request",
  "title": "Bad Request",
  "status": 400,
  "detail": "Source code cannot be empty and must not exceed 64 KB (current: 72000 bytes).",
  "instance": "/labs/lab_123/submissions"
}
```

### 7.2 401 Unauthorized
- **Scenario:** The `Authorization` header is missing, malformed, or the JWT token has expired.
```json
{
  "type": "https://leetkob.edu.vn/errors/unauthorized",
  "title": "Unauthorized",
  "status": 401,
  "detail": "Authentication token is missing, invalid, or has expired.",
  "instance": "/labs/lab_123/submissions"
}
```

### 7.3 403 Forbidden (Ownership Check)
- **Scenario:** The student is authenticated but is not enrolled in the class owning this lab.
```json
{
  "type": "https://leetkob.edu.vn/errors/forbidden",
  "title": "Forbidden",
  "status": 403,
  "detail": "You are not enrolled in the class owning this lab.",
  "instance": "/labs/lab_123/submissions"
}
```

### 7.4 404 Not Found
- **Scenario:** The specified `labId` does not exist in the database.
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
- **Case A — Deadline Passed:** The submission timestamp (server clock) is past the lab deadline.
```json
{
  "type": "https://leetkob.edu.vn/errors/deadline-passed",
  "title": "Conflict",
  "status": 409,
  "detail": "The submission deadline for this lab has passed. Late submissions are not accepted.",
  "instance": "/labs/lab_123/submissions"
}
```
- **Case B — Idempotency Key Conflict:**
```json
{
  "type": "https://leetkob.edu.vn/errors/idempotency-conflict",
  "title": "Conflict",
  "status": 409,
  "detail": "The provided Idempotency-Key has already been used with different request parameters.",
  "instance": "/labs/lab_123/submissions"
}
```

---

## 8. Evolution & Versioning Policy (What Happens When It Changes)
- **Non-Breaking Changes:** Adding optional request fields (e.g., compiler flag hints) or additional informational response properties is considered backward-compatible and does not change the endpoint URI.
- **Breaking Changes:** Any breaking modification (e.g., changing required body structure or altering the RFC 9457 error type URIs) will introduce a versioned path (`POST /v2/labs/{labId}/submissions`), maintaining backward compatibility for existing client integrations during a minimum 6-month migration grace period.
