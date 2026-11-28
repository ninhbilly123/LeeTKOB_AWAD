import type { CheckerClient } from '../checker/checker-http.client';
import { toCheckerConstraints } from '../checker/checker-http.client';
import type { SandboxRunner } from '../sandbox/runner.interface';
import type { SubmissionJob } from '../types';
import type { WorkerJobStore } from './job-store';

export interface JudgeWorkerOptions {
  workerId: string;
  jobStore: WorkerJobStore;
  sandboxRunner: SandboxRunner;
  checkerClient: CheckerClient;
  pollIntervalMs?: number;
  staleJobAfterSec?: number;
  staleSweepIntervalMs?: number;
  retryBackoffSec?: number;
  maxLlmCallsPerLab?: number;
  logger?: (message: string) => void;
}

/**
 * Standalone queue worker executing two short-transaction stages:
 *   1. JUDGE: compiles & runs C++17 tests via SandboxRunner, records verdicts, promotes AC -> CHECK.
 *   2. CHECK: calls internal checker HTTP service for Accepted submissions, records findings/logs.
 *
 * Gracefully drains in-flight work on stop() (SIGTERM/SIGINT) and tolerates stop -> submit -> start
 * plus message redelivery without ever duplicating verdicts or findings.
 */
export class JudgeWorker {
  private readonly workerId: string;
  private readonly jobStore: WorkerJobStore;
  private readonly sandboxRunner: SandboxRunner;
  private readonly checkerClient: CheckerClient;
  private readonly pollIntervalMs: number;
  private readonly staleJobAfterSec: number;
  private readonly staleSweepIntervalMs: number;
  private readonly retryBackoffSec: number;
  private readonly maxLlmCallsPerLab: number;
  private readonly logger: (message: string) => void;

  private running = false;
  private draining = false;
  private activeCycle: Promise<void> | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private staleTimer: NodeJS.Timeout | null = null;

  constructor(options: JudgeWorkerOptions) {
    this.workerId = options.workerId;
    this.jobStore = options.jobStore;
    this.sandboxRunner = options.sandboxRunner;
    this.checkerClient = options.checkerClient;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.staleJobAfterSec = options.staleJobAfterSec ?? 120;
    this.staleSweepIntervalMs = options.staleSweepIntervalMs ?? 30_000;
    this.retryBackoffSec = options.retryBackoffSec ?? 5;
    this.maxLlmCallsPerLab = options.maxLlmCallsPerLab ?? 200;
    this.logger = options.logger ?? ((msg) => console.log(`[judge-worker] ${msg}`));
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Claims and executes at most one queued job (JUDGE first, then CHECK).
   * Returns true if a job was processed, false if the queue was empty.
   */
  async processOnce(): Promise<boolean> {
    const judgeJob = await this.jobStore.claimNextJob(this.workerId, 'JUDGE');
    if (judgeJob) {
      await this.handleJudgeJob(judgeJob);
      return true;
    }

    const checkJob = await this.jobStore.claimNextJob(this.workerId, 'CHECK');
    if (checkJob) {
      await this.handleCheckJob(checkJob);
      return true;
    }

    return false;
  }

  /** Drains all currently claimable jobs until the queue is empty or stop() is requested. */
  async drainOnce(): Promise<number> {
    let processed = 0;
    while (await this.processOnce()) {
      processed += 1;
      if (!this.running && this.draining) {
        break;
      }
    }
    return processed;
  }

  private async handleJudgeJob(job: SubmissionJob): Promise<void> {
    try {
      const execResult = await this.sandboxRunner.evaluate(job);
      await this.jobStore.recordJudgeResult({
        submissionId: job.submissionId,
        overallVerdict: execResult.overallVerdict,
        compileOutput: execResult.compileOutput,
        testResults: execResult.testResults,
        maxTimeMs: execResult.maxTimeMs,
        maxMemoryKb: execResult.maxMemoryKb,
        judgedAt: new Date().toISOString(),
      });
      this.logger(
        `Judged submission=${job.submissionId} verdict=${execResult.overallVerdict} tests=${execResult.testResults.length}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const outcome = await this.jobStore.recordJobFailure(
        job.id,
        job.submissionId,
        message,
        this.retryBackoffSec,
      );
      this.logger(
        `Judge failure job=${job.id} submission=${job.submissionId} outcome=${outcome} error=${message}`,
      );
    }
  }

  private async handleCheckJob(job: SubmissionJob): Promise<void> {
    try {
      const constraints = toCheckerConstraints(job.constraints ?? []);
      if (constraints.length === 0) {
        await this.jobStore.recordCheckerResult({
          submissionId: job.submissionId,
          labId: job.labId,
          model: null,
          promptVersion: null,
          checkedAt: new Date().toISOString(),
          findings: [],
          callLogs: [],
        });
        this.logger(`Checked submission=${job.submissionId} findings=0 (no constraints)`);
        return;
      }

      const usedCalls = await this.jobStore.countLabModelCalls(job.labId);
      const costCapExceeded = usedCalls >= this.maxLlmCallsPerLab;
      const checkerResult = await this.checkerClient.check({
        submissionId: job.submissionId,
        statement: job.statement ?? '',
        sourceCode: job.code,
        constraints,
        studentIdentifiers: job.studentIdentifiers ?? [job.studentId],
        costCapExceeded,
      });

      await this.jobStore.recordCheckerResult({
        submissionId: job.submissionId,
        labId: job.labId,
        model: checkerResult.model,
        promptVersion: checkerResult.promptVersion,
        checkedAt: checkerResult.checkedAt,
        findings: checkerResult.results.map((r) => ({
          constraintCode: r.constraint,
          source: r.source,
          verdict: r.verdict,
          unsureReason: r.unsureReason,
          evidence: r.evidence,
          reason: r.reason,
        })),
        callLogs: checkerResult.callLogs,
      });
      this.logger(
        `Checked submission=${job.submissionId} findings=${checkerResult.results.length} calls=${checkerResult.callLogs.length}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const outcome = await this.jobStore.recordJobFailure(
        job.id,
        job.submissionId,
        message,
        this.retryBackoffSec,
      );
      this.logger(
        `Check failure job=${job.id} submission=${job.submissionId} outcome=${outcome} error=${message}`,
      );
    }
  }

  private triggerCycle(): void {
    if (!this.running || this.activeCycle) {
      return;
    }
    this.activeCycle = (async () => {
      try {
        while (this.running) {
          const didWork = await this.processOnce();
          if (!didWork) {
            break;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger(`Worker loop error: ${message}`);
      } finally {
        this.activeCycle = null;
      }
    })();
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    this.draining = false;

    await this.jobStore.startListening(() => this.triggerCycle());

    // Immediately reclaim stale jobs on startup and process queued work
    try {
      const reclaimed = await this.jobStore.requeueStaleJobs(this.staleJobAfterSec);
      if (reclaimed > 0) {
        this.logger(`Reclaimed ${reclaimed} stale job(s) on startup.`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger(`Startup stale-job sweep error: ${message}`);
    }

    this.triggerCycle();

    this.pollTimer = setInterval(() => {
      this.triggerCycle();
    }, this.pollIntervalMs);

    this.staleTimer = setInterval(() => {
      void this.jobStore
        .requeueStaleJobs(this.staleJobAfterSec)
        .then((count) => {
          if (count > 0) {
            this.logger(`Reclaimed ${count} stale job(s).`);
            this.triggerCycle();
          }
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          this.logger(`Stale-job sweep error: ${message}`);
        });
    }, this.staleSweepIntervalMs);
  }

  async stop(): Promise<void> {
    if (!this.running && !this.activeCycle) {
      return;
    }
    this.running = false;
    this.draining = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
    if (this.activeCycle) {
      await this.activeCycle;
    }
  }
}
