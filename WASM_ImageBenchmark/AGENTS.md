# AGENTS.md

## Phạm vi đồ án

- Đây là nghiên cứu seminar D5 về nén một lô cố định gồm 10 ảnh JPEG độ phân giải cao, tổng khoảng 50 MB. Xem `README.md` và `REPORT.md` để lấy câu hỏi hiện hành. Khi nhóm đổi câu hỏi, đồng bộ hai tệp và các tài liệu liên quan.
- Baseline tải JPEG gốc lên rồi nén bằng WebAssembly trên máy chủ Node.js. Luồng thử nghiệm nén bằng cùng pipeline WebAssembly trong trình duyệt rồi tải kết quả lên.
- Hai chỉ số chính là dung lượng tải lên (MB) và độ trễ từ lúc gửi đến khi trình duyệt nhận xác nhận từ máy chủ (ms). Dùng cùng cách tính dung lượng và cùng mốc đo ở cả hai luồng.

## Làm việc trong repo

- Đọc các tệp liên quan và giữ các chỉnh sửa của nhóm. Giới hạn thay đổi theo yêu cầu hiện tại và dùng lại cách làm sẵn có khi phù hợp.
- Cập nhật `README.md` khi các bước cài đặt, dữ liệu hoặc lệnh đo thay đổi. Ghi lệnh thực sự tồn tại và đã được kiểm tra.
- Dùng ảnh có quyền phân phối, ghi nguồn và cách lấy đúng bộ ảnh. Giữ thông tin đăng nhập, khóa API và dữ liệu riêng tư ngoài repo, log và prompt. Chạy benchmark trên hệ thống nhóm kiểm soát.

## Phép đo và kiểm chứng

- So sánh hai luồng với cùng bộ ảnh, bản build và cấu hình codec, máy, mức tải và cấu hình mạng. Ghi rõ điều kiện thực nghiệm và các yếu tố giữ cố định.
- Từ bản clone mới, các bước trong `README.md` phải dẫn đến một lệnh chạy lại phép đo. Lệnh in kết quả và lưu lệnh đã chạy cùng dữ liệu thô từng lượt trong `results/`.
- Với mỗi cấu hình mạng được báo cáo, đo ít nhất năm lượt cho mỗi luồng. Trình bày trung vị và độ phân tán. Lưu cả log thô và kết quả tổng hợp để mọi số đo trong `REPORT.md` và `slides.pdf` xuất hiện trong log và truy được về dữ liệu nguồn. Kiểm tra chạy lại từ bản clone mới trước khi nộp.
- Khi thay đổi pipeline, điều kiện mạng hoặc cách đo, kiểm tra lại cả hai luồng và xác nhận đầu ra tương đương. Khi bàn giao, ghi rõ những bước đã chạy và phần còn cần kiểm chứng.
- Với thông tin về phiên bản, ngày phát hành, API hoặc trạng thái tính năng, dẫn tài liệu chính thức hoặc ghi chú phát hành trong `REPORT.md` và ghi ngày truy cập.

## Nhật ký sử dụng AI

- Mỗi task chính có AI hỗ trợ có một mục trong `AI-LOG.md` sau khi hoàn tất. Dùng tiêu đề `## YYYY-MM-DD — Tên công việc` và đủ năm trường `Tool`, `Asked for`, `Kept`, `Changed`, `Rejected`.
- Ghi đúng những gì nhóm giữ, sửa hoặc bỏ và phép kiểm tra dẫn đến quyết định đó. Nếu một mục không phát sinh thay đổi hoặc phần bị loại, ghi kết quả kiểm tra thực tế.
- Để đáp ứng mức 9–10 của tiêu chí 6, nhật ký cần nêu ít nhất một lỗi thực tế từ AI và cách nhóm phát hiện, kèm minh chứng phù hợp như tài liệu chính thức hoặc kết quả kiểm tra.
- Bỏ qua hỏi đáp nhanh, chỉnh câu chữ hoặc đồng bộ tài liệu nhỏ, và các việc người dùng yêu cầu bỏ qua. Khi chưa rõ việc có cần log, hỏi trước khi sửa `AI-LOG.md`.
