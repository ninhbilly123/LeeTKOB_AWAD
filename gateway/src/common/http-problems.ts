import { HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '../submissions/submissions.types';

const STATUS_META: Record<number, { title: string; slug: string }> = {
  400: { title: 'Bad Request', slug: 'bad-request' },
  401: { title: 'Unauthorized', slug: 'unauthorized' },
  403: { title: 'Forbidden', slug: 'forbidden' },
  404: { title: 'Not Found', slug: 'not-found' },
  409: { title: 'Conflict', slug: 'conflict' },
  413: { title: 'Payload Too Large', slug: 'payload-too-large' },
  415: { title: 'Unsupported Media Type', slug: 'unsupported-media-type' },
  500: { title: 'Internal Server Error', slug: 'internal-server-error' },
};

export function problemException(
  status: number,
  detail: string,
  slugOverride?: string,
): HttpException {
  const meta = STATUS_META[status] ?? STATUS_META[500];
  const slug = slugOverride ?? meta.slug;
  return new HttpException(
    {
      type: `https://leetkob.edu.vn/errors/${slug}`,
      title: meta.title,
      status,
      detail,
    },
    status,
  );
}

export function assertJsonContentType(contentType: string | undefined): void {
  if (!contentType || contentType.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw problemException(
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      'Requests must use Content-Type: application/json.',
    );
  }
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
