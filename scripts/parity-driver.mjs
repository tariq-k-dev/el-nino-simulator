/**
 * Parallel driver for scripts/parity-full.ts.
 *
 * The full lattice is 6.1M points and a single process manages ~175 comb/s, so a
 * serial sweep would take ~10 hours. This forks N shards (default: one per core,
 * capped) and sums their counters.
 *
 * Each shard is a disjoint slice (`--shard i/n`), so no point is compared twice
 * and no point is missed.
 *
 *   node scripts/parity-driver.mjs                 # full lattice, all cores
 *   node scripts/parity-driver.mjs --shards 4      # fewer processes
 *   node scripts/parity-driver.mjs --limit 20000   # smoke run
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);

const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};

const cpuCount = os.cpus().length;
const SHARDS = Math.max(1, Math.min(Number(flag('shards', cpuCount)), cpuCount));
const LIMIT = flag('limit', null);

console.log(`parity:full — ${SHARDS} shard(s) across ${cpuCount} cores`);

const extra = [];
if (LIMIT) extra.push('--limit', String(LIMIT));

const started = Date.now();

const runs = Array.from({ length: SHARDS }, (_, i) => {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        '--experimental-strip-types',
        '--import',
        './scripts/alias-hooks.mjs',
        'scripts/parity-full.ts',
        '--json',
        '--shard',
        `${i}/${SHARDS}`,
        ...extra,
      ],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.stderr.on('data', (d) => {
      err += d.toString();
    });

    child.on('close', (code) => {
      // The script prints exactly one JSON line in --json mode.
      const line = out.trim().split('\n').filter((l) => l.startsWith('{')).pop();
      if (!line) {
        resolve({ ok: false, shard: `${i}/${SHARDS}`, code, error: err.trim().slice(0, 400) });
        return;
      }
      try {
        resolve({ ok: code === 0, ...JSON.parse(line) });
      } catch (e) {
        resolve({ ok: false, shard: `${i}/${SHARDS}`, error: `unparseable: ${e.message}` });
      }
    });
  });
});

const results = await Promise.all(runs);
const elapsed = (Date.now() - started) / 1000;

const sum = (k) => results.reduce((a, r) => a + (r[k] ?? 0), 0);
const failures = results.filter((r) => !r.ok || r.error);

const totals = {
  shards: SHARDS,
  combinations: sum('combinations'),
  metricValues: sum('metricValues'),
  mismatches: sum('mismatches'),
  zeroSignDiffs: sum('zeroSignDiffs'),
  riskCompared: sum('riskCompared'),
  riskMismatches: sum('riskMismatches'),
  historyCompared: sum('historyCompared'),
  historyMismatches: sum('historyMismatches'),
  wallClockSec: +elapsed.toFixed(1),
  cpuTimeSec: +results.reduce((a, r) => a + (r.runtimeSec ?? 0), 0).toFixed(1),
  throughput: Math.round(sum('combinations') / Math.max(elapsed, 0.001)),
};

console.log('\n' + '─'.repeat(72));
console.log(`combinations        ${totals.combinations.toLocaleString()}`);
console.log(`wall clock          ${totals.wallClockSec} s  (${totals.throughput.toLocaleString()} comb/s)`);
console.log(`cpu time            ${totals.cpuTimeSec} s across ${SHARDS} shards`);
console.log(`metric values       ${totals.metricValues.toLocaleString()} compared`);
console.log(`  mismatches        ${totals.mismatches}`);
console.log(`  sign-of-zero      ${totals.zeroSignDiffs}`);
console.log(`risk tiers          ${totals.riskCompared.toLocaleString()} compared, ${totals.riskMismatches} mismatch`);
console.log(`history values      ${totals.historyCompared.toLocaleString()} compared, ${totals.historyMismatches} mismatch`);

const samples = results.flatMap((r) => r.samples ?? []).slice(0, 20);
if (samples.length > 0) {
  console.log('\nMISMATCHES (first 20, with pre-round values):');
  for (const m of samples) {
    console.log(
      `  sst=${m.sst} jet=${m.jet} ag=${m.agri}  ${m.field}: ts=${m.ts} duck=${m.duck}\n` +
        `      raw ts=${m.tsRaw} duck=${m.duckRaw}`,
    );
  }
}

const zeroSamples = results.flatMap((r) => r.zeroSamples ?? []).slice(0, 10);
if (zeroSamples.length > 0) {
  console.log('\nsign-of-zero samples (equal numerically; formatting-layer concern):');
  for (const z of zeroSamples) {
    console.log(`  sst=${z.sst} jet=${z.jet} ag=${z.agri} ${z.field}`);
  }
}

if (failures.length > 0) {
  console.log('\nSHARD FAILURES:');
  for (const f of failures) console.log(`  ${f.shard}: ${f.error ?? `exit ${f.code}`}`);
}

const bad = totals.mismatches + totals.riskMismatches + totals.historyMismatches + failures.length;
console.log(bad === 0 ? '\n  OK  full lattice parity holds (Object.is)\n' : `\n  FAIL  ${bad} problem(s)\n`);
process.exit(bad === 0 ? 0 : 1);
