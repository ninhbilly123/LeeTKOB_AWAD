import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JWT_VERIFICATION_SECRET, jwtVerificationSecret } from './auth.constants';
import { PostgresPersistence } from '../persistence/postgres.store';
import { AuthStore } from '../auth/auth.store';
import { LabsStore } from '../labs/labs.store';
import { SubmissionStore } from '../submissions/submissions.store';

@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [
    {
      provide: PostgresPersistence,
      useFactory: () => {
        const isJest = Boolean(process.env.JEST_WORKER_ID);
        return new PostgresPersistence(isJest ? undefined : process.env.DATABASE_URL);
      },
    },
    AuthStore,
    LabsStore,
    SubmissionStore,
    { provide: JWT_VERIFICATION_SECRET, useFactory: jwtVerificationSecret },
  ],
  exports: [
    JwtModule,
    PostgresPersistence,
    AuthStore,
    LabsStore,
    SubmissionStore,
    JWT_VERIFICATION_SECRET,
  ],
})
export class CoreModule {}
