/**
 * Shared types for the standalone Judge & Checker Queue Worker (Task N1).
 * Aligned with docs/contract/queue-and-judge.md, docs/contract/checker-output.md,
 * and gateway/src/submissions/submissions.types.ts.
 */

export type JudgeVerdict = 'AC' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE';
export type SubmissionJobStage = 'JUDGE' | 'CHECK';
export type SubmissionJobStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';

export interface SubmissionJobLimits {
  cpuTimeSec: number;
  wallTimeSec: number;
  memoryMb: number;
  maxProcesses: number;
  outputLimitBytes: number;
}

export interface JobTestCase {
  id: string;
  input: string;
  expectedOutput: string;
}

export interface JobConstraint {
  id: string;
  code?: string;
  text: string;
  deduction?: number;
}

export interface SubmissionJob {
  id: string;
  submissionId: string;
  labId: string;
  studentId: string;
  studentIdentifiers?: string[];
  statement?: string;
  code: string;
  submittedAt: string;
  limits: SubmissionJobLimits;
  testCases: JobTestCase[];
  constraints: JobConstraint[];
  stage?: SubmissionJobStage;
  status: SubmissionJobStatus;
  attempts?: number;
  lastError?: string | null;
  createdAt: string;
}

export interface SubmissionTestResult {
  ordinal: number;
  verdict: JudgeVerdict;
  timeMs: number | null;
  memoryKb: number | null;
}

export interface SandboxExecutionResult {
  overallVerdict: JudgeVerdict;
  compileOutput: string | null;
  testResults: SubmissionTestResult[];
  maxTimeMs: number | null;
  maxMemoryKb: number | null;
}

export interface JudgeCompletionInput extends SandboxExecutionResult {
  submissionId: string;
  judgedAt: string;
}

export type FindingSource = 'HARD_RULE' | 'LLM';
export type FindingVerdict = 'pass' | 'violation' | 'unsure';
export type UnsureReason =
  | 'MODEL_UNSURE'
  | 'SCHEMA_INVALID'
  | 'EVIDENCE_MISMATCH'
  | 'TIMEOUT'
  | 'COST_CAP_EXCEEDED'
  | 'MODEL_OFF'
  | 'PROVIDER_ERROR';

export interface EvidenceLine {
  line: number;
  text: string;
}

export interface CheckerFinding {
  constraint: string;
  source: FindingSource;
  verdict: FindingVerdict;
  evidence: EvidenceLine[];
  unsureReason: UnsureReason | null;
  reason: string | null;
}

export type ModelCallStatus =
  'OK' | 'SCHEMA_INVALID' | 'EVIDENCE_MISMATCH' | 'TIMEOUT' | 'PROVIDER_ERROR';

export interface ModelCallLog {
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

export interface CheckerResult {
  submissionId: string;
  results: CheckerFinding[];
  model: string | null;
  promptVersion: string | null;
  checkedAt: string;
  callLogs: ModelCallLog[];
}

export interface CheckerCompletionInput {
  submissionId: string;
  labId: string;
  model: string | null;
  promptVersion: string | null;
  checkedAt: string;
  findings: Array<{
    constraintCode: string;
    source: FindingSource;
    verdict: FindingVerdict;
    unsureReason: UnsureReason | null;
    evidence: EvidenceLine[];
    reason: string | null;
  }>;
  callLogs: ModelCallLog[];
}
