-- Migration: 0001_init_pa3_schema (UP)
-- Aligned with docs/database-plan.md, docs/database-checker-sync-plan.md,
-- docs/engineering-rules.md (Session 04), docs/proposal/FAQ.md (FAQ-01..FAQ-14),
-- docs/proposal/proposal-detail.md (§2, §4.2), and docs/contract/checker-output.md.

SET lock_timeout = '2s';

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE CHECK (btrim(username) <> ''),
  email TEXT NOT NULL UNIQUE CHECK (btrim(email) <> ''),
  display_name TEXT NOT NULL CHECK (btrim(display_name) <> ''),
  password_hash TEXT NOT NULL CHECK (btrim(password_hash) <> ''),
  role TEXT NOT NULL CHECK (role IN ('STUDENT', 'TA', 'ADMIN')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE CHECK (btrim(code) <> ''),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  term TEXT NOT NULL CHECK (btrim(term) <> ''),
  invite_code TEXT NULL UNIQUE CHECK (invite_code IS NULL OR btrim(invite_code) <> ''),
  created_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS class_staff (
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  ta_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (class_id, ta_id)
);

CREATE TABLE IF NOT EXISTS class_enrollments (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DROPPED')),
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (class_id, student_id)
);

CREATE TABLE IF NOT EXISTS labs (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  statement TEXT NOT NULL DEFAULT '',
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deadline TIMESTAMPTZ NOT NULL,
  cpu_time_limit_sec INTEGER NOT NULL DEFAULT 1 CHECK (cpu_time_limit_sec BETWEEN 1 AND 5),
  memory_limit_mb INTEGER NOT NULL DEFAULT 256 CHECK (memory_limit_mb BETWEEN 64 AND 512),
  max_payload_bytes INTEGER NOT NULL DEFAULT 65536 CHECK (max_payload_bytes = 65536),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  constraints_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ NULL,
  created_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (deadline > opened_at)
);

CREATE TABLE IF NOT EXISTS lab_test_cases (
  id TEXT PRIMARY KEY,
  lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 1),
  is_hidden BOOLEAN NOT NULL DEFAULT TRUE,
  input TEXT NOT NULL,
  expected_output TEXT NOT NULL,
  UNIQUE (lab_id, ordinal)
);

-- Deductions stored in centipoints (1000 = 10.00 points, 250 = 2.50 points) per Session 04.
CREATE TABLE IF NOT EXISTS lab_constraints (
  id TEXT PRIMARY KEY,
  lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  constraint_code TEXT NOT NULL CHECK (btrim(constraint_code) <> ''),
  check_type TEXT NOT NULL DEFAULT 'LLM' CHECK (check_type IN ('HARD_RULE', 'LLM', 'SEMANTIC_LLM')),
  constraint_text TEXT NOT NULL CHECK (btrim(constraint_text) <> ''),
  ban_patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
  deduction_centipoints INTEGER NOT NULL CHECK (deduction_centipoints BETWEEN 0 AND 1000),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 1),
  UNIQUE (lab_id, constraint_code),
  UNIQUE (lab_id, ordinal)
);

-- Constraint revision audit trail (FAQ-07 & proposal-detail.md §4.2 ConstraintRevision).
CREATE TABLE IF NOT EXISTS lab_constraint_revisions (
  id TEXT PRIMARY KEY,
  lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  constraint_id TEXT NOT NULL REFERENCES lab_constraints(id) ON DELETE CASCADE,
  constraint_code TEXT NOT NULL CHECK (btrim(constraint_code) <> ''),
  previous_text TEXT NOT NULL,
  new_text TEXT NOT NULL,
  previous_deduction_centipoints INTEGER NOT NULL CHECK (previous_deduction_centipoints BETWEEN 0 AND 1000),
  new_deduction_centipoints INTEGER NOT NULL CHECK (new_deduction_centipoints BETWEEN 0 AND 1000),
  changed_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- FAQ-07: after opening a lab, deductions may only be lowered or kept equal, never raised.
  CHECK (new_deduction_centipoints <= previous_deduction_centipoints)
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE RESTRICT,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  code TEXT NOT NULL CHECK (btrim(code) <> '' AND octet_length(code) <= 65536),
  pipeline_status TEXT NOT NULL CHECK (pipeline_status IN ('QUEUED', 'JUDGING', 'COMPLETED', 'JUDGE_ERROR')),
  overall_verdict TEXT NULL CHECK (overall_verdict IN ('AC', 'WA', 'TLE', 'MLE', 'RE', 'CE')),
  compile_output TEXT NULL,
  passed_tests INTEGER NOT NULL DEFAULT 0 CHECK (passed_tests >= 0),
  total_tests INTEGER NOT NULL DEFAULT 0 CHECK (total_tests >= 0 AND passed_tests <= total_tests),
  max_time_ms INTEGER NULL CHECK (max_time_ms >= 0),
  max_memory_kb INTEGER NULL CHECK (max_memory_kb >= 0),
  is_counting BOOLEAN NOT NULL DEFAULT TRUE,
  idempotency_key UUID NOT NULL,
  checker_status TEXT NOT NULL DEFAULT 'NOT_APPLICABLE' CHECK (checker_status IN ('NOT_APPLICABLE', 'PENDING', 'COMPLETED')),
  checker_model TEXT NULL,
  prompt_version TEXT NULL,
  checked_at TIMESTAMPTZ NULL,
  manual_score_centipoints INTEGER NULL CHECK (manual_score_centipoints BETWEEN 0 AND 1000),
  manual_score_reason TEXT NULL,
  manual_scored_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  manual_scored_at TIMESTAMPTZ NULL,
  submitted_at TIMESTAMPTZ NOT NULL,
  judged_at TIMESTAMPTZ NULL,
  UNIQUE (student_id, lab_id, idempotency_key),
  CHECK ((pipeline_status = 'COMPLETED') = (overall_verdict IS NOT NULL)),
  CHECK (
    (manual_score_centipoints IS NULL)
    = (manual_score_reason IS NULL OR btrim(manual_score_reason) = '')
  )
);

-- Per-test verdicts only; test inputs/outputs are never stored here (FAQ-02).
CREATE TABLE IF NOT EXISTS submission_test_results (
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 1),
  verdict TEXT NOT NULL CHECK (verdict IN ('AC', 'WA', 'TLE', 'MLE', 'RE', 'CE')),
  time_ms INTEGER NULL CHECK (time_ms >= 0),
  memory_kb INTEGER NULL CHECK (memory_kb >= 0),
  PRIMARY KEY (submission_id, ordinal)
);

CREATE TABLE IF NOT EXISTS submission_jobs (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
  lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'JUDGE' CHECK (stage IN ('JUDGE', 'CHECK')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'DONE', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_by TEXT NULL,
  locked_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Scoped per actor (student, TA, or admin) with optional lab_id FK and route/lab-included
-- payload_hash per AGENTS.md §4.2, docs/engineering-rules.md §3, and contract suites.
CREATE TABLE IF NOT EXISTS idempotency_records (
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lab_id TEXT NULL REFERENCES labs(id) ON DELETE CASCADE,
  idempotency_key UUID NOT NULL,
  payload_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL CHECK (status_code BETWEEN 200 AND 299),
  response_headers JSONB NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (student_id, idempotency_key)
);

-- Matches docs/contract/checker-output.md (7 UnsureReason codes, violation evidence invariant,
-- Syllabus Rule PENDING_REVIEW, and FAQ-09 TA evidence requirement).
CREATE TABLE IF NOT EXISTS constraint_findings (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  constraint_id TEXT NOT NULL REFERENCES lab_constraints(id) ON DELETE CASCADE,
  constraint_code TEXT NOT NULL CHECK (btrim(constraint_code) <> ''),
  source TEXT NOT NULL CHECK (source IN ('HARD_RULE', 'LLM')),
  verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'violation', 'unsure')),
  unsure_reason TEXT NULL CHECK (
    unsure_reason IN (
      'MODEL_UNSURE',
      'SCHEMA_INVALID',
      'EVIDENCE_MISMATCH',
      'TIMEOUT',
      'COST_CAP_EXCEEDED',
      'MODEL_OFF',
      'PROVIDER_ERROR'
    )
  ),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  reason TEXT NULL,
  is_sampled_pass BOOLEAN NOT NULL DEFAULT FALSE,
  review_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (
    review_status IN ('NOT_QUEUED', 'PENDING_REVIEW', 'APPROVED_VIOLATION', 'DISMISSED_PASS', 'OVERRIDDEN')
  ),
  ta_decision TEXT NULL CHECK (ta_decision IN ('PASS', 'VIOLATION')),
  ta_deduction_centipoints INTEGER NULL CHECK (ta_deduction_centipoints BETWEEN 0 AND 1000),
  ta_evidence JSONB NULL,
  ta_reason TEXT NULL,
  reviewed_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, constraint_id),
  FOREIGN KEY (lab_id, constraint_code)
    REFERENCES lab_constraints(lab_id, constraint_code)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK ((verdict = 'unsure') = (unsure_reason IS NOT NULL)),
  CHECK (
    verdict <> 'violation'
    OR (jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) >= 1)
  ),
  CHECK ((review_status IN ('NOT_QUEUED', 'PENDING_REVIEW')) = (ta_decision IS NULL)),
  CHECK (
    ta_decision IS DISTINCT FROM 'VIOLATION'
    OR (jsonb_typeof(ta_evidence) = 'array' AND jsonb_array_length(ta_evidence) >= 1)
  )
);

-- Aligned with checker/src/semantic_checker.py & llm_client.py:
-- TIMEOUT / PROVIDER_ERROR calls emit empty request_id ('') while OK calls require a real provider request_id.
CREATE TABLE IF NOT EXISTS model_call_logs (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  call_ordinal INTEGER NOT NULL DEFAULT 1 CHECK (call_ordinal >= 1),
  request_id TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL CHECK (btrim(model) <> ''),
  prompt_version TEXT NOT NULL DEFAULT 'v1' CHECK (btrim(prompt_version) <> ''),
  constraints JSONB NOT NULL DEFAULT '[]'::jsonb,
  sanitized_prompt TEXT NOT NULL,
  raw_response TEXT NULL,
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  estimated_cost_micros BIGINT NOT NULL DEFAULT 0 CHECK (estimated_cost_micros >= 0),
  status TEXT NOT NULL CHECK (
    status IN ('OK', 'SCHEMA_INVALID', 'EVIDENCE_MISMATCH', 'TIMEOUT', 'PROVIDER_ERROR')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, call_ordinal),
  CHECK (status <> 'OK' OR btrim(request_id) <> '')
);

-- Per-finding grade appeals within 7 days after publish (FAQ-13, FAQ-14 & proposal-detail.md §4.2).
CREATE TABLE IF NOT EXISTS grade_appeals (
  id TEXT PRIMARY KEY,
  lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  finding_id TEXT NOT NULL UNIQUE REFERENCES constraint_findings(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  student_reason TEXT NOT NULL CHECK (btrim(student_reason) <> ''),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
  ta_decision_reason TEXT NULL,
  resolved_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ NULL,
  CHECK (
    (status = 'PENDING' AND ta_decision_reason IS NULL AND resolved_at IS NULL)
    OR (
      status IN ('ACCEPTED', 'REJECTED')
      AND ta_decision_reason IS NOT NULL
      AND btrim(ta_decision_reason) <> ''
      AND resolved_at IS NOT NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  submission_id TEXT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (btrim(action) <> ''),
  before_state JSONB NULL,
  after_state JSONB NULL,
  reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Query-driven indexes (equality filters first, range/sort columns last; partial indexes where hot)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_classes_code_lower
  ON classes (LOWER(code));

CREATE INDEX IF NOT EXISTS idx_classes_cursor
  ON classes (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_class_staff_ta
  ON class_staff (ta_id, class_id);

CREATE INDEX IF NOT EXISTS idx_enrollments_student_active
  ON class_enrollments (student_id, class_id)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_labs_class_cursor
  ON labs (class_id, created_at DESC, id DESC);

-- Database-level enforcement of FAQ-04: at most one counting submission per (lab, student)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_submissions_counting
  ON submissions (lab_id, student_id)
  WHERE is_counting = TRUE;

CREATE INDEX IF NOT EXISTS idx_submissions_student_history
  ON submissions (lab_id, student_id, submitted_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_submissions_lab_ac
  ON submissions (lab_id, submitted_at DESC, id DESC)
  WHERE overall_verdict = 'AC';

CREATE INDEX IF NOT EXISTS idx_jobs_claimable
  ON submission_jobs (stage, available_at ASC, created_at ASC)
  WHERE status IN ('PENDING', 'PROCESSING');

CREATE INDEX IF NOT EXISTS idx_findings_pending_by_sub
  ON constraint_findings (submission_id, review_status);

CREATE INDEX IF NOT EXISTS idx_findings_lab_review
  ON constraint_findings (lab_id, review_status);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_model_call_logs_req_id
  ON model_call_logs (submission_id, request_id)
  WHERE btrim(request_id) <> '';

CREATE INDEX IF NOT EXISTS idx_appeals_lab_status
  ON grade_appeals (lab_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires
  ON idempotency_records (expires_at);
