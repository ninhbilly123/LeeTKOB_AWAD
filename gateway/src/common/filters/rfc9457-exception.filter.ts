import { ExceptionFilter, Catch, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
  503: ['Service Unavailable', 'service-unavailable'],
};
const internalDetail =
  'An unexpected error occurred while processing the submission. Please retry with the same Idempotency-Key.';

function resolveRequestId(request: Request): string {
  const incoming = request.headers['x-request-id'];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (trimmed.length > 0 && trimmed.length <= 128 && /^[\w.:-]+$/.test(trimmed)) {
      return trimmed;
    }
  }
  return randomUUID();
}

@Catch()
export class Rfc9457ExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(Rfc9457ExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    let status = 500;
    let body: Record<string, unknown> = {};
    const isHttpException = exception instanceof HttpException;
    if (isHttpException) {
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
    const isOpaqueInternalError = status === 500 || (status >= 500 && !isHttpException);

    const title = isOpaqueInternalError ? defaultTitle : safeString(body.title, defaultTitle);
    const type = isOpaqueInternalError
      ? `https://leetkob.edu.vn/errors/${slug}`
      : safeString(body.type, `https://leetkob.edu.vn/errors/${slug}`);
    const fallback =
      status === 400
        ? 'Invalid JSON request body.'
        : status === 413
          ? 'Request body exceeds the 512 KB transport limit.'
          : defaultTitle;
    const detail = isOpaqueInternalError ? internalDetail : safeString(body.detail, fallback);
    const instance = request.originalUrl || request.url;

    const payload: Record<string, unknown> = {
      type,
      title,
      status,
      detail,
      instance,
    };

    if (!isOpaqueInternalError && Array.isArray(body.errors) && body.errors.length > 0) {
      payload.errors = body.errors;
    }

    if (isOpaqueInternalError) {
      const requestId = resolveRequestId(request);
      response.setHeader('X-Request-Id', requestId);
      const errMessage = exception instanceof Error ? exception.message : String(exception);
      const errStack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(
        `[requestId=${requestId}] ${request.method} ${instance} -> 500: ${errMessage}`,
        errStack,
      );
    }

    response.status(status).setHeader('Content-Type', 'application/problem+json').json(payload);
  }
}
