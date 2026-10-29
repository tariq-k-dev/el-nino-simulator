/**
 * DuckDB-WASM analytics engine.
 *
 * Boots an in-browser OLAP database, materialises the historical dataset into a
 * table, and runs the scenario SQL that backs every metric in the HUD. The SQL
 * below is a 1:1 mirror of computeMetrics() in model.ts — model.test.ts asserts
 * the two agree, so the fallback path and the query path can never silently
 * diverge.
 *
 * Why DuckDB at all when the math is 20 lines of arithmetic? Because the same
 * query also scans 918 historical months for analog matching, maps the seasonal
 * timeline, and stays honest if the dataset grows to tens of thousands of rows
 * or multiple variables. It keeps the analytics in SQL where a reviewer can
 * read it, rather than buried in a component.
 *
 * Why CSV and not Parquet
 * -----------------------
 * `read_parquet()` lives in DuckDB's `parquet` extension, which duckdb-wasm
 * fetches from `extensions.duckdb.org` at runtime on first use. That is an
 * undeclared third-party dependency on the cold path: an extra ~2 MB request
 * the app does not control, cannot version, and adds a failure mode on mobile
 * networks. `read_csv()` is built into the wasm core and needs no extension, so
 * the engine becomes fully self-contained.
 *
 * `data/enso_historical.parquet` is the repo-only source of truth (validated by
 * dataset.test.ts); `public/data/enso.csv` is a derived artifact emitted from the
 * same Polars frame by scripts/generate_enso_data.py, so the two cannot drift.
 * The parquet deliberately lives outside public/ so it can never be served.
 */

import * as duckdb from '@duckdb/duckdb-wasm';
import type {
  AnalogMonth,
  AnalyticsPayload,
  HistoricalSummary,
  ScenarioMetrics,
  TimelinePoint,
} from '@/types/enso';
import { computeMetrics } from '@/lib/model';
import { engineStore } from '@/lib/engine/store';
import { getDecodedBytes, type BundleKind } from '@/lib/engine/manifest';
import { BootTimeoutError, createWatchdog } from '@/lib/engine/watchdog';
import { acquireWorker, WorkerLoadError } from '@/lib/engine/workerBoot';

/** 'auto' applies the projected cap and early abort; 'user' only connect + stall. */
export type BootMode = 'auto' | 'user';

/**
 * Derived CSV, emitted by scripts/generate_enso_data.py.
 * Loaded with read_csv() so no DuckDB extension is required at runtime.
 */
const DATA_URL = '/data/enso.csv';
const DATA_FILE = 'enso.csv';

/**
 * Explicit column types for read_csv.
 *
 * Inference is deliberately bypassed: it would sample rows and could map `date`
 * to VARCHAR or pick a narrower numeric type on a different data window, making
 * results depend on the data rather than on the schema. These mirror
 * public/data/schema.sql one-for-one, with INTEGER for the two small ints and
 * DOUBLE for every numeric measure (the CSV round-trips Int32 as Int64, which
 * the queries do not observe).
 */
const CSV_COLUMNS = `{
    'date': 'DATE',
    'year': 'INTEGER',
    'month': 'INTEGER',
    'nino12_sst': 'DOUBLE',
    'nino12_anomaly': 'DOUBLE',
    'nino3_sst': 'DOUBLE',
    'nino3_anomaly': 'DOUBLE',
    'nino4_sst': 'DOUBLE',
    'nino4_anomaly': 'DOUBLE',
    'nino34_sst': 'DOUBLE',
    'nino_34_anomaly': 'DOUBLE',
    'global_sst_anomaly': 'DOUBLE',
    'sst_deviation': 'DOUBLE',
    'convection_shift': 'DOUBLE',
    'precip_anomaly_pacific': 'DOUBLE',
    'precip_anomaly_us': 'DOUBLE',
    'temp_deviation_us_f': 'DOUBLE',
    'precip_anomaly_se_asia': 'DOUBLE',
    'drought_index_se_asia': 'DOUBLE',
    'precip_anomaly_africa': 'DOUBLE',
    'flood_index_horn': 'DOUBLE',
    'agriculture_exposure': 'DOUBLE',
    'risk_tier_pacific': 'VARCHAR',
    'source': 'VARCHAR',
    'model_basis': 'VARCHAR'
  }`;

/**
 * WASM from a CDN, workers from this origin.
 *
 * Cloudflare Pages rejects any single asset over 25 MiB, and DuckDB's wasm is
 * 33 MB (eh) / 38 MB (mvp) — so it cannot live in dist/. The workers are ~800 KB
 * and must stay same-origin, because they are constructed with `new Worker()`,
 * which is subject to the page's origin policy.
 *
 * Both CDNs serve the .wasm with `Content-Type: application/wasm` and
 * `Access-Control-Allow-Origin: *`, which is all that
 * `WebAssembly.instantiateStreaming` requires.
 *
 * Pinned to the exact installed package version so a CDN release can never
 * silently change behaviour underneath the app.
 */
const DUCKDB_VERSION = duckdb.PACKAGE_VERSION;

/** jsDelivr and unpkg both expose the identical `dist/` layout for this package. */
const WASM_BASE_JSDELIVR = `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${DUCKDB_VERSION}/dist`;
const WASM_BASE_UNPKG = `https://unpkg.com/@duckdb/duckdb-wasm@${DUCKDB_VERSION}/dist`;

/** Optional self-hosted override, e.g. VITE_DUCKDB_WASM_BASE=https://r2.example.com/duckdb */
const WASM_BASE_OVERRIDE = (
  import.meta.env as Record<string, string | undefined>
).VITE_DUCKDB_WASM_BASE?.trim().replace(/\/+$/, '');

/**
 * Hosts tried in order. The env override goes first so a deploy can point at
 * R2/self-hosted assets without a code change; jsDelivr is primary, unpkg the
 * fallback if jsDelivr is blocked or down.
 */
export const WASM_BASES: readonly string[] = [
  ...(WASM_BASE_OVERRIDE ? [WASM_BASE_OVERRIDE] : []),
  WASM_BASE_JSDELIVR,
  WASM_BASE_UNPKG,
];

/** Short label for the HUD, e.g. "jsdelivr". */
export function hostLabel(base: string): string {
  if (base === WASM_BASE_OVERRIDE) return new URL(base).host;
  if (base.includes('jsdelivr')) return 'jsdelivr';
  if (base.includes('unpkg')) return 'unpkg';
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}

/**
 * Build the bundle set for one wasm host. Workers are always same-origin.
 *
 * COI (threads) is intentionally omitted: it needs COOP/COEP headers the Pages
 * deploy does not set, so `selectBundle()` would never choose it.
 */
export function bundlesFor(wasmBase: string): duckdb.DuckDBBundles {
  return {
    mvp: {
      mainModule: `${wasmBase}/duckdb-mvp.wasm`,
      mainWorker: '/duckdb/duckdb-browser-mvp.worker.js',
    },
    eh: {
      mainModule: `${wasmBase}/duckdb-eh.wasm`,
      mainWorker: '/duckdb/duckdb-browser-eh.worker.js',
    },
  };
}

/** Which host actually served the wasm, for engineLabel. */
let activeWasmHost: string | null = null;

export function getActiveWasmHost(): string | null {
  return activeWasmHost;
}

/**
 * Boot budgets now live in src/lib/engine/watchdog.ts (CONNECT_MS, STALL_MS,
 * AUTO_CAP_MS, EARLY_EVAL_START_MS, EARLY_ABORT_FACTOR). The old single fixed
 * 15 s timeout is gone: it aborted a 1.6 Mbps boot that would have finished in
 * 34 s, and it could not tell "host is dead" from "connection too slow", so it
 * always advanced to the next CDN even when the network was the bottleneck.
 */

/** How a single-host attempt failed, which determines whether to try the next host. */
export type BootFailureKind =
  /** Watchdog tripped: projected completion exceeds the auto cap. Do NOT try next host. */
  | 'cap'
  /** Watchdog tripped: no first event (host unreachable/blocked). Try next host. */
  | 'connect'
  /** Watchdog tripped: transfer died mid-flight. Try next host. */
  | 'stall'
  /** The worker script itself never loaded/started. Try next host. */
  | 'worker-load'
  /** Any other error from instantiate/registration. Try next host. */
  | 'error';

export class HostBootError extends Error {
  constructor(
    public readonly kind: BootFailureKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'HostBootError';
  }
}

/** Thrown by boot() when every host failed. */
export class EngineUnreachableError extends Error {
  constructor(public readonly failures: Array<{ host: string; kind: BootFailureKind }>) {
    super(`DuckDB could not boot from any host: ${failures.map((f) => `${f.host}(${f.kind})`).join(', ')}`);
    this.name = 'EngineUnreachableError';
  }
}

/** Thrown by boot() when the network is too slow (cap trip). Not a host problem. */
export class EngineTooSlowError extends Error {
  constructor(public readonly host: string) {
    super(`DuckDB boot aborted: connection too slow to finish within budget (${host})`);
    this.name = 'EngineTooSlowError';
  }
}

const SCENARIO_SQL = `
WITH params AS (
  SELECT
    CAST(? AS DOUBLE) AS sst,
    CAST(? AS DOUBLE) AS jet,
    CAST(? AS DOUBLE) AS agri
),
base AS (
  SELECT
    sst, jet, agri,
    sst * 1.15                              AS pacific_sst_dev,
    least(100.0, sst * 35.0)                AS pacific_convection,
    (15.0 + sst * 18.0)                     AS us_precip_base,
    (15.0 + sst * 18.0) + jet * 12.0        AS us_precip,
    (-0.5 - sst * 0.8) - jet * 0.6          AS us_temp_dev_f,
    (-10.0 - sst * 22.0) - jet * 9.0        AS asia_precip,
    least(10.0, greatest(0.0, sst * 3.2 * (1.0 + jet * 0.15))) AS asia_drought,
    (20.0 + sst * 25.0) + jet * -4.0        AS africa_precip,
    least(10.0, greatest(0.0, sst * 2.8))   AS africa_flood
  FROM params
)
SELECT
  round(sst, 2)                AS sst,
  round(jet, 2)                AS jet,
  round(agri, 2)               AS agri,
  round(pacific_sst_dev, 2)    AS pacific_sst_dev,
  round(pacific_convection, 1) AS pacific_convection,
  round(us_precip, 1)          AS us_precip,
  round(us_precip_base, 1)     AS us_precip_base,
  round(us_temp_dev_f, 2)      AS us_temp_dev_f,
  round(asia_precip, 1)        AS asia_precip,
  round(asia_drought, 2)       AS asia_drought,
  round(africa_precip, 1)      AS africa_precip,
  round(africa_flood, 2)       AS africa_flood,
  round(
    least(100.0, greatest(0.0,
      ((abs(us_precip) + abs(asia_precip) + abs(africa_precip)) / 3.0 / 60.0) * 100.0)),
    1)                         AS global_impact_index,
  round(
    least(100.0, greatest(0.0,
      ((asia_drought / 10.0) * 0.5 + (africa_flood / 10.0) * 0.3 + (pacific_convection / 100.0) * 0.2)
      * (0.55 + agri * 0.45) * 100.0)),
    1)                         AS agriculture_exposure
FROM base;
`;

const ANALOG_SQL = `
SELECT
  strftime(date, '%Y-%m')                                   AS period,
  nino_34_anomaly,
  nino34_sst,
  abs(nino_34_anomaly - CAST(? AS DOUBLE))                  AS delta,
  sst_deviation,
  precip_anomaly_pacific,
  precip_anomaly_us,
  precip_anomaly_se_asia,
  precip_anomaly_africa,
  drought_index_se_asia,
  risk_tier_pacific
FROM enso_historical
-- The date tie-break is mandatory for parity with TsEngine: many months carry
-- the same rounded |delta|, so without a secondary key the two engines could
-- return the same rows in a different order from identical data.
ORDER BY delta ASC, date DESC
LIMIT 6;
`;

const SUMMARY_SQL = `
SELECT
  count(*)                                              AS row_count,
  strftime(min(date), '%Y-%m')                          AS first_date,
  strftime(max(date), '%Y-%m')                          AS last_date,
  round(avg(nino_34_anomaly), 3)                        AS mean_anomaly,
  round(max(nino_34_anomaly), 3)                        AS max_anomaly,
  strftime(arg_max(date, nino_34_anomaly), '%Y-%m')     AS max_anomaly_date,
  count(*) FILTER (WHERE abs(nino_34_anomaly - CAST(? AS DOUBLE)) <= 0.35) AS analog_count,
  count(*) FILTER (WHERE nino_34_anomaly >= 2.0)        AS extreme_months,
  count(*) FILTER (WHERE nino_34_anomaly <= -0.5)       AS lanina_months,
  any_value(source)                                     AS source
FROM enso_historical;
`;

const TIMELINE_SQL = `
SELECT
  strftime(date, '%Y-%m')  AS date,
  nino_34_anomaly          AS anomaly
FROM enso_historical
ORDER BY date ASC;
`;

// One bind parameter, referenced through a CTE. duckdb-wasm's prepared-statement
// binding is positional and brittle across repeated `?` in a single CASE, so the
// value is bound once and read as a column.
const RISK_TIER_SQL = `
WITH p AS (SELECT CAST(? AS DOUBLE) AS sst)
SELECT CASE
  WHEN sst < 0.5 THEN 'Neutral / La Niña Watch'
  WHEN sst < 1.0 THEN 'Weak Warm Phase'
  WHEN sst < 1.5 THEN 'Moderate El Niño'
  WHEN sst < 2.0 THEN 'Strong El Niño'
  WHEN sst < 2.6 THEN 'Super El Niño'
  ELSE 'Extreme Mega-El Niño'
END AS risk_tier
FROM p;
`;

type Row = Record<string, unknown>;

interface DuckDbClient {
  conn: duckdb.AsyncDuckDBConnection;
  db: duckdb.AsyncDuckDB;
  version: string;
  /**
   * Whether `enso_historical` exists.
   *
   * False when the dataset was unavailable at boot. The scenario and risk-tier
   * queries still work (they never touch the table); summary/analogs/timeline
   * throw, and callers fall back to the TS engine for those.
   */
  hasHistory: boolean;
}

let clientPromise: Promise<DuckDbClient> | null = null;

/**
 * Create the materialised history table.
 *
 * Returns false instead of throwing when the dataset cannot be read, so the
 * engine still boots and the scenario keeps working. The reason is logged once;
 * the UI surfaces "History unavailable" via the dataset loader's own state.
 *
 * Materialised rather than a view: the 918-row CSV is parsed exactly once, so the
 * per-slider scenario queries never re-read the file. A view over read_csv()
 * would re-parse on every query.
 */
async function createHistoryTable(conn: duckdb.AsyncDuckDBConnection): Promise<boolean> {
  try {
    await conn.query(`
      CREATE OR REPLACE TABLE enso_historical AS
      SELECT * FROM read_csv('${DATA_FILE}', header=true, columns=${CSV_COLUMNS});
    `);
    return true;
  } catch (error) {
    console.warn('[duckdb] history table unavailable; scenario still works:', error);
    return false;
  }
}

/**
 * Try to (re)create the history table after the dataset becomes available.
 *
 * Called by the retry path: the engine may have booted while the CSV was
 * blocked, and a later successful fetch must be able to add the table without
 * rebooting the wasm. Idempotent — a second call is a cheap CREATE OR REPLACE.
 */
export async function ensureHistoryTable(): Promise<boolean> {
  if (!clientPromise) return false;
  try {
    const client = await clientPromise;
    if (client.hasHistory) return true;
    const ok = await createHistoryTable(client.conn);
    if (ok) client.hasHistory = true;
    return ok;
  } catch {
    return false;
  }
}

/**
 * Try one wasm host end to end.
 *
 * Two things matter for correctness here:
 *
 * 1. The watchdog REJECTS a racing promise. `worker.terminate()` alone leaves the
 *    in-flight `instantiate()` promise pending forever, which is an unobservable
 *    hang. Both happen on failure, but the rejection is what the caller sees.
 * 2. The worker is terminated on every failure path, so a dead host cannot leak
 *    a worker (or a half-instantiated wasm module) that would contend with the
 *    next attempt.
 */
async function bootFromHost(
  wasmBase: string,
  mode: BootMode,
  datasetText: string | null,
): Promise<DuckDbClient> {
  const bundle = await duckdb.selectBundle(bundlesFor(wasmBase));
  if (!bundle.mainWorker) {
    throw new HostBootError('error', 'DuckDB bundle has no worker — refusing to block the main thread.');
  }

  const label = hostLabel(wasmBase);
  const bundleKind: BundleKind = bundle.mainModule.includes('duckdb-mvp') ? 'mvp' : 'eh';
  const decoded = getDecodedBytes(bundleKind).decodedBytes;

  // Surface the chosen host and decoded size to the UI before any bytes land, so
  // the badge can render a determinate bar from the first frame.
  engineStore.startBooting({ host: label, decoded, mode });

  // Acquire the worker script FIRST, on its own budget.
  //
  // `new Worker(url)` returns immediately but fetches the 755 KB script
  // asynchronously, and no InstantiationProgress event can fire until it runs.
  // Starting the watchdog before this point spent CONNECT_MS waiting for an
  // event that could not arrive: measured on 400 kbps, `connect` tripped at 12 s
  // while the worker script alone needed ~15 s, so the wasm was never requested
  // at all (wasmFetchCount: 0). WorkerLoadError is retried on the next host by
  // boot(), because a worker that will not load is a host/local-serve problem.
  const worker = await acquireWorker(bundle.mainWorker);

  const watchdog = createWatchdog({
    mode,
    decoded,
    onProgress: (loaded) => engineStore.reportProgress(loaded),
  });

  try {
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
    const db = new duckdb.AsyncDuckDB(logger, worker);

    // Race the instantiate against the watchdog. The watchdog rejects; we
    // translate that into a typed failure so boot() can decide whether the next
    // host is worth trying.
    await Promise.race([
      db.instantiate(bundle.mainModule, bundle.pthreadWorker, (p) => {
        watchdog.progress(Number(p.bytesLoaded));
      }),
      watchdog.rejected,
    ]);

    if (datasetText !== null) {
      // Preferred path: the loader already fetched the CSV, and registering the
      // text means DuckDB parses the exact same bytes without a second network
      // request. One fetch, two engines.
      await db.registerFileText(DATA_FILE, datasetText);
    } else {
      // Fallback for callers that have no text yet (e.g. a direct runScenario from
      // a test). Costs one extra fetch but keeps the engine usable standalone.
      await db.registerFileURL(
        DATA_FILE,
        new URL(DATA_URL, window.location.origin).toString(),
        duckdb.DuckDBDataProtocol.HTTP,
        false,
      );
    }

    const conn = await db.connect();

    // Disable extension autoload before touching any data. read_csv() is in the
    // wasm core, so nothing here needs an extension; turning this off converts
    // "silently fetch from extensions.duckdb.org" into a hard local error if a
    // future query does reach for one. That is the desired failure mode: loud,
    // in the console, instead of a hidden network dependency.
    await conn.query('SET autoinstall_known_extensions=false');
    await conn.query('SET autoload_known_extensions=false');

    // Materialise the history table — but do NOT let a dataset failure kill the
    // engine.
    //
    // SCENARIO_SQL and RISK_TIER_SQL never reference enso_historical (verified in
    // semantics.test.ts), so every number the user can change with a slider works
    // without the table. Failing the whole boot here would mean a blocked or
    // corrupt CSV takes the scenario engine down with it, which is strictly worse
    // than losing only history.
    const hasHistory = await createHistoryTable(conn);

    watchdog.dispose();
    return { conn, db, version: duckdb.PACKAGE_VERSION, hasHistory };
  } catch (error) {
    watchdog.dispose();

    // Tear the failed attempt down before the next host is tried. This is not
    // sufficient on its own (the pending instantiate promise would stay pending
    // forever) which is why the watchdog also rejects — see the race above.
    try {
      worker.terminate();
    } catch {
      /* already dead */
    }

    // Normalise the watchdog's own error type into a typed host failure.
    if (error instanceof BootTimeoutError) {
      throw new HostBootError(error.reason, error.message, { cause: error });
    }
    if (error instanceof WorkerLoadError) {
      throw new HostBootError('worker-load', error.message, { cause: error });
    }
    if (error instanceof HostBootError) throw error;
    throw new HostBootError('error', error instanceof Error ? error.message : String(error), {
      cause: error,
    });
  }
}

/** All hosts exhausted. */
async function boot(mode: BootMode = 'auto', datasetText: string | null = null): Promise<DuckDbClient> {
  const failures: Array<{ host: string; kind: BootFailureKind }> = [];

  for (const wasmBase of WASM_BASES) {
    const label = hostLabel(wasmBase);
    try {
      const client = await bootFromHost(wasmBase, mode, datasetText);
      activeWasmHost = label;
      if (failures.length > 0) {
        console.warn(
          `[duckdb] served wasm from ${label} after ${failures.map((f) => `${f.host}(${f.kind})`).join(', ')} failed`,
        );
      }
      return client;
    } catch (error) {
      const kind: BootFailureKind = error instanceof HostBootError ? error.kind : 'error';
      failures.push({ host: label, kind });

      // A cap trip means the NETWORK is the bottleneck, not this particular
      // host. Retrying the next CDN would spend the same time to reach the same
      // conclusion, so stop immediately and report "too slow".
      if (kind === 'cap') {
        activeWasmHost = null;
        console.warn(`[duckdb] aborting boot: projection exceeds budget on ${label} (network-bound)`);
        throw new EngineTooSlowError(label);
      }

      console.warn(`[duckdb] wasm host "${label}" failed (${kind}), trying next:`, error);
    }
  }

  activeWasmHost = null;
  throw new EngineUnreachableError(failures);
}

/**
 * The singleton boot promise.
 *
 * Held separately from `clientPromise` so a failed attempt can be retried from
 * the `failed` state without the old rejection being replayed.
 */
function getClient(mode: BootMode = 'auto', datasetText: string | null = null): Promise<DuckDbClient> {
  if (!clientPromise) {
    const startedAt = performance.now();
    clientPromise = boot(mode, datasetText)
      .then((client) => {
        // Transition to ready HERE, not inside bootFromHost: this is the one
        // place that knows both the host that actually succeeded and the total
        // elapsed time. Without it the store would sit in `booting` forever and
        // the UI would never switch off the TS model.
        engineStore.markReady(activeWasmHost ?? 'unknown', Math.round(performance.now() - startedAt));
        return client;
      })
      .catch((error) => {
        // Mark the store *before* clearing the promise, so a subscriber reading
        // status in the same tick never sees a transient "booting".
        if (error instanceof EngineTooSlowError) {
          engineStore.markFailed('too-slow');
        } else if (error instanceof EngineUnreachableError) {
          engineStore.markFailed('unreachable');
        } else {
          engineStore.markFailed('error');
        }
        // Reset so a later retry (e.g. the user clicking "Load anyway") can run.
        clientPromise = null;
        throw error;
      });
  }
  return clientPromise;
}

/**
 * Parameterised query helper. duckdb-wasm 1.32 dropped the (sql, params)
 * overload on AsyncDuckDBConnection — binding now goes through a prepared
 * statement — so every parameterised call routes through here.
 */
async function query(
  conn: duckdb.AsyncDuckDBConnection,
  sql: string,
  params: unknown[] = [],
): Promise<{ toArray: () => Array<{ toJSON: () => Row }> }> {
  if (params.length === 0) return conn.query(sql);
  const stmt = await conn.prepare(sql);
  try {
    return await stmt.query(...params);
  } finally {
    await stmt.close();
  }
}

const asRows = (table: { toArray: () => Array<{ toJSON: () => Row }> }): Row[] =>
  table.toArray().map((row) => row.toJSON());

const num = (value: unknown, fallback = 0): number => {
  if (value === null || value === undefined) return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const str = (value: unknown, fallback = ''): string =>
  value === null || value === undefined ? fallback : String(value);

const rowsToMetrics = (row: Row, state: { sstAnomaly: number; jetStreamShift: number; agricultureWeight: number }): ScenarioMetrics => ({
  sst: num(row.sst, state.sstAnomaly),
  jet: num(row.jet, state.jetStreamShift),
  agri: num(row.agri, state.agricultureWeight),
  pacificSstDev: num(row.pacific_sst_dev),
  pacificConvection: num(row.pacific_convection),
  usPrecip: num(row.us_precip),
  usPrecipBase: num(row.us_precip_base),
  usTempDevF: num(row.us_temp_dev_f),
  asiaPrecip: num(row.asia_precip),
  asiaDrought: num(row.asia_drought),
  africaPrecip: num(row.africa_precip),
  africaFlood: num(row.africa_flood),
  globalImpactIndex: num(row.global_impact_index),
  agricultureExposure: num(row.agriculture_exposure),
  riskTier: 'pending',
});

/** Full analytics pass: metrics + analogs + summary + timeline, timed end to end. */
export async function runScenario(
  state: { sstAnomaly: number; jetStreamShift: number; agricultureWeight: number },
  cache?: AnalyticsCache,
  mode: BootMode = 'auto',
  /**
   * CSV text already fetched by loadDataset(). When provided, DuckDB parses THIS
   * string via registerFileText instead of fetching the file again — the same
   * bytes feed both engines, and there is exactly one request for the dataset.
   */
  datasetText: string | null = null,
): Promise<AnalyticsPayload> {
  // Boot first, then start the clock: the first call also instantiates the WASM
  // module (~1.5 s), and counting that as query latency makes the HUD badge lie.
  const { conn } = await getClient(mode, datasetText);
  const started = performance.now();
  const { sstAnomaly: sst, jetStreamShift: jet, agricultureWeight: agri } = state;

  const [metricsTable, riskTable] = await Promise.all([
    query(conn, SCENARIO_SQL, [sst, jet, agri]),
    query(conn, RISK_TIER_SQL, [sst]),
  ]);

  const metricsRow = asRows(metricsTable)[0] ?? {};
  const metrics = rowsToMetrics(metricsRow, state);
  metrics.riskTier = str(asRows(riskTable)[0]?.risk_tier, 'Neutral / La Niña Watch');

  // Summary + timeline only change when the query parameter changes, so cache them.
  const summaryPromise = cache?.summary
    ? Promise.resolve(cache.summary)
    : query(conn, SUMMARY_SQL, [sst]).then((t) => {
        const r = asRows(t)[0] ?? {};
        const summary: HistoricalSummary = {
          rowCount: num(r.row_count),
          firstDate: str(r.first_date),
          lastDate: str(r.last_date),
          meanAnomaly: num(r.mean_anomaly),
          maxAnomaly: num(r.max_anomaly),
          maxAnomalyDate: str(r.max_anomaly_date),
          analogCount: num(r.analog_count),
          extremeMonths: num(r.extreme_months),
          laninaMonths: num(r.lanina_months),
          source: str(r.source, 'Unknown source'),
        };
        if (cache) cache.summary = summary;
        return summary;
      });

  const timelinePromise = cache?.timeline
    ? Promise.resolve(cache.timeline)
    : query(conn, TIMELINE_SQL).then((t) => {
        const points: TimelinePoint[] = asRows(t).map((r) => ({
          date: str(r.date),
          label: str(r.date).replace('-', ' '),
          anomaly: num(r.anomaly),
        }));
        if (cache) cache.timeline = points;
        return points;
      });

  const [analogTable, summary, timeline] = await Promise.all([
    query(conn, ANALOG_SQL, [sst]),
    summaryPromise,
    timelinePromise,
  ]);

  const analogs: AnalogMonth[] = asRows(analogTable).map((r) => ({
    date: str(r.period),
    label: str(r.period).replace('-', ' '),
    anomaly: num(r.nino_34_anomaly),
    absoluteSst: num(r.nino34_sst),
    delta: num(r.delta),
    sstDeviation: num(r.sst_deviation),
    precipPacific: num(r.precip_anomaly_pacific),
    precipUs: num(r.precip_anomaly_us),
    precipSeAsia: num(r.precip_anomaly_se_asia),
    precipAfrica: num(r.precip_anomaly_africa),
    droughtIndex: num(r.drought_index_se_asia),
    riskTier: str(r.risk_tier_pacific, 'Unknown'),
  }));

  return {
    metrics,
    analogs,
    summary,
    timeline,
    queryMs: Math.round((performance.now() - started) * 10) / 10,
  };
}

/** Cache slot for the parameter-independent queries. */
export interface AnalyticsCache {
  summary?: HistoricalSummary;
  timeline?: TimelinePoint[];
}

/**
 * Pure-TS fallback used only when DuckDB cannot boot (blocked wasm, no worker
 * support). Values are identical to the SQL path by construction.
 */
export function runScenarioFallback(
  state: { sstAnomaly: number; jetStreamShift: number; agricultureWeight: number },
  timeline: TimelinePoint[] = [],
): AnalyticsPayload {
  const started = performance.now();
  const metrics = computeMetrics(state);
  return {
    metrics,
    analogs: [],
    summary: {
      rowCount: timeline.length,
      firstDate: timeline[0]?.date ?? '—',
      lastDate: timeline.at(-1)?.date ?? '—',
      meanAnomaly: 0,
      maxAnomaly: 0,
      maxAnomalyDate: '—',
      analogCount: 0,
      extremeMonths: 0,
      laninaMonths: 0,
      source: '—',
    },
    timeline,
    queryMs: Math.round((performance.now() - started) * 10) / 10,
  };
}

export async function getDuckDbVersion(): Promise<string | null> {
  try {
    const { version } = await getClient();
    return version;
  } catch {
    return null;
  }
}
