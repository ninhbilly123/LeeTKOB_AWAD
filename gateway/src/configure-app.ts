import { NestExpressApplication } from '@nestjs/platform-express';
import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './submissions/submissions.types';

/** Share the same parser and receipt timestamp between HTTP tests and production. */
export function configureApplication(app: NestExpressApplication): void {
  app.use((request: AuthenticatedRequest, _response: Response, next: NextFunction) => {
    request.receivedAt = Date.now();
    next();
  });
  // JSON escaping can expand a valid 64 KiB code string to six times its byte size.
  app.useBodyParser('json', { limit: '512kb' });
}
