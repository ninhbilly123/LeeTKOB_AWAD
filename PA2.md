# PA#2 — Harness and Quality Gate Report

- **Project**: LeeTKOB
- **Repository**: https://github.com/ninhbilly123/LeeTKOB_AWAD
- **Course**: CSC13114 — Advanced Web Application Development (AWAD)

---

## 1. Team Members

| Full Name | Student ID | Primary Role |
|---|---|---|
| **Phạm An Ninh** | *(Leader)* | M2: DevOps, CI/CD, Quality Gate & Branch Protection |
| **Huỳnh Đăng Khoa** | 23120285 | M3: AI Harness, Rules, Permissions & Security |
| **Nguyễn Nhật Duy** | 23120244 | M1: Backend, Contract Specification & Contract Tests |

---

## 2. Evidence Links

In strict accordance with PA#2 rubric requirements, all required evidence links are documented below:

### 2.1 Public Repository
- **Public Repository URL**: https://github.com/ninhbilly123/LeeTKOB_AWAD

### 2.2 Protected Branch Settings
- **GitHub Branch Protection Rules on `main`**:
  - `Require a pull request before merging` (prevents direct pushes to `main`).
  - `Require status checks to pass before merging` (mandatory check: `Quality Gate (Lint, Format, Typecheck, Test)`).
  - `Require branches to be up to date before merging`.
- **Settings Screenshot**: `docs/images/branch-protection-settings.png` (or linked directly in the self-assessment report).

### 2.3 CI that Blocks a Merge (Criterion 4)
- **Pull Request blocked by red check (Blocked PR)**: 
  - URL: *(Link to the open test PR with red check status)*
  - Description: PR deliberately introduces a TypeScript typing violation. GitHub Actions reports red failure, and the `Merge pull request` button is strictly blocked.
- **Commit that turned CI green (PR turned green)**:
  - Commit SHA: *(SHA of the commit resolving the violation)*
  - Description: Resolves the deliberate error. CI re-runs automatically and turns green (Pass), enabling the merge button.

### 2.4 Deliberate Contract Break (Criterion 6)
- **Deliberate Contract Break Commit/PR**:
  - URL / Commit SHA: *(To be executed by M1 during contract test suite validation)*
  - Description: Deliberately alters the error response format away from RFC 9457 or modifies an expected status code, causing contract tests to bite and fail in CI.

### 2.5 CI Run for Tag `pa2`
- **Git Tag**: `pa2`
- **CI Run URL**: *(Link to the GitHub Actions run corresponding to tag pa2)*

---

## 3. Self-Assessment Summary
For the full criterion-by-criterion breakdown, see [SELF_ASSESSMENT_REPORT.md](./SELF_ASSESSMENT_REPORT.md).
