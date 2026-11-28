import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
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
import { parseCreateLabPayload } from '../labs/labs.controller';
import { ClassesService, CreateClassPayload } from './classes.service';

function parseCreateClassPayload(body: Record<string, unknown>): CreateClassPayload {
  const fieldErrors: ValidationFieldError[] = [];

  if (!body || typeof body.code !== 'string' || body.code.trim().length === 0) {
    fieldErrors.push({ field: 'code', message: "Field 'code' must be a non-empty string." });
  }
  if (!body || typeof body.name !== 'string' || body.name.trim().length === 0) {
    fieldErrors.push({ field: 'name', message: "Field 'name' must be a non-empty string." });
  }
  if (!body || typeof body.term !== 'string' || body.term.trim().length === 0) {
    fieldErrors.push({ field: 'term', message: "Field 'term' must be a non-empty string." });
  }

  let taIds: string[] = [];
  if (body && body.taIds !== undefined) {
    if (!Array.isArray(body.taIds) || !body.taIds.every((id) => typeof id === 'string')) {
      fieldErrors.push({
        field: 'taIds',
        message: 'Field taIds must be an array of strings.',
      });
    } else {
      taIds = body.taIds.map((id) => id.trim()).filter((id) => id.length > 0);
    }
  }

  if (fieldErrors.length > 0) {
    throw problemException(HttpStatus.BAD_REQUEST, fieldErrors[0].message, undefined, fieldErrors);
  }

  return {
    code: (body.code as string).trim(),
    name: (body.name as string).trim(),
    term: (body.term as string).trim(),
    taIds,
  };
}

@Controller('classes')
@UseGuards(JwtAuthGuard)
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @Get()
  async listClasses(
    @Req() req: JwtAuthenticatedRequest,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.classesService.listClasses(req.user.id, req.user.role, cursor, limit);
  }

  @Post()
  @HttpCode(201)
  async createClass(
    @Body() body: Record<string, unknown>,
    @Headers('content-type') contentType: string | undefined,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Req() req: JwtAuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (req.user.role !== 'ADMIN') {
      throw problemException(HttpStatus.FORBIDDEN, 'Only ADMIN users may create classes (FAQ-01).');
    }
    assertJsonContentType(contentType);
    const idempotencyKey = parseOptionalIdempotencyKey(rawIdempotencyKey);
    const input = parseCreateClassPayload(body);
    const created = await this.classesService.createClass(
      req.user.id,
      req.user.role,
      input,
      idempotencyKey,
    );
    res.setHeader('Location', `/classes/${created.id}`);
    if (idempotencyKey) {
      res.setHeader('Idempotency-Key', idempotencyKey);
    }
    return created;
  }

  @Get(':classId/labs')
  async listClassLabs(
    @Param('classId') classId: string,
    @Req() req: JwtAuthenticatedRequest,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.classesService.listClassLabs(classId, req.user.id, req.user.role, cursor, limit);
  }

  @Post(':classId/labs')
  @HttpCode(201)
  async createClassLab(
    @Param('classId') classId: string,
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
    const input = parseCreateLabPayload(body, classId);
    const created = await this.classesService.createClassLab(
      classId,
      req.user.id,
      req.user.role,
      input,
      idempotencyKey,
    );
    res.setHeader('Location', `/labs/${created.id}`);
    if (idempotencyKey) {
      res.setHeader('Idempotency-Key', idempotencyKey);
    }
    return created;
  }
}
