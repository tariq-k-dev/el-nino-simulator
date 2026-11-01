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
  INFRA_STATUS,
  WORKER_CRASH_EXIT,
  aggregate,
  buildSummary,
  fileTimeoutMs,
  infraRows,
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

  /*
   * Step 3B2-FIX1 A3: every budget is 2x its measured BATCHED wall from
   * `.cache/full3b2/batched-summary-run3.json`, with a 120 s floor and boot at 900 s.
   *
   * The numbers are literals on purpose. Deriving them here from the same file the table was derived from
   * would make this test restate the implementation instead of checking it; the measured walls are the
   * oracle, so they are written out.
   */
  const MEASURED_WALL_S = {
    'boot.spec.ts': 402.506,
    'look.spec.ts': 317.732,
    'focus-ux.spec.ts': 316.975,
    'negative.spec.ts': 193.758,
    'camera-golden.spec.ts': 147.894,
    'frame.spec.ts': 120.743,
    'harden.spec.ts': 109.504,
    'globe.spec.ts': 53.367,
    'gate-clock.spec.ts': 51.187,
    'frame-director.spec.ts': 39.28,
    'history-gate.spec.ts': 16.076,
    'determinism.spec.ts': 15.998,
    'limb.spec.ts': 15.502,
    'ref.spec.ts': 13.09,
    'scene-gate.spec.ts': 11.407,
  };

  /*
   * Files added AFTER the measured run, with the budget they were given and why. Kept as a second list
   * rather than folded into `MEASURED_WALL_S` because they have no batched wall yet, and pretending they
   * do would let a guess pass as a measurement.
   */
  const ADDED_AFTER_RUN3 = {
    // Step 3B2-FIX1 B: 11 cases, 2.2 min isolated. 4 min = 2x that, rounded up. Not from run3.
    'reset-ux.spec.ts': 240_000,
    // Step 3B2-FIX2-CONT A5: 7 cases, measured 9.7 min isolated. 1_200_000 is 2x that. The previous
    // 240 s budget killed the file at 3/7 in the first batched run after the case count grew.
    'pin-click.spec.ts': 1_200_000,
    // Step 3-MOBILE1 E: 15 cases, measured 222 s and 234 s on two green isolated runs. 2x the slower is
    // 468 s, rounded up to 480 s. Not from run3 — this file did not exist then.
    'mobile-sheet.spec.ts': 480_000,
    // Step MOBILE2 E: 10 cases over 13 viewports, measured 9.2 min isolated on the first full run. No BATCHED
    // wall exists yet, so 1_200_000 is 2x the measured ISOLATED wall rather than a batched measurement — the
    // conservative direction, and the one A3's rule converges to once the batch reports.
    'layout-matrix.spec.ts': 1_200_000,
  };

  it('covers exactly the files the measured run covers, plus the declared additions', () => {
    expect(Object.keys(FILE_TIMEOUTS_MS).sort()).toEqual(
      [...Object.keys(MEASURED_WALL_S), ...Object.keys(ADDED_AFTER_RUN3)].sort(),
    );
  });

  it('gives every addition after run3 its declared budget', () => {
    for (const [file, budget] of Object.entries(ADDED_AFTER_RUN3)) {
      expect(FILE_TIMEOUTS_MS[file], `${file} budget`).toBe(budget);
    }
  });

  it('is 2x the measured batched wall, with a 120 s floor', () => {
    for (const [file, wallS] of Object.entries(MEASURED_WALL_S)) {
      if (file === 'boot.spec.ts') continue;
      const expected = Math.max(120_000, Math.ceil((wallS * 1000) / 1000) * 1000 * 2);
      expect(FILE_TIMEOUTS_MS[file], `${file}: 2x ${wallS}s`).toBe(expected);
    }
  });

  it('gives boot.spec.ts 900 s, the file whose overrun poisoned run 1', () => {
    // 402.5 s measured; 805 s is 2x; the prompt's 900 s is the budget. Below 2x would be a speed trap.
    expect(FILE_TIMEOUTS_MS['boot.spec.ts']).toBe(900_000);
    expect(FILE_TIMEOUTS_MS['boot.spec.ts']).toBeGreaterThan(2 * MEASURED_WALL_S['boot.spec.ts'] * 1000);
  });

  it('gives the previously under-budgeted files more room than the run they starved in', () => {
    // look took 317.7 s of a 900 s budget and focus-ux 317.0 s of 780 s: both were one bad minute from
    // a false TIMEOUT. The new floor is 2x, which is what the prompt requires and what run 1 lacked.
    expect(FILE_TIMEOUTS_MS['look.spec.ts']).toBeGreaterThanOrEqual(2 * 317.732 * 1000);
    expect(FILE_TIMEOUTS_MS['focus-ux.spec.ts']).toBeGreaterThanOrEqual(2 * 316.975 * 1000);
    expect(FILE_TIMEOUTS_MS['negative.spec.ts']).toBeGreaterThanOrEqual(2 * 193.758 * 1000);
  });

  it('never lets a fast file get a backstop close enough to its own wall to fire spuriously', () => {
    for (const [file, wallS] of Object.entries(MEASURED_WALL_S)) {
      expect(FILE_TIMEOUTS_MS[file], `${file} budget vs ${wallS}s measured`).toBeGreaterThan(
        wallS * 1000 * 2,
      );
    }
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

  /*
   * Step 3B2-FIX1 A2: a file the runner DECLINED to run because the harness could not be restored.
   *
   * The rule that matters is that it must not be reported as a product failure and must not be counted as
   * run. Run 1 lost 38 tests this way; the summary has to say "not run" in a way a reader can act on.
   */
  it('counts a not-run (infra) file as not-passed, with its reason', () => {
    const s = buildSummary([row(), ...infraRows(['look.spec.ts'], 'port-4301-held-before-look.spec.ts')], {});
    expect(s.passed).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.files[1].status).toBe(INFRA_STATUS);
    expect(s.files[1].killReason).toBe('infra: port-4301-held-before-look.spec.ts');
    expect(s.files[1].infraReason).toBe('port-4301-held-before-look.spec.ts');
    // Nothing ran, so nothing is claimed: zero passed, zero failed, zero skipped.
    expect([s.files[1].testsPassed, s.files[1].testsFailed, s.files[1].testsSkipped]).toEqual([0, 0, 0]);
  });

  it('does not report an infra row as a COUNT MISMATCH', () => {
    // A declined file has no run to compare against; calling it a mismatch would misdescribe the cause.
    const s = buildSummary([infraRows(['look.spec.ts'], 'x')[0]], { expectedTotal: 9 });
    expect(s.countMismatches).toEqual([]);
    expect(s.tests.declined).toBe(1);
    // The total check is skipped when something was declined, for the same reason.
    expect(s.tests.mismatch).toBe(false);
    // It still exits non-zero: the harness being broken is a failed run.
    expect(s.exitCode).toBe(1);
  });

  it('does not report a TIMEOUT as a count mismatch either', () => {
    /*
     * A killed file cannot reach its own count. `boot.spec.ts` hit its 600 s backstop in run 1 and the
     * summary said "count mismatch in: boot.spec.ts" beside the TIMEOUT — which reads as a bookkeeping
     * problem when the only fact is that the backstop fired. The TIMEOUT row already fails the run.
     */
    const s = buildSummary([row({ status: 'TIMEOUT', testsPassed: 4, expected: 10, killReason: 'timeout' })], {
      expectedTotal: 4,
    });
    expect(s.countMismatches).toEqual([]);
    expect(s.exitCode).toBe(1);
  });

  it('states how many tests were declined, so the arithmetic stays checkable', () => {
    const s = buildSummary([row({ testsPassed: 4, expected: 4 }), infraRows(['look.spec.ts'], 'x')[0]], {
      expectedTotal: 13,
    });
    // 4 ran, 4 + 0 + 0 counted, 9 expected, 1 file declined.
    expect(s.tests.actual).toBe(4);
    expect(s.tests.declined).toBe(1);
    expect(s.exitCode).toBe(1);
  });

  it('records portFree per file, so "the kill worked" is distinguishable from "nothing checked"', () => {
    const s = buildSummary([row({ portFree: true }), row({ file: 'b.spec.ts', portFree: null })], { expectedTotal: 10 });
    expect(s.files[0].portFree).toBe(true);
    expect(s.files[1].portFree).toBeNull();
  });
});
