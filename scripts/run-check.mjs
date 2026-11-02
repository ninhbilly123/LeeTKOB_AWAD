import { spawnSync } from 'node:child_process';
import process from 'node:process';

const action = process.argv[2];
if (!action) {
  console.error('Usage: node scripts/run-check.mjs <lint|format:check|typecheck|test>');
  process.exit(1);
}

const pythonCmd = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const actionMap = {
  lint: [
    { name: 'Gateway ESLint', command: npmCmd, args: ['run', 'lint', '--workspace=gateway'] },
    { name: 'Web ESLint', command: npmCmd, args: ['run', 'lint', '--workspace=web'] },
    { name: 'Checker Ruff Lint', command: pythonCmd, args: ['-m', 'ruff', 'check', 'checker'] },
  ],
  'format:check': [
    { name: 'Gateway Prettier', command: npmCmd, args: ['run', 'format:check', '--workspace=gateway'] },
    { name: 'Web Prettier', command: npmCmd, args: ['run', 'format:check', '--workspace=web'] },
    { name: 'Checker Ruff Format Check', command: pythonCmd, args: ['-m', 'ruff', 'format', '--check', 'checker'] },
  ],
  typecheck: [
    { name: 'Gateway Typecheck (tsc)', command: npmCmd, args: ['run', 'typecheck', '--workspace=gateway'] },
    { name: 'Web Typecheck (tsc)', command: npmCmd, args: ['run', 'typecheck', '--workspace=web'] },
    { name: 'Checker Typecheck (mypy)', command: pythonCmd, args: ['-m', 'mypy', 'checker/src', 'checker/tests'] },
  ],
  test: [
    { name: 'Gateway Tests (jest)', command: npmCmd, args: ['run', 'test', '--workspace=gateway'] },
    { name: 'Web Tests (vitest)', command: npmCmd, args: ['run', 'test', '--workspace=web'] },
    { name: 'Checker Tests (pytest)', command: pythonCmd, args: ['-m', 'pytest', 'checker'] },
  ],
};

const steps = actionMap[action];
if (!steps) {
  console.error(`Unknown check action: ${action}. Allowed: ${Object.keys(actionMap).join(', ')}`);
  process.exit(1);
}

console.log(`\n========================================`);
console.log(`Running check: ${action}`);
console.log(`========================================\n`);

for (const step of steps) {
  console.log(`--> [${step.name}] running: ${step.command} ${step.args.join(' ')}`);
  const result = spawnSync(step.command, step.args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });

  if (result.status !== 0) {
    console.error(`\n[FAILED] ${step.name} exited with status ${result.status}`);
    process.exit(result.status ?? 1);
  }
  console.log(`[PASSED] ${step.name}\n`);
}

console.log(`========================================`);
console.log(`All checks for "${action}" PASSED!`);
console.log(`========================================\n`);
