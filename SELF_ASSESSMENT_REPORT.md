# Self-Assessment Report — PA#2: Harness and Quality Gate

- **Nhóm**: LeeTKOB Team (Phạm An Ninh, Huỳnh Đăng Khoa, Nguyễn Nhật Duy)
- **Repository**: https://github.com/ninhbilly123/LeeTKOB_AWAD
- **Tổng điểm tự đánh giá**: 100 / 100 điểm

---

## 1. Bảng điểm tự đánh giá chi tiết

| # | Tiêu chí | Điểm tối đa | Điểm tự chấm | Dẫn chứng kiểm chứng (Evidence) |
|---|---|:---:|:---:|---|
| **1** | **Rules file** | 15 | 15 | File `AGENTS.md` và `CLAUDE.md` tại root, đủ 4 mục (`stack`, `commands`, `conventions`, `never`). Mục `never` đặc thù LeeTKOB (không secret trong sandbox, không gọi LLM trong unit test, không sửa test/data để qua check). Có 2 câu chuyện lỗi thực tế truy vết được. |
| **2** | **Permissions and secrets** | 10 | 10 | Quyền AI chia rõ 3 tầng (`allowed`, `ask first`, `never`) trong `AGENTS.md`. File `.env.example` liệt kê đầy đủ biến không có giá trị thật. Lịch sử git sạch 100% không secret. README ghi rõ model Gemini 3.1 Flash-Lite có spending cap = $10 USD. |
| **3** | **One command for every check** | 10 | 10 | 4 lệnh duy nhất tại root: `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run test`. Lệnh chạy local và trong CI `.github/workflows/ci.yml` giống hệt nhau 100%. Clone mới làm theo README là xanh. |
| **4** | **CI that blocks a merge** | 20 | 20 | Nhánh `main` được bảo vệ (Branch Protection), bắt buộc Quality Gate check pass mới cho merge. Có bằng chứng link PR đỏ bị chặn và commit fix làm xanh lại trong `PA2.md`. Không push thẳng vào `main`. |
| **5** | **The contract of one endpoint** | 25 | 25 | File `docs/contract/post-submissions.md` cho endpoint `POST /labs/{labId}/submissions`. Phân quyền role/ownership chặt chẽ, format lỗi chuẩn RFC 9457 Problem Details, cơ chế Idempotency-Key chống nộp trùng. |
| **6** | **Contract tests that bite** | 15 | 15 | Bộ test kiểm thử mọi trường hợp lỗi RFC 9457, test ownership và idempotency. Chạy trong CI bắt buộc. Có link commit deliberate contract break khiến CI báo đỏ. |
| **7** | **AI-LOG.md** | 5 | 5 | File `AI-LOG.md` tại root ghi chép đầy đủ tool, phần việc, các mục Changed và Rejected thực tế của các thành viên. |
| **TỔNG** | | **100** | **100** | |

---

## 2. Những gì nhóm chưa làm được (What we did not manage)

- Service `judge` (Java Spring Boot) hiện tại mới ở dạng khởi tạo khung kiến trúc, các pipeline sandbox test chi tiết sẽ được hoàn thiện trong milestone tiếp theo (PA#3) theo đúng lộ trình đã đề ra trong proposal.
- Hàng đợi RabbitMQ và cơ chế gởi bài nộp sang worker hiện đang dùng mock/stub trong phạm vi contract test của PA#2.
