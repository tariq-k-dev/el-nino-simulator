# Engine Boot Spike — Extension Elimination & Instantiate-Progress Semantics

**Date:** 2026-10-29
**Scope:** (1) remove the `extensions.duckdb.org` runtime fetch; (2) measure what
`InstantiationProgress` actually reports. No watchdog or retry policy was implemented —
this document is measurement and evidence only.
**Gate:** `pnpm tsc -b && pnpm lint && pnpm test && pnpm build` — all four pass.

---

## 0. Result summary

| Item | Outcome |
|---|---|
| `extensions.duckdb.org` requests after change | **0** (was 1, `parquet.duckdb_extension.wasm`) |
| Row count | **918** (identical to the parquet build) |
| All 5 query results vs parquet baseline | **identical** — 0 differences in any row/value |
| Gate | `tsc -b` 0 errors · `lint` 0 errors/0 warnings · `test` **46/46** · `build` OK, 18 assets, 5.10 MB |
| `bytesLoaded` reaches `bytesTotal`? | **Never.** Reaches 5.0617× total and stops. |
| Reported `bytesTotal` | 6,764,975 B — the **brotli-encoded** size, not the 34,242,586 B decoded size |
| Compile tail (last event → `instantiate()` resolve) | **226–297 ms**, consistent across all profiles |

The single most important finding: **`bytesTotal` is the compressed transfer size while
`bytesLoaded` counts decoded bytes.** Any progress bar or watchdog computed as
`bytesLoaded / bytesTotal` is wrong by a factor of ~5, and `loaded === total` never fires.

---

## 1. Extension elimination

### 1.1 Every place the dataset is registered or read

Inventory from `src/lib/duckdb.ts` and the build/data-prep scripts. There is exactly **one**
runtime registration and **one** runtime read; the parquet appears elsewhere only as an
offline build artifact and a test fixture.

| Location | Kind | Role |
|---|---|---|
| `src/lib/duckdb.ts:26` | `PARQUET_URL = '/data/enso_historical.parquet'` | **the** runtime URL constant |
| `src/lib/duckdb.ts:261-266` | `db.registerFileURL('enso_historical.parquet', …)` | runtime registration into the VFS |
| `src/lib/duckdb.ts:269-272` | `CREATE OR REPLACE VIEW … read_parquet(…)` | runtime read — **this is what pulled the extension** |
| `src/lib/duckdb.ts:185, 202, 209` | `FROM enso_historical` in `ANALOG_SQL`, `SUMMARY_SQL`, `TIMELINE_SQL` | queries against the registered relation |
| `scripts/generate_enso_data.py:59` | `OUTPUT_FILE = …/enso_historical.parquet` | offline build output |
| `scripts/generate_enso_data.py:277` | `df.write_parquet(...)` | offline writer |
| `scripts/check-assets.mjs:24` | `REQUIRED` list entry | deploy guard |
| `src/lib/dataset.test.ts:19` | `PARQUET = path.resolve(...)` | offline test fixture (hyparquet) |

### 1.2 Change

`read_parquet()` is not in the DuckDB core — it lives in the `parquet` extension. That is the
mechanism by which the app reached out to `extensions.duckdb.org`. The fix converts the load to
`read_csv()`, which **is** core, and then turns extension autoload off so a future regression
fails loudly instead of silently fetching.

Data prep (`scripts/generate_enso_data.py`) now writes both files from the same Polars frame, so
they cannot drift. The parquet remains the repo source of truth; the CSV is derived.

```bash
# Regenerate both artifacts (documented in the script docstring):
uv run python scripts/generate_enso_data.py            # fetch NOAA CPC + build
uv run python scripts/generate_enso_data.py --offline  # reuse cached download
```

Measured output: `public/data/enso.csv` **221 KB** (918 rows, 25 columns),
`public/data/enso_historical.parquet` **73 KB**, `schema.sql` regenerated.

The boot path now registers the CSV and materialises a table:

```ts
await db.registerFileURL(DATA_FILE, new URL(DATA_URL, location.origin).toString(),
                         duckdb.DuckDBDataProtocol.HTTP, false);

const conn = await db.connect();
await conn.query('SET autoinstall_known_extensions=false');
await conn.query('SET autoload_known_extensions=false');
await conn.query(`CREATE OR REPLACE TABLE enso_historical AS
                  SELECT * FROM read_csv('${DATA_FILE}', header=true, columns=${CSV_COLUMNS});`);
```

`columns=` is explicit rather than inferred, mirroring `schema.sql` one-for-one. Inference
samples rows and could type `date` as VARCHAR or pick a narrower numeric width on a different
data window — the schema should not depend on the data. Materialising as a TABLE (not a VIEW)
means the 918-row CSV is parsed once at boot, so per-slider queries never re-read the file.

### 1.3 Verification — zero extension requests

Measured with `context.on('request')`, which includes worker-scoped fetches. Three runs:

| Run | `extensions.duckdb.org` requests | Requests to CDN wasm | Requests to `/data/…` |
|---|---|---|---|
| **Parquet, autoload enabled** (old behaviour) | **1** — `…/wasm_eh/parquet.duckdb_extension.wasm` | 1 (`duckdb-eh.wasm`) | 1 (`enso_historical.parquet`) |
| **Parquet, autoload disabled** (diagnostic) | 0 | 1 | 0 — **hard `Catalog Error`** |
| **CSV, autoload disabled** (new behaviour) | **0** | 1 | 1 (`enso.csv`) |

The diagnostic run is the proof of mechanism. With autoload off, the parquet path does not fall
back or degrade — it fails outright:

```
Catalog Error: Table Function with name "read_parquet" is not in the catalog, but it exists in
the parquet extension.
Please try installing and loading the parquet extension by running: INSTALL parquet; LOAD parquet;
```

So `read_parquet` **requires** the parquet extension, and disabling autoload would break the
parquet path completely. The CSV path is the only one compatible with a zero-extension policy.

Real application at 1262×568 (not the harness):

```
badge              DuckDB-WASM · jsdelivr · 305.4 ms
months             918
extensionRequests  []          (count 0)
dataRequests       ["http://localhost:4181/data/enso.csv"]
wasmRequests       ["…/duckdb-wasm@1.32.0/dist/duckdb-eh.wasm"]
consoleErrors      []
totalRequests      16
```

### 1.4 Result equivalence — 5 queries × 3 scenario points

The harness runs the five production queries verbatim at three scenario points
`(sst, jet, agri) = (1.5, 0.35, 0.6)`, `(0,0,0)`, `(3,1,1)`, plus the full 918-row timeline,
through both boot paths. A recursive structural diff over the whole result tree reports:

```
differenceCount: 4
  mode:            "parquet" vs "csv"          (expected — different code path)
  pragmasApplied:  false    vs true            (expected — the change under test)
  pragmas:         array length 0 vs 2         (expected)
  instantiateMs:   783.5    vs 703.2           (timing noise)
```

**Zero differences in any query result.** rowCount 918 on both. timelineLength 918 on both.
Metrics, risk tier, analog rows and summary are byte-identical across all three scenario points.

### 1.5 Which function needs which extension

Answering the question directly, since disabling autoload can break queries and this must be
recorded rather than silently worked around:

| Function | Extension required | Status after change |
|---|---|---|
| `read_parquet()` | **`parquet`** (fetches `parquet.duckdb_extension.wasm`) | **not used** — replaced by `read_csv()` |
| `read_csv()` | none (wasm core) | in use, works with autoload off |
| `strftime`, `arg_max`, `least`, `greatest`, `round`, `count(*) FILTER`, `any_value`, `abs` | none (core) | all five queries pass |
| `CREATE OR REPLACE TABLE … AS SELECT` | none (core) | used for materialisation |

No query needed an extension after the switch. Nothing was re-enabled silently.

---

## 2. Instantiate-progress semantics

### 2.1 Method

A standalone harness (built through Vite so `apache-arrow` resolves; served same-origin as
`/harness/progress.html`) calls:

```ts
await db.instantiate(bundle.mainModule, bundle.pthreadWorker, (p) => { /* log */ });
```

and records every event with `t` (ms since `instantiate()` was called), `gap` (ms since the
previous event), `bytesLoaded`, `bytesTotal`, plus `p.startedAt → p.updatedAt`.

Three CDP network profiles plus a 4× CPU run. Cache disabled on all runs.

### 2.2 Measured results

| Profile | CPU | Events | `instantiate()` | Last event | Compile tail | `bytesLoaded` final | `bytesTotal` | Reached total | Overshot |
|---|---|---|---|---|---|---|---|---|---|
| Unthrottled | 1× | 66 | 1,070.8 ms | 795.0 ms | **275.8 ms** | 34,242,586 | 6,764,975 | **no** | **yes** |
| 1.6 Mbps / 150 ms | 1× | 3,537 | 34,196.7 ms | 33,928.4 ms | **268.3 ms** | 34,242,586 | 6,764,975 | **no** | **yes** |
| 400 kbps / 300 ms | 1× | 4,469 | 136,909 ms | 136,612.1 ms | **296.9 ms** | 34,242,586 | 6,764,975 | **no** | **yes** |
| Unthrottled + 4× CPU | 4× | 115 | 1,087.7 ms | 861.7 ms | **226.0 ms** | 34,242,586 | 6,764,975 | **no** | **yes** |

### 2.3 (a) Event count and spacing

| Profile | Events | Gap min | Gap median | Gap max | Events per decoded MB |
|---|---|---|---|---|---|
| Unthrottled | 66 | 0.1 ms | 2.1 ms | 25.0 ms | 2.0 |
| 1.6 Mbps / 150 ms | 3,537 | 0.1 ms | 15.4 ms | 109.7 ms | 108.3 |
| 400 kbps / 300 ms | 4,469 | 0.1 ms | 31.0 ms | 422.6 ms | 136.8 |
| Unthrottled + 4× CPU | 115 | 0.1 ms | 2.9 ms | 24.4 ms | 3.5 |

Event count is **not** a fixed chunk count — it scales with how long the transfer takes
(66 → 3,537 → 4,469 as the pipe narrows), because the handler fires on each internal read
callback. The first event is emitted only *after* the download starts, not at t=0: the first
event lands at 528.6 ms unthrottled and at 4,872 ms on 400 kbps, so **the handler gives no
signal at all during DNS + TLS + connect**.

Consequence for a watchdog: event *count* is useless as a liveness signal. Event *recency* is
usable — `gapMax` is 422.6 ms on the worst profile, so a 2–3 s no-event timeout would be safe.

### 2.4 (b) Does `bytesLoaded` reach or overshoot `bytesTotal`?

**It overshoots, consistently, by exactly 5.0617×, and never equals it.**

```
bytesTotal  =  6,764,975   (brotli-encoded)
bytesLoaded = 34,242,586   (decoded)
ratio       =      5.0617  ← the compression ratio
```

`distinctTotals` is a single value on every run: `bytesTotal` is fixed at the compressed size for
the whole instantiation. So the handler compares apples to oranges throughout — compressed total
against decoded loaded. Progress reads 0.0003 → 1.0617 → 2.7714 → 5.0617 and stops there.

The final event's `bytesLoaded` is exactly the decoded size, confirmed independently:

```bash
curl -H "Accept-Encoding: identity" .../duckdb-eh.wasm   →  34,242,586 bytes (decoded)
curl -H "Accept-Encoding: br,gzip"  .../duckdb-eh.wasm   →   6,764,975 bytes (encoded)
```

Because `loaded === total` never happens, **`onProgress` never delivers a "complete" event.**
Any code that waits for `progress.bytesLoaded === progress.bytesTotal` hangs forever. Any
progress bar scaled by `bytesLoaded / bytesTotal` renders ~500% and clips.

### 2.5 (c) Compile tail at 4× CPU

Defined as: last progress event → `instantiate()` resolving. This is the wasm compile + DB-open
work that reports no progress at all.

| Profile | Last event | Resolve | **Tail** |
|---|---|---|---|
| Unthrottled, 1× | 795.0 ms | 1,070.8 ms | **275.8 ms** |
| 1.6 Mbps, 1× | 33,928.4 ms | 34,196.7 ms | **268.3 ms** |
| 400 kbps, 1× | 136,612.1 ms | 136,909 ms | **296.9 ms** |
| Unthrottled, **4× CPU** | 861.7 ms | 1,087.7 ms | **226.0 ms** |

The tail is stable at **~226–297 ms** and is **not** proportional to network time — it is purely
the CPU cost of compiling 34 MB of wasm. Notably it did *not* grow at 4× CPU throttling
(226 ms vs 276 ms); the compile is dominated by work that CDP's throttling does not multiply
(wasm compilation happens off the throttled main thread, in the worker).

Practical implication: the handler goes **silent for the last ~0.25 s** of a ~1.1 s boot. During
that window the UI has no progress signal whatsoever. If the tail were longer — a bigger wasm or a
slower device — a watchdog driven purely by progress events would fire a false timeout. The
watchdog should therefore stop counting once the transfer completes and treat the compile tail as
a separate, longer budget.

### 2.6 (d) Actual wasm size on the wire

| Measure | Value |
|---|---|
| URL | `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.32.0/dist/duckdb-eh.wasm` |
| `content-length` | **6,764,975 B** (6.45 MiB) |
| `content-encoding` | **br** |
| `content-type` | `application/wasm` |
| `cache-control` | `public, max-age=31536000, s-maxage=31536000, immutable` |
| Actual encoded transfer | **6,764,975 B** |
| Actual decoded size | **34,242,586 B** (32.66 MiB) |
| CDN transfer time (this machine) | 0.469 s @ ~14.4 MB/s |

**The "34 MB wasm" figure is the decoded size.** The bytes actually crossing the network are
6.45 MiB. The earlier Cloudflare Pages 25 MiB analysis was based on the decoded size; the file
would transfer at 6.45 MiB but *exceeds* the limit as stored, so keeping it on the CDN remains the
right call — just with the correct number attached.

`Network.responseReceived` CDP events did **not** capture the wasm request in any run: the fetch
is issued from inside the worker, and `Network.enable` on the page session does not surface it.
Playwright's `context.on('request')` does see it. Worth knowing for future instrumentation.

---

## 3. Consequences for a boot watchdog (not implemented)

Recorded as evidence for the next task, not as a recommendation to build now.

1. **Never compare `bytesLoaded` to `bytesTotal`.** They are in different units. If a percentage
   is wanted, divide `bytesLoaded` by the decoded size (34,242,586 B for this build) — but hard-
   coding that couples the UI to a specific wasm release. Better: use the handler only as a
   *liveness heartbeat* and never as a determinate progress bar.
2. **Event count is not a size signal.** 66 vs 4,469 events for the same file. Recency is the
   only usable property.
3. **The first event arrives late** (528 ms – 4.9 s depending on network), so a watchdog must not
   start counting at t=0 against an expectation of early events. Budget for connect + TLS first.
4. **The compile tail is silent and ~0.25 s.** Split the budget: transfer-complete detection, then
   a separate compile allowance.
5. **Total boot time on 400 kbps was 136.9 s** with no throttling of CPU. The existing 15 s
   `BOOT_TIMEOUT_MS` in `src/lib/duckdb.ts:97` cannot succeed on that profile — it is the reason
   the mobile audit saw the engine fail over to the TS model. That is a policy decision for the
   next task, deliberately left alone here.

---

## 4. Gate evidence

```
pnpm tsc -b     →  exit 0
pnpm lint       →  eslint . --max-warnings 0  →  exit 0
pnpm test       →  vitest run  →  3 files, 46 tests passed
pnpm build      →  vite build  →  18 assets, TOTAL 5.10 MB, all within Cloudflare Pages limits
```

Build asset table confirms the CSV shipped and the parquet is still present as the source of truth:

```
data/enso.csv                0.22 MB
data/enso_historical.parquet 0.07 MB
```

`scripts/check-assets.mjs` now requires `data/enso.csv` (the file the browser actually loads)
rather than the parquet.

---

## 5. Artifacts

All throwaway, under `.cache/spike/` (deleted at end of session, nothing committed):

| File | Purpose |
|---|---|
| `app/main.ts`, `app/index.html` | query harness: parquet vs CSV, five production queries |
| `app/progress.ts`, `app/progress.html` | instantiate-progress probe |
| `vite.config.ts` | builds the harness with project module resolution |
| `run-harness.mjs` | drives both boot paths, diffs results, logs all requests |
| `run-progress2.mjs` | three CDP profiles + 4× CPU, writes `progress2.json` |
| `verify-app.mjs` | verifies the real application |
| `diff.json`, `progress.json`, `progress2.json` | raw measurements |
