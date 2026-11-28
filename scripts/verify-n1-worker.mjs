#!/usr/bin/env node
/**
 * Task N1 End-to-End Acceptance Verifier (Stop Worker -> Submit -> Restart Worker -> Verify DB).
 *
 * Prerequisites:
 *   docker compose up -d --build
 *   docker compose exec gateway node dist/persistence/seed-demo.cli.js
 *
 * Usage:
 *   node scripts/verify-n1-worker.mjs
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import process from 'node:process';

const GATEWAY_URL = (process.env.GATEWAY_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const DB_USER = process.env.DATABASE_USER || 'leetkob';
const DB_NAME = process.env.DATABASE_NAME || 'leetkob';

function runCompose(args) {
  const res = spawnSync('docker', ['compose', ...args], {
    stdio: 'pipe',
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) {
    throw new Error(`docker compose ${args.join(' ')} failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout.trim();
}

function querySql(sql) {
  return runCompose([
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    DB_USER,
    '-d',
    DB_NAME,
    '-t',
    '-A',
    '-c',
    sql,
  ]);
}

async function httpJson(path, options = {}) {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${path}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== Task N1 Verification: Stop Worker -> Submit -> Restart Worker ===');

  console.log('1. Stopping judge-worker container...');
  runCompose(['stop', 'judge-worker']);

  console.log('2. Logging in as TA and creating a test C++ lab...');
  const taAuth = await httpJson('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'ta1', password: 'ta123' }),
  });

  const lab = await httpJson('/labs', {
    method: 'POST',
    headers: { Authorization: `Bearer ${taAuth.accessToken}` },
    body: JSON.stringify({
      classId: 'class_cs101',
      title: `N1 Durability Lab ${Date.now()}`,
      statement: 'Read two integers and print their sum.',
      deadline: '2099-12-31T23:59:59.000Z',
      cpuTimeLimitSec: 1,
      memoryLimitMb: 256,
      testCases: [
        { id: 'tc1', input: '2 3\n', expectedOutput: '5\n', isHidden: false },
        { id: 'tc2', input: '10 25\n', expectedOutput: '35\n', isHidden: true },
      ],
      constraints: [
        { id: 'C1', text: 'Do not call `std::sort`.', deduction: 3 },
      ],
    }),
  });
  console.log(`   Created lab: ${lab.id}`);

  console.log('3. Logging in as Student and submitting AC C++ solution while worker is STOPPED...');
  const studentAuth = await httpJson('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'student1', password: 'student123' }),
  });

  const sub = await httpJson(`/labs/${lab.id}/submissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${studentAuth.accessToken}`,
      'Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify({
      code: '#include <iostream>\nint main() { long long a, b; if (std::cin >> a >> b) std::cout << (a + b) << "\\n"; return 0; }\n',
    }),
  });
  console.log(`   Submitted: ${sub.id} (status=${sub.status})`);

  await sleep(1500);
  const queuedState = querySql(
    `SELECT pipeline_status || '|' || checker_status FROM submissions WHERE id = '${sub.id}';`,
  );
  console.log(`   DB state while worker stopped: ${queuedState}`);
  if (queuedState !== 'QUEUED|NOT_APPLICABLE') {
    throw new Error(`Expected QUEUED|NOT_APPLICABLE while stopped, got ${queuedState}`);
  }

  console.log('4. Starting judge-worker container...');
  runCompose(['start', 'judge-worker']);

  console.log('5. Waiting for worker to complete JUDGE and CHECK stages...');
  let finalRow = '';
  for (let i = 0; i < 40; i += 1) {
    finalRow = querySql(
      `SELECT pipeline_status || '|' || COALESCE(overall_verdict, '') || '|' || checker_status FROM submissions WHERE id = '${sub.id}';`,
    );
    if (finalRow === 'COMPLETED|AC|COMPLETED') {
      break;
    }
    await sleep(500);
  }
  if (finalRow !== 'COMPLETED|AC|COMPLETED') {
    throw new Error(`Timed out waiting for COMPLETED|AC|COMPLETED; last state: ${finalRow}`);
  }

  const testRowCount = Number(
    querySql(`SELECT COUNT(*) FROM submission_test_results WHERE submission_id = '${sub.id}';`),
  );
  const findingRowCount = Number(
    querySql(`SELECT COUNT(*) FROM constraint_findings WHERE submission_id = '${sub.id}';`),
  );

  console.log(
    `   PASS! Final state=${finalRow}, test_results=${testRowCount} (expected 2), findings=${findingRowCount} (expected 1).`,
  );
  if (testRowCount !== 2 || findingRowCount !== 1) {
    throw new Error('Unexpected row counts after worker execution.');
  }
}

main().catch((err) => {
  console.error('N1 verification FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
