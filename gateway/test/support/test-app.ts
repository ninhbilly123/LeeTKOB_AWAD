import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { configureApplication } from '../../src/configure-app';
import { JWT_VERIFICATION_SECRET } from '../../src/common/auth.constants';
import { SubmissionStore } from '../../src/submissions/submissions.store';
import { UserRole } from '../../src/submissions/submissions.types';
import { submissionStore } from './submissions.fixtures';

const testSecret = randomBytes(32).toString('hex');
export function bearerFor(
  id = 'std_23120244',
  role: UserRole = 'STUDENT',
  options: JwtSignOptions = {},
): string {
  const token = new JwtService().sign(
    { sub: id, role },
    { secret: testSecret, algorithm: 'HS256', expiresIn: '7d', ...options },
  );
  return `Bearer ${token}`;
}

export async function createTestApp(): Promise<NestExpressApplication> {
  submissionStore.reset();
  const fixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(JWT_VERIFICATION_SECRET)
    .useValue(testSecret)
    .overrideProvider(SubmissionStore)
    .useValue(submissionStore)
    .compile();
  const app = fixture.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApplication(app);
  await app.init();
  return app;
}
