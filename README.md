# LeeTKOB

LeeTKOB là hệ thống chấm bài thực hành C++ sau hạn nộp, tích hợp LLM nhằm **soát ràng buộc của đề và đề xuất trừ điểm** kèm trích dẫn dòng code vi phạm làm bằng chứng. Trợ giảng (TA) duyệt đề xuất trước khi công bố điểm; mô hình không tự quyết mức trừ.

Đồ án môn học: **CSC13114 — Phát triển ứng dụng web nâng cao (học phần tốt nghiệp)**.

---

## 1. Thành viên nhóm

- **Phạm An Ninh** (Leader - Phụ trách DevOps, CI/CD, Quality Gate & Branch Protection)
- **Huỳnh Đăng Khoa** (Phụ trách Backend API, Contract Specification & Contract Tests)
- **Nguyễn Nhật Duy** (Phụ trách AI Harness, Rules, Permissions & Security)

---

## 2. Kiến trúc Monorepo

Repository được tổ chức theo cấu trúc monorepo:
- `gateway/`: Gateway và Core API viết bằng Node.js / NestJS (Authentication, Labs, Submissions, Review Queue).
- `checker/`: Service soát ràng buộc viết bằng Python (Tree-sitter C++ AST parser cho luật cứng & LLM semantic checker).
- `web/`: Giao diện người dùng viết bằng React + Vite + TypeScript (Dashboard cho TA & Giao diện nộp bài cho sinh viên).
- `judge/`: Service chấm bài đa luồng (Sandbox Docker).
- `docs/contract/`: Tài liệu API contract (chuẩn RFC 9457).

---

## 3. Cài đặt cho bản clone mới (Fresh Clone Setup)

### Yêu cầu môi trường
- **Node.js**: >= 20 (khuyến nghị Node 22 LTS)
- **npm**: >= 10
- **Python**: >= 3.11 (khuyến nghị Python 3.12)

### Các bước cài đặt
```bash
# 1. Cài đặt dependencies cho Node.js workspaces (gateway, web)
npm install

# 2. Cài đặt công cụ kiểm tra cho Python (checker)
pip install ruff mypy pytest
```

---

## 4. Các lệnh kiểm tra chất lượng (One Command for Every Check)

Tuân thủ nghiêm ngặt **Tiêu chí 3 của PA#2**, mỗi loại kiểm tra được thực hiện bằng **đúng một lệnh duy nhất** ở cả môi trường local lẫn trong CI:

| Loại kiểm tra | Câu lệnh duy nhất | Nội dung thực hiện |
|---|---|---|
| **Lint** | `npm run lint` | Chạy ESLint trên `gateway`, `web` và Ruff Lint trên `checker` |
| **Format Check** | `npm run format:check` | Kiểm tra định dạng Prettier trên `gateway`, `web` và Ruff Format trên `checker` |
| **Type Check** | `npm run typecheck` | Kiểm tra kiểu dữ liệu với `tsc --noEmit` (`gateway`, `web`) và `mypy` (`checker`) |
| **Tests** | `npm run test` | Chạy Jest unit/contract tests (`gateway`), Vitest (`web`) và Pytest (`checker`) |

> **Cam kết:** Bất kỳ ai clone mới repository và thực hiện các bước ở Mục 3, sau đó chạy 4 lệnh trên đều đạt kết quả xanh (Green - Exit code 0).

---

## 5. Quy định bảo mật & Giới hạn chi tiêu (Criterion 2)

- **Không lưu secret trong repo:** Toàn bộ cấu hình nhạy cảm được quản lý qua biến môi trường. File `.env.example` liệt kê đầy đủ các biến cần thiết mà không chứa bất kỳ giá trị thật nào. Lịch sử git được bảo đảm sạch 100% không có secret/token.
- **Spending Cap của LLM:** API key của mô hình (Gemini 3.1 Flash-Lite) được cấu hình **hạn mức chi tiêu tối đa (spending cap) là $10 USD** tại Google Cloud / AI Studio để tránh rủi ro vượt ngân sách.
