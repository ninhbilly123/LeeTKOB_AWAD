import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildCompileDockerArgs,
  buildRunDockerArgs,
  buildSafeDockerCliEnv,
  classifyRunOutcome,
  DEFAULT_SANDBOX_IMAGE,
  DockerSandboxRunner,
  type DockerCommandExecutor,
  type DockerExecOptions,
  type DockerExecResult,
} from '../src/sandbox/docker-runner';
import type { SubmissionJob } from '../src/types';

function makeSampleJob(overrides: Partial<SubmissionJob> = {}): SubmissionJob {
  return {
    id: 'job_docker_test',
    submissionId: 'sub_docker_test',
    labId: 'lab_sort_1',
    studentId: 'std_23120244',
    code: '#include <iostream>\nint main(){ int a,b; std::cin>>a>>b; std::cout<<a+b<<"\\n"; }',
    submittedAt: '2026-11-28T00:00:00.000Z',
    limits: {
      cpuTimeSec: 1,
      wallTimeSec: 3,
      memoryMb: 256,
      maxProcesses: 16,
      outputLimitBytes: 1_048_576,
    },
    testCases: [{ id: 'tc1', input: '2 3\n', expectedOutput: '5\n' }],
    constraints: [],
    status: 'PENDING',
    createdAt: '2026-11-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('Task N2: Hardened DockerSandboxRunner & 9 Rubric Attack Files (Offline Unit Specs)', () => {
  it('enforces all 9 isolation minimums in compile & run docker arguments with zero forbidden flags', () => {
    const compileArgs = buildCompileDockerArgs('leetkob-cmp-1', DEFAULT_SANDBOX_IMAGE);
    const runArgs = buildRunDockerArgs('leetkob-run-1', DEFAULT_SANDBOX_IMAGE, {
      cpuTimeSec: 1,
      memoryMb: 256,
      maxProcesses: 16,
      outputLimitBytes: 1_048_576,
    });

    for (const args of [compileArgs, runArgs]) {
      const joined = args.join(' ');
      // Mandatory isolation flags
      expect(joined).toContain('--network none');
      expect(joined).toContain('--read-only');
      expect(joined).toContain('--tmpfs /tmp:rw,exec,nosuid,nodev');
      expect(joined).toContain('--user 65534:65534');
      expect(joined).toContain('--cap-drop ALL');
      expect(joined).toContain('--security-opt no-new-privileges');
      expect(joined).toContain('--cpus 1');

      // Forbidden flags (Criterion 2 & Catching your assistant)
      expect(args).not.toContain('-v');
      expect(args).not.toContain('--volume');
      expect(args).not.toContain('--mount');
      expect(args).not.toContain('--privileged');
      expect(args).not.toContain('--env-file');
      expect(args).not.toContain('-e');
      expect(joined).not.toMatch(/docker\.sock|API_KEY|SECRET/i);
    }

    // Memory swap strictly equals memory limit (swap disabled) and pids limit matches FAQ-05
    expect(runArgs.join(' ')).toContain('--memory 256m --memory-swap 256m');
    expect(runArgs.join(' ')).toContain('--pids-limit 16');
  });

  it('strips all secrets from the environment passed to docker CLI subprocesses', () => {
    const safe = buildSafeDockerCliEnv({
      PATH: '/usr/bin',
      DOCKER_HOST: 'tcp://docker-proxy:2375',
      GEMINI_API_KEY: 'should-not-leak',
      MODEL_API_KEY: 'should-not-leak',
      DATABASE_URL: 'postgresql://secret',
      JWT_SECRET: 'top-secret',
    });
    expect(safe.PATH).toBe('/usr/bin');
    expect(safe.DOCKER_HOST).toBe('tcp://docker-proxy:2375');
    expect(safe.GEMINI_API_KEY).toBeUndefined();
    expect(safe.MODEL_API_KEY).toBeUndefined();
    expect(safe.DATABASE_URL).toBeUndefined();
    expect(safe.JWT_SECRET).toBeUndefined();
  });

  it('classifies OOMKilled -> MLE, wall-clock & SIGXCPU -> TLE, output cap -> RE, and stdout match -> AC/WA', () => {
    expect(
      classifyRunOutcome({
        timedOut: false,
        outputExceeded: false,
        oomKilled: true,
        exitCode: 137,
        stdout: '',
        expectedOutput: '5\n',
        durationMs: 120,
        cpuTimeSec: 1,
      }),
    ).toBe('MLE');

    expect(
      classifyRunOutcome({
        timedOut: true,
        outputExceeded: false,
        oomKilled: false,
        exitCode: 137,
        stdout: '',
        expectedOutput: '5\n',
        durationMs: 3001,
        cpuTimeSec: 1,
      }),
    ).toBe('TLE');

    expect(
      classifyRunOutcome({
        timedOut: false,
        outputExceeded: false,
        oomKilled: false,
        exitCode: 152,
        stdout: '',
        expectedOutput: '5\n',
        durationMs: 1050,
        cpuTimeSec: 1,
      }),
    ).toBe('TLE');

    expect(
      classifyRunOutcome({
        timedOut: false,
        outputExceeded: true,
        oomKilled: false,
        exitCode: 137,
        stdout: 'AAA',
        expectedOutput: '5\n',
        durationMs: 40,
        cpuTimeSec: 1,
      }),
    ).toBe('RE');

    expect(
      classifyRunOutcome({
        timedOut: false,
        outputExceeded: false,
        oomKilled: false,
        exitCode: 0,
        stdout: '5  \r\n\n',
        expectedOutput: '5\n',
        durationMs: 10,
        cpuTimeSec: 1,
      }),
    ).toBe('AC');
  });

  it('compiles inside sandbox, streams binary+input via stdin, cleans up containers, and maps CE/MLE/TLE', async () => {
    const removed: string[] = [];
    const calls: string[][] = [];
    let simulateOom = false;
    let simulateCompileError = false;

    const fakeExecutor: DockerCommandExecutor = {
      run: async (args: string[], options: DockerExecOptions): Promise<DockerExecResult> => {
        calls.push(args);
        const mode = args[args.indexOf(DEFAULT_SANDBOX_IMAGE) + 1];
        if (mode === 'compile') {
          if (simulateCompileError) {
            return {
              exitCode: 1,
              signal: null,
              stdout: Buffer.alloc(0),
              stderr: '/tmp/solution.cpp:1:10: fatal error: /app/.env: No such file or directory',
              timedOut: false,
              outputExceeded: false,
              durationMs: 80,
            };
          }
          return {
            exitCode: 0,
            signal: null,
            stdout: Buffer.from('FAKE_ELF_BINARY'),
            stderr: '',
            timedOut: false,
            outputExceeded: false,
            durationMs: 150,
          };
        }

        // Verify zero-mount framed stdin carries binary length + binary + test input
        expect(Buffer.isBuffer(options.stdin)).toBe(true);
        expect((options.stdin as Buffer).toString('utf8')).toBe('15\nFAKE_ELF_BINARY2 3\n');

        return {
          exitCode: simulateOom ? 137 : 0,
          signal: null,
          stdout: simulateOom ? Buffer.alloc(0) : Buffer.from('5\n'),
          stderr: '',
          timedOut: false,
          outputExceeded: false,
          durationMs: 25,
        };
      },
      inspectContainer: async () => ({
        oomKilled: simulateOom,
        exitCode: simulateOom ? 137 : 0,
      }),
      removeContainer: async (name: string) => {
        removed.push(name);
      },
    };

    const runner = new DockerSandboxRunner({ executor: fakeExecutor });

    // AC path
    const acRes = await runner.evaluate(makeSampleJob());
    expect(acRes.overallVerdict).toBe('AC');
    expect(acRes.testResults).toHaveLength(1);
    expect(removed).toHaveLength(2); // compile + run container both removed

    // MLE path
    simulateOom = true;
    const mleRes = await runner.evaluate(makeSampleJob());
    expect(mleRes.overallVerdict).toBe('MLE');

    // CE path scrubs /tmp prefix
    simulateOom = false;
    simulateCompileError = true;
    const ceRes = await runner.evaluate(makeSampleJob());
    expect(ceRes.overallVerdict).toBe('CE');
    expect(ceRes.compileOutput).toContain('solution.cpp:1:10:');
    expect(ceRes.compileOutput).not.toContain('/tmp/solution.cpp');
  });

  it('includes all 9 rubric attack C++ files (with memory read-back in row 4) plus sanity AC', () => {
    const attacksDir = join(__dirname, '..', 'attacks');
    const requiredFiles = [
      '00_sanity_ac.cpp',
      '01_network_egress.cpp',
      '02_cpu_time_limit.cpp',
      '03_wall_clock_container_kill.cpp',
      '04_memory_no_swap_readback.cpp',
      '05_fork_bomb_pids.cpp',
      '06_output_flood.cpp',
      '07_non_root_uid.cpp',
      '08_no_host_mount_or_docker_sock.cpp',
      '09a_no_secrets_env_and_files.cpp',
      '09b_no_secrets_include.cpp',
    ];
    for (const file of requiredFiles) {
      expect(existsSync(join(attacksDir, file))).toBe(true);
    }

    // Rubric Catching-your-assistant check: Row 4 MUST read back allocated memory into volatile checksum
    const memSrc = readFileSync(join(attacksDir, '04_memory_no_swap_readback.cpp'), 'utf8');
    expect(memSrc).toContain('volatile');
    expect(memSrc).toContain('checksum = checksum + buf[i]');
  });
});
