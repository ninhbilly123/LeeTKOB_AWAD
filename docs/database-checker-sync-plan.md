# Kế hoạch Rà soát & Đồng bộ Database Migrations với Proposal, FAQ và Source `checker/`

> **Mục tiêu:** Đối chiếu từng bảng, cột và ràng buộc trong [0001_init_pa3_schema.up.sql](../gateway/migrations/0001_init_pa3_schema.up.sql) / [0001_init_pa3_schema.down.sql](../gateway/migrations/0001_init_pa3_schema.down.sql) và [postgres.store.ts](../gateway/src/persistence/postgres.store.ts) với mã nguồn thực tế của `checker/` ([models.py](../checker/src/models.py), [hard_rules.py](../checker/src/hard_rules.py), [sanitizer.py](../checker/src/sanitizer.py), [guardrails.py](../checker/src/guardrails.py), [llm_client.py](../checker/src/llm_client.py), [semantic_checker.py](../checker/src/semantic_checker.py)), hợp đồng [checker-output.md](contract/checker-output.md), [FAQ.md](proposal/FAQ.md) (`FAQ-01`..`FAQ-14`) và [proposal-detail.md](proposal/proposal-detail.md) (§2, §3, §4.2).
>
> **Trạng thái:** Đã duyệt **Phương án 1** (cập nhật trực tiếp `0001_init_pa3_schema.up.sql` & `.down.sql` thành 16 bảng chuẩn hóa) và hoàn tất đồng bộ mã nguồn `gateway/` + kiểm thử trên nhánh `fix/db-migration-checker-sync`.

---

## 1. Bảng Đối chiếu Chi tiết: 8 Điểm Lệch Phát hiện giữa Migration Hiện tại và `checker/` + Docs

| # | Vị trí hiện tại trong Migration / Store | Quy định trong Source `checker/` / `FAQ` / `Proposal` | Hệ quả nếu giữ nguyên | Hướng sửa đổi đề xuất |
| :-: | :--- | :--- | :--- | :--- |
| **1** | **[LỖI NGHIÊM TRỌNG]** `model_call_logs.request_id` đang đặt `CHECK (btrim(request_id) <> '')` và `UNIQUE (submission_id, request_id)` ([0001_init_pa3_schema.up.sql#L191-L203](../gateway/migrations/0001_init_pa3_schema.up.sql#L191)) | Trong [semantic_checker.py#L110-L159](../checker/src/semantic_checker.py#L110) và log chạy thật [call-log.jsonl](evidence/pa3-real-run/call-log.jsonl), khi lệnh gọi Gemini bị `TIMEOUT` hoặc `PROVIDER_ERROR` (HTTP 429/503/lỗi mạng trước khi có phản hồi), biến `request_id` là chuỗi rỗng `""`. Ngoài ra theo [proposal-detail.md#L69](proposal/proposal-detail.md#L69) (`E3`), khi sai schema có thể gọi lại tối đa 1 lần (2 log trong cùng 1 submission). | Khi `checker/` gặp `TIMEOUT` hoặc `PROVIDER_ERROR`, lệnh `INSERT INTO model_call_logs` sẽ **bị PostgreSQL từ chối do vi phạm `CHECK (btrim(request_id) <> '')` và ROLLBACK toàn bộ transaction**, làm mất luôn cả kết quả `verdict = 'unsure'` mà guardrail vừa tạo! | - Cho phép `request_id TEXT NOT NULL DEFAULT ''`, đổi `CHECK` thành: **`CHECK (status <> 'OK' OR btrim(request_id) <> '')`** (chỉ bắt buộc `request_id` thật khác rỗng khi `status = 'OK'`, đúng Criterion 4).<br>- Thêm cột `call_ordinal INTEGER NOT NULL DEFAULT 1 CHECK (call_ordinal >= 1)`, đặt `UNIQUE (submission_id, call_ordinal)` và tạo Partial Unique Index `uniq_model_call_logs_req_id ON model_call_logs (submission_id, request_id) WHERE btrim(request_id) <> ''`. |
| **2** | **Làm rơi 3 trường cấp cao nhất của `CheckerResult` (`model`, `promptVersion`, `checkedAt`) và thiếu `raw_response` trong `model_call_logs`** | - [models.py#L59-L67](../checker/src/models.py#L59) và [checker-output.md#L29-L36](contract/checker-output.md#L29) định nghĩa `CheckerResult` gồm `{ submissionId, results, model, promptVersion, checkedAt, callLogs }`.<br>- [proposal-detail.md#L72](proposal/proposal-detail.md#L72) (§2.2 bước 9, §2.4, §4.2 `CheckRun`) yêu cầu lưu `model`, `prompt_version` (`"v1"` từ [sanitizer.py#L16](../checker/src/sanitizer.py#L16)), thời điểm soát `checked_at`, và đầu ra thô của mô hình để truy vết khi lỗi schema/publish. | Hiện `recordCheckerResult()` không lưu `CheckerResult.model`, `CheckerResult.promptVersion` và `CheckerResult.checkedAt` vào DB; khi `status = 'SCHEMA_INVALID'` cũng không lưu lại chuỗi thô model trả về để TA/nhóm gỡ lỗi. | - Thêm `checker_model TEXT NULL`, `prompt_version TEXT NULL`, `checked_at TIMESTAMPTZ NULL` vào bảng `submissions`.<br>- Thêm `prompt_version TEXT NOT NULL DEFAULT 'v1'` và `raw_response TEXT NULL` vào bảng `model_call_logs`. |
| **3** | **Bảng `constraint_findings` thiếu `CHECK` bắt buộc `evidence` không rỗng khi `verdict = 'violation'` và thiếu `CHECK` đồng bộ `review_status` ↔ `ta_decision`** ([0001_init_pa3_schema.up.sql#L148-L185](../gateway/migrations/0001_init_pa3_schema.up.sql#L148)) | - [guardrails.py#L152-L161](../checker/src/guardrails.py#L152) và [checker-output.md#L45](contract/checker-output.md#L45) quy định: khi `verdict = 'violation'`, mảng `evidence` bắt buộc có ít nhất 1 dòng (`len >= 1`).<br>- Khi `review_status IN ('NOT_QUEUED', 'PENDING_REVIEW')` thì TA chưa quyết (`ta_decision IS NULL`); khi `review_status IN ('APPROVED_VIOLATION', 'DISMISSED_PASS', 'OVERRIDDEN')` thì bắt buộc `ta_decision IS NOT NULL` và `reviewed_at IS NOT NULL`. | Bất biến quan trọng của `checker-output.md` mới chỉ kiểm ở Python, chưa được khóa ở tầng PostgreSQL theo nguyên tắc *"Database as the Final Enforcer"* (Session 04). | Thêm 2 ràng buộc vào `constraint_findings`:<br>1. `CHECK (verdict <> 'violation' OR (jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) >= 1))`<br>2. `CHECK ((review_status IN ('NOT_QUEUED', 'PENDING_REVIEW')) = (ta_decision IS NULL))` |
| **4** | **Lệch tên enum `'SEMANTIC_LLM'` vs `'LLM'`, thiếu `lab_id` trên `constraint_findings` và khóa ngoại phụ thuộc vào ID tổng hợp `con_${labId}_${code}`** ([0001_init_pa3_schema.up.sql#L76](../gateway/migrations/0001_init_pa3_schema.up.sql#L76), [#L151](../gateway/migrations/0001_init_pa3_schema.up.sql#L151)) | - `checker/` ([models.py#L6](../checker/src/models.py#L6)) dùng `FindingSource = Literal["HARD_RULE", "LLM"]`, trong khi `lab_constraints.check_type` lại đặt `'HARD_RULE' \| 'SEMANTIC_LLM'`.<br>- `checker/` chỉ nhận và trả mã ràng buộc theo bài lab (`"C1"`, `"C2"`), tự nhận diện quy tắc cứng bằng regex `^\s*do\s+not\s+(?:use\|call)\b` ([hard_rules.py#L16](../checker/src/hard_rules.py#L16)). | - Tên enum không đồng nhất giữa 2 bảng liền kề.<br>- `constraint_findings` không có cột `lab_id` nên mọi truy vấn Hàng chờ Review hoặc đếm mẫu 10% theo `lab_id` đều phải `JOIN submissions`, và khóa ngoại phụ thuộc chuỗi ghép thủ công `con_${labId}_${code}`. | - Cho phép `lab_constraints.check_type` nhận `'HARD_RULE' \| 'LLM'` (hoặc giữ tương thích `'SEMANTIC_LLM'`).<br>- Thêm cột `lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE` vào `constraint_findings`, đặt khóa ngoại tự nhiên `FOREIGN KEY (lab_id, constraint_code) REFERENCES lab_constraints(lab_id, constraint_code) ON UPDATE CASCADE ON DELETE CASCADE` và index `idx_findings_lab_review ON constraint_findings (lab_id, review_status)`. |
| **5** | **Thiếu cân bằng lại mẫu 10% `pass` (`FAQ-10`) khi sinh viên nộp lại bài mới bị `WA`/`CE` (`FAQ-02`)** | Theo [FAQ.md#L68-L72](proposal/FAQ.md#L68) (`FAQ-02`), bài được tính là bài nộp cuối cùng trước hạn (kể cả khi nộp lại bị `WA`). Theo `FAQ-10`, Hàng chờ TA luôn phải có $\lceil 10\% \times \text{tổng số pass của các bài được tính trong lab} \rceil$. | Nếu bài #1 của SV đạt `AC` và giữ mẫu 10% `pass`, sau đó SV nộp bài #2 bị `WA` (`sub_1.is_counting = FALSE`, `sub_2.is_counting = TRUE`), bài #2 không gọi `recordCheckerResult()` nên mẫu 10% trên bài #1 rơi khỏi hàng chờ mà chưa được bù sang bài `AC` đang tính điểm của SV khác. | Tách hàm cân bằng mẫu 10% `pass` (`rebalanceLabPassSample(labId)`) và gọi ở cả `recordCheckerResult()`, khi một bài `AC` cũ bị lật `is_counting = FALSE`, và ngay trước khi kiểm tra điều kiện `publishLabAtomic()`. |
| **6** | **Bảng `submissions` chưa có `UNIQUE (student_id, idempotency_key)` riêng và chưa có cột cho TA nhập/sửa điểm tay (`FAQ-04`, `FAQ-11`, `FAQ-12`)** | - Nếu bản ghi trong `idempotency_records` hết hạn sau 24h và bị dọn dẹp, bảng `submissions` hiện tại ([0001_init_pa3_schema.up.sql#L98](../gateway/migrations/0001_init_pa3_schema.up.sql#L98)) có cột `idempotency_key UUID NOT NULL` nhưng chưa có ràng buộc `UNIQUE`.<br>- `FAQ-04`, `FAQ-11`, `FAQ-12` và [proposal-detail.md#L348](proposal/proposal-detail.md#L348) (`Grade`) cho phép TA nhập điểm tay cho bài không `AC` hoặc chỉnh điểm từng bài kèm lý do và nhật ký. | - Thiếu chốt chặn chống trùng trực tiếp trên bảng `submissions`.<br>- Không có cột lưu điểm chỉnh tay và lý do chỉnh tay trên bài nộp. | - Thêm `UNIQUE (student_id, lab_id, idempotency_key)` trên `submissions`.<br>- Thêm `manual_score_centipoints INTEGER NULL CHECK (manual_score_centipoints BETWEEN 0 AND 1000)`, `manual_score_reason TEXT NULL`, `manual_scored_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL`, `manual_scored_at TIMESTAMPTZ NULL`, kèm `CHECK ((manual_score_centipoints IS NULL) = (manual_score_reason IS NULL))` vào `submissions`. |
| **7** | **Thiếu cột/bảng cho Mã mời vào lớp (`FAQ-01`), Lịch sử sửa ràng buộc (`FAQ-07`) và Khiếu nại khoản trừ trong 7 ngày (`FAQ-13`, `FAQ-14`) theo danh sách thực thể ở [proposal-detail.md#L348](proposal/proposal-detail.md#L348)** | [proposal-detail.md#L348](proposal/proposal-detail.md#L348) liệt kê rõ các thực thể PostgreSQL: `User`, `Class`, `ClassMember`, `Lab`, `TestCase`, `Constraint` (kèm **`ConstraintRevision`**), `Submission`, `JudgeResult`, `Finding`, `Grade`, **`Appeal`**, `AuditLog`.<br>- `FAQ-01`: mã mời vào lớp (`invite_code`).<br>- `FAQ-07`: sau khi mở bài không được thêm ràng buộc hay tăng mức trừ; lưu lịch sử mọi bản sửa và hiện ngày sửa gần nhất.<br>- `FAQ-13` & `FAQ-14`: khiếu nại **từng khoản trừ** trong **7 ngày** sau Publish; mỗi khoản trừ chỉ khiếu nại **1 lần duy nhất** (không mở lại được khi bị bác); TA chấp nhận hoặc bác đều phải có lý do. | Schema hiện tại mới có 14 bảng cho luồng nộp/chấm cơ bản, còn thiếu `invite_code`, `constraints_updated_at`, bảng `lab_constraint_revisions` và bảng `grade_appeals`. | - Thêm `invite_code TEXT NULL UNIQUE` vào `classes`.<br>- Thêm `constraints_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` vào `labs` và tạo bảng `lab_constraint_revisions`.<br>- Tạo bảng `grade_appeals` gắn với `finding_id TEXT NOT NULL UNIQUE REFERENCES constraint_findings(id) ON DELETE CASCADE` (ràng buộc `UNIQUE (finding_id)` ép cứng luật `FAQ-14` mỗi khoản trừ chỉ khiếu nại tối đa 1 lần). |
| **8** | **Bảng `submission_jobs` chưa lưu kèm `student_identifiers` để `checker/src/sanitizer.py` ẩn danh thông tin SV trong prompt (`PA#3 Criterion 4`, `FAQ-06`)** | Hàm `check_submission(..., student_identifiers=...)` trong [semantic_checker.py#L40](../checker/src/semantic_checker.py#L40) và [sanitizer.py#L60](../checker/src/sanitizer.py#L60) nhận danh sách định danh của sinh viên (`id`, `username`, `email`, `display_name`) để thay bằng `[REDACTED]` trước khi tạo prompt gửi Gemini. | Hiện `buildSubmissionJob()` trong `postgres.store.ts` mới chỉ truyền `studentId`, chưa truyền `username`, `email`, `displayName` vào job payload cho worker. | Khi tạo `SubmissionJob`, nạp đủ mảng `studentIdentifiers: [id, username, email, displayName]` vào payload outbox để worker truyền thẳng sang `checker/`. |

---

## 2. Thiết kế Chi tiết các Thay đổi Schema SQL

### 2.1. Sửa bảng `model_call_logs` (Khớp 100% `checker/src/semantic_checker.py` & `llm_client.py`)

```sql
CREATE TABLE IF NOT EXISTS model_call_logs (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  call_ordinal INTEGER NOT NULL DEFAULT 1 CHECK (call_ordinal >= 1),
  request_id TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL CHECK (btrim(model) <> ''),
  prompt_version TEXT NOT NULL DEFAULT 'v1' CHECK (btrim(prompt_version) <> ''),
  constraints JSONB NOT NULL DEFAULT '[]'::jsonb,
  sanitized_prompt TEXT NOT NULL,
  raw_response TEXT NULL,
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  estimated_cost_micros BIGINT NOT NULL DEFAULT 0 CHECK (estimated_cost_micros >= 0),
  status TEXT NOT NULL CHECK (
    status IN ('OK', 'SCHEMA_INVALID', 'EVIDENCE_MISMATCH', 'TIMEOUT', 'PROVIDER_ERROR')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, call_ordinal),
  -- Bắt buộc có provider request_id thật khi gọi thành công (PA#3 Criterion 4),
  -- nhưng không làm crash transaction khi TIMEOUT / PROVIDER_ERROR chưa có request_id.
  CHECK (status <> 'OK' OR btrim(request_id) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_model_call_logs_req_id
  ON model_call_logs (submission_id, request_id)
  WHERE btrim(request_id) <> '';
```

### 2.2. Nâng cấp bảng `submissions` (Lưu metadata `CheckerResult` + Điểm chỉnh tay `FAQ-04`/`FAQ-12`)

```sql
-- Các cột bổ sung trên bảng submissions:
  checker_model TEXT NULL,
  prompt_version TEXT NULL,
  checked_at TIMESTAMPTZ NULL,
  manual_score_centipoints INTEGER NULL CHECK (manual_score_centipoints BETWEEN 0 AND 1000),
  manual_score_reason TEXT NULL,
  manual_scored_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  manual_scored_at TIMESTAMPTZ NULL,
  UNIQUE (student_id, lab_id, idempotency_key),
  CHECK (
    (manual_score_centipoints IS NULL)
    = (manual_score_reason IS NULL OR btrim(manual_score_reason) = '')
  )
```

### 2.3. Nâng cấp bảng `lab_constraints` & `constraint_findings` (Khớp `checker/src/guardrails.py` & `FAQ-09`/`FAQ-10`)

```sql
-- Trên lab_constraints:
  check_type TEXT NOT NULL DEFAULT 'LLM' CHECK (check_type IN ('HARD_RULE', 'LLM', 'SEMANTIC_LLM')),

-- Trên constraint_findings:
  lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  ...
  FOREIGN KEY (lab_id, constraint_code)
    REFERENCES lab_constraints(lab_id, constraint_code)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK ((verdict = 'unsure') = (unsure_reason IS NOT NULL)),
  -- Bắt buộc từ checker/src/guardrails.py & checker-output.md §2.2:
  CHECK (
    verdict <> 'violation'
    OR (jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) >= 1)
  ),
  -- Đồng bộ trạng thái hàng chờ và quyết định của TA:
  CHECK ((review_status IN ('NOT_QUEUED', 'PENDING_REVIEW')) = (ta_decision IS NULL)),
  -- Luật FAQ-09: TA chọn VIOLATION bắt buộc có ít nhất 1 dòng bằng chứng:
  CHECK (
    ta_decision IS DISTINCT FROM 'VIOLATION'
    OR (jsonb_typeof(ta_evidence) = 'array' AND jsonb_array_length(ta_evidence) >= 1)
  )
```

### 2.4. Bổ sung bảng `lab_constraint_revisions` (`FAQ-07`) và `grade_appeals` (`FAQ-13`, `FAQ-14`)

```sql
-- Lịch sử chỉnh sửa ràng buộc (FAQ-07 & proposal-detail.md §4.2 ConstraintRevision)
CREATE TABLE IF NOT EXISTS lab_constraint_revisions (
  id TEXT PRIMARY KEY,
  lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  constraint_id TEXT NOT NULL REFERENCES lab_constraints(id) ON DELETE CASCADE,
  constraint_code TEXT NOT NULL,
  previous_text TEXT NOT NULL,
  new_text TEXT NOT NULL,
  previous_deduction_centipoints INTEGER NOT NULL CHECK (previous_deduction_centipoints BETWEEN 0 AND 1000),
  new_deduction_centipoints INTEGER NOT NULL CHECK (new_deduction_centipoints BETWEEN 0 AND 1000),
  changed_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- FAQ-07: Sau khi mở bài, không được tăng mức trừ
  CHECK (new_deduction_centipoints <= previous_deduction_centipoints)
);

-- Khiếu nại từng khoản trừ sau khi Publish trong 7 ngày (FAQ-13, FAQ-14 & proposal-detail.md §4.2 Appeal)
CREATE TABLE IF NOT EXISTS grade_appeals (
  id TEXT PRIMARY KEY,
  lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  finding_id TEXT NOT NULL UNIQUE REFERENCES constraint_findings(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  student_reason TEXT NOT NULL CHECK (btrim(student_reason) <> ''),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
  ta_decision_reason TEXT NULL,
  resolved_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ NULL,
  -- FAQ-13 & FAQ-14: Khi TA chấp nhận hoặc bác khiếu nại, bắt buộc phải có lý do
  CHECK (
    (status = 'PENDING' AND ta_decision_reason IS NULL AND resolved_at IS NULL)
    OR (status IN ('ACCEPTED', 'REJECTED') AND ta_decision_reason IS NOT NULL AND btrim(ta_decision_reason) <> '' AND resolved_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_appeals_lab_status
  ON grade_appeals (lab_id, status, created_at DESC);
```

---

## 3. Kế hoạch Tổ chức File Migration & Cập nhật Code (`gateway/`)

### 3.1. Phương án Tổ chức Migration (Cần bạn chốt)
- **Phương án 1 (Gộp gọn vào `0001_init_pa3_schema.up.sql` & `.down.sql`):**
  Vì hệ thống hiện mới ở giai đoạn phát triển trước khi deploy máy chủ `PA#3` chính thức, việc cập nhật trực tiếp vào `0001_init_pa3_schema.up.sql` / `.down.sql` giúp schema khởi tạo sạch sẽ ngay từ đầu trong một file duy nhất (16 bảng chuẩn hóa, không có bảng vừa tạo ở `0001` đã phải `ALTER` ngay ở `0002`).
- **Phương án 2 (Tạo thêm `0002_align_checker_and_proposal.up.sql` & `.down.sql`):**
  Giữ nguyên `0001` đã merge ở PR #21 và viết toàn bộ lệnh `ALTER TABLE` / `CREATE TABLE` bổ sung trong cặp migration `0002` theo đúng mô hình Expand Migration (Session 04).

### 3.2. Các bước cập nhật trong `gateway/` sau khi bạn duyệt
1. **Bước 1 — Cập nhật Migration SQL (`.up.sql` & `.down.sql`):**
   Áp dụng đủ các sửa đổi ở Mục `2.1`–`2.4` (sửa lỗi `model_call_logs.request_id` rỗng khi `TIMEOUT`/`PROVIDER_ERROR`, thêm `checker_model`/`prompt_version`/`checked_at`, thêm `CHECK` `evidence` cho `violation`, thêm `lab_id` vào `constraint_findings`, thêm `invite_code`, `manual_score_*`, `lab_constraint_revisions`, `grade_appeals`).
2. **Bước 2 — Đồng bộ `submissions.types.ts`, `mappers.ts`, `postgres.store.ts` & `submissions.store.ts`:**
   - Cập nhật `CheckerCompletionInput` nhận đầy đủ `{ submissionId, labId, model, promptVersion, checkedAt, findings, callLogs }` khớp 1:1 với `CheckerResult` trong `checker/src/models.py`.
   - Trong `recordCheckerResult()`: lưu `checker_model`, `prompt_version`, `checked_at` vào `submissions`; lưu `call_ordinal`, `prompt_version`, `raw_response` và `request_id` (kể cả khi `""` ở trạng thái lỗi) vào `model_call_logs` dùng `ON CONFLICT (submission_id, call_ordinal) DO UPDATE`.
   - Tách hàm cân bằng mẫu 10% `pass` (`rebalanceLabPassSample`) để đảm bảo luôn đủ $\lceil 10\% \rceil$ kể cả khi sinh viên nộp đè bài `WA` (`FAQ-02`, `FAQ-10`).
   - Đính kèm `studentIdentifiers` vào `buildSubmissionJob()` cho `checker/src/sanitizer.py`.
3. **Bước 3 — Kiểm thử & Quality Gate:**
   - Bổ sung test trong `gateway/test/database-hardening.spec.ts` kiểm chứng:
     - `recordCheckerResult()` thành công khi `ModelCallLog` có `status = 'TIMEOUT'` hoặc `'PROVIDER_ERROR'` với `requestId = ""` (không bị lỗi constraint);
     - Lưu và đọc đúng `model`, `promptVersion`, `checkedAt` từ `CheckerResult`;
     - Kiểm tra đầy đủ 16 bảng trong `.up.sql` và thứ tự drop trong `.down.sql`;
     - Chạy xanh cả 4 lệnh Quality Gate (`npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run test`).
