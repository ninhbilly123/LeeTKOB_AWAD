import type { JudgeVerdict, SubmissionTestResult } from '../types';

const MAX_COMPILE_OUTPUT_BYTES = 16 * 1024;

/**
 * Normalizes program output per FAQ-05:
 * - normalizes CRLF to LF
 * - strips trailing spaces/tabs on every line
 * - strips trailing empty lines at EOF
 */
export function normalizeOutput(raw: string): string {
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const trimmed = lines.map((line) => line.replace(/[ \t]+$/g, ''));
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') {
    trimmed.pop();
  }
  return trimmed.join('\n');
}

export function outputsMatch(actual: string, expected: string): boolean {
  return normalizeOutput(actual) === normalizeOutput(expected);
}

/**
 * Removes temporary host/container directory prefixes from g++ diagnostics so students
 * only see `solution.cpp` (FAQ-02).
 */
export function scrubCompileOutput(raw: string, workDir: string): string {
  const normalizedDir = workDir.replace(/\\/g, '/').replace(/\/+$/g, '');
  let cleaned = raw.replace(/\\/g, '/');
  if (normalizedDir.length > 0) {
    cleaned = cleaned.split(`${normalizedDir}/`).join('');
    cleaned = cleaned.split(normalizedDir).join('');
  }
  cleaned = cleaned.replace(/\/tmp\/leetkob-[a-zA-Z0-9_-]+\//g, '');
  cleaned = cleaned.trim();

  if (Buffer.byteLength(cleaned, 'utf8') > MAX_COMPILE_OUTPUT_BYTES) {
    const truncated = Buffer.from(cleaned, 'utf8')
      .subarray(0, MAX_COMPILE_OUTPUT_BYTES)
      .toString('utf8');
    return `${truncated}\n... [compile output truncated]`;
  }
  return cleaned;
}

/**
 * Computes overall verdict per FAQ-04:
 * AC iff every test case passes; otherwise the first non-AC verdict by ordinal.
 */
export function computeOverallVerdict(results: ReadonlyArray<SubmissionTestResult>): JudgeVerdict {
  const sorted = [...results].sort((a, b) => a.ordinal - b.ordinal);
  const firstFailure = sorted.find((r) => r.verdict !== 'AC');
  return firstFailure ? firstFailure.verdict : 'AC';
}
