/**
 * Tests for the batched-runner decision core.
 *
 * The runner itself is hard to test (it spawns Playwright and kills process trees), so every
 * decision that can be wrong lives in `e2e-batch-core.mjs` and is tested here. Each test names the
 * real failure it prevents.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILE_TIMEOUT_MS,
  FILE_TIMEOUTS_MS,
  WORKER_CRASH_EXIT,
  aggregate,
  buildSummary,
  fileTimeoutMs,
  pickPort,
  shouldRetry,
  validateKillTarget,
} from './e2e-batch-core.mjs';

describe('shouldRetry', () => {
  it('retries once on the recorded worker-crash exit code', () => {
    // 3221225794 == 0xC0000142, the code in docs/3B-1-STATUS.md and the handoff.
    expect(WORKER_CRASH_EXIT).toBe(3221225794);
    expect(shouldRetry(WORKER_CRASH_EXIT, '', 1)).toBe(true);
  });

  it('retries once on the crash text even when the exit code is a plain 1', () => {
    // Windows does not always propagate the NTSTATUS through a shell; the text is the fallback.
    expect(shouldRetry(1, 'browserContext.newPage: Target crashed', 1)).toBe(true);
    expect(shouldRetry(1, 'worker process exited unexpectedly (code=3221225794)', 1)).toBe(true);
  });

  it('NEVER retries an assertion failure', () => {
    /*
     * The one rule that matters most. A retried assertion failure turns a red test green in the
     * summary while the product stays broken — strictly worse than failing.
     */
    const output = [
      '  1 failed',
      '  [chromium] › tests/e2e/look.spec.ts:137:3 › 3.2 glare',
      '  Error: expect(received).toBeLessThanOrEqual(expected)',
      '  AssertionError: expected 284 to be <= 12',
    ].join('\n');
    expect(shouldRetry(1, output, 1)).toBe(false);
  });

  it('never retries a second time, even on a crash', () => {
    // "Retry ONCE": two crashes means the machine cannot run it, and looping wastes minutes.
    expect(shouldRetry(WORKER_CRASH_EXIT, 'Target crashed', 2)).toBe(false);
    expect(shouldRetry(WORKER_CRASH_EXIT, 'Target crashed', 3)).toBe(false);
  });

  it('does not retry an unrecognised non-zero exit', () => {
    expect(shouldRetry(1, 'some other error', 1)).toBe(false);
    expect(shouldRetry(2, '', 1)).toBe(false);
  });

  it('does not retry a clean exit', () => {
    expect(shouldRetry(0, 'all good', 1)).toBe(false);
  });
});

describe('pickPort', () => {
  it('gives each file its own port', () => {
    const used = [];
    const ports = [0, 1, 2].map((i) => {
      const p = pickPort(i, used);
      used.push(p);
      return p;
    });
    expect(new Set(ports).size).toBe(3);
    expect(ports).toEqual([4300, 4301, 4302]);
  });

  it('skips a port already used, which is what a retry needs', () => {
    // A retry reuses the same index but must not reuse the port: the dead server may still hold it.
    expect(pickPort(0, [4300])).toBe(4301);
    expect(pickPort(0, [4300, 4301])).toBe(4302);
  });

  it('is deterministic, so a run log names a reproducible port', () => {
    expect(pickPort(3, [4300, 4301])).toBe(4303);
  });

  it('is stable regardless of the order ports were used in', () => {
    expect(pickPort(1, [4302, 4300])).toBe(4301);
    expect(pickPort(1, [4300, 4302])).toBe(4301);
  });
});

describe('aggregate', () => {
  const file = (over) => ({
    file: 'a.spec.ts',
    ok: true,
    attempts: 1,
    retried: false,
    exitCode: 0,
    durationMs: 1000,
    port: 4300,
    ...over,
  });

  it('exits zero only when every file passed', () => {
    expect(aggregate([file({}), file({ file: 'b.spec.ts' })]).exitCode).toBe(0);
  });

  it('exits non-zero when an EARLIER file failed, even if the last one passed', () => {
    // The naive `for` loop that reports only `$?` loses exactly this case.
    const s = aggregate([
      file({ file: 'a.spec.ts', ok: false, exitCode: 1 }),
      file({ file: 'b.spec.ts', ok: true }),
    ]);
    expect(s.exitCode).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.passed).toBe(1);
  });

  it('reports which files were retried', () => {
    const s = aggregate([
      file({ file: 'a.spec.ts', retried: true, attempts: 2 }),
      file({ file: 'b.spec.ts' }),
    ]);
    expect(s.retriedFiles).toEqual(['a.spec.ts']);
  });

  it('counts a retried-then-passed file as passed, with both attempts recorded', () => {
    const s = aggregate([file({ retried: true, attempts: 2, ok: true })]);
    expect(s.passed).toBe(1);
    expect(s.files[0].attempts).toBe(2);
  });

  it('sums the wall time', () => {
    expect(aggregate([file({ durationMs: 500 }), file({ file: 'b', durationMs: 700 })]).totalMs).toBe(1200);
  });
});

// ------------------------------------------------ C2: kill-target validation ---

describe('validateKillTarget', () => {
  /*
   * The rule: kill ONLY the pid the runner spawned. `taskkill /T` on anything else can take the Brotli
   * server with it, and then every later test in the file gets ERR_CONNECTION_REFUSED — the exact
   * symptom that made a batched run look like a product failure.
   */
  it('accepts the pid this run spawned', () => {
    expect(validateKillTarget(4242, { ownPid: 100, serverPid: 555, spawnPid: 4242 })).toEqual({ ok: true });
  });

  it('refuses the server pid', () => {
    const v = validateKillTarget(555, { ownPid: 100, serverPid: 555, spawnPid: 4242 });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('Brotli server');
  });

  it('refuses the runner own pid', () => {
    const v = validateKillTarget(100, { ownPid: 100, serverPid: 555, spawnPid: 4242 });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('runner itself');
  });

  it('refuses pid 0, negatives and non-integers', () => {
    // pid 0 means "all processes in this group" to taskkill — catastrophic.
    for (const bad of [0, -1, 1.5, Number.NaN, '7', null, undefined]) {
      expect(validateKillTarget(bad, { ownPid: 100, spawnPid: 4242 }).ok, `should refuse ${String(bad)}`).toBe(false);
    }
  });

  it('refuses a pid that is not the one spawned, even if positive and unrelated', () => {
    const v = validateKillTarget(9999, { ownPid: 100, serverPid: 555, spawnPid: 4242 });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('not the Playwright process');
  });
});

// --------------------------------------------------- C3: the timeout table ---

describe('fileTimeoutMs', () => {
  it('has a measured backstop for every spec file', () => {
    for (const f of Object.keys(FILE_TIMEOUTS_MS)) {
      expect(FILE_TIMEOUTS_MS[f], `${f} has no budget`).toBeGreaterThan(0);
    }
  });

  it('gives look.spec.ts at least 1.5x its measured 10.0 min', () => {
    // Measured: 320.4 s batched, 10.0 min raw. 1.5x of 10 min is 15 min.
    expect(FILE_TIMEOUTS_MS['look.spec.ts']).toBeGreaterThanOrEqual(10 * 60_000 * 1.5);
  });

  it('gives negative.spec.ts at least 1.5x its measured 4.7 min', () => {
    expect(FILE_TIMEOUTS_MS['negative.spec.ts']).toBeGreaterThanOrEqual(4.7 * 60_000 * 1.5);
  });

  it('gives globe.spec.ts at least 1.5x its measured 60.8 s', () => {
    expect(FILE_TIMEOUTS_MS['globe.spec.ts']).toBeGreaterThanOrEqual(60.8 * 1000 * 1.5);
  });

  it('falls back to a generous default for an unknown spec', () => {
    expect(fileTimeoutMs('brand-new.spec.ts', {})).toBe(DEFAULT_FILE_TIMEOUT_MS);
  });

  it('honours E2E_FILE_TIMEOUT_MS_OVERRIDE', () => {
    expect(fileTimeoutMs('look.spec.ts', { E2E_FILE_TIMEOUT_MS_OVERRIDE: '20000' })).toBe(20000);
  });

  it('ignores a nonsense override rather than disabling the backstop', () => {
    expect(fileTimeoutMs('globe.spec.ts', { E2E_FILE_TIMEOUT_MS_OVERRIDE: 'abc' })).toBe(FILE_TIMEOUTS_MS['globe.spec.ts']);
    expect(fileTimeoutMs('globe.spec.ts', { E2E_FILE_TIMEOUT_MS_OVERRIDE: '0' })).toBe(FILE_TIMEOUTS_MS['globe.spec.ts']);
  });
});

// ------------------------------------------------------------- C4: summary ---

describe('buildSummary', () => {
  const row = (over = {}) => ({
    file: 'globe.spec.ts',
    port: 4300,
    status: 'passed',
    testsPassed: 5,
    testsFailed: 0,
    testsSkipped: 0,
    expected: 5,
    durationMs: 60_000,
    retries: 0,
    ...over,
  });

  it('exits zero when every file passed and counts match', () => {
    const s = buildSummary([row(), row({ file: 'limb.spec.ts', testsPassed: 2, expected: 2 })], { expectedTotal: 7 });
    expect(s.exitCode).toBe(0);
    expect(s.tests.mismatch).toBe(false);
  });

  it('exits non-zero on a TIMEOUT', () => {
    const s = buildSummary([row({ status: 'TIMEOUT', testsPassed: 1, expected: 5 })], { expectedTotal: 1 });
    expect(s.exitCode).toBe(1);
  });

  it('exits non-zero when a file ran FEWER tests than it owns', () => {
    // A file can exit 0 having registered fewer tests than the inventory expects.
    const s = buildSummary([row({ testsPassed: 3, expected: 5 })], { expectedTotal: 3 });
    expect(s.exitCode).toBe(1);
    expect(s.countMismatches).toEqual(['globe.spec.ts']);
  });

  it('exits non-zero on a total count mismatch even when every file claims passed', () => {
    const s = buildSummary([row()], { expectedTotal: 99 });
    expect(s.exitCode).toBe(1);
    expect(s.tests.mismatch).toBe(true);
  });

  it('lets skipped tests account for the difference', () => {
    const s = buildSummary([row({ testsPassed: 4, testsSkipped: 1, expected: 5 })], { expectedTotal: 5 });
    expect(s.countMismatches).toEqual([]);
  });

  it('reports the killReason and retries per file', () => {
    const s = buildSummary([row({ status: 'TIMEOUT', killReason: 'timeout', retries: 1, testsPassed: 1 })], {});
    expect(s.files[0].killReason).toBe('timeout');
    expect(s.retriedFiles).toEqual(['globe.spec.ts']);
  });
});
