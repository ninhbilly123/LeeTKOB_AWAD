import { NestExpressApplication } from '@nestjs/platform-express';
import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './submissions/submissions.types';

/** Share the same parser, CORS policy, and receipt timestamp between HTTP tests and production. */
export function configureApplication(app: NestExpressApplication): void {
  const configuredOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (configuredOrigins.length > 0) {
    app.enableCors({
      origin: configuredOrigins,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
      exposedHeaders: ['Location', 'Idempotency-Key'],
    });
  } else if (process.env.NODE_ENV !== 'production') {
    app.enableCors({
      origin: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
      exposedHeaders: ['Location', 'Idempotency-Key'],
    });
  }

  app.use((request: AuthenticatedRequest, _response: Response, next: NextFunction) => {
    request.receivedAt = Date.now();
    next();
  });
  // JSON escaping can expand a valid 64 KiB code string to six times its byte size.
  app.useBodyParser('json', { limit: '512kb' });
}
