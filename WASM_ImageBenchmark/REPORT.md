[ninhbilly123/LeeTKOB_AWAD](https://github.com/ninhbilly123/LeeTKOB_AWAD)

# D5 — Báo cáo seminar

## Câu hỏi nghiên cứu

> For a fixed batch of 10 high-resolution JPEGs (~50 MB), how do upload payload (MB) and submit-to-server-confirmation latency (ms) change when the same WebAssembly compression pipeline runs in the browser before upload instead of on the Node.js server after upload, under controlled network conditions?

## Thiết lập và hai luồng so sánh

- Môi trường, phiên bản và cấu hình máy — **[Điền theo lần đo]**
- Dữ liệu, tải thử nghiệm và điều kiện mạng — **[Điền theo lần đo]**
- Baseline — Tải JPEG gốc lên rồi chạy pipeline nén WebAssembly trên máy chủ Node.js.
- Thay đổi — Chạy cùng pipeline nén WebAssembly trong trình duyệt rồi tải ảnh đã nén lên.
- Yếu tố giữ cố định — **[Liệt kê]**

## Phép đo và kết quả

**[Ghi lệnh đo, số lượt chạy, cách tính dung lượng tải lên, mốc bắt đầu và kết thúc độ trễ, cùng cách tính độ phân tán. Điền vào bảng các số liệu từ log tương ứng với từng cấu hình mạng.]**

| Chỉ số | Đơn vị | Baseline, trung vị và độ phân tán | Thay đổi, trung vị và độ phân tán | Chênh lệch | Log đối chiếu |
| --- | --- | --- | --- | --- | --- |
| Dung lượng tải lên | MB | — | — | — | — |
| Độ trễ từ lúc bấm gửi đến khi nhận xác nhận từ máy chủ | ms | — | — | — | — |

## Nhận định, khuyến nghị và giới hạn

- Kết quả chính và chi phí quan sát được — **[Điền kèm số đo]**
- Khi nào nên dùng và khi nào nên tránh — **[Điền dựa trên bằng chứng]**
- Giới hạn của phép đo và điều kiện có thể làm thay đổi kết quả — **[Điền]**

## Nguồn

**[Với mỗi thông tin về phiên bản, ngày phát hành, trạng thái hoặc API, ghi tài liệu chính thức hỗ trợ thông tin đó và ngày nhóm đọc.]**
