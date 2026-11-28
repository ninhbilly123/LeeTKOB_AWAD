# LeeTKOB Workspace Skills

This directory contains project-specific skills discovered automatically by Antigravity (and compatible agent tools) when working inside the `LeeTKOB_AWAD` repository.

## Directory Layout

Each skill lives in its own folder under `.agents/skills/<skill-name>/`:

```text
.agents/skills/
├── README.md
├── write-api-contract/
│   └── SKILL.md
├── feature-workflow/
│   └── SKILL.md
├── post-task-handover/
│   └── SKILL.md
├── checker-eval-runner/
│   └── SKILL.md
├── sandbox-security-audit/
│   └── SKILL.md
└── checkpoint-packaging/
    └── SKILL.md
```

Optional subdirectories per skill (add only when needed):
- `scripts/` — executable helper scripts linked from `SKILL.md`
- `references/` — detailed docs loaded on demand
- `examples/` — sample inputs/outputs
- `resources/` — templates or static assets

## Available Skills

| Skill | Purpose | When to Use |
|---|---|---|
| [`write-api-contract`](./write-api-contract/SKILL.md) | IA#3 endpoint contract format and tests derived from the contract | Writing or updating an API contract or contract test |
| [`feature-workflow`](./feature-workflow/SKILL.md) | End-to-end 7-stage feature lifecycle (scope, branch, contract, tests-first, implement, handover, PR) | Starting any new feature or milestone task (`D1–D3`, `N1–N3`, `K1–K3`) |
| [`post-task-handover`](./post-task-handover/SKILL.md) | Run gates, audit diff, update `AI-LOG.md`, log to Google Sheet, confirm git/PR | Immediately after completing any task |
| [`checker-eval-runner`](./checker-eval-runner/SKILL.md) | Verify dev-set SHA-256, anti-overfit scan, offline `MODEL_OFF=1` run, real-run artifacts | When editing `checker/`, prompts, hard rules, or eval datasets |
| [`sandbox-security-audit`](./sandbox-security-audit/SKILL.md) | Verify all 9 C++ sandbox minimums, red-flag scan, and queue restart idempotency | When editing `judge/`, Dockerfiles, sandbox runner, or CI sandbox tests |
| [`checkpoint-packaging`](./checkpoint-packaging/SKILL.md) | Pre-submission audit, Syllabus Rule check, tag push, and clean ZIP packaging | Before submitting `PA#3`, `PA#4`, or `PA#5` |
