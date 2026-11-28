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
import { assertJsonContentType, problemException } from '../common/http-problems';
import { parseCreateLabPayload } from '../labs/labs.controller';
import { ClassesService, CreateClassPayload } from './classes.service';

function parseCreateClassPayload(body: Record<string, unknown>): CreateClassPayload {
  if (
    !body ||
    typeof body.code !== 'string' ||
    body.code.trim().length === 0 ||
    typeof body.name !== 'string' ||
    body.name.trim().length === 0 ||
    typeof body.term !== 'string' ||
    body.term.trim().length === 0
  ) {
    throw problemException(
      HttpStatus.BAD_REQUEST,
      'Fields code, name, and term must be non-empty strings.',
    );
  }

  let taIds: string[] = [];
  if (body.taIds !== undefined) {
    if (!Array.isArray(body.taIds) || !body.taIds.every((id) => typeof id === 'string')) {
      throw problemException(HttpStatus.BAD_REQUEST, 'Field taIds must be an array of strings.');
    }
    taIds = body.taIds.map((id) => id.trim()).filter((id) => id.length > 0);
  }

  return {
    code: body.code.trim(),
    name: body.name.trim(),
    term: body.term.trim(),
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
    @Req() req: JwtAuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (req.user.role !== 'ADMIN') {
      throw problemException(HttpStatus.FORBIDDEN, 'Only ADMIN users may create classes (FAQ-01).');
    }
    assertJsonContentType(contentType);
    const input = parseCreateClassPayload(body);
    const created = await this.classesService.createClass(req.user.id, req.user.role, input);
    res.setHeader('Location', `/classes/${created.id}`);
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
    @Req() req: JwtAuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (req.user.role !== 'TA') {
      throw problemException(HttpStatus.FORBIDDEN, 'Only TAs may create labs.');
    }
    assertJsonContentType(contentType);
    const input = parseCreateLabPayload(body, classId);
    const created = await this.classesService.createClassLab(
      classId,
      req.user.id,
      req.user.role,
      input,
    );
    res.setHeader('Location', `/labs/${created.id}`);
    return created;
  }
}
