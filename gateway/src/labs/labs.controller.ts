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
import {
  assertJsonContentType,
  parseOptionalIdempotencyKey,
  problemException,
  ValidationFieldError,
} from '../common/http-problems';
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
  const fieldErrors: ValidationFieldError[] = [];
  const effectiveClassId = overrideClassId ?? body?.classId;

  if (!isNonEmptyString(effectiveClassId)) {
    fieldErrors.push({ field: 'classId', message: "Field 'classId' is required." });
  }
  if (!body || !isNonEmptyString(body.title)) {
    fieldErrors.push({ field: 'title', message: "Field 'title' is required." });
  }
  if (!body || !isNonEmptyString(body.statement)) {
    fieldErrors.push({
      field: 'statement',
      message: 'Field statement must be a non-empty string.',
    });
  }

  const hasValidDeadline =
    Boolean(body) && typeof body.deadline === 'string' && !Number.isNaN(Date.parse(body.deadline));
  if (!hasValidDeadline) {
    fieldErrors.push({
      field: 'deadline',
      message: 'Field deadline must be a valid ISO 8601 date string.',
    });
  }

  const testCases: LabTestCase[] = [];
  if (!body || !Array.isArray(body.testCases) || body.testCases.length === 0) {
    fieldErrors.push({
      field: 'testCases',
      message: 'Field testCases must be a non-empty array of test cases.',
    });
  } else {
    body.testCases.forEach((raw, idx) => {
      const tc = raw as Record<string, unknown>;
      if (
        !tc ||
        !isNonEmptyString(tc.id) ||
        typeof tc.input !== 'string' ||
        typeof tc.expectedOutput !== 'string'
      ) {
        fieldErrors.push({
          field: `testCases[${idx}]`,
          message: 'Each testCase must include id, input, and expectedOutput strings.',
        });
      } else {
        testCases.push({
          id: tc.id.trim(),
          input: tc.input,
          expectedOutput: tc.expectedOutput,
          isHidden: Boolean(tc.isHidden),
        });
      }
    });
  }

  const constraints: LabConstraint[] = [];
  if (!body || !Array.isArray(body.constraints) || body.constraints.length === 0) {
    fieldErrors.push({
      field: 'constraints',
      message: 'Field constraints must be a non-empty array of grading constraints.',
    });
  } else {
    body.constraints.forEach((raw, idx) => {
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
        fieldErrors.push({
          field: `constraints[${idx}]`,
          message: 'Each constraint must include id, text, and deduction in [0, 10].',
        });
      } else {
        constraints.push({
          id: item.id.trim(),
          text: item.text.trim(),
          deduction: item.deduction,
        });
      }
    });
  }

  let openedAt: string | undefined;
  if (body && body.openedAt !== undefined) {
    if (typeof body.openedAt !== 'string' || Number.isNaN(Date.parse(body.openedAt))) {
      fieldErrors.push({
        field: 'openedAt',
        message: 'Field openedAt must be a valid ISO 8601 date string.',
      });
    } else if (
      hasValidDeadline &&
      Date.parse(body.deadline as string) <= Date.parse(body.openedAt)
    ) {
      fieldErrors.push({
        field: 'deadline',
        message: 'Field deadline must be after openedAt.',
      });
    } else {
      openedAt = body.openedAt;
    }
  }

  let cpuTimeLimitSec: number | undefined;
  if (body && body.cpuTimeLimitSec !== undefined) {
    if (
      typeof body.cpuTimeLimitSec !== 'number' ||
      !Number.isInteger(body.cpuTimeLimitSec) ||
      body.cpuTimeLimitSec < 1 ||
      body.cpuTimeLimitSec > 5
    ) {
      fieldErrors.push({
        field: 'cpuTimeLimitSec',
        message: 'Field cpuTimeLimitSec must be an integer between 1 and 5 (FAQ-05).',
      });
    } else {
      cpuTimeLimitSec = body.cpuTimeLimitSec;
    }
  }

  let memoryLimitMb: number | undefined;
  if (body && body.memoryLimitMb !== undefined) {
    if (
      typeof body.memoryLimitMb !== 'number' ||
      !Number.isInteger(body.memoryLimitMb) ||
      body.memoryLimitMb < 64 ||
      body.memoryLimitMb > 512
    ) {
      fieldErrors.push({
        field: 'memoryLimitMb',
        message: 'Field memoryLimitMb must be an integer between 64 and 512 (FAQ-05).',
      });
    } else {
      memoryLimitMb = body.memoryLimitMb;
    }
  }

  if (fieldErrors.length > 0) {
    throw problemException(HttpStatus.BAD_REQUEST, fieldErrors[0].message, undefined, fieldErrors);
  }

  return {
    classId: (effectiveClassId as string).trim(),
    title: (body.title as string).trim(),
    statement: body.statement as string,
    openedAt,
    deadline: body.deadline as string,
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
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Req() req: JwtAuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (req.user.role !== 'TA') {
      throw problemException(HttpStatus.FORBIDDEN, 'Only TAs may create labs.');
    }
    assertJsonContentType(contentType);
    const idempotencyKey = parseOptionalIdempotencyKey(rawIdempotencyKey);
    const input = parseCreateLabPayload(body);
    const created = await this.labsService.createLab(req.user.id, input, idempotencyKey);
    res.setHeader('Location', `/labs/${created.id}`);
    if (idempotencyKey) {
      res.setHeader('Idempotency-Key', idempotencyKey);
    }
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
