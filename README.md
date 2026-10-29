# Super El Niño Global Impact Simulator

An interactive 3D globe that models the global impact of El Niño sea-surface-temperature anomalies. Move one lever — the Pacific gets hotter — and watch precipitation, drought, and flood risk respond across four teleconnected regions in real time.

Built with React Three Fiber for the visuals and **DuckDB-WASM** for the analytics: every number on screen comes from SQL running in your browser tab, with no backend.

The historical record is **real**: 918 monthly observations (Jan 1950 – Jun 2026) of the NOAA CPC ERSSTv5 Niño 3.4 index, ingested by `scripts/generate_enso_data.py`. The 2015-16 super El Niño peak in the shipped file reads +2.72 °C, matching NOAA's published value.

**[Live demo →](https://tariqkhan.dev)** · [Report an issue →](https://github.com/tariq-k-dev)

---

## What it does

- **Cinematic globe** — a day/night Earth with city lights, a translucent cloud shell, ocean sun-glint, and a single-shell analytic Rayleigh/Mie atmosphere. The rim stays a thin cyan-to-deep-blue fringe; the anomaly drives intensity and latitude-band heat, never the sky colour (Rayleigh scattering is a property of the gas column, not the sea surface).
- **Four hotspots** — Equatorial Pacific (Niño 3.4), Western US, Southeast Asia, and the Horn of Africa. Click one and the camera lerps to its coordinates while the planet pauses its spin.
- **Scenario engine** — a 0.0–3.0 °C SST slider plus two teleconnection modifiers (jet-stream displacement, cropland vulnerability). Everything recomputes on drag.
- **Analytical HUD** — a glassmorphism drawer with live metrics, mechanism narrative, and a table of historical analog months pulled from the parquet by nearest-anomaly match.
- **Export** — downloads a PNG of the canvas and opens a print-styled HTML report (Save as PDF from the browser's print dialog).

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | React 18 + TypeScript (strict) | — |
| 3D | `@react-three/fiber`, `@react-three/drei`, `three` | Declarative scene graph; `useFrame` gives a single controlled render loop |
| Post-processing | `@react-three/postprocessing` | Bloom on the atmosphere + vignette, pinned to the fiber-8 line |
| Analytics | `@duckdb/duckdb-wasm` | Real OLAP in the browser — joins, windowing, and nearest-neighbour matching without shipping a server |
| Data pipeline | Python + Polars | Fetches the CPC text table, parses the fixed-width format, emits the CSV (served) and parquet (repo-only source of truth) |
| Styling | Tailwind CSS | Design tokens in `tailwind.config.js`, component classes in `src/index.css` |
| Icons | `lucide-react` | — |
| Build | Vite 5 | — |
| Tests | Vitest | — |

## Architecture

```
src/
├── lib/
│   ├── model.ts        Pure scenario maths — the single source of truth for every displayed number
│   ├── duckdb.ts       Engine boot + 5 SQL queries that mirror model.ts
│   ├── regions.ts      Hotspot coordinates, spherical→Cartesian, unit conversions
│   └── report.ts       PNG capture + print-styled HTML report
├── scene/
│   ├── GlobeScene.tsx  <Canvas> host, lighting, post-processing
│   ├── EarthSystem.tsx Owns the planet's rotation so globe + markers share one transform
│   ├── Globe.tsx       Surface, clouds, two Fresnel atmosphere shells
│   ├── Hotspot.tsx     Pulsing shader ring + pin + HTML label
│   ├── CameraRig.tsx   Smooth focus interpolation, suspends OrbitControls mid-flight
│   ├── Starfield.tsx   Single Points cloud, one draw call
│   └── shaders.ts      All GLSL in one auditable file
├── components/         Header, ControlDeck, RegionDrawer, RegionCards, ui/*
├── state/useScenario.ts  Debounced engine calls + synchronous optimistic metrics
└── types/enso.ts       Shared domain types
```

### The model

Four base equations, exactly as specified in the brief:

| Region | Equation |
|---|---|
| Equatorial Pacific | `SST dev = anomaly × 1.15` · `convection = min(100, anomaly × 35)` |
| Western US | `precip = +15% + 18% × anomaly` · `temp = −0.5 °F − 0.8 °F × anomaly` |
| SE Asia | `precip = −10% − 22% × anomaly` · `drought = 3.2 × anomaly` |
| Horn of Africa | `precip = +20% + 25% × anomaly` · `flood = 2.8 × anomaly` |

Two secondary levers modulate those bases linearly: jet-stream displacement (±12 pts on US precip, ±9 on SE Asia, ∓4 on Africa) and cropland vulnerability, which scales *exposure* without touching the climate signal.

`model.ts` and the SQL in `duckdb.ts` implement this twice — once in TypeScript for the zero-latency optimistic path, once in SQL for the engine path. `model.test.ts` asserts the TS side against hand-computed values; the two implementations are kept in lockstep by construction and reviewed together.

### The data

`scripts/generate_enso_data.py` pulls
`https://www.cpc.ncep.noaa.gov/data/indices/ersst5.nino.mth.91-20.ascii` — the
NOAA Climate Prediction Center's monthly ERSSTv5 indices for all four Niño
regions on the 1991–2020 base — parses the fixed-width table with Polars, handles
the `999` missing-value sentinels, and writes both a CSV for the browser and a Snappy-compressed parquet kept in `data/` as a repo-only source of truth.

**What is observed and what is modelled.** Every SST column is the CPC value
verbatim. The regional impact columns (precip, drought, flood, convection) are
*not* observations — they are this project's teleconnection model applied to the
observed anomaly, so the analog query can relate a scenario to the months that
produced it. Every row carries a `model_basis` column saying so, and
`dataset.test.ts` asserts the file against published NOAA values (2015-11 =
+2.72 °C, 1997-11 = +2.41 °C) so a silent ingest break cannot ship.

```bash
pnpm data                        # fetch + rebuild the CSV and parquet
uv run python scripts/generate_enso_data.py --offline   # reuse cached download
uv run python scripts/generate_enso_data.py --since 1980
```

### Why DuckDB for 20 lines of arithmetic?

Because the same engine also scans 120 monthly observations for analog matching, maps the seasonal timeline, and stays honest as the dataset grows. It keeps the analytics in SQL where a reviewer can read it instead of burying it in a component — and it survives `read_parquet` over a much larger file without a rewrite.

## Quick start

```bash
pnpm install      # also stages the DuckDB binaries via the predev hook
pnpm dev          # http://localhost:5173
```

```bash
pnpm lint         # ESLint, zero warnings tolerated
pnpm test         # Vitest — 25 model/unit assertions
pnpm build        # tsc -b && vite build → dist/
pnpm preview      # serve dist/ locally
```

**Requires** Node 20+ and pnpm 9+.

### Regenerating the dataset (optional)

`data/enso_historical.parquet` is committed as the source of truth and is **never served** — `public/data/enso.csv` is what the browser loads. To rebuild both:

```bash
uv run python scripts/generate_enso_data.py
```

## Deployment

Static SPA — any host works. For Cloudflare Pages:

| Setting | Value |
|---|---|
| Build command | `pnpm build` |
| Output directory | `dist` |
| Node version | 22 |

### Asset strategy

Cloudflare Pages rejects any single file over **25 MiB**. DuckDB's wasm is 33 MB (eh) / 38 MB (mvp), so it cannot ship from `dist/`.

| Asset | Where it comes from | Size |
|---|---|---|
| DuckDB **wasm** | jsDelivr, pinned to the installed version | 33–38 MB (streamed) |
| DuckDB **workers** | `public/duckdb/`, same-origin (required by `new Worker()`) | 0.74 + 0.81 MB |
| Textures | `public/textures/` | 0.12–0.92 MB |
| Parquet | `public/data/` | 73 KB |

`dist/` totals **4.88 MB**, largest single file 0.92 MB.

`pnpm build` runs `scripts/check-assets.mjs`, which **fails the build** if any
asset exceeds 25 MiB, if a stray `.wasm` appears in `dist/`, or if a required
runtime file is missing. The `coi` (threads) bundle is excluded entirely: it needs
COOP/COEP headers that Pages does not send, so `selectBundle()` would never pick it.

## Notes and limitations

- **Observed SST, modelled impacts.** The Niño indices are real NOAA CPC ERSSTv5 data. The precipitation/drought/flood columns are a teaching simplification of ENSO teleconnections applied to that data — not a general circulation model and not a forecast.
- **The fictitious normal map.** `earth_normal.jpg` is nearly flat (per-channel std ≈ 1.4 on a 0–255 scale), so it carries almost no relief. `normalScale` is dialled back rather than pretending it encodes terrain.
- **Inverted gloss mask.** `earth_specular.jpg` is white on water (a gloss mask), but three's `roughnessMap` reads white as rough. It is inverted once on a canvas at load time; binding it raw made oceans matte and continents mirror-like.
- **DuckDB bundle trimming.** `scripts/copy-duckdb.mjs` copies only the `mvp` and `eh` single-threaded bundles into `public/duckdb/` (~74 MB, gitignored, restored on install). The COI bundle is deliberately excluded.
- **Fallback path.** If the WASM engine cannot boot, the app degrades to `model.ts` with an honest "Client-side model" badge rather than dying.

## License

MIT
