import { HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '../submissions/submissions.types';

export interface ValidationFieldError {
  field: string;
  message: string;
}

export const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STATUS_META: Record<number, { title: string; slug: string }> = {
  400: { title: 'Bad Request', slug: 'bad-request' },
  401: { title: 'Unauthorized', slug: 'unauthorized' },
  403: { title: 'Forbidden', slug: 'forbidden' },
  404: { title: 'Not Found', slug: 'not-found' },
  409: { title: 'Conflict', slug: 'conflict' },
  413: { title: 'Payload Too Large', slug: 'payload-too-large' },
  415: { title: 'Unsupported Media Type', slug: 'unsupported-media-type' },
  500: { title: 'Internal Server Error', slug: 'internal-server-error' },
  503: { title: 'Service Unavailable', slug: 'service-unavailable' },
};

export function problemException(
  status: number,
  detail: string,
  slugOverride?: string,
  errors?: ValidationFieldError[],
): HttpException {
  const meta = STATUS_META[status] ?? STATUS_META[500];
  const slug = slugOverride ?? meta.slug;
  const payload: Record<string, unknown> = {
    type: `https://leetkob.edu.vn/errors/${slug}`,
    title: meta.title,
    status,
    detail,
  };
  if (errors && errors.length > 0) {
    payload.errors = errors;
  }
  return new HttpException(payload, status);
}

export function assertJsonContentType(contentType: string | undefined): void {
  if (!contentType || contentType.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw problemException(
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      'Requests must use Content-Type: application/json.',
    );
  }
}

export function parseOptionalIdempotencyKey(rawKey: string | undefined): string | undefined {
  if (rawKey === undefined) {
    return undefined;
  }
  const trimmed = rawKey.trim();
  if (!UUID_V4_REGEX.test(trimmed)) {
    throw problemException(
      HttpStatus.BAD_REQUEST,
      "Header 'Idempotency-Key' must be a valid UUID v4 when provided.",
      undefined,
      [
        {
          field: 'Idempotency-Key',
          message: "Header 'Idempotency-Key' must be a valid UUID v4 when provided.",
        },
      ],
    );
  }
  return trimmed;
}

export interface VerifiedJwtUser {
  id: string;
  role: UserRole;
  classIds: string[];
}

export function verifyBearerClaims(
  authorization: string | undefined,
  jwt: JwtService,
  secret: string,
): VerifiedJwtUser {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization || '');
  try {
    if (!match) {
      throw new Error('Missing bearer token');
    }
    const claims = jwt.verify<Record<string, unknown>>(match[1], {
      secret,
      algorithms: ['HS256'],
    });
    if (
      typeof claims.sub !== 'string' ||
      !claims.sub.trim() ||
      typeof claims.exp !== 'number' ||
      !['STUDENT', 'TA', 'ADMIN'].includes(String(claims.role))
    ) {
      throw new Error('Invalid token claims');
    }
    const classIds = Array.isArray(claims.classIds)
      ? claims.classIds.filter((item): item is string => typeof item === 'string')
      : [];
    return {
      id: claims.sub,
      role: claims.role as UserRole,
      classIds,
    };
  } catch {
    throw problemException(
      HttpStatus.UNAUTHORIZED,
      'Authentication token is missing, invalid, or has expired.',
    );
  }
}
