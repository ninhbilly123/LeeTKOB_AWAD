import { existsSync } from 'node:fs';
import { HttpCheckerClient } from './checker/checker-http.client';
import { loadWorkerConfig } from './config';
import { PostgresJobStore } from './queue/job-store';
import { JudgeWorker } from './queue/worker';
import { ProcessSandboxRunner } from './sandbox/process-runner';

function loadLocalEnv(): void {
  for (const envPath of ['.env', '../.env']) {
    if (existsSync(envPath) && typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(envPath);
      break;
    }
  }
}

async function bootstrap(): Promise<void> {
  loadLocalEnv();
  const config = loadWorkerConfig(process.env);
  const jobStore = new PostgresJobStore({
    databaseUrl: config.databaseUrl,
    poolMax: config.dbPoolMax,
  });
  const sandboxRunner = new ProcessSandboxRunner({
    gppBinary: config.gppBinary,
    compileTimeoutMs: config.compileTimeoutMs,
  });
  const checkerClient = new HttpCheckerClient({
    baseUrl: config.checkerUrl,
    timeoutMs: config.checkerTimeoutMs,
  });
  const worker = new JudgeWorker({
    workerId: config.workerId,
    jobStore,
    sandboxRunner,
    checkerClient,
    pollIntervalMs: config.pollIntervalMs,
    staleJobAfterSec: config.staleJobAfterSec,
    staleSweepIntervalMs: config.staleSweepIntervalMs,
    retryBackoffSec: config.retryBackoffSec,
    maxLlmCallsPerLab: config.maxLlmCallsPerLab,
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`[judge-worker] Received ${signal}; draining in-flight job and shutting down...`);
    await worker.stop();
    await jobStore.close();
    console.log('[judge-worker] Clean shutdown complete.');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  console.log(
    `[judge-worker] Starting id=${config.workerId} checkerUrl=${config.checkerUrl} pollMs=${config.pollIntervalMs}`,
  );
  await worker.start();
}

bootstrap().catch((err) => {
  console.error('[judge-worker] Fatal startup error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
