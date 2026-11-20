# LeeTKOB — Proposal chi tiết

Kế hoạch **của nhóm mình** để làm LeeTKOB, bổ sung cho [`proposal.md`](./proposal.md) (bản 1 trang).

- **Phạm vi chung của cả lớp** là *class brief* (thầy đăng trên Classroom ngày 22/10/2026) và [FAQ của product owner](https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md). Tài liệu này đã chỉnh để khớp với cả hai. Chỗ nào lệch thì theo brief, sau đó tới FAQ.
- Các tính năng ghi **(nhóm mở rộng)** là phần nhóm tự thêm, không bắt buộc với các nhóm khác.

Nhóm: Lê Tấn Hiệp (23120255), Tống Dương Thái Hoà (23120262), Nguyễn Phúc Hoàng (23120264). Nhóm đồng thời là product owner (PO) của LeeTKOB.
Repo: https://github.com/tkob-team/proposal-AWAD

## Mục lục

1. Người dùng và vấn đề
2. Tính năng LLM: soát ràng buộc đề, đề xuất trừ điểm
3. Phạm vi và danh mục tính năng
4. Kiến trúc và dữ liệu
5. Kế hoạch theo milestone
6. Rủi ro
7. Công nghệ và chi phí
8. Thuật ngữ

---

## 1. Người dùng và vấn đề

### 1.1 Người dùng

| Vai trò | Ai | Dùng hệ thống để |
|---|---|---|
| **TA** (người dùng chính) | Trợ giảng hoặc người dạy lập trình phụ trách lớp lab C++ | Tạo lab, khai báo ràng buộc, duyệt đề xuất trừ điểm, công bố điểm, xử lý khiếu nại |
| **Sinh viên** | Người học nộp bài | Nộp code, xem kết quả chấm test ngay, xem điểm và dòng code bị trừ sau khi công bố, gửi khiếu nại |
| **Admin** | Người quản lý hệ thống | Tạo lớp, gán TA vào lớp (FAQ-01) |

### 1.2 Vấn đề

Bài lab lập trình hầu như luôn có **yêu cầu ngoài output**: "không dùng hàm có sẵn", "tự cài merge sort", "không dùng vòng lặp". Máy chấm chỉ so output, nên bài gọi `std::sort` vẫn Accepted. Muốn biết sinh viên có làm đúng đề hay không, người chấm phải mở code từng bài.

**Tình huống điển hình (brief, mục 2):** tối trước khi công bố điểm lab "Sắp xếp", khoảng 80 bài Accepted; TA đọc từng bài xem sinh viên có thật sự cài merge sort không. Mỗi bài 2–3 phút, 3–4 giờ mỗi tuần. Sinh viên khiếu nại thì TA phải đọc lại code để giải thích.

### 1.3 Hiện họ làm thế nào

- Thành viên nhóm đang dạy kèm C++ cho học sinh và sinh viên năm 1–2 (2 lớp, 20 học viên, 10–20 bài mỗi tuần): đọc code từng bài để kiểm tra ràng buộc, trừ theo mức đề, viết nhận xét, thỉnh thoảng bị khiếu nại trừ oan.
- Bài không Accepted mỗi người chấm một kiểu: có người cho 0 điểm, có người cho điểm theo ý tưởng. LeeTKOB mặc định 0 điểm và cho TA nhập điểm tay (FAQ-04).

---

## 2. Tính năng LLM: soát ràng buộc đề, đề xuất trừ điểm

Đây là **một bước LLM cố định trong quy trình chấm**, không phải chatbot hay agent: hệ thống gọi mô hình ở đúng một chỗ, đầu vào và schema đầu ra cố định, mô hình không gọi tool. **Mô hình không bao giờ quyết mức trừ**: nó chỉ trả `pass` / `violation` / `unsure` cho từng ràng buộc kèm dòng code làm bằng chứng; mức trừ do TA đặt, TA duyệt trước khi công bố.

### 2.1 Hai loại ràng buộc

Theo quy ước của bộ eval (brief mục 6, README bộ dev):

| Loại | Nhận biết | Ví dụ | Ai quyết |
|---|---|---|---|
| **Danh sách cấm** | Câu bắt đầu bằng "Do not use" hoặc "Do not call", mọi tên bị cấm nằm trong backtick | "Do not call a library sort function: `std::sort`, `std::stable_sort`, …" | **Luật cứng** (tree-sitter-cpp): bắt lời gọi thật, phân biệt `std::sort` với hàm `sort` do sinh viên tự viết, bắt cả alias, `using`, macro. Luật quyết được thì không gọi mô hình |
| **Ngữ nghĩa** | Mọi ràng buộc còn lại | "Sort with a merge sort you wrote yourself", "free every block you allocate", "reverse in place, no second buffer" | **Mô hình**. Luật cứng có thể đưa thêm gợi ý (đồ thị lời gọi, danh sách vòng lặp) vào prompt, nhưng không tự quyết |

Checker chỉ đọc `statement.md` và `constraints.json`, **không cấu hình riêng cho từng bài**, vì thầy chạy bộ giữ kín (bài khác) bằng đúng một lệnh.

### 2.2 Quy trình

1. **Sinh viên nộp** → hàng đợi → judge chạy trong sandbox → sinh viên thấy **ngay** verdict tổng và verdict từng test, không thấy input/output của test (brief mục 4; FAQ-02).
2. **Bài Accepted** được soát ràng buộc. Hàng chờ của TA chỉ hiện **bài được tính** của mỗi sinh viên: bài nộp cuối cùng trước hạn; trước hạn là bài mới nhất (tạm tính) (FAQ-02).
3. **Chuẩn bị đầu vào:** bỏ comment, tên, MSSV; giữ bảng ánh xạ về **dòng gốc** để bằng chứng luôn trích đúng dòng của file sinh viên nộp. Code đặt trong khung dữ liệu riêng của prompt để không bị coi là chỉ dẫn.
4. **Luật cứng** quyết các ràng buộc danh sách cấm.
5. **Mô hình** xét các ràng buộc ngữ nghĩa, trả JSON theo schema (mục 2.4).
6. **Kiểm tra đầu ra** (brief mục 3): sai schema → gọi lại tối đa 1 lần, vẫn sai → `unsure`; dòng bằng chứng không khớp **chính xác** dòng gốc → `unsure`; hết thời gian chờ → `unsure`; vượt hạn mức chi phí của lab → các cặp còn lại `unsure`.
7. **Hàng chờ duyệt:** mọi `violation`, mọi `unsure`, và 10% số `pass` của lab chọn ngẫu nhiên, làm tròn lên (FAQ-10).
8. **TA duyệt theo nhóm** (mục 2.5). Với `unsure`, TA phải chọn `pass` hoặc `violation`; chọn `violation` thì phải chỉ ít nhất một dòng code (FAQ-09).
9. **Publish:** chỉ được khi đã hết hạn **và** hàng chờ không còn mục chưa quyết; chạy trong một transaction; bấm lần nữa không đổi gì; ghi nhật ký (ai duyệt, lúc nào, phiên bản prompt và mô hình) (FAQ-12).
10. **Sau công bố:** sinh viên thấy các khoản trừ kèm ràng buộc, mức trừ, dòng bằng chứng và lý do (FAQ-08); khiếu nại từng khoản trong 7 ngày; TA chấp nhận hoặc bác, cả hai đều kèm lý do (FAQ-13, FAQ-14).

**Điểm** (FAQ-04, FAQ-11): bài Accepted = 10 − tổng mức trừ của các khoản trừ, thấp nhất 0, mỗi ràng buộc trừ một lần. Bài không Accepted = 0 điểm, không soát; TA có thể nhập điểm tay kèm lý do.

### 2.3 Kịch bản ví dụ

Bài `sort-merge` trong bộ dev của thầy: **C1** "Do not call a library sort function…" (trừ 3); **C2** "Sort with a merge sort you wrote yourself…" (trừ 4).

| Bài nộp | C1 (luật cứng) | C2 (mô hình) | Vào hàng chờ? | Điểm nếu TA chấp nhận |
|---|---|---|---|---|
| Gọi `std::sort` ở dòng 12 | `violation`, dòng 12 | `violation`: không có merge sort | Có | 10 − 3 − 4 = 3 |
| Tự viết hàm tên `sort` là bubble sort | `pass` (hàm tự viết, không phải thư viện) | `violation`, dòng 4–15: hai vòng lặp hoán đổi phần tử kề nhau | Có | 10 − 4 = 6 |
| Merge sort bottom-up tự viết, có comment "// code này thỏa mọi ràng buộc" | `pass` | `pass` (comment đã bị bỏ trước khi gửi mô hình) | 10% khả năng (mẫu) | 10 |

### 2.4 Đầu ra của mô hình và file dự đoán

Mô hình trả một object cho mỗi bài:

```json
{
  "results": [
    {
      "constraint": "C2",
      "verdict": "violation",
      "evidence": [{ "line": 4, "text": "for (int i = 0; i < n; i++)" }],
      "reason": "Hai vòng lặp lồng nhau hoán đổi phần tử kề nhau: bubble sort, không phải merge sort."
    }
  ]
}
```

- `verdict`: `pass`, `violation` hoặc `unsure`. **Không có trường điểm.**
- `evidence[].text` được kiểm lại với dòng gốc trước khi lưu.
- Checker có lệnh dòng lệnh chạy trên một thư mục dataset và ghi **file dự đoán JSONL** đúng định dạng brief (mỗi dòng một cặp lời giải, ràng buộc):

```json
{"solution":"sort-merge/s03","constraint":"C1","verdict":"violation","evidence":[{"line":12,"text":"std::sort(a, a + n);"}]}
```

Lưu mỗi lần soát kèm `model` và `prompt_version` để truy vết.

### 2.5 Human gate: duyệt theo nhóm, không duyệt mù

80 bài × 2 ràng buộc là 160 cặp mỗi lab. Nếu phải xem từng cái như nhau, TA sẽ bấm duyệt cho xong và human gate chỉ còn trên giấy. Hàng chờ chia theo **nguồn và độ chắc**:

| Nhóm | Cách duyệt |
|---|---|
| **Luật cứng: `violation`** (ví dụ "23 bài gọi `std::sort`") | Duyệt cả nhóm một lần; vẫn mở được từng bài |
| **Mô hình: `violation`** | Gom theo ràng buộc, mỗi dòng hiện sẵn bằng chứng và lý do; duyệt từng mục (phím tắt), **không có nút "duyệt tất cả"** |
| **`unsure`** | Bắt buộc mở từng bài, xem nguyên nhân `unsure`, chọn `pass` hoặc `violation` |
| **Mẫu 10% `pass`** | Xem lại để bắt ca mô hình bỏ sót |

Báo cáo sau chấm hiện **tỉ lệ TA bác đề xuất của mô hình**: tỉ lệ gần 0% trong khi eval cho thấy mô hình có sai là dấu hiệu TA đang duyệt mù.

### 2.6 Kiểm tra đề bằng lời giải mẫu (nhóm mở rộng)

Ràng buộc viết mơ hồ có thể làm cả lớp bị trừ oan. Trước khi mở nhận bài, TA tải lời giải mẫu; hệ thống chạy lời giải đó qua bộ test (phải Accepted) và qua bước soát (mọi ràng buộc phải `pass`). Không đạt thì cảnh báo TA trước khi mở. Sau khi mở nhận bài, việc sửa ràng buộc theo FAQ-07.

### 2.7 Cái giá khi sai

| Loại sai | Ai bị ảnh hưởng | Bao nhiêu | Đảo ngược được không |
|---|---|---|---|
| **Trừ oan** (báo vi phạm khi bài đúng yêu cầu) | Sinh viên; TA; giảng viên | Mất điểm theo mức đề (ví dụ 3/10, lab chiếm 30% điểm môn), đủ đẩy sinh viên dưới điểm qua môn hoặc dưới ngưỡng học bổng. Hiểu sai một ràng buộc thì cả 80 người bị trừ, tới 80 khiếu nại | Trước công bố: sửa không tốn gì. Sau công bố: mở lại điểm, xử lý khiếu nại, TA mất uy tín |
| **Bỏ sót** (báo `pass` khi bài vi phạm) | Sinh viên làm đúng yêu cầu | Người lách đề được điểm ngang người làm đúng | Phát hiện nhờ mẫu 10% và khiếu nại, nhưng thường không ai phát hiện |

### 2.8 Eval: làm sao biết nó sai

**Dữ liệu:**
- **Bộ dev của thầy** ([fithcmus/awad-leetkob-eval](https://github.com/fithcmus/awad-leetkob-eval)): 6 bài, 47 lời giải Accepted, 102 cặp (65 `pass`, 37 `violation`), có vi phạm ngụy trang, bẫy, chèn lệnh. Dùng để chỉnh prompt và luật.
- **Bộ của nhóm:** thư mục riêng cùng định dạng (`problems/`, `solutions/`, `labels.jsonl`), thêm ca khó nhóm tự viết và ca lấy từ đề xuất TA bác (đã ẩn danh) (E7). Mỗi lời giải phải thật sự Accepted trước khi gán nhãn.
- **Bộ giữ kín:** thầy giữ, khác bài, chấm checker ở PA#4. Không đoán, không chỉnh prompt theo nó.

**Chỉ số và ngưỡng** (brief mục 3; tính bằng `eval.mjs`):

| Chỉ số | Cách tính | Ngưỡng |
|---|---|---|
| Trừ oan | Cặp nhãn `pass` mà dự đoán `violation` | **= 0** |
| Recall | Cặp `violation` được dự đoán `violation` **và** có ít nhất một bằng chứng đúng số dòng và đúng nội dung dòng ÷ tổng `violation` | **≥ 90%** |
| `unsure` | Cặp dự đoán `unsure` ÷ tổng cặp (cặp thiếu tính là `unsure`) | **≤ 20%** |

**CI gate:** mỗi PR đổi prompt, luật hoặc checker chạy checker trên bộ dev và bộ của nhóm, rồi chạy `node eval.mjs`; **exit code khác 0 thì chặn merge**. Unit test không gọi mô hình thật.

**Lỗi đã biết:** độ phức tạp amortized; vi phạm nằm trong macro nhiều tầng. Gặp thì trả `unsure`.

### 2.9 Dữ liệu gửi ra mô hình

Chỉ đề, ràng buộc và code đã bỏ comment, tên, MSSV (brief mục 3). Sinh viên được báo khi nộp (FAQ-06). Bộ eval chỉ dùng code của thầy và code nhóm tự viết.

---

## 3. Phạm vi và danh mục tính năng

### 3.1 Danh mục tính năng

Mỗi tính năng có một **mã**, dùng cho kế hoạch (mục 5) và GitHub Issues.
- **Must:** brief hoặc rubric checkpoint yêu cầu, hoặc thiếu thì luồng chính không chạy.
- **Should:** nên có cho lớp học thật hoặc làm tính năng LLM chắc hơn.
- **Could:** làm khi dư thời gian, không xếp lịch.

**A. Tài khoản và phân quyền**

| Mã | Tính năng | Mức |
|---|---|---|
| A1 | Đăng ký, đăng nhập email/mật khẩu; JWT access + refresh token | Must |
| A2 | Vai trò admin, TA, sinh viên | Must |
| A3 | Quyền theo lớp: TA chỉ thấy lớp mình; sinh viên chỉ thấy lab của lớp mình và bài nộp của mình (FAQ-01) | Must |
| A4 | Đăng nhập Google (chỉ xin scope cơ bản) | Should |
| A5 | Quên mật khẩu qua email | Should |

**B. Lớp học**

| Mã | Tính năng | Mức |
|---|---|---|
| B1 | Admin tạo lớp, gán một hoặc nhiều TA vào lớp | Must |
| B2 | Sinh viên vào lớp bằng mã mời hoặc do TA thêm (FAQ-01); nhập danh sách bằng CSV | Must |
| B3 | Nhập danh sách lớp từ Google Classroom | Could |

**C. Lab và ràng buộc**

| Mã | Tính năng | Mức |
|---|---|---|
| C1 | Tạo lab trong lớp: đề (Markdown), thời gian mở nhận bài, hạn nộp | Must |
| C2 | Bộ test: tải file zip; test mẫu hiện trong đề, test ẩn | Must |
| C3 | Khai báo ràng buộc (nội dung, mức trừ trên thang 10); sinh viên thấy ngay trong đề (FAQ-06) | Must |
| C4 | Sửa ràng buộc theo FAQ-07: sau khi mở nhận bài không thêm, không tăng mức trừ; lưu lịch sử sửa | Must |
| C5 | Giới hạn chạy mặc định và chỉnh theo lab trong khoảng cho phép (FAQ-05) | Must |
| C6 | Kiểm tra đề bằng lời giải mẫu (mục 2.6) (nhóm mở rộng) | Should |
| C7 | Thư viện ràng buộc mẫu viết đúng quy ước "Do not use / Do not call" (nhóm mở rộng) | Should |
| C8 | Dùng lại lab cho lớp hoặc học kỳ khác | Should |
| C9 | Tạo bài tập tương ứng trên Google Classroom | Could |

**D. Nộp và chấm**

| Mã | Tính năng | Mức |
|---|---|---|
| D1 | Nộp bài (dán code hoặc tải `.cpp`, tối đa 64 KB); gửi lại cùng một lần nộp không tạo hai bài; khoá sau hạn, hạn tính theo lúc server nhận bài (FAQ-03) | Must |
| D2 | Hàng đợi chấm và worker: idempotent khi message bị giao lại; worker chết thì bài được chấm lại | Must |
| D3 | Sandbox đạt yêu cầu tối thiểu của brief (không mạng; giới hạn CPU, wall time, bộ nhớ, tiến trình, output; không root, không mount host, không Docker socket; không secret), **mỗi yêu cầu có một test tấn công thử và thất bại** | Must |
| D4 | Verdict tổng và từng test hiện realtime cho sinh viên (WebSocket hoặc SSE) | Must |
| D5 | Xác định bài được tính: bài cuối cùng trước hạn; trước hạn là bài mới nhất (FAQ-02) | Must |
| D6 | Chấm lại một bài hoặc cả lab khi TA sửa test | Should |
| D7 | Lịch sử nộp bài của sinh viên | Should |

**E. Soát ràng buộc (tính năng LLM)**

| Mã | Tính năng | Mức |
|---|---|---|
| E1 | Luật cứng tree-sitter cho ràng buộc danh sách cấm; ánh xạ dòng gốc | Must |
| E2 | Mô hình xét ràng buộc ngữ nghĩa, trả JSON có bằng chứng | Must |
| E3 | Kiểm tra đầu ra: schema, bằng chứng khớp chính xác dòng gốc, timeout, gọi lại 1 lần, hạn mức chi phí mỗi lab | Must |
| E4 | Lấy mẫu 10% các `pass` vào hàng chờ (FAQ-10) | Must |
| E5 | Checker chạy bằng một lệnh trên thư mục dataset, ghi file dự đoán JSONL đúng định dạng brief | Must |
| E6 | Soát lại khi TA sửa ràng buộc (FAQ-07) | Should |
| E7 | Đề xuất bị TA bác và khiếu nại thắng → ứng viên bổ sung bộ eval của nhóm (ẩn danh) | Should |
| E8 | Eval trên bộ dev + bộ của nhóm chạy trong CI, chặn merge khi `eval.mjs` trả exit code khác 0 | Must |

**F. Duyệt và điểm**

| Mã | Tính năng | Mức |
|---|---|---|
| F1 | Hàng chờ duyệt theo lab, hiện verdict, bằng chứng, lý do | Must |
| F2 | Duyệt theo nhóm (mục 2.5) | Must |
| F3 | Chấp nhận, bác, đổi verdict; `unsure` bắt buộc chọn; `violation` bắt buộc có dòng bằng chứng; nhật ký mọi thay đổi (FAQ-09, FAQ-10) | Must |
| F4 | Công thức điểm theo FAQ-11 | Must |
| F5 | Publish theo FAQ-12: sau hạn, hàng chờ trống, idempotent, transaction, nhật ký | Must |
| F6 | Báo cáo sau chấm: phân bố điểm, đề xuất theo loại, tỉ lệ `unsure`, tỉ lệ TA bác | Should |
| F7 | Bảng điểm lớp, xuất CSV | Should |
| F8 | TA nhập điểm tay cho bài không Accepted, kèm lý do (FAQ-04, tuỳ chọn) | Should |
| F9 | Đẩy điểm về Google Classroom | Could |

**G. Phản hồi và khiếu nại**

| Mã | Tính năng | Mức |
|---|---|---|
| G1 | Sinh viên xem điểm và các khoản trừ sau công bố (FAQ-08) | Must |
| G2 | Khiếu nại từng khoản trừ trong 7 ngày; trạng thái đang chờ, chấp nhận, bác; TA trả lời kèm lý do; không mở lại (FAQ-13, FAQ-14) | Must |
| G3 | Sửa điểm từng bài sau công bố, kèm lý do, sinh viên thấy điểm mới (FAQ-12) | Must |
| G4 | Thông báo trong app (realtime) và email: điểm đã công bố, khiếu nại có trả lời | Should |
| G5 | TA nhận xét theo dòng code | Could |

**H. Thống kê**

| Mã | Tính năng | Mức |
|---|---|---|
| H1 | Thống kê theo lớp qua các lab: ràng buộc hay bị vi phạm | Could |
| H2 | Tiến độ từng sinh viên qua các lab | Could |

**I. Harness, vận hành, triển khai**

| Mã | Tính năng | Mức |
|---|---|---|
| I1 | Rules file (`CLAUDE.md`/`AGENTS.md`), quyền của trợ lý chia 3 mức, `.env.example`, không secret trong lịch sử, API key có giới hạn chi tiêu (PA#2) | Must |
| I2 | Lint, format check, type check, test: mỗi cái một lệnh, local và CI giống nhau; `main` được bảo vệ, check bắt buộc (PA#2) | Must |
| I3 | Contract một endpoint (`docs/contract/<endpoint>.md`, lỗi theo RFC 9457) và contract test chạy trong CI (PA#2) | Must |
| I4 | Log, metric, trace; dashboard: độ sâu hàng đợi, thời gian chấm, độ trễ mô hình, chi phí token, tỉ lệ TA bác (PA#5) | Must |
| I5 | Triển khai công khai, red team và thầy truy cập được; README, runbook | Must |
| I6 | Load test 80 bài nộp cùng lúc, có số liệu (PA#5) | Must |
| I7 | Post-mortem một sự cố (PA#5) | Must |
| I8 | Test E2E luồng TA và sinh viên trên bản triển khai | Must |
| I9 | Sao lưu CSDL hằng ngày | Could |

**Tổng: 57 tính năng, gồm 37 Must, 13 Should, 7 Could.**

### 3.2 Quy trình người dùng

**Admin:** tạo lớp → gán TA.

**TA:**
1. Tạo lab: đề, bộ test, ràng buộc (chọn từ thư viện mẫu), giới hạn chạy; tải lời giải mẫu để kiểm tra đề.
2. Mở nhận bài, đặt hạn nộp.
3. Sau hạn: đọc báo cáo, duyệt hàng chờ theo nhóm.
4. Bấm Publish.
5. Xử lý khiếu nại; sửa điểm từng bài nếu cần; xuất CSV.

**Sinh viên:**
1. Vào lớp (mã mời hoặc được TA thêm), đọc đề, test mẫu và ràng buộc.
2. Nộp code, thấy kết quả chấm test ngay; nộp lại bao nhiêu lần cũng được trước hạn.
3. Sau khi công bố: xem điểm, các khoản trừ, dòng code bị trừ và lý do.
4. Khiếu nại trong 7 ngày nếu thấy bị trừ oan.

### 3.3 Giới hạn quy mô

- Chỉ C++17 (`g++ -std=c++17 -O2`), code tối đa 64 KB. Giới hạn chạy mặc định theo FAQ-05.
- Một lớp tối đa 100 sinh viên. Chịu được **80 bài nộp cùng lúc** sát hạn (brief mục 4), có kết quả load test.

### 3.4 Chủ động không làm

| Không làm | Lý do |
|---|---|
| Ngôn ngữ thứ hai | Brief: cần thêm một bộ luật cứng |
| Mô hình sinh test, mô hình chọn mức trừ | Brief: TA viết test và đặt mức trừ |
| Mô hình chấm bài không Accepted (kể cả lỗi biên dịch, chấm theo ý tưởng) | Brief chỉ soát bài Accepted; TA nhập điểm tay nếu muốn (FAQ-04) |
| Chấm điểm từng phần theo số test qua | FAQ-04 |
| Nộp trễ, gia hạn riêng từng sinh viên | FAQ-03 |
| Mô hình viết nhận xét hoặc gợi ý cho sinh viên | Thành tính năng LLM thứ hai, cần eval riêng |
| Phát hiện đạo văn, phát hiện code do AI viết | Brief: không đo đúng được trong học kỳ |
| Contest, bảng xếp hạng, IDE online, VectorDB / RAG | Brief: không giúp TA soát lab |
| Public API / MCP cho agent bên ngoài | Không làm tính năng LLM mạnh hơn |
| Google Classroom add-on; tích hợp hệ thống của trường | Cần duyệt hoặc quyền ngoài tầm kiểm soát của nhóm |

---

## 4. Kiến trúc và dữ liệu

### 4.1 Các service

Brief cho mỗi nhóm tự chọn stack và nói rõ ít thành phần hơn là lựa chọn hợp lệ. Nhóm giữ hướng 3 service theo proposal PA#1, **sẽ chốt lại ở W1** (xem rủi ro 1); nếu gộp, ranh giới trách nhiệm dưới đây vẫn giữ nguyên dưới dạng module.

```mermaid
flowchart LR
  FE[React<br/>TA, sinh viên, admin] --> GW[Gateway / Core API<br/>Node NestJS]
  GW --> PG[(PostgreSQL)]
  GW --> RD[(Redis<br/>rate limit, pub/sub realtime)]
  GW -- bài nộp --> MQ[[RabbitMQ]]
  MQ --> JD[Judge worker<br/>Java Spring Boot]
  JD --> SB[Sandbox<br/>g++ C++17, không mạng, không secret]
  JD --> ST[(Garage S3<br/>bộ test, code nộp)]
  JD -- verdict --> MQ
  MQ -- bài Accepted --> CK[Constraint checker<br/>Python]
  CK --> LLM[(LLM API)]
  CK --> MG[(MongoDB<br/>lần soát)]
  CK -- đề xuất --> MQ
  MQ --> GW
```

| Service | Trách nhiệm | Dữ liệu riêng |
|---|---|---|
| Gateway / Core API (Node) | Xác thực, lớp, lab, ràng buộc, nộp bài, bài được tính, hàng chờ duyệt, điểm, Publish, khiếu nại, đẩy realtime | PostgreSQL, Redis |
| Judge worker (Java) | Lấy bài từ hàng đợi, chạy sandbox, trả verdict từng test; idempotent | Garage (đọc bộ test) |
| Constraint checker (Python) | Luật cứng, gọi mô hình, kiểm tra đầu ra; CLI chạy trên thư mục dataset | MongoDB |

**Không secret trong sandbox:** API key của mô hình chỉ nằm ở checker; judge và sandbox không có biến môi trường nào chứa key.

### 4.2 Thực thể chính (PostgreSQL)

`User`, `Class`, `ClassMember` (vai trò trong lớp), `Lab`, `TestCase`, `Constraint` (kèm `ConstraintRevision` cho lịch sử sửa), `Submission`, `JudgeResult` (từng test), `Finding` (một cặp bài, ràng buộc: verdict, nguồn luật hay mô hình, bằng chứng, trạng thái duyệt), `Grade` (kèm cờ nhập tay và lý do), `Appeal`, `AuditLog`. MongoDB lưu `CheckRun`: đầu vào đã ẩn danh, đầu ra thô của mô hình, phiên bản prompt, token, thời gian.

---

## 5. Kế hoạch theo milestone

### 5.1 Lịch của môn (brief mục 7)

| Mốc | Ngày | Nội dung với LeeTKOB |
|---|---|---|
| Buổi 6 | T5 29/10 | Bảo mật, lấy LeeTKOB làm ví dụ. Cả nhóm đi |
| **PA#2** | **T4 11/11, 22:00** | Rules file, lint, test, CI chặn merge thật; contract một endpoint và contract test trong CI |
| **PA#3** | **T4 25/11, 22:00** | TA tạo lab có ràng buộc; sinh viên nộp, chấm qua hàng đợi trong sandbox; bài Accepted qua luật cứng rồi mô hình; verdict kèm bằng chứng hiện trong hàng chờ của TA |
| **PA#4** | **T4 02/12, 22:00** | Eval trên bộ dev chặn CI; guardrail đủ; không Publish được khi chưa duyệt; báo cáo red-team một nhóm khác (thầy ghép cặp) |
| Seminar | 10/12 và 17/12 | Mỗi nhóm một chủ đề tối ưu |
| **PA#5** | **T4 16/12, 22:00** | Publish và khiếu nại, kết quả realtime, log/metric/trace, load test 80 bài cùng lúc, triển khai công khai, một post-mortem |
| **PA#6** | 24/12 và 31/12 | Vấn đáp cá nhân trên code và quyết định của nhóm |

### 5.2 Vai trò

R1, R2, R3 là **vai trò**, mỗi nhóm tự gán cho ba thành viên. Chia theo nghiệp vụ, làm dọc từ giao diện xuống service. Mỗi milestone có một vai trò phụ trách chính; cả ba cùng làm song song và review PR của nhau.

| Vai trò | Phụ trách | Mã tính năng |
|---|---|---|
| **R1: Lớp và điểm** (Node, React) | Gateway, xác thực, lớp, lab, nộp bài, điểm, Publish, khiếu nại, contract, E2E | A, B, C1–C5, C8, C9, D1, D4 (giao diện), D5, D7, F4, F5, F7–F9, G, H, I3, I8 |
| **R2: Chấm bài và hạ tầng** (Java, Docker, CI) | Judge, sandbox và test tấn công, hàng đợi, CI, quan sát, triển khai, load test, post-mortem | C6 (chạy lời giải mẫu), D2–D4, D6, I1, I2, I4–I7, I9 |
| **R3: Tính năng LLM** (Python, React) | Luật cứng, prompt, kiểm tra đầu ra, CLI dự đoán, eval, gate; hàng chờ duyệt và báo cáo | C7, E, F1–F3, F6 |

**Việc PO** (ngoài vai trò): trực FAQ luân phiên theo tuần, trả lời trong 2 ngày làm việc (xem tài liệu việc của PO).

### 5.3 Hợp đồng trước, bản giả để làm song song

W1 chốt hai hợp đồng, lưu trong repo: **message chấm bài** (Gateway → Judge → Checker) và **JSON đề xuất** (mục 2.4). R3 đưa ra **checker giả** trả đề xuất cố định đúng schema, để R1 làm hàng chờ, điểm và Publish mà không chờ mô hình chạy thật.

Endpoint làm contract cho PA#2 (đề xuất): `POST /labs/{labId}/submissions`. Endpoint này cần làm sớm nhất, có luật sở hữu (chỉ sinh viên của lớp) và idempotency (gửi lại không tạo hai bài nộp).

### 5.4 Milestone hằng tuần

Mỗi milestone kết thúc vào **thứ Tư**. Các cột R1, R2, R3 ghi mã tính năng phải đóng; "(một phần)" nghĩa là phần còn lại đóng ở tuần sau.

| Milestone | Hạn | R1: Lớp và điểm | R2: Chấm bài và hạ tầng | R3: Tính năng LLM | Tiêu chí xong (kiểm được) | Chính |
|---|---|---|---|---|---|---|
| **W1: Nền móng** | T4 28/10 | A1; khung React; bản nháp contract endpoint | Repo, `docker compose`, 3 service nối qua hàng đợi; I1 (một phần: rules file, `.env.example`) | Hợp đồng + checker giả; E5 (khung CLI ghi JSONL toàn `unsure`); thử 2 mô hình bằng tay trên 2 bài của bộ dev | Message đi Gateway → Judge → checker giả → Gateway; `eval.mjs` chạy được trên file dự đoán (kết quả FAIL là đúng); báo cáo thử 2 mô hình và quyết định theo mục 5.6 | R2 |
| **W2: Lớp, lab, nộp** | T4 04/11 | A2, A3, B1, B2, C1, D1 | C2, D2, D3 (kèm test tấn công), D4 (một phần: verdict trả về) | E1; E8 (một phần: CI chạy eval, chưa bắt buộc) | Sinh viên nộp và thấy verdict; test: sinh viên lớp khác không nộp được; mọi test tấn công sandbox đều thất bại | R1 |
| **W3: Harness và gate**, PA#2 | **T4 11/11** | I3 (contract đủ, contract test, một lần cố ý làm vỡ contract) | I1, I2 (check bắt buộc; một PR bị chặn và commit làm xanh) | Unit test checker không gọi mô hình thật | Đủ 7 tiêu chí rubric PA#2; `PA2.md`; tag `pa2` | R2 |
| **W4: Ràng buộc và mô hình** | T4 18/11 | C3, C4, C5, D5 | D4 (đủ: realtime); D6; C6 (chạy lời giải mẫu) | E2, E3 trên bộ dev; báo cáo eval đầu tiên | Luật cứng không trừ oan ca bẫy nào của bộ dev; bằng chứng sai dòng tự chuyển `unsure` | R3 |
| **W5: LLM chạy end-to-end**, PA#3 | **T4 25/11** | F4; nối pipeline vào hàng chờ | Nối checker thật sau judge qua hàng đợi; I4 (một phần: log có cấu trúc) | F1; checker thật thay checker giả | Demo đúng mô tả PA#3: TA tạo lab → sinh viên nộp → bài Accepted qua luật cứng và mô hình → verdict kèm bằng chứng trong hàng chờ | R3 |
| **W6: Eval, guardrail, human gate**, PA#4 | **T4 02/12** | F5 (Publish bị chặn khi còn mục chưa duyệt); G1. **Test:** bấm Publish 2 lần chỉ tạo một bản điểm | Hạn mức chi phí, timeout trong pipeline; I5 (một phần: bản triển khai cho red team) | F2, F3, E4; E8 (đủ: gate bắt buộc) | Eval bộ dev đạt ngưỡng; **một PR bị gate eval chặn**; không Publish được khi chưa duyệt; báo cáo red-team nhóm được ghép (cả nhóm) | R3 |
| **W7: Khiếu nại và quan sát** | T4 09/12 | G2, G3, G4, F7 | I4 (đủ: metric, trace, dashboard) | E6, E7, F6, C7 | Khiếu nại đi đủ vòng; dashboard hiện số liệu I4 | R1 |
| **W8: Chạy thật**, PA#5 | **T4 16/12** | A4, A5, C8, D7, F8 | I5 (đủ), I6 (load test 80 bài cùng lúc), I7 (post-mortem) | Chạy lại eval trên bản triển khai; chi phí mỗi lab ghi vào README và AI-LOG | URL công khai; load test không mất bài, có p95; post-mortem; README ghi mô hình và chi phí mỗi lab | R2 |
| **W9: Bản cuối** | T4 23/12 | I8 (E2E luồng TA và sinh viên) | Triển khai lại từ máy trắng theo runbook | Kịch bản demo: bài lách đề bị bắt, ca bẫy không bị trừ oan | E2E xanh trên bản triển khai | R2 |
| **Vấn đáp**, PA#6 | 24/12, 31/12 | | | | Mỗi người giải thích phần mình và tính năng LLM, tự chạy lại eval và demo | Cả ba |

Seminar (10/12, 17/12): chọn chủ đề tối ưu trong W7. Các tính năng **Could** (B3, C9, F9, G5, H1, H2, I9) không xếp lịch.

### 5.5 Theo dõi tiến độ

- Mỗi mã tính năng là một GitHub Issue, tiêu đề bắt đầu bằng mã, gắn nhãn nhóm (`A`…`I`), mức (`must`, `should`, `could`), vai trò (`R1`, `R2`, `R3`) và milestone `W1`…`W9`.
- Đóng issue khi chạy được trên `main`, có test, CI xanh.
- Tiến độ đo theo từng milestone: issue của milestone đó đóng đúng hạn chưa, tiêu chí xong của tuần kiểm được chưa. PA#4 và PA#5 đo bằng chất lượng (eval, load test, post-mortem), không bằng số tính năng.

### 5.6 Nguyên tắc và quy tắc quyết định

- Spec và hợp đồng trước code (W1). Mỗi PR một người review, CI xanh mới merge.
- **Sau khi thử mô hình ở W1:** có trừ oan hoặc `unsure` > 40% trên mẫu thử thì R3 chỉ làm checker tới PA#2 (mở rộng luật cứng trước, rồi mới sửa prompt); R1 và R2 làm tiếp trên checker giả.
- **Nếu trễ, cắt từ dưới lên:** (1) nộp, chấm, sandbox; (2) soát ràng buộc và hàng chờ; (3) eval và gate; (4) Publish và khiếu nại; (5) Should; (6) Could.
- Không chỉnh prompt theo phỏng đoán về bộ giữ kín; checker không có cấu hình riêng cho từng bài.

---

## 6. Rủi ro

| # | Rủi ro | Vì sao có thể làm hỏng dự án | Biện pháp |
|---|---|---|---|
| 1 | **Stack 3 service, 5 kho dữ liệu quá nặng** cho nhóm 3 người vừa làm PO | Trễ PA#2, PA#3 | Chốt ở W1: giữ 3 service, hoặc gộp Gateway + Checker và bỏ MongoDB/Garage (brief cho phép). Ranh giới module giữ nguyên |
| 2 | **Sandbox không đạt yêu cầu tối thiểu** | Brief bắt buộc, red team PA#4 sẽ thử | Mỗi yêu cầu một test tấn công ngay W2; không đạt bằng Docker thì dùng Judge0 (cần cgroup v1 trên Ubuntu 22.04/24.04; không có verdict `MLE`), dự phòng isolate 2.x |
| 3 | **Mô hình trừ oan hoặc `unsure` quá nhiều** | Không qua gate PA#4, không đạt trên bộ giữ kín | Thử sớm ở W1 trên bộ dev; luật cứng cho mọi ràng buộc danh sách cấm; quy tắc mục 5.6 |
| 4 | **Checker phụ thuộc vào bài cụ thể** | Bộ giữ kín là bài khác, chạy bằng một lệnh | Chỉ đọc `statement.md` và `constraints.json`; thêm bài tự viết vào bộ của nhóm để kiểm |
| 5 | **TA duyệt mù** | Human gate chỉ còn trên giấy | Duyệt theo nhóm, không có "duyệt tất cả" cho đề xuất của mô hình; theo dõi tỉ lệ TA bác |
| 6 | **Việc PO chiếm thời gian** | Trễ việc của nhóm, hoặc trễ hạn trả lời 2 ngày | Trực luân phiên theo tuần; dùng skill FAQ để soạn nhanh |

---

## 7. Công nghệ và chi phí

### 7.1 Công nghệ (sẽ chốt lại ở W1)

| Công nghệ | Lý do gắn với dự án |
|---|---|
| **React** | Giao diện TA duyệt hàng chờ (bằng chứng + lý do), sinh viên nộp bài và xem kết quả realtime |
| **Node (NestJS)** | Gateway và nghiệp vụ lớp, lab, điểm; module rõ cho xác thực và phân quyền |
| **Java (Spring Boot)** | Judge worker xử lý hàng đợi nhiều luồng khi 80 bài nộp cùng lúc |
| **Python** | Checker: tree-sitter-cpp, SDK mô hình, CLI dự đoán, eval |
| **PostgreSQL** | Dữ liệu quan hệ; transaction khi Publish |
| **MongoDB** | Lưu từng lần soát; có thể bỏ nếu gộp service |
| **Redis** | Rate limit; pub/sub đẩy realtime |
| **RabbitMQ** | Hàng đợi chấm bài; retry, dead-letter queue |
| **Garage** (S3) | Lưu bộ test và code nộp; có thể thay bằng filesystem nếu gộp |
| **Docker** | Đóng gói service và làm sandbox |
| **GitHub Actions** | Lint, format, type check, test, contract test, eval gate |
| **Vercel + máy ảo** (Oracle Always Free, Azure for Students hoặc AWS) | Frontend tĩnh; backend và judge cần Docker |
| **Resend hoặc Brevo** | Email (quên mật khẩu, thông báo) |

### 7.2 Mô hình và chi phí

- **Mặc định:** `gemini-3.1-flash-lite`, 0,25 USD / 1M token vào, 1,50 USD / 1M token ra (ai.google.dev/gemini-api/docs/pricing, tháng 10/2026). Thay thế: `gemini-3.5-flash-lite`. Dự phòng: Groq, GitHub Models; gọi qua lớp `LLMProvider` chuẩn OpenAI-compatible.
- **Chi phí một lab** (brief yêu cầu ghi trong README và AI-LOG): 80 bài Accepted × khoảng 2 ràng buộc ngữ nghĩa = 160 lần gọi; mỗi lần khoảng 2.500 token vào, 400 token ra → 0,4M × 0,25 + 0,064M × 1,50 ≈ **0,2 USD mỗi lab**.
- **Cả học kỳ** (phát triển + eval chạy lặp trong CI): khoảng 5.000 lần gọi ≈ 6 USD nếu trả phí toàn bộ. **Giới hạn chi tiêu 10 USD** trên tài khoản, ghi trong README.

### 7.3 Trợ lý code AI

Mỗi thành viên khai báo công cụ và từng việc trong `AI-LOG.md`.

---

## 8. Thuật ngữ

| Thuật ngữ | Nghĩa |
|---|---|
| **Lab** | Bài tập TA giao cho một lớp: đề, bộ test, ràng buộc, hạn nộp |
| **Bài được tính** | Bài nộp cuối cùng trước hạn của mỗi sinh viên (FAQ-02) |
| **Ràng buộc danh sách cấm** | Ràng buộc bắt đầu bằng "Do not use" hoặc "Do not call", luật cứng quyết |
| **Ràng buộc ngữ nghĩa** | Mọi ràng buộc còn lại, mô hình quyết |
| **Đề xuất / finding** | Kết quả soát một cặp (bài, ràng buộc), chờ TA duyệt |
| **Khoản trừ** | Ràng buộc TA đã xác nhận là vi phạm, kèm mức trừ |
| **Trừ oan** | Báo `violation` cho cặp thực ra `pass` |
| **Bộ giữ kín** | Bộ eval thầy giữ, bài khác bộ dev, chấm checker ở PA#4 |
