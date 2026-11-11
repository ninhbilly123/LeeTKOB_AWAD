import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { Request, Response } from 'express';

const errors: Record<number, [string, string]> = {
  400: ['Bad Request', 'bad-request'],
  401: ['Unauthorized', 'unauthorized'],
  403: ['Forbidden', 'forbidden'],
  404: ['Not Found', 'not-found'],
  409: ['Conflict', 'conflict'],
  413: ['Payload Too Large', 'payload-too-large'],
  415: ['Unsupported Media Type', 'unsupported-media-type'],
  500: ['Internal Server Error', 'internal-server-error'],
};
const internalDetail =
  'An unexpected error occurred while processing the submission. Please retry with the same Idempotency-Key.';

@Catch()
export class Rfc9457ExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    let status = 500;
    let body: Record<string, unknown> = {};
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const value = exception.getResponse();
      if (typeof value === 'object' && value !== null) body = value as Record<string, unknown>;
    } else if (typeof exception === 'object' && exception !== null && 'type' in exception) {
      // Express parser errors are not Nest HttpExceptions.
      if (exception.type === 'entity.parse.failed') status = 400;
      if (exception.type === 'entity.too.large') status = 413;
    }
    const [defaultTitle, slug] = errors[status] || errors[500];
    const safeString = (value: unknown, fallback: string): string =>
      typeof value === 'string' ? value : fallback;
    const title = status >= 500 ? defaultTitle : safeString(body.title, defaultTitle);
    const type =
      status >= 500
        ? `https://leetkob.edu.vn/errors/${slug}`
        : safeString(body.type, `https://leetkob.edu.vn/errors/${slug}`);
    const fallback =
      status === 400
        ? 'Invalid JSON request body.'
        : status === 413
          ? 'Request body exceeds the 512 KB transport limit.'
          : defaultTitle;
    const detail = status >= 500 ? internalDetail : safeString(body.detail, fallback);
    response
      .status(status)
      .setHeader('Content-Type', 'application/problem+json')
      .json({
        type,
        title,
        status,
        detail,
        instance: request.originalUrl || request.url,
      });
  }
}
