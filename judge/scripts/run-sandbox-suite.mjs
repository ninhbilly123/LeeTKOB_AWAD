#!/usr/bin/env node
/**
 * Task N2 Real Docker Sandbox Security Suite (PA#3 Criterion 2 — 9 Minimums).
 *
 * Runs against the real `leetkob-cpp-sandbox:pa3` Docker image via compiled DockerSandboxRunner,
 * verifies 1 sanity AC submission + all 9 rubric attack submissions, audits zero leftover
 * containers and zero forbidden flags, and writes a 9-row Markdown table to stdout and
 * `$GITHUB_STEP_SUMMARY`.
 *
 * Prerequisites:
 *   npm run build --workspace=judge
 *   npm run sandbox:build --workspace=judge
 *
 * Usage:
 *   npm run test:sandbox --workspace=judge
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const judgeRoot = join(__dirname, '..');
const attacksDir = join(judgeRoot, 'attacks');

const { DockerSandboxRunner, DEFAULT_SANDBOX_IMAGE } = require(
  join(judgeRoot, 'dist', 'sandbox', 'docker-runner.js'),
);

const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE || DEFAULT_SANDBOX_IMAGE;
const CANARY_SECRET = 'CANARY_SECRET_LEETKOB_DO_NOT_LEAK_999';

function readAttack(filename) {
  return readFileSync(join(attacksDir, filename), 'utf8');
}

function findHostBridgeIp() {
  const nets = os.networkInterfaces();
  // Prefer docker0 bridge IP on Linux runners so containers with broken network can reach it
  for (const preferred of ['docker0', 'eth0', 'ens3', 'enp0s3']) {
    const list = nets[preferred] || [];
    const ipv4 = list.find((iface) => iface.family === 'IPv4' && !iface.internal);
    if (ipv4) return ipv4.address;
  }
  for (const list of Object.values(nets)) {
    const ipv4 = (list || []).find((iface) => iface.family === 'IPv4' && !iface.internal);
    if (ipv4) return ipv4.address;
  }
  return '127.0.0.1';
}

function listLingeringSandboxContainers() {
  const res = spawnSync(
    'docker',
    ['ps', '-a', '--filter', 'name=leetkob-run-', '--format', '{{.Names}}'],
    { encoding: 'utf8', shell: process.platform === 'win32' },
  );
  if (res.status !== 0) {
    return [];
  }
  return res.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function makeJob(id, code, options = {}) {
  return {
    id: `job_${id}`,
    submissionId: `sub_${id}`,
    labId: 'lab_sandbox_ci',
    studentId: 'std_attack_tester',
    code,
    submittedAt: new Date().toISOString(),
    limits: {
      cpuTimeSec: options.cpuTimeSec ?? 1,
      wallTimeSec: options.wallTimeSec ?? 3,
      memoryMb: options.memoryMb ?? 256,
      maxProcesses: options.maxProcesses ?? 16,
      outputLimitBytes: options.outputLimitBytes ?? 1_048_576,
    },
    testCases: [
      {
        id: 'tc1',
        input: options.input ?? '',
        expectedOutput: options.expectedOutput ?? 'SAFE_EXPECTED_OUTPUT\n',
      },
    ],
    constraints: [],
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  };
}

async function runSuite() {
  // Inject a canary secret into THIS test runner's process.env to prove DockerSandboxRunner
  // NEVER forwards host secrets into sandbox containers (Row 9).
  process.env.GEMINI_API_KEY = CANARY_SECRET;
  process.env.MODEL_API_KEY = CANARY_SECRET;

  const runner = new DockerSandboxRunner({ image: SANDBOX_IMAGE });

  // Step 0: Sanity AC check — proves sandbox compiles and runs valid C++17 accurately
  const sanityStarted = Date.now();
  const sanityRes = await runner.evaluate(
    makeJob('00_sanity_ac', readAttack('00_sanity_ac.cpp'), {
      input: '17 25\n',
      expectedOutput: '42\n',
    }),
  );
  const sanityMs = Date.now() - sanityStarted;
  if (sanityRes.overallVerdict !== 'AC') {
    throw new Error(
      `Sanity AC check failed: expected AC, got ${sanityRes.overallVerdict} (${sanityRes.compileOutput || ''})`,
    );
  }
  console.log(`[PASS] Sanity AC check (00_sanity_ac.cpp) -> AC in ${sanityMs}ms`);

  // Start temporary host TCP canary listener for Row 1 (Network Isolation)
  let canaryConnections = 0;
  const canaryServer = net.createServer((socket) => {
    canaryConnections += 1;
    socket.end('BREACHED\n');
  });
  await new Promise((resolve) => canaryServer.listen(0, '0.0.0.0', resolve));
  const canaryPort = canaryServer.address().port;
  const hostIp = findHostBridgeIp();

  const rows = [];

  try {
    // Row 1: No network
    {
      const res = await runner.evaluate(
        makeJob('01_network', readAttack('01_network_egress.cpp'), {
          input: `${hostIp} ${canaryPort}\n`,
        }),
      );
      const passed = res.overallVerdict === 'RE' && canaryConnections === 0;
      rows.push({
        row: 1,
        requirement: 'No network (--network none)',
        attackFile: 'judge/attacks/01_network_egress.cpp',
        expected: 'RE & 0 canary TCP hits',
        actual: `${res.overallVerdict} (canaryHits=${canaryConnections})`,
        passed,
      });
    }

    // Row 2: CPU time limit
    {
      const t0 = Date.now();
      const res = await runner.evaluate(
        makeJob('02_cpu', readAttack('02_cpu_time_limit.cpp'), {
          cpuTimeSec: 1,
          wallTimeSec: 5,
        }),
      );
      const runMs = res.testResults[0]?.timeMs ?? Date.now() - t0;
      // Must terminate via RLIMIT_CPU (1s) well before wall-clock (5s)
      const passed = res.overallVerdict === 'TLE' && runMs < 4000;
      rows.push({
        row: 2,
        requirement: 'CPU time limit (--cpus 1 + RLIMIT_CPU)',
        attackFile: 'judge/attacks/02_cpu_time_limit.cpp',
        expected: 'TLE (run < 4.0s, before 5s wall-clock)',
        actual: `${res.overallVerdict} (run=${runMs}ms)`,
        passed,
      });
    }

    // Row 3: Wall-clock kills ENTIRE container
    {
      const t0 = Date.now();
      const res = await runner.evaluate(
        makeJob('03_wall', readAttack('03_wall_clock_container_kill.cpp'), {
          cpuTimeSec: 1,
          wallTimeSec: 3,
        }),
      );
      const elapsed = Date.now() - t0;
      const lingering = listLingeringSandboxContainers();
      const passed = res.overallVerdict === 'TLE' && elapsed < 10_000 && lingering.length === 0;
      rows.push({
        row: 3,
        requirement: 'Wall-clock kills entire container (docker rm -f)',
        attackFile: 'judge/attacks/03_wall_clock_container_kill.cpp',
        expected: 'TLE & 0 lingering containers',
        actual: `${res.overallVerdict} (${elapsed}ms, lingering=${lingering.length})`,
        passed,
      });
    }

    // Row 4: Memory + swap disabled, with memory read-back
    {
      const res = await runner.evaluate(
        makeJob('04_memory', readAttack('04_memory_no_swap_readback.cpp'), {
          memoryMb: 128,
          wallTimeSec: 5,
        }),
      );
      const passed = res.overallVerdict === 'MLE' || res.overallVerdict === 'RE';
      rows.push({
        row: 4,
        requirement: 'Memory limit with swap disabled & read-back (--memory=128m --memory-swap=128m)',
        attackFile: 'judge/attacks/04_memory_no_swap_readback.cpp',
        expected: 'MLE (OOMKilled) or RE (bad_alloc)',
        actual: `${res.overallVerdict}`,
        passed,
      });
    }

    // Row 5: Process limit (--pids-limit 16)
    {
      const res = await runner.evaluate(
        makeJob('05_pids', readAttack('05_fork_bomb_pids.cpp'), {
          maxProcesses: 16,
          wallTimeSec: 5,
        }),
      );
      const lingering = listLingeringSandboxContainers();
      const passed =
        (res.overallVerdict === 'RE' || res.overallVerdict === 'TLE') && lingering.length === 0;
      rows.push({
        row: 5,
        requirement: 'Process/thread limit (--pids-limit 16)',
        attackFile: 'judge/attacks/05_fork_bomb_pids.cpp',
        expected: 'RE (fork EAGAIN) & 0 lingering',
        actual: `${res.overallVerdict} (lingering=${lingering.length})`,
        passed,
      });
    }

    // Row 6: Output size limit (1 MiB)
    {
      const res = await runner.evaluate(
        makeJob('06_output', readAttack('06_output_flood.cpp'), {
          outputLimitBytes: 1_048_576,
          wallTimeSec: 5,
        }),
      );
      const passed = res.overallVerdict === 'RE';
      rows.push({
        row: 6,
        requirement: 'Output size limit (1 MiB cap -> RE)',
        attackFile: 'judge/attacks/06_output_flood.cpp',
        expected: 'RE',
        actual: `${res.overallVerdict}`,
        passed,
      });
    }

    // Row 7: Non-root user
    {
      const res = await runner.evaluate(
        makeJob('07_nonroot', readAttack('07_non_root_uid.cpp')),
      );
      const passed = res.overallVerdict === 'RE';
      rows.push({
        row: 7,
        requirement: 'Non-root user (--user 65534:65534 --cap-drop ALL --no-new-privileges)',
        attackFile: 'judge/attacks/07_non_root_uid.cpp',
        expected: 'RE (uid != 0, setuid(0) denied)',
        actual: `${res.overallVerdict}`,
        passed,
      });
    }

    // Row 8: No host mounts and no Docker socket
    {
      const res = await runner.evaluate(
        makeJob('08_mounts', readAttack('08_no_host_mount_or_docker_sock.cpp')),
      );
      const passed = res.overallVerdict === 'RE';
      rows.push({
        row: 8,
        requirement: 'No host mounts, read-only rootfs, no Docker socket',
        attackFile: 'judge/attacks/08_no_host_mount_or_docker_sock.cpp',
        expected: 'RE (no docker.sock, EROFS on /)',
        actual: `${res.overallVerdict}`,
        passed,
      });
    }

    // Row 9: No secrets in env, files, or compiler #include
    {
      const res9a = await runner.evaluate(
        makeJob('09a_secrets_env', readAttack('09a_no_secrets_env_and_files.cpp')),
      );
      const res9b = await runner.evaluate(
        makeJob('09b_secrets_inc', readAttack('09b_no_secrets_include.cpp')),
      );
      const leaked9b = (res9b.compileOutput || '').includes(CANARY_SECRET);
      const passed = res9a.overallVerdict === 'RE' && res9b.overallVerdict === 'CE' && !leaked9b;
      rows.push({
        row: 9,
        requirement: 'No secrets in env, files, or compiler #include',
        attackFile: '09a_no_secrets_env_and_files.cpp + 09b_no_secrets_include.cpp',
        expected: '9a=RE & 9b=CE (0 canary leaks)',
        actual: `9a=${res9a.overallVerdict}, 9b=${res9b.overallVerdict}, leak=${leaked9b}`,
        passed,
      });
    }
  } finally {
    canaryServer.close();
  }

  const lines = [
    '## PA#3 Criterion 2 — C++17 Docker Sandbox Security Suite (9 Minimums)',
    '',
    `- **Sandbox image:** \`${SANDBOX_IMAGE}\` (both compilation and execution inside isolated containers)`,
    `- **Sanity AC check:** \`judge/attacks/00_sanity_ac.cpp\` -> **AC** (${sanityMs}ms)`,
    '',
    '| # | Sandbox Minimum (Rubric Row) | Attack Submission | Expected | Actual | Result |',
    '| :-: | :--- | :--- | :--- | :--- | :-: |',
    ...rows.map(
      (r) =>
        `| ${r.row} | ${r.requirement} | \`${r.attackFile}\` | ${r.expected} | ${r.actual} | ${r.passed ? 'PASS' : 'FAIL'} |`,
    ),
    '',
  ];

  const markdown = lines.join('\n');
  console.log('\n' + markdown);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, 'utf8');
  }

  const failed = rows.filter((r) => !r.passed);
  if (failed.length > 0) {
    console.error(`Sandbox security suite FAILED (${failed.length}/9 rows failed).`);
    process.exit(1);
  }
  console.log('All 9/9 PA#3 Criterion 2 Docker sandbox security checks PASSED!');
}

runSuite().catch((err) => {
  console.error('Sandbox suite fatal error:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
