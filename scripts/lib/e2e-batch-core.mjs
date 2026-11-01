/**
 * BATCH DECISION CORE — pure logic for the batched e2e runner.
 *
 * Kept separate from the runner for the usual reason: the interesting decisions must be testable
 * without spawning Playwright. Three of them, and each has a measured failure behind it:
 *
 *  1. `shouldRetry` — the full suite is recorded crashing the browser worker on this machine
 *     (`worker process exited unexpectedly (code=3221225794)`, i.e. 0xC0000142, a DLL init
 *     failure under SwiftShader). That is an ENVIRONMENT failure and retrying it once is
 *     legitimate. An assertion failure is a PRODUCT failure and retrying it only hides a red
 *     test behind a green retry — so `shouldRetry` must never fire on one.
 *  2. `pickPort` — each spec file gets its own server on its own port. A shared port plus a
 *     killed-but-not-yet-released listener is how ERR_CONNECTION_REFUSED appeared mid-run in an
 *     earlier attempt: two brokers, one port, one of them dead.
 *  3. `aggregate` — the runner's exit code must reflect every file, not the last one.
 */

/** Exit code Windows reports for a Chromium worker crash (0xC0000142). */
export const WORKER_CRASH_EXIT = 3221225794;

/**
 * Decide whether to retry a file that failed.
 *
 * Retries are for infrastructure, never for assertions:
 *   - the worker crash code above, or
 *   - Playwright's own "Target crashed" / "worker process exited" text.
 *
 * A second crash does NOT retry again: two crashes in a row means the machine cannot run it, and
 * looping would turn a 5-minute failure into a 15-minute one with the same outcome.
 *
 * @param {number | null} exitCode process exit code, null when it was signalled
 * @param {string} output         combined stdout+stderr
 * @param {number} attempt        1 for the first failure, 2+ for a retry that also failed
 * @returns {boolean} true when exactly one more attempt is warranted
 */
export function shouldRetry(exitCode, output, attempt) {
  // Never a third attempt. The rule is "retry a file ONCE".
  if (attempt >= 2) return false;

  if (exitCode === WORKER_CRASH_EXIT) return true;

  const crashText = /Target crashed|worker process exited unexpectedly|browser has been closed/i;
  if (crashText.test(output)) return true;

  /*
   * Assertion failures are product failures. Listed explicitly (rather than relying on the
   * absence of crash text) so that a Playwright output change cannot silently turn an assertion
   * failure into a retry: if ANY of these markers is present, no retry, whatever else the log says.
   */
  const assertionText = /\d+ failed\b|expect\(|Error: expect|AssertionError|toHaveBeenCalled|toBe\(/i;
  if (assertionText.test(output) && exitCode === 1) return false;

  // An unrecognised non-zero exit is not a crash; report it rather than retry it.
  return false;
}

/**
 * Choose this file's server port.
 *
 * Starts at `base + index` and skips anything already used. Deterministic per file order, so a
 * run's ports are reproducible from its log — which is what makes "port clash" a diagnosable
 * answer rather than a guess.
 *
 * @param {number} index              position of the spec file in the batch
 * @param {readonly number[]} used     ports already taken by earlier files in this run
 * @param {number} [base]              first candidate port
 * @returns {number}
 */
export function pickPort(index, used, base = 4300) {
  let port = base + index;
  const taken = new Set(used);
  // Bounded: at most `used.length + 1` probes can all be taken.
  for (let i = 0; i <= used.length; i += 1) {
    if (!taken.has(port) && port < 65536) return port;
    port += 1;
  }
  throw new Error(`pickPort: no free port found from ${base + index} (used: ${[...used].join(',')})`);
}

/**
 * @typedef {object} FileResult
 * @property {string} file        spec file name
 * @property {boolean} ok         final outcome after any retry
 * @property {number} attempts    total attempts, 1 or 2
 * @property {boolean} retried    true when a retry happened at all
 * @property {number | null} exitCode
 * @property {number} durationMs
 * @property {number} port
 */

/**
 * @typedef {object} BatchSummary
 * @property {FileResult[]} files
 * @property {number} total
 * @property {number} passed
 * @property {number} failed
 * @property {string[]} retriedFiles
 * @property {number} totalMs
 * @property {number} exitCode  non-zero when anything failed
 */

/**
 * Aggregate per-file results into the run's verdict.
 *
 * `exitCode` is non-zero if ANY file failed, so a green last file cannot mask a red earlier one —
 * the failure mode of a naive `for` loop that only reports `$?`.
 *
 * @param {readonly FileResult[]} files
 * @returns {BatchSummary}
 */
export function aggregate(files) {
  const passed = files.filter((f) => f.ok).length;
  const failed = files.length - passed;
  return {
    files: [...files],
    total: files.length,
    passed,
    failed,
    retriedFiles: files.filter((f) => f.retried).map((f) => f.file),
    totalMs: files.reduce((s, f) => s + f.durationMs, 0),
    exitCode: failed === 0 ? 0 : 1,
  };
}

// ------------------------------------------------------ per-file timeout table (C3)

/**
 * Per-file wall-clock backstops: **2x the measured BATCHED wall**, floor 120 s.
 *
 * The runner had NO timeout at all, which is a real gap: a hung file hangs the suite forever and a
 * killed run looks like a product failure. These are backstops, not expectations — the only thing that
 * should ever hit one is a genuine hang.
 *
 * ## Why the derivation changed (step 3B2-FIX1 A3)
 *
 * The previous table came from heterogeneous sources — isolated runs, raw runs, rounded-up minutes —
 * and the one file that mattered was under-budgeted: `boot.spec.ts` took 402.5 s in the last full
 * batched run against a 600 s backstop, and it hit that backstop once (`docs/E2E.md`, run 1), which is
 * what turned a slow file into 38 false reds.
 *
 * Every value below is `2 x durationMs` from
 * `.cache/full3b2/batched-summary-run3.json` (one quiet machine, one process per file), rounded UP to
 * the next whole second, with a 120 s floor for the files whose 2x is below it. `boot.spec.ts` is given
 * **900 s** by the prompt rather than its own 805 s, because its case d (400 kbps) dominates the file
 * and it is the one file whose overrun poisons everything after it.
 *
 * The floor matters as much as the multiplier: three files measured 11-16 s and a 22-32 s backstop
 * would fire on process start-up jitter, turning a slow start into a false TIMEOUT.
 *
 * | file | run3 wall | 2x | budget |
 * |---|---|---:|---:|
 * | boot.spec.ts | 402.506 s | 805.0 s | 900 s (prompt) |
 * | look.spec.ts | 317.732 s | 635.5 s | 636 s |
 * | focus-ux.spec.ts | 316.975 s | 634.0 s | 634 s |
 * | negative.spec.ts | 193.758 s | 387.5 s | 388 s |
 * | camera-golden.spec.ts | 147.894 s | 295.8 s | 296 s |
 * | frame.spec.ts | 120.743 s | 241.5 s | 242 s |
 * | harden.spec.ts | 109.504 s | 219.0 s | 220 s |
 * | globe.spec.ts | 53.367 s | 106.7 s | 120 s (floor) |
 * | gate-clock.spec.ts | 51.187 s | 102.4 s | 120 s (floor) |
 * | frame-director.spec.ts | 39.280 s | 78.6 s | 120 s (floor) |
 * | history-gate.spec.ts | 16.076 s | 32.2 s | 120 s (floor) |
 * | determinism.spec.ts | 15.998 s | 32.0 s | 120 s (floor) |
 * | limb.spec.ts | 15.502 s | 31.0 s | 120 s (floor) |
 * | ref.spec.ts | 13.090 s | 26.2 s | 120 s (floor) |
 * | scene-gate.spec.ts | 11.407 s | 22.8 s | 120 s (floor) |
 */
export const FILE_TIMEOUTS_MS = {
  // The one file with an explicit budget rather than 2x: 402.5 s measured, 900 s allowed.
  'boot.spec.ts': 900_000,
  'look.spec.ts': 636_000,
  'focus-ux.spec.ts': 634_000,
  // Step 3B2-FIX1: no batched measurement yet (it is new in this step); 4 min is 2x the 2 min its
  // 11 cases take isolated, rounded up. A3's rule applies once a batched wall exists for it.
  'reset-ux.spec.ts': 240_000,
  // pin-click.spec.ts: 3B2-FIX2-CONT took it from 4 cases to 7 and its measured isolated wall is 9.7 min
  // (sweep 3.0 min, spin-on ~2.6 min, D2/D3 ~1 min, D4/D5/D6 ~3 min). It then TIMED OUT at 240 s in the
  // 3B2-FIX2-CONT batch -- killed at 3/7 tests -- because the case count grew and this budget did not.
  // 1_200_000 is 2x the measured wall, per this table's own rule.
  'pin-click.spec.ts': 1_200_000,
  'negative.spec.ts': 388_000,
  'camera-golden.spec.ts': 296_000,
  'frame.spec.ts': 242_000,
  'harden.spec.ts': 220_000,
  'globe.spec.ts': 120_000,
  'gate-clock.spec.ts': 120_000,
  'frame-director.spec.ts': 120_000,
  'history-gate.spec.ts': 120_000,
  'determinism.spec.ts': 120_000,
  'limb.spec.ts': 120_000,
  'ref.spec.ts': 120_000,
  'scene-gate.spec.ts': 120_000,
  // Step 3-MOBILE1 E: M1-M10, 15 cases. Measured isolated wall 3.7 min (222 s), so 2x is 444 s; rounded up to
  // 450_000 per this table's own rule. The wall is dominated by fixed waits — the file drives real CDP touch
  // streams and reads the camera pose between gestures — not by rendering.
  'mobile-sheet.spec.ts': 450_000,
};

/** Default when a file is not in the table (a new spec gets a generous backstop, not none). */
export const DEFAULT_FILE_TIMEOUT_MS = 10 * 60_000;

/**
 * The status the runner writes for a file it REFUSED to run because the harness could not be restored.
 *
 * Step 3B2-FIX1 A2 requires this: when a killed file leaves the machine unable to serve, running the
 * remaining files anyway produces a wall of `ERR_CONNECTION_REFUSED` that reads as 38 product failures.
 * "not-run (infra)" is a fourth outcome beside passed / failed / TIMEOUT, and it is deliberately NOT
 * counted as a red test — the run still exits non-zero (the harness is broken), but the per-file rows
 * say what actually happened.
 */
export const INFRA_STATUS = 'not-run (infra)';

/**
 * Rows for every file the runner declined to run, so the summary accounts for them.
 *
 * @param {readonly string[]} files   filenames that were never started
 * @param {string} reason             why the harness was declared unusable
 * @returns {Array<Record<string, unknown>>}
 */
export function infraRows(files, reason) {
  return files.map((file) => ({
    file,
    port: null,
    status: INFRA_STATUS,
    testsPassed: 0,
    testsFailed: 0,
    testsSkipped: 0,
    expected: null,
    durationMs: 0,
    retries: 0,
    killReason: `infra: ${reason}`,
    infraReason: reason,
  }));
}

/**
 * The timeout for one file, honouring `E2E_FILE_TIMEOUT_MS_OVERRIDE` for testing.
 *
 * The override is deliberately global rather than per-file: it exists so a control run can force a
 * TIMEOUT on a file that normally passes quickly, and a per-file override would be one more thing to
 * get wrong in a test.
 *
 * @param {string} file
 * @param {Record<string, string | undefined>} [env]
 * @returns {number}
 */
export function fileTimeoutMs(file, env = process.env) {
  const raw = env.E2E_FILE_TIMEOUT_MS_OVERRIDE;
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return FILE_TIMEOUTS_MS[file] ?? DEFAULT_FILE_TIMEOUT_MS;
}

// ---------------------------------------------------- kill-target validation (C2)

/**
 * Decide whether `pid` is a legal killTree target.
 *
 * The rule the runner must obey: kill ONLY the pid of the Playwright process the runner itself
 * spawned. Never by image name, never by port, never a wildcard, never pid 0 and never the runner's
 * own or the server's pid. This function is that rule as code, so a future refactor cannot quietly
 * widen the scope — `taskkill /T` on the wrong pid takes the Brotli server with it and every later
 * test in the file gets ERR_CONNECTION_REFUSED.
 *
 * @param {unknown} pid          the pid about to be killed
 * @param {{ ownPid?: number, serverPid?: number, spawnPid?: number }} ctx
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateKillTarget(pid, ctx = {}) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) {
    return { ok: false, reason: `pid ${String(pid)} is not a positive integer` };
  }
  if (ctx.ownPid !== undefined && n === Number(ctx.ownPid)) {
    return { ok: false, reason: `pid ${n} is the runner itself` };
  }
  if (ctx.serverPid !== undefined && ctx.serverPid !== null && n === Number(ctx.serverPid)) {
    return { ok: false, reason: `pid ${n} is this file's Brotli server` };
  }
  if (ctx.spawnPid !== undefined && ctx.spawnPid !== null && n !== Number(ctx.spawnPid)) {
    return { ok: false, reason: `pid ${n} is not the Playwright process this run spawned (${ctx.spawnPid})` };
  }
  return { ok: true };
}

// ------------------------------------------------------------- summary (C4)

/**
 * Build the machine-readable run summary.
 *
 * Kept separate from the printing so it can be unit-tested and so the exit code is decided by data
 * rather than by the shape of a log line.
 *
 * @param {Array<Record<string, unknown>>} files
 * @param {{ expectedTotal?: number | null }} [opts]
 */
export function buildSummary(files, opts = {}) {
  const rows = files.map((f) => ({
    file: f.file,
    port: f.port ?? null,
    status: f.status ?? (f.ok ? 'passed' : 'failed'),
    testsPassed: f.testsPassed ?? null,
    testsFailed: f.testsFailed ?? null,
    testsSkipped: f.testsSkipped ?? null,
    expected: f.expected ?? null,
    durationMs: f.durationMs ?? 0,
    retries: f.retries ?? 0,
    killReason: f.killReason ?? null,
    /*
     * The two fields step 3B2-FIX1 A2/A5 need preserved in the ARCHIVE, not only in the log: whether the
     * port this file used was proved free after its teardown, and why a file was declined. Without them a
     * later reader cannot tell "the kill worked" from "the kill worked and nothing checked".
     */
    portFree: f.portFree ?? null,
    infraReason: f.infraReason ?? null,
  }));

  const passed = rows.filter((r) => r.status === 'passed').length;
  const failed = rows.length - passed;
  const infra = rows.filter((r) => r.status === INFRA_STATUS).length;
  const actualTotal = rows.reduce((s, r) => s + (r.testsPassed ?? 0) + (r.testsFailed ?? 0) + (r.testsSkipped ?? 0), 0);
  const expectedTotal = opts.expectedTotal ?? null;

  /**
   * A count mismatch is a failure: a file can exit 0 and still have run fewer tests than it owns.
   *
   * Two statuses are excluded, for two different reasons. `not-run (infra)` has no run to compare. A
   * `TIMEOUT` file was killed mid-file, so it cannot reach its own count by construction — reporting that
   * as a count mismatch would restate "it timed out" as "the runner and the inventory disagree", and the
   * TIMEOUT row already fails the run.
   */
  const mismatches = rows.filter(
    (r) =>
      r.status !== INFRA_STATUS &&
      r.status !== 'TIMEOUT' &&
      r.expected !== null &&
      r.testsPassed !== null &&
      r.testsPassed !== r.expected - (r.testsSkipped ?? 0),
  );
  /**
   * The total check is skipped when anything was declined for infrastructure: `tests.actual` then cannot
   * reach the expected total by construction, and the meaningful statement is the per-file one above.
   * `tests.declined` counts what never ran, so the arithmetic stays explicit (e.g. 89 + 1 + 0 + 22 = 112).
   */
  const totalMismatch = infra === 0 && expectedTotal !== null && actualTotal !== expectedTotal;

  return {
    files: rows,
    total: rows.length,
    passed,
    failed,
    retriedFiles: rows.filter((r) => r.retries > 0).map((r) => r.file),
    totalMs: rows.reduce((s, r) => s + (r.durationMs ?? 0), 0),
    tests: { actual: actualTotal, expected: expectedTotal, mismatch: totalMismatch, declined: infra },
    countMismatches: mismatches.map((r) => r.file),
    exitCode: failed === 0 && !totalMismatch && mismatches.length === 0 ? 0 : 1,
  };
}


