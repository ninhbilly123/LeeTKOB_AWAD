import { NestExpressApplication } from '@nestjs/platform-express';
import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './submissions/submissions.types';

/** Share the same parser, CORS policy, /v1 alias, and receipt timestamp between HTTP tests and production. */
export function configureApplication(app: NestExpressApplication): void {
  const configuredOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (configuredOrigins.length > 0) {
    app.enableCors({
      origin: configuredOrigins,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
      exposedHeaders: ['Location', 'Idempotency-Key', 'X-Request-Id'],
    });
  } else if (process.env.NODE_ENV !== 'production') {
    app.enableCors({
      origin: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
      exposedHeaders: ['Location', 'Idempotency-Key', 'X-Request-Id'],
    });
  }

  app.use((request: AuthenticatedRequest, _response: Response, next: NextFunction) => {
    request.receivedAt = Date.now();
    // Path-versioned /v1/* alias (docs/engineering-rules.md §3) preserving request.originalUrl
    // so RFC 9457 `instance` reflects the exact path requested by the caller.
    if (request.url === '/v1' || request.url.startsWith('/v1/') || request.url.startsWith('/v1?')) {
      request.url = request.url.slice(3) || '/';
    }
    next();
  });
  // JSON escaping can expand a valid 64 KiB code string to six times its byte size.
  app.useBodyParser('json', { limit: '512kb' });
}
