import {
  CheckerStatus,
  ConstraintFindingRecord,
  EvidenceLine,
  FindingSource,
  FindingVerdict,
  JudgeVerdict,
  Lab,
  LabConstraint,
  LabConstraintCheckType,
  LabTestCase,
  ReviewStatus,
  StoredUser,
  Submission,
  SubmissionStatus,
  UnsureReason,
  UserRole,
} from '../submissions/submissions.types';

export function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  if (value === undefined || value === null) {
    return fallback;
  }
  return value as T;
}

export function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

/**
 * Converts decimal points in [0, 10] to exact integer centipoints in [0, 1000] (Session 04).
 */
export function pointsToCentipoints(points: number): number {
  const scaled = Math.round(points * 100);
  if (!Number.isInteger(scaled) || scaled < 0 || scaled > 1000) {
    throw new Error(`Invalid deduction points '${points}'. Expected value in [0, 10].`);
  }
  return scaled;
}

export function centipointsToPoints(centipoints: number): number {
  return Math.round(centipoints) / 100;
}

export function usdToMicros(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0) {
    return 0;
  }
  return Math.round(usd * 1_000_000);
}

export function mapUserRow(row: Record<string, unknown>, classIds: string[] = []): StoredUser {
  return {
    id: String(row.id),
    username: String(row.username),
    email: String(row.email ?? `${String(row.username)}@leetkob.edu.vn`),
    displayName: String(row.display_name ?? row.username),
    passwordHash: String(row.password_hash),
    role: String(row.role) as UserRole,
    classIds,
  };
}

export function mapTestCaseRow(row: Record<string, unknown>): LabTestCase {
  return {
    id: String(row.id),
    ordinal: row.ordinal !== undefined ? Number(row.ordinal) : undefined,
    input: String(row.input ?? ''),
    expectedOutput: String(row.expected_output ?? ''),
    isHidden: Boolean(row.is_hidden),
  };
}

export function mapConstraintRow(row: Record<string, unknown>): LabConstraint {
  const centipoints = Number(row.deduction_centipoints ?? 0);
  return {
    id: String(row.constraint_code ?? row.id),
    code: String(row.constraint_code ?? row.id),
    checkType: (row.check_type as LabConstraintCheckType | undefined) ?? 'SEMANTIC_LLM',
    text: String(row.constraint_text ?? ''),
    banPatterns: parseJsonColumn<string[]>(row.ban_patterns, []),
    deduction: centipointsToPoints(centipoints),
  };
}

export function mapLabRow(
  row: Record<string, unknown>,
  testCases: LabTestCase[] = [],
  constraints: LabConstraint[] = [],
): Lab {
  const publishedAt = row.published_at ? toIsoString(row.published_at) : null;
  return {
    id: String(row.id),
    classId: String(row.class_id),
    title: String(row.title),
    statement: typeof row.statement === 'string' ? row.statement : '',
    openedAt: row.opened_at ? toIsoString(row.opened_at) : undefined,
    deadline: toIsoString(row.deadline),
    cpuTimeLimitSec: Number(row.cpu_time_limit_sec ?? 1),
    memoryLimitMb: Number(row.memory_limit_mb ?? 256),
    maxPayloadSize: Number(row.max_payload_bytes ?? row.max_payload_size ?? 65536),
    isActive: Boolean(row.is_active),
    testCases,
    constraints,
    publishedAt,
    isPublished: publishedAt !== null,
    createdBy: row.created_by ? String(row.created_by) : null,
  };
}

export function mapSubmissionRow(row: Record<string, unknown>): Submission {
  return {
    id: String(row.id),
    labId: String(row.lab_id),
    studentId: String(row.student_id),
    code: String(row.code),
    status: String(row.pipeline_status ?? row.status) as SubmissionStatus,
    overallVerdict: row.overall_verdict ? (String(row.overall_verdict) as JudgeVerdict) : null,
    compileOutput:
      row.compile_output !== null && row.compile_output !== undefined
        ? String(row.compile_output)
        : null,
    passedTests: row.passed_tests !== undefined ? Number(row.passed_tests) : 0,
    totalTests: row.total_tests !== undefined ? Number(row.total_tests) : 0,
    maxTimeMs:
      row.max_time_ms !== null && row.max_time_ms !== undefined ? Number(row.max_time_ms) : null,
    maxMemoryKb:
      row.max_memory_kb !== null && row.max_memory_kb !== undefined
        ? Number(row.max_memory_kb)
        : null,
    checkerStatus: (row.checker_status as CheckerStatus | undefined) ?? 'NOT_APPLICABLE',
    isCounting: Boolean(row.is_counting),
    submittedAt: toIsoString(row.submitted_at),
    judgedAt: row.judged_at ? toIsoString(row.judged_at) : null,
    idempotencyKey: String(row.idempotency_key),
  };
}

export function mapConstraintFindingRow(row: Record<string, unknown>): ConstraintFindingRecord {
  return {
    id: String(row.id),
    submissionId: String(row.submission_id),
    constraintId: String(row.constraint_id),
    constraintCode: String(row.constraint_code),
    source: String(row.source) as FindingSource,
    verdict: String(row.verdict) as FindingVerdict,
    unsureReason: row.unsure_reason ? (String(row.unsure_reason) as UnsureReason) : null,
    evidence: parseJsonColumn<EvidenceLine[]>(row.evidence, []),
    reason: row.reason !== null && row.reason !== undefined ? String(row.reason) : null,
    isSampledPass: Boolean(row.is_sampled_pass),
    reviewStatus: String(row.review_status) as ReviewStatus,
    taDecision: row.ta_decision ? (String(row.ta_decision) as 'PASS' | 'VIOLATION') : null,
    taDeduction:
      row.ta_deduction_centipoints !== null && row.ta_deduction_centipoints !== undefined
        ? centipointsToPoints(Number(row.ta_deduction_centipoints))
        : null,
    taEvidence: row.ta_evidence ? parseJsonColumn<EvidenceLine[]>(row.ta_evidence, []) : null,
    taReason: row.ta_reason !== null && row.ta_reason !== undefined ? String(row.ta_reason) : null,
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
    reviewedAt: row.reviewed_at ? toIsoString(row.reviewed_at) : null,
  };
}
