import { Module } from '@nestjs/common';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';
import { ClassOwnershipGuard } from '../common/guards/class-ownership.guard';

@Module({
  controllers: [SubmissionsController],
  providers: [SubmissionsService, ClassOwnershipGuard],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
