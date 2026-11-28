import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Submission, SubmissionResponse } from './submissions.types';
import { SubmissionStore } from './submissions.store';

@Injectable()
export class SubmissionsService {
  constructor(private readonly store: SubmissionStore) {}

  async createSubmission(
    labId: string,
    studentId: string,
    code: string,
    idempotencyKey: string,
    receivedAt: number = Date.now(),
  ): Promise<SubmissionResponse> {
    const payloadHash = createHash('sha256').update(JSON.stringify({ labId, code })).digest('hex');
    return this.store.createSubmissionAtomicAsync({
      labId,
      studentId,
      code,
      idempotencyKey,
      payloadHash,
      receivedAt,
    });
  }

  async getSubmission(id: string): Promise<Submission | undefined> {
    return this.store.getSubmissionAsync(id);
  }
}
