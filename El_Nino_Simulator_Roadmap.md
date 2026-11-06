# El Niño Global Impact Simulator: Project Roadmap

### Phase 1: Core Stability & Test Hardening

Before adding new features, the baseline application and its test suite must be flawlessly deterministic.

| Step | Strategic Objective | Est. Time |
| :---- | :---- | :---- |
| **1.1 Tablet Layout Fix** | Verify Hermes's `TABLET-PORTRAIT` commit, ensuring responsive UI integrity across iPad 11" and 13" viewports without breaking desktop specs. | **15–30 min** |
| **1.2 `globe:305` Triage** | Run the read-only probe on the fly-to camera distance jitter to diagnose if the wheel point is occluded by the drawer. | **30–45 min** |
| **1.3 Suite Stabilization** | Implement the `globe:305` fix, run the full 15-spec locked suite, and ensure a 100% green gate at `HEAD`. | **30–60 min** |

### Phase 2: Data Architecture & Region Expansion (Current)

This phase prepares the DuckDB-WASM engine and 3D globe to support the expanded scope.

| Step | Strategic Objective | Est. Time |
| :---- | :---- | :---- |
| **2.1 Schema & Coordinates (Current)** | Define the DuckDB schema for the expanded datasets. Map the precise GeoJSON vectors and 3D camera angles for the two new regions (Amazon Basin & Gulf Coast). | **1–2 hours** |
| **2.2 Historical Data Load** | Ingest the expanded historical NOAA datasets (ERSSTv5, PRISM, etc.) as optimized Parquet files. Validate DuckDB query performance for the historical scenario engine. | **2–3 hours** |
| **2.3 UI Component Wiring** | Expand the `RegionCards` and mobile drawer to handle 6 regions. Wire the new DuckDB historical queries to the existing UI sliders and UI charts. | **2–4 hours** |

### Phase 3: Real-Time NOAA Telemetry Integration

With the structure in place, we swap static placeholders for live data feeds.

| Step | Strategic Objective | Est. Time |
| :---- | :---- | :---- |
| **3.1 Ingestion Pipeline Strategy** | Design the architecture for fetching live NOAA data (Cloudflare Workers with Cron Triggers to fetch, parse, and cache feeds into Parquet/KV to avoid CORS and rate limits). | **2–3 hours** |
| **3.2 Pipeline Implementation** | Build the integration for TAO/TRITON buoys, CPC precipitation, and NWS atmospheric river feeds. | **3–5 hours** |
| **3.3 Client Hydration** | Update the DuckDB-WASM queries to seamlessly merge historical baselines with the newly cached real-time telemetry upon app load. | **2–3 hours** |

### Phase 4: Polish, Profiling, & Launch

The final stretch focuses on user experience, performance, and deployment readiness on Cloudflare Pages.

| Step | Strategic Objective | Est. Time |
| :---- | :---- | :---- |
| **4.1 WebGL & Memory Profiling** | Audit React Three Fiber (R3F) for memory leaks during rapid region switching and fly-to animations. Ensure steady 60fps on mobile. | **1–2 hours** |
| **4.2 Final UI/UX & Attribution Polish** | Refine CSS transitions, loading states, and implement the footer copyright/attribution: `© 2026 Tariq Khan. Built with React Three Fiber, DuckDB-WASM & Tailwind CSS. AI-augmented development via a multi-model workflow.  Deployed on Cloudflare Pages.` | **2–3 hours** |
| **4.3 E2E Regression & Deploy** | Run the complete Playwright matrix one last time. Configure production build settings, asset compression, and deploy live to Cloudflare Pages. | **1–2 hours** |

### Phase 5: Portfolio Integration (`tariqkhan.dev`)

Showcase the live application directly within your personal portfolio.

| Step | Strategic Objective | Est. Time |
| :---- | :---- | :---- |
| **5.1 Asset & Demo Preparation** | Implement a custom camera script to capture high-resolution, 60fps screen recordings of the rotating 3D globe and telemetry overlays. Convert the captures into an optimized `.webm` format for a looping, high-performance project feature card on the portfolio. | **30–45 min** |
| **5.2 Featured Project Card Implementation** | Add a prominent feature card in the `Projects` section of `tariqkhan.dev`, highlighting the tech stack (React Three Fiber, DuckDB-WASM, NOAA Telemetry, Cloudflare Pages) with live links to the app and repository. | **1–1.5 hours** |
| **5.3 Portfolio Deploy & Verification** | Build, test, and push the updated portfolio to Cloudflare Pages. | **20–30 min** |
| **5.4 Portfolio Codebase Evaluation & Optimization** | Deploy the AI trio (Gemini, Claude, Hermes) for a comprehensive code review of the tariqkhan.dev repository. Target bug fixes, deep SEO optimization, performance tuning, layout analysis (specifically resolving the mobile 3D background shift), and visual polish to achieve an award-winning standard. | **2–4 hours** |

