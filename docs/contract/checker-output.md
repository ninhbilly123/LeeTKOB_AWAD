# Internal & Eval Contract: Constraint Checker Output Schema

- **Scope:** Shared schema between `checker` (Python), `judge/worker`, `gateway` (NestJS review queue), and the offline CLI/eval pipeline (`eval.mjs`).
- **Status:** PA#3 Baseline Contract (`v1`).
- **Referenced FAQs & Rules:** `FAQ-02`, `FAQ-08`, `FAQ-09`, `FAQ-10`, `FAQ-11`, `FAQ-12`, PA#3 Syllabus Rule (`docs/rubric/PA3_rubric.md`), `AGENTS.md`.

---

## 1. Core Invariants (Syllabus Rule & FAQ Boundaries)

1. **No Deduction or Mark Output:** Neither the checker service nor the LLM output schema may include any `deduction`, `penalty`, `points`, or `score` field. Deduction weights belong exclusively to the TA's lab constraint definition (`FAQ-11`).
2. **Hard Rules First:** Constraints starting with `"Do not use"` or `"Do not call"` (with banned identifiers in backticks) are decided solely by the syntax-aware C++ AST hard-rule engine (`source: "HARD_RULE"`). The LLM MUST NOT be called for any constraint decided by hard rules.
3. **Two Mandatory LLM Guardrails:**
   - **Schema Validation:** LLM JSON output is strictly validated against Section 3. Any invalid structure, unexpected field (including any deduction/score field), or `evidence` line mismatch against the original submitted code MUST coerce the verdict to `"unsure"` with an explicit `unsureReason` (`FAQ-09`).
   - **Timeout:** Exceeding the configured model timeout MUST coerce the verdict to `"unsure"` with `unsureReason: "TIMEOUT"` (`FAQ-09`).
4. **Human Gate & Student Visibility (`FAQ-02`, `FAQ-08`, `FAQ-10`, `FAQ-12`):**
   - Checker results land **only** in the TA review queue with initial review state `PENDING_REVIEW`.
   - Before Publish, student-facing APIs MUST return **only** `overallVerdict` and `testVerdicts[]`, hiding test I/O (`FAQ-02`) and hiding all checker `verdict`, `source`, `evidence`, `unsureReason`, `reason`, and proposed deductions (`FAQ-08`).
   - Students NEVER see `unsure` verdicts, rejected TA proposals, or whether a `pass` verdict was sampled in the 10% review queue (`FAQ-08`, `FAQ-10`).

---

## 2. Service-to-Service Output Schema (`CheckerResult`)

Used when `checker` returns findings to `worker` / `gateway` for an `Accepted` submission.

### 2.1 Top-Level Payload

| Field | Type | Required | Description |
|---|---|:---:|---|
| `submissionId` | `string` | **Yes** | Submission identifier (e.g. `sub_...`). |
| `results` | `ConstraintFinding[]` | **Yes** | Exactly one finding per lab constraint, preserving constraint order. |
| `model` | `string \| null` | **Yes** | Actual model ID used for semantic constraints (e.g. `"gemini-3.1-flash-lite-preview"`), or `null` when only hard rules ran / `MODEL_OFF=1`. |
| `promptVersion` | `string \| null` | **Yes** | Version identifier of the prompt template (e.g. `"v1"`), or `null` if no LLM call was made. |
| `checkedAt` | `string (ISO 8601)` | **Yes** | UTC timestamp when checking completed. |
| `callLogs` | `ModelCallLog[]` | **Yes** | Zero or more provider call audit entries (empty `[]` when only hard rules ran or `MODEL_OFF=1`). Stored for backend audit only; never exposed to students. |

### 2.2 `ConstraintFinding` Object

| Field | Type | Required | Rules |
|---|---|:---:|---|
| `constraint` | `string` | **Yes** | Constraint ID from the lab definition (e.g. `"C1"`, `"C2"`). |
| `source` | `"HARD_RULE" \| "LLM"` | **Yes** | `"HARD_RULE"` for ban-list AST checks; `"LLM"` for semantic constraints (including `MODEL_OFF=1` fallback `unsure`). |
| `verdict` | `"pass" \| "violation" \| "unsure"` | **Yes** | Strict 3-value enum. |
| `evidence` | `EvidenceLine[]` | **Yes** | Array of offending/supporting lines from the **original** submitted C++ source. Empty `[]` for `pass`; at least 1 item for `violation`; optional suspected lines for `unsure`. |
| `unsureReason` | `UnsureReason \| null` | **Yes** | **Required non-null** when `verdict === "unsure"`; MUST be `null` when `verdict` is `"pass"` or `"violation"` (`FAQ-09`). |
| `reason` | `string \| null` | **Yes** | Concise explanation for the TA (required for `violation` and `unsure`, optional/short or `null` for `pass`). Never contains student identity or deduction numbers. |

### 2.3 `EvidenceLine` Object

| Field | Type | Required | Rules |
|---|---|:---:|---|
| `line` | `integer` | **Yes** | **1-based** line number in the original student submission (`>= 1`). |
| `text` | `string` | **Yes** | Exact text of that line in the original submission (trimmed or exact raw line matching `lines[line - 1]`; verification checks `text.strip() == original_lines[line - 1].strip()` and non-empty). |

### 2.4 `UnsureReason` Enum (`FAQ-09`)

| Value | Meaning |
|---|---|
| `MODEL_UNSURE` | Model returned `"unsure"` within valid schema. |
| `SCHEMA_INVALID` | Model response could not be parsed or violated the JSON schema (e.g. invalid verdict, missing required key, extra forbidden key). |
| `EVIDENCE_MISMATCH` | One or more `evidence` items had an out-of-range `line` or `text` not matching the original source line. |
| `TIMEOUT` | Model request exceeded the per-call/per-submission timeout limit. |
| `COST_CAP_EXCEEDED` | Lab cost/quota cap was reached before checking this constraint. |
| `MODEL_OFF` | Checker ran with `MODEL_OFF=1` (offline mode). |
| `PROVIDER_ERROR` | Upstream provider returned a non-2xx error or network failure. |

### 2.5 `ModelCallLog` Object (Backend Audit & PA#3 Real-Run Evidence)

| Field | Type | Required | Description |
|---|---|:---:|---|
| `requestId` | `string` | **Yes** | Provider request ID returned by the LLM API (never fabricated). |
| `model` | `string` | **Yes** | Model identifier used for the call. |
| `constraints` | `string[]` | **Yes** | Semantic constraint IDs evaluated in this call (MUST exclude hard-rule constraint IDs). |
| `sanitizedPrompt` | `string` | **Yes** | Exact prompt sent to the model (comments and student identity stripped, line numbers preserved). |
| `inputTokens` | `integer` | **Yes** | Prompt token count reported by provider (`>= 0`). |
| `outputTokens` | `integer` | **Yes** | Completion token count reported by provider (`>= 0`). |
| `latencyMs` | `integer` | **Yes** | Wall-clock call duration in milliseconds (`>= 0`). |
| `estimatedCostUsd` | `number` | **Yes** | Estimated API cost in USD (`0.0` for free-tier actual spend; real-run report records both actual spend and paid-tier estimate). |
| `status` | `"OK" \| "SCHEMA_INVALID" \| "EVIDENCE_MISMATCH" \| "TIMEOUT" \| "PROVIDER_ERROR"` | **Yes** | Outcome of the call after guardrails. |

---

## 3. Strict LLM Raw Output Schema

The prompt instructs the model to return **only** JSON matching this schema (enforced by validator with `additionalProperties: false`):

```json
{
  "results": [
    {
      "constraint": "C2",
      "verdict": "pass | violation | unsure",
      "evidence": [
        { "line": 4, "text": "for (int i = 0; i < n; i++)" }
      ],
      "reason": "Short explanation for the TA."
    }
  ]
}
```

Validation rules applied before accepting any LLM output:
1. Every requested semantic constraint ID appears **once** in `results`.
2. `verdict` is strictly `"pass"`, `"violation"`, or `"unsure"`.
3. No extra fields (especially `deduction`, `score`, `marks`) exist anywhere in the object or items.
4. If `verdict === "violation"`, `evidence` MUST be non-empty (`len >= 1`).
5. Every `evidence[i]` MUST satisfy `1 <= line <= len(original_lines)` and `text` matches `original_lines[line - 1]` (normalized whitespace). Failing this turns the finding into `verdict: "unsure"`, `unsureReason: "EVIDENCE_MISMATCH"`.

---

## 4. Gateway Review Queue Mapping (For D2)

When `gateway` persists `CheckerResult` for a student's **counted** `Accepted` submission (`FAQ-02`):

- **Queue inclusion (`FAQ-10`):**
  - Include every finding with `verdict === "violation"` or `verdict === "unsure"`.
  - Sample `ceil(0.10 * totalPassFindingsInLab)` random findings from `verdict === "pass"` (if there is at least 1 `pass` in the lab, at least 1 is sampled).
- **Initial TA Review Fields:**
  - `reviewStatus`: `"PENDING_REVIEW"` (never auto-approved or auto-deducted)
  - `taDecision`: `null` (`"PASS" | "VIOLATION"` once reviewed)
  - `taEvidence`: `null` (required `>= 1` line if TA picks `"VIOLATION"`, per `FAQ-09` & `FAQ-10`)
  - `deduction`: sourced from the lab's constraint configuration (displayed as proposed deduction to TA only when `verdict === "violation"`, never `unsure`, never sent to students before Publish)
  - **Publish Gate (`FAQ-12`):** `POST /labs/{labId}/publish` MUST fail (`409 Conflict`) if `now < deadline` or any queued item still has `reviewStatus === "PENDING_REVIEW"`.

---

## 5. Offline CLI & `eval.mjs` Prediction JSONL Schema (For K3)

The CLI command writes one JSON object per `(solution, constraint)` pair per line (JSONL), strictly matching the class brief (`Section 6`) and `eval.mjs`:

```json
{"solution":"sort-merge/s03","constraint":"C1","verdict":"violation","evidence":[{"line":12,"text":"std::sort(a, a + n);"}]}
```

| Field | Type | Rules |
|---|---|---|
| `solution` | `string` | Relative `<problem>/<solution_id>` identifier (e.g. `"sort-merge/s03"`). |
| `constraint` | `string` | Constraint ID (e.g. `"C1"`). |
| `verdict` | `"pass" \| "violation" \| "unsure"` | Exact 3-value string. |
| `evidence` | `EvidenceLine[]` | `[{"line": <int>, "text": <str>}, ...]`; `[]` when `pass` or when no lines apply. |

---

## 6. Concrete Examples (`pass`, `violation`, `unsure`)

### 6.1 Example: `pass` (Hard Rule)

```json
{
  "constraint": "C1",
  "source": "HARD_RULE",
  "verdict": "pass",
  "evidence": [],
  "unsureReason": null,
  "reason": "No banned identifier call or use detected in C++ AST."
}
```

### 6.2 Example: `violation` (Hard Rule)

```json
{
  "constraint": "C1",
  "source": "HARD_RULE",
  "verdict": "violation",
  "evidence": [
    { "line": 12, "text": "std::sort(a, a + n);" }
  ],
  "unsureReason": null,
  "reason": "AST detected banned call to `std::sort`."
}
```

### 6.3 Example: `violation` (LLM Semantic Constraint)

```json
{
  "constraint": "C2",
  "source": "LLM",
  "verdict": "violation",
  "evidence": [
    { "line": 4, "text": "for (int i = 0; i < n; i++)" },
    { "line": 5, "text": "  for (int j = 0; j + 1 < n - i; j++)" }
  ],
  "unsureReason": null,
  "reason": "Nested adjacent-swap loops implement bubble sort rather than merge sort."
}
```

### 6.4 Example: `unsure` (Guardrail Triggered — `TIMEOUT` / `SCHEMA_INVALID` / `MODEL_OFF`)

```json
{
  "constraint": "C2",
  "source": "LLM",
  "verdict": "unsure",
  "evidence": [],
  "unsureReason": "TIMEOUT",
  "reason": "Model call exceeded the 15s timeout limit; routed to TA manual review."
}
```

```json
{
  "constraint": "C2",
  "source": "LLM",
  "verdict": "unsure",
  "evidence": [],
  "unsureReason": "MODEL_OFF",
  "reason": "Semantic checking skipped because MODEL_OFF=1."
}
```
