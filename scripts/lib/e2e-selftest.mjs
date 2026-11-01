/**
 * SELF-TEST for the batched runner's kill path (step 3B2-FIX1 A5).
 *
 * ## What this proves, and why each part is necessary
 *
 * Run 1 of the full suite lost 38 tests to `net::ERR_CONNECTION_REFUSED` after one file hit its backstop.
 * The three mechanisms that produced it are each exercised here over REAL Playwright processes and a REAL
 * Brotli server:
 *
 *   1. **A file that hangs is killed and reported TIMEOUT** — not as N assertion failures.
 *   2. **Its server is torn down and its port is proved FREE** before the next file starts. The server is a
 *      sibling of the Playwright process (C1), so `taskkill /T` on Playwright does not take it; the timeout
 *      handler tears it down explicitly and then waits for the socket to be released.
 *   3. **The next file runs GREEN on a fresh server on a fresh port.** That is the observation run 1 lacked.
 *   4. **The summary lands in the ARCHIVE** (`.cache/e2e-archive/`), outside every runner's `outputDir`.
 *
 * ## How it reuses the real runner
 *
 * It does NOT reimplement the kill: it calls the runner module's own exported seams through an import of
 * `scripts/e2e-batched.mjs`'s internals. Rather than export the internals (which would make the runner's
 * private helpers part of its public surface), this driver spawns the runner itself with
 * `--self-test-files`, a mode that runs exactly the two synthetic specs through `runOnce` — the same
 * function, the same timeout table, the same kill code.
 *
 * ## The tiny timeout
 *
 * `E2E_FILE_TIMEOUT_MS_OVERRIDE` applies to every file, so the hang is given 45 s and the fast file is
 * unaffected in practice (it finishes in seconds). The override is the runner's own documented test seam.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

/** The two synthetic specs, in the order the run must execute them. */
export const SELFTEST_FILES = ['hangs.spec.ts', 'passes.spec.ts'];

/** The hang's backstop. Long enough for a page load on this machine, short enough to test in a session. */
export const SELFTEST_HANG_TIMEOUT_MS = 45_000;

/**
 * Run the self-test once.
 *
 * @param {{ root: string, writeSummary: (summary: unknown, label: string) => string }} ctx
 * @returns {Promise<number>} 0 when every expectation held
 */
export async function runSelfTest({ root }) {
  console.log('[selftest] two synthetic specs: one hangs past a 45 s backstop, one must run green after');
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'e2e-batched.mjs'), '--selftest-run'], {
    cwd: root,
    env: {
      ...process.env,
      E2E_FILE_TIMEOUT_MS_OVERRIDE: String(SELFTEST_HANG_TIMEOUT_MS),
      PLAYWRIGHT_HTML_OPEN: 'never',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let output = '';
  child.stdout.on('data', (b) => {
    output += b.toString();
    process.stdout.write(b);
  });
  child.stderr.on('data', (b) => {
    output += b.toString();
    process.stderr.write(b);
  });

  const code = await new Promise((resolve) => child.on('close', resolve));

  /*
   * The expectations, read from the runner's own summary JSON (the archive path it prints). Parsing the
   * human log would let a formatting change silently weaken this test.
   */
  const match = output.match(/summary: (.+?)-summary\.json/);
  if (!match) {
    console.error('[selftest] FAILED: the runner printed no summary path');
    return 1;
  }
  const archived = path.join(root, `${match[1]}-summary.json`);
  const { readFileSync } = await import('node:fs');
  const summary = JSON.parse(readFileSync(archived, 'utf8'));
  const byFile = Object.fromEntries(summary.files.map((f) => [f.file, f]));

  const checks = [];
  const check = (ok, label, detail) => {
    checks.push({ ok, label, detail });
    console.log(`[selftest] ${ok ? 'ok  ' : 'FAIL'} ${label} — ${detail}`);
  };

  const hang = byFile['hangs.spec.ts'];
  const pass = byFile['passes.spec.ts'];

  check(!!hang, 'the hanging file has a summary row', hang ? hang.status : 'missing');
  check(
    hang?.status === 'TIMEOUT',
    'the hanging file was killed and reported TIMEOUT (not as test failures)',
    `status "${hang?.status}", killReason "${hang?.killReason}"`,
  );
  check(
    hang?.portFree === true,
    'its port was proved FREE after the kill',
    `portFree ${String(hang?.portFree)}`,
  );
  check(
    pass?.status === 'passed' && pass?.testsPassed === 1 && pass?.testsFailed === 0,
    'the NEXT file ran GREEN after the kill, having actually executed its test',
    `status "${pass?.status}", ${pass?.testsPassed} passed / ${pass?.testsFailed} failed of ${pass?.expected}`,
  );
  check(
    pass?.port !== hang?.port && pass?.port != null,
    'on a DIFFERENT port, so a stuck listener could not have answered it',
    `hang port ${hang?.port}, passes port ${pass?.port}`,
  );
  check(
    /\.cache[\\/]e2e-archive/.test(archived),
    'the summary landed in .cache/e2e-archive/, outside every outputDir',
    archived.replace(root, '<repo>'),
  );
  check(
    summary.files.every((f) => f.status !== 'not-run (infra)'),
    'no file was declined as infra, i.e. the harness was restorable',
    summary.files.map((f) => `${f.file}:${f.status}`).join(', '),
  );

  const failed = checks.filter((c) => !c.ok).length;
  console.log(`[selftest] ${checks.length - failed}/${checks.length} checks passed; runner exit ${code}`);
  return failed === 0 ? 0 : 1;
}
