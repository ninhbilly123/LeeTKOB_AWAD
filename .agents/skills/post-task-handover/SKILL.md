---
name: post-task-handover
description: >-
  Standardizes end-of-task verification and handover for LeeTKOB. Use this skill
  immediately after completing any feature, bug fix, or documentation task before
  committing, pushing, or opening a pull request.
---

# Post-Task Handover

Execute this checklist after finishing any task in `LeeTKOB_AWAD`.

## Steps

1. **Verify Branch Isolation**
   - Confirm you are on a dedicated branch (`feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`, `test/<slug>`), never on `main`.
   - Confirm the commit scope covers one logical part (`sandbox`, `queue`, `hard rules`, `model call`, `limits`, etc.).

2. **Run Canonical Quality Gates**
   Run all four root commands (skip only if explicitly a documentation-only change with zero code/config edits):
   ```bash
   npm run lint
   npm run format:check
   npm run typecheck
   npm run test
   ```
   All four must exit `0` with no weakened assertions and no CI-silencing flags.

3. **Audit `git diff` Against `AGENTS.md` Never Rules**
   - Verify no secrets, tokens, or `.env` values were introduced.
   - Verify no test assertions, `eval.mjs`, `labels.jsonl`, or dev-set `.cpp` files were loosened or altered.
   - Verify unrelated working-tree files are not staged.

4. **Check `README.md` Sync**
   - If setup steps, environment variables (`.env.example`), datasets, Docker commands, or CLI commands changed, update `README.md` in the same task.

5. **Update `AI-LOG.md`**
   - Append a dated entry at the bottom in ascending chronological order using the course template:
     `Tool`, `Asked for`, `Kept`, `Changed`, `Rejected`, `Validation` / `By hand`.

6. **Log to Project Tracking Sheet**
   - Using the `gsheets` skill and the current member's authorized Google account, append or update the row in tab `phân chia công việc` of spreadsheet `1fGDnFNxfv2c1UpYIcn_WAyc3K33coM-0vgQ9-sObxys`.
   - Populate all 12 columns: `Mã Task`, `Mốc dự án`, `Tên công việc`, `Người thực hiện`, `Độ ưu tiên`, `Trạng thái`, `Ngày bắt đầu`, `Hạn chót`, `Độ khó (1-5)`, `Tiêu chuẩn hoàn thành (DoD)`, `Link PR / Tài liệu`, `Ghi chú`.

7. **Confirm Git & PR Actions with the User**
   - Summarize the changes and explicitly ask the user whether they want to commit, push the branch, and open a Pull Request before running those commands.
