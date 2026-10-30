# End-to-end acceptance suite

Playwright specs that encode the lazy-boot acceptance criteria (2B, cases a–i) as
executable checks.

These are **not** part of `pnpm test`. That gate stays fast, offline and
browser-free; this suite needs a browser, a built `dist/`, and the DuckDB wasm
from a CDN.

```bash
pnpm build      # the suite serves dist/, so build first
pnpm e2e        # all specs — measured 5.0 min wall clock on this machine
pnpm e2e:report # open the HTML report from the last run

pnpm build:e2e  # REQUIRED for the look specs: they need the VITE_E2E hooks
pnpm e2e:look   # look specs + negative tests + the five globe zoom cases
```

### The look suite (`pnpm e2e:look`)

`tests/e2e/look.spec.ts` measures the approved globe look from pixels (3.1 rim, 3.2 glare,
3.3 local peak, 3.4 terminator, 3.5 pin cores, 3.6 ring light cast, 3.7 console), and
`tests/e2e/globe.spec.ts` supplies the five zoom cases (3.8). What each check means, its
threshold and its measured value live in **`docs/globe-look/SPEC.md`** — do not restate
them here, they go stale.

**Build with `pnpm build:e2e`, not `pnpm build`.** The look specs read `window.__globe` /
`window.__look`, which are dead-code-eliminated from a production bundle. A plain
`pnpm build` leaves a `dist/` whose hooks are gone, and the specs then fail on
`waitForFunction` timing out after 90 s — which reads as a product bug. This bites in
practice: running the gate (`pnpm build`) and then the e2e suite in one command sequence
silently tests the wrong bundle.

`tests/e2e/negative.spec.ts` proves the checks can go red: each test asserts the real
check PASSES on the untouched scene, injects a defect at run time, asserts the same check
now reports FAIL, and removes the defect. No defect is ever committed to source. Three
cases are `test.fixme` — see the header of that file for the measurements showing that the
defect is real but its delivery into the measured window is not, which is the same R3F
invalidation seam documented in `3B-1-STATUS.md`.

### Running one profile at a time

The throttled profiles are slow by design (case d needs minutes) and the acceptance
matrix runs each three times, so the measurement tools are separate scripts with a
`--case`/`--mbps` selector. Run them against the Brotli server:

```bash
# one-time: serve dist/ with Brotli on 4199
node tests/e2e/brotli-server.mjs dist 4199

# acceptance matrix — 3 runs, min/median/max
node tests/e2e/acceptance-matrix.mjs --mbps 1.6 --runs 3
node tests/e2e/acceptance-matrix.mjs --mbps 0.4 --runs 3           # textured
node tests/e2e/acceptance-matrix.mjs --mbps 0.4 --runs 3 --stub    # 1x1 textures
node tests/e2e/acceptance-matrix.mjs --mbps 1.0 --runs 3           # false-positive guard
node tests/e2e/acceptance-matrix.mjs --mbps 0.5 --runs 3           # must abort
node tests/e2e/acceptance-matrix.mjs --mbps 0.8 --runs 3           # borderline, report only

# per-second early-abort evaluation trace
node tests/e2e/abort-trace.mjs --mbps 0.4
node tests/e2e/abort-trace.mjs --mbps 0.4 --stub

# scene-gate edge cases (hanging textures, WebGL disabled)
pnpm e2e -- tests/e2e/scene-gate.spec.ts

# gate effectiveness: does the worker start only after the gate opens?
node tests/e2e/gate-effect.mjs --mbps 1.6
node tests/e2e/gate-effect.mjs --mbps 0.4

# measured wire bytes at abort (needs the wasm served locally — see below)
node tests/e2e/wire-bytes.mjs --mbps 0.4 --runs 3
node tests/e2e/wire-bytes.mjs --mbps 0.4 --runs 3 --stub
```

### Two different builds

`pnpm build` produces the **production** bundle, with every diagnostic hook
dead-code-eliminated. `scripts/check-assets.mjs` fails the build if any hook name
reappears in `assets/*.js`.

`pnpm build:e2e` sets `VITE_E2E=1` through `scripts/build-e2e.mjs`, which keeps the
hooks. It is a Node wrapper rather than inline `VITE_E2E=1 vite build` because pnpm runs
scripts through `cmd.exe` on Windows, where that POSIX assignment is parsed as a command
name and fails — the E2E bundle then silently is not built, and the specs run against a
production `dist/` with every hook stripped. The tracing scripts
(`gate-effect`, `wire-bytes`, `abort-trace`, `boot-timeline`) and the
`?debug` URL param only work against that build:

| Hook | What it exposes |
|---|---|
| `window.__engineStore` | live engine store state |
| `window.__sceneGate` | gate outcome, `openedAt` (performance.now clock), settle time |
| `window.__textures` | per-texture `{requestStart, responseEnd, onLoad}` timeline, reconciled against gate-open |
| `window.__scene` / `__camera` / `__gl` | three.js objects |
| `window.__bootErrors` | errors captured before mount |
| `window.__SCENE_GATE_TIMEOUT_OVERRIDE__` | shorten the 120 s gate timeout |

### Measuring wire bytes for real

The wasm normally comes from the CDN, brotli-compressed, so a decoded-byte counter
cannot tell you what crossed the wire. To measure it, serve the wasm from the local
brotli server (which counts bytes actually flushed before a client disconnect) and
bake that URL into an E2E build:

```bash
mkdir -p dist/duckdb && cp node_modules/@duckdb/duckdb-wasm/dist/duckdb-*.wasm dist/duckdb/
VITE_E2E=1 VITE_DUCKDB_WASM_BASE=http://localhost:4199/duckdb \
  node ./node_modules/vite/bin/vite.js build
node tests/e2e/wire-bytes.mjs --mbps 0.4 --runs 3
```

Note the local server sends the wasm **uncompressed**, so the measured wire/decoded
ratio is ~2.5 rather than the CDN's ~0.20. Results under both are in
`docs/2B-VERIFY.md` §10.2.

Each script prints a JSON summary and also writes it under `.cache/` (gitignored).

> **Do not run two matrix profiles at once.** Both drive the same emulated network
> profile through one browser and measure wall-clock timing; concurrency makes every
> figure meaningless.

Measured per case (serial, one worker, this machine):

| Case | Wall time |
|---|---|
| a desktop eager | ~9 s |
| b coarse / Fast 4G / 4× CPU | 22.0 s |
| c 1.6 Mbps | 49.4 s |
| d 400 kbps | 3.3 min |
| e saveData + 3g | ~11 s each |
| f jsDelivr black-holed | 24.7 s |
| g stall | 24.5 s |
| h write rate | 49.2 s |
| i invariants | ~9 s |


First run only — install the browser:

```bash
pnpm exec playwright install chromium
```

Browsers are cached outside the repo (in the OS user cache), so nothing large is
committed.

## Why a custom server instead of `vite preview`

`vite preview` serves **identity** encoding. Production (Cloudflare Pages) serves
**Brotli**. Measured on the real build:

| Asset | Identity | Brotli | Ratio |
|---|---|---|---|
| `data/enso.csv` | 225,838 B | 25,622 B | 8.8× |
| `duckdb-browser-eh.worker.js` | 772,759 B | 155,830 B | 5.0× |
| `assets/index-*.js` (app) | 359,800 B | 79,745 B | 4.5× |
| `assets/three-*.js` | 683,504 B | 143,178 B | 4.8× |

Timing assertions for the slow profiles (cases c/d) are only meaningful against a
realistic transfer, so `tests/e2e/brotli-server.mjs` stands in for Pages. It also
sends `ETag` and honours `If-None-Match` with a `304`, which is what makes the
per-host cache behaviour in case f observable.

## Layout

```
tests/e2e/
├── boot.spec.ts               cases a-i
├── gate-clock.spec.ts         gate vs textures on ONE clock at 1.6 Mbps
├── harden.spec.ts             negative zero, dataset failure, fetch overlap, badge a11y
├── scene-gate.spec.ts         hanging textures + WebGL-disabled edge cases
├── acceptance-matrix.mjs      N-run min/median/max per network profile
├── abort-trace.mjs            per-second early-abort evaluation dump
├── boot-timeline.mjs          boot-time decomposition (textured vs stubbed)
├── fixtures.ts                connection/pointer overrides, CDP throttling, byte ledger
├── brotli-server.mjs          Pages-like static server (Brotli + ETag/304 + request log)
└── globals.d.ts               window.__LT / window.__MUT for page-side observers
playwright.config.ts           serial, 400 s timeout, boots the server via webServer
```

### Debug hooks the measurement scripts rely on

Append `?debug` to any URL to get:

| Global | What it is |
|---|---|
| `window.__engineStore` | the live engine store — `getSnapshot()` gives exact `loaded`, `firstEventAt`, `decoded`, `phase`, `reason` |
| `window.__scene`, `__camera`, `__gl` | the live three.js objects, for visual QA |
| `window.__bootErrors` | errors captured before React mounts |
| `window.__SCENE_GATE_TIMEOUT_OVERRIDE__` | set before load to shorten the 120 s scene-gate timeout in a test |

Reading the store beats parsing the rendered percentage: the badge is throttled to
10 writes/s and rounds to whole percent, so a 250 ms poll of the DOM cannot
reconstruct the rate the watchdog actually used.

## Cases

| Case | Profile | Asserts |
|---|---|---|
| a | desktop, unthrottled | eager boot reaches ready; label names the host |
| b | coarse pointer, Fast 4G, 4× CPU | idle boot reaches ready; long tasks **reported** as an artifact, not asserted |
| c | 1.6 Mbps | ready, **no host switch**, one host touched |
| d | 400 kbps, no Network Information API | early abort as too-slow, **exactly one host**, history already present, then user mode succeeds |
| e | `saveData` and `effectiveType=3g` | **zero** wasm/worker requests until the button is clicked; then boots |
| f | jsDelivr black-holed | connect trip falls through to unpkg |
| g | mid-download stall (route never settles) | stall trip advances to the next host |
| h | 1.6 Mbps | DOM-mutation rate ≤ 12/s (upper bound on store writes) |
| i | eager | zero `extensions.duckdb.org` requests, zero console errors |

Every case also asserts **zero requests to `extensions.duckdb.org`** — that is the
invariant the CSV migration exists to guarantee.

## Deliberate design choices

**Serial, one worker.** The cases measure wall-clock timing and byte counts. Two
parallel workers would contend for the same CPU and network emulation and make
every figure meaningless.

**Long tasks are reported, not asserted.** Case b attaches the count and total to
the test result. Measured on this machine: **149 long tasks, 14,104 ms total,
658 ms max** during a coarse-pointer / Fast 4G / 4× CPU idle boot. A 6.45 MB wasm boot on a 4×-throttled mobile device *will*
produce long tasks; whether that is acceptable is a product decision, not a
correctness gate. Asserting a number there would encode a guess.

**Case h measures DOM mutations, not store writes.** Counting subscriber
callbacks would need production code to expose an instrumentation hook. Mutations
are an *upper bound*: every write that reaches React may produce one, but many do
not. If the bound is under 12/s the throttle is provably working.

**Stall is simulated by never settling a route.** `route.fulfill` with a partial
body produces a parse error, not a stall. A route that never resolves leaves the
fetch genuinely pending and no progress events arrive — which is exactly what
`STALL_MS` is meant to catch.

## Known constraints

- Case d needs up to 400 s (auto abort, then a full user-mode boot at 400 kbps).
- The suite needs network access for the DuckDB wasm (jsDelivr / unpkg).
- `reuseExistingServer` is on locally, so a running `brotli-server` on port 4197 is
  reused; CI always starts a fresh one.
- Failure screenshots and traces land in `.cache/` (gitignored) and are never
  committed.
