/**
 * Full-lattice parity: every UI slider combination, TsEngine vs live DuckDB.
 *
 *   pnpm parity:full              # every lattice point
 *   pnpm parity:full -- --limit 5000 --stride 400   # smoke run
 *
 * NOT part of the gate: it runs a multi-million-query sweep and takes minutes.
 *
 * What "every lattice combination" means here
 * -------------------------------------------
 * The sliders are step=0.01, so the reachable lattice is
 *   strength 0..3       (301 values)
 *   jet     -1..1       (201 values)
 *   ag       0..1       (101 values)
 * = 6,110,301 points.
 *
 * Two different query families are compared, deliberately:
 *
 *  1. scenario + riskTier — pure arithmetic over the three parameters. These are
 *     the only outputs that actually vary with all three sliders, so they are run
 *     over the FULL lattice (6.1M points).
 *
 *  2. summary + analogs — these scan the 918-row table but depend ONLY on
 *     `strength`. Running them 6.1M times would be 5.6 billion row scans for zero
 *     extra coverage, so they are run once per distinct lattice value of
 *     `strength` (301 points) via their own engine methods. Every numeric output
 *     the app can produce is still covered.
 *
 * Comparison is `Object.is`, which distinguishes -0 from 0 and treats NaN as
 * equal to NaN. Any sign-of-zero differences are reported as a separate class
 * rather than counted as mismatches, because -0 and 0 format differently in the
 * UI ("-0.0") while being numerically identical.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseDataset } from '../src/lib/data/parse.ts';
import { createTsEngine } from '../src/lib/engine/tsEngine.ts';
import {
  AGRI_MAX,
  AGRI_MIN,
  JET_MAX,
  JET_MIN,
  SST_MAX,
  SST_MIN,
  computeMetrics,
} from '../src/lib/model.ts';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const CSV_PATH = path.join(ROOT, 'public', 'data', 'enso.csv');

/** Slider step, from src/components/ControlDeck.tsx (`step={0.01}`). */
const STEP = 0.01;

/** Turn a lattice index into the value the slider would produce. */
const lattice = (min: number, max: number, i: number) =>
  // Index-based rather than accumulated addition: repeated += 0.01 drifts.
  Number((min + i * STEP).toFixed(10)) || 0;

const count = (min: number, max: number) => Math.round((max - min) / STEP) + 1;

// ---------------------------------------------------------------- SQL mirror
// Copied from src/lib/duckdb.ts so this script has no dependency on the build.
const SCENARIO_SQL = `
WITH params AS (SELECT CAST(? AS DOUBLE) AS sst, CAST(? AS DOUBLE) AS jet, CAST(? AS DOUBLE) AS agri),
base AS (
  SELECT sst, jet, agri,
    sst * 1.15 AS pacific_sst_dev, least(100.0, sst * 35.0) AS pacific_convection,
    (15.0 + sst * 18.0) AS us_precip_base, (15.0 + sst * 18.0) + jet * 12.0 AS us_precip,
    (-0.5 - sst * 0.8) - jet * 0.6 AS us_temp_dev_f, (-10.0 - sst * 22.0) - jet * 9.0 AS asia_precip,
    least(10.0, greatest(0.0, sst * 3.2 * (1.0 + jet * 0.15))) AS asia_drought,
    (20.0 + sst * 25.0) + jet * -4.0 AS africa_precip,
    least(10.0, greatest(0.0, sst * 2.8)) AS africa_flood
  FROM params)
SELECT round(sst,2) AS sst, round(jet,2) AS jet, round(agri,2) AS agri,
  round(pacific_sst_dev,2) AS pacific_sst_dev, round(pacific_convection,1) AS pacific_convection,
  round(us_precip,1) AS us_precip, round(us_precip_base,1) AS us_precip_base,
  round(us_temp_dev_f,2) AS us_temp_dev_f, round(asia_precip,1) AS asia_precip,
  round(asia_drought,2) AS asia_drought, round(africa_precip,1) AS africa_precip,
  round(africa_flood,2) AS africa_flood,
  round(least(100.0,greatest(0.0,((abs(us_precip)+abs(asia_precip)+abs(africa_precip))/3.0/60.0)*100.0)),1) AS global_impact_index,
  round(least(100.0,greatest(0.0,((asia_drought/10.0)*0.5+(africa_flood/10.0)*0.3+(pacific_convection/100.0)*0.2)*(0.55+agri*0.45)*100.0)),1) AS agriculture_exposure
FROM base;`;

/** Same expressions WITHOUT round(), for diagnosing a mismatch's pre-round value. */
const SCENARIO_RAW_SQL = `
WITH params AS (SELECT CAST(? AS DOUBLE) AS sst, CAST(? AS DOUBLE) AS jet, CAST(? AS DOUBLE) AS agri),
base AS (
  SELECT sst, jet, agri,
    sst * 1.15 AS pacific_sst_dev, least(100.0, sst * 35.0) AS pacific_convection,
    (15.0 + sst * 18.0) AS us_precip_base, (15.0 + sst * 18.0) + jet * 12.0 AS us_precip,
    (-0.5 - sst * 0.8) - jet * 0.6 AS us_temp_dev_f, (-10.0 - sst * 22.0) - jet * 9.0 AS asia_precip,
    least(10.0, greatest(0.0, sst * 3.2 * (1.0 + jet * 0.15))) AS asia_drought,
    (20.0 + sst * 25.0) + jet * -4.0 AS africa_precip,
    least(10.0, greatest(0.0, sst * 2.8)) AS africa_flood
  FROM params)
SELECT pacific_sst_dev, pacific_convection, us_precip, us_precip_base, us_temp_dev_f,
  asia_precip, asia_drought, africa_precip, africa_flood
FROM base;`;

const RISK_TIER_SQL = `
WITH p AS (SELECT CAST(? AS DOUBLE) AS sst)
SELECT CASE WHEN sst < 0.5 THEN 'Neutral / La Niña Watch' WHEN sst < 1.0 THEN 'Weak Warm Phase'
  WHEN sst < 1.5 THEN 'Moderate El Niño' WHEN sst < 2.0 THEN 'Strong El Niño'
  WHEN sst < 2.6 THEN 'Super El Niño' ELSE 'Extreme Mega-El Niño' END AS risk_tier FROM p;`;

// ------------------------------------------------------------- TS raw values
/** Mirror of SCENARIO_RAW_SQL in TS, used only to print a mismatch's pre-round state. */
function tsRaw(sst: number, jet: number) {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return {
    pacific_sst_dev: sst * 1.15,
    pacific_convection: Math.min(100, sst * 35),
    us_precip_base: 15 + sst * 18,
    us_precip: 15 + sst * 18 + jet * 12,
    us_temp_dev_f: -0.5 - sst * 0.8 - jet * 0.6,
    asia_precip: -10 - sst * 22 - jet * 9,
    asia_drought: clamp(sst * 3.2 * (1 + jet * 0.15), 0, 10),
    africa_precip: 20 + sst * 25 + jet * -4,
    africa_flood: clamp(sst * 2.8, 0, 10),
  };
}

// --------------------------------------------------------------------- setup
const args = process.argv.slice(2);
const flag = (name: string): number | null => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : null;
};
const LIMIT = flag('limit');
const STRIDE = flag('stride') ?? 1;

/**
 * `--shard i/n` runs a disjoint slice of the lattice so the full sweep can be
 * spread across processes. Sharding is by flattened index modulo n, which keeps
 * the slices equal-sized and lets the parent sum the counters.
 */
const shardArg = args.indexOf('--shard') >= 0 ? args[args.indexOf('--shard') + 1] : null;
const [SHARD_INDEX, SHARD_COUNT] = shardArg
  ? shardArg.split('/').map(Number)
  : [0, 1];

const csv = readFileSync(CSV_PATH, 'utf8');
const rows = parseDataset(csv);
const tsEngine = createTsEngine({ rows });

const blocking = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs');

const db = await blocking.createDuckDB(
  {
    mvp: {
      mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm'),
      mainWorker: null,
    },
  },
  new blocking.ConsoleLogger(blocking.LogLevel.WARNING),
  blocking.NODE_RUNTIME,
);
await db.instantiate();

const conn = db.connect();
conn.query('SET autoinstall_known_extensions=false');
conn.query('SET autoload_known_extensions=false');

// The SAME read_csv path production uses — no parquet, no extension.
db.registerFileText('enso.csv', csv);
conn.query(`
  CREATE OR REPLACE TABLE enso_historical AS
  SELECT * FROM read_csv('enso.csv', header=true, columns={
    'date': 'DATE', 'year': 'INTEGER', 'month': 'INTEGER',
    'nino12_sst': 'DOUBLE', 'nino12_anomaly': 'DOUBLE',
    'nino3_sst': 'DOUBLE', 'nino3_anomaly': 'DOUBLE',
    'nino4_sst': 'DOUBLE', 'nino4_anomaly': 'DOUBLE',
    'nino34_sst': 'DOUBLE', 'nino_34_anomaly': 'DOUBLE',
    'global_sst_anomaly': 'DOUBLE', 'sst_deviation': 'DOUBLE',
    'convection_shift': 'DOUBLE', 'precip_anomaly_pacific': 'DOUBLE',
    'precip_anomaly_us': 'DOUBLE', 'temp_deviation_us_f': 'DOUBLE',
    'precip_anomaly_se_asia': 'DOUBLE', 'drought_index_se_asia': 'DOUBLE',
    'precip_anomaly_africa': 'DOUBLE', 'flood_index_horn': 'DOUBLE',
    'agriculture_exposure': 'DOUBLE', 'risk_tier_pacific': 'VARCHAR',
    'source': 'VARCHAR', 'model_basis': 'VARCHAR'
  })
`);

const toObj = (t: { toArray: () => Array<{ toJSON: () => Record<string, unknown> }> }) =>
  JSON.parse(JSON.stringify(t.toArray().map((r) => r.toJSON()), (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));

// Prepared once, reused millions of times — the whole point of the blocking path.
const stmtScenario = conn.prepare(SCENARIO_SQL);
const stmtRaw = conn.prepare(SCENARIO_RAW_SQL);
const stmtRisk = conn.prepare(RISK_TIER_SQL);

// ---------------------------------------------------------------- comparison
type Mismatch = {
  sst: number;
  jet: number;
  agri: number;
  field: string;
  ts: number;
  duck: number;
  tsRaw: number;
  duckRaw: number;
};

const mismatches: Mismatch[] = [];
const zeroSignDiffs: Array<{ sst: number; jet: number; agri: number; field: string; ts: number; duck: number }> = [];
let compared = 0;
let riskCompared = 0;
let riskMismatches = 0;

const METRIC_FIELDS: Array<[keyof ReturnType<typeof computeMetrics>, string]> = [
  ['sst', 'sst'],
  ['jet', 'jet'],
  ['agri', 'agri'],
  ['pacificSstDev', 'pacific_sst_dev'],
  ['pacificConvection', 'pacific_convection'],
  ['usPrecip', 'us_precip'],
  ['usPrecipBase', 'us_precip_base'],
  ['usTempDevF', 'us_temp_dev_f'],
  ['asiaPrecip', 'asia_precip'],
  ['asiaDrought', 'asia_drought'],
  ['africaPrecip', 'africa_precip'],
  ['africaFlood', 'africa_flood'],
  ['globalImpactIndex', 'global_impact_index'],
  ['agricultureExposure', 'agriculture_exposure'],
];

/** TS HistoricalSummary field -> SQL column alias. */
const SUMMARY_FIELDS: Array<[keyof Awaited<ReturnType<typeof tsEngine.summary>>, string]> = [
  ['rowCount', 'row_count'],
  ['firstDate', 'first_date'],
  ['lastDate', 'last_date'],
  ['meanAnomaly', 'mean_anomaly'],
  ['maxAnomaly', 'max_anomaly'],
  ['maxAnomalyDate', 'max_anomaly_date'],
  ['analogCount', 'analog_count'],
  ['extremeMonths', 'extreme_months'],
  ['laninaMonths', 'lanina_months'],
  ['source', 'source'],
];

const nSst = count(SST_MIN, SST_MAX);
const nJet = count(JET_MIN, JET_MAX);
const nAgri = count(AGRI_MIN, AGRI_MAX);
const total = nSst * nJet * nAgri;

console.log(
  `lattice: strength ${nSst} × jet ${nJet} × ag ${nAgri} = ${total.toLocaleString()} combinations` +
    (LIMIT ? ` (limited to ${LIMIT})` : STRIDE > 1 ? ` (stride ${STRIDE})` : ''),
);

const started = Date.now();
let done = 0;

outer: for (let si = 0; si < nSst; si += STRIDE) {
  const sst = lattice(SST_MIN, SST_MAX, si);

  for (let ji = 0; ji < nJet; ji += 1) {
    const jet = lattice(JET_MIN, JET_MAX, ji);

    for (let ai = 0; ai < nAgri; ai += 1) {
      const agri = lattice(AGRI_MIN, AGRI_MAX, ai);

      // Disjoint slice for this shard: flatten (si, ji, ai) and take idx % n.
      const flatIdx = (si * nJet + ji) * nAgri + ai;
      if (SHARD_COUNT > 1 && flatIdx % SHARD_COUNT !== SHARD_INDEX) continue;

      const ts = computeMetrics({ sstAnomaly: sst, jetStreamShift: jet, agricultureWeight: agri });
      const duckRow = toObj(stmtScenario.query(sst, jet, agri))[0];

      for (const [tsKey, duckKey] of METRIC_FIELDS) {
        const a = ts[tsKey] as number;
        const b = Number(duckRow[duckKey]);
        compared += 1;

        if (!Object.is(a, b)) {
          // Distinguish -0 from 0: numerically equal, but formats as "-0.0".
          if (a === 0 && b === 0) {
            if (zeroSignDiffs.length < 50) {
              zeroSignDiffs.push({ sst, jet, agri, field: String(tsKey), ts: a, duck: b });
            }
            continue;
          }

          const raw = tsRaw(sst, jet);
          const duckRawRow = toObj(stmtRaw.query(sst, jet, agri))[0];
          if (mismatches.length < 20) {
            mismatches.push({
              sst,
              jet,
              agri,
              field: String(tsKey),
              ts: a,
              duck: b,
              tsRaw: Number((raw as Record<string, number>)[duckKey]),
              duckRaw: Number(duckRawRow[duckKey]),
            });
          }
        }
      }

      riskCompared += 1;
      const tsRisk = ts.riskTier;
      const duckRisk = String(toObj(stmtRisk.query(sst))[0].risk_tier);
      if (tsRisk !== duckRisk) riskMismatches += 1;

      done += 1;
      if (LIMIT && done >= LIMIT) break outer;
    }
  }

  if (!args.includes('--json') && si % Math.max(1, Math.floor(nSst / 20)) === 0) {
    const pct = ((done / (LIMIT ?? total)) * 100).toFixed(1);
    process.stdout.write(`\r  ${done.toLocaleString()} combinations (${pct}%) …`);
  }
}

// --- history outputs: depend only on strength, so one pass per lattice value --
let historyCompared = 0;
let historyMismatches = 0;
for (let si = 0; si < nSst; si += STRIDE) {
  if (SHARD_COUNT > 1 && si % SHARD_COUNT !== SHARD_INDEX) continue;
  const sst = lattice(SST_MIN, SST_MAX, si);

  const tsSummary = await tsEngine.summary(sst);
  const duckSummary = toObj(conn.prepare(
    `SELECT count(*) AS row_count, strftime(min(date),'%Y-%m') AS first_date,
      strftime(max(date),'%Y-%m') AS last_date, round(avg(nino_34_anomaly),3) AS mean_anomaly,
      round(max(nino_34_anomaly),3) AS max_anomaly,
      strftime(arg_max(date,nino_34_anomaly),'%Y-%m') AS max_anomaly_date,
      count(*) FILTER (WHERE abs(nino_34_anomaly - CAST(? AS DOUBLE)) <= 0.35) AS analog_count,
      count(*) FILTER (WHERE nino_34_anomaly >= 2.0) AS extreme_months,
      count(*) FILTER (WHERE nino_34_anomaly <= -0.5) AS lanina_months,
      any_value(source) AS source FROM enso_historical;`,
  ).query(sst))[0];

  // TS uses camelCase, SQL returns snake_case — map explicitly. Comparing by
  // key name would read `duckSummary['rowCount']` as undefined and report a
  // mismatch for every field of every point.
  for (const [tsKey, duckKey] of SUMMARY_FIELDS) {
    historyCompared += 1;
    const v = tsSummary[tsKey] as number | string;
    const d = duckSummary[duckKey];
    if (typeof v === 'number' && typeof d === 'number') {
      if (!Object.is(v, d) && !(v === 0 && d === 0)) historyMismatches += 1;
    } else if (String(v) !== String(d)) {
      historyMismatches += 1;
    }
  }

  const tsAnalogs = await tsEngine.analogs(sst);
  const duckAnalogs = toObj(conn.prepare(
    `SELECT strftime(date,'%Y-%m') AS period, nino_34_anomaly, nino34_sst,
      abs(nino_34_anomaly - CAST(? AS DOUBLE)) AS delta FROM enso_historical
     ORDER BY delta ASC, date DESC LIMIT 6;`,
  ).query(sst));

  for (let i = 0; i < Math.max(tsAnalogs.length, duckAnalogs.length); i += 1) {
    historyCompared += 1;
    const a = tsAnalogs[i];
    const b = duckAnalogs[i];
    if (!a || !b) {
      historyMismatches += 1;
      continue;
    }
    if (a.date !== b.period) historyMismatches += 1;
    if (!Object.is(a.delta, Number(b.delta)) && !(a.delta === 0 && Number(b.delta) === 0)) historyMismatches += 1;
  }
}

const elapsed = (Date.now() - started) / 1000;

// ------------------------------------------------------------------- report
console.log('\n');
const result = {
  shard: `${SHARD_INDEX}/${SHARD_COUNT}`,
  combinations: done,
  metricValues: compared,
  mismatches: mismatches.length,
  zeroSignDiffs: zeroSignDiffs.length,
  riskCompared,
  riskMismatches,
  historyCompared,
  historyMismatches,
  runtimeSec: +elapsed.toFixed(2),
  samples: mismatches.slice(0, 20),
  zeroSamples: zeroSignDiffs.slice(0, 50),
};

if (args.includes('--json')) {
  console.log(JSON.stringify(result));
  stmtScenario.close();
  stmtRaw.close();
  stmtRisk.close();
  conn.close();
  process.exit(result.mismatches + result.riskMismatches + result.historyMismatches === 0 ? 0 : 1);
}

console.log('─'.repeat(72));
console.log(`combinations        ${done.toLocaleString()}`);
console.log(`runtime             ${elapsed.toFixed(1)} s  (${(done / Math.max(elapsed, 0.001)).toFixed(0)} comb/s)`);
console.log(`metric values       ${compared.toLocaleString()} compared`);
console.log(`  mismatches        ${mismatches.length > 0 ? mismatches.length : 0}`);
console.log(`  sign-of-zero      ${zeroSignDiffs.length} (numerically equal; formatting-layer concern)`);
console.log(`risk-tier values    ${riskCompared.toLocaleString()} compared, ${riskMismatches} mismatch`);
console.log(`history values      ${historyCompared.toLocaleString()} compared, ${historyMismatches} mismatch`);

if (zeroSignDiffs.length > 0) {
  console.log('\nsign-of-zero samples (Object.is distinguishes these; the UI prints "-0.0"):');
  for (const z of zeroSignDiffs.slice(0, 8)) {
    console.log(`  sst=${z.sst} jet=${z.jet} ag=${z.agri} ${z.field}: ts=${Object.is(z.ts, -0) ? '-0' : '0'} duck=${Object.is(z.duck, -0) ? '-0' : '0'}`);
  }
}

if (mismatches.length > 0) {
  console.log('\nMISMATCHES (first 20, with pre-round values):');
  for (const m of mismatches) {
    console.log(
      `  sst=${m.sst} jet=${m.jet} ag=${m.agri}  ${m.field}: ts=${m.ts} duck=${m.duck}\n` +
        `      raw ts=${m.tsRaw} duck=${m.duckRaw}`,
    );
  }
}

stmtScenario.close();
stmtRaw.close();
stmtRisk.close();
conn.close();
// The blocking bindings expose no close()/terminate(); the process exits below.
// @ts-expect-error -- not present on DuckDBBindingsBase
if (typeof db.close === 'function') db.close();

const bad = mismatches.length + riskMismatches + historyMismatches;
console.log(bad === 0 ? '\n  OK  full lattice parity holds (Object.is)\n' : `\n  FAIL  ${bad} mismatch(es)\n`);
process.exit(bad === 0 ? 0 : 1);
