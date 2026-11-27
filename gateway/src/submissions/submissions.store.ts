import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { problemException } from '../common/http-problems';
import {
  AtomicCreateSubmissionParams,
  PostgresPersistence,
  buildSubmissionJob,
} from '../persistence/postgres.store';
import { LabsStore } from '../labs/labs.store';
import {
  CheckerCompletionInput,
  ConstraintFindingRecord,
  IdempotencyRecord,
  JudgeCompletionInput,
  Submission,
  SubmissionJob,
  SubmissionJobStage,
  SubmissionResponse,
  SubmissionTestResult,
  TaFindingReviewInput,
  TaReviewQueueEntry,
} from './submissions.types';

/** Dual-mode submission & worker outbox store: PostgreSQL when enabled, in-memory for offline tests. */
@Injectable()
export class SubmissionStore {
  private readonly submissions = new Map<string, Submission>();
  private readonly testResults = new Map<string, SubmissionTestResult[]>();
  private readonly findings = new Map<string, ConstraintFindingRecord[]>();
  private readonly jobs = new Map<string, SubmissionJob>();
  private readonly idempotencyRecords = new Map<string, IdempotencyRecord>();

  constructor(
    private readonly labsStore: LabsStore,
    @Optional() private readonly postgres?: PostgresPersistence,
  ) {}

  private get usePostgres(): boolean {
    return Boolean(this.postgres?.isEnabled());
  }

  resetSubmissions(): void {
    this.submissions.clear();
    this.testResults.clear();
    this.findings.clear();
    this.jobs.clear();
    this.idempotencyRecords.clear();
  }

  // --- Submissions ---

  saveSubmission(submission: Submission): void {
    this.submissions.set(submission.id, submission);
  }

  getSubmission(id: string): Submission | undefined {
    return this.submissions.get(id);
  }

  async getSubmissionAsync(id: string): Promise<Submission | undefined> {
    if (this.usePostgres) {
      return this.postgres!.getSubmission(id);
    }
    return this.getSubmission(id);
  }

  getAllSubmissions(): Submission[] {
    return [...this.submissions.values()];
  }

  async listStudentSubmissionsAsync(labId: string, studentId: string): Promise<Submission[]> {
    if (this.usePostgres) {
      return this.postgres!.listStudentSubmissions(labId, studentId);
    }
    return [...this.submissions.values()]
      .filter((s) => s.labId === labId && s.studentId === studentId)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || b.id.localeCompare(a.id));
  }

  async getSubmissionTestResultsAsync(submissionId: string): Promise<SubmissionTestResult[]> {
    if (this.usePostgres) {
      return this.postgres!.getSubmissionTestResults(submissionId);
    }
    return [...(this.testResults.get(submissionId) ?? [])].sort((a, b) => a.ordinal - b.ordinal);
  }

  // --- Jobs (Worker Outbox for Task N1) ---

  getJobsForSubmission(submissionId: string): SubmissionJob[] {
    return [...this.jobs.values()].filter((job) => job.submissionId === submissionId);
  }

  async getJobsForSubmissionAsync(submissionId: string): Promise<SubmissionJob[]> {
    if (this.usePostgres) {
      return this.postgres!.getJobsForSubmission(submissionId);
    }
    return this.getJobsForSubmission(submissionId);
  }

  getAllJobs(): SubmissionJob[] {
    return [...this.jobs.values()];
  }

  async claimNextJobAsync(
    workerId: string,
    stage: SubmissionJobStage = 'JUDGE',
  ): Promise<SubmissionJob | null> {
    if (this.usePostgres) {
      return this.postgres!.claimNextJob(workerId, stage);
    }
    const candidate = [...this.jobs.values()]
      .filter((j) => (j.stage ?? 'JUDGE') === stage && j.status === 'PENDING')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!candidate) {
      return null;
    }
    candidate.status = 'PROCESSING';
    candidate.attempts = (candidate.attempts ?? 0) + 1;
    const sub = this.submissions.get(candidate.submissionId);
    if (stage === 'JUDGE' && sub && sub.status === 'QUEUED') {
      sub.status = 'JUDGING';
    }
    return { ...candidate };
  }

  async recordJobFailureAsync(
    jobId: string,
    submissionId: string,
    errorMessage: string,
    backoffSeconds = 5,
  ): Promise<'RETRYING' | 'FAILED'> {
    if (this.usePostgres) {
      return this.postgres!.recordJobFailure(jobId, submissionId, errorMessage, backoffSeconds);
    }
    const job = this.jobs.get(jobId);
    if (!job) {
      return 'FAILED';
    }
    job.lastError = errorMessage;
    if ((job.attempts ?? 1) >= 3) {
      job.status = 'FAILED';
      const sub = this.submissions.get(submissionId);
      if (sub && sub.status !== 'COMPLETED') {
        sub.status = 'JUDGE_ERROR';
      }
      return 'FAILED';
    }
    job.status = 'PENDING';
    return 'RETRYING';
  }

  async recordJudgeResultAsync(input: JudgeCompletionInput): Promise<void> {
    if (this.usePostgres) {
      await this.postgres!.recordJudgeResult(input);
      return;
    }
    const sub = this.submissions.get(input.submissionId);
    if (sub) {
      sub.status = 'COMPLETED';
      sub.overallVerdict = input.overallVerdict;
      sub.compileOutput = input.compileOutput;
      sub.passedTests = input.testResults.filter((t) => t.verdict === 'AC').length;
      sub.totalTests = input.testResults.length;
      sub.maxTimeMs = input.maxTimeMs;
      sub.maxMemoryKb = input.maxMemoryKb;
      sub.judgedAt = input.judgedAt;
      sub.checkerStatus = input.overallVerdict === 'AC' ? 'PENDING' : 'NOT_APPLICABLE';
    }
    // Idempotent overwrite by ordinal (N1 redelivery invariant)
    const dedup = new Map<number, SubmissionTestResult>();
    for (const tr of input.testResults) {
      dedup.set(tr.ordinal, { ...tr });
    }
    this.testResults.set(
      input.submissionId,
      [...dedup.values()].sort((a, b) => a.ordinal - b.ordinal),
    );
    const job = [...this.jobs.values()].find((j) => j.submissionId === input.submissionId);
    if (job) {
      if (input.overallVerdict === 'AC') {
        job.stage = 'CHECK';
        job.status = 'PENDING';
      } else {
        job.status = 'DONE';
      }
    }
  }

  async recordCheckerResultAsync(input: CheckerCompletionInput): Promise<void> {
    if (this.usePostgres) {
      await this.postgres!.recordCheckerResult(input);
      return;
    }
    const records: ConstraintFindingRecord[] = input.findings.map((f) => {
      const isQueued =
        f.verdict === 'violation' || f.verdict === 'unsure' || Boolean(f.isSampledPass);
      return {
        id: `fnd_${input.submissionId}_${f.constraintCode}`,
        submissionId: input.submissionId,
        constraintId: `con_${input.labId}_${f.constraintCode}`,
        constraintCode: f.constraintCode,
        source: f.source,
        verdict: f.verdict,
        unsureReason: f.unsureReason,
        evidence: f.evidence.map((e) => ({ ...e })),
        reason: f.reason,
        isSampledPass: Boolean(f.isSampledPass),
        reviewStatus: isQueued ? 'PENDING_REVIEW' : 'NOT_QUEUED',
        taDecision: null,
        taDeduction: null,
        taEvidence: null,
        taReason: null,
        reviewedBy: null,
        reviewedAt: null,
      };
    });
    this.findings.set(input.submissionId, records);

    // Enforce FAQ-10 10% pass sampling across counting AC submissions in this lab
    const countingSubs = [...this.submissions.values()].filter(
      (s) => s.labId === input.labId && s.isCounting && s.overallVerdict === 'AC',
    );
    const allPassFindings = countingSubs.flatMap((s) =>
      (this.findings.get(s.id) ?? []).filter((f) => f.verdict === 'pass'),
    );
    const requiredSampled = Math.ceil(0.1 * allPassFindings.length);
    let currentSampled = allPassFindings.filter((f) => f.isSampledPass).length;
    for (const pf of allPassFindings) {
      if (currentSampled >= requiredSampled) break;
      if (!pf.isSampledPass) {
        pf.isSampledPass = true;
        if (pf.reviewStatus === 'NOT_QUEUED') {
          pf.reviewStatus = 'PENDING_REVIEW';
        }
        currentSampled += 1;
      }
    }

    const sub = this.submissions.get(input.submissionId);
    if (sub) {
      sub.checkerStatus = 'COMPLETED';
    }
    const job = [...this.jobs.values()].find((j) => j.submissionId === input.submissionId);
    if (job) {
      job.status = 'DONE';
    }
  }

  async listLabReviewQueueAsync(
    labId: string,
    scope: 'counted' | 'all' = 'counted',
  ): Promise<TaReviewQueueEntry[]> {
    if (this.usePostgres) {
      return this.postgres!.listLabReviewQueue(labId, scope);
    }
    return [...this.submissions.values()]
      .filter((s) => s.labId === labId && s.overallVerdict === 'AC')
      .filter((s) => (scope === 'counted' ? Boolean(s.isCounting) : true))
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
      .map((sub) => ({
        submission: { ...sub },
        findings: (this.findings.get(sub.id) ?? []).map((f) => ({ ...f })),
      }));
  }

  async reviewConstraintFindingAsync(
    input: TaFindingReviewInput,
  ): Promise<ConstraintFindingRecord> {
    if (this.usePostgres) {
      return this.postgres!.reviewConstraintFinding(input);
    }
    if (input.decision === 'VIOLATION' && (!input.evidence || input.evidence.length === 0)) {
      throw problemException(
        HttpStatus.BAD_REQUEST,
        'Selecting VIOLATION requires at least one evidence line (FAQ-09).',
      );
    }
    const list = this.findings.get(input.submissionId) ?? [];
    const target = list.find((f) => f.id === input.findingId);
    if (!target) {
      throw problemException(
        HttpStatus.NOT_FOUND,
        `Constraint finding '${input.findingId}' was not found.`,
      );
    }
    target.reviewStatus = input.decision === 'VIOLATION' ? 'APPROVED_VIOLATION' : 'DISMISSED_PASS';
    target.taDecision = input.decision;
    target.taDeduction = input.decision === 'VIOLATION' ? input.deduction : 0;
    target.taEvidence = input.evidence ? input.evidence.map((e) => ({ ...e })) : null;
    target.taReason = input.reason ?? null;
    target.reviewedBy = input.actorId;
    target.reviewedAt = new Date().toISOString();
    return { ...target };
  }

  // --- Idempotency ---

  getIdempotencyRecord(
    studentId: string,
    key: string,
    nowMs: number = Date.now(),
  ): IdempotencyRecord | undefined {
    const scopedKey = JSON.stringify([studentId, key]);
    const record = this.idempotencyRecords.get(scopedKey);
    if (record && Date.parse(record.expiresAt) <= nowMs) {
      this.idempotencyRecords.delete(scopedKey);
      return undefined;
    }
    return record;
  }

  saveIdempotencyRecord(record: IdempotencyRecord): void {
    this.idempotencyRecords.set(JSON.stringify([record.studentId, record.key]), record);
  }

  // --- Atomic Submission Creation ---

  async createSubmissionAtomicAsync(
    params: AtomicCreateSubmissionParams,
  ): Promise<SubmissionResponse> {
    if (this.usePostgres) {
      return this.postgres!.createSubmissionAtomic(params);
    }

    const cached = this.getIdempotencyRecord(
      params.studentId,
      params.idempotencyKey,
      params.receivedAt,
    );
    if (cached) {
      if (cached.payloadHash !== params.payloadHash) {
        throw problemException(
          HttpStatus.CONFLICT,
          'The provided Idempotency-Key has already been used with different request parameters.',
          'idempotency-conflict',
        );
      }
      return cached.responseBody;
    }

    const lab = this.labsStore.getLab(params.labId);
    if (!lab) {
      throw problemException(
        HttpStatus.NOT_FOUND,
        `The requested lab with ID '${params.labId}' does not exist.`,
      );
    }
    if (Date.parse(lab.deadline) <= params.receivedAt) {
      throw problemException(
        HttpStatus.CONFLICT,
        'The submission deadline for this lab has passed. Late submissions are not accepted.',
        'deadline-passed',
      );
    }

    for (const existing of this.submissions.values()) {
      if (existing.labId === params.labId && existing.studentId === params.studentId) {
        existing.isCounting = false;
      }
    }

    const submittedAt = new Date(params.receivedAt).toISOString();
    const submission: Submission = {
      id: `sub_${randomUUID()}`,
      labId: params.labId,
      studentId: params.studentId,
      code: params.code,
      status: 'QUEUED',
      isCounting: true,
      submittedAt,
      idempotencyKey: params.idempotencyKey,
    };
    this.saveSubmission(submission);

    const job = buildSubmissionJob(submission, lab, new Date().toISOString());
    this.jobs.set(job.id, job);

    const result: SubmissionResponse = {
      id: submission.id,
      labId: submission.labId,
      studentId: submission.studentId,
      status: submission.status,
      submittedAt: submission.submittedAt,
      idempotencyKey: submission.idempotencyKey,
    };

    this.saveIdempotencyRecord({
      key: params.idempotencyKey,
      studentId: params.studentId,
      labId: params.labId,
      payloadHash: params.payloadHash,
      statusCode: 201,
      responseHeaders: {
        Location: `/labs/${params.labId}/submissions/${submission.id}`,
        'Content-Type': 'application/json',
      },
      responseBody: result,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(params.receivedAt + 24 * 60 * 60 * 1000).toISOString(),
    });

    return result;
  }
}
