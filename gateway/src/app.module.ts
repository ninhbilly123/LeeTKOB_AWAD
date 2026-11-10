import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SubmissionsModule } from './submissions/submissions.module';
import { Rfc9457ExceptionFilter } from './common/filters/rfc9457-exception.filter';

@Module({
  imports: [SubmissionsModule],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: Rfc9457ExceptionFilter,
    },
  ],
})
export class AppModule {}
