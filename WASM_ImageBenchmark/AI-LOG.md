# Nhật ký seminar D5

Bốn mục đầu được bổ sung từ lịch sử trao đổi ngày 19/11/2026.

## 2026-11-19 — Đánh giá đề tài D5
Tool: OpenAI Codex.
Asked for: Đọc rubric và đánh giá câu hỏi so sánh nén ảnh trong trình duyệt với nén trên server.
Kept: Phạm vi một lô 10 ảnh khoảng 50 MB và ba chỉ số trong câu hỏi gốc của nhóm.
Changed: Codex đề xuất cách hỏi trung lập về độ trễ và đưa bộ nhớ thành chỉ số phụ sau khi đối chiếu rubric và tài liệu đo bộ nhớ của Chrome. README.md và REPORT.md vẫn ghi câu hỏi gốc.
Rejected: Giả định độ trễ chắc chắn giảm. Rubric công nhận cả kết quả không cải thiện.

## 2026-11-19 — Lập kế hoạch ngày đầu
Tool: OpenAI Codex.
Asked for: Xem repo mới và đề xuất các bước đến hạn nộp seminar.
Kept: Đề xuất thử một ảnh ở cả hai luồng trước, rồi mới mở rộng phép đo và thử chạy từ bản clone mới.
Changed: Đặt việc dựng khung trước các mốc triển khai và đo sau khi git status và git remote xác nhận repo chưa có commit và chưa cấu hình remote.
Rejected: Không có. Đã kiểm tra môi trường bằng node --version và npm.cmd --version.

## 2026-11-19 — Dựng khung tài liệu repo
Tool: OpenAI Codex.
Asked for: Dựng khung hồ sơ theo rubric và điền thông tin ba thành viên.
Kept: README.md, REPORT.md, TALK.md và results/README.md, gồm câu hỏi gốc, thông tin nhóm và phần chờ điền kết quả.
Changed: Nhóm tạo lại AI-LOG.md và SELF_ASSESSMENT_REPORT.md theo mẫu nhóm cung cấp. Bản khung ban đầu đã được đối chiếu về MSSV, liên kết nội bộ và sáu thang điểm trong rubric.
Rejected: Mẫu tự soạn cho hai tệp trên được thay bằng mẫu nhóm đưa vào repo.

## 2026-11-19 — Đọc lại hai mẫu của nhóm
Tool: OpenAI Codex.
Asked for: Đọc hai tệp AI-LOG và SELF_ASSESSMENT_REPORT mới để dùng đúng format ở các lần cập nhật sau.
Kept: Các trường Tool, Asked for, Kept, Changed, Rejected và cấu trúc bảng tự chấm của mẫu.
Changed: Ghi rõ rằng khi điền bảng tự chấm sẽ áp dụng sáu tiêu chí D5 theo rubric.
Rejected: Các tiêu chí và số điểm IA#1 trong ví dụ, vì đó là mẫu của bài khác. Đã đối chiếu với rubric D5.

## 2026-11-19 — Cập nhật nhật ký sử dụng AI
Tool: OpenAI Codex.
Asked for: Ghi vào AI-LOG.md mỗi lần Codex hỗ trợ một task của dự án.
Kept: Nội dung hướng dẫn và ví dụ có sẵn trong mẫu.
Changed: Thêm các mục theo từng task đã làm, dùng năm trường của mẫu và ghi rõ các mục được bổ sung từ lịch sử trao đổi.
Rejected: Không có. Đã đối chiếu mỗi mục với format và xác nhận nội dung mẫu gốc được giữ nguyên.

## 2026-11-19 — Đối chiếu hồ sơ D5 với rubric PDF
Tool: OpenAI Codex.
Asked for: Đọc kỹ rubric PDF và kiểm tra các phần còn thiếu trong repo.
Kept: Câu hỏi D5, cấu trúc hồ sơ và các mục của mẫu tự chấm nhóm cung cấp.
Changed: Khi viết quy tắc trước đó dựa trên bản TXT bị cắt, Codex bỏ sót yêu cầu mức 9–10 của AI-LOG. Đối chiếu tiêu chí 6 ở trang 7 bản PDF cho thấy phải ghi ít nhất một lỗi thật của AI và cách phát hiện. Đã bổ sung vào AGENTS.md và làm rõ cách lưu log theo tiêu chí 2 ở trang 6.
Rejected: Năm tiêu chí và điểm 82/100 của ví dụ IA#1, vì trang 6 và 8 yêu cầu tự chấm theo sáu tiêu chí seminar và có minh chứng. Khung D5 để trống điểm thực tế.
