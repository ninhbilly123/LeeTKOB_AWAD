import { Module } from '@nestjs/common';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';
import { ClassOwnershipGuard } from '../common/guards/class-ownership.guard';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';

@Module({
  controllers: [SubmissionsController],
  providers: [SubmissionsService, ClassOwnershipGuard, IdempotencyInterceptor],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
