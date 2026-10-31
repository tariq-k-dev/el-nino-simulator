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
 * Per-file wall-clock backstops, derived from MEASURED durations with >= 1.5x margin.
 *
 * The runner had NO timeout at all, which is a real gap: a hung file hangs the suite forever and a
 * killed run looks like a product failure. These are backstops, not expectations — the only thing that
 * should ever hit one is a genuine hang.
 *
 * Measured values (docs/globe-look/E2E.md and this session's runs):
 *   look      320.4 s (batched, single file) and 10.0 min raw  -> 10.0 min measured, use 15 min
 *   negative  282 s (4.7 min raw)                              -> use 8 min
 *   globe      60.8 s                                          -> use 3 min
 *   boot      403.5 s                                          -> use 10 min
 *   harden    110.1 s                                          -> use 4 min
 *   gate-clock 52.1 s, determinism 16.1 s, history-gate 16.1 s, limb 15.7 s, scene-gate 12.5 s -> 2 min
 *   ref       17.1 s (B3.4, three separate processes)                        -> use 1 min (2x)
 */
export const FILE_TIMEOUTS_MS = {
  'look.spec.ts': 15 * 60_000,
  'negative.spec.ts': 8 * 60_000,
  // ref.spec: measured 17.1 s per process (three separate runs, B3.4) -> 2x = 34.2 s, rounded to 1 min.
  'ref.spec.ts': 1 * 60_000,
  'globe.spec.ts': 3 * 60_000,
  'boot.spec.ts': 10 * 60_000,
  'harden.spec.ts': 4 * 60_000,
  'gate-clock.spec.ts': 2 * 60_000,
  'determinism.spec.ts': 2 * 60_000,
  'history-gate.spec.ts': 2 * 60_000,
  'limb.spec.ts': 2 * 60_000,
  'scene-gate.spec.ts': 2 * 60_000,
};

/** Default when a file is not in the table (a new spec gets a generous backstop, not none). */
export const DEFAULT_FILE_TIMEOUT_MS = 10 * 60_000;

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
    port: f.port,
    status: f.status ?? (f.ok ? 'passed' : 'failed'),
    testsPassed: f.testsPassed ?? null,
    testsFailed: f.testsFailed ?? null,
    testsSkipped: f.testsSkipped ?? null,
    expected: f.expected ?? null,
    durationMs: f.durationMs ?? 0,
    retries: f.retries ?? 0,
    killReason: f.killReason ?? null,
  }));

  const passed = rows.filter((r) => r.status === 'passed').length;
  const failed = rows.length - passed;
  const actualTotal = rows.reduce((s, r) => s + (r.testsPassed ?? 0) + (r.testsFailed ?? 0) + (r.testsSkipped ?? 0), 0);
  const expectedTotal = opts.expectedTotal ?? null;

  /** A count mismatch is a failure: a file can exit 0 and still have run fewer tests than it owns. */
  const mismatches = rows.filter(
    (r) => r.expected !== null && r.testsPassed !== null && r.testsPassed !== r.expected - (r.testsSkipped ?? 0),
  );
  const totalMismatch = expectedTotal !== null && actualTotal !== expectedTotal;

  return {
    files: rows,
    total: rows.length,
    passed,
    failed,
    retriedFiles: rows.filter((r) => r.retries > 0).map((r) => r.file),
    totalMs: rows.reduce((s, r) => s + r.durationMs, 0),
    tests: { actual: actualTotal, expected: expectedTotal, mismatch: totalMismatch },
    countMismatches: mismatches.map((r) => r.file),
    exitCode: failed === 0 && !totalMismatch && mismatches.length === 0 ? 0 : 1,
  };
}
