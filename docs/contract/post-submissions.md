# API Contract: Submit Code for a Lab

- **Endpoint:** `POST /labs/{labId}/submissions`
- **Referenced FAQs & Contracts:** [FAQ-01](../proposal/FAQ.md#faq-01), [FAQ-02](../proposal/FAQ.md#faq-02), [FAQ-03](../proposal/FAQ.md#faq-03), [FAQ-05](../proposal/FAQ.md#faq-05), [auth-and-labs.md](auth-and-labs.md), [queue-and-judge.md](queue-and-judge.md), [reviews-and-results.md](reviews-and-results.md).

---

## 1. Conventions

### 1.1 Media Types, Time, Units & Unknown Fields
- **Request `Content-Type`:** `application/json` (required; otherwise `415 Unsupported Media Type`).
- **Success `Content-Type`:** `application/json`.
- **Error `Content-Type`:** `application/problem+json` ([RFC 9457](https://datatracker.ietf.org/doc/html/rfc9457)).
- **Timestamps:** ISO 8601 UTC strings. The deadline is compared against the **server receipt timestamp** captured *before* body parsing (`FAQ-03`).
- **Payload Limits (`FAQ-05`):**
  - Decoded C++17 `code`: minimum 1 non-whitespace character, maximum **65,536 bytes (64 KiB UTF-8)**.
  - Raw JSON transport body: maximum **524,288 bytes (512 KiB)** so valid 64 KiB code remains accepted when JSON escaping expands it (`413 Payload Too Large` above 512 KiB).
- **Unknown Fields:** Extra JSON properties outside `code` are ignored and do not affect the idempotency fingerprint.

### 1.2 Authentication, Roles & Ownership
- **JWT Verification:** Signed `HS256` Bearer JWT (`Authorization: Bearer <token>`) with required claims `sub`, `role`, and `exp`. Signing secret is supplied strictly via runtime environment configuration (`JWT_SECRET`, minimum 32 bytes). Unsigned tokens, fixture tokens, raw user IDs, or unsupported role claims return `401 Unauthorized` (Verified Incident 2026-11-11).
- **Role & Enrollment Matrix (`FAQ-01`):**

| Caller | Expected Status | Notes |
|---|:---:|---|
| Unauthenticated / invalid / expired JWT | `401 Unauthorized` | Rejected by auth guard. |
| `STUDENT` (`ACTIVE` enrollment in lab's class) | `201 Created` | Allowed to submit before deadline. |
| `STUDENT` (not enrolled or `DROPPED` in lab's class) | `403 Forbidden` | Explicit `403` per class ownership rule. |
| `TA` or `ADMIN` | `403 Forbidden` | Non-student roles may not submit code. |

### 1.3 Persistence & Async Pipeline Semantics (PA#3)
- In production (`PERSISTENCE_MODE=postgres`), Gateway executes one PostgreSQL 16 transaction that acquires a per-student advisory lock (`pg_advisory_xact_lock`), flips prior `is_counting` submissions for `(lab_id, student_id)` to `FALSE` (`FAQ-02`), inserts the new `submissions` row (`pipeline_status = 'QUEUED'`, `is_counting = TRUE`), inserts the `submission_jobs` outbox row (`stage = 'JUDGE'`, `status = 'PENDING'`), inserts the `idempotency_records` row, and emits `pg_notify('submission_jobs_ready', job_id)` before `COMMIT` (see [queue-and-judge.md](queue-and-judge.md)).
- Offline unit/contract tests exercise the same HTTP routing, guards, validation, and atomic semantics against the in-memory store.

---

## 2. Errors

Every error response returns `Content-Type: application/problem+json` with required RFC 9457 members `type`, `title`, `status`, `detail`, and `instance`. Clients branch on `type`, never on `detail`.

| Status | `type` URI | `title` | Triggering Conditions |
|:---:|---|---|---|
| `400` | `https://leetkob.edu.vn/errors/bad-request` | `Bad Request` | Malformed JSON; missing or non-UUID-v4 `Idempotency-Key`; missing, empty, or whitespace-only `code`; decoded UTF-8 `code` > 65,536 bytes. |
| `401` | `https://leetkob.edu.vn/errors/unauthorized` | `Unauthorized` | Missing, malformed, invalid-signature, or expired Bearer JWT. |
| `403` | `https://leetkob.edu.vn/errors/forbidden` | `Forbidden` | Caller is `TA`/`ADMIN`, or `STUDENT` is not actively enrolled in the class owning `labId`. |
| `404` | `https://leetkob.edu.vn/errors/not-found` | `Not Found` | Target `labId` does not exist. |
| `409` | `https://leetkob.edu.vn/errors/deadline-passed` | `Conflict` | Server receipt timestamp is at or after `lab.deadline` (`FAQ-03`). |
| `409` | `https://leetkob.edu.vn/errors/idempotency-conflict` | `Conflict` | `Idempotency-Key` was previously used by this student with a different `code` or a different `labId` (Verified Incident 2026-11-11). |
| `413` | `https://leetkob.edu.vn/errors/payload-too-large` | `Payload Too Large` | Raw JSON HTTP body exceeds 512 KiB transport limit. |
| `415` | `https://leetkob.edu.vn/errors/unsupported-media-type` | `Unsupported Media Type` | Missing or non-`application/json` `Content-Type` header. |
| `500` | `https://leetkob.edu.vn/errors/internal-server-error` | `Internal Server Error` | Unexpected server/database failure (fixed safe message; never leaks SQL, paths, or stack traces). |

### Example Problem Responses (`application/problem+json`)
- **409 Deadline Passed:**
```json
{
  "type": "https://leetkob.edu.vn/errors/deadline-passed",
  "title": "Conflict",
  "status": 409,
  "detail": "The submission deadline for this lab has passed. Late submissions are not accepted.",
  "instance": "/labs/lab_123/submissions"
}
```
- **409 Idempotency Conflict:**
```json
{
  "type": "https://leetkob.edu.vn/errors/idempotency-conflict",
  "title": "Conflict",
  "status": 409,
  "detail": "The provided Idempotency-Key has already been used with different request parameters.",
  "instance": "/labs/lab_123/submissions"
}
```
- **500 Internal Server Error:**
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

## 3. Resources

### 3.1 `SubmissionResponse` (`201 Created`)
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
- `status`: `"QUEUED"` upon acceptance (pipeline status transitions to `JUDGING` → `COMPLETED` or `JUDGE_ERROR` asynchronously via the judge worker).
- **Omitted fields:** `code`, hidden test inputs/outputs, and constraint checker findings are never returned on submission creation (`FAQ-02`, `FAQ-08`).

---

## 4. Endpoints

### 4.1 `POST /labs/{labId}/submissions`

#### Request Headers
| Header | Type | Required | Description |
|---|---|:---:|---|
| `Authorization` | `string` | **Yes** | `Bearer <jwt_token>` for an enrolled `STUDENT`. |
| `Idempotency-Key` | `string (UUID v4)` | **Yes** | Client-generated UUID v4 preventing duplicate submissions on retry. |
| `Content-Type` | `string` | **Yes** | MUST be `application/json`. |

#### Request Body
```json
{
  "code": "#include <iostream>\n\nint main() {\n    std::cout << \"Hello World!\\n\";\n    return 0;\n}\n"
}
```
| Field | Type | Required | Validation Constraints |
|---|---|:---:|---|
| `code` | `string` | **Yes** | Non-empty, non-whitespace-only ISO C++17 source; `1 <= Buffer.byteLength(code, 'utf8') <= 65536`. |

#### Validation Order & Failure Persistence
1. Body parser rejects malformed JSON (`400`) or raw body > 512 KiB (`413`) before guards run.
2. `ClassOwnershipGuard` verifies JWT (`401`), `STUDENT` role (`403`), lab existence (`404`), and active class enrollment (`403`).
3. Controller validates `Content-Type` (`415`), `Idempotency-Key` UUID v4 format (`400`), and `code` non-empty & ≤ 64 KiB (`400`).
4. Service performs atomic idempotency lookup, deadline check (`receivedAt >= deadline` → `409 deadline-passed`), and submission + outbox persistence.
5. On any `4xx` or `5xx` failure, **no submission, no queue job, and no idempotency record is persisted**.

#### Success Response (`201 Created`)
- **Headers:**
  - `Content-Type: application/json`
  - `Location: /labs/{labId}/submissions/{id}`
  - `Idempotency-Key: <mirrored client key>`
- **Body:** `SubmissionResponse` (Section 3.1).

<a id="6-idempotency-specification"></a>
#### Idempotency Specification
1. **Scope & Fingerprint:** Scoped to `(studentId, Idempotency-Key)` (`PRIMARY KEY (student_id, idempotency_key)` in PostgreSQL). Different students may independently use the same key. The SHA-256 fingerprint hashes `{ labId, code }` in canonical order; unknown extra JSON fields do not change the fingerprint.
2. **Retention (TTL):** **24 hours** from receipt timestamp. After expiry, the key is treated as new under normal submission and deadline rules.
3. **Identical Replay:** Re-sending the same key and identical `{ labId, code }` within 24 hours returns the cached `201 Created` body and `Location`/`Idempotency-Key` headers **without** creating a second submission or emitting a second queue job — including retries after the lab deadline for an already accepted submission.
4. **Payload or Lab Mismatch:** Reusing an active key with a different `code` or different `labId` returns `409 Conflict` (`type: https://leetkob.edu.vn/errors/idempotency-conflict`) with zero database mutations.
5. **Concurrency & Failures:** Simultaneous identical requests for the same `(studentId, Idempotency-Key)` persist exactly one submission and one job. Failed `4xx`/`5xx` requests are never cached.

---

## 5. Versions and the Legacy API

1. **Compatible (Non-Breaking) Additions:** Adding optional request fields (e.g. `compilerFlags?: string[]`) or additive informational response fields without altering required keys, error URIs, or the 64 KiB decoded code / 512 KiB transport limits.
2. **Breaking Changes:** Changing required request fields, lowering the 64 KiB limit, changing idempotency scoping/conflict semantics, or modifying RFC 9457 error `type` URIs requires path versioning (`POST /v2/labs/{labId}/submissions`).
3. **Deprecation Policy:** Deprecated versions remain operational for a minimum grace period of **6 months** while emitting `Deprecation` (RFC 9745), `Sunset` (RFC 8594), and `Link: </v2/labs/{labId}/submissions>; rel="successor-version"` headers.
