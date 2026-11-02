# API Contract: Submit Code for a Lab

**Endpoint:** `POST /labs/{labId}/submissions`  
**Standard Error Format:** [RFC 9457 Problem Details for HTTP APIs](https://datatracker.ietf.org/doc/html/rfc9457)  
**Content-Type:** `application/json` (Response Errors: `application/problem+json`)

---

## 1. Description & Purpose
Cho phép sinh viên nộp bài giải cho một bài tập thực hành (lab). Bài nộp sẽ được đưa vào hàng đợi chấm trong sandbox (chạy C++17) và trả về kết quả từng test case theo thời gian thực (realtime).

---

## 2. Who May Call (Authorization & Ownership Rules)
- **Role:** `STUDENT` (phải có Header `Authorization: Bearer <JWT>`).
- **Ownership Rule:** Sinh viên thực hiện gọi API **bắt buộc phải là thành viên chính thức của lớp học (ClassMember)** sở hữu `labId` tương ứng.
  - Nếu sinh viên không thuộc lớp này: trả về `403 Forbidden` theo RFC 9457 (không được phép xem hoặc nộp bài cho lớp khác).
- **Admin / TA:** Không dùng endpoint này để nộp bài (chỉ dành cho sinh viên).

---

## 3. Headers

| Header | Type | Required | Description |
|---|---|---|---|
| `Authorization` | `string` | **Yes** | Bearer token định danh sinh viên: `Bearer <jwt_token>` |
| `Idempotency-Key` | `string (UUID v4)` | **Yes** | Khóa chống trùng lặp request khi mạng chập chờn hoặc retry |
| `Content-Type` | `string` | **Yes** | `application/json` |

---

## 4. Request Body

```json
{
  "code": "#include <iostream>\n\nint main() {\n    std::cout << \"Hello World!\\n\";\n    return 0;\n}\n"
}
```

### Field Rules:
- `code`: `string`, bắt buộc.
  - Độ dài tối thiểu: 1 ký tự (không được là chuỗi trắng).
  - Kích thước tối đa: **64 KB** (65,536 bytes).
  - Ngôn ngữ: C++17 chuẩn.

---

## 5. Success Response (201 Created)

Khi request hợp lệ và được server tiếp nhận thành công vào hàng đợi chấm bài:

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
- Nếu client gửi lại một request với **cùng `Idempotency-Key`** và **cùng nội dung `code`**:
  - Server sẽ **không tạo bài nộp thứ hai**.
  - Server trả lại chính xác kết quả `201 Created` của bài nộp ban đầu (idempotent).
- Nếu client gửi lại **cùng `Idempotency-Key` nhưng nội dung `code` bị thay đổi**:
  - Server từ chối và trả về lỗi `409 Conflict` (idempotency key mismatch).

---

## 7. Error Responses (RFC 9457 Problem Details)

Toàn bộ response lỗi đều có Header `Content-Type: application/problem+json` và cấu trúc chuẩn RFC 9457:

### 7.1 400 Bad Request
- **Trường hợp:** Code rỗng, chỉ chứa khoảng trắng, hoặc vượt quá giới hạn 64 KB.
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
- **Trường hợp:** Thiếu header Authorization hoặc JWT token không hợp lệ / hết hạn.
```json
{
  "type": "https://leetkob.edu.vn/errors/unauthorized",
  "title": "Unauthorized",
  "status": 401,
  "detail": "Authentication token is missing or has expired.",
  "instance": "/labs/lab_123/submissions"
}
```

### 7.3 403 Forbidden (Ownership Check)
- **Trường hợp:** Sinh viên đăng nhập hợp lệ nhưng không phải là học viên trong lớp chứa lab này.
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
- **Trường hợp:** Không tìm thấy `labId` được chỉ định.
```json
{
  "type": "https://leetkob.edu.vn/errors/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "The requested lab with ID 'lab_123' does not exist.",
  "instance": "/labs/lab_123/submissions"
}
```

### 7.5 409 Conflict (Deadline Passed / Idempotency Mismatch)
- **Trường hợp 1 - Quá hạn nộp:** Hạn nộp được tính theo thời gian server nhận request (FAQ-03). Sau hạn, lab bị khóa hoàn toàn.
```json
{
  "type": "https://leetkob.edu.vn/errors/deadline-passed",
  "title": "Conflict",
  "status": 409,
  "detail": "The submission deadline for this lab has passed. Late submissions are not accepted.",
  "instance": "/labs/lab_123/submissions"
}
```
- **Trường hợp 2 - Trùng Idempotency-Key nhưng khác payload:**
```json
{
  "type": "https://leetkob.edu.vn/errors/idempotency-conflict",
  "title": "Conflict",
  "status": 409,
  "detail": "The provided Idempotency-Key has already been used with different request parameters.",
  "instance": "/labs/lab_123/submissions"
}
```
