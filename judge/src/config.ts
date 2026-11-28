import { hostname } from 'node:os';

export type SandboxMode = 'docker' | 'process';

export interface WorkerConfig {
  workerId: string;
  databaseUrl: string;
  dbPoolMax: number;
  checkerUrl: string;
  checkerTimeoutMs: number;
  pollIntervalMs: number;
  staleJobAfterSec: number;
  staleSweepIntervalMs: number;
  retryBackoffSec: number;
  maxLlmCallsPerLab: number;
  sandboxMode: SandboxMode;
  sandboxImage: string;
  dockerBinary: string;
  gppBinary: string;
  compileTimeoutMs: number;
}

function parsePositiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (!raw || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid environment variable ${name}='${raw}'. Expected a positive integer.`);
  }
  return parsed;
}

/**
 * Validates worker configuration once at startup (Session 03) and enforces secret isolation:
 * GEMINI_API_KEY / MODEL_API_KEY must NEVER be injected into the judge-worker runtime
 * (PA#3 Criterion 2 Row 9, proposal-detail.md §4.2).
 */
export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const forbiddenSecrets = ['GEMINI_API_KEY', 'MODEL_API_KEY', 'GOOGLE_API_KEY'].filter(
    (key) => (env[key] ?? '').trim().length > 0,
  );
  if (forbiddenSecrets.length > 0) {
    throw new Error(
      `Security violation: ${forbiddenSecrets.join(', ')} must NEVER be present in judge-worker environment. ` +
        'Keep LLM provider keys isolated inside the checker container.',
    );
  }

  const databaseUrl = (env.DATABASE_URL ?? '').trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to start judge-worker.');
  }
  if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) {
    throw new Error('DATABASE_URL must start with postgresql:// or postgres://.');
  }

  const checkerUrl = (env.CHECKER_URL ?? 'http://checker:8000').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(checkerUrl)) {
    throw new Error(`Invalid CHECKER_URL='${checkerUrl}'. Expected http:// or https:// URL.`);
  }

  const workerId = (env.WORKER_ID ?? `judge-worker-${hostname()}-${process.pid}`).trim();
  const rawSandboxMode = (env.SANDBOX_MODE ?? 'docker').trim().toLowerCase();
  if (rawSandboxMode !== 'docker' && rawSandboxMode !== 'process') {
    throw new Error(`Invalid SANDBOX_MODE='${env.SANDBOX_MODE}'. Expected 'docker' or 'process'.`);
  }
  const sandboxImage = (env.SANDBOX_IMAGE ?? 'leetkob-cpp-sandbox:pa3').trim();
  if (!sandboxImage) {
    throw new Error('SANDBOX_IMAGE must be a non-empty Docker image name.');
  }

  return {
    workerId,
    databaseUrl,
    dbPoolMax: parsePositiveInt('DB_POOL_MAX', env.DB_POOL_MAX, 10),
    checkerUrl,
    checkerTimeoutMs: parsePositiveInt('CHECKER_TIMEOUT_MS', env.CHECKER_TIMEOUT_MS, 35_000),
    pollIntervalMs: parsePositiveInt('WORKER_POLL_INTERVAL_MS', env.WORKER_POLL_INTERVAL_MS, 1000),
    staleJobAfterSec: parsePositiveInt('STALE_JOB_AFTER_SEC', env.STALE_JOB_AFTER_SEC, 120),
    staleSweepIntervalMs: parsePositiveInt(
      'STALE_SWEEP_INTERVAL_MS',
      env.STALE_SWEEP_INTERVAL_MS,
      30_000,
    ),
    retryBackoffSec: parsePositiveInt('JOB_RETRY_BACKOFF_SEC', env.JOB_RETRY_BACKOFF_SEC, 5),
    maxLlmCallsPerLab: parsePositiveInt('MAX_LLM_CALLS_PER_LAB', env.MAX_LLM_CALLS_PER_LAB, 200),
    sandboxMode: rawSandboxMode,
    sandboxImage,
    dockerBinary: (env.DOCKER_BINARY ?? 'docker').trim() || 'docker',
    gppBinary: (env.GPP_BINARY ?? 'g++').trim() || 'g++',
    compileTimeoutMs: parsePositiveInt('COMPILE_TIMEOUT_MS', env.COMPILE_TIMEOUT_MS, 10_000),
  };
}
