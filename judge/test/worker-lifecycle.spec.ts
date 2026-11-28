import type { CheckerClient, CheckerRequest } from '../src/checker/checker-http.client';
import {
  InMemoryJobStore,
  PostgresJobStore,
  type PgClientLike,
  type PgPoolLike,
  type PgQueryResult,
} from '../src/queue/job-store';
import { JudgeWorker } from '../src/queue/worker';
import type { SandboxRunner } from '../src/sandbox/runner.interface';
import type { CheckerResult, SandboxExecutionResult, SubmissionJob } from '../src/types';

function makeJob(overrides: Partial<SubmissionJob> = {}): SubmissionJob {
  return {
    id: overrides.id ?? 'job_n1_001',
    submissionId: overrides.submissionId ?? 'sub_n1_001',
    labId: overrides.labId ?? 'lab_sort_1',
    studentId: overrides.studentId ?? 'std_23120244',
    studentIdentifiers: overrides.studentIdentifiers ?? [
      'std_23120244',
      'student1',
      'student1@leetkob.edu.vn',
      'Student One',
    ],
    statement: '# Sorting Lab\nSort N numbers using merge sort.',
    code: '#include <iostream>\nint main() { return 0; }\n',
    submittedAt: '2026-11-28T08:00:00.000Z',
    limits: {
      cpuTimeSec: 1,
      wallTimeSec: 3,
      memoryMb: 256,
      maxProcesses: 16,
      outputLimitBytes: 1048576,
    },
    testCases: [
      { id: 'tc1', input: '3\n3 1 2\n', expectedOutput: '1 2 3\n' },
      { id: 'tc2', input: '2\n9 4\n', expectedOutput: '4 9\n' },
    ],
    constraints: [
      { id: 'C1', code: 'C1', text: 'Do not call `std::sort`.', deduction: 3 },
      { id: 'C2', code: 'C2', text: 'Implement merge sort yourself.', deduction: 4 },
    ],
    stage: 'JUDGE',
    status: 'PENDING',
    attempts: 0,
    lastError: null,
    createdAt: '2026-11-28T08:00:00.000Z',
    ...overrides,
  };
}

function makeFakeChecker(receivedRequests: CheckerRequest[]): CheckerClient {
  return {
    check: async (req: CheckerRequest): Promise<CheckerResult> => {
      receivedRequests.push(req);
      return {
        submissionId: req.submissionId,
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
            verdict: req.costCapExceeded ? 'unsure' : 'pass',
            evidence: [],
            unsureReason: req.costCapExceeded ? 'COST_CAP_EXCEEDED' : null,
            reason: req.costCapExceeded ? 'Cap exceeded' : 'Valid merge sort.',
          },
        ],
        model: req.costCapExceeded ? null : 'gemini-3.1-flash-lite-preview',
        promptVersion: req.costCapExceeded ? null : 'v1',
        checkedAt: '2026-11-28T08:00:05.000Z',
        callLogs: req.costCapExceeded
          ? []
          : [
              {
                requestId: `req_chk_${req.submissionId}`,
                model: 'gemini-3.1-flash-lite-preview',
                promptVersion: 'v1',
                constraints: ['C2'],
                sanitizedPrompt: 'sanitized...',
                inputTokens: 120,
                outputTokens: 25,
                latencyMs: 180,
                estimatedCostUsd: 0.0001,
                status: 'OK',
              },
            ],
      };
    },
  };
}

describe('Task N1: Queue Durability (Stop -> Submit -> Restart), Checker Trigger & Redelivery Idempotency', () => {
  it('queues work while worker is stopped, then judges AC and triggers checker upon restart', async () => {
    const store = new InMemoryJobStore();
    const checkerRequests: CheckerRequest[] = [];
    const sandboxRunner: SandboxRunner = {
      evaluate: async (): Promise<SandboxExecutionResult> => ({
        overallVerdict: 'AC',
        compileOutput: null,
        testResults: [
          { ordinal: 1, verdict: 'AC', timeMs: 12, memoryKb: 2048 },
          { ordinal: 2, verdict: 'AC', timeMs: 14, memoryKb: 2100 },
        ],
        maxTimeMs: 14,
        maxMemoryKb: 2100,
      }),
    };

    const worker = new JudgeWorker({
      workerId: 'worker-test-1',
      jobStore: store,
      sandboxRunner,
      checkerClient: makeFakeChecker(checkerRequests),
      pollIntervalMs: 25,
      logger: () => undefined,
    });

    // Step 1: Stop worker (or ensure it is stopped)
    await worker.stop();
    expect(worker.isRunning()).toBe(false);

    // Step 2: Submit while worker is stopped -> job stays durably queued
    store.enqueue(makeJob());
    expect(store.submissions.get('sub_n1_001')?.pipelineStatus).toBe('QUEUED');
    expect(store.jobs.get('job_n1_001')?.status).toBe('PENDING');

    // Step 3: Start worker again -> drains JUDGE and then CHECK automatically
    await worker.start();
    await new Promise((resolve) => setTimeout(resolve, 60));
    await worker.stop();

    const sub = store.submissions.get('sub_n1_001');
    expect(sub?.pipelineStatus).toBe('COMPLETED');
    expect(sub?.overallVerdict).toBe('AC');
    expect(sub?.passedTests).toBe(2);
    expect(sub?.totalTests).toBe(2);
    expect(sub?.checkerStatus).toBe('COMPLETED');
    expect(sub?.checkerModel).toBe('gemini-3.1-flash-lite-preview');
    expect(sub?.promptVersion).toBe('v1');

    // Per-test verdicts saved without duplicating
    expect(store.testResults.get('sub_n1_001')).toEqual([
      { ordinal: 1, verdict: 'AC', timeMs: 12, memoryKb: 2048 },
      { ordinal: 2, verdict: 'AC', timeMs: 14, memoryKb: 2100 },
    ]);

    // Checker was invoked once with full studentIdentifiers for sanitizer redaction
    expect(checkerRequests).toHaveLength(1);
    expect(checkerRequests[0].studentIdentifiers).toEqual([
      'std_23120244',
      'student1',
      'student1@leetkob.edu.vn',
      'Student One',
    ]);
    expect(store.findings.get('sub_n1_001')?.size).toBe(2);
    expect(store.callLogs.get('sub_n1_001')?.size).toBe(1);
    expect(store.jobs.get('job_n1_001')?.status).toBe('DONE');
  });

  it('does NOT invoke checker when overall verdict is WA/CE (FAQ-04)', async () => {
    const store = new InMemoryJobStore();
    const checkerRequests: CheckerRequest[] = [];
    const sandboxRunner: SandboxRunner = {
      evaluate: async (): Promise<SandboxExecutionResult> => ({
        overallVerdict: 'WA',
        compileOutput: null,
        testResults: [
          { ordinal: 1, verdict: 'AC', timeMs: 10, memoryKb: 2000 },
          { ordinal: 2, verdict: 'WA', timeMs: 11, memoryKb: 2000 },
        ],
        maxTimeMs: 11,
        maxMemoryKb: 2000,
      }),
    };

    const worker = new JudgeWorker({
      workerId: 'worker-wa-1',
      jobStore: store,
      sandboxRunner,
      checkerClient: makeFakeChecker(checkerRequests),
      logger: () => undefined,
    });

    store.enqueue(makeJob({ id: 'job_wa', submissionId: 'sub_wa' }));
    await worker.drainOnce();

    const sub = store.submissions.get('sub_wa');
    expect(sub?.overallVerdict).toBe('WA');
    expect(sub?.checkerStatus).toBe('NOT_APPLICABLE');
    expect(checkerRequests).toHaveLength(0);
    expect(store.testResults.get('sub_wa')).toHaveLength(2);
    expect(store.jobs.get('job_wa')?.status).toBe('DONE');
  });

  it('persists exactly one verdict set, one finding set, and one call log even on message redelivery (Criterion 2)', async () => {
    const store = new InMemoryJobStore();
    const checkerRequests: CheckerRequest[] = [];
    const sandboxRunner: SandboxRunner = {
      evaluate: async (): Promise<SandboxExecutionResult> => ({
        overallVerdict: 'AC',
        compileOutput: null,
        testResults: [
          { ordinal: 1, verdict: 'AC', timeMs: 9, memoryKb: 1800 },
          { ordinal: 2, verdict: 'AC', timeMs: 11, memoryKb: 1900 },
        ],
        maxTimeMs: 11,
        maxMemoryKb: 1900,
      }),
    };

    const worker = new JudgeWorker({
      workerId: 'worker-idem-1',
      jobStore: store,
      sandboxRunner,
      checkerClient: makeFakeChecker(checkerRequests),
      logger: () => undefined,
    });

    // First full delivery: JUDGE -> CHECK
    store.enqueue(makeJob({ id: 'job_idem', submissionId: 'sub_idem' }));
    await worker.drainOnce();

    // Simulate broker/queue redelivering JUDGE (and subsequently CHECK) a second time
    store.simulateRedelivery('sub_idem', 'JUDGE');
    await worker.drainOnce();

    // Must still have exactly ONE set of test verdicts (ordinals 1..2), ONE set of findings (C1, C2), and ONE call log
    expect(store.testResults.get('sub_idem')).toHaveLength(2);
    expect(store.findings.get('sub_idem')?.size).toBe(2);
    expect(store.callLogs.get('sub_idem')?.size).toBe(1);
    expect(store.submissions.get('sub_idem')?.overallVerdict).toBe('AC');
    expect(store.submissions.get('sub_idem')?.checkerStatus).toBe('COMPLETED');
  });

  it('passes costCapExceeded=true to checker once lab reaches maxLlmCallsPerLab', async () => {
    const store = new InMemoryJobStore();
    const checkerRequests: CheckerRequest[] = [];
    const sandboxRunner: SandboxRunner = {
      evaluate: async (): Promise<SandboxExecutionResult> => ({
        overallVerdict: 'AC',
        compileOutput: null,
        testResults: [{ ordinal: 1, verdict: 'AC', timeMs: 5, memoryKb: 1024 }],
        maxTimeMs: 5,
        maxMemoryKb: 1024,
      }),
    };

    const worker = new JudgeWorker({
      workerId: 'worker-cap-1',
      jobStore: store,
      sandboxRunner,
      checkerClient: makeFakeChecker(checkerRequests),
      maxLlmCallsPerLab: 1,
      logger: () => undefined,
    });

    // First submission consumes 1 call (under cap)
    store.enqueue(makeJob({ id: 'job_c1', submissionId: 'sub_c1' }));
    await worker.drainOnce();
    expect(checkerRequests[0].costCapExceeded).toBe(false);

    // Second submission in the same lab hits cap=1 -> costCapExceeded=true
    store.enqueue(makeJob({ id: 'job_c2', submissionId: 'sub_c2' }));
    await worker.drainOnce();
    expect(checkerRequests[1].costCapExceeded).toBe(true);
    expect(store.findings.get('sub_c2')?.get('C2')?.unsureReason).toBe('COST_CAP_EXCEEDED');
  });

  it('PostgresJobStore executes FOR UPDATE SKIP LOCKED, idempotent UPSERTs, pg_notify, and 10% pass rebalance', async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const sampleJob = makeJob();

    const client: PgClientLike = {
      query: async <R = Record<string, unknown>>(
        text: string,
        values?: unknown[],
      ): Promise<PgQueryResult<R>> => {
        queries.push({ text: text.trim(), values });
        if (text.includes('FOR UPDATE SKIP LOCKED')) {
          return {
            rows: [{ id: sampleJob.id, payload: sampleJob }] as unknown as R[],
            rowCount: 1,
          };
        }
        if (text.includes('RETURNING lab_id')) {
          return { rows: [{ lab_id: sampleJob.labId }] as unknown as R[], rowCount: 1 };
        }
        if (text.includes('SELECT id, constraint_code FROM lab_constraints')) {
          return {
            rows: [
              { id: 'con_lab_sort_1_C1', constraint_code: 'C1' },
              { id: 'con_lab_sort_1_C2', constraint_code: 'C2' },
            ] as unknown as R[],
            rowCount: 2,
          };
        }
        if (text.includes('COUNT(*)::int AS total')) {
          return { rows: [{ total: 3 }] as unknown as R[], rowCount: 1 };
        }
        if (text.includes('RETURNING status')) {
          return { rows: [{ status: 'FAILED' }] as unknown as R[], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
      release: jest.fn(),
    };
    const pool: PgPoolLike = {
      query: client.query,
      connect: async () => client,
      end: async () => undefined,
    };

    const pgStore = new PostgresJobStore({ injectedPool: pool });
    const claimed = await pgStore.claimNextJob('wk-1', 'JUDGE');
    expect(claimed?.id).toBe(sampleJob.id);

    await pgStore.recordJudgeResult({
      submissionId: sampleJob.submissionId,
      overallVerdict: 'AC',
      compileOutput: null,
      testResults: [{ ordinal: 1, verdict: 'AC', timeMs: 10, memoryKb: 2048 }],
      maxTimeMs: 10,
      maxMemoryKb: 2048,
      judgedAt: '2026-11-28T08:00:02.000Z',
    });
    expect(
      queries.some((q) => q.text.includes('ON CONFLICT (submission_id, ordinal) DO UPDATE')),
    ).toBe(true);
    expect(
      queries.some((q) => q.text.includes("SELECT pg_notify('submission_jobs_ready', $1)")),
    ).toBe(true);

    await pgStore.recordCheckerResult({
      submissionId: sampleJob.submissionId,
      labId: sampleJob.labId,
      model: 'gemini-3.1-flash-lite-preview',
      promptVersion: 'v1',
      checkedAt: '2026-11-28T08:00:05.000Z',
      findings: [
        {
          constraintCode: 'C1',
          source: 'HARD_RULE',
          verdict: 'pass',
          unsureReason: null,
          evidence: [],
          reason: null,
        },
      ],
      callLogs: [
        {
          requestId: '',
          model: 'gemini-3.1-flash-lite-preview',
          constraints: ['C2'],
          sanitizedPrompt: '...',
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 30000,
          estimatedCostUsd: 0,
          status: 'TIMEOUT',
        },
      ],
    });
    expect(
      queries.some((q) => q.text.includes('ON CONFLICT (submission_id, constraint_id) DO UPDATE')),
    ).toBe(true);
    expect(
      queries.some((q) => q.text.includes('ON CONFLICT (submission_id, call_ordinal) DO UPDATE')),
    ).toBe(true);
    expect(queries.some((q) => q.text.includes('CEIL(0.10 * total_pass)'))).toBe(true);
    expect(await pgStore.countLabModelCalls(sampleJob.labId)).toBe(3);

    const failOutcome = await pgStore.recordJobFailure(
      sampleJob.id,
      sampleJob.submissionId,
      'sandbox crashed',
      5,
    );
    expect(failOutcome).toBe('FAILED');
    expect(queries.some((q) => q.text.includes("pipeline_status = 'JUDGE_ERROR'"))).toBe(true);
  });
});
