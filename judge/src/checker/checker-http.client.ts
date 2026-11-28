import type {
  CheckerFinding,
  CheckerResult,
  JobConstraint,
  ModelCallLog,
  UnsureReason,
} from '../types';

export interface CheckerRequest {
  submissionId: string;
  statement: string;
  sourceCode: string;
  constraints: Array<{ id: string; text: string }>;
  studentIdentifiers: string[];
  costCapExceeded: boolean;
}

export interface CheckerClient {
  check(request: CheckerRequest): Promise<CheckerResult>;
}

const VALID_SOURCES = new Set(['HARD_RULE', 'LLM']);
const VALID_VERDICTS = new Set(['pass', 'violation', 'unsure']);
const VALID_UNSURE_REASONS = new Set<UnsureReason>([
  'MODEL_UNSURE',
  'SCHEMA_INVALID',
  'EVIDENCE_MISMATCH',
  'TIMEOUT',
  'COST_CAP_EXCEEDED',
  'MODEL_OFF',
  'PROVIDER_ERROR',
]);

function makeFallbackResult(
  request: CheckerRequest,
  reasonCode: UnsureReason,
  detail: string,
): CheckerResult {
  const results: CheckerFinding[] = request.constraints.map((c) => ({
    constraint: c.id,
    source: 'LLM',
    verdict: 'unsure',
    evidence: [],
    unsureReason: reasonCode,
    reason: detail,
  }));
  return {
    submissionId: request.submissionId,
    results,
    model: null,
    promptVersion: null,
    checkedAt: new Date().toISOString(),
    callLogs: [],
  };
}

function isValidFinding(item: unknown): item is CheckerFinding {
  if (!item || typeof item !== 'object') {
    return false;
  }
  const f = item as Record<string, unknown>;
  if (typeof f.constraint !== 'string' || f.constraint.trim() === '') {
    return false;
  }
  if (typeof f.source !== 'string' || !VALID_SOURCES.has(f.source)) {
    return false;
  }
  if (typeof f.verdict !== 'string' || !VALID_VERDICTS.has(f.verdict)) {
    return false;
  }
  if (!Array.isArray(f.evidence)) {
    return false;
  }
  if (f.verdict === 'violation' && f.evidence.length === 0) {
    return false;
  }
  if (f.verdict === 'unsure') {
    if (
      typeof f.unsureReason !== 'string' ||
      !VALID_UNSURE_REASONS.has(f.unsureReason as UnsureReason)
    ) {
      return false;
    }
  } else if (f.unsureReason !== null && f.unsureReason !== undefined) {
    return false;
  }
  return true;
}

function validateCheckerResponse(
  raw: unknown,
  expectedConstraints: ReadonlyArray<{ id: string }>,
): CheckerResult | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.submissionId !== 'string' || !Array.isArray(obj.results)) {
    return null;
  }
  const findings: CheckerFinding[] = [];
  for (const item of obj.results) {
    if (!isValidFinding(item)) {
      return null;
    }
    findings.push({
      constraint: item.constraint,
      source: item.source,
      verdict: item.verdict,
      evidence: item.evidence,
      unsureReason: item.verdict === 'unsure' ? item.unsureReason : null,
      reason: typeof item.reason === 'string' ? item.reason : null,
    });
  }
  const seenCodes = new Set(findings.map((f) => f.constraint));
  for (const expected of expectedConstraints) {
    if (!seenCodes.has(expected.id)) {
      return null;
    }
  }
  const callLogs: ModelCallLog[] = Array.isArray(obj.callLogs)
    ? (obj.callLogs as ModelCallLog[])
    : [];

  return {
    submissionId: obj.submissionId,
    results: findings,
    model: typeof obj.model === 'string' ? obj.model : null,
    promptVersion: typeof obj.promptVersion === 'string' ? obj.promptVersion : null,
    checkedAt: typeof obj.checkedAt === 'string' ? obj.checkedAt : new Date().toISOString(),
    callLogs,
  };
}

export function toCheckerConstraints(
  constraints: ReadonlyArray<JobConstraint>,
): Array<{ id: string; text: string }> {
  return constraints.map((c) => ({
    id: (c.code ?? c.id).trim(),
    text: c.text,
  }));
}

export interface HttpCheckerClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

/**
 * Calls the internal Python checker service over HTTP.
 * Any network error, HTTP failure, timeout, or schema mismatch degrades safely to `unsure`
 * with FAQ-09 UnsureReason codes so no Accepted submission is ever lost or mis-penalized.
 */
export class HttpCheckerClient implements CheckerClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: HttpCheckerClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 35_000;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async check(request: CheckerRequest): Promise<CheckerResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFn(`${this.baseUrl}/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        return makeFallbackResult(
          request,
          'PROVIDER_ERROR',
          `Internal checker service returned HTTP ${response.status}; routed to TA manual review.`,
        );
      }

      const parsed: unknown = await response.json();
      const validated = validateCheckerResponse(parsed, request.constraints);
      if (!validated) {
        return makeFallbackResult(
          request,
          'SCHEMA_INVALID',
          'Internal checker service returned an invalid payload; routed to TA manual review.',
        );
      }
      return validated;
    } catch (err) {
      const isAbort =
        err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
      if (isAbort) {
        return makeFallbackResult(
          request,
          'TIMEOUT',
          `Internal checker HTTP request exceeded ${this.timeoutMs}ms timeout; routed to TA manual review.`,
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      return makeFallbackResult(
        request,
        'PROVIDER_ERROR',
        `Internal checker request failed (${message}); routed to TA manual review.`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
