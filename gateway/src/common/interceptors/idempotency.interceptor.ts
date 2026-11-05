import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import * as crypto from 'crypto';
import { submissionStore } from '../../submissions/submissions.fixtures';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const idempotencyKey = request.headers['idempotency-key'] as string;
    if (!idempotencyKey) {
      return next.handle();
    }

    const payloadString = JSON.stringify(request.body || {});
    const currentHash = crypto.createHash('sha256').update(payloadString).digest('hex');

    const existingRecord = submissionStore.getIdempotencyRecord(idempotencyKey);
    if (existingRecord) {
      if (existingRecord.payloadHash === currentHash) {
        response.status(existingRecord.statusCode);
        for (const [header, val] of Object.entries(existingRecord.responseHeaders || {})) {
          response.setHeader(header, val);
        }
        response.setHeader('Idempotency-Key', idempotencyKey);
        return of(existingRecord.responseBody);
      } else {
        throw new HttpException(
          {
            type: 'https://leetkob.edu.vn/errors/idempotency-conflict',
            title: 'Conflict',
            status: HttpStatus.CONFLICT,
            detail: 'The provided Idempotency-Key has already been used with different request parameters.',
          },
          HttpStatus.CONFLICT,
        );
      }
    }

    return next.handle().pipe(
      tap((data) => {
        const statusCode = response.statusCode || 201;
        const locationHeader = response.getHeader('Location') as string;
        submissionStore.saveIdempotencyRecord({
          key: idempotencyKey,
          studentId: data.studentId || 'unknown',
          labId: data.labId || 'unknown',
          payloadHash: currentHash,
          statusCode,
          responseHeaders: {
            Location: locationHeader || `/labs/${data.labId}/submissions/${data.id}`,
            'Content-Type': 'application/json',
          },
          responseBody: data,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });
        response.setHeader('Idempotency-Key', idempotencyKey);
      }),
    );
  }
}

