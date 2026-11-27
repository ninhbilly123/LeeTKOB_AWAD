import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JWT_VERIFICATION_SECRET, jwtVerificationSecret } from './auth.constants';
import { loadGatewayConfig } from './config';
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
        const config = loadGatewayConfig();
        return new PostgresPersistence(
          config.persistenceMode === 'postgres' ? config.databaseUrl : undefined,
          undefined,
          config.dbPool,
        );
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
