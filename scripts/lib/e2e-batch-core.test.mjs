/**
 * Tests for the batched-runner decision core.
 *
 * The runner itself is hard to test (it spawns Playwright and kills process trees), so every
 * decision that can be wrong lives in `e2e-batch-core.mjs` and is tested here. Each test names the
 * real failure it prevents.
 */
import { describe, expect, it } from 'vitest';
import {
  WORKER_CRASH_EXIT,
  aggregate,
  pickPort,
  shouldRetry,
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
