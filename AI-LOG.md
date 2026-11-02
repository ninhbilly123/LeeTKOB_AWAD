# AI-LOG

Mỗi mục ghi lại một công việc có trợ lý AI tham gia thực hiện, tuân thủ đúng template của môn học CSC13114.
Thành viên:
- **Phạm An Ninh (MSSV: Leader / DevOps & CI Gate)**
- **Huỳnh Đăng Khoa (MSSV: Backend & Contract)**
- **Nguyễn Nhật Duy (MSSV: AI Harness & Security)**

---

## 2026-11-02 — Thiết lập Quality Gate CI và Monorepo Checks (Phạm An Ninh)
- **Tool**: Claude / Gemini (Antigravity).
- **Asked for**: Thiết lập 4 lệnh kiểm tra chất lượng chuẩn hóa cho monorepo đa ngôn ngữ (TypeScript + Python), cấu hình GitHub Actions CI chặn merge trên branch `main`, và cơ chế Branch Protection theo Rubric PA#2.
- **Kept**: 
  - 4 câu lệnh duy nhất tại root `package.json`: `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run test`.
  - Kịch bản GitHub Actions workflow `.github/workflows/ci.yml` chạy cả Node 22 và Python 3.12 để kiểm tra toàn bộ service (`gateway`, `web`, `checker`).
  - Phân quyền AI 3 tầng (`allowed`, `ask first`, `never`) và 2 câu chuyện lỗi thực tế đưa vào `AGENTS.md` / `CLAUDE.md`.
- **Changed**:
  - Ban đầu AI đề xuất cấu hình npm scripts dạng chuỗi `&& (cd checker && ruff check .)` - cách này bị lỗi cú pháp trên Windows PowerShell. Nhóm đã yêu cầu chuyển sang script runner `scripts/run-check.mjs` chạy qua `node:child_process.spawnSync`, tương thích 100% cả Windows local lẫn Linux GitHub Actions.
  - Sửa `checker/pyproject.toml` thêm cấu hình `pythonpath = ["."]` để `pytest` nhận diện đúng package khi chạy từ thư mục root của monorepo.
- **Rejected**:
  - Từ chối đề xuất của AI tách thành 4 workflow riêng biệt hoặc bỏ qua kiểm tra Python ở local, vì Rubric Tiêu chí 3 bắt buộc: "A fresh clone that follows the README gets them green" và một lệnh phải chạy cho toàn bộ repo.
  - Từ chối dùng `continue-on-error: true` trong CI step: mọi check đều phải strict (thất bại là chặn merge ngay lập tức).
- **By hand**:
  - Cấu hình Branch Protection trên GitHub web console (`Require status checks to pass before merging`, `Require branches to be up to date before merging`, `Require pull request reviews`).
  - Tạo Pull Request vi phạm chất lượng để kiểm tra CI chặn đỏ (bằng chứng cho Tiêu chí 4).
