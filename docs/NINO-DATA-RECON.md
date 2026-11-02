# NINO-DATA-LAYER — Part A recon + stats

Repo: `D:\Dev\Handshake\Build-an-Interactive-Data-Visualization`
Base HEAD: `b2271365552d201e9a132e2eaff429419da67808`, `git status --porcelain` empty at start.
Part A is read-only. The stats script lives outside the repo at
`D:\Dev\Handshake\_triage\nino-relations.mjs`.

---

## A0. Last commit and the registry's exports

```
$ git show --stat b227136
commit b2271365552d201e9a132e2eaff429419da67808
Author: tariq-k-dev <71902492+tariq-k-dev@users.noreply.github.com>
Date:   Mon Nov 2 14:46:49 2026 -0800

    feat(regions): define Nino 1+2 and Nino 4 boxes as inert schema (NINO-REGIONS-SCHEMA)

 docs/NINO-REGIONS-RECON.md          | 297 ++++++++++++++++++++++++++++++++++++
 docs/prompts/nino-regions-schema.md |  30 ++++
 src/lib/regions.test.ts             | 257 +++++++++++++++++++++++++++++++
 src/lib/regions.ts                  | 190 +++++++++++++++++++++++
 4 files changed, 774 insertions(+)
```

Exported names from `src/lib/regions.ts` (`grep -n "^export"`):

| line | export |
|---|---|
| 8 | `REGIONS: RegionDefinition[]` |
| 59 | `REGION_MAP: Record<RegionId, RegionDefinition>` |
| 68 | `latLonToVector3(lat, lon, radius = 1): [number, number, number]` |
| 78 | `formatDelta(value, unit, digits = 1): string` |
| 83 | `celsiusToFahrenheit(c: number): number` |
| 90 | `fahrenheitDeltaToCelsius(f: number): number` |
| 91 | `celsiusDeltaToFahrenheit(c: number): number` |
| 94 | `tempDisplay(celsius, units): { value; unit }` |
| 101 | `deltaDisplay(celsiusDelta, units): { value; unit }` |
| 136 | `type NinoBoxId = 'nino12' \| 'nino34' \| 'nino4'` |
| 145 | `interface NinoBox` |
| 163 | `NINO_BOXES: readonly NinoBox[]` |
| 196 | `NINO34_REFERENCE_BOX: NinoBox` |
| 218 | `normalizeLon180(lon: number): number` |
| 231 | `toLon360(lon: number): number` |
| 237 | `boxLonSpan(box: NinoBox): number` |
| 252 | `boxLon360Ranges(box: NinoBox): Array<[number, number]>` |
| 293 | `boxContainsPoint(box, lat, lon): boolean` |

**Nothing unexpected**, with one thing worth restating: `regions.ts` is now a mixed
module — a region registry, formatting helpers, *and* Niño box schema. This step adds
a fourth concern to `src/lib/` and deliberately does **not** follow it into
`regions.ts`: `ninoRelation.ts` is its own module, so no shared file grows further.

---

## A1. The CSV — header, count, dates, columns, non-finite

**The file is NOT at `data/enso.csv`.** `data/` contains only
`enso_historical.parquet` (74,467 bytes). The CSV ships at **`public/data/enso.csv`**
(225,838 bytes) — `scripts/generate_enso_data.py:65` (`CSV_FILE`), and
`src/lib/duckdb.ts:72` (`DATA_URL = '/data/enso.csv'`). All numbers below are from
`public/data/enso.csv`.

Exact header, all **25** columns in order (the prompt says 10 — those are the ten
*source* columns the Python script parses before enrichment; the shipped CSV has 25):

```
date,year,month,nino12_sst,nino12_anomaly,nino3_sst,nino3_anomaly,nino4_sst,nino4_anomaly,nino34_sst,nino_34_anomaly,global_sst_anomaly,sst_deviation,convection_shift,precip_anomaly_pacific,precip_anomaly_us,temp_deviation_us_f,precip_anomaly_se_asia,drought_index_se_asia,precip_anomaly_africa,flood_index_horn,agriculture_exposure,risk_tier_pacific,source,model_basis
```

| fact | value |
|---|---|
| data rows | **918** (`wc -l` = 919 including the header) |
| first date | `1950-01-01` |
| last date | `2026-06-01` |
| date column name | `date` |
| date format | ISO `YYYY-MM-DD`, first of month — written with `date_format="%Y-%m-%d"` (`generate_enso_data.py:313`) |
| Niño 3.4 anomaly column | **`nino_34_anomaly`** (underscore between `nino` and `34`; distinct from `nino34_sst`) |

Non-finite / missing values per column, measured over all 25 columns
(`_triage/nino-relations.mjs`):

| column | non-finite |
|---|---|
| `nino_34_anomaly` | **0** |
| `nino12_anomaly` | **0** |
| `nino4_anomaly` | **0** |

All 25 columns are 0 — the parser refuses non-finite cells outright
(`src/lib/data/parse.ts:167-171`), and the pipeline drops any month carrying a
`999`/`-999` sentinel (`generate_enso_data.py:157`). So there are **no gaps and no
missing months** in the Niño 1+2 or Niño 4 columns; the 918-month record is contiguous.

**Anomaly baseline:** **1991–2020**, stated explicitly.
`SOURCE_NAME = "NOAA CPC ERSSTv5 (1991-2020 base)"` (`generate_enso_data.py:56`),
written into every row's `source` column (`:218`), and the module docstring says
"on the 1991–2020 climatological base" (`:13-14`). **One baseline for all four region
index columns**, because CPC computes all four from the same ERSSTv5 field — there is
no per-column baseline in this product.

---

## A2. How rows reach the app

There are two independent readers of the *same bytes*:

| path | file:line |
|---|---|
| TS parser (fallback engine) | `src/lib/data/parse.ts:108` `parseDataset(text: string): HistoricalRow[]` |
| DuckDB (primary engine) | `src/lib/duckdb.ts:371-382` `createHistoryTable`, `SELECT * FROM read_csv('enso.csv', header=true, columns=…CSV_COLUMNS)` |

The prompt names `src/lib/parse.ts`; the actual path is **`src/lib/data/parse.ts`**.

**Parsing function:** `parseDataset` (`:108-189`) — hand-written, not a CSV library.
Strict by design: it validates the header against `EXPECTED_COLUMNS` (`:19-45`)
positionally (`:130-137`), rejects any non-finite numeric cell (`:167-171`), rejects a
malformed date (`:156`), and rejects interior blank lines (`:143`).

**Row type:** `HistoricalRow` — `date` is the raw ISO **string** (deliberately not a
`Date`, to avoid a timezone shift across midnight), 22 numeric fields, and three
strings:

- `date: string`
- numeric (22): `year`, `month`, `nino12_sst`, `nino12_anomaly`, `nino3_sst`,
  `nino3_anomaly`, `nino4_sst`, `nino4_anomaly`, `nino34_sst`, `nino_34_anomaly`,
  `global_sst_anomaly`, `sst_deviation`, `convection_shift`, `precip_anomaly_pacific`,
  `precip_anomaly_us`, `temp_deviation_us_f`, `precip_anomaly_se_asia`,
  `drought_index_se_asia`, `precip_anomaly_africa`, `flood_index_horn`,
  `agriculture_exposure`
- `risk_tier_pacific: string`, `source: string`, `model_basis: string`

**Statistics in JS or SQL?** Both, split by role:

- **SQL** is the production path for every aggregate: `SUMMARY_SQL`
  (`duckdb.ts:303-316`) does `count(*)`, `avg`, `max`, `arg_max`; `ANALOG_SQL`
  (`:282-301`) does the nearest-anomaly `ORDER BY abs(...)`; `TIMELINE_SQL`
  (`:318-324`) maps the series. The file header states this is deliberate — "keeps
  the analytics in SQL where a reviewer can read it" (`:10-14`).
- **JS** computes the *scenario* arithmetic: `computeMetrics` (`src/lib/model.ts:114`)
  is pure arithmetic on the three slider scalars and mirrors `SCENARIO_SQL`
  exactly (`model.test.ts` asserts the two agree). `runScenarioFallback`
  (`duckdb.ts:759`) uses it when wasm cannot boot.
- The app **never computes a regression, a mean, or any statistic over the historical
  rows in JS** on the production path. The only JS-side aggregate over history is
  `timeline.length` for a month count (`ControlDeck.tsx:110`).

---

## A3. How the Equatorial Pacific card value is computed

**Function:** `regionHeadline(metrics, region)` — `src/lib/model.ts:175-189`,
`case 'pacific'` at `:180-181`:

```ts
return `${signed(metrics.pacificSstDev, 2)}°C SST dev`;
```

**Formula:** `pacificSstDev = sst * 1.15` — `src/lib/model.ts:120`, where `sst` is the
clamped slider value (`clamp(state.sstAnomaly, SST_MIN, SST_MAX)`, `:115`). Mirrored in
SQL as `sst * 1.15 AS pacific_sst_dev` (`src/lib/duckdb.ts:246`) and in the dataset as
`sst_deviation = anomaly * 1.15` (`generate_enso_data.py:173`).

So the card number is **not read from the dataset** — it is a hardcoded 1.15× multiplier
on the slider. At the default slider (1.5) it reads `+1.73 °C SST dev`, which is exactly
the `+1.73` in the prompt.

**Slider range** (`src/lib/model.ts:24-34`, wired at `ControlDeck.tsx:87-91`):

| constant | value | line |
|---|---|---|
| `SST_MIN` | **0** | `model.ts:24` |
| `SST_MAX` | **3** | `model.ts:25` |
| `SST_DEFAULT` | **1.5** | `model.ts:26` |
| `step` (SST slider) | **0.01** | `ControlDeck.tsx:89` |
| step (jet, agri sliders) | 0.01 | `ControlDeck.tsx:154,166` |
| `JET_MIN` / `JET_MAX` / `JET_DEFAULT` | −1 / 1 / 0.35 | `model.ts:28-30` |
| `AGRI_MIN` / `AGRI_MAX` / `AGRI_DEFAULT` | 0 / 1 / 0.6 | `model.ts:32-34` |

**"Mega El Niño" value: 3.0.** Two places, and they agree:
- `RISK_STOPS` marker `{ at: 3.0, label: 'Mega' }` — `ControlDeck.tsx:24`
- the tier ladder's top band, `riskTier` → `'Extreme Mega-El Niño'` for `sst >= 2.6` (`model.ts:111`), mirrored in SQL `duckdb.ts:337`

The slider's own scale label is `['Neutral', 'Mega El Niño']` (`ControlDeck.tsx:93`),
i.e. 3.0 is the top of the track. **Note the two definitions differ**: the tick labelled
"Mega" is at 3.0, while the tier ladder starts saying "Mega" at 2.6.

---

## A4. Can a unit test read the CSV?

**Yes.** Evidence rather than assumption:

- `vitest.config.ts` sets `environment: 'node'`.
- `src/lib/dataset.test.ts:19-21` already does
  `readFileSync(path.resolve(__dirname, '../../data/enso_historical.parquet'))` and
  parses it with hyparquet — a *binary* file, from a unit test, in this gate.
- `src/lib/dataset.test.ts` reads the parquet by relative `__dirname` path, and
  `tests/e2e/source-guards.test.ts:21` uses `readFile('node:fs/promises')` over the
  whole tree.

So `readFileSync(path.resolve(__dirname, '../../public/data/enso.csv'), 'utf8')` works,
and `parseDataset` from `@/lib/data/parse` resolves through the `@` alias that
`vitest.config.ts` defines. The DRIFT GUARD is therefore a real unit test, not a
side script.

---

## A5. UI copy or README lines claiming Parquet (report only)

Several, and **two are stale**:

| file:line | claim | true? |
|---|---|---|
| `README.md:18` | "a table of historical analog months pulled from the parquet by nearest-anomaly match" | **NO** — the app pulls from `enso.csv` via `read_csv` (`duckdb.ts:72,375`). The parquet is never served. |
| `README.md:29` | pipeline "emits the CSV (served) and parquet (repo-only source of truth)" | yes |
| `README.md:78` | "writes both a CSV for the browser and a Snappy-compressed parquet kept in `data/`" | yes |
| `README.md:96` | "survives `read_parquet` over a much larger file without a rewrite" | hypothetical, not a claim about today |
| `README.md:116` | "`data/enso_historical.parquet` is committed as the source of truth and is **never served**" | yes |
| `README.md:141` | asset table row "**Parquet \| `public/data/` \| 73 KB**" | **NO, doubly** — the parquet is not in `public/`, and if it were it would be served; 73 KB matches `data/enso_historical.parquet` (74,467 B) |
| `README.md:146` | "`dist/` totals **4.88 MB**" | stale — the measured build is 5.11 MB |
| `src/components/ControlDeck.tsx:31` | comment "shows the historical Niño 3.4 record from the parquet" | **NO** — from the CSV |
| `src/lib/duckdb.ts:1-29` | header explains CSV-not-Parquet at length, correctly | yes |
| `docs/ENGINE_BOOT_SPIKE.md:39-41` | quotes `PARQUET_URL` at `duckdb.ts:26` and `read_parquet` at `:261-272` | **stale** — those lines no longer exist; `duckdb.ts` now has `DATA_URL` at `:72` and `read_csv` at `:375`. The doc is a historical record of the spike, so this is provenance, not a live defect. |

Reported only; nothing edited.

---

# STATS OUTPUT (full)

Command: `node D:/Dev/Handshake/_triage/nino-relations.mjs`, run from the repo.

```
=== source ===
file: D:/Dev/Handshake/Build-an-Interactive-Data-Visualization/public/data/enso.csv
rows (data rows): 918
first date: 1950-01-01  last date: 2026-06-01
x column: nino_34_anomaly  y columns: nino12_anomaly, nino4_anomaly
warm threshold (x >=): 0.5

=== per-column non-finite counts ===
  nino_34_anomaly  non-finite: 0
  nino12_anomaly   non-finite: 0
  nino4_anomaly    non-finite: 0

=== nino12 / all months ===
  n         = 918
  mean x    = -0.17387799564270159
  mean y    = -0.23941176470588213
  slope     = 0.86991753260907612
  intercept = -0.088152247761371483
  r2        = 0.47135253851937742
  residSd   = 0.80365362869398405
  x range   = [-2.4500000000000002, 2.7200000000000002]
  y range   = [-3.0899999999999999, 4.4699999999999998]

=== nino12 / warm (x >= 0.5) ===
  n         = 181
  mean x    = 1.1166298342541441
  mean y    = 1.0383425414364638
  slope     = 1.1556075999591691
  intercept = -0.25204338136877236
  r2        = 0.28857244193721310
  residSd   = 0.98245408847155746
  x range   = [0.50000000000000000, 2.7200000000000002]
  y range   = [-1.4700000000000000, 4.4699999999999998]

=== nino4 / all months ===
  n         = 918
  mean x    = -0.17387799564270159
  mean y    = -0.24187363834422684
  slope     = 0.70216345812827463
  intercept = -0.11978286363133442
  r2        = 0.78687320700143881
  residSd   = 0.31877594809225052
  x range   = [-2.4500000000000002, 2.7200000000000002]
  y range   = [-2.2100000000000000, 1.5400000000000000]

=== nino4 / warm (x >= 0.5) ===
  n         = 181
  mean x    = 1.1166298342541441
  mean y    = 0.56961325966850840
  slope     = 0.32437059345513547
  intercept = 0.20741137766178214
  r2        = 0.20922651873081777
  residSd   = 0.34144685698345478
  x range   = [0.50000000000000000, 2.7200000000000002]
  y range   = [-0.55000000000000004, 1.5400000000000000]

=== three biggest Nino 3.4 months per event window ===
  1982-83 peak 1983-01-01  nino34=2.350000  nino12=2.650000  nino4=0.390000
      nino12 fitted(warm) = 2.463634  observed = 2.650000  residual = 0.186366  in range
      nino4 fitted(warm) = 0.969682  observed = 0.390000  residual = -0.579682  in range
  1997-98 peak 1997-11-01  nino34=2.410000  nino12=4.470000  nino4=0.690000
      nino12 fitted(warm) = 2.532971  observed = 4.470000  residual = 1.937029  in range
      nino4 fitted(warm) = 0.989145  observed = 0.690000  residual = -0.299145  in range
  2015-16 peak 2015-11-01  nino34=2.720000  nino12=2.280000  nino4=1.440000
      nino12 fitted(warm) = 2.891209  observed = 2.280000  residual = -0.611209  in range
      nino4 fitted(warm) = 1.089699  observed = 1.440000  residual = 0.350301  in range

=== fitted values at Nino 3.4 anomaly = 0.5 / 1.5 / 2.5 / 3.5 ===
  nino12 (warm fit, x range [0.50000000000000000, 2.7200000000000002])
    x=0.5  fitted=  0.3258  INSIDE  x range  inside  y
    x=1.5  fitted=  1.4814  INSIDE  x range  inside  y
    x=2.5  fitted=  2.6370  INSIDE  x range  inside  y
    x=3.5  fitted=  3.7926  OUTSIDE x range  inside  y

  nino4 (warm fit, x range [0.50000000000000000, 2.7200000000000002])
    x=0.5  fitted=  0.3696  INSIDE  x range  inside  y
    x=1.5  fitted=  0.6940  INSIDE  x range  inside  y
    x=2.5  fitted=  1.0183  INSIDE  x range  inside  y
    x=3.5  fitted=  1.3427  OUTSIDE x range  inside  y

=== paste-ready table (full double precision) ===
  {
    regionId: 'nino12',
    subset: 'all',
    n: 918,
    slope: 0.8699175326090761,
    intercept: -0.08815224776137148,
    r2: 0.4713525385193774,
    residSd: 0.803653628693984,
    xMin: -2.45,
    xMax: 2.72,
  },
  {
    regionId: 'nino12',
    subset: 'warm',
    n: 181,
    slope: 1.155607599959169,
    intercept: -0.25204338136877236,
    r2: 0.2885724419372131,
    residSd: 0.9824540884715575,
    xMin: 0.5,
    xMax: 2.72,
  },
  {
    regionId: 'nino4',
    subset: 'all',
    n: 918,
    slope: 0.7021634581282746,
    intercept: -0.11978286363133442,
    r2: 0.7868732070014388,
    residSd: 0.3187759480922505,
    xMin: -2.45,
    xMax: 2.72,
  },
  {
    regionId: 'nino4',
    subset: 'warm',
    n: 181,
    slope: 0.32437059345513547,
    intercept: 0.20741137766178214,
    r2: 0.20922651873081777,
    residSd: 0.3414468569834548,
    xMin: 0.5,
    xMax: 2.72,
  },
```

---

## B3 — pre-registered classification (report only)

### WEAK RELATION

The rule: warm-subset r² below 0.3.

| region | warm r² | verdict |
|---|---|---|
| **nino12** | **0.2886** | **WEAK RELATION** (just under the line) |
| **nino4** | **0.2092** | **WEAK RELATION** |

Both warm fits are weak. This is the substantive finding of the step: at warm
temperatures, a linear Niño 3.4 → region projection explains less than a third of the
variance. The mechanism is visible in the event table — Niño 4 saturates (1983 peak:
Niño 3.4 +2.35 but Niño 4 only +0.39, 0.58 below the fit; 1997: +2.41 vs +0.69) while
Niño 1+2 swings far wider (1997 peak +4.47 against a fitted +2.53, a +1.94 residual).

### OUT OF OBSERVED RANGE

The rule: fitted value at the slider default (1.5) or at Mega El Niño (3.0) outside the
observed y range.

| check | nino12 | nino4 |
|---|---|---|
| fit at slider default 1.5 | 1.4814 — observed y range [−1.47, 4.47] → **inside** | 0.6940 — observed y range [−0.55, 1.54] → **inside** |
| fit at Mega 3.0 | 2.8918 — **inside** | 1.1805 — **inside** |

**No OUT OF OBSERVED RANGE for either region at either position.**

But note a distinct finding the rule does not cover: **Mega El Niño (3.0) is outside the
warm sample's x range** ([0.5, 2.72]), so the top ~9 % of the slider is an extrapolation
for both regions. `projectAnomaly` reports that via `extrapolated: true`.

---

## Surprises

1. **`data/enso.csv` does not exist.** The CSV is `public/data/enso.csv`. The prompt's
   path is wrong; `data/` holds only the parquet. Any script written literally to the
   prompt's path fails with ENOENT.
2. **The header has 25 columns, not 10.** The ten the prompt lists are the *source*
   columns the Python script parses before enrichment; the shipped CSV adds 15 derived
   columns.
3. **No gaps.** All three columns the fits consume have 0 non-finite values across 918
   contiguous months, so no month is silently missing and no fit is biased by dropout.
4. **One baseline, no mismatch.** All four region indices sit on the same 1991–2020
   CPC base, so the anomaly columns are directly comparable — there is no cross-column
   baseline mismatch to correct for.
5. **The slider exceeds the observed x range.** `SST_MAX = 3` (and the "Mega" tick at
   3.0) is above the warm sample's `xMax = 2.72`, so the top of the track always
   extrapolates. A future card must show that, not hide it.
6. **Both warm fits predict a plausible-magnitude Niño 1+2.** At the default slider the
   projection is +1.48 °C — the same order as the 2015-16 peak (+2.28 observed) and well
   inside the record's [−3.09, +4.47] range. No implausible value.
7. **The Equatorial Pacific card does not read the dataset at all.** `+1.73 °C SST dev`
   is `1.5 × 1.15`, a hardcoded multiplier on the slider (`model.ts:120`). So the
   proposed Niño 1+2 / Niño 4 cards will be the *only* region cards whose value is
   derived from the data rather than from a fixed coefficient — worth knowing before a
   later step implies the four cards are computed the same way.
8. **`regions.ts` is now a grab-bag** (registry + formatting + box schema). This step
   kept `ninoRelation.ts` separate rather than adding to it.
