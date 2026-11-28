import { HttpCheckerClient, type CheckerRequest } from '../src/checker/checker-http.client';

const SAMPLE_REQUEST: CheckerRequest = {
  submissionId: 'sub_100',
  statement: '# Merge Sort',
  sourceCode: 'int main() { return 0; }\n',
  constraints: [
    { id: 'C1', text: 'Do not call `std::sort`.' },
    { id: 'C2', text: 'Implement merge sort yourself.' },
  ],
  studentIdentifiers: ['std_23120244', 'student1'],
  costCapExceeded: false,
};

describe('HttpCheckerClient (Internal Checker Bridge & FAQ-09 Guardrails)', () => {
  it('posts JSON to /check and returns validated CheckerResult', async () => {
    const mockFetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        submissionId: 'sub_100',
        results: [
          {
            constraint: 'C1',
            source: 'HARD_RULE',
            verdict: 'pass',
            evidence: [],
            unsureReason: null,
            reason: null,
          },
          {
            constraint: 'C2',
            source: 'LLM',
            verdict: 'violation',
            evidence: [{ line: 1, text: 'int main() { return 0; }' }],
            unsureReason: null,
            reason: 'Does not implement merge sort.',
          },
        ],
        model: 'gemini-3.1-flash-lite-preview',
        promptVersion: 'v1',
        checkedAt: '2026-11-28T00:00:00.000Z',
        callLogs: [
          {
            requestId: 'req_xyz',
            model: 'gemini-3.1-flash-lite-preview',
            constraints: ['C2'],
            sanitizedPrompt: '...',
            inputTokens: 100,
            outputTokens: 30,
            latencyMs: 250,
            estimatedCostUsd: 0.0001,
            status: 'OK',
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const client = new HttpCheckerClient({
      baseUrl: 'http://checker:8000',
      timeoutMs: 5000,
      fetchFn: mockFetch,
    });

    const result = await client.check(SAMPLE_REQUEST);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.model).toBe('gemini-3.1-flash-lite-preview');
    expect(result.results).toHaveLength(2);
    expect(result.results[1].verdict).toBe('violation');
    expect(result.callLogs).toHaveLength(1);
  });

  it('degrades safely to unsure(PROVIDER_ERROR) on HTTP 503', async () => {
    const mockFetch = jest.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: 'unavailable' }),
    })) as unknown as typeof fetch;

    const client = new HttpCheckerClient({
      baseUrl: 'http://checker:8000',
      fetchFn: mockFetch,
    });

    const result = await client.check(SAMPLE_REQUEST);
    expect(result.callLogs).toEqual([]);
    expect(result.results).toHaveLength(2);
    for (const f of result.results) {
      expect(f.verdict).toBe('unsure');
      expect(f.unsureReason).toBe('PROVIDER_ERROR');
    }
  });

  it('degrades safely to unsure(TIMEOUT) when request aborts/times out', async () => {
    const mockFetch = jest.fn(async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }) as unknown as typeof fetch;

    const client = new HttpCheckerClient({
      baseUrl: 'http://checker:8000',
      timeoutMs: 50,
      fetchFn: mockFetch,
    });

    const result = await client.check(SAMPLE_REQUEST);
    expect(
      result.results.every((f) => f.verdict === 'unsure' && f.unsureReason === 'TIMEOUT'),
    ).toBe(true);
  });

  it('degrades safely to unsure(SCHEMA_INVALID) if violation omits evidence', async () => {
    const mockFetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        submissionId: 'sub_100',
        results: [
          {
            constraint: 'C1',
            source: 'HARD_RULE',
            verdict: 'violation',
            evidence: [], // Violates checker-output.md invariant!
            unsureReason: null,
            reason: 'Missing evidence',
          },
          {
            constraint: 'C2',
            source: 'LLM',
            verdict: 'pass',
            evidence: [],
            unsureReason: null,
            reason: null,
          },
        ],
        model: null,
        promptVersion: null,
        checkedAt: '2026-11-28T00:00:00.000Z',
        callLogs: [],
      }),
    })) as unknown as typeof fetch;

    const client = new HttpCheckerClient({
      baseUrl: 'http://checker:8000',
      fetchFn: mockFetch,
    });

    const result = await client.check(SAMPLE_REQUEST);
    expect(
      result.results.every((f) => f.verdict === 'unsure' && f.unsureReason === 'SCHEMA_INVALID'),
    ).toBe(true);
  });
});
