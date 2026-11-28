/**
 * Pipeline status vs Judge verdict separated strictly per FAQ-02, FAQ-04, FAQ-05.
 */
export type SubmissionPipelineStatus = 'QUEUED' | 'JUDGING' | 'COMPLETED' | 'JUDGE_ERROR';

export type JudgeVerdict = 'AC' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE';

export interface CreateSubmissionInput {
  code: string;
}

/**
 * Matches docs/contract/post-submissions.md 201 Created response shape.
 */
export interface SubmissionAcceptedDto {
  id: string;
  labId: string;
  studentId: string;
  status: 'QUEUED';
  submittedAt: string;
  idempotencyKey: string;
}

/**
 * Per-test verdict visible to students (FAQ-02): strictly no test input, expectedOutput, or actualOutput.
 */
export interface StudentTestVerdict {
  ordinal: number;
  verdict: JudgeVerdict;
  timeMs?: number;
}

export interface StudentSubmissionSummary {
  id: string;
  labId: string;
  submittedAt: string;
  status: SubmissionPipelineStatus;
  overallVerdict: JudgeVerdict | null;
  passedTests: number;
  totalTests: number;
  maxTimeMs: number | null;
  maxMemoryKb: number | null;
  isCountedForGrade: boolean; // FAQ-04: latest valid pre-deadline submission
}

export interface PublishedDeductionItem {
  constraintCode: string;
  description: string;
  deduction: number;
  evidenceLines: number[];
  evidence?: Array<{ line: number; text: string }>;
  taNote?: string;
}

export interface PublishedGradeView {
  rawScore: number;
  totalDeductions: number;
  finalScore: number;
  publishedAt: string;
  confirmedDeductions: PublishedDeductionItem[];
}

/**
 * Student-facing submission detail (FAQ-02, FAQ-08, Syllabus Rule):
 * Before Publish (`publishedGrade === null`), constraint verdicts, evidence, unsureReason,
 * and proposed deductions do not exist on this type.
 */
export interface StudentSubmissionView extends StudentSubmissionSummary {
  studentId: string;
  code: string;
  compileOutput: string | null;
  testVerdicts: StudentTestVerdict[];
  publishedGrade: PublishedGradeView | null;
}
