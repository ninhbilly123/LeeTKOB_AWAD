# Phân công PA#3 · LeeTKOB

Hạn nộp **22:00 thứ Tư 25/11/2026**. Nhóm có thể demo bằng API của sản phẩm. Ưu tiên để giảng viên tự đăng nhập, tạo lab mới và chấm bài thành công trên URL công khai. Các mốc bên dưới là lịch nội bộ đề xuất.

## Đối chiếu với main

Mốc đối chiếu là [commit 046d397](https://github.com/ninhbilly123/LeeTKOB_AWAD/tree/046d397). Bảng ghi nhận hiện trạng mã nguồn. Việc vận hành deployment và hạn mức tài khoản cần kiểm tra khi tích hợp. Phân vai lấy từ [PA2.md](../../PA2.md). Nội dung chấm lấy từ PDF PA#3 trên Classroom, đối chiếu với [bản rubric trong repo](../rubric/PA3_rubric.md), [proposal](../proposal/proposal-detail.md) và [FAQ của product owner](../proposal/FAQ.md).

| Tiêu chí | Điểm | Bằng chứng hiện có và phần còn thiếu | Task |
| --- | ---: | --- | --- |
| 1. Luồng thật trên deployment | 15 | [API nộp bài](../../gateway/src/submissions/submissions.controller.ts) đã có JWT, kiểm tra lớp, deadline và idempotency. [Giao diện](../../web/src/App.tsx) mới có tiêu đề. Chưa thấy luồng đăng nhập, tạo lab, xem verdict và duyệt trên deployment trong repo. | D1, D2, N3 |
| 2. Queue và sandbox | 20 | [Service](../../gateway/src/submissions/submissions.service.ts) lưu trạng thái vào [store trong bộ nhớ](../../gateway/src/submissions/submissions.store.ts). Chưa có worker xử lý message, runner C++ hoặc bằng chứng 9 kiểm tra trên tag. | N1, N2 |
| 3. Hard rules trước model | 15 | [Checker](../../checker/src/hard_rules.py) trả tất cả là unsure. [Test hiện tại](../../checker/tests/test_hard_rules.py) xác nhận hành vi tạm này. | K1 |
| 4. Model xét ràng buộc ngữ nghĩa | 20 | [Ảnh và ghi chú free tier](../evidence/free-tier.md) chứng minh trạng thái tài khoản tại thời điểm chụp. Chưa có code gọi model, prompt thực tế, request ID hay bộ kết quả chạy thật. | K2, K3 |
| 5. Hai giới hạn và hàng chờ TA | 10 | Guard hiện bảo vệ thao tác nộp bài. Chưa có test schema/timeout cho model hoặc API review riêng của TA. | K2, D2 |
| 6. CLI checker và eval | 10 | Chưa thấy Dockerfile cho checker, bộ dev chính thức, bộ ca riêng hoặc kết quả eval trong cây mã nguồn. | D3, K3 |
| 7. Test trước, mỗi commit một phần | 5 | Có contract test PA#2. PA#3 chấm lịch sử thật của sandbox, queue, luật, model và giới hạn. | Cả nhóm, từ commit đầu |
| 8. AI-LOG | 5 | [Nhật ký](../../AI-LOG.md) đã có các quyết định của PA#2. PA#3 cần mục riêng theo việc thực tế, nhất là thay đổi hoặc từ chối gợi ý của AI. | Cả nhóm, trong từng PR |

## Nguyễn Nhật Duy · 23120244 · Gateway và luồng TA/SV

- [ ] **D1 · Đăng nhập, tạo lab và nhận bài · 20–22/11.** Bổ sung đăng nhập cho tài khoản demo. TA tạo lab trong lớp mình qua API hoặc giao diện, nhập đề, test, hai ràng buộc và mức trừ. Dùng lại contract nộp bài PA#2, chuyển sang lưu bền và bàn giao job cho Ninh. Nghiệm thu bằng lab mới từ đề `sort-merge`, một bài nộp có ID theo dõi được, và test gửi lại cùng idempotency key. TA lớp khác đọc lab nhận `403` theo quy ước [contract hiện tại](../contract/post-submissions.md).
- [ ] **D2 · Kết quả cho sinh viên và review của TA · 21–24/11.** Dùng mẫu kết quả Khoa bàn giao để làm song song. Sinh viên xem verdict tổng và từng test. Trước Publish, API của sinh viên ẩn input/output test, verdict luật/model, evidence và khoản trừ đề xuất. TA xem được theo bài và ràng buộc, gồm verdict, dòng chứng cứ, mức trừ TA đặt và lý do khi unsure. Hàng chờ áp dụng cho bài được tính của từng SV, gồm mọi violation/unsure và 10% pass làm tròn lên. TA có thể tra từng bài khi demo. Nghiệm thu bằng test với TA đúng lớp, TA khác lớp (403) và SV. Nếu đã có Publish, test từ chối khi còn verdict chưa duyệt. [FAQ-02](../proposal/FAQ.md#faq-02) · [FAQ-08](../proposal/FAQ.md#faq-08) · [FAQ-09](../proposal/FAQ.md#faq-09) · [FAQ-10](../proposal/FAQ.md#faq-10)
- [ ] **D3 · Bộ ca riêng · 21–23/11.** Cùng Khoa thống nhất layout theo dev set, rồi thêm ít nhất 5 lời giải Accepted có nhãn, tag và evidence phù hợp trong thư mục riêng. Có ít nhất một trap và một ca injection. Bàn giao thư mục cho Khoa chạy CLI. Kiểm tra diff để xác nhận các file của giảng viên vẫn nguyên bản.

## Phạm An Ninh · 23120314 · Judge, hạ tầng và nộp bài

- [ ] **N1 · Queue và worker · 20–22/11.** Thống nhất với Duy định dạng job và kết quả theo submission ID. Worker riêng nhận job, lưu verdict tổng/từng test, kích hoạt checker cho bài Accepted. Nghiệm thu bằng chuỗi dừng worker → nộp → khởi động lại. Sau xử lý chỉ lưu đúng một bộ verdict cho submission, kể cả khi message được giao lại. Lưu test hoặc đoạn quay chứng minh.
- [ ] **N2 · Sandbox C++ và CI của tag · 20–23/11.** Compile và chạy trong sandbox. Đối chiếu đủ 9 yêu cầu với 9 bài kiểm thử của rubric trong repo. Bảng kết quả CI cần chỉ ra từng hàng: cô lập mạng, CPU time, wall time kết thúc cả container, RAM gồm swap và có đọc lại vùng đã cấp, số tiến trình, dung lượng output, non-root, không host mount/Docker socket, không secret trong môi trường/tệp/include. Kiểm tra kết quả mong đợi của từng bài. Sửa [CI](../../.github/workflows/ci.yml) để suite Docker chạy trên tag `pa3`; giữ bốn lệnh README chạy offline sau khi cài dependencies trong 15 phút.
- [ ] **N3 · Deployment, diễn tập và gói nộp · URL thử ngày 22, bàn giao 25/11.** Triển khai gateway, worker và checker. Tạo 1 admin, 2 TA ở 2 lớp khác nhau và 2 SV thuộc lớp TA thứ nhất, chỉ dùng dữ liệu demo. Cùng Duy quay tối đa 5 phút trên URL thật: TA tạo lab mới, SV lần lượt nộp ca compliant/violation/injection, mở kết quả mỗi lần trước khi nộp lại, TA mở review, TA lớp khác bị từ chối. Với Khoa, kiểm tra giới hạn sử dụng có hiệu lực cho tài khoản công khai và ghi cơ chế thực tế. Duy trì deployment đến khi có điểm PA#4. Hoàn tất danh mục nộp bên dưới.

## Huỳnh Đăng Khoa · 23120285 · Checker, model và eval

- [ ] **K1 · Luật cứng C++ và bộ dev gốc · 20–22/11.** Nhập bộ dev chính thức nguyên byte. Viết test trước hoặc cùng commit cho lệnh cấm có tên trong backtick sau “Do not use”/“Do not call”. Bao phủ tên trong comment, string, hàm sort trong namespace của SV và include algorithm chỉ để dùng swap. Dùng phân tích cú pháp để quyết định từng cặp ban-list. Bàn giao mẫu verdict/evidence cho Duy ngày 20. Nghiệm thu trên dev với model tắt: quyết định mọi cặp ban-list, 0 trừ nhầm, log thể hiện không gọi model cho các cặp này.
- [ ] **K2 · Model thật và hai giới hạn · 21–23/11.** Backend gọi model cho mọi ràng buộc ngữ nghĩa của bài Accepted. Prompt chỉ có đề, ràng buộc, code đã bỏ comment và định danh SV, giữ ánh xạ dòng gốc. Schema cho từng ràng buộc chỉ cho phép pass/violation/unsure với evidence, không có trường để model đặt mức trừ. Tách commit gọi model và commit giới hạn. Test bằng fake model, offline, trước hoặc cùng commit: sai schema → unsure, quá timeout → unsure. Gửi lý do cho D2. API key chỉ ở môi trường backend tin cậy.
- [ ] **K3 · CLI, Docker và bằng chứng lần chạy thật · bản offline ngày 22, lần chạy thật trước 24/11.** Một lệnh nhận đường dẫn dataset và ghi JSONL theo từng cặp solution/constraint. Đọc đề và ràng buộc từ file của từng problem, xử lý lời giải mới độc lập với nhãn. Ghi lệnh CLI và Docker build/run vào README. Với `MODEL_OFF=1` và `--network none`, hard rules vẫn chạy, mọi cặp ngữ nghĩa thành unsure. Ninh chạy lại image trong giới hạn RAM/PID và 10 phút, chấm file bằng `eval.mjs` gốc (exit 0 hoặc 1, exit 2 là lỗi). Lưu **predictions, report và call log của cùng một lần chạy model thật**. Log có prompt đã lọc, request ID của provider, model, tokens, thời gian và chi phí từng call. Công bố số trừ nhầm, tỷ lệ bắt vi phạm có evidence đúng và tỷ lệ unsure theo report. PA#3 chưa đặt ngưỡng đỗ eval. Ghi model thực dùng và phép tính chi phí 80 bài vào README lẫn AI-LOG; phân biệt khoản thực trả free tier và ước tính nếu tính phí.

## Các mốc bàn giao chung

| Mốc đề xuất | Người nhận | Bằng chứng để chuyển bước |
| --- | --- | --- |
| 20/11 | Cả ba | Duy và Ninh chốt message, ID và trạng thái. Khoa bàn giao schema kết quả, một ví dụ pass/violation/unsure và nguồn bộ dev. |
| 22/11 | Duy | Ninh có URL thử với worker. Một submission thật đi từ queued tới verdict. Khoa có CLI chạy offline. |
| 24/11 | Ninh | Duy xác nhận quyền đọc bằng 3 vai trò. Khoa bàn giao real run. Một thành viên khác dùng tài khoản demo, tạo lab và chấm lại file predictions bằng bản eval gốc. |
| 25/11 trước 18:00 | Cả nhóm | Diễn tập từ checkout sạch, xử lý lỗi và đối chiếu từng bằng chứng. Ninh phụ trách nộp trước 22:00. |

**Trong mỗi PR**, tác giả commit riêng từng phần và bổ sung AI-LOG ngay khi làm, ghi công cụ, việc đã giao, gợi ý đã sửa/bác, cách phát hiện và link test/commit. Ghi `Tool: none` nếu phù hợp. Giữ lịch sử commit thật khi merge. Khoa phụ trách đối chiếu mục Never của [AGENTS.md](../../AGENTS.md) với bảng “Catching your assistant” trang 6 của PDF, gồm nguyên vẹn dev/eval, không đặc cách ID dev, giữ độ chặt của test, kiểm tra RAM có đọc lại, cô lập sandbox và request ID thật. Mục 8 trong bản Markdown của rubric bị cắt ở chữ “Changed”; PDF yêu cầu ví dụ **Changed / Rejected** cụ thể và cách phát hiện.

**Trước khi nộp**, Ninh và một người kiểm tra chéo:

- [ ] Kiểm tra luồng sinh viên và quyền TA trên deployment. Nếu verdict thành điểm hoặc đến SV dưới dạng khoản trừ trước TA, hoặc output model được dùng thiếu cả schema check lẫn timeout, rubric cho **0 ở mục 4, 5, 6 (40 điểm)**.
- [ ] Kiểm tra bộ dev khớp từng byte với bản phát hành. SHA-256 của `eval.mjs` bắt đầu bằng `c836edd8713521bb`, của `labels.jsonl` bằng `262cda7b0ef5612e`. Chạy lại bốn lệnh quality gate trong README sau khi ngắt mạng, và chấm lại đúng file dự đoán đã commit.
- [ ] Đặt `PA3.md` ở root với URL, năm tài khoản demo, liên kết tìm đúng CI của tag có sandbox tests, lệnh build/chạy checker, model-off, thư mục real run và video. Push tag `pa3` ở đúng commit nộp trong repo public. Mở CI từ liên kết và xác nhận tag, commit, kết quả cả 9 kiểm tra.
- [ ] `SELF_ASSESSMENT_REPORT.md` theo template Classroom, đủ 8 dòng, mỗi dòng có điểm và link bằng chứng, thêm “what we did not manage”. Nén repo kèm `.git`, kiểm tra tag trong bản giải nén và đối chiếu tổng với tên `23120244-23120285-23120314_<tổng>.zip`. Một thành viên nộp qua tài khoản Google sinh viên.
