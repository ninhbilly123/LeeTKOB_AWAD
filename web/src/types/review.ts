import type { JudgeVerdict, StudentTestVerdict, SubmissionPipelineStatus } from './submission';

export type ConstraintCheckVerdict = 'pass' | 'violation' | 'unsure';
export type ConstraintCheckSource = 'HARD_RULE' | 'LLM';

/**
 * Explicit unsure causes per FAQ-09 and docs/contract/checker-output.md
 * (keeps legacy mock aliases for backward compatibility with offline mock seed).
 */
export type UnsureReason =
  | 'MODEL_UNSURE'
  | 'SCHEMA_INVALID'
  | 'EVIDENCE_MISMATCH'
  | 'TIMEOUT'
  | 'COST_CAP_EXCEEDED'
  | 'MODEL_OFF'
  | 'PROVIDER_ERROR'
  | 'PARSE_FAILURE'
  | 'BUDGET_EXCEEDED'
  | 'LOW_CONFIDENCE';

export type FindingReviewStatus =
  'NOT_QUEUED' | 'PENDING_REVIEW' | 'APPROVED_VIOLATION' | 'DISMISSED_PASS' | 'OVERRIDDEN';

export type TaDecision = 'PASS' | 'VIOLATION';

/**
 * Review queue priority buckets per FAQ-10 and Proposal §3.1 (F1-F2).
 */
export type ReviewQueueBucket =
  'HARD_RULE_VIOLATION' | 'LLM_VIOLATION' | 'UNSURE' | 'PASS_SAMPLE_10PCT';

export type ReviewScope = 'counted' | 'all';

export interface EvidenceSpan {
  lineStart: number;
  lineEnd: number;
  snippet: string;
}

export interface ReviewEvidenceLine {
  line: number;
  text: string;
}

export interface TaReviewDecisionInput {
  decision: TaDecision;
  deduction?: number;
  evidence?: ReviewEvidenceLine[];
  reason?: string | null;
}

export interface PublishLabResult {
  labId: string;
  isPublished: true;
  publishedAt: string;
}

export interface LabSubmissionLookupItem {
  id: string;
  labId: string;
  studentId: string;
  studentName: string;
  status: SubmissionPipelineStatus;
  overallVerdict: JudgeVerdict | null;
  passedTests: number;
  totalTests: number;
  maxTimeMs: number | null;
  maxMemoryKb: number | null;
  isCountedForGrade: boolean;
  submittedAt: string;
}

export interface ConstraintVerdictDetail {
  findingId?: string;
  constraintId: string;
  code: string;
  description: string;
  source: ConstraintCheckSource;
  verdict: ConstraintCheckVerdict;
  unsureReason: UnsureReason | null;
  taConfiguredDeduction: number;
  proposedDeduction: number;
  rationale: string;
  evidence: EvidenceSpan[];
  isSampledPass?: boolean;
  reviewStatus?: FindingReviewStatus;
  taDecision?: TaDecision | null;
  taDeduction?: number | null;
  taEvidence?: ReviewEvidenceLine[] | null;
  taReason?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
}

export interface ReviewQueueQuery {
  scope: ReviewScope;
  bucket?: ReviewQueueBucket | 'ALL';
  cursor?: string;
}

export interface ReviewQueueItem {
  submissionId: string;
  labId: string;
  studentId: string;
  studentName: string;
  submittedAt: string;
  isCountedForGrade: boolean;
  overallVerdict: JudgeVerdict;
  checkerStatus: 'PENDING' | 'COMPLETED';
  queueBucket: ReviewQueueBucket;
  summaryLabel: string;
  violationCount: number;
  unsureCount: number;
  pendingReviewCount?: number;
  maxTimeMs: number | null;
  maxMemoryKb: number | null;
}

/**
 * TA-only submission review detail. Never returned to STUDENT accounts before Publish.
 */
export interface TaSubmissionReviewView {
  submissionId: string;
  labId: string;
  labTitle: string;
  publishedAt: string | null;
  studentId: string;
  studentName: string;
  submittedAt: string;
  isCountedForGrade: boolean;
  overallVerdict: JudgeVerdict | null;
  passedTests: number;
  totalTests: number;
  maxTimeMs: number | null;
  maxMemoryKb: number | null;
  code: string;
  compileOutput?: string | null;
  testVerdicts: StudentTestVerdict[];
  checkerStatus: 'NOT_APPLICABLE' | 'PENDING' | 'COMPLETED';
  queueBucket: ReviewQueueBucket;
  constraintVerdicts: ConstraintVerdictDetail[];
}
