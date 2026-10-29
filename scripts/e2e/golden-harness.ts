/**
 * Runs the five production queries against LIVE DuckDB-WASM and exposes the
 * results for comparison with tests/fixtures/engine-golden.json.
 *
 * This is the "live DuckDB === golden" half of the parity check. The Vitest side
 * proves TsEngine === golden; this proves the fixture still describes what the
 * browser engine actually returns, so a stale fixture cannot silently excuse a
 * TS regression.
 *
 * Built through Vite (scripts/e2e/vite.config.ts) so @duckdb/duckdb-wasm's bare
 * `apache-arrow` import resolves.
 */
import * as duckdb from '@duckdb/duckdb-wasm';

const CDN = `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${duckdb.PACKAGE_VERSION}/dist`;

const bundle = await duckdb.selectBundle({
  mvp: { mainModule: `${CDN}/duckdb-mvp.wasm`, mainWorker: '/duckdb/duckdb-browser-mvp.worker.js' },
  eh: { mainModule: `${CDN}/duckdb-eh.wasm`, mainWorker: '/duckdb/duckdb-browser-eh.worker.js' },
});

const worker = new Worker(bundle.mainWorker!);
const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

// Same bytes the app loads. Fetched once here; that is the point of the harness.
const csv = await (await fetch('/data/enso.csv')).text();
await db.registerFileText('enso.csv', csv);

const conn = await db.connect();
await conn.query('SET autoinstall_known_extensions=false');
await conn.query('SET autoload_known_extensions=false');
await conn.query(`
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

const SCENARIO_SQL = `WITH params AS (
  SELECT CAST(? AS DOUBLE) AS sst, CAST(? AS DOUBLE) AS jet, CAST(? AS DOUBLE) AS agri
), base AS (
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

const ANALOG_SQL = `SELECT strftime(date,'%Y-%m') AS period, nino_34_anomaly, nino34_sst,
  abs(nino_34_anomaly - CAST(? AS DOUBLE)) AS delta, sst_deviation,
  precip_anomaly_pacific, precip_anomaly_us, precip_anomaly_se_asia,
  precip_anomaly_africa, drought_index_se_asia, risk_tier_pacific
FROM enso_historical ORDER BY delta ASC, date DESC LIMIT 6;`;

const SUMMARY_SQL = `SELECT count(*) AS row_count, strftime(min(date),'%Y-%m') AS first_date,
  strftime(max(date),'%Y-%m') AS last_date, round(avg(nino_34_anomaly),3) AS mean_anomaly,
  round(max(nino_34_anomaly),3) AS max_anomaly,
  strftime(arg_max(date,nino_34_anomaly),'%Y-%m') AS max_anomaly_date,
  count(*) FILTER (WHERE abs(nino_34_anomaly - CAST(? AS DOUBLE)) <= 0.35) AS analog_count,
  count(*) FILTER (WHERE nino_34_anomaly >= 2.0) AS extreme_months,
  count(*) FILTER (WHERE nino_34_anomaly <= -0.5) AS lanina_months,
  any_value(source) AS source FROM enso_historical;`;

const TIMELINE_SQL = `SELECT strftime(date,'%Y-%m') AS date, nino_34_anomaly AS anomaly FROM enso_historical ORDER BY date ASC;`;

const RISK_TIER_SQL = `WITH p AS (SELECT CAST(? AS DOUBLE) AS sst)
SELECT CASE WHEN sst < 0.5 THEN 'Neutral / La Niña Watch' WHEN sst < 1.0 THEN 'Weak Warm Phase'
  WHEN sst < 1.5 THEN 'Moderate El Niño' WHEN sst < 2.0 THEN 'Strong El Niño'
  WHEN sst < 2.6 THEN 'Super El Niño' ELSE 'Extreme Mega-El Niño' END AS risk_tier FROM p;`;

const toJsonable = (rows: unknown[]) =>
  JSON.parse(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));

async function q(sql: string, ...args: unknown[]) {
  if (args.length === 0) return toJsonable((await conn.query(sql)).toArray().map((r) => r.toJSON()));
  const stmt = await conn.prepare(sql);
  try {
    return toJsonable((await stmt.query(...args)).toArray().map((r) => r.toJSON()));
  } finally {
    await stmt.close();
  }
}

// The same 211-point grid the fixture was built from.
const SST = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3];
const JET = [-1, -0.5, 0, 0.5, 1];
const AGRI = [0, 0.2, 0.4, 0.6, 0.8, 1];
const NAMED = [[1.5, 0.35, 0.6], [0, 0, 0], [3, 1, 1]];

const seen = new Set<string>();
const points: Array<[number, number, number]> = [];
const push = (s: number, j: number, a: number) => {
  const k = `${s}|${j}|${a}`;
  if (seen.has(k)) return;
  seen.add(k);
  points.push([s, j, a]);
};
for (const s of SST) for (const j of JET) for (const a of AGRI) push(s, j, a);
for (const [s, j, a] of NAMED) push(s, j, a);

const cases = [];
for (const [sst, jet, agri] of points) {
  cases.push({
    sst, jet, agri,
    metrics: (await q(SCENARIO_SQL, sst, jet, agri))[0],
    riskTier: (await q(RISK_TIER_SQL, sst))[0].risk_tier,
    summary: (await q(SUMMARY_SQL, sst))[0],
    analogs: await q(ANALOG_SQL, sst),
  });
}

const result = { timeline: await q(TIMELINE_SQL), cases };
(window as unknown as { __LIVE: unknown }).__LIVE = result;
(document.getElementById('out') as HTMLElement).textContent = `ok ${cases.length} cases`;
