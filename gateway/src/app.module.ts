import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CoreModule } from './common/core.module';
import { AuthModule } from './auth/auth.module';
import { ClassesModule } from './classes/classes.module';
import { LabsModule } from './labs/labs.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { Rfc9457ExceptionFilter } from './common/filters/rfc9457-exception.filter';

@Module({
  imports: [CoreModule, AuthModule, ClassesModule, LabsModule, SubmissionsModule],
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
