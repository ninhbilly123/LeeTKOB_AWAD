import { Module } from '@nestjs/common';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';
import { ClassOwnershipGuard } from '../common/guards/class-ownership.guard';
import { JwtModule } from '@nestjs/jwt';
import { JWT_VERIFICATION_SECRET, jwtVerificationSecret } from '../common/auth.constants';
import { SubmissionStore } from './submissions.store';

@Module({
  imports: [JwtModule.register({})],
  controllers: [SubmissionsController],
  providers: [
    SubmissionsService,
    ClassOwnershipGuard,
    SubmissionStore,
    { provide: JWT_VERIFICATION_SECRET, useFactory: jwtVerificationSecret },
  ],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
