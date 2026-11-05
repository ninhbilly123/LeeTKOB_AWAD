import {
  Controller,
  Post,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { SubmissionsService } from './submissions.service';
import { ClassOwnershipGuard } from '../common/guards/class-ownership.guard';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller('labs')
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Post(':labId/submissions')
  @HttpCode(201)
  @UseGuards(ClassOwnershipGuard)
  @UseInterceptors(IdempotencyInterceptor)
  createSubmission(
    @Param('labId') labId: string,
    @Body() body: Record<string, any>,
    @Headers('idempotency-key') idempotencyKey: string,
    @Headers('content-type') contentType: string,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Validate Content-Type
    if (!contentType || !contentType.toLowerCase().includes('application/json')) {
      throw new HttpException(
        {
          type: 'https://leetkob.edu.vn/errors/unsupported-media-type',
          title: 'Unsupported Media Type',
          status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
          detail: 'Requests must use Content-Type: application/json.',
        },
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }

    // Validate Idempotency-Key header presence and UUID v4 format
    if (!idempotencyKey || !UUID_V4_REGEX.test(idempotencyKey)) {
      throw new HttpException(
        {
          type: 'https://leetkob.edu.vn/errors/bad-request',
          title: 'Bad Request',
          status: HttpStatus.BAD_REQUEST,
          detail: "Header 'Idempotency-Key' is required and must be a valid UUID v4.",
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate body.code
    if (!body || typeof body.code !== 'string' || body.code.trim().length === 0) {
      throw new HttpException(
        {
          type: 'https://leetkob.edu.vn/errors/bad-request',
          title: 'Bad Request',
          status: HttpStatus.BAD_REQUEST,
          detail: 'Source code cannot be empty or whitespace-only.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const codeByteLength = Buffer.byteLength(body.code, 'utf8');
    if (codeByteLength > 65536) {
      throw new HttpException(
        {
          type: 'https://leetkob.edu.vn/errors/bad-request',
          title: 'Bad Request',
          status: HttpStatus.BAD_REQUEST,
          detail: `Source code exceeds the 64 KB limit (current: ${codeByteLength} bytes).`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const studentId = req.user?.id || 'std_23120244';
    const result = this.submissionsService.createSubmission(
      labId,
      studentId,
      body.code,
      idempotencyKey,
    );

    res.setHeader('Location', `/labs/${labId}/submissions/${result.id}`);
    res.setHeader('Idempotency-Key', idempotencyKey);

    return result;
  }
}
