# Kế hoạch Triển khai Frontend UI (`web/`) — LeeTKOB

> **Quy tắc nguồn chuẩn ([AGENTS.md](../AGENTS.md)):** Mọi điểm lệch giữa mã nguồn cũ và tài liệu đều được chuẩn hóa theo thứ tự ưu tiên **Class Brief ([PA3_rubric.md](rubric/PA3_rubric.md)) > PO FAQ ([FAQ.md](proposal/FAQ.md)) > Proposal ([proposal-detail.md](proposal/proposal-detail.md)) > Chuẩn kỹ thuật khóa học ([engineering-rules.md](engineering-rules.md))**. Contract và API ở `gateway/` sẽ được cập nhật đồng bộ theo đặc tả chuẩn này sau.

---

## 0. Đối chiếu Tài liệu vs Code hiện có (`gateway/` & `web/`)

### 0.1. API đã chạy thật và trường dữ liệu đã cam kết trong `gateway/`

Tại thời điểm lập kế hoạch, `gateway/` mới chạy **2 HTTP endpoint** (lưu trữ in-memory qua [submissions.store.ts](../gateway/src/submissions/submissions.store.ts), chưa nối PostgreSQL/Redis):

| Endpoint | Trạng thái | Trường & Header đã cam kết trong code + test | Nguồn kiểm chứng |
| :--- | :--- | :--- | :--- |
| `GET /health` | Đã chạy | Response `200 OK`: `{ "status": "ok" }` (không yêu cầu JWT). | [app.controller.ts](../gateway/src/app.controller.ts) |
| `POST /labs/:labId/submissions` | Đã chạy (14 contract tests pass) | **Request Headers:** `Authorization: Bearer <HS256 JWT>` (claims `{ sub: string, role: 'STUDENT' \| 'TA' \| 'ADMIN', exp: number }`), `Idempotency-Key: <UUID v4>`, `Content-Type: application/json` (transport limit `512kb`).<br>**Request Body:** `{ code: string }` (không rỗng, `UTF-8 byteLength <= 65536`).<br>**Response `201 Created`:** Headers `Location: /labs/{labId}/submissions/{id}`, `Idempotency-Key: <UUID v4>`; Body `{ id, labId, studentId, status: "QUEUED", submittedAt, idempotencyKey }`.<br>**Error (`application/problem+json` — RFC 9457):** `{ type, title, status, detail, instance }` với `type = https://leetkob.edu.vn/errors/<slug>` (`400`, `401`, `403`, `404`, `409`, `413`, `415`, `500`). | [post-submissions.md](contract/post-submissions.md), [submissions.controller.ts](../gateway/src/submissions/submissions.controller.ts), [submissions.contract.spec.ts](../gateway/test/submissions.contract.spec.ts) |

Toàn bộ các API còn lại cho `PA#3` (Auth đăng nhập / 5 tài khoản mẫu, Classes, Labs CRUD, Xem trạng thái & verdict bài nộp, Hàng chờ Review của TA) chưa có trên `main` của `gateway/`.

### 0.2. Các điểm lệch giữa Tài liệu và Code hiện tại — Quy ước bám theo Tài liệu cho Frontend

| # | Điểm lệch phát hiện | Hiện trạng trong Code | Quy định trong Tài liệu (Frontend bám theo) |
| :-: | :--- | :--- | :--- |
| **1** | **Thiếu file entry của Vite trong `web/`** | [web/package.json](../web/package.json) có `"dev": "vite"` và `"build": "tsc -b && vite build"`, nhưng chưa có `web/index.html`, `web/src/main.tsx`, và `tsconfig.json` bật `"noEmit": true`. | Bổ sung `web/index.html`, `web/src/main.tsx`, đồng bộ `"build": "tsc --noEmit && vite build"` theo [README.md](../README.md) & chuẩn Vite 5. |
| **2** | **`SubmissionStatus` trộn lẫn eval metric** | [submissions.types.ts](../gateway/src/submissions/submissions.types.ts) chứa `'WRONGFUL_DEDUCTION' \| 'REJECTED' \| 'ACCEPTED'`. | Theo **FAQ-02 / FAQ-04 / FAQ-05**: tách rõ tiến trình chấm `status` (`QUEUED \| JUDGING \| COMPLETED \| JUDGE_ERROR`) khỏi `overallVerdict` (`AC \| WA \| TLE \| MLE \| RE \| CE`) và `testVerdicts[]`. |
| **3** | **Entity `Lab` thiếu trường & dư `maxPayloadSize` động** | [submissions.types.ts](../gateway/src/submissions/submissions.types.ts) chỉ có 6 trường và gắn `maxPayloadSize` theo từng lab dù controller hardcode `65536`. | Theo **FAQ-05 / FAQ-06 / FAQ-07 & PA#3 Criterion 1**: giới hạn code `64 KB` cố định theo hệ thống (chỉ đọc trên UI); TA cấu hình `statement` (Markdown), `openedAt`, `deadline`, `cpuTimeLimitSec` (`1–5s`, mặc định `1s`), `memoryLimitMb` (`64–512 MB`, mặc định `256 MB`), `testCases[]` (`isSample`, `input`, `expectedOutput`), `constraints[]` (`type`, `description`, `patterns`, `deduction: 0..10`), và `publishedAt`. |
| **4** | **Mã lỗi truy cập chéo lớp (`403` vs `404`)** | [class-ownership.guard.ts](../gateway/src/common/guards/class-ownership.guard.ts) trả `403 Forbidden` (khớp [post-submissions.md](contract/post-submissions.md) và được [PA3_rubric.md](rubric/PA3_rubric.md) chấp nhận); [engineering-rules.md](engineering-rules.md) (Session 06) khuyến nghị `404` để giấu sự tồn tại tài nguyên. | Frontend bám chuẩn an toàn cho **cả `403` lẫn `404`** (hiển thị màn hình từ chối / không khả dụng mà không lộ thông tin lớp khác). `MockApiClient` trả `403 Forbidden` cho truy cập chéo lớp đúng contract PA#2/PA#3 và `404` khi ID không tồn tại. |
| **5** | **RFC 9457 bị cắt trường lỗi từng field & thiếu phân trang cursor** | [rfc9457-exception.filter.ts](../gateway/src/common/filters/rfc9457-exception.filter.ts) chỉ giữ 5 trường cơ bản; chưa có kiểu phân trang cursor. | Theo [engineering-rules.md](engineering-rules.md) (Session 05) & [AGENTS.md](../AGENTS.md): `Rfc9457ProblemDetails` hỗ trợ thêm `errors?: Array<{ field, message }>` để gắn lỗi từng ô input, và mọi API danh sách dùng chuẩn cursor `{ items: T[], nextCursor: string | null }`. |
| **6** | **Mô tả hạn mức chi phí LLM** | Proposal cũ ghi trần \$10 USD, trong khi [README.md](../README.md) xác nhận nhóm dùng **Gemini API Free Tier**. | Theo [README.md](../README.md) & **FAQ-09**: không hardcode con số \$10 USD trên UI; hiển thị đúng `unsureReason` (`PARSE_FAILURE \| TIMEOUT \| BUDGET_EXCEEDED \| LOW_CONFIDENCE`). |
| **7** | **Chưa cấu hình CORS / Vite Dev Proxy** | [configure-app.ts](../gateway/src/configure-app.ts) chưa bật CORS, [vite.config.ts](../web/vite.config.ts) chưa có proxy. | Cấu hình `VITE_API_BASE_URL` (mặc định `/api` kết hợp Vite dev proxy rewrite sang `http://localhost:3000`) để nối `gateway` mượt trong cả dev và Docker Compose. |

---

## 1. Phạm vi và Thứ tự làm

### 1.1. Bảng màn hình theo vai trò (`ADMIN`, `TA`, `STUDENT`)

#### A. Vai trò Chung & Admin (`ADMIN`)

| Màn hình | Mục đích | Route dự kiến | Thao tác chính | Dữ liệu cần | API thật / Mock ở PA#3 | Checkpoint |
| :--- | :--- | :--- | :--- | :--- | :--- | :-: |
| **Đăng nhập & Chuyển nhanh tài khoản Demo** (`A1–A3`) | Xác thực JWT; ở môi trường dev/mock hỗ trợ chọn nhanh 1 trong 5 tài khoản mẫu `PA#3` (1 Admin, 2 TA ở 2 lớp, 2 SV lớp TA 1). | `/login` | Đăng nhập email/mật khẩu; chuyển nhanh tài khoản demo; đăng xuất. | `LoginInput`, `AuthSession`, danh sách tài khoản mẫu (chỉ dev/mock). | Mock trước -> nối `POST /auth/login`, `GET /auth/me`. | **PA#3 (Đợt 1)** |
| **Quản lý Lớp học & Gán TA** (`B1–B3`) | Xem danh sách lớp, tạo lớp mới, gán TA phụ trách. | `/admin/classes` | Xem bảng lớp học; tạo lớp mới (mã lớp, tên môn, học kỳ, TA). | `PaginatedResponse<ClassSummary>`, `CreateClassInput`. | Mock trước -> nối `GET /classes`, `POST /classes`. | **PA#3 (Đợt 2)** |
| **Quản lý Người dùng & Quota AI** (`A4`, `E4`) | Tạo/khóa tài khoản, theo dõi quota/rate-limit Checker. | `/admin/system` | Quản trị tài khoản và trạng thái worker. | Danh sách users, thống kê quota. | Deferred. | **PA#5** |

#### B. Vai trò Trợ giảng (`TA`)

| Màn hình | Mục đích | Route dự kiến | Thao tác chính | Dữ liệu cần | API thật / Mock ở PA#3 | Checkpoint |
| :--- | :--- | :--- | :--- | :--- | :--- | :-: |
| **Danh sách Lớp & Bài Lab của TA** (`B4–B7`, `C7`) | Xem các lớp TA phụ trách (chặn truy cập lớp của TA khác), xem danh sách bài lab và số bài chờ soát. | `/ta/classes`, `/ta/classes/:classId` | Chọn lớp; xem bảng lab; mở form tạo Lab hoặc mở Hàng chờ Review. | `PaginatedResponse<ClassSummary>`, `PaginatedResponse<LabSummary>`. | Mock trước -> nối `GET /classes`, `GET /classes/:classId/labs`. | **PA#3 (Đợt 2)** |
| **Tạo / Cấu hình Bài Lab** (`C1–C6`, `FAQ-05`, `FAQ-06`) | Tạo bài lab mới (`sort-merge`) với đề Markdown, sample/hidden test cases, ràng buộc ban-list + ngữ nghĩa kèm mức trừ `0–10`, giới hạn CPU/RAM. | `/ta/classes/:classId/labs/new` | Form 4 bước: (1) Đề Markdown + Preview & Thời hạn, (2) Sample & Hidden Test Cases, (3) Ràng buộc & Mức trừ + Preview hộp `FAQ-06`, (4) Giới hạn CPU/RAM & Xác nhận tạo. | `CreateLabInput`, `TaLabDetail`. | Mock trước -> nối `POST /classes/:classId/labs`. | **PA#3 (Đợt 2 — Trọng tâm)** |
| **Hàng chờ Soát Ràng buộc & Chi tiết Bằng chứng** (`F1–F6`, `FAQ-09`, `FAQ-10`, `FAQ-12`) | Xem verdict từng ràng buộc (`pass`, `violation`, `unsure` + `unsureReason`), dòng bằng chứng tô sáng trên code C++ gốc, và mức trừ do TA đặt. | `/ta/labs/:labId/review` | Lọc nhóm ưu tiên (`Vi phạm quy tắc cứng`, `LLM đề xuất vi phạm`, `Unsure`, `Mẫu đối chứng 10% Pass`); gạt chế độ `Bài tính điểm mỗi SV` / `Mọi bài AC`; bấm bằng chứng cuộn tới đúng dòng code. | `PaginatedResponse<ReviewQueueItem>`, `TaSubmissionReviewView`. | Mock trước -> nối `GET /labs/:labId/review-queue`, `GET /submissions/:id`. | **PA#3 (Đợt 4 — Trọng tâm)** |
| **Xác nhận / Bác bỏ / Ghi đè & Công bố Điểm** (`F7–F12`, `G1–G2`, `FAQ-11`) | Chốt từng khoản trừ (không có "Duyệt tất cả" cho LLM), nhập lý do ghi đè, cổng công bố điểm và xuất CSV. | `/ta/labs/:labId/review`, `/ta/labs/:labId/publish` | Xác nhận/bác bỏ từng mục, audit log, công bố bảng điểm. | `ReviewDecisionInput`, `AuditLogEntry[]`. | Ở `PA#3` hiển thị trạng thái Nháp/Chưa công bố theo Syllabus Rule; hoàn thiện hành động chốt ở `PA#4`. | **PA#4** |
| **Xử lý Phúc khảo của TA** (`G9–G11`, `FAQ-13`) | Duyệt đơn phúc khảo của sinh viên sau công bố. | `/ta/labs/:labId/appeals` | Xem đơn `OPEN`, cập nhật điểm kèm lý do. | `AppealRecord[]`. | Deferred. | **PA#5** |

#### C. Vai trò Sinh viên (`STUDENT`)

| Màn hình | Mục đích | Route dự kiến | Thao tác chính | Dữ liệu cần | API thật / Mock ở PA#3 | Checkpoint |
| :--- | :--- | :--- | :--- | :--- | :--- | :-: |
| **Danh sách Lớp & Bài Lab** (`C11`) | Xem các lớp đang ghi danh (`ACTIVE`) và bài lab theo hạn nộp. | `/student/labs` | Lọc theo lớp; mở trang làm bài. | `PaginatedResponse<ClassSummary>`, `PaginatedResponse<LabSummary>`. | Mock trước -> nối `GET /classes`, `GET /classes/:classId/labs`. | **PA#3 (Đợt 3)** |
| **Làm bài, Nộp C++17 & Theo dõi Kết quả** (`C11`, `D1–D5`, `FAQ-02`, `FAQ-04`, `FAQ-06`, `FAQ-08`) | Đọc đề Markdown, xem sample test thuộc đề, xem danh sách ràng buộc + mức trừ + thông báo `FAQ-06`, dán/tải file `.cpp` (`<= 64 KB`), theo dõi tiến trình chấm và lịch sử bài nộp. | `/student/labs/:labId` | Dán code hoặc chọn file `.cpp`; đếm byte UTF-8; gửi kèm `Idempotency-Key` UUID v4; theo dõi `QUEUED -> JUDGING -> COMPLETED` và badge từng test (`AC/WA/TLE/MLE/RE/CE`); xem bài đang được đánh dấu tính điểm (`FAQ-04`). | `StudentLabDetail`, `PaginatedResponse<StudentSubmissionSummary>`, `StudentSubmissionView` (**không chứa test I/O và không chứa verdict/evidence ràng buộc trước Publish**). | **`POST /labs/:labId/submissions` khớp API thật**; phần đọc dùng Mock trước -> nối API thật khi `gateway/` mở. | **PA#3 (Đợt 3 — Trọng tâm)** |
| **Phiếu Điểm sau Công bố & Phúc khảo** (`G4–G8`, `FAQ-08`, `FAQ-13`) | Xem điểm chính thức, khoản trừ đã được TA duyệt + bằng chứng, gửi tối đa 1 đơn phúc khảo trong 48h. | `/student/labs/:labId/grade` | Xem bảng điểm chi tiết sau công bố; gửi đơn phúc khảo. | `PublishedGradeView`, `StudentAppealInput`. | Ở `PA#3` hiển thị thông báo chờ TA công bố. | **PA#4 / PA#5** |

### 1.2. Thứ tự triển khai `PA#3`

1. **Đợt 1:** Nền tảng `web/` (`index.html`, `main.tsx`, CSS tokens/base), Router phân quyền, Auth + chọn nhanh 5 tài khoản mẫu `PA#3`, và lớp dữ liệu `LeeTkobApiClient` (`MockApiClient` + `HttpApiClient`).
2. **Đợt 2:** Màn hình `/admin/classes`, `/ta/classes/:classId`, và form 4 bước `/ta/classes/:classId/labs/new`.
3. **Đợt 3:** Màn hình `/student/labs` và `/student/labs/:labId` (nộp C++17 `<= 64 KB` với `Idempotency-Key`, live status, khóa chặt `FAQ-02` & `FAQ-08`).
4. **Đợt 4:** Màn hình Split-Pane `/ta/labs/:labId/review` (hàng chờ phân nhóm, chế độ `counted/all`, `CodeViewer` giữ số dòng gốc + nhảy dòng bằng chứng, `unsureReason` theo `FAQ-09`, mức trừ TA đặt).

---

## 2. Luồng thao tác và Wireframe

### 2.1. Luồng 1 — TA tạo bài Lab (`/ta/classes/:classId/labs/new`)

```text
+-----------------------------------------------------------------------------------+
| LeeTKOB  [Lớp: CSC10002-24CLC1]                        [TA: Nguyễn Văn A] [Đăng xuất]|
+-----------------------------------------------------------------------------------+
| < Quay lại danh sách Lab   TẠO BÀI LAB MỚI                                        |
| [1. Đề bài & Hạn nộp] ---> [2. Bộ Test (4)] ---> [*3. Ràng buộc & Mức trừ*] ---> [4. Giới hạn & Lưu]
+-----------------------------------------------------------------------------------+
| RÀNG BUỘC KỸ THUẬT & MỨC TRỪ ĐIỂM (Công khai cho sinh viên trước khi nộp - FAQ-06) |
|                                                                                   |
| +-------------------------------------------------------------------------------+ |
| | Ràng buộc #1 (C1)                                                 [Xóa]       | |
| | Loại kiểm tra : (x) Quy tắc cứng (AST/Include/Hàm cấm)  ( ) Ngữ nghĩa (LLM)   | |
| | Mô tả cho SV  : [Không dùng #include <algorithm>, std::sort, stable_sort... ] | |
| | Biểu thức cấm : [<algorithm>, std::sort, std::stable_sort, qsort            ] | |
| | Mức điểm trừ  : [ 10.0 ] / 10 điểm                                            | |
| +-------------------------------------------------------------------------------+ |
| +-------------------------------------------------------------------------------+ |
| | Ràng buộc #2 (C2)                                                 [Xóa]       | |
| | Loại kiểm tra : ( ) Quy tắc cứng (AST/Include/Hàm cấm)  (x) Ngữ nghĩa (LLM)   | |
| | Mô tả cho SV  : [Bắt buộc cài đặt Merge Sort chia để trị đệ quy O(n log n)  ] | |
| | Mức điểm trừ  : [  5.0 ] / 10 điểm                                            | |
| +-------------------------------------------------------------------------------+ |
| [+ Thêm ràng buộc]                                                                |
|                                                                                   |
| [i] Xem trước thông báo phía Sinh viên (FAQ-06):                                  |
|     "Bài nộp có thể được công cụ phân tích tự động hỗ trợ kiểm tra ràng buộc.     |
|      Mọi kết luận vi phạm và điểm trừ đều do Trợ giảng trực tiếp xem xét duyệt."  |
|                                                                                   |
|                                                [< Bước trước]  [Tiếp theo: Bước 4 >]
+-----------------------------------------------------------------------------------+
```

### 2.2. Luồng 2 — Sinh viên nộp C++ và theo dõi kết quả (`/student/labs/:labId`)

```text
+-----------------------------------------------------------------------------------+
| LeeTKOB  [CSC10002 > Merge Sort]     Hạn nộp: 05/12 23:59             [SV: 23120001]|
+-----------------------------------------+-----------------------------------------+
| [Đề bài] [Ràng buộc (2)] [Lịch sử (3)]  | NỘP BÀI C++17 (g++ -std=c++17 -O2)      |
|-----------------------------------------| [Dán mã nguồn]  [Tải file .cpp lên]     |
| # Bài 1: Sắp xếp trộn (Merge Sort)      | +-------------------------------------+ |
| Cho mảng N số nguyên (N <= 10^5)...     | |  1 | #include <iostream>            | |
|                                         | |  2 | #include <vector>              | |
| ### Ví dụ minh họa (Sample của đề)      | |  3 | void mergeSort(std::vector...  | |
| Input : 5 \n 4 1 3 9 7                  | | .. | ...                            | |
| Output: 1 3 4 7 9                       | +-------------------------------------+ |
|                                         | Dung lượng: 1.42 KB / 64.00 KB (Hợp lệ) |
| ### Ràng buộc & Mức trừ tối đa          | [Nộp bài C++17]                         |
| - C1: Cấm <algorithm>, std::sort (-10đ) |-----------------------------------------|
| - C2: Bắt buộc đệ quy chia để trị (-5đ) | KẾT QUẢ BÀI NỘP #sub_03 (Tính điểm ★)   |
|                                         | Tổng kết: [✓ AC - Đạt 6/6 test]  42ms   |
| [i] Minh bạch kiểm tra (FAQ-06):        | [T1: ✓ AC] [T2: ✓ AC] [T3: ✓ AC]        |
| Bài nộp có thể được công cụ tự động hỗ  | [T4: ✓ AC] [T5: ✓ AC] [T6: ✓ AC]        |
| trợ rà soát; mọi điểm trừ đều do TA     | (Chi tiết input/output được ẩn - FAQ-02)|
| trực tiếp xem xét trước khi công bố.    | [i] Điểm chính thức & kết quả rà soát   |
|                                         |     ràng buộc sẽ mở sau khi TA công bố. |
+-----------------------------------------+-----------------------------------------+
```

### 2.3. Luồng 3 — TA mở Hàng chờ và xem Verdict / Bằng chứng / Mức trừ (`/ta/labs/:labId/review`)

```text
+-----------------------------------------------------------------------------------+
| LeeTKOB  [CSC10002 > Merge Sort > Hàng chờ Soát Ràng buộc]     [Trạng thái: NHÁP] |
| Phạm vi: ( ) Bài tính điểm mỗi SV  (x) Mọi bài AC (3) | Nhóm: [Tất cả (3) v]      |
+----------------------+-----------------------------------+------------------------+
| DANH SÁCH BÀI (3)    | MÃ NGUỒN C++ GỐC (sub_02 - AC)    | KẾT QUẢ RÀ SOÁT (TA)   |
|----------------------|-----------------------------------|------------------------|
| > SV 23120001        |  1 | #include <iostream>          | Tóm tắt Test: 6/6 AC   |
|   #sub_03 (Tính điểm)|>>2 | #include <algorithm>      << | CPU: 18ms | RAM: 4.2MB |
|   [LLM: VIOLATION]   |  3 | #include <vector>            |------------------------|
|                      |  4 | int main() {                 | RÀNG BUỘC C1 (Hard Rule|
| * SV 23120001        |  5 |   std::vector<int> a = ...;  | Trạng thái: [! VI PHẠM]|
|   #sub_02 (Đang xem) |>>6 |   std::sort(a.begin(), ...); | Mức trừ TA đặt: -10.0đ |
|   [HARD: VIOLATION]  |  7 |   ...                        | Bằng chứng (bấm để tới)|
|                      |  8 | }                            |  -> [Dòng 2] include   |
|   SV 23120001        |                                   |     `<algorithm>`      |
|   #sub_01            |                                   |  -> [Dòng 6] gọi hàm   |
|   [PASS - Mẫu KT]    |                                   |     `std::sort(...)`   |
|                      |                                   |------------------------|
|                      |                                   | RÀNG BUỘC C2 (LLM)     |
|                      |                                   | Trạng thái: [? UNSURE] |
|                      |                                   | Lý do: LOW_CONFIDENCE  |
|                      |                                   | Mức trừ TA đặt: -5.0đ  |
|                      |                                   | Đề xuất trừ: 0đ (chờ   |
|                      |                                   | TA kiểm tra thủ công)  |
+----------------------+-----------------------------------+------------------------+
```

### 2.4. Xử lý 5 trạng thái bắt buộc trên cả 3 luồng

| Trạng thái | Luồng 1: TA tạo Lab | Luồng 2: Sinh viên nộp & theo dõi | Luồng 3: TA mở Hàng chờ Review |
| :--- | :--- | :--- | :--- |
| **Đang tải (`Loading`)** | Skeleton giữ chiều cao form (`CLS = 0`); khóa nút gửi kèm `aria-busy="true"`. | Skeleton riêng cho cột Đề bài và Lịch sử nộp; khóa nút nộp trong lúc gửi request. | Skeleton danh sách trái và chi tiết phải; chuyển bài không giật bố cục. |
| **Chưa có dữ liệu (`Empty`)** | Danh sách Lab rỗng -> thẻ hướng dẫn + nút `"+ Tạo bài Lab đầu tiên"`. | Lịch sử rỗng -> thông báo `"Chưa có bài nộp nào"` + nhắc định dạng `C++17 / 64 KB`. | Phân biệt rõ `"Chưa có bài AC nào"` vs `"Không khớp bộ lọc"` + nút `"Xóa bộ lọc"`. |
| **Đang chờ chấm (`Queued / Judging`)** | Hiển thị bộ đếm bài đang chấm trên bảng Lab. | Thanh tiến trình `QUEUED -> JUDGING -> COMPLETED` thông báo qua `role="status"` (`aria-live="polite"`), cho phép đọc tiếp đề. | Gắn nhãn `[Đang phân tích ràng buộc...]` cho bài `AC` chưa có kết quả Checker. |
| **Có lỗi (`Error` — RFC 9457)** | Đọc `application/problem+json` + `errors[]` gắn trực tiếp vào trường sai (`aria-invalid`, `aria-describedby`), giữ nguyên dữ liệu đã nhập. | Validate rỗng / `> 64 KB` tại chỗ; `409 deadline-passed` khóa nút nộp; lỗi mạng / `5xx` cho `"Thử gửi lại"` **giữ nguyên `Idempotency-Key`**. | Hiện `ProblemBanner` + nút `"Thử tải lại"` trong vùng chi tiết mà không mất vị trí cuộn hàng chờ. |
| **Không có quyền (`401 / 403 / 404`)** | `401` -> `/login`; `403/404` chéo lớp -> màn hình từ chối rõ ràng kèm nút về trang chủ theo vai trò. | `401` -> `/login`; `403/404` -> màn hình từ chối, không lộ đề hay ràng buộc lớp khác. | `401` -> `/login`; `403/404` -> chặn cả ở `RoleGuard` lẫn phản hồi API, không render khung rỗng gây nhầm lẫn. |

---

## 3. Hướng thiết kế (Design Direction & Modern Web Guidance)

- **Thẩm mỹ tổng thể (*Academic Grading Workbench*):** Bố cục thoáng, tương phản rõ, thanh điều hướng đỉnh `56px` gắn chip định danh vai trò (`ADMIN` / `TA` / `STUDENT`), giao diện danh sách rộng tối đa `1200px`, và bố cục Split-Pane toàn chiều rộng cho màn hình làm bài & soát hàng chờ trên Desktop (`>= 1024px`).
- **Typography:** Sans-serif hệ thống (`'Inter', system-ui, sans-serif`) cho đề bài/UI; Monospace (`'JetBrains Mono', Consolas, monospace`) bật `font-variant-numeric: tabular-nums` cho số dòng code, byte, thời gian `ms` và điểm trừ.
- **Màu trạng thái ngữ nghĩa (WCAG AA `>= 4.5:1` chữ, `>= 3:1` viền, không bao giờ chỉ dựa vào màu):**
  - `AC / PASS`: Xanh lục đậm + icon `✓`.
  - `WA / VIOLATION`: Đỏ đậm + icon `!`.
  - `TLE / MLE / UNSURE`: Hổ phách đậm + icon `?`.
  - `CE / RE`: Tím/Đỏ sẫm + icon `×`.
  - `QUEUED / JUDGING`: Xanh lam + chỉ báo tôn trọng `prefers-reduced-motion`.
- **Nguyên tắc cụ thể từ Modern Web Guidance áp dụng vào LeeTKOB:**
  1. **`color` & `accessibility`:** Kết hợp icon + nhãn chữ trên mọi `VerdictBadge`; `skip-link` bỏ qua header; vùng live `role="status"` (`aria-live="polite"`) cho tiến trình chấm bài; giữ thứ tự heading `<h1> -> <h2> -> <h3>` hợp lệ.
  2. **`component-specific-light-dark-theme`:** `color-scheme: light dark` toàn cục, đồng thời ghim `color-scheme: dark` riêng cho `CodeViewer` để dòng bằng chứng C++ luôn dễ đọc ở cả 2 chế độ sáng/tối.
  3. **`responsive-table` & `css-layout`:** Dùng `container-type: inline-size` + `@container (width < 600px)` biến bảng lịch sử nộp / danh sách lab thành dạng thẻ xếp chồng tự động trên mobile lẫn cột hẹp của Split-Pane.
  4. **`tabs` & `navbar`:** Thanh tab dùng đúng mẫu ARIA `role="tablist"` / `role="tab"` / `role="tabpanel"` kèm điều hướng phím mũi tên và cuộn ngang 1 dòng (`flex-wrap: nowrap; overflow-x: auto`).
  5. **`forms` & `validate-input-after-interaction`:** Chỉ hiện lỗi sau khi người dùng đã tương tác (`onBlur` / `:user-invalid` / sau Submit), đồng bộ `aria-invalid` + `aria-describedby`.
  6. **`dialog`:** Hộp thoại tạo lớp / xem chi tiết dùng thẻ `<dialog>` nguyên bản gọi `.showModal()` kèm `overscroll-behavior: contain`.

---

## 4. Cấu trúc Code và Kế hoạch Tích hợp

- **Stack giữ nguyên 0 thư viện npm mới:** React 18.3, Vite 5.4, TypeScript 5.6 (`strict: true`), Vitest + Testing Library + happy-dom, CSS Modules + CSS Custom Properties, History API router mỏng và safe Markdown renderer sang React nodes (không dùng `dangerouslySetInnerHTML`).
- **Cây thư mục `web/src/`:**
  - `types/`: `problem-details.ts`, `auth.ts`, `lab.ts`, `submission.ts`, `review.ts`.
  - `api/`: `client.interface.ts` (`LeeTkobApiClient`), `client-context.tsx`, `http-client.ts`, `mock-client.ts`, `mock-seed.ts`.
  - `auth/`: `auth-context.tsx` (phiên JWT + chuyển nhanh 5 tài khoản mẫu `PA#3`).
  - `router/`: `router.tsx` (`Link`, khớp tham số động, `RoleGuard`).
  - `utils/`: `idempotency.ts`, `utf8.ts`, `safe-markdown.tsx`.
  - `components/`: `AppHeader.tsx`, `VerdictBadge.tsx`, `CodeViewer.tsx`, `ResponsiveTable.tsx`, `ProblemBanner.tsx`, `StatePanels.tsx`.
  - `pages/`: `LoginPage.tsx`, `admin/AdminClassesPage.tsx`, `ta/TaClassLabsPage.tsx`, `ta/TaCreateLabPage.tsx`, `ta/TaReviewQueuePage.tsx`, `student/StudentLabsPage.tsx`, `student/StudentLabSolvePage.tsx`.
- **Chế độ chuyển đổi API không sửa màn hình:** Điều khiển qua biến môi trường `VITE_API_MODE=mock | http` và `VITE_API_BASE_URL` (mặc định `/api`). Mọi màn hình chỉ gọi qua `LeeTkobApiClient`.
- **Khóa ranh giới dữ liệu sinh viên ở cả TypeScript & Mock:** `StudentSubmissionView` tách biệt hoàn toàn với `TaSubmissionReviewView`. `MockApiClient.getStudentSubmission()` chủ động loại bỏ test I/O (`FAQ-02`) và toàn bộ verdict/evidence/deduction (`FAQ-08`) khi `publishedAt === null`.

### 4.1. Danh sách 9 điểm chốt Contract/API cho Backend (`gateway/`)

1. **Prefix & CORS:** Hỗ trợ `VITE_API_BASE_URL` (proxy `/api` -> `gateway:3000` khi dev) và bật CORS có kiểm soát trên `gateway/`.
2. **Auth (`POST /auth/login`, `GET /auth/me`):** Trả `{ accessToken, expiresAt, user: { id, email, displayName, role, classIds } }`; seed 5 tài khoản mẫu `PA#3`.
3. **Classes (`GET /classes`, `POST /classes`):** Phân trang cursor `{ items, nextCursor }`, lọc theo vai trò/lớp trên server.
4. **Labs (`GET /classes/:classId/labs`, `POST /classes/:classId/labs`):** Nhận đủ `title`, `statement`, `openedAt`, `deadline`, `cpuTimeLimitSec` (`1–5`), `memoryLimitMb` (`64–512`), `testCases[]`, `constraints[]` (`code`, `type`, `description`, `patterns`, `deduction`).
5. **Lab Detail theo vai trò (`GET /labs/:labId`):** `STUDENT` chỉ nhận `sampleTests` và mô tả ràng buộc công khai; `TA/ADMIN` thuộc lớp nhận đầy đủ `testCases` và `constraints`; khác lớp trả `403` (hoặc `404` theo Session 06).
6. **Chuẩn hóa trạng thái bài nộp:** Tách `status` (`QUEUED | JUDGING | COMPLETED | JUDGE_ERROR`), `overallVerdict` (`AC | WA | TLE | MLE | RE | CE | null`), `isCountedForGrade` (`FAQ-04`).
7. **Student Submissions (`POST /labs/:labId/submissions`, `GET /labs/:labId/submissions/me`, `GET /submissions/:id`):** Khi `role === 'STUDENT'` và `publishedAt === null`, server chỉ trả `overallVerdict`, `testVerdicts[]` (`{ ordinal, verdict, timeMs }`), `compileOutput`, `code`, `publishedGrade: null`.
8. **TA Review Queue (`GET /labs/:labId/review-queue?scope=counted|all&bucket=...&cursor=...`, `GET /submissions/:id` với role `TA`):** Trả `TaSubmissionReviewView` gồm `checkerStatus`, `queueBucket`, `constraintVerdicts[]` (`verdict`, `unsureReason`, `taConfiguredDeduction`, `proposedDeduction`, `rationale`, `evidence[]`).
9. **RFC 9457 mở rộng `errors[]` & Realtime/Polling:** Hỗ trợ `errors?: Array<{ field, message }>` cho `400/422`; frontend tự động dùng polling `GET /submissions/:id` (và sẵn sàng nâng cấp sang SSE khi backend mở).

---

## 5. Tiêu chí Nghiệm thu

### 5.1. Kiểm chứng trên Mock (`vitest` offline + `vite build`)

1. **Phân quyền & cách ly lớp:** TA 2 mở lớp/review của TA 1 nhận `403`; SV truy cập route TA/Admin hoặc lab lớp khác bị chặn.
2. **TA tạo Lab (`sort-merge`):** Validate sau tương tác cho đủ 4 bước; tạo xong xuất hiện ngay ở lớp của TA và danh sách Lab của SV cùng lớp.
3. **Sinh viên nộp C++17 & Khóa ranh giới FAQ:** Kiểm tra giới hạn `64 KB` UTF-8, `Idempotency-Key` UUID v4 giữ nguyên khi retry lỗi mạng, chuyển trạng thái `QUEUED -> JUDGING -> COMPLETED` qua `role="status"`, gắn cờ bài tính điểm mới nhất (`FAQ-04`), và **khẳng định phủ định (Negative Privacy Assertion)**: DOM & dữ liệu SV trước Publish tuyệt đối không chứa test I/O, `violation`/`unsure`, `evidence` hay điểm trừ đề xuất.
4. **TA Review Queue:** Hiển thị đủ 3 bài mẫu `PA#3` ở chế độ `Mọi bài AC`, tô sáng đúng dòng `evidence` trên `CodeViewer` giữ số dòng gốc, hiện `unsureReason` (`FAQ-09`), mức trừ TA đặt, và không có nút "Duyệt tất cả" cho LLM.
5. **Quality Gate xanh:** `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run test`, và `npm run build --workspace=web` đều xanh 100% offline.

### 5.2. Điều kiện xác nhận tích hợp Backend thật (`VITE_API_MODE=http`)

1. Đăng nhập thành công 5 tài khoản mẫu bằng JWT thật từ `gateway/`.
2. TA 1 tạo bài `sort-merge` lưu bền vững qua `F5`; TA 2 truy cập bị backend chặn `403`/`404`.
3. SV 1 nộp 3 bài C++17 đi xuyên suốt `web -> gateway -> judge -> checker` và nhận verdict thật.
4. Kiểm tra HTTP Response thật cho SV 1 trước công bố: chính backend đã cắt bỏ test I/O và `checkerReview`.
5. TA 1 mở `/ta/labs/:labId/review` thấy đúng verdict, số dòng bằng chứng thật từ `checker/` và mức trừ đã đặt.
6. Playwright smoke script (`TA tạo Lab -> SV nộp bài -> TA xem bằng chứng`) PASS trên Docker Compose.
