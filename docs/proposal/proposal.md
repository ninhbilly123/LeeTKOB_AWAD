# LeeTKOB — Proposal

Nhóm (product owner): Lê Tấn Hiệp, Tống Dương Thái Hoà, Nguyễn Phúc Hoàng. Theo class brief và [FAQ](https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md); chi tiết: [`proposal-detail.md`](./proposal-detail.md).

## 1. Người dùng và vấn đề
**TA chấm lab C++.** Đề có yêu cầu ngoài output ("tự cài merge sort"), nhưng máy chấm chỉ so output: gọi `std::sort` vẫn Accepted. Trước khi công bố điểm, TA đọc từng bài trong khoảng 80 bài Accepted (2–3 phút mỗi bài, 3–4 giờ mỗi tuần).

## 2. Tính năng LLM và cái giá khi sai
**Soát ràng buộc trước khi công bố điểm**: một bước cố định trong quy trình chấm, không phải chatbot hay agent. Sinh viên nộp → chấm trong sandbox, thấy kết quả ngay → bài Accepted qua **luật cứng** (ràng buộc "Do not use / Do not call") → **mô hình** xét ràng buộc ngữ nghĩa, trả `pass / violation / unsure` kèm dòng code → kiểm schema, bằng chứng khớp dòng gốc, timeout, hạn mức chi phí → hàng chờ (mọi violation, unsure, 10% pass) → **TA duyệt rồi mới Publish**. Mô hình không quyết mức trừ.
**Sai thì sao:** trừ oan có thể làm sinh viên rớt môn hoặc mất học bổng; hiểu sai một ràng buộc là cả lớp bị trừ. **Eval:** bộ dev của thầy + ca của nhóm, chạy `eval.mjs` trong CI; ngưỡng **0 trừ oan**, recall ≥ 90%, unsure ≤ 20%. **Dữ liệu gửi ra:** đề, ràng buộc, code đã bỏ comment, tên, MSSV.

## 3. Phạm vi
**Làm:** 57 tính năng có mã (37 Must): tài khoản, lớp, lab, chấm realtime, sandbox có test tấn công, soát ràng buộc, duyệt và Publish, khiếu nại, CI, quan sát, load test, triển khai. **Không làm:** ngôn ngữ thứ hai; mô hình sinh test, chọn mức trừ, chấm bài không Accepted; nộp trễ; đạo văn; contest, IDE, RAG.

## 4. Kế hoạch
| Hạn | R1 Lớp, điểm (Node) | R2 Chấm bài, hạ tầng (Java) | R3 Tính năng LLM (Python) |
|---|---|---|---|
| 11/11 PA#2 | Đăng nhập, lớp, lab, nộp bài; contract + contract test | Sandbox + test tấn công; rules file; CI bắt buộc | Checker giả; CLI ghi JSONL; luật cứng; eval trong CI |
| 25/11 PA#3 | Ràng buộc, bài được tính, tính điểm | Kết quả realtime; nối checker qua hàng đợi | Mô hình + kiểm đầu ra; hàng chờ có bằng chứng |
| 02/12 PA#4 | Publish chặn khi chưa duyệt; test Publish 2 lần | Timeout, hạn mức chi phí; bản triển khai cho red team | Gate eval bắt buộc; duyệt theo nhóm; báo cáo red-team |
| 16/12 PA#5 | Khiếu nại, sửa điểm, thông báo | Log/metric/trace, load test 80 bài, post-mortem | Eval trên bản triển khai; chi phí mỗi lab |
| 23/12 bản cuối | Test E2E luồng TA và sinh viên | Triển khai lại theo runbook | Kịch bản demo |

**24/12, 31/12:** vấn đáp. R1–R3 là vai trò, mỗi nhóm tự gán cho 3 thành viên; milestone tuần ở bản chi tiết mục 5. Việc PO: trực FAQ luân phiên, trả lời trong 2 ngày làm việc.

## 5. Rủi ro
**Stack quá nặng** → chốt ở W1, có thể gộp service. **Sandbox chưa đạt** → test tấn công từ W2; dự phòng Judge0. **Trừ oan / unsure nhiều** → thử 2 mô hình trên bộ dev ngay W1. **TA duyệt mù** → không có "duyệt tất cả" cho đề xuất của mô hình.

## 6. Công nghệ và chi phí
React, NestJS, Spring Boot, Python; PostgreSQL, MongoDB, Redis, RabbitMQ, Garage; Docker, GitHub Actions; Vercel + máy ảo. Gemini 3.1 Flash-Lite: ≈ 0,2 USD/lab, giới hạn chi tiêu 10 USD.
