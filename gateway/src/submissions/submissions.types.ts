import { Request } from 'express';

/**
 * Core domain interfaces and RFC 9457 Problem Details definitions.
 * Aligned with docs/contract/post-submissions.md, docs/contract/auth-and-labs.md,
 * docs/contract/checker-output.md, and docs/database-plan.md.
 */

export type UserRole = 'STUDENT' | 'TA' | 'ADMIN';

/** Pipeline execution status separated cleanly from judge verdicts (FAQ-02, FAQ-04, FAQ-05). */
export type SubmissionStatus = 'QUEUED' | 'JUDGING' | 'COMPLETED' | 'JUDGE_ERROR';

export type JudgeVerdict = 'AC' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE';

export type CheckerStatus = 'NOT_APPLICABLE' | 'PENDING' | 'COMPLETED';

export type EnrollmentStatus = 'ACTIVE' | 'DROPPED';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  classIds: string[];
}

export interface StoredUser extends AuthenticatedUser {
  username: string;
  email: string;
  displayName: string;
  passwordHash: string;
}

export interface UserProfile {
  id: string;
  username: string;
  email?: string;
  displayName?: string;
  role: UserRole;
  classIds: string[];
}

export interface ClassRecord {
  id: string;
  code: string;
  name: string;
  term: string;
  inviteCode?: string | null;
  createdBy: string | null;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
  receivedAt: number;
}

export interface LabTestCase {
  id: string;
  ordinal?: number;
  input: string;
  expectedOutput: string;
  isHidden: boolean;
}

export type LabConstraintCheckType = 'HARD_RULE' | 'LLM' | 'SEMANTIC_LLM';

export interface LabConstraint {
  id: string;
  code?: string;
  checkType?: LabConstraintCheckType;
  text: string;
  banPatterns?: string[];
  /** Point deduction in [0, 10]; stored internally in DB as integer centipoints [0, 1000]. */
  deduction: number;
}

export interface Lab {
  id: string;
  classId: string;
  title: string;
  statement?: string;
  openedAt?: string;
  deadline: string; // ISO 8601 string
  cpuTimeLimitSec?: number; // 1–5s per FAQ-05 (default 1)
  memoryLimitMb?: number; // 64–512 MB per FAQ-05 (default 256)
  maxPayloadSize: number; // fixed 65,536 bytes (64 KB) per FAQ-05
  isActive: boolean;
  constraintsUpdatedAt?: string;
  testCases?: LabTestCase[];
  constraints?: LabConstraint[];
  publishedAt?: string | null;
  isPublished?: boolean;
  createdBy?: string | null;
}

export interface ClassMembership {
  id: string;
  studentId: string;
  classId: string;
  status: EnrollmentStatus;
}

export interface SubmissionTestResult {
  ordinal: number;
  verdict: JudgeVerdict;
  timeMs?: number | null;
  memoryKb?: number | null;
}

export interface Submission {
  id: string;
  labId: string;
  studentId: string;
  code: string;
  status: SubmissionStatus;
  overallVerdict?: JudgeVerdict | null;
  compileOutput?: string | null;
  passedTests?: number;
  totalTests?: number;
  maxTimeMs?: number | null;
  maxMemoryKb?: number | null;
  checkerStatus?: CheckerStatus;
  checkerModel?: string | null;
  promptVersion?: string | null;
  checkedAt?: string | null;
  manualScore?: number | null;
  manualScoreReason?: string | null;
  manualScoredBy?: string | null;
  manualScoredAt?: string | null;
  isCounting?: boolean;
  submittedAt: string; // ISO 8601 string
  judgedAt?: string | null;
  idempotencyKey: string;
}

export type SubmissionResponse = Pick<
  Submission,
  'id' | 'labId' | 'studentId' | 'status' | 'submittedAt' | 'idempotencyKey'
>;

export interface SubmissionJobLimits {
  cpuTimeSec: number;
  wallTimeSec: number;
  memoryMb: number;
  maxProcesses: number;
  outputLimitBytes: number;
}

export const DEFAULT_SUBMISSION_LIMITS: SubmissionJobLimits = {
  cpuTimeSec: 1,
  wallTimeSec: 3,
  memoryMb: 256,
  maxProcesses: 16,
  outputLimitBytes: 1048576,
};

export type SubmissionJobStage = 'JUDGE' | 'CHECK';
export type SubmissionJobStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';

export interface SubmissionJob {
  id: string;
  submissionId: string;
  labId: string;
  studentId: string;
  /** Student identity strings passed to checker/src/sanitizer.py for prompt redaction (FAQ-06). */
  studentIdentifiers?: string[];
  statement?: string;
  code: string;
  submittedAt: string;
  limits: SubmissionJobLimits;
  testCases: Array<{ id: string; input: string; expectedOutput: string }>;
  constraints: LabConstraint[];
  stage?: SubmissionJobStage;
  status: SubmissionJobStatus;
  attempts?: number;
  lastError?: string | null;
  createdAt: string;
}

export type FindingSource = 'HARD_RULE' | 'LLM';
export type FindingVerdict = 'pass' | 'violation' | 'unsure';

/** Exact 7 UnsureReason values from docs/contract/checker-output.md (FAQ-09). */
export type UnsureReason =
  | 'MODEL_UNSURE'
  | 'SCHEMA_INVALID'
  | 'EVIDENCE_MISMATCH'
  | 'TIMEOUT'
  | 'COST_CAP_EXCEEDED'
  | 'MODEL_OFF'
  | 'PROVIDER_ERROR';

export type ReviewStatus =
  'NOT_QUEUED' | 'PENDING_REVIEW' | 'APPROVED_VIOLATION' | 'DISMISSED_PASS' | 'OVERRIDDEN';

export interface EvidenceLine {
  line: number;
  text: string;
}

export interface ConstraintFindingRecord {
  id: string;
  submissionId: string;
  labId?: string;
  constraintId: string;
  constraintCode: string;
  source: FindingSource;
  verdict: FindingVerdict;
  unsureReason: UnsureReason | null;
  evidence: EvidenceLine[];
  reason: string | null;
  isSampledPass: boolean;
  reviewStatus: ReviewStatus;
  taDecision: 'PASS' | 'VIOLATION' | null;
  taDeduction: number | null;
  taEvidence: EvidenceLine[] | null;
  taReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export type ModelCallStatus =
  'OK' | 'SCHEMA_INVALID' | 'EVIDENCE_MISMATCH' | 'TIMEOUT' | 'PROVIDER_ERROR';

export interface ModelCallLogInput {
  callOrdinal?: number;
  requestId: string;
  model: string;
  promptVersion?: string;
  constraints: string[];
  sanitizedPrompt: string;
  rawResponse?: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  estimatedCostUsd: number;
  status: ModelCallStatus;
}

export interface JudgeCompletionInput {
  submissionId: string;
  overallVerdict: JudgeVerdict;
  compileOutput: string | null;
  testResults: SubmissionTestResult[];
  maxTimeMs: number | null;
  maxMemoryKb: number | null;
  judgedAt: string;
}

export interface CheckerFindingInput {
  constraintCode: string;
  source: FindingSource;
  verdict: FindingVerdict;
  unsureReason: UnsureReason | null;
  evidence: EvidenceLine[];
  reason: string | null;
  isSampledPass?: boolean;
}

export interface CheckerCompletionInput {
  submissionId: string;
  labId: string;
  model?: string | null;
  promptVersion?: string | null;
  checkedAt?: string;
  findings: CheckerFindingInput[];
  callLogs: ModelCallLogInput[];
}

export interface TaFindingReviewInput {
  findingId: string;
  labId: string;
  submissionId: string;
  actorId: string;
  decision: 'PASS' | 'VIOLATION';
  deduction: number;
  evidence?: EvidenceLine[];
  reason?: string | null;
}

export interface TaReviewQueueEntry {
  submission: Submission;
  findings: ConstraintFindingRecord[];
}

export interface IdempotencyRecord {
  key: string;
  studentId: string;
  labId: string;
  payloadHash: string; // SHA-256 hex string
  statusCode: number;
  responseHeaders: Record<string, string>;
  responseBody: SubmissionResponse;
  createdAt: string;
  expiresAt: string;
}

export interface Rfc9457ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
}
