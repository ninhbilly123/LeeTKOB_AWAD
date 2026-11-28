import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import type {
  CheckerCompletionInput,
  JudgeCompletionInput,
  JudgeVerdict,
  ModelCallLog,
  SubmissionJob,
  SubmissionJobStage,
  SubmissionTestResult,
} from '../types';

export interface PgQueryResult<R = Record<string, unknown>> {
  rows: R[];
  rowCount: number | null;
}

export interface PgClientLike {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<PgQueryResult<R>>;
  release(): void;
}

export interface PgPoolLike {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<PgQueryResult<R>>;
  connect(): Promise<PgClientLike>;
  end(): Promise<void>;
}

export interface WorkerJobStore {
  claimNextJob(workerId: string, stage: SubmissionJobStage): Promise<SubmissionJob | null>;
  recordJudgeResult(input: JudgeCompletionInput): Promise<void>;
  recordCheckerResult(input: CheckerCompletionInput): Promise<void>;
  recordJobFailure(
    jobId: string,
    submissionId: string,
    errorMessage: string,
    backoffSeconds: number,
  ): Promise<'RETRYING' | 'FAILED'>;
  requeueStaleJobs(staleAfterSeconds: number): Promise<number>;
  countLabModelCalls(labId: string): Promise<number>;
  startListening(onNotify: () => void): Promise<void>;
  close(): Promise<void>;
}

function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  if (value === undefined || value === null) {
    return fallback;
  }
  return value as T;
}

function usdToMicros(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0) {
    return 0;
  }
  return Math.round(usd * 1_000_000);
}

/**
 * PostgreSQL 16 Durable Queue store for judge-worker.
 * Mirrors gateway/migrations/0001_init_pa3_schema.up.sql and never holds a DB transaction
 * open while executing C++ code or calling the checker HTTP service.
 */
export class PostgresJobStore implements WorkerJobStore {
  private readonly pool: PgPoolLike;
  private readonly ownsPool: boolean;
  private readonly databaseUrl?: string;
  private listenClient: Client | null = null;
  private closing = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    options:
      | { databaseUrl: string; poolMax?: number; injectedPool?: undefined }
      | { injectedPool: PgPoolLike; databaseUrl?: undefined; poolMax?: undefined },
  ) {
    if (options.injectedPool) {
      this.pool = options.injectedPool;
      this.ownsPool = false;
    } else {
      this.databaseUrl = options.databaseUrl;
      this.pool = new Pool({
        connectionString: options.databaseUrl,
        max: options.poolMax ?? 10,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
        statement_timeout: 10000,
      }) as unknown as PgPoolLike;
      this.ownsPool = true;
    }
  }

  async startListening(onNotify: () => void): Promise<void> {
    if (!this.databaseUrl || this.closing) {
      return;
    }
    const connectListener = async (): Promise<void> => {
      if (this.closing) {
        return;
      }
      const client = new Client({ connectionString: this.databaseUrl });
      client.on('notification', () => {
        onNotify();
      });
      client.on('error', () => {
        this.scheduleReconnect(onNotify);
      });
      client.on('end', () => {
        this.scheduleReconnect(onNotify);
      });

      try {
        await client.connect();
        await client.query('LISTEN submission_jobs_ready');
        this.listenClient = client;
      } catch {
        try {
          await client.end();
        } catch {
          // Ignore close errors
        }
        this.scheduleReconnect(onNotify);
      }
    };

    await connectListener();
  }

  private scheduleReconnect(onNotify: () => void): void {
    if (this.closing || this.reconnectTimer) {
      return;
    }
    this.listenClient = null;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.startListening(onNotify);
    }, 2000);
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.listenClient) {
      const client = this.listenClient;
      this.listenClient = null;
      try {
        await client.end();
      } catch {
        // Ignore shutdown errors
      }
    }
    if (this.ownsPool) {
      await this.pool.end();
    }
  }

  async claimNextJob(workerId: string, stage: SubmissionJobStage): Promise<SubmissionJob | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query<{ id: string; payload: unknown }>(
        `SELECT id, payload
         FROM submission_jobs
         WHERE stage = $1 AND status = 'PENDING' AND available_at <= NOW()
         ORDER BY available_at ASC, created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
        [stage],
      );
      const row = res.rows[0];
      if (!row) {
        await client.query('COMMIT');
        return null;
      }

      const jobId = String(row.id);
      await client.query(
        `UPDATE submission_jobs
         SET status = 'PROCESSING', attempts = attempts + 1,
             locked_by = $2, locked_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [jobId, workerId],
      );

      const job = parseJsonColumn<SubmissionJob>(row.payload, {} as SubmissionJob);
      if (stage === 'JUDGE' && job.submissionId) {
        await client.query(
          "UPDATE submissions SET pipeline_status = 'JUDGING' WHERE id = $1 AND pipeline_status = 'QUEUED'",
          [job.submissionId],
        );
      }

      await client.query('COMMIT');
      return { ...job, id: jobId, stage, status: 'PROCESSING' };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback errors
      }
      throw err;
    } finally {
      client.release();
    }
  }

  private async rebalanceLabPassSample(
    client: PgClientLike,
    labId: string,
    preferSubmissionId: string | null = null,
  ): Promise<void> {
    await client.query(
      `WITH pass_stats AS (
         SELECT
           COUNT(*) AS total_pass,
           COUNT(*) FILTER (WHERE cf.is_sampled_pass = TRUE) AS sampled_pass
         FROM constraint_findings cf
         INNER JOIN submissions s ON s.id = cf.submission_id
         WHERE s.lab_id = $1
           AND s.is_counting = TRUE
           AND s.overall_verdict = 'AC'
           AND cf.verdict = 'pass'
       ),
       needed AS (
         SELECT GREATEST(0, CEIL(0.10 * total_pass)::int - sampled_pass::int) AS deficit
         FROM pass_stats
       ),
       candidates AS (
         SELECT cf.id
         FROM constraint_findings cf
         INNER JOIN submissions s ON s.id = cf.submission_id
         WHERE s.lab_id = $1
           AND s.is_counting = TRUE
           AND s.overall_verdict = 'AC'
           AND cf.verdict = 'pass'
           AND cf.is_sampled_pass = FALSE
         ORDER BY ($2::text IS NOT NULL AND cf.submission_id = $2) DESC, cf.id ASC
         LIMIT (SELECT deficit FROM needed)
       )
       UPDATE constraint_findings
       SET is_sampled_pass = TRUE,
           review_status = CASE WHEN review_status = 'NOT_QUEUED' THEN 'PENDING_REVIEW' ELSE review_status END
       WHERE id IN (SELECT id FROM candidates)`,
      [labId, preferSubmissionId],
    );
  }

  async recordJudgeResult(input: JudgeCompletionInput): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const passedTests = input.testResults.filter((t) => t.verdict === 'AC').length;
      const totalTests = input.testResults.length;
      const nextCheckerStatus = input.overallVerdict === 'AC' ? 'PENDING' : 'NOT_APPLICABLE';

      const subRes = await client.query<{ lab_id: string }>(
        `UPDATE submissions
         SET pipeline_status = 'COMPLETED',
             overall_verdict = $2,
             compile_output = $3,
             passed_tests = $4,
             total_tests = $5,
             max_time_ms = $6,
             max_memory_kb = $7,
             checker_status = $8,
             judged_at = $9
         WHERE id = $1
         RETURNING lab_id`,
        [
          input.submissionId,
          input.overallVerdict,
          input.compileOutput,
          passedTests,
          totalTests,
          input.maxTimeMs,
          input.maxMemoryKb,
          nextCheckerStatus,
          input.judgedAt,
        ],
      );

      for (const tr of input.testResults) {
        await client.query(
          `INSERT INTO submission_test_results (submission_id, ordinal, verdict, time_ms, memory_kb)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (submission_id, ordinal) DO UPDATE SET
             verdict = EXCLUDED.verdict,
             time_ms = EXCLUDED.time_ms,
             memory_kb = EXCLUDED.memory_kb`,
          [input.submissionId, tr.ordinal, tr.verdict, tr.timeMs, tr.memoryKb],
        );
      }
      await client.query(
        'DELETE FROM submission_test_results WHERE submission_id = $1 AND ordinal > $2',
        [input.submissionId, totalTests],
      );

      if (input.overallVerdict === 'AC') {
        await client.query(
          `UPDATE submission_jobs
           SET stage = 'CHECK', status = 'PENDING', locked_by = NULL, locked_at = NULL,
               available_at = NOW(), updated_at = NOW()
           WHERE submission_id = $1`,
          [input.submissionId],
        );
        await client.query("SELECT pg_notify('submission_jobs_ready', $1)", [input.submissionId]);
      } else {
        await client.query(
          `UPDATE submission_jobs
           SET status = 'DONE', locked_by = NULL, locked_at = NULL, updated_at = NOW()
           WHERE submission_id = $1`,
          [input.submissionId],
        );
        const labId = subRes.rows[0]?.lab_id ? String(subRes.rows[0].lab_id) : null;
        if (labId) {
          await this.rebalanceLabPassSample(client, labId, null);
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback errors
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async recordCheckerResult(input: CheckerCompletionInput): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const conRes = await client.query<{ id: string; constraint_code: string }>(
        'SELECT id, constraint_code FROM lab_constraints WHERE lab_id = $1',
        [input.labId],
      );
      const codeToId = new Map(
        conRes.rows.map((row) => [String(row.constraint_code), String(row.id)]),
      );

      for (const finding of input.findings) {
        const constraintId =
          codeToId.get(finding.constraintCode) ?? `con_${input.labId}_${finding.constraintCode}`;
        const isQueued = finding.verdict === 'violation' || finding.verdict === 'unsure';
        const reviewStatus = isQueued ? 'PENDING_REVIEW' : 'NOT_QUEUED';

        await client.query(
          `INSERT INTO constraint_findings (
             id, submission_id, lab_id, constraint_id, constraint_code, source, verdict,
             unsure_reason, evidence, reason, is_sampled_pass, review_status
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, FALSE, $11)
           ON CONFLICT (submission_id, constraint_id) DO UPDATE SET
             lab_id = EXCLUDED.lab_id,
             constraint_code = EXCLUDED.constraint_code,
             source = EXCLUDED.source,
             verdict = EXCLUDED.verdict,
             unsure_reason = EXCLUDED.unsure_reason,
             evidence = EXCLUDED.evidence,
             reason = EXCLUDED.reason,
             review_status = CASE
               WHEN constraint_findings.ta_decision IS NOT NULL THEN constraint_findings.review_status
               ELSE EXCLUDED.review_status
             END`,
          [
            `fnd_${randomUUID()}`,
            input.submissionId,
            input.labId,
            constraintId,
            finding.constraintCode,
            finding.source,
            finding.verdict,
            finding.unsureReason,
            JSON.stringify(finding.evidence),
            finding.reason,
            reviewStatus,
          ],
        );
      }

      for (let idx = 0; idx < input.callLogs.length; idx += 1) {
        const log = input.callLogs[idx];
        const callOrdinal = log.callOrdinal ?? idx + 1;
        const promptVersion = log.promptVersion ?? input.promptVersion ?? 'v1';
        await client.query(
          `INSERT INTO model_call_logs (
             id, submission_id, lab_id, call_ordinal, request_id, model, prompt_version,
             constraints, sanitized_prompt, raw_response, input_tokens, output_tokens,
             latency_ms, estimated_cost_micros, status
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15)
           ON CONFLICT (submission_id, call_ordinal) DO UPDATE SET
             request_id = EXCLUDED.request_id,
             model = EXCLUDED.model,
             prompt_version = EXCLUDED.prompt_version,
             constraints = EXCLUDED.constraints,
             sanitized_prompt = EXCLUDED.sanitized_prompt,
             raw_response = EXCLUDED.raw_response,
             input_tokens = EXCLUDED.input_tokens,
             output_tokens = EXCLUDED.output_tokens,
             latency_ms = EXCLUDED.latency_ms,
             estimated_cost_micros = EXCLUDED.estimated_cost_micros,
             status = EXCLUDED.status`,
          [
            `mcl_${randomUUID()}`,
            input.submissionId,
            input.labId,
            callOrdinal,
            log.requestId ?? '',
            log.model,
            promptVersion,
            JSON.stringify(log.constraints),
            log.sanitizedPrompt,
            log.rawResponse ?? null,
            log.inputTokens,
            log.outputTokens,
            log.latencyMs,
            usdToMicros(log.estimatedCostUsd),
            log.status,
          ],
        );
      }

      await this.rebalanceLabPassSample(client, input.labId, input.submissionId);

      await client.query(
        `UPDATE submissions
         SET checker_status = 'COMPLETED',
             checker_model = $2,
             prompt_version = $3,
             checked_at = $4
         WHERE id = $1`,
        [input.submissionId, input.model, input.promptVersion, input.checkedAt],
      );
      await client.query(
        "UPDATE submission_jobs SET status = 'DONE', locked_by = NULL, locked_at = NULL, updated_at = NOW() WHERE submission_id = $1",
        [input.submissionId],
      );

      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback errors
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async recordJobFailure(
    jobId: string,
    submissionId: string,
    errorMessage: string,
    backoffSeconds: number,
  ): Promise<'RETRYING' | 'FAILED'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query<{ status: string }>(
        `UPDATE submission_jobs
         SET status = CASE WHEN attempts >= max_attempts THEN 'FAILED' ELSE 'PENDING' END,
             available_at = CASE
               WHEN attempts >= max_attempts THEN available_at
               ELSE NOW() + ($3 * INTERVAL '1 second')
             END,
             locked_by = NULL,
             locked_at = NULL,
             last_error = $2,
             updated_at = NOW()
         WHERE id = $1
         RETURNING status`,
        [jobId, errorMessage, backoffSeconds],
      );
      const nextStatus = res.rows[0]?.status === 'FAILED' ? 'FAILED' : 'RETRYING';
      if (nextStatus === 'FAILED') {
        await client.query(
          "UPDATE submissions SET pipeline_status = 'JUDGE_ERROR' WHERE id = $1 AND pipeline_status <> 'COMPLETED'",
          [submissionId],
        );
      }
      await client.query('COMMIT');
      return nextStatus;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback errors
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async requeueStaleJobs(staleAfterSeconds: number): Promise<number> {
    const res = await this.pool.query(
      `UPDATE submission_jobs
       SET status = CASE WHEN attempts >= max_attempts THEN 'FAILED' ELSE 'PENDING' END,
           locked_by = NULL,
           locked_at = NULL,
           last_error = COALESCE(last_error, 'Worker lease expired before completion'),
           updated_at = NOW()
       WHERE status = 'PROCESSING'
         AND locked_at < NOW() - ($1 * INTERVAL '1 second')`,
      [staleAfterSeconds],
    );
    return res.rowCount ?? 0;
  }

  async countLabModelCalls(labId: string): Promise<number> {
    const res = await this.pool.query<{ total: string | number }>(
      'SELECT COUNT(*)::int AS total FROM model_call_logs WHERE lab_id = $1',
      [labId],
    );
    return Number(res.rows[0]?.total ?? 0);
  }
}

export interface InMemorySubmissionState {
  submissionId: string;
  labId: string;
  pipelineStatus: 'QUEUED' | 'JUDGING' | 'COMPLETED' | 'JUDGE_ERROR';
  overallVerdict: JudgeVerdict | null;
  compileOutput: string | null;
  passedTests: number;
  totalTests: number;
  checkerStatus: 'NOT_APPLICABLE' | 'PENDING' | 'COMPLETED';
  checkerModel: string | null;
  promptVersion: string | null;
  checkedAt: string | null;
  judgedAt: string | null;
}

/**
 * Deterministic in-memory durable queue implementation for offline unit & redelivery tests.
 */
export class InMemoryJobStore implements WorkerJobStore {
  readonly jobs = new Map<string, SubmissionJob>();
  readonly submissions = new Map<string, InMemorySubmissionState>();
  readonly testResults = new Map<string, SubmissionTestResult[]>();
  readonly findings = new Map<string, Map<string, CheckerCompletionInput['findings'][number]>>();
  readonly callLogs = new Map<string, Map<number, ModelCallLog>>();
  private listeners: Array<() => void> = [];

  enqueue(job: SubmissionJob): void {
    const copy: SubmissionJob = {
      ...job,
      stage: job.stage ?? 'JUDGE',
      status: 'PENDING',
      attempts: job.attempts ?? 0,
    };
    this.jobs.set(copy.id, copy);
    if (!this.submissions.has(copy.submissionId)) {
      this.submissions.set(copy.submissionId, {
        submissionId: copy.submissionId,
        labId: copy.labId,
        pipelineStatus: 'QUEUED',
        overallVerdict: null,
        compileOutput: null,
        passedTests: 0,
        totalTests: copy.testCases.length,
        checkerStatus: 'NOT_APPLICABLE',
        checkerModel: null,
        promptVersion: null,
        checkedAt: null,
        judgedAt: null,
      });
    }
    for (const notify of this.listeners) {
      notify();
    }
  }

  /** Simulates queue redelivery after a crash before ACK/DONE. */
  simulateRedelivery(submissionId: string, stage: SubmissionJobStage): void {
    const job = [...this.jobs.values()].find((j) => j.submissionId === submissionId);
    if (job) {
      job.stage = stage;
      job.status = 'PENDING';
    }
    for (const notify of this.listeners) {
      notify();
    }
  }

  async claimNextJob(_workerId: string, stage: SubmissionJobStage): Promise<SubmissionJob | null> {
    const next = [...this.jobs.values()]
      .filter((j) => (j.stage ?? 'JUDGE') === stage && j.status === 'PENDING')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!next) {
      return null;
    }
    next.status = 'PROCESSING';
    next.attempts = (next.attempts ?? 0) + 1;
    const sub = this.submissions.get(next.submissionId);
    if (stage === 'JUDGE' && sub && sub.pipelineStatus === 'QUEUED') {
      sub.pipelineStatus = 'JUDGING';
    }
    return { ...next };
  }

  async recordJudgeResult(input: JudgeCompletionInput): Promise<void> {
    const sub = this.submissions.get(input.submissionId);
    if (sub) {
      sub.pipelineStatus = 'COMPLETED';
      sub.overallVerdict = input.overallVerdict;
      sub.compileOutput = input.compileOutput;
      sub.passedTests = input.testResults.filter((t) => t.verdict === 'AC').length;
      sub.totalTests = input.testResults.length;
      sub.checkerStatus = input.overallVerdict === 'AC' ? 'PENDING' : 'NOT_APPLICABLE';
      sub.judgedAt = input.judgedAt;
    }

    // Idempotent overwrite by ordinal (N1 redelivery invariant)
    const byOrdinal = new Map<number, SubmissionTestResult>();
    for (const tr of input.testResults) {
      byOrdinal.set(tr.ordinal, { ...tr });
    }
    this.testResults.set(
      input.submissionId,
      [...byOrdinal.values()].sort((a, b) => a.ordinal - b.ordinal),
    );

    const job = [...this.jobs.values()].find((j) => j.submissionId === input.submissionId);
    if (job) {
      if (input.overallVerdict === 'AC') {
        job.stage = 'CHECK';
        job.status = 'PENDING';
        for (const notify of this.listeners) {
          notify();
        }
      } else {
        job.status = 'DONE';
      }
    }
  }

  async recordCheckerResult(input: CheckerCompletionInput): Promise<void> {
    const map = this.findings.get(input.submissionId) ?? new Map();
    for (const f of input.findings) {
      map.set(f.constraintCode, { ...f, evidence: f.evidence.map((e) => ({ ...e })) });
    }
    this.findings.set(input.submissionId, map);

    const logsMap = this.callLogs.get(input.submissionId) ?? new Map();
    for (let idx = 0; idx < input.callLogs.length; idx += 1) {
      const log = input.callLogs[idx];
      const ordinal = log.callOrdinal ?? idx + 1;
      logsMap.set(ordinal, { ...log, callOrdinal: ordinal });
    }
    this.callLogs.set(input.submissionId, logsMap);

    const sub = this.submissions.get(input.submissionId);
    if (sub) {
      sub.checkerStatus = 'COMPLETED';
      sub.checkerModel = input.model;
      sub.promptVersion = input.promptVersion;
      sub.checkedAt = input.checkedAt;
    }

    const job = [...this.jobs.values()].find((j) => j.submissionId === input.submissionId);
    if (job) {
      job.status = 'DONE';
    }
  }

  async recordJobFailure(
    jobId: string,
    submissionId: string,
    errorMessage: string,
  ): Promise<'RETRYING' | 'FAILED'> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return 'FAILED';
    }
    job.lastError = errorMessage;
    if ((job.attempts ?? 1) >= 3) {
      job.status = 'FAILED';
      const sub = this.submissions.get(submissionId);
      if (sub && sub.pipelineStatus !== 'COMPLETED') {
        sub.pipelineStatus = 'JUDGE_ERROR';
      }
      return 'FAILED';
    }
    job.status = 'PENDING';
    return 'RETRYING';
  }

  async requeueStaleJobs(): Promise<number> {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.status === 'PROCESSING') {
        job.status = (job.attempts ?? 1) >= 3 ? 'FAILED' : 'PENDING';
        count += 1;
      }
    }
    return count;
  }

  async countLabModelCalls(labId: string): Promise<number> {
    let total = 0;
    for (const [subId, logs] of this.callLogs.entries()) {
      const sub = this.submissions.get(subId);
      if (sub?.labId === labId) {
        total += logs.size;
      }
    }
    return total;
  }

  async startListening(onNotify: () => void): Promise<void> {
    this.listeners.push(onNotify);
  }

  async close(): Promise<void> {
    this.listeners = [];
  }
}
