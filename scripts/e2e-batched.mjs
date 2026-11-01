/**
 * BATCHED E2E RUNNER — one Playwright process per spec file, sequentially.
 *
 * Why this exists. The full suite is recorded crashing the browser worker part-way through:
 *
 *     browserContext.newPage: Target crashed
 *     worker process exited unexpectedly (code=3221225794)
 *
 * 0xC0000142 is a DLL initialisation failure — Chromium exhausting resources after a long serial
 * run under SwiftShader (`workers: 1`, dozens of 1280x800 captures). The same specs pass when
 * split into smaller batches. So the fix is not to change the specs; it is to give each spec file
 * its own process, its own server and a clean slate.
 *
 * Per file:
 *   1. pick a port nothing in this run has used (deterministic, and reported),
 *   2. spawn `playwright test <file>` with `E2E_PORT` set, so the config's webServer binds there,
 *   3. wait for exit, capture output,
 *   4. kill the process tree this runner started (`taskkill /T /F` on Windows) — the TREE, because
 *      Playwright's own shutdown leaves the Brotli server behind often enough that a later file
 *      would find the port taken,
 *   5. only THEN clean ms-playwright orphans, and only those: cleanup between files can never
 *      kill the current run's server, and never touches the user's own Chrome.
 *
 * Retry: once, only on a worker crash (see `shouldRetry`). Never on an assertion failure.
 *
 * Usage:
 *   node scripts/e2e-batched.mjs                  # every spec in tests/e2e
 *   node scripts/e2e-batched.mjs look.spec.ts     # a subset, by filename fragment
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn as spawnRaw } from 'node:child_process';
import {
  buildSummary,
  fileTimeoutMs,
  infraRows,
  pickPort,
  shouldRetry,
  validateKillTarget,
  INFRA_STATUS,
} from './lib/e2e-batch-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const specDir = path.join(root, 'tests', 'e2e');

/** Ports are allocated per file from this base; playwright.config.ts reads `E2E_PORT`. */
const BASE_PORT = 4300;

/**
 * Extra argv for the Playwright child. Empty for a real run; `['--config', 'playwright.selftest.config.ts']`
 * for `--selftest-run`, because the synthetic specs live in a directory the real `testDir` does not cover.
 */
let playwrightConfigArgs = [];

/** Which spec files this run covers. */
function selectSpecs(filters) {
  const all = readdirSync(specDir)
    .filter((f) => f.endsWith('.spec.ts'))
    .sort();
  if (filters.length === 0) return all;
  return all.filter((f) => filters.some((needle) => f.includes(needle)));
}

/**
 * Kill a process and its children.
 *
 * Windows needs `taskkill /PID <pid> /T /F`. The `/PID` flag must be passed as ONE argument —
 * MSYS mangles `//PID` into a literal path and taskkill silently does nothing, which is the
 * handoff's documented gotcha. `spawnSync` with an argv array avoids the shell entirely.
 */
/** Wait until `pid` is gone, so the next file cannot race a dying process. */
function waitForExit(pid, timeoutMs = 15_000) {
  if (!pid || process.platform !== 'win32') return;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const q = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8' });
    const stillThere = q.stdout && new RegExp(`^\\D*${pid}\\b`, 'm').test(q.stdout) && !/No tasks/i.test(q.stdout);
    if (!stillThere) return;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},150)']);
  }
}

/**
 * Diagnostics for the kill path, gated on E2E_DEBUG_KILL=1.
 *
 * Written because a batched run failed with ERR_CONNECTION_REFUSED on every test after the first two of
 * look.spec.ts, and the cause had to be measured rather than guessed. Logs, for every killTree call:
 * the target pid, the reason, seconds since that file started, and the process tree before and after.
 */
const DEBUG_KILL = process.env.E2E_DEBUG_KILL === '1';

/** Snapshot of every process: pid, parent, name. Used to see what a kill actually took. */
function processSnapshot() {
  if (process.platform !== 'win32') return [];
  const q = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)|$($_.Name)|$($_.CommandLine)" }',
    ],
    { encoding: 'utf8' },
  );
  if (!q.stdout) return [];
  return q.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [pid, ppid, name, ...rest] = l.split('|');
      return { pid, ppid, name, cmd: rest.join('|') };
    });
}

/** True when `pid` appears in a snapshot. */
function aliveIn(snapshot, pid) {
  return snapshot.some((p) => p.pid === String(pid));
}

/** Log a kill event, with the tree before and after. */
function logKill(pid, reason, fileStartedAt, file) {
  if (!DEBUG_KILL) return;
  const secs = ((Date.now() - fileStartedAt) / 1000).toFixed(1);
  const before = processSnapshot();
  const target = before.find((p) => p.pid === String(pid));
  const children = before.filter((p) => p.ppid === String(pid));
  const server = before.filter((p) => /brotli-server/.test(p.cmd));
  console.log(
    `[kill] t=${secs}s file=${file} target=${pid} reason=${reason} ` +
      `targetName=${target ? target.name : 'GONE'} children=${children.length} ` +
      `servers=${server.map((p) => `${p.pid}:${p.name}`).join(',') || 'none'}`,
  );
  if (target) console.log(`[kill]   target cmd: ${target.cmd.slice(0, 140)}`);
  for (const c of children.slice(0, 8)) console.log(`[kill]   child ${c.pid} ${c.name} ${c.cmd.slice(0, 110)}`);
}

/** Log the tree after the kill, and whether the server survived. */
function logKillAfter(pid, fileStartedAt, file) {
  if (!DEBUG_KILL) return;
  const secs = ((Date.now() - fileStartedAt) / 1000).toFixed(1);
  const after = processSnapshot();
  const server = after.filter((p) => /brotli-server/.test(p.cmd));
  console.log(
    `[kill] t=${secs}s file=${file} AFTER target=${pid} stillAlive=${aliveIn(after, pid)} ` +
      `servers=${server.map((p) => `${p.pid}:${p.name}`).join(',') || 'none'}`,
  );
}

function killTree(pid, reason = 'unknown', ctx = {}) {
  if (!pid) return;
  if (ctx.file) logKill(pid, reason, ctx.fileStartedAt ?? Date.now(), ctx.file);
  try {
    return killTreeUnlogged(pid);
  } finally {
    if (ctx.file) logKillAfter(pid, ctx.fileStartedAt ?? Date.now(), ctx.file);
  }
}

function killTreeUnlogged(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

/**
 * Remove orphaned Playwright browsers left by a previous, killed run.
 *
 * STRICTLY `ms-playwright` — the managed browser cache under the user's AppData. A killed run can
 * leave one holding the renderer, and the next launch then fails to start. The user's own Chrome
 * is never matched: those executables live under `Program Files`, not the Playwright cache.
 */
function cleanPlaywrightOrphans() {
  if (process.platform !== 'win32') return;
  // List processes with their command lines, then kill only Playwright's own chromium.
  const list = spawnSync('wmic', ['process', 'get', 'ProcessId,ExecutablePath'], { encoding: 'utf8' });
  if (list.status !== 0 || !list.stdout) return;
  for (const line of list.stdout.split(/\r?\n/)) {
    if (!/ms-playwright/i.test(line)) continue;
    const pid = (line.trim().match(/(\d+)\s*$/) || [])[1];
    if (!pid) continue;
    spawnSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' });
  }
}

/**
 * Start this file's Brotli server and wait until it answers.
 *
 * C1: THE RUNNER OWNS THE SERVER LIFECYCLE. It is spawned here, directly by the runner, on this
 * file's own port — so it is a SIBLING of the Playwright process, never a descendant of it. That
 * matters because `killTree` runs `taskkill /T` on the Playwright pid: a descendant server would go
 * with it, and every remaining test in the file would get ERR_CONNECTION_REFUSED.
 *
 * Playwright is then told NOT to start one, via `E2E_EXTERNAL_SERVER=1` read by playwright.config.ts.
 */
function startServer(file, port) {
  const srv = spawnRaw(
    process.execPath,
    [path.join(root, 'tests', 'e2e', 'brotli-server.mjs'), 'dist-e2e', String(port)],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  srv.stdout.on('data', () => {});
  srv.stderr.on('data', () => {});
  return srv;
}

/**
 * Liveness: an HTTP GET, not just a TCP connect (step 3B2-FIX1 A2).
 *
 * A listener that accepts and then never answers is exactly the state a killed-but-not-reaped server
 * leaves behind, and a `net.connect` probe calls that "ready". Every later test in the file then dies on
 * its own fetch. The check therefore requires a 2xx/3xx for `/`.
 */
async function httpLiveness(port, timeoutMs = 5_000) {
  const http = await import('node:http');
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(typeof res.statusCode === 'number' && res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** True when NOTHING is listening on `port` (a refused connection is the signal). */
async function portIsFree(port) {
  const net = await import('node:net');
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' }, () => {
      sock.destroy();
      resolve(false);
    });
    sock.on('error', () => resolve(true));
    sock.setTimeout(1000, () => {
      sock.destroy();
      resolve(false);
    });
  });
}

/** Wait for a port to be released, which is what makes "the next file gets a fresh server" true. */
async function waitForPortFree(port, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await portIsFree(port)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/** Wait until `port` answers an HTTP request, or give up. */
async function waitForServer(port, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await httpLiveness(port)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/** One attempt at one file. Returns the result without deciding whether to retry. */
function runOnce(file, port) {
  return new Promise(async (resolve) => {
    const started = Date.now();
    const timeoutMs = fileTimeoutMs(file);

    // C1: the runner owns the server, so it is a sibling of the Playwright process.
    const server = startServer(file, port);
    const serverPid = server.pid;
    const ready = await waitForServer(port);
    if (!ready) {
      killTree(serverPid, 'server-not-ready', { file, fileStartedAt: started });
      const freed = await waitForPortFree(port);
      resolve({
        file,
        exitCode: 1,
        durationMs: Date.now() - started,
        output: `[batched] the Brotli server on port ${port} never became ready`,
        status: 'failed',
        killReason: 'server-not-ready',
        timedOut: false,
        portFree: freed,
        ...(freed ? {} : { harnessBroken: 'server-not-ready-and-port-stuck' }),
      });
      return;
    }
    const playwrightBin = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
    const child = spawn(
      process.execPath,
      /*
       * The FILTER is the bare filename, not a path: Playwright treats a positional argument as a
       * regex against the test file path, and `tests/e2e/foo.spec.ts` is then matched literally
       * against a path that also contains those segments — it resolves to "No tests found" on
       * Windows because the separator in the pattern is `/` and in the file is `\\`. A unique
       * filename is unambiguous and cannot collide, since spec names are distinct.
       */
      [
        playwrightBin,
        'test',
        file,
        '--reporter=list',
        /*
         * A PRIVATE artifacts directory per file, and this is load-bearing.
         *
         * Playwright deletes `outputDir` when a run starts. With the config's shared
         * `.cache/e2e-results`, the next file's process wiped the directory while the previous
         * file's Chromium was still flushing its trace, and the symptom was
         * `browserContext.close: ENOENT ... traces/<id>.trace` on that file's FIRST test — after
         * which the server had been torn down and every later test in the file got
         * ERR_CONNECTION_REFUSED. Two failures that looked like product bugs and were one
         * shared-directory race.
         */
        '--output',
        path.join('.cache', 'e2e-results', file.replace('.spec.ts', '')),
        /*
         * Traces OFF in the batched runner, and this is the actual fix for the ENOENT.
         *
         * The config sets `trace: 'retain-on-failure'`, so Playwright writes a trace stream to
         * `.playwright-artifacts-<n>/traces/…` and finalises it on `browserContext.close`. Under
         * SwiftShader on this machine the writer regularly loses the race and close throws
         * `ENOENT ... traces/<id>-recording<N>.trace` — which Playwright reports as the test's
         * failure, masking whatever the test actually did. It hit 3.2 here while 3.2 passed on
         * its own moments earlier, so it is teardown noise, not a measurement.
         *
         * A per-file `--output` directory did not stop it, because the artifact subdirectory is
         * numbered per worker and recreated regardless. The traces are a debugging aid that the
         * failure screenshot already substitutes for; a suite whose verdict flips on a
         * filesystem race is worth less than the traces. Turn them off here, keep them for
         * `e2e:raw`, and never let teardown decide a result.
         */
        '--trace=off',
        ...playwrightConfigArgs,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          // Distinct port per file, read by playwright.config.ts's webServer command.
          E2E_PORT: String(port),
          PLAYWRIGHT_HTML_OPEN: 'never',
          // Serial inside a file: the cases measure wall-clock and bytes on one CPU.
          E2E_BATCHED: '1',
          // C1: the runner owns the server; the config must not start a second one.
          E2E_EXTERNAL_SERVER: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    let output = '';
    child.stdout.on('data', (b) => {
      output += b.toString();
      process.stdout.write(b);
    });
    child.stderr.on('data', (b) => {
      output += b.toString();
      process.stderr.write(b);
    });

    /*
     * C3: the per-file timeout is a BACKSTOP with a measured budget. Without one a hung file hangs the
     * suite forever, and a killed run is indistinguishable from a product failure. A timeout kills only
     * this file's Playwright tree, marks the file TIMEOUT (so it is not reported as a hundred
     * ECONNREFUSED test failures), and the next file still gets a fresh server on a fresh port.
     */
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      console.error(`[batched] ${file} exceeded ${Math.round(timeoutMs / 1000)}s — killing its tree`);
      const verdict = validateKillTarget(child.pid, { ownPid: process.pid, serverPid, spawnPid: child.pid });
      if (verdict.ok) killTree(child.pid, `timeout ${timeoutMs}ms`, { file, fileStartedAt: started });
      else console.error(`[batched] REFUSED timeout kill: ${verdict.reason}`);
      /*
       * AND the server, which is a SIBLING of the Playwright process and therefore is NOT covered by
       * `taskkill /T` on that pid. This is the step 3B2-FIX1 A2 fix for the run-1 defect: a killed
       * Playwright tree left the Brotli server holding the port in a half-dead state, and the files
       * after it all came back ERR_CONNECTION_REFUSED. The server is validated the same way, so a
       * timeout can never take anything but this file's two processes.
       */
      const srvVerdict = validateKillTarget(serverPid, {
        ownPid: process.pid,
        serverPid: null,
        spawnPid: serverPid,
      });
      if (srvVerdict.ok) killTree(serverPid, 'timeout-server-teardown', { file, fileStartedAt: started });
      else console.error(`[batched] REFUSED timeout server kill: ${srvVerdict.reason}`);
    }, timeoutMs);

    let settled = false;
    child.on('close', async (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      /*
       * C2: kill ONLY the pid this run spawned, and refuse anything else. `taskkill /T` on the wrong
       * pid takes the Brotli server with it. The server itself is torn down separately, in the finally
       * below, so the two lifecycles are never entangled.
       */
      const verdict = validateKillTarget(child.pid, { ownPid: process.pid, serverPid, spawnPid: child.pid });
      if (verdict.ok) {
        killTree(child.pid, timedOut ? 'timeout' : 'child-close', { file, fileStartedAt: started });
        waitForExit(child.pid);
      } else {
        console.error(`[batched] REFUSED close kill: ${verdict.reason}`);
      }
      // C1: tear THIS file's server down, always. It is a sibling, so this is the only place it dies.
      killTree(serverPid, 'server-teardown', { file, fileStartedAt: started });
      waitForExit(serverPid);
      const counts = parseCounts(output);
      /*
       * Step 3B2-FIX1 A2: after a timeout, prove the port is actually free before the next file starts.
       * `killTree` returns as soon as taskkill does, which is not the same as the socket being released —
       * and "the port is still taken" is precisely the condition that produced the false reds.
       */
      const freed = timedOut ? await waitForPortFree(port) : true;
      if (!freed) {
        console.error(`[batched] port ${port} is STILL listening after the timeout kill — the ${file} ` +
          'left the harness unusable; the remaining files will be marked not-run (infra)');
      }
      resolve({
        file,
        exitCode: timedOut ? null : signal ? null : code,
        durationMs: Date.now() - started,
        output,
        status: timedOut ? 'TIMEOUT' : code === 0 ? 'passed' : 'failed',
        killReason: timedOut ? 'timeout' : 'child-close',
        timedOut,
        serverPid,
        portFree: freed,
        ...(freed ? {} : { harnessBroken: 'timeout-and-port-stuck' }),
        ...counts,
      });
    });
  });
}

/**
 * Pull Playwright's own footer counts out of the output.
 *
 * A file can exit 0 with fewer tests than it owns (a `--grep`, a filter, a silently unregistered spec),
 * so the summary compares these against the inventory rather than trusting the exit code alone.
 */
function parseCounts(output) {
  const pick = (re) => {
    const m = output.match(re);
    return m ? Number(m[1]) : null;
  };
  const ran = pick(/Running (\d+) tests? using/);
  let passed = pick(/(\d+) passed/);
  let failed = pick(/(\d+) failed/);
  const skipped = pick(/(\d+) skipped/);
  /*
   * A KILLED file never prints a footer, so its counts are null even though tests ran. Fall back to
   * counting the per-test lines (`ok N` / `x N`), which are flushed as each test finishes — otherwise a
   * TIMEOUT reports `?/?` and the summary cannot say how far the file got.
   */
  if (passed === null) passed = (output.match(/^\s+ok\s+\d+/gm) || []).length;
  if (failed === null) failed = (output.match(/^\s+x\s+\d+/gm) || []).length;
  return {
    testsExpectedByRun: ran,
    testsPassed: passed,
    testsFailed: failed,
    testsSkipped: skipped,
  };
}

/**
 * Write the run summary to the ARCHIVE, outside any runner's `outputDir` (step 3B2-FIX1 A4), and to a
 * stable path beside the run log for convenience.
 *
 * Why the archive is separate: Playwright deletes `outputDir` when a run starts, and `.cache/e2e-results`
 * is the config's `outputDir`. A summary kept there was measured gone after two later isolation runs
 * (`docs/E2E.md`), which is how the numbers in a report stop being reproducible. `.cache/e2e-archive/`
 * is referenced by no runner and no spec, so nothing in this repo ever deletes it.
 *
 * The timestamp is UTC to the second and filesystem-safe: two runs in the same second would collide, so
 * milliseconds are included.
 */
function writeSummary(summary, label) {
  const dir = path.join(root, '.cache', 'e2e-archive');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `${stamp}-${label}-summary.json`;

  const archived = path.join(dir, name);
  writeFileSync(archived, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  /* A stable copy where earlier sessions expected it, written only if that directory is writable. */
  const latest = path.join(root, '.cache', 'e2e-results', 'batched-summary.json');
  try {
    mkdirSync(path.dirname(latest), { recursive: true });
    writeFileSync(latest, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  } catch {
    /* The next Playwright run clears this directory anyway; the archive is the record that matters. */
  }

  console.log(`  summary: ${path.relative(root, archived)}`);
  return archived;
}

async function main() {
  const argv = process.argv.slice(2);

  /* `--self-test` drives the whole A5 procedure; `--selftest-run` is its inner run over the two specs. */
  if (argv.includes('--self-test')) {
    const { runSelfTest } = await import('./lib/e2e-selftest.mjs');
    const code = await runSelfTest({ root });
    process.exit(code);
  }

  const selfTestRun = argv.includes('--selftest-run');
  if (selfTestRun) {
    playwrightConfigArgs = ['--config', 'playwright.selftest.config.ts'];
  }

  const filters = selfTestRun
    ? (await import('./lib/e2e-selftest.mjs')).SELFTEST_FILES
    : argv.filter((a) => !a.startsWith('--'));
  const specs = selfTestRun ? filters : selectSpecs(filters);
  if (specs.length === 0) {
    console.error(`[batched] no spec files matched ${JSON.stringify(filters)} in ${specDir}`);
    process.exit(1);
  }

  console.log(`[batched] ${specs.length} spec file(s), one process each\n`);

  /** @type {import('./lib/e2e-batch-core.mjs').FileResult[]} */
  const results = [];
  const usedPorts = [];
  /** Set when the harness is declared unusable; the remaining files are marked, never run. */
  let harnessBroken = null;

  for (const [index, file] of specs.entries()) {
    if (harnessBroken) {
      /*
       * A2: "If the server cannot be restored, mark the remaining files 'not-run (infra)' instead of
       * running them into false reds." A file that cannot reach a live server produces one
       * ERR_CONNECTION_REFUSED per test, and a report full of those reads as product breakage.
       */
      results.push({ ...infraRows([file], harnessBroken)[0], port: null, expected: null });
      continue;
    }

    const port = pickPort(index, usedPorts, BASE_PORT);
    usedPorts.push(port);

    /* Between files, never during one: so this can never kill the server of the file that is
     * running, and the current runner's own children are already gone. */
    cleanPlaywrightOrphans();

    /*
     * A2: a liveness check BEFORE every file, over HTTP. A port that is still held by a corpse from the
     * previous file would otherwise be handed to Playwright and every test in this file would fail on
     * its first fetch. Probing first is what turns that into one honest infra line instead of N reds.
     */
    if (!(await portIsFree(port))) {
      console.error(`[batched] port ${port} is already in use before ${file} — waiting for it to drain`);
      if (!(await waitForPortFree(port, 15_000))) {
        harnessBroken = `port-${port}-held-before-${file}`;
        results.push({ ...infraRows([file], harnessBroken)[0], port, expected: null });
        continue;
      }
    }

    let attempt = 1;
    let outcome = await runOnce(file, port);

    if (outcome.exitCode !== 0) {
      if (shouldRetry(outcome.exitCode, outcome.output, attempt)) {
        console.log(`\n[batched] ${file} exited ${outcome.exitCode} — worker crash, retrying once\n`);
        attempt = 2;
        const retryPort = pickPort(index + specs.length, usedPorts, BASE_PORT);
        usedPorts.push(retryPort);
        outcome = await runOnce(file, retryPort);
        if (outcome.harnessBroken) harnessBroken = outcome.harnessBroken;
        results.push({
          ...outcome,
          file,
          port: retryPort,
          attempts: 2,
          retries: 1,
          exitCode: outcome.exitCode,
        });
        console.log(
          `[batched] ${file} RETRY ${outcome.exitCode === 0 ? 'passed' : `failed again (${outcome.exitCode})`}\n`,
        );
        continue;
      }
      if (outcome.exitCode === null || outcome.exitCode === undefined) {
        console.error(`[batched] ${file} was signalled\n`);
      }
    }

    if (outcome.harnessBroken) harnessBroken = outcome.harnessBroken;

    results.push({
      // Spread the outcome so status / counts / killReason / durationMs all survive into the summary.
      ...outcome,
      file,
      port,
      attempts: attempt,
      retries: 0,
      exitCode: outcome.exitCode,
    });
  }

  // C4: expected counts from the inventory guard's own constant, so the runner cannot drift from it.
  const expected = selfTestRun
    ? { perFile: { 'hangs.spec.ts': 1, 'passes.spec.ts': 1 }, totalFor: (files) => files.length }
    : expectedCounts();
  for (const r of results) {
    r.expected = expected.perFile[r.file] ?? null;
  }
  const summary = buildSummary(results, { expectedTotal: expected.totalFor(specs) });

  console.log('\n===== batched e2e summary =====');
  for (const r of summary.files) {
    const tag =
      r.status === 'passed' ? 'ok  ' : r.status === 'TIMEOUT' ? 'TIME' : r.status === INFRA_STATUS ? 'SKIP' : 'FAIL';
    console.log(
      `  ${tag} ` +
        `${r.file.padEnd(24)} ${(r.durationMs / 1000).toFixed(1).padStart(6)}s  port ${String(r.port ?? '-').padEnd(5)}` +
        `  tests ${r.testsPassed ?? '?'}/${r.expected ?? '?'}` +
        `${r.status === 'TIMEOUT' ? ' (killed)' : ''}` +
        `${r.status === INFRA_STATUS ? `  [${r.killReason}]` : r.killReason && r.status !== 'passed' ? `  [${r.killReason}]` : ''}` +
        `${r.retries ? `  (retried ${r.retries}x)` : ''}`,
    );
  }
  console.log(
    `  ${summary.passed}/${summary.total} files passed` +
      `${summary.retriedFiles.length ? `, retried: ${summary.retriedFiles.join(', ')}` : ', no retries'}` +
      ` — ${summary.tests.actual}/${summary.tests.expected ?? '?'} tests` +
      ` — total ${(summary.totalMs / 60000).toFixed(1)} min\n`,
  );
  if (summary.countMismatches.length) {
    console.error(`  count mismatch in: ${summary.countMismatches.join(', ')}`);
  }
  if (harnessBroken) {
    console.error(`  HARNESS BROKEN: ${harnessBroken} — files not run are marked "${INFRA_STATUS}", not failed`);
  }

  writeSummary(summary, 'batched');

  process.exit(summary.exitCode || (harnessBroken ? 1 : 0));
}

/**
 * Expected per-file test counts, read from the inventory guard so the two cannot diverge.
 *
 * The guard holds the look suite's titles; the other files are counted from the constant below, which
 * is asserted against `playwright --list` by the unit tests.
 */
function expectedCounts() {
  const perFile = {
    'boot.spec.ts': 10,
    'determinism.spec.ts': 2,
    'gate-clock.spec.ts': 1,
    'globe.spec.ts': 5,
    'harden.spec.ts': 8,
    'history-gate.spec.ts': 1,
    'limb.spec.ts': 2,
    'look.spec.ts': 9,
    // Step 3A2: F1-F10, with F2/F3/F4 parameterised over four viewports and F8 over two.
    'frame.spec.ts': 20,
    // Step 3B: four regions x two modes/modes-viewports are recorded cases, plus ONE comparison test.
    // 8 + 1, not 16: the eight per-case tests only WRITE under UPDATE_GOLDEN=1 and otherwise assert the
    // single comparison, so the file's honest size is 9.
    'camera-golden.spec.ts': 9,
    // Step 3B: the five NEW director behaviours (wheel/flag, resize, select, close, drag-cancels-fly).
    'frame-director.spec.ts': 5,
    // Step 3B2: U1-U10. U1 is parameterised over four viewports, U2 over three plus the 1024x768
    // centring-only branch, U5 over three close paths and U7 over two timings. Counted from
    // `playwright --list`, not by hand: 22.
    'focus-ux.spec.ts': 22,
    // Step 3B2-FIX1 B: R1 x8 (four regions x two viewports) + R2 + R3 + R4.
    'reset-ux.spec.ts': 11,
    // Step 3B2-FIX1 D: the sweep, the spin-on rate, the hypothesis stacks and the D4 assertions.
    'pin-click.spec.ts': 4,
    // Step 3B2-FIX2 B: S1 x2 viewports, S2 x2 viewports, S3, S4, S5 x2 viewports.
    'switcher-ux.spec.ts': 8,
    'negative.spec.ts': 14,
    'ref.spec.ts': 2,
    'scene-gate.spec.ts': 2,
  };
  return {
    perFile,
    totalFor: (files) => files.reduce((s, f) => s + (perFile[f] ?? 0), 0),
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
