import { HttpStatus } from '@nestjs/common';
import { problemException } from './http-problems';

export interface KeysetCursor {
  /** Endpoint + filter scope binding (prevents replaying cursors across endpoints/filters). */
  s: string;
  /** Primary ISO 8601 UTC timestamp sort key. */
  t: string;
  /** Unique secondary tie-breaker ID. */
  id: string;
  /** Optional tertiary sort key (e.g. constraintCode ASC for review queue). */
  k?: string;
}

export interface ParsedKeysetPagination {
  cursor: KeysetCursor | null;
  limit: number;
}

export function encodeKeysetCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function parseKeysetPagination(
  rawCursor: string | undefined,
  rawLimit: string | undefined,
  expectedScope: string,
  options: { defaultLimit?: number; maxLimit?: number; requireSecondaryKey?: boolean } = {},
): ParsedKeysetPagination {
  const defaultLimit = options.defaultLimit ?? 20;
  const maxLimit = options.maxLimit ?? 100;

  let limit = defaultLimit;
  if (rawLimit !== undefined && rawLimit.trim() !== '') {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxLimit) {
      throw problemException(
        HttpStatus.BAD_REQUEST,
        `Query parameter 'limit' must be an integer between 1 and ${maxLimit}.`,
      );
    }
    limit = parsed;
  }

  let cursor: KeysetCursor | null = null;
  if (rawCursor !== undefined && rawCursor.trim() !== '') {
    try {
      const json = Buffer.from(rawCursor, 'base64url').toString('utf8');
      const parsed = JSON.parse(json) as Partial<KeysetCursor>;
      if (
        !parsed ||
        typeof parsed.s !== 'string' ||
        parsed.s !== expectedScope ||
        typeof parsed.t !== 'string' ||
        parsed.t.trim().length === 0 ||
        Number.isNaN(Date.parse(parsed.t)) ||
        typeof parsed.id !== 'string' ||
        parsed.id.trim().length === 0 ||
        (options.requireSecondaryKey &&
          (typeof parsed.k !== 'string' || parsed.k.trim().length === 0)) ||
        (!options.requireSecondaryKey && parsed.k !== undefined)
      ) {
        throw new Error('Invalid keyset cursor');
      }
      cursor = {
        s: parsed.s,
        t: parsed.t,
        id: parsed.id,
        ...(parsed.k !== undefined ? { k: parsed.k } : {}),
      };
    } catch {
      throw problemException(
        HttpStatus.BAD_REQUEST,
        "Query parameter 'cursor' is malformed or does not match this endpoint scope.",
      );
    }
  }

  return { cursor, limit };
}

export function compareStringsCodePoint(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Descending comparison on (timestamp DESC, id DESC) matching PostgreSQL ORDER BY ts DESC, id DESC. */
export function compareDescTimestampId(
  aTime: string,
  aId: string,
  bTime: string,
  bId: string,
): number {
  const diff = Date.parse(bTime) - Date.parse(aTime);
  if (diff !== 0 && !Number.isNaN(diff)) {
    return diff;
  }
  const timeCmp = compareStringsCodePoint(bTime, aTime);
  if (timeCmp !== 0) {
    return timeCmp;
  }
  return compareStringsCodePoint(bId, aId);
}

/** Returns true iff (itemTime, itemId) comes strictly AFTER cursor in (ts DESC, id DESC) order. */
export function isAfterDescKeyset(itemTime: string, itemId: string, cursor: KeysetCursor): boolean {
  const itemMs = Date.parse(itemTime);
  const cursorMs = Date.parse(cursor.t);
  if (!Number.isNaN(itemMs) && !Number.isNaN(cursorMs) && itemMs !== cursorMs) {
    return itemMs < cursorMs;
  }
  if (itemTime !== cursor.t) {
    return compareStringsCodePoint(itemTime, cursor.t) < 0;
  }
  return compareStringsCodePoint(itemId, cursor.id) < 0;
}

/**
 * Returns true iff (submittedAt, submissionId, constraintCode) comes strictly AFTER cursor in
 * (submittedAt DESC, submissionId DESC, constraintCode ASC) order.
 */
export function isAfterReviewQueueKeyset(
  submittedAt: string,
  submissionId: string,
  constraintCode: string,
  cursor: KeysetCursor,
): boolean {
  const itemMs = Date.parse(submittedAt);
  const cursorMs = Date.parse(cursor.t);
  if (!Number.isNaN(itemMs) && !Number.isNaN(cursorMs) && itemMs !== cursorMs) {
    return itemMs < cursorMs;
  }
  if (submittedAt !== cursor.t) {
    return compareStringsCodePoint(submittedAt, cursor.t) < 0;
  }
  if (submissionId !== cursor.id) {
    return compareStringsCodePoint(submissionId, cursor.id) < 0;
  }
  return compareStringsCodePoint(constraintCode, cursor.k ?? '') > 0;
}
