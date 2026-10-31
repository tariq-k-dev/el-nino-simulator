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
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregate, pickPort, shouldRetry } from './lib/e2e-batch-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const specDir = path.join(root, 'tests', 'e2e');

/** Ports are allocated per file from this base; playwright.config.ts reads `E2E_PORT`. */
const BASE_PORT = 4300;

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

function killTree(pid) {
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

/** One attempt at one file. Returns the result without deciding whether to retry. */
function runOnce(file, port) {
  return new Promise((resolve) => {
    const started = Date.now();
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

    child.on('close', (code, signal) => {
      /*
       * The child is gone, but its server may not be, and its trace writer may still be flushing.
       * Kill the tree while the pid is valid, then WAIT for the tree to actually disappear: the
       * next file deletes and recreates its own artifacts dir, and a lingering process from this
       * one is what produced the trace ENOENT.
       */
      killTree(child.pid);
      waitForExit(child.pid);
      resolve({
        file,
        exitCode: signal ? null : code,
        durationMs: Date.now() - started,
        output,
      });
    });
  });
}

async function main() {
  const filters = process.argv.slice(2);
  const specs = selectSpecs(filters);
  if (specs.length === 0) {
    console.error(`[batched] no spec files matched ${JSON.stringify(filters)} in ${specDir}`);
    process.exit(1);
  }

  console.log(`[batched] ${specs.length} spec file(s), one process each\n`);

  /** @type {import('./lib/e2e-batch-core.mjs').FileResult[]} */
  const results = [];
  const usedPorts = [];

  for (const [index, file] of specs.entries()) {
    const port = pickPort(index, usedPorts, BASE_PORT);
    usedPorts.push(port);

    /* Between files, never during one: so this can never kill the server of the file that is
     * running, and the current runner's own children are already gone. */
    cleanPlaywrightOrphans();

    let attempt = 1;
    let outcome = await runOnce(file, port);

    if (outcome.exitCode !== 0) {
      if (shouldRetry(outcome.exitCode, outcome.output, attempt)) {
        console.log(`\n[batched] ${file} exited ${outcome.exitCode} — worker crash, retrying once\n`);
        attempt = 2;
        const retryPort = pickPort(index + specs.length, usedPorts, BASE_PORT);
        usedPorts.push(retryPort);
        outcome = await runOnce(file, retryPort);
        results.push({
          file,
          ok: outcome.exitCode === 0,
          attempts: 2,
          retried: true,
          exitCode: outcome.exitCode,
          durationMs: outcome.durationMs,
          port: retryPort,
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

    results.push({
      file,
      ok: outcome.exitCode === 0,
      attempts: attempt,
      retried: false,
      exitCode: outcome.exitCode,
      durationMs: outcome.durationMs,
      port,
    });
  }

  const summary = aggregate(results);

  console.log('\n===== batched e2e summary =====');
  for (const r of summary.files) {
    console.log(
      `  ${r.ok ? 'ok  ' : 'FAIL'} ${r.file.padEnd(28)} ` +
        `${(r.durationMs / 1000).toFixed(1).padStart(6)}s  port ${r.port}` +
        `${r.retried ? '  (retried once)' : ''}`,
    );
  }
  console.log(
    `  ${summary.passed}/${summary.total} files passed` +
      `${summary.retriedFiles.length ? `, retried: ${summary.retriedFiles.join(', ')}` : ', no retries'}` +
      ` — total ${(summary.totalMs / 60000).toFixed(1)} min\n`,
  );

  process.exit(summary.exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
