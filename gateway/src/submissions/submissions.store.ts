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
  IdempotencyRecord,
  Submission,
  SubmissionJob,
  SubmissionResponse,
} from './submissions.types';

/** Dual-mode submission store: PostgreSQL when enabled, in-memory for offline tests. */
@Injectable()
export class SubmissionStore {
  private readonly submissions = new Map<string, Submission>();
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

  // --- Jobs ---

  getJobsForSubmission(submissionId: string): SubmissionJob[] {
    return [...this.jobs.values()].filter((job) => job.submissionId === submissionId);
  }

  getAllJobs(): SubmissionJob[] {
    return [...this.jobs.values()];
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
