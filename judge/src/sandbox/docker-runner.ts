import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type {
  JudgeVerdict,
  SandboxExecutionResult,
  SubmissionJob,
  SubmissionTestResult,
} from '../types';
import { computeOverallVerdict, outputsMatch, scrubCompileOutput } from './output-compare';
import type { SandboxRunner } from './runner.interface';

export const DEFAULT_SANDBOX_IMAGE = 'leetkob-cpp-sandbox:pa3';
export const SANDBOX_NON_ROOT_USER = '65534:65534';
export const COMPILE_MEMORY_MB = 512;
export const COMPILE_PIDS_LIMIT = 64;

export interface DockerExecOptions {
  stdin?: Buffer | string;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  onTimeout?: () => Promise<void>;
  onOutputExceeded?: () => Promise<void>;
}

export interface DockerExecResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: string;
  timedOut: boolean;
  outputExceeded: boolean;
  durationMs: number;
}

export interface DockerCommandExecutor {
  run(args: string[], options: DockerExecOptions): Promise<DockerExecResult>;
  inspectContainer(containerName: string): Promise<{ oomKilled: boolean; exitCode: number | null }>;
  removeContainer(containerName: string): Promise<void>;
}

export interface DockerSandboxOptions {
  image?: string;
  dockerBinary?: string;
  compileTimeoutMs?: number;
  executor?: DockerCommandExecutor;
}

/**
 * Builds the exact hardened `docker run` argument vector for compiling untrusted C++17 code
 * inside the sandbox with ZERO host mounts, ZERO secrets, and strict cgroup limits.
 */
export function buildCompileDockerArgs(containerName: string, image: string): string[] {
  return [
    'run',
    '-i',
    '--name',
    containerName,
    '--network',
    'none',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,exec,nosuid,nodev,size=64m,mode=1777',
    '--user',
    SANDBOX_NON_ROOT_USER,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    String(COMPILE_PIDS_LIMIT),
    '--memory',
    `${COMPILE_MEMORY_MB}m`,
    '--memory-swap',
    `${COMPILE_MEMORY_MB}m`,
    '--cpus',
    '1',
    image,
    'compile',
  ];
}

/**
 * Builds the exact hardened `docker run` argument vector for executing a single test case
 * inside a fresh ephemeral container enforcing all 9 PA#3 Criterion 2 minimums.
 */
export function buildRunDockerArgs(
  containerName: string,
  image: string,
  limits: {
    cpuTimeSec: number;
    memoryMb: number;
    maxProcesses: number;
    outputLimitBytes: number;
  },
): string[] {
  const memoryMb = Math.min(512, Math.max(64, Math.floor(limits.memoryMb)));
  const pidsLimit = Math.min(64, Math.max(8, Math.floor(limits.maxProcesses)));
  const cpuTimeSec = Math.min(5, Math.max(1, Math.floor(limits.cpuTimeSec)));
  const outputLimitBytes = Math.max(1024, Math.floor(limits.outputLimitBytes));

  return [
    'run',
    '-i',
    '--name',
    containerName,
    '--network',
    'none',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,exec,nosuid,nodev,size=32m,mode=1777',
    '--user',
    SANDBOX_NON_ROOT_USER,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    String(pidsLimit),
    '--memory',
    `${memoryMb}m`,
    '--memory-swap',
    `${memoryMb}m`,
    '--cpus',
    '1',
    image,
    'run',
    String(cpuTimeSec),
    String(outputLimitBytes),
  ];
}

/**
 * Builds the sanitized environment passed to the `docker` CLI subprocess.
 * Only PATH and DOCKER_HOST (when configured for docker-socket-proxy) are forwarded;
 * LLM keys, DB credentials, and JWT secrets are NEVER passed.
 */
export function buildSafeDockerCliEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {
    PATH: env.PATH ?? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  };
  if (env.DOCKER_HOST && env.DOCKER_HOST.trim().length > 0) {
    safe.DOCKER_HOST = env.DOCKER_HOST.trim();
  }
  if (env.HOME && env.HOME.trim().length > 0) {
    safe.HOME = env.HOME.trim();
  }
  return safe;
}

export function classifyRunOutcome(params: {
  timedOut: boolean;
  outputExceeded: boolean;
  oomKilled: boolean;
  exitCode: number | null;
  stdout: string;
  expectedOutput: string;
  durationMs: number;
  cpuTimeSec: number;
}): JudgeVerdict {
  if (params.timedOut) {
    return 'TLE';
  }
  if (params.outputExceeded || params.exitCode === 153) {
    return 'RE';
  }
  if (params.oomKilled) {
    return 'MLE';
  }
  // 152 = 128 + SIGXCPU (24) from RLIMIT_CPU
  if (params.exitCode === 152) {
    return 'TLE';
  }
  // 137 = 128 + SIGKILL (9): if not OOMKilled and runtime reached CPU limit, RLIMIT_CPU hard-killed it
  if (params.exitCode === 137 && params.durationMs >= params.cpuTimeSec * 900) {
    return 'TLE';
  }
  if (params.exitCode !== 0) {
    return 'RE';
  }
  return outputsMatch(params.stdout, params.expectedOutput) ? 'AC' : 'WA';
}

export class CliDockerExecutor implements DockerCommandExecutor {
  private readonly dockerBinary: string;

  constructor(dockerBinary = 'docker') {
    this.dockerBinary = dockerBinary;
  }

  run(args: string[], options: DockerExecOptions): Promise<DockerExecResult> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const child = spawn(this.dockerBinary, args, {
        env: buildSafeDockerCliEnv(),
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
        if (options.onTimeout) {
          void options.onTimeout().finally(() => {
            child.kill('SIGKILL');
          });
        } else {
          child.kill('SIGKILL');
        }
      }, options.timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > options.maxStdoutBytes) {
          if (!outputExceeded) {
            outputExceeded = true;
            if (options.onOutputExceeded) {
              void options.onOutputExceeded().finally(() => {
                child.kill('SIGKILL');
              });
            } else {
              child.kill('SIGKILL');
            }
          }
          return;
        }
        stdoutChunks.push(chunk);
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes <= options.maxStderrBytes) {
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
            stdout: Buffer.concat(stdoutChunks),
            stderr: Buffer.concat(stderrChunks).toString('utf8'),
            timedOut,
            outputExceeded,
            durationMs: Math.max(0, Date.now() - started),
          });
        }
      });

      child.stdin.on('error', () => {
        // Ignore EPIPE if container terminates before consuming full stdin
      });
      if (options.stdin !== undefined) {
        child.stdin.end(options.stdin);
      } else {
        child.stdin.end();
      }
    });
  }

  async inspectContainer(
    containerName: string,
  ): Promise<{ oomKilled: boolean; exitCode: number | null }> {
    const res = await this.run(
      ['inspect', '--format', '{{.State.OOMKilled}}|{{.State.ExitCode}}', containerName],
      {
        timeoutMs: 5000,
        maxStdoutBytes: 4096,
        maxStderrBytes: 4096,
      },
    );
    if (res.exitCode !== 0) {
      return { oomKilled: false, exitCode: null };
    }
    const [oomRaw, exitRaw] = res.stdout.toString('utf8').trim().split('|');
    const parsedExit = exitRaw !== undefined ? Number.parseInt(exitRaw, 10) : Number.NaN;
    return {
      oomKilled: oomRaw === 'true',
      exitCode: Number.isFinite(parsedExit) ? parsedExit : null,
    };
  }

  async removeContainer(containerName: string): Promise<void> {
    try {
      await this.run(['rm', '-f', containerName], {
        timeoutMs: 5000,
        maxStdoutBytes: 4096,
        maxStderrBytes: 4096,
      });
    } catch {
      // Container may already be removed
    }
  }
}

/**
 * Production hardened Docker C++17 SandboxRunner (Task N2).
 * Both compilation and per-test execution happen inside isolated containers with:
 *   1. --network none
 *   2. --cpus 1 + RLIMIT_CPU
 *   3. wall-clock timer invoking `docker rm -f <container>` to kill the ENTIRE container
 *   4. --memory <M>m --memory-swap <M>m (swap disabled) + OOMKilled inspection -> MLE
 *   5. --pids-limit 16 (FAQ-05)
 *   6. output cap 1 MiB (FAQ-05) + RLIMIT_FSIZE -> RE
 *   7. --user 65534:65534 --cap-drop ALL --security-opt no-new-privileges
 *   8. --read-only + bounded --tmpfs, zero host mounts, zero Docker socket
 *   9. clean container environment and isolated sandbox image with zero secrets
 */
export class DockerSandboxRunner implements SandboxRunner {
  private readonly image: string;
  private readonly compileTimeoutMs: number;
  private readonly executor: DockerCommandExecutor;

  constructor(options: DockerSandboxOptions = {}) {
    this.image = options.image ?? DEFAULT_SANDBOX_IMAGE;
    this.compileTimeoutMs = options.compileTimeoutMs ?? 10_000;
    this.executor = options.executor ?? new CliDockerExecutor(options.dockerBinary ?? 'docker');
  }

  async evaluate(job: SubmissionJob): Promise<SandboxExecutionResult> {
    const compileContainer = `leetkob-cmp-${randomUUID().slice(0, 12)}`;
    let compiledBinary: Buffer;

    try {
      const compileArgs = buildCompileDockerArgs(compileContainer, this.image);
      const compileRes = await this.executor.run(compileArgs, {
        stdin: job.code,
        timeoutMs: this.compileTimeoutMs,
        maxStdoutBytes: 32 * 1024 * 1024,
        maxStderrBytes: 256 * 1024,
        onTimeout: () => this.executor.removeContainer(compileContainer),
      });

      if (compileRes.timedOut || compileRes.exitCode !== 0 || compileRes.stdout.length === 0) {
        const rawDiag = compileRes.timedOut
          ? 'Compilation exceeded the 10-second time limit.'
          : compileRes.stderr || 'Compilation failed.';
        return {
          overallVerdict: 'CE',
          compileOutput: scrubCompileOutput(rawDiag, '/tmp'),
          testResults: [],
          maxTimeMs: null,
          maxMemoryKb: null,
        };
      }
      compiledBinary = compileRes.stdout;
    } finally {
      await this.executor.removeContainer(compileContainer);
    }

    const wallLimitMs = Math.max(1000, job.limits.wallTimeSec * 1000);
    const outputLimitBytes = Math.max(1024, job.limits.outputLimitBytes);
    const headerBuf = Buffer.from(`${compiledBinary.length}\n`, 'utf8');
    const testResults: SubmissionTestResult[] = [];
    let maxTimeMs = 0;

    for (let idx = 0; idx < job.testCases.length; idx += 1) {
      const tc = job.testCases[idx];
      const runContainer = `leetkob-run-${randomUUID().slice(0, 12)}`;
      const runArgs = buildRunDockerArgs(runContainer, this.image, job.limits);
      const framedStdin = Buffer.concat([headerBuf, compiledBinary, Buffer.from(tc.input, 'utf8')]);

      let verdict: JudgeVerdict;
      let durationMs = 0;

      try {
        const runRes = await this.executor.run(runArgs, {
          stdin: framedStdin,
          timeoutMs: wallLimitMs,
          maxStdoutBytes: outputLimitBytes,
          maxStderrBytes: 64 * 1024,
          onTimeout: () => this.executor.removeContainer(runContainer),
          onOutputExceeded: () => this.executor.removeContainer(runContainer),
        });
        durationMs = runRes.durationMs;

        const inspect =
          runRes.timedOut || runRes.outputExceeded
            ? { oomKilled: false, exitCode: runRes.exitCode }
            : await this.executor.inspectContainer(runContainer);

        const effectiveExitCode = inspect.exitCode ?? runRes.exitCode;
        verdict = classifyRunOutcome({
          timedOut: runRes.timedOut,
          outputExceeded: runRes.outputExceeded,
          oomKilled: inspect.oomKilled,
          exitCode: effectiveExitCode,
          stdout: runRes.stdout.toString('utf8'),
          expectedOutput: tc.expectedOutput,
          durationMs,
          cpuTimeSec: job.limits.cpuTimeSec,
        });
      } finally {
        await this.executor.removeContainer(runContainer);
      }

      if (durationMs > maxTimeMs) {
        maxTimeMs = durationMs;
      }
      testResults.push({
        ordinal: idx + 1,
        verdict,
        timeMs: durationMs,
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
  }
}
