import { Module } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { LabsController } from './labs.controller';
import { LabsService } from './labs.service';

@Module({
  controllers: [LabsController],
  providers: [LabsService, JwtAuthGuard],
  exports: [LabsService],
})
export class LabsModule {}
