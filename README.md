# El Niño Global Impact Simulator

[![Live Application](https://img.shields.io/badge/Live_App-Cloudflare_Pages-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://el-nino-simulator.pages.dev)
[![Stack](https://img.shields.io/badge/Architecture-React_Three_Fiber_•_DuckDB--WASM_•_TypeScript-0284c7?style=for-the-badge)](https://github.com/tariq-k-dev/el-nino-simulator)
[![Tests](https://img.shields.io/badge/Unit_Tests-1300+_Passing-10b981?style=for-the-badge&logo=vitest&logoColor=white)](https://github.com/tariq-k-dev/el-nino-simulator)
[![Playwright](https://img.shields.io/badge/E2E_Matrix-23_Suites_Green-22c55e?style=for-the-badge&logo=playwright&logoColor=white)](https://github.com/tariq-k-dev/el-nino-simulator)

> An edge-hydrated, high-performance climate telemetry simulator. Translates multi-decadal NOAA oceanic datasets and real-time Pacific SST/IVT telemetry into interactive 3D atmospheric flow dynamics using client-side in-memory columnar OLAP.

Architected & Engineered by **[Tariq Khan](https://tariqkhan.dev)**  
[Portfolio](https://tariqkhan.dev) · [LinkedIn](https://www.linkedin.com/in/tariqakhan) · [Source Code](https://github.com/tariq-k-dev/el-nino-simulator)

---

## ⚡ Executive Architecture & Technical Highlights

Rather than relying on latency-heavy server-side spatial database clusters, this application moves the entire analytical pipeline directly to the browser edge:

* **In-Browser Columnar OLAP (DuckDB-WASM):** Executes complex temporal and spatial anomaly queries across multi-decadal NOAA datasets directly in browser WebAssembly threads. Achieves sub-15ms query execution times with zero backend database operational overhead.
* **Real-Time Edge Telemetry Pipeline:** A decoupled Cloudflare Worker cron daemon fetches, normalizes, and caches live NOAA TAO/TRITON buoy observations, Climate Prediction Center (CPC) precipitation anomalies, and NWS Integrated Vapor Transport (IVT) streams into Cloudflare KV, avoiding CORS barriers and upstream rate-limits.
* **Interactive 3D WebGL Atmospheric Dynamics:** Built on Three.js and React Three Fiber with custom GLSL volumetric shaders. Renders dynamic atmospheric river ribbons and sea surface temperature (SST) gradients with ACESFilmic tone mapping and a strict 60 FPS mobile render budget.
* **Deterministic Camera Director:** Custom spatial math module featuring dual-channel spherical camera easing, viewport inset compensation for mobile sliding drawers, and anti-jitter projection mapping with exact load-state return fidelity (0.00000° angular error).
* **Deterministic Verification & Source Integrity:** Comprehensive test engineering featuring 1,300+ Vitest unit tests and 23 Playwright E2E suites verifying byte-identical canvas determinism (`meanAbsDiff = 0.00000`), network bandwidth fallbacks (Fast 4G, 1.6 Mbps, 400 kbps, `saveData`), and automated bundle tree hash guards.

---

## 🏗️ System Architecture & Data Flow

```text
[ NOAA / TAO / CPC / NWS Live Feeds ]
                 │
                 ▼ (Hourly Cron Ingestion)
[ Cloudflare Worker Edge Daemon ]
                 │
                 ▼ (Edge KV Cache & Compression)
       https://api.../telemetry
                 │
                 ├──────────────────────────────────────┐
                 ▼ (Hydration via Web Worker)           ▼ (Sync Stream)
     ┌────────────────────────┐             ┌────────────────────────┐
     │  DuckDB-WASM Worker    │             │ Telemetry State Store  │
     │  - Historical Baselines│             │ - Buoy Vectors         │
     │  - Real-Time SQL Joins │             │ - Live IVT Anomalies   │
     │  - Anomaly Quantiles   │             └───────────┬────────────┘
     └───────────┬────────────┘                         │
                 │                                      │
                 ▼ (Typed Data Arrays)                  ▼ (GPU Uniforms)
┌────────────────────────────────────────────────────────────────────────┐
│                      Client Visual Compositor                          │
│                                                                        │
│   [React Three Fiber Canvas]           [Responsive Overlay Deck]       │
│   ├── Earth Sphere & Night Textures   ├── Telemetry Status Badge       │
│   ├── Atmospheric River Ribbons       ├── Dynamic Regional Metrics     │
│   └── Camera Director & Inset Easing  └── High-DPI Report Canvas Export│
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🔬 Core Engineering Challenges & Graphics Pipeline

### 1. In-Browser Analytics via Columnar WebAssembly

- **Problem:** Scanning decades of historical ENSO observations across 6 global teleconnection regions usually requires high-concurrency cloud databases, introducing 200–800ms of network latency per slider drag.
- **Solution:** Embedded DuckDB-WASM inside a dedicated Web Worker. Pre-compiled Snappy-compressed Parquet datasets are fetched once, cached in IndexedDB, and queried via SQL in memory. Nearest-neighbor analog queries run with sub-millisecond execution, completely offloading the main UI thread.

### 2. High-DPI Canvas Capture & Composite Export

- **Problem:** WebGL canvas buffers automatically clear upon presentation (`preserveDrawingBuffer: false` for memory efficiency), causing standard `canvas.toDataURL()` calls to export empty images.
- **Solution:** Implemented a synchronous renderer registration pattern (`src/lib/canvasCapture.ts`). The export pipeline coordinates a single dedicated WebGL render call in lockstep with the off-screen compositor before reading the data URL, wrapping the visual state with client-side query timing, observation bounds, and nearest historical analogs into an instant HTML diagnostic report.

### 3. Camera Framing & Viewport Inset Mathematics

- **Problem:** On mobile and tablet devices, responsive drawers cover up to 50% of the viewport, throwing the globe off-center and causing camera oscillation (jitter) when switching regions.
- **Solution:** Designed an inset-aware framing engine (`src/layout/insets.ts` and `src/scene/CameraDirector.tsx`). Calculates dynamic NDC bounding boxes that offset the globe's target vector into the remaining visible optical center, paired with an independent dual-channel slerp/lerp easing pipeline that halts rotation before terminal zoom settle.

### 4. PBR Texture & Atmosphere Tuning

- **Ocean Gloss Inversion:** `earth_specular.jpg` is white on water (a gloss mask), but Three.js's `roughnessMap` reads white as rough. The mask is inverted once on an off-screen canvas at load time; binding it raw made oceans matte and continents mirror-like.
- **Single-Shell Rayleigh/Mie Atmosphere:** The rim stays a thin cyan-to-deep-blue fringe; SST anomalies drive thermal intensity and latitude-band heat, never the sky colour (Rayleigh scattering is an intrinsic property of the gas column, not the sea surface).

## 🛠️ Tech Stack

| Domain | Technologies | Details / Rationale |
| :--- | :--- | :--- |
| **Frontend Framework** | React 18, TypeScript (Strict), Vite 5, Tailwind CSS | Modular component architecture, strict type boundaries |
| **3D & WebGL Graphics** | Three.js, React Three Fiber (R3F), Drei, Custom GLSL | Declarative scene graph, single controlled `useFrame` render loop |
| **Data Engine & OLAP** | DuckDB-WASM, Apache Parquet, Web Workers | Zero-latency in-memory SQL execution directly in browser |
| **Edge & Telemetry** | Cloudflare Workers, Cloudflare KV, Wrangler | Scheduled cron ingestion of live NOAA buoys and IVT feeds |
| **Testing & CI/CD** | Vitest (JSDOM), Playwright E2E, ESLint | Deterministic pixel assertions, bandwidth throttling validation |
| **Edge Hosting** | Cloudflare Pages | Edge-distributed static SPA delivery with strict asset gates |

## 🧪 Test Suite & Quality Gates

The codebase enforces strict quality boundaries before any production build:

```bash
# Run the complete unit test suite (1,300+ tests across layout, math, and engine)
pnpm vitest run

# Run TypeScript typechecks across the main app and worker configurations
pnpm tsc --noEmit

# Enforce zero-warning ESLint policy
pnpm lint

# Rebuild the deterministic E2E bundle with tree-hash verification
pnpm build:e2e

# Run core Playwright end-to-end verification suites
pnpm playwright test tests/e2e/reset-ux.spec.ts tests/e2e/boot.spec.ts tests/e2e/determinism.spec.ts
```

---

## 📦 Asset Strategy & Edge Budget

Cloudflare Pages enforces a hard 25 MiB cap on individual assets. DuckDB's raw WASM binary is 33–38 MB and cannot be bundled directly into `dist/`.

| Asset | Source / Distribution | Size |
| :--- | :--- | :--- |
| DuckDB WASM | jsDelivr CDN, version-pinned and streamed | 33–38 MB |
| DuckDB Workers | `public/duckdb/`, same-origin execution | 0.74 + 0.81 MB |
| Surface Textures | `public/textures/` | 0.12–0.92 MB |
| Compressed Parquet | `public/data/` | ~73 KB |

`pnpm build` executes `scripts/check-assets.mjs` as an automated gate, failing the build if any asset violates size bounds, if a stray `.wasm` binary leaks into `dist/`, or if test hooks remain in production bundles.

## 🚀 Local Development Setup

### Prerequisites
* Node.js >= 20.x
* pnpm >= 9.x

### Quick Start
```bash
# Clone the repository
git clone git@github.com:tariq-k-dev/el-nino-simulator.git
cd el-nino-simulator

# Install dependencies (automatically stages DuckDB workers via predev hook)
pnpm install

# Start local development server
pnpm dev
```

---

## 📄 License & Attribution

Copyright © 2026 **Tariq Khan**. All rights reserved.  
Architected with **React Three Fiber**, **DuckDB-WASM**, and **TypeScript**. Deployed to **Cloudflare Pages**.
