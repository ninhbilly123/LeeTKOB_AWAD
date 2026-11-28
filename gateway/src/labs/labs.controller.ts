import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard, JwtAuthenticatedRequest } from '../common/guards/jwt-auth.guard';
import { assertJsonContentType, problemException } from '../common/http-problems';
import { LabConstraint, LabTestCase } from '../submissions/submissions.types';
import { CreateLabInput } from './dto/create-lab.dto';
import { LabsService } from './labs.service';

function isNonEmptyString(val: unknown): val is string {
  return typeof val === 'string' && val.trim().length > 0;
}

export function parseCreateLabPayload(
  body: Record<string, unknown>,
  overrideClassId?: string,
): CreateLabInput {
  const effectiveClassId = overrideClassId ?? body?.classId;
  if (!body || !isNonEmptyString(effectiveClassId) || !isNonEmptyString(body.title)) {
    throw problemException(HttpStatus.BAD_REQUEST, 'Fields classId and title are required.');
  }
  if (!isNonEmptyString(body.statement)) {
    throw problemException(HttpStatus.BAD_REQUEST, 'Field statement must be a non-empty string.');
  }
  if (typeof body.deadline !== 'string' || Number.isNaN(Date.parse(body.deadline))) {
    throw problemException(
      HttpStatus.BAD_REQUEST,
      'Field deadline must be a valid ISO 8601 date string.',
    );
  }
  if (!Array.isArray(body.testCases) || body.testCases.length === 0) {
    throw problemException(
      HttpStatus.BAD_REQUEST,
      'Field testCases must be a non-empty array of test cases.',
    );
  }
  const testCases: LabTestCase[] = body.testCases.map((raw) => {
    const tc = raw as Record<string, unknown>;
    if (
      !tc ||
      !isNonEmptyString(tc.id) ||
      typeof tc.input !== 'string' ||
      typeof tc.expectedOutput !== 'string'
    ) {
      throw problemException(
        HttpStatus.BAD_REQUEST,
        'Each testCase must include id, input, and expectedOutput strings.',
      );
    }
    return {
      id: tc.id.trim(),
      input: tc.input,
      expectedOutput: tc.expectedOutput,
      isHidden: Boolean(tc.isHidden),
    };
  });

  if (!Array.isArray(body.constraints) || body.constraints.length === 0) {
    throw problemException(
      HttpStatus.BAD_REQUEST,
      'Field constraints must be a non-empty array of grading constraints.',
    );
  }
  const constraints: LabConstraint[] = body.constraints.map((raw) => {
    const item = raw as Record<string, unknown>;
    if (
      !item ||
      !isNonEmptyString(item.id) ||
      !isNonEmptyString(item.text) ||
      typeof item.deduction !== 'number' ||
      !Number.isFinite(item.deduction) ||
      item.deduction < 0 ||
      item.deduction > 10
    ) {
      throw problemException(
        HttpStatus.BAD_REQUEST,
        'Each constraint must include id, text, and deduction in [0, 10].',
      );
    }
    return {
      id: item.id.trim(),
      text: item.text.trim(),
      deduction: item.deduction,
    };
  });

  let openedAt: string | undefined;
  if (body.openedAt !== undefined) {
    if (typeof body.openedAt !== 'string' || Number.isNaN(Date.parse(body.openedAt))) {
      throw problemException(
        HttpStatus.BAD_REQUEST,
        'Field openedAt must be a valid ISO 8601 date string.',
      );
    }
    if (Date.parse(body.deadline) <= Date.parse(body.openedAt)) {
      throw problemException(HttpStatus.BAD_REQUEST, 'Field deadline must be after openedAt.');
    }
    openedAt = body.openedAt;
  }

  let cpuTimeLimitSec: number | undefined;
  if (body.cpuTimeLimitSec !== undefined) {
    if (
      typeof body.cpuTimeLimitSec !== 'number' ||
      !Number.isInteger(body.cpuTimeLimitSec) ||
      body.cpuTimeLimitSec < 1 ||
      body.cpuTimeLimitSec > 5
    ) {
      throw problemException(
        HttpStatus.BAD_REQUEST,
        'Field cpuTimeLimitSec must be an integer between 1 and 5 (FAQ-05).',
      );
    }
    cpuTimeLimitSec = body.cpuTimeLimitSec;
  }

  let memoryLimitMb: number | undefined;
  if (body.memoryLimitMb !== undefined) {
    if (
      typeof body.memoryLimitMb !== 'number' ||
      !Number.isInteger(body.memoryLimitMb) ||
      body.memoryLimitMb < 64 ||
      body.memoryLimitMb > 512
    ) {
      throw problemException(
        HttpStatus.BAD_REQUEST,
        'Field memoryLimitMb must be an integer between 64 and 512 (FAQ-05).',
      );
    }
    memoryLimitMb = body.memoryLimitMb;
  }

  return {
    classId: effectiveClassId.trim(),
    title: body.title.trim(),
    statement: body.statement,
    openedAt,
    deadline: body.deadline,
    cpuTimeLimitSec,
    memoryLimitMb,
    testCases,
    constraints,
  };
}

@Controller('labs')
@UseGuards(JwtAuthGuard)
export class LabsController {
  constructor(private readonly labsService: LabsService) {}

  @Post()
  @HttpCode(201)
  async createLab(
    @Body() body: Record<string, unknown>,
    @Headers('content-type') contentType: string | undefined,
    @Req() req: JwtAuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (req.user.role !== 'TA') {
      throw problemException(HttpStatus.FORBIDDEN, 'Only TAs may create labs.');
    }
    assertJsonContentType(contentType);
    const input = parseCreateLabPayload(body);
    const created = await this.labsService.createLab(req.user.id, input);
    res.setHeader('Location', `/labs/${created.id}`);
    return created;
  }

  @Get()
  async listLabs(@Req() req: JwtAuthenticatedRequest) {
    return { labs: await this.labsService.listLabs(req.user.id, req.user.role) };
  }

  @Get(':labId')
  async getLab(@Param('labId') labId: string, @Req() req: JwtAuthenticatedRequest) {
    return this.labsService.getLabForUser(labId, req.user.id, req.user.role);
  }
}
