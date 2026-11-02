# PA#2 — Harness and Quality Gate Report

- **Dự án**: LeeTKOB
- **Repository**: https://github.com/ninhbilly123/LeeTKOB_AWAD
- **Môn học**: CSC13114 — Phát triển ứng dụng web nâng cao (AWAD)

---

## 1. Danh sách thành viên nhóm

| Họ và tên | MSSV | Vai trò chính |
|---|---|---|
| **Phạm An Ninh** | *(Leader)* | M2: DevOps, CI/CD, Quality Gate & Branch Protection |
| **Huỳnh Đăng Khoa** | | M1: Backend, Contract Specification & Contract Tests |
| **Nguyễn Nhật Duy** | | M3: AI Harness, Rules, Permissions & Security |

---

## 2. Bằng chứng nghiệm thu (Evidence Links)

Tuân thủ đầy đủ các yêu cầu của Rubric PA#2, dưới đây là các đường dẫn và bằng chứng kiểm chứng:

### 2.1 Repository công khai
- **Public Repository URL**: https://github.com/ninhbilly123/LeeTKOB_AWAD

### 2.2 Cấu hình bảo vệ nhánh `main` (Branch Protection Settings)
- **Cấu hình trên GitHub**:
  - `Require a pull request before merging` (chặn push thẳng vào `main`).
  - `Require status checks to pass before merging` (bắt buộc check `Quality Gate CI` phải xanh).
  - `Require branches to be up to date before merging`.
- **Ảnh chụp màn hình**: `docs/images/branch-protection-settings.png` (hoặc xem trong phần Evidence của báo cáo).

### 2.3 Bằng chứng CI "Biết cắn" (CI that blocks a merge - Criterion 4)
- **Pull Request bị chặn bởi check đỏ (Blocked PR)**: 
  - URL: *(Sẽ cập nhật link PR sau khi mở PR thử nghiệm)*
  - Mô tả: PR cố tình vi phạm quy tắc format/linter, GitHub Actions báo đỏ và nút `Merge pull request` bị vô hiệu hóa hoàn toàn.
- **Commit sửa lỗi làm CI chuyển xanh (PR turned green)**:
  - Commit SHA: *(Sẽ cập nhật SHA sau khi commit fix)*
  - Mô tả: Commit sửa toàn bộ vi phạm, CI chạy lại và chuyển sang trạng thái xanh (Pass), cho phép merge.

### 2.4 Bằng chứng làm gãy contract có chủ đích (Deliberate contract break - Criterion 6)
- **Commit/PR làm gãy contract**:
  - URL / Commit SHA: *(Do M1 thực hiện ở task Contract)*
  - Mô tả: Cố tình làm sai lệch response schema hoặc status code theo RFC 9457, khiến bộ contract test báo lỗi trên CI.

### 2.5 CI Run của Git Tag `pa2`
- **Git Tag**: `pa2`
- **CI Run URL**: *(Link GitHub Actions run tương ứng với tag pa2)*

---

## 3. Bảng tự đánh giá (Self-Assessment Summary)
Chi tiết xem tại [SELF_ASSESSMENT_REPORT.md](./SELF_ASSESSMENT_REPORT.md).
