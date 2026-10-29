/**
 * Playwright check: LIVE DuckDB-WASM === tests/fixtures/engine-golden.json.
 *
 * The Vitest suite proves TsEngine === fixture. This proves the fixture still
 * describes what the real browser engine returns, so a stale fixture cannot
 * silently excuse a TS regression.
 *
 *   pnpm e2e:golden      (builds the harness, serves dist/, compares)
 *
 * Not part of `pnpm test`: it needs a browser and the CDN wasm, so CI runs it
 * only when explicitly asked.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, cpSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.E2E_PORT || 4195);
const RELATIVE_TOLERANCE = 1e-9;

const golden = JSON.parse(readFileSync(path.join(root, 'tests/fixtures/engine-golden.json'), 'utf8'));

// --- build the harness ------------------------------------------------------
function build() {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.execPath,
      [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'scripts/e2e/vite.config.ts'],
      { cwd: root, stdio: 'inherit' },
    );
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`vite build exited ${code}`))));
  });
}

// --- serve dist/ + the harness ---------------------------------------------
function serve() {
  // Merge the harness into dist/ so /data/enso.csv and /duckdb/* resolve
  // same-origin, then serve with vite preview.
  const built = path.join(root, '.cache/e2e-build');
  const target = path.join(root, 'dist/e2e');
  mkdirSync(target, { recursive: true });
  cpSync(built, target, { recursive: true });

  const proc = spawn(
    process.execPath,
    [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'],
    { cwd: root, stdio: 'ignore', detached: true, windowsHide: true },
  );
  proc.unref();
  return proc.pid;
}

function expectClose(actual, expected, where, diffs) {
  if (expected === 0) {
    if (actual !== 0) diffs.push(`${where}: ${actual} vs 0`);
    return;
  }
  const rel = Math.abs(actual - expected) / Math.abs(expected);
  if (!(rel <= RELATIVE_TOLERANCE)) {
    diffs.push(`${where}: ${actual} vs ${expected} (rel ${rel.toExponential(3)})`);
  }
}

async function main() {
  if (!existsSync(path.join(root, 'dist/index.html'))) {
    throw new Error('dist/ missing — run `pnpm build` first.');
  }

  await build();
  const pid = serve();
  // Give preview a moment to bind.
  await new Promise((r) => setTimeout(r, 4000));

  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 200));
  });

  const extensionRequests = [];
  await page.route('**/extensions.duckdb.org/**', (route) => {
    extensionRequests.push(route.request().url());
    route.abort();
  });

  await page.goto(`http://localhost:${PORT}/e2e/golden-harness.html`, { waitUntil: 'domcontentloaded' });

  let live = null;
  try {
    await page.waitForFunction(() => window.__LIVE !== undefined, { timeout: 180_000 });
    live = await page.evaluate(() => window.__LIVE);
  } catch {
    throw new Error(`harness never produced results. errors: ${errors.join(' | ') || 'none'}`);
  }

  await browser.close();
  try {
    process.kill(pid);
  } catch {
    /* already gone */
  }

  // --- compare --------------------------------------------------------------
  const diffs = [];

  if (live.timeline.length !== golden.timeline.length) {
    diffs.push(`timeline length ${live.timeline.length} vs ${golden.timeline.length}`);
  }
  for (let i = 0; i < Math.min(live.timeline.length, golden.timeline.length); i += 1) {
    if (live.timeline[i].date !== golden.timeline[i].date) {
      diffs.push(`timeline[${i}].date ${live.timeline[i].date} vs ${golden.timeline[i].date}`);
    }
    expectClose(live.timeline[i].anomaly, golden.timeline[i].anomaly, `timeline[${i}].anomaly`, diffs);
  }

  if (live.cases.length !== golden.cases.length) {
    diffs.push(`case count ${live.cases.length} vs ${golden.cases.length}`);
  }

  const metricKeys = [
    ['sst', 'sst'], ['jet', 'jet'], ['agri', 'agri'],
    ['pacific_sst_dev', 'pacific_sst_dev'], ['pacific_convection', 'pacific_convection'],
    ['us_precip', 'us_precip'], ['us_precip_base', 'us_precip_base'],
    ['us_temp_dev_f', 'us_temp_dev_f'],
    ['asia_precip', 'asia_precip'], ['asia_drought', 'asia_drought'],
    ['africa_precip', 'africa_precip'], ['africa_flood', 'africa_flood'],
    ['global_impact_index', 'global_impact_index'],
    ['agriculture_exposure', 'agriculture_exposure'],
  ];

  const summaryKeys = [
    ['row_count', 'row_count'], ['first_date', 'first_date'], ['last_date', 'last_date'],
    ['mean_anomaly', 'mean_anomaly'], ['max_anomaly', 'max_anomaly'],
    ['max_anomaly_date', 'max_anomaly_date'], ['analog_count', 'analog_count'],
    ['extreme_months', 'extreme_months'], ['lanina_months', 'lanina_months'],
    ['source', 'source'],
  ];

  for (let ci = 0; ci < Math.min(live.cases.length, golden.cases.length); ci += 1) {
    const L = live.cases[ci];
    const G = golden.cases[ci];
    const tag = `case[${ci}](${G.sst},${G.jet},${G.agri})`;

    for (const [k] of metricKeys) {
      expectClose(L.metrics[k], G.metrics[k], `${tag}.${k}`, diffs);
    }
    if (L.riskTier !== G.riskTier) diffs.push(`${tag}.riskTier ${L.riskTier} vs ${G.riskTier}`);

    for (const [k] of summaryKeys) {
      const a = L.summary[k];
      const b = G.summary[k];
      if (typeof b === 'number') expectClose(a, b, `${tag}.summary.${k}`, diffs);
      else if (a !== b) diffs.push(`${tag}.summary.${k} ${a} vs ${b}`);
    }

    if (L.analogs.length !== G.analogs.length) {
      diffs.push(`${tag}.analogs length ${L.analogs.length} vs ${G.analogs.length}`);
    }
    for (let k = 0; k < Math.min(L.analogs.length, G.analogs.length); k += 1) {
      const a = L.analogs[k];
      const b = G.analogs[k];
      if (a.period !== b.period) diffs.push(`${tag}.analog[${k}].period ${a.period} vs ${b.period}`);
      expectClose(a.delta, b.delta, `${tag}.analog[${k}].delta`, diffs);
      expectClose(a.nino_34_anomaly, b.nino_34_anomaly, `${tag}.analog[${k}].anomaly`, diffs);
      expectClose(a.nino34_sst, b.nino34_sst, `${tag}.analog[${k}].sst`, diffs);
    }
  }

  console.log(
    JSON.stringify(
      {
        liveCases: live.cases.length,
        goldenCases: golden.cases.length,
        timelineRows: live.timeline.length,
        extensionRequests: extensionRequests.length,
        consoleErrors: errors.length,
        differences: diffs.length,
        sample: diffs.slice(0, 10),
      },
      null,
      2,
    ),
  );

  if (diffs.length > 0 || extensionRequests.length > 0) {
    process.exitCode = 1;
  } else {
    console.log('\n  OK  live DuckDB matches the committed golden fixture, and no extensions.duckdb.org requests.\n');
  }
}

main().catch((error) => {
  console.error('live golden check failed:', error.message);
  process.exit(1);
});
