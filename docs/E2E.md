# End-to-end acceptance suite

Playwright specs that encode the lazy-boot acceptance criteria (2B, cases a–i) as
executable checks.

These are **not** part of `pnpm test`. That gate stays fast, offline and
browser-free; this suite needs a browser, a built `dist/`, and the DuckDB wasm
from a CDN.

```bash
pnpm build      # the suite serves dist/, so build first
pnpm e2e        # all cases — measured 5.0 min wall clock on this machine
pnpm e2e:report # open the HTML report from the last run
```

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
├── boot.spec.ts         cases a-i
├── fixtures.ts          connection/pointer overrides, CDP throttling, byte ledger
├── brotli-server.mjs    Pages-like static server (Brotli + ETag/304)
└── globals.d.ts         window.__LT / window.__MUT for page-side observers
playwright.config.ts     serial, 400 s timeout, boots the server via webServer
```

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
