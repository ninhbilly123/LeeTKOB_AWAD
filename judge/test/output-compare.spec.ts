import { loadWorkerConfig } from '../src/config';
import {
  computeOverallVerdict,
  normalizeOutput,
  outputsMatch,
  scrubCompileOutput,
} from '../src/sandbox/output-compare';

describe('Output Comparison, Compile Scrubbing & Worker Config Security', () => {
  it('normalizes trailing spaces, CRLF, and trailing blank lines per FAQ-05', () => {
    expect(normalizeOutput('1 2 3   \r\n4 5\t \r\n\r\n')).toBe('1 2 3\n4 5');
    expect(outputsMatch('1 2 3  \n\n', '1 2 3\r\n')).toBe(true);
    expect(outputsMatch(' 1 2 3', '1 2 3')).toBe(false);
  });

  it('scrubs temporary work directory paths from g++ compiler diagnostics (FAQ-02)', () => {
    const raw =
      "/tmp/leetkob-abc123/solution.cpp:4:5: error: 'foo' was not declared in this scope\n" +
      'C:\\Users\\worker\\AppData\\Local\\Temp\\leetkob-xyz\\solution.cpp:4:5: note: here';
    const scrubbed = scrubCompileOutput(
      raw,
      'C:\\Users\\worker\\AppData\\Local\\Temp\\leetkob-xyz',
    );
    expect(scrubbed).not.toContain('/tmp/leetkob-abc123/');
    expect(scrubbed).not.toContain('C:/Users/worker');
    expect(scrubbed).toContain('solution.cpp:4:5: error:');
  });

  it('computes overall verdict as AC only when every test passes, otherwise first non-AC', () => {
    expect(
      computeOverallVerdict([
        { ordinal: 1, verdict: 'AC', timeMs: 5, memoryKb: null },
        { ordinal: 2, verdict: 'AC', timeMs: 8, memoryKb: null },
      ]),
    ).toBe('AC');
    expect(
      computeOverallVerdict([
        { ordinal: 3, verdict: 'TLE', timeMs: 1000, memoryKb: null },
        { ordinal: 1, verdict: 'AC', timeMs: 4, memoryKb: null },
        { ordinal: 2, verdict: 'WA', timeMs: 6, memoryKb: null },
      ]),
    ).toBe('WA');
  });

  it('refuses to start when GEMINI_API_KEY or MODEL_API_KEY is present in worker env (Criterion 2)', () => {
    expect(() =>
      loadWorkerConfig({
        DATABASE_URL: 'postgresql://leetkob:pass@postgres:5432/leetkob',
        GEMINI_API_KEY: 'AIza-test-should-fail',
      }),
    ).toThrow(/must NEVER be present in judge-worker environment/);

    expect(() =>
      loadWorkerConfig({
        DATABASE_URL: 'postgresql://leetkob:pass@postgres:5432/leetkob',
        MODEL_API_KEY: 'secret-token',
      }),
    ).toThrow(/must NEVER be present in judge-worker environment/);
  });

  it('validates DATABASE_URL and loads sane defaults without secrets', () => {
    expect(() => loadWorkerConfig({})).toThrow(/DATABASE_URL is required/);

    const cfg = loadWorkerConfig({
      DATABASE_URL: 'postgresql://leetkob:pass@postgres:5432/leetkob',
      CHECKER_URL: 'http://checker:8000/',
      MAX_LLM_CALLS_PER_LAB: '150',
    });
    expect(cfg.checkerUrl).toBe('http://checker:8000');
    expect(cfg.maxLlmCallsPerLab).toBe(150);
    expect(cfg.pollIntervalMs).toBe(1000);
  });
});
