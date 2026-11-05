import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import * as crypto from 'crypto';
import { Submission } from './submissions.types';
import { MOCK_LABS, submissionStore } from './submissions.fixtures';

@Injectable()
export class SubmissionsService {
  createSubmission(
    labId: string,
    studentId: string,
    code: string,
    idempotencyKey: string,
  ): Omit<Submission, 'code'> {
    const lab = MOCK_LABS[labId];
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

    if (new Date(lab.deadline).getTime() < Date.now()) {
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

    const id = `sub_${crypto.randomUUID()}`;
    const submission: Submission = {
      id,
      labId,
      studentId,
      code,
      status: 'QUEUED',
      submittedAt: new Date().toISOString(),
      idempotencyKey,
    };

    submissionStore.saveSubmission(submission);

    return {
      id: submission.id,
      labId: submission.labId,
      studentId: submission.studentId,
      submittedAt: submission.submittedAt,
      status: submission.status,
      idempotencyKey: submission.idempotencyKey,
    };
  }

  getSubmission(id: string): Submission | undefined {
    return submissionStore.getSubmission(id);
  }
}
