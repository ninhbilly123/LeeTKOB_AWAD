import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Submission, SubmissionResponse } from './submissions.types';
import { SubmissionStore } from './submissions.store';

@Injectable()
export class SubmissionsService {
  constructor(private readonly store: SubmissionStore) {}
  createSubmission(
    labId: string,
    studentId: string,
    code: string,
    idempotencyKey: string,
    receivedAt: number = Date.now(),
  ): SubmissionResponse {
    const payloadHash = createHash('sha256').update(JSON.stringify({ labId, code })).digest('hex');
    const cached = this.store.getIdempotencyRecord(studentId, idempotencyKey);
    if (cached) {
      if (cached.payloadHash !== payloadHash) {
        throw new HttpException(
          {
            type: 'https://leetkob.edu.vn/errors/idempotency-conflict',
            title: 'Conflict',
            status: HttpStatus.CONFLICT,
            detail:
              'The provided Idempotency-Key has already been used with different request parameters.',
          },
          HttpStatus.CONFLICT,
        );
      }
      return cached.responseBody;
    }
    const lab = this.store.getLab(labId);
    if (!lab) {
      throw new HttpException(
        {
          type: 'https://leetkob.edu.vn/errors/not-found',
          title: 'Not Found',
          status: HttpStatus.NOT_FOUND,
          detail: `The requested lab with ID '${labId}' does not exist.`,
        },
        HttpStatus.NOT_FOUND,
      );
    }
    if (Date.parse(lab.deadline) <= receivedAt) {
      throw new HttpException(
        {
          type: 'https://leetkob.edu.vn/errors/deadline-passed',
          title: 'Conflict',
          status: HttpStatus.CONFLICT,
          detail:
            'The submission deadline for this lab has passed. Late submissions are not accepted.',
        },
        HttpStatus.CONFLICT,
      );
    }
    // Synchronous check + create + cache is atomic within this single-process repository.
    const submission: Submission = {
      id: `sub_${randomUUID()}`,
      labId,
      studentId,
      code,
      status: 'QUEUED',
      submittedAt: new Date(receivedAt).toISOString(),
      idempotencyKey,
    };
    this.store.saveSubmission(submission);
    const result: SubmissionResponse = {
      id: submission.id,
      labId,
      studentId,
      status: submission.status,
      submittedAt: submission.submittedAt,
      idempotencyKey,
    };
    this.store.saveIdempotencyRecord({
      key: idempotencyKey,
      studentId,
      labId,
      payloadHash,
      statusCode: 201,
      responseHeaders: {
        Location: `/labs/${labId}/submissions/${submission.id}`,
        'Content-Type': 'application/json',
      },
      responseBody: result,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    return result;
  }
  getSubmission(id: string): Submission | undefined {
    return this.store.getSubmission(id);
  }
}
