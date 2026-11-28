import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  JudgeVerdict,
  SandboxExecutionResult,
  SubmissionJob,
  SubmissionTestResult,
} from '../types';
import { computeOverallVerdict, outputsMatch, scrubCompileOutput } from './output-compare';
import type { SandboxRunner } from './runner.interface';

export interface ProcessSandboxOptions {
  gppBinary?: string;
  compileTimeoutMs?: number;
}

interface ExecResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputExceeded: boolean;
  durationMs: number;
}

function runSubprocess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    stdin?: string;
    timeoutMs: number;
    maxOutputBytes: number;
    env?: NodeJS.ProcessEnv;
  },
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let outputExceeded = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > options.maxOutputBytes) {
        outputExceeded = true;
        child.kill('SIGKILL');
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= options.maxOutputBytes) {
        stderrChunks.push(chunk);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({
          exitCode,
          signal,
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          timedOut,
          outputExceeded,
          durationMs: Math.max(0, Date.now() - started),
        });
      }
    });

    child.stdin.on('error', () => {
      // Ignore EPIPE when the program terminates before consuming stdin
    });
    if (options.stdin !== undefined) {
      child.stdin.end(options.stdin);
    } else {
      child.stdin.end();
    }
  });
}

/**
 * Local g++ -std=c++17 -O2 runner for Task N1 queue/worker verification.
 * Note: Task N2 replaces this with DockerSandboxRunner (--network none, --read-only,
 * --cap-drop ALL, --pids-limit, --memory, seccomp, non-root) for untrusted code.
 */
export class ProcessSandboxRunner implements SandboxRunner {
  private readonly gppBinary: string;
  private readonly compileTimeoutMs: number;

  constructor(options: ProcessSandboxOptions = {}) {
    this.gppBinary = options.gppBinary ?? 'g++';
    this.compileTimeoutMs = options.compileTimeoutMs ?? 10_000;
  }

  async evaluate(job: SubmissionJob): Promise<SandboxExecutionResult> {
    const workDir = await mkdtemp(join(tmpdir(), 'leetkob-'));
    const sourcePath = join(workDir, 'solution.cpp');
    const binaryName = process.platform === 'win32' ? 'solution.exe' : 'solution';
    const binaryPath = join(workDir, binaryName);

    try {
      await writeFile(sourcePath, job.code, 'utf8');

      // Compile with minimal PATH only (never forward DATABASE_URL, JWT_SECRET, or API keys)
      const compileEnv: NodeJS.ProcessEnv = {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      };
      const compileRes = await runSubprocess(
        this.gppBinary,
        ['-std=c++17', '-O2', sourcePath, '-o', binaryPath],
        {
          cwd: workDir,
          timeoutMs: this.compileTimeoutMs,
          maxOutputBytes: 256 * 1024,
          env: compileEnv,
        },
      );

      if (compileRes.timedOut || compileRes.exitCode !== 0) {
        const rawDiag = compileRes.timedOut
          ? 'Compilation exceeded the 10-second time limit.'
          : compileRes.stderr || compileRes.stdout || 'Compilation failed.';
        return {
          overallVerdict: 'CE',
          compileOutput: scrubCompileOutput(rawDiag, workDir),
          testResults: [],
          maxTimeMs: null,
          maxMemoryKb: null,
        };
      }

      const wallLimitMs = Math.max(1000, job.limits.wallTimeSec * 1000);
      const outputLimitBytes = Math.max(1024, job.limits.outputLimitBytes);
      const testResults: SubmissionTestResult[] = [];
      let maxTimeMs = 0;

      for (let idx = 0; idx < job.testCases.length; idx += 1) {
        const tc = job.testCases[idx];
        const runRes = await runSubprocess(binaryPath, [], {
          cwd: workDir,
          stdin: tc.input,
          timeoutMs: wallLimitMs,
          maxOutputBytes: outputLimitBytes,
          env: {},
        });

        let verdict: JudgeVerdict;
        if (runRes.timedOut) {
          verdict = 'TLE';
        } else if (runRes.outputExceeded || runRes.signal !== null || runRes.exitCode !== 0) {
          verdict = 'RE';
        } else if (outputsMatch(runRes.stdout, tc.expectedOutput)) {
          verdict = 'AC';
        } else {
          verdict = 'WA';
        }

        if (runRes.durationMs > maxTimeMs) {
          maxTimeMs = runRes.durationMs;
        }
        testResults.push({
          ordinal: idx + 1,
          verdict,
          timeMs: runRes.durationMs,
          memoryKb: null,
        });
      }

      return {
        overallVerdict: computeOverallVerdict(testResults),
        compileOutput: null,
        testResults,
        maxTimeMs: testResults.length > 0 ? maxTimeMs : null,
        maxMemoryKb: null,
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}
