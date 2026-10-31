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
