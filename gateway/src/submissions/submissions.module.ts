import { Module } from '@nestjs/common';
import { SubmissionLookupController, SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';
import { ClassOwnershipGuard } from '../common/guards/class-ownership.guard';

@Module({
  controllers: [SubmissionsController, SubmissionLookupController],
  providers: [SubmissionsService, ClassOwnershipGuard],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
