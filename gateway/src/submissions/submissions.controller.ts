import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  Body,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { SubmissionsService, TaReviewDecisionPayload } from './submissions.service';
import { ClassOwnershipGuard } from '../common/guards/class-ownership.guard';
import { JwtAuthGuard, JwtAuthenticatedRequest } from '../common/guards/jwt-auth.guard';
import { assertJsonContentType, problemException } from '../common/http-problems';
import { AuthenticatedRequest, EvidenceLine } from './submissions.types';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseTaReviewDecisionPayload(body: Record<string, unknown>): TaReviewDecisionPayload {
  if (!body || (body.decision !== 'PASS' && body.decision !== 'VIOLATION')) {
    throw problemException(
      HttpStatus.BAD_REQUEST,
      "Field 'decision' is required and must be 'PASS' or 'VIOLATION'.",
    );
  }

  let deduction: number | undefined;
  if (body.deduction !== undefined) {
    if (
      typeof body.deduction !== 'number' ||
      !Number.isFinite(body.deduction) ||
      body.deduction < 0 ||
      body.deduction > 10
    ) {
      throw problemException(
        HttpStatus.BAD_REQUEST,
        "Field 'deduction' must be a finite number between 0 and 10.",
      );
    }
    deduction = body.deduction;
  }

  let evidence: EvidenceLine[] | undefined;
  if (body.evidence !== undefined) {
    if (!Array.isArray(body.evidence)) {
      throw problemException(
        HttpStatus.BAD_REQUEST,
        "Field 'evidence' must be an array of { line, text } objects.",
      );
    }
    evidence = body.evidence.map((raw) => {
      const item = raw as Record<string, unknown>;
      if (
        !item ||
        typeof item.line !== 'number' ||
        !Number.isInteger(item.line) ||
        item.line < 1 ||
        typeof item.text !== 'string' ||
        item.text.trim().length === 0
      ) {
        throw problemException(
          HttpStatus.BAD_REQUEST,
          'Each evidence item must contain integer line >= 1 and non-empty text.',
        );
      }
      return { line: item.line, text: item.text };
    });
  }

  if (body.decision === 'VIOLATION' && (!evidence || evidence.length === 0)) {
    throw problemException(
      HttpStatus.BAD_REQUEST,
      'Selecting VIOLATION requires at least one evidence line (FAQ-09).',
    );
  }

  let reason: string | null | undefined;
  if (body.reason !== undefined && body.reason !== null) {
    if (typeof body.reason !== 'string') {
      throw problemException(HttpStatus.BAD_REQUEST, "Field 'reason' must be a string or null.");
    }
    reason = body.reason;
  } else if (body.reason === null) {
    reason = null;
  }

  return {
    decision: body.decision,
    deduction,
    evidence,
    reason,
  };
}

@Controller('labs')
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Post(':labId/submissions')
  @HttpCode(201)
  @UseGuards(ClassOwnershipGuard)
  async createSubmission(
    @Param('labId') labId: string,
    @Body() body: Record<string, unknown>,
    @Headers('idempotency-key') idempotencyKey: string,
    @Headers('content-type') contentType: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Validate Content-Type
    if (!contentType || contentType.split(';')[0].trim().toLowerCase() !== 'application/json') {
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

    const studentId = req.user.id;
    const result = await this.submissionsService.createSubmission(
      labId,
      studentId,
      body.code,
      idempotencyKey,
      req.receivedAt,
    );

    res.setHeader('Location', `/labs/${labId}/submissions/${result.id}`);
    res.setHeader('Idempotency-Key', idempotencyKey);

    return result;
  }

  @Get(':labId/submissions')
  @UseGuards(JwtAuthGuard)
  async listSubmissions(@Param('labId') labId: string, @Req() req: JwtAuthenticatedRequest) {
    return this.submissionsService.listSubmissionsForUser(labId, req.user.id, req.user.role);
  }

  @Get(':labId/review-queue')
  @UseGuards(JwtAuthGuard)
  async getReviewQueue(
    @Param('labId') labId: string,
    @Query('scope') rawScope: string | undefined,
    @Req() req: JwtAuthenticatedRequest,
  ) {
    if (rawScope !== undefined && rawScope !== 'counted' && rawScope !== 'all') {
      throw problemException(
        HttpStatus.BAD_REQUEST,
        "Query parameter 'scope' must be 'counted' or 'all'.",
      );
    }
    const scope = rawScope === 'all' ? 'all' : 'counted';
    return this.submissionsService.getReviewQueueForTa(labId, req.user.id, req.user.role, scope);
  }

  @Get(':labId/submissions/:submissionId/review')
  @UseGuards(JwtAuthGuard)
  async getSubmissionReview(
    @Param('labId') labId: string,
    @Param('submissionId') submissionId: string,
    @Req() req: JwtAuthenticatedRequest,
  ) {
    return this.submissionsService.getSubmissionReviewForTa(
      labId,
      submissionId,
      req.user.id,
      req.user.role,
    );
  }

  @Get(':labId/submissions/:submissionId')
  @UseGuards(JwtAuthGuard)
  async getSubmissionResult(
    @Param('labId') labId: string,
    @Param('submissionId') submissionId: string,
    @Req() req: JwtAuthenticatedRequest,
  ) {
    return this.submissionsService.getSubmissionResultForUser(
      labId,
      submissionId,
      req.user.id,
      req.user.role,
    );
  }

  @Patch(':labId/submissions/:submissionId/findings/:findingId')
  @UseGuards(JwtAuthGuard)
  async reviewFinding(
    @Param('labId') labId: string,
    @Param('submissionId') submissionId: string,
    @Param('findingId') findingId: string,
    @Body() body: Record<string, unknown>,
    @Headers('content-type') contentType: string | undefined,
    @Req() req: JwtAuthenticatedRequest,
  ) {
    assertJsonContentType(contentType);
    const payload = parseTaReviewDecisionPayload(body);
    return this.submissionsService.reviewFindingForTa(
      labId,
      submissionId,
      findingId,
      req.user.id,
      req.user.role,
      payload,
    );
  }

  @Post(':labId/publish')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async publishLab(@Param('labId') labId: string, @Req() req: JwtAuthenticatedRequest) {
    return this.submissionsService.publishLabForTa(labId, req.user.id, req.user.role);
  }
}
