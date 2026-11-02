# NINO-REGIONS-SCHEMA — Part A recon

Repo: `D:\Dev\Handshake\Build-an-Interactive-Data-Visualization`
HEAD at recon time: `a8ada77d475094a34cd0b2710561e1021a801a77`, `git status --porcelain` empty.
Read-only: nothing under `src/`, `tests/`, `public/`, `scripts/`, `data/` was modified by Part A.
The only file Part A created is `D:\Dev\Handshake\_triage\nino-parquet-probe.mjs` (probe, outside the repo).

---

## A1. How regions are defined today

There is **one** typed registry, one interface, one lookup map. Definitions are not scattered.

| fact | location |
|---|---|
| `export const REGIONS: RegionDefinition[]` | `src/lib/regions.ts:8` |
| `RegionDefinition` interface | `src/types/enso.ts:5-16` |
| `RegionId` union | `src/types/enso.ts:3` |
| `REGION_MAP` (`Record<RegionId, RegionDefinition>`, built by `REGIONS.reduce`) | `src/lib/regions.ts:59-65` |
| `latLonToVector3` (spherical → three.js Y-up) | `src/lib/regions.ts:68-76` |

### The exact type (`src/types/enso.ts:3-16`)

```ts
export type RegionId = 'pacific' | 'us-west' | 'se-asia' | 'horn-africa';

export interface RegionDefinition {
  id: RegionId;
  name: string;
  shortName: string;
  lat: number;
  lon: number;
  /** Camera distance multiplier used when focusing this region. */
  zoom: number;
  accent: string;
  summary: string;
  mechanism: string;
}
```

Every field, and what consumes it:

| field | meaning | consumer |
|---|---|---|
| `id` | stable key | `REGION_MAP`, `data-region-id` chips, `onSelect`, `regionHeadline` |
| `name` | card headline | `RegionCards.tsx:80`, report header `report.ts:58` |
| `shortName` | chip / pin label | `RegionDrawer.tsx` chip, `SheetBody.tsx:177`, `GlobeScene.tsx:853`, `Hotspot.tsx:538` |
| `lat`,`lon` | pin anchor, **single point** | `EarthSystem.tsx:62` → `Hotspot`, `CameraDirector.tsx:134-138`, `GlobeScene.tsx` probes |
| `zoom` | camera **distance** (sphere R=1) | locked fly-to `CameraDirector.tsx:213` |
| `accent` | hex colour | card rail, chip glow, pin |
| `summary` | card body copy | `RegionCards.tsx:101` |
| `mechanism` | drawer narrative | `RegionDrawer.tsx` |

### The four current entries

| # | id | `name` | `shortName` | lat | lon | bbox | framing target | metric kind | line |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `pacific` | Equatorial Pacific | **Niño 3.4** | −2 | −150 | **none** | `zoom: 2.9` | °C SST deviation (`pacificSstDev`) | `regions.ts:9-20` |
| 2 | `us-west` | Western US & California | California | 37 | −120 | none | `zoom: 2.6` | % precip (`usPrecip`) | `regions.ts:21-32` |
| 3 | `se-asia` | Southeast Asia & Indonesia | Indonesia | −3 | 112 | none | `zoom: 2.7` | % precip (`asiaPrecip`) | `regions.ts:33-44` |
| 4 | `horn-africa` | Horn of Africa | Horn of Africa | 8 | 42 | none | `zoom: 2.7` | % precip (`africaPrecip`) | `regions.ts:45-56` |

- **No entry has a bounding box.** `lat`/`lon` is a point; there is no lat/lon extent field anywhere in the module.
- **There is no camera-target object** — framing is the scalar `zoom` only.
- **There is no metric-kind field.** The metric per region is an implicit `switch` in `regionHeadline` (`src/lib/model.ts:175-189`): `pacific` → `±x.xx °C SST dev`, the other three → `% precip`. Adding a fifth `RegionId` without a `case` returns `undefined` at runtime while `tsc` reports a missing return.
- Card copy: `summary` + `mechanism` per entry (`regions.ts:17-19`, `:29-31`, `:41-43`, `:53-55`).

### Where the Niño 3.4 entry lives, and its shape

`src/lib/regions.ts:9-20`, id `pacific`, `shortName: 'Niño 3.4'` (`regions.ts:12`).

**It is a point only: `lat: -2, lon: -150` (`regions.ts:13-14`). There is no bounding box, and no CPC box values are stored anywhere in the repo** — a grep for `-170`, `170,`, `bbox`, `nino 1+2`, `nino12 box` across `src/`, `tests/`, `docs/`, `scripts/` returns no region-box definition (the only `bbox` hits are pixel bounding boxes in `src/lib/look/helpers.ts:990,1249`).

Consequence for B1: the condition "include nino34 in `NINO_BOXES` only if its values equal the existing definition exactly" **cannot be met**. The existing definition is the single point (−2, −150) plus `zoom: 2.9`; the CPC Niño 3.4 box is lat −5…5, lon −170…−120. Neither the centre nor the extent matches. Per B1, nino34 is therefore **left out of `NINO_BOXES`** and the discrepancy is reported (see Part B).

---

## A2. Every consumer of the region list

What a fifth entry would reach, if it were ever added to `REGIONS`:

| consumer | file:line | what it does |
|---|---|---|
| Descriptors (desktop card stack) | `src/components/RegionCards.tsx:3,13,37-41` | iterates **`ORDER`** (`:13`), a hardcoded `RegionId[]`, not `REGIONS`; header prints `{ORDER.length} active` (`:34`) |
| Drawer / chips | `src/components/RegionDrawer.tsx:7,289` | `REGIONS.map` → chip per region, `data-region-id`, `aria-current` |
| Mobile switcher chips | `src/mobile/SheetBody.tsx:32,158` | `REGIONS.map` → chips with `data-region-id` |
| Compact header island | `src/mobile/HeaderCompact.tsx:38,465` | `HEADER_REGIONS = REGIONS` (re-export, `:462-465`) |
| Pins / hotspots | `src/scene/EarthSystem.tsx:6,62` | `REGIONS.map` → one `<Hotspot>` per region |
| Globe probes | `src/scene/GlobeScene.tsx:30,307,585,839` | `__globe.pins()`, `__look.pinsWorld()`, in-globe chip row — all `REGIONS.map` |
| Fly-to / camera | `src/scene/CameraDirector.tsx:86,134-138,213` | `regionDirection(id)` → `REGION_MAP[id]` `lat/lon`; locked branch uses `zoom` |
| Pin geometry + label | `src/scene/Hotspot.tsx:14,538` | `latLonToVector3(region.lat, region.lon)` |
| Snapshot / report export | `src/lib/report.ts:14,58` | `REGION_MAP[activeRegion]` → `focus: ${region.name}` in the HTML report |
| App wiring | `src/App.tsx:11,251,279` | `REGION_MAP[activeRegion]` → cards + drawer |
| Headline metric | `src/lib/model.ts:175-189` | `switch (region)` — **exhaustive over the 4 ids** |
| Unit tests | `src/components/RegionDrawer.test.tsx:82-84`; `src/lib/model.test.ts:225-226` | chip count/labels from `REGIONS`; unique-coordinate assertion |

### URL / deep-link / history gate / persistence

**None exist for regions.** Grep results:
- `location.hash`, `history.pushState`, `history.replaceState` → **no hits** in `src/`.
- `URLSearchParams` → only `?framing=` (`src/layout/framing.ts:86`) and `?debug` (`src/main.tsx:23`, `src/scene/GlobeScene.tsx:257`). No region ever enters the URL.
- `localStorage` / `sessionStorage` → **no hits**. Selection is React state only (`App.tsx:44`).

So a new entry cannot leak into a URL, a share link, or persisted state.

### Tests that assert a count of 4

| file:line | assertion | breaks on a 5th entry? |
|---|---|---|
| `tests/e2e/pin-click.spec.ts:830` | `expect(summary).toHaveLength(4)` | only if the entry reaches `__globe.pins()` — it iterates the **local** `REGION_IDS` (`:49`) |
| `tests/e2e/pin-click.spec.ts:909` | `expect(sizes).toHaveLength(4)` | same, local `REGION_IDS` (`:49`) |
| `src/components/RegionDrawer.test.tsx:82` | `toHaveLength(REGIONS.length)` | self-relative — survives |
| `src/lib/model.test.ts:226` | `coords.size).toBe(REGIONS.length)` | self-relative — survives |
| `tests/e2e/camera-golden.spec.ts:90` | local 4-id array → 8 golden cases | only via `REGION_MAP` lookups, not count |
| `tests/e2e/focus-ux.spec.ts:47` | local 4-entry array (indexes `REGIONS[0..2]`) | index-based, would silently test the wrong region if order changed |
| `tests/e2e/reset-ux.spec.ts:41` | local 4-entry array (`:240-247` "four regions × two viewports = 8 cases") | same |
| `tests/e2e/switcher-ux.spec.ts:43` | local 4-entry array | same |

**The count-of-4 risk is concentrated at `pin-click.spec.ts:830,909`**: they are literal counts, and they are in a **locked** spec. Any future step that adds a card by pushing into `REGIONS` turns both red. That is the exact leak `NINO_BOXES` must not create.

---

## A3. How the dataset defines Niño 3.4

Pipeline: **`scripts/generate_enso_data.py`** (the only ENSO pipeline; a stale copy exists at `.cache/wt-old/scripts/generate_enso_data.py` inside an ignored throwaway worktree — not in play). No other `.py` under `D:\Dev\Handshake` touches SST.

| question | answer | location |
|---|---|---|
| source product | **NOAA CPC ERSSTv5 monthly Niño *index* table**, 1991–2020 base — already region-averaged series, not a grid | `scripts/generate_enso_data.py:55-56` |
| grid resolution | **none — there is no grid** | `:71-82` (10 scalar columns), `:113-138` (`parse`) |
| longitude convention | **N/A** — no longitude column exists in the source, the parquet, or the CSV | measured, see below |
| box used for Niño 3.4 | **computed upstream by CPC**; not computed in this repo | `:8-32` docstring; `COLUMNS` `:71-82` |
| area-weighted by `cos(lat)` | **no** — nothing here averages over space | `:113-250` (only per-row arithmetic) |
| land-mask handling | **none** — ERSSTv5 is an in-situ/infrared blended product masked upstream | not present in repo |
| output path | **`data/enso_historical.parquet`** (repo-only, never served) + derived `public/data/enso.csv` | `:64-66`, `:298`, `:313` |
| compression | snappy (portability across duckdb-wasm / pyarrow / hyparquet) | `:295-298` |

Note the delivered path differs from the prompt's assumption: the parquet is **`data/enso_historical.parquet`, not `public/data/enso_historical.parquet`** (`:60-64`, and `src/lib/duckdb.ts:25-28`). `public/data/` contains only `enso.csv` and `schema.sql`.

### Parquet schema — measured (`node _triage/nino-parquet-probe.mjs`, hyparquet 1.31.5)

```
file:      data/enso_historical.parquet
bytes:     74467  = 72.7 KiB
num_rows:  918
row_groups: 1
created_by: Polars (python) version 2.1.0
date range: 1950-01-01 .. 2026-06-01
```

| column | parquet type | logical | JS type |
|---|---|---|---|
| `date` | INT32 | DATE | `Date` |
| `year`, `month` | INT32 | — | `Number` |
| `nino12_sst`, `nino12_anomaly` | DOUBLE | — | `Number` |
| `nino3_sst`, `nino3_anomaly` | DOUBLE | — | `Number` |
| `nino4_sst`, `nino4_anomaly` | DOUBLE | — | `Number` |
| `nino34_sst`, `nino_34_anomaly` | DOUBLE | — | `Number` |
| `global_sst_anomaly`, `sst_deviation`, `convection_shift` | DOUBLE | — | `Number` |
| `precip_anomaly_pacific`, `precip_anomaly_us`, `temp_deviation_us_f`, `precip_anomaly_se_asia`, `drought_index_se_asia`, `precip_anomaly_africa`, `flood_index_horn`, `agriculture_exposure` | DOUBLE | — | `Number` |
| `risk_tier_pacific`, `source`, `model_basis` | BYTE_ARRAY | UTF8 | `String` |

25 columns; identical to `public/data/schema.sql:1-29`. All 918 rows non-null on every region index.

**No spatial column exists**: a filter for `lat|lon|grid|cell|x_|y_|area|weight` over the schema returns only `precip_anomaly_*`, `drought_index_se_asia`, `flood_index_horn` — i.e. no coordinate address space at all.

Measured ranges (918 values each):

| column | min | max |
|---|---|---|
| `nino12_sst` | 18.920 | 29.230 |
| `nino12_anomaly` | −3.090 | 4.470 |
| `nino3_sst` | 22.580 | 29.220 |
| `nino3_anomaly` | −2.400 | 3.300 |
| `nino4_sst` | 26.300 | 30.210 |
| `nino4_anomaly` | −2.210 | 1.540 |
| `nino34_sst` | 24.250 | 29.420 |
| `nino_34_anomaly` | −2.450 | 2.720 |

### Does Niño 3 exist anywhere?

**In the data: yes.** `nino3_sst` and `nino3_anomaly` are real, observed CPC columns, present in the parquet (`scripts/generate_enso_data.py:76-77`), in the CSV (`public/data/schema.sql:9-10`), in the typed parser (`src/lib/data/parse.ts`, `EXPECTED_COLUMNS`), and in the DuckDB `read_csv` column block (`src/lib/duckdb.ts:91-92`).

**In the registry: no.** There is no `nino3` region, no `nino3` box, and no UI surface reads those two columns — grep for `nino3_` in `src/` finds only `parse.ts` and `duckdb.ts` (the type/reader declarations). The columns are dead weight today.

Naming asymmetry to be aware of: `nino34_sst` + **`nino_34_anomaly`** (underscore) versus `nino12_*`, `nino3_*`, `nino4_*`.

---

## A4. How `duckdb.ts` and `model.ts` read the parquet

### `src/lib/duckdb.ts` — the parquet is never read by the app

The engine reads **`/data/enso.csv`**, not the parquet (`DATA_URL` `:72`). Reason, documented at `:16-29`: `read_parquet()` lives in DuckDB's `parquet` extension, which duckdb-wasm fetches from `extensions.duckdb.org` at runtime, and `:493-494` hard-disables extension autoload so that cannot happen. `read_csv()` is in the wasm core.

| item | location |
|---|---|
| `CSV_COLUMNS` explicit type map (25 entries; `nino12_*` `:89-90`, `nino3_*` `:91-92`, `nino4_*` `:93-94`, `nino34_sst` `:95`, `nino_34_anomaly` `:96`) | `:85-111` |
| `CREATE OR REPLACE TABLE enso_historical AS SELECT * FROM read_csv('enso.csv', header=true, columns=…)` | `:371-382` |
| `SCENARIO_SQL` — touches **no** history table | `:236-280` |
| `ANALOG_SQL` — `nino_34_anomaly, nino34_sst, sst_deviation, precip_anomaly_pacific|us|se_asia|africa, drought_index_se_asia, risk_tier_pacific`; `ORDER BY abs(nino_34_anomaly - ?) ASC, date DESC LIMIT 6` | `:282-301` |
| `SUMMARY_SQL` — `count(*)`, min/max date, `avg/max(nino_34_anomaly)`, `arg_max`, `count(*) FILTER`, `any_value(source)` | `:303-316` |
| `TIMELINE_SQL` — `strftime(date,'%Y-%m')`, `nino_34_anomaly` | `:318-324` |
| `RISK_TIER_SQL` — CASE on the bound parameter only | `:329-340` |

Every region-flavoured number in the HUD comes from `SCENARIO_SQL`, which is pure arithmetic on three bound scalars (`sst`, `jet`, `agri`) — **no region column is ever queried.**

### `src/lib/model.ts` — pure TS mirror

`computeMetrics` (`:114-172`) is the same arithmetic as `SCENARIO_SQL`, asserted equal by `model.test.ts`. `regionHeadline` (`:175-189`) maps region → headline string. **Neither touches the parquet or any `nino*` column.**

### Which columns a region metric would need

The columns already exist and are already typed in both readers:

| proposed region | absolute SST | anomaly | already in `duckdb.ts` | already in `parse.ts` |
|---|---|---|---|---|
| Niño 1+2 | `nino12_sst` | `nino12_anomaly` | `:89-90` | `:23-24` |
| Niño 4 | `nino4_sst` | `nino4_anomaly` | `:93-94` | `:27-28` |
| Niño 3.4 (existing) | `nino34_sst` | `nino_34_anomaly` | `:95-96` | `:29-30` |

So a future Niño 1+2 / Niño 4 readout needs **zero** pipeline or schema change. It needs a `RegionId` extension, an `regionHeadline` case, and (if it enters the registry) `ORDER`, `ICONS`, and the exhaustive `Record<RegionId, …>` in `RegionCards.tsx:6-11`.

---

## A5. Coarse-grid check

**There is no grid, so there are no cells to count. The measured numbers are zero, and the premise of A5 does not hold for this repo.**

| quantity | measured |
|---|---|
| cells inside the Niño 1+2 box (0…−10 lat, −90…−80 lon) | **0** |
| cells inside the Niño 4 box (−5…5 lat, 160E…150W) | **0** |
| Niño 1+2 cells that are land-masked | **0** |

Why: the pipeline ingests a 10-column table of **already area-averaged regional indices** (`scripts/generate_enso_data.py:71-82`), one row per month. The parquet has 918 rows × 25 scalar columns and **no coordinate address space** (measured: no `lat`/`lon`/`grid`/`cell`/`area`/`weight` column). A cell count is not a small number here; it is undefined.

Evidence no gridded source exists in the workspace either: `find /d/Dev/Handshake -name '*.nc' -o -name '*.nc4' -o -name '*sst*.csv' -o -name '*sst*.parquet'` → **no results**; the only SST artifact is the parquet measured above.

*Derived, NOT measured* (stated so a later step can plan a real ingest rather than rediscover this): if a 2°×2° ERSSTv5 cell grid on the 0…360 convention were adopted, the Niño 1+2 box would be 5 latitude rows (10° / 2°) × 5 longitude columns (10° / 2°) = **50 nominal cells**, of which a substantial fraction is South American land (Peru/Ecuador coast) and would be masked out; Niño 4 would be 5 × 25 = **125 nominal cells**, almost entirely ocean. Those two products are arithmetic, not counts from this repo, and the Niño 1+2 land fraction cannot be stated without the grid.

**Implication for Part B:** `NINO_BOXES` and its helpers are defined against a *planetary coordinate convention*, not against this dataset. Nothing in the shipped pipeline consumes them yet, which is exactly what "inert" requires — but it also means the `boxLon360Ranges` rationale ("a later SQL or numpy filter can use BETWEEN without wraparound bugs") describes a future ingest, not an existing one.

---

## Decision gate

**PASS — continue to Part B.**

A1 shows a single typed region registry: one interface (`src/types/enso.ts:5-16`), one array (`src/lib/regions.ts:8`), one derived map (`:59-65`), and no hardcoded region coordinates in any scene or UI file (every consumer reads `REGIONS`/`REGION_MAP`; the only hardcoded lists are the display `ORDER` in `RegionCards.tsx:13` and local test arrays). Definitions are not scattered, so no refactor is required and Part B may proceed.


---

# ADDENDUM — Part B outcome (appended after the Part A copy above)

Everything above is the Part A report, verbatim as written before any edit. This
section records what Part B did with it, and the two discrepancies that stop the
schema being a pure restatement.

## B1 discrepancy — Niño 3.4 is NOT in `NINO_BOXES`

B1 permits nino34 in `NINO_BOXES` "only if its values equal the existing definition
exactly". They cannot: the existing Niño 3.4 definition is the **point** (-2, -150)
plus `zoom: 2.9` (`src/lib/regions.ts:9-20`), and there is no existing box anywhere in
the repo to agree with. The CPC box (lat -5..5, lon -170..-120) has a different centre
(-2.5/-145 vs -2/-150) and an extent the registry never carried.

So nino34 is **left out of `NINO_BOXES`**. Its CPC values are exported separately as
`NINO34_REFERENCE_BOX`, anchored on the existing pin (-2, -150), purely as a
regression reference. It is not in the iterated list and nothing consumes it.

## A5 does not apply — there is no grid to count cells on

The pipeline ingests an already-area-averaged CPC index table
(`scripts/generate_enso_data.py:71-82`), not gridded SST. The parquet has 918 rows and
no coordinate address space. Niño 1+2 cells, Niño 4 cells and land-masked Niño 1+2
cells are therefore **all 0 / undefined**, not small-but-meaningful. Any future step
that intends to compute a Niño average from cells needs a new gridded ingest; the
shipped dataset cannot answer it.

## B5 — labels, slugs, and the Ñ

| item | proposed | safe? |
|---|---|---|
| display labels | `NIÑO 1+2`, `NIÑO 4` | **yes** — uppercasing is CSS `text-transform: uppercase`, which preserves `Ñ` |
| slugs | `nino12`, `nino4` | yes — disjoint from `pacific`/`us-west`/`se-asia`/`horn-africa` |
| plus sign | `1+2` in a label only | safe today: **no region id or label ever enters a URL** (no `location.hash`/`pushState`/`replaceState` region param, no `localStorage`). If a deep-link is ever added, `+` in a query string decodes to a space — encode it then. |

Reported only; nothing was changed for either.

## The count-of-4 risk, named

`tests/e2e/pin-click.spec.ts:830` and `:909` assert a literal `4`. Both iterate a local
`REGION_IDS` array (`:49`), so they stay green as long as `NINO_BOXES` is never folded
into `REGIONS`. `src/lib/regions.test.ts` pins `REGIONS.length === 4` in the unit gate
so that mistake turns red in seconds rather than in the batched suite.
