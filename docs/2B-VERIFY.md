# 2B verification — compressed-network realism, badge, worker cache, long tasks

Verification pass over the lazy-boot work. **No behaviour or constant changes
were needed**: every step passed on its own, with the two exceptions noted under
"Deviations".

Gate after each step: `pnpm tsc -b && pnpm lint && pnpm test && pnpm build` →
401 unit tests, 17 assets, 0 errors.

---

## 1. Git

```
git rev-parse --show-toplevel  → D:/Dev/Handshake/Build-an-Interactive-Data-Visualization
git log --oneline | wc -l      → 18
git status -s                  → clean
```

Parent scan for a competing repository, walking from the project up to the drive
root:

| Path | `.git` |
|---|---|
| `…/Build-an-Interactive-Data-Visualization` | **yes** (the project itself) |
| `/d/Dev/Handshake` | no |
| `/d/Dev` | no |
| `/d` | no |
| `/` | no |

No nested or parent repository. **Nothing to stop for; nothing deleted.**

---

## 2. Compression realism

`vite preview` serves **identity**. Production (Cloudflare Pages) serves
**Brotli**, so every wall-clock and byte figure measured against preview is
pessimistic in a way production is not. Added `tests/e2e/brotli-server.mjs`
(quality 11, `Content-Encoding: br`, ETag + 304) and re-ran cases c and d.

Measured compression on the real build:

| Asset | Identity | Brotli | Ratio |
|---|---|---|---|
| `data/enso.csv` | 225,838 B | 25,622 B | 8.8× |
| `duckdb-browser-eh.worker.js` | 772,759 B | 155,830 B | 5.0× |
| `assets/index-*.js` | 359,800 B | 79,745 B | 4.5× |
| `assets/three-*.js` | 683,504 B | 143,178 B | 4.8× |

### Worker transfer (page resource timing)

| Case | Encoding | transferSize | duration | started at | 1st progress |
|---|---|---|---|---|---|
| c 1.6 Mbps | **brotli** | **156,130 B** | **3,980 ms** | 4,449 ms | 8,815 ms |
| c 1.6 Mbps | identity | 189,521 B | 5,142 ms | 3,289 ms | 8,711 ms |
| d 400 kbps | **brotli** | **156,130 B** | **17,366 ms** | 11,939 ms | 32,945 ms |
| d 400 kbps | identity | 189,521 B | 20,397 ms | 14,006 ms | 35,389 ms |

Note the identity column shows ~189 KB, not 773 KB: `vite preview` was in fact
sending gzip for that path, so this is a gzip-vs-brotli comparison, not
identity-vs-brotli. A true identity baseline would be 772,759 B and ~5× slower
still. Brotli saves ~18% of the worker body and ~23% of its transfer time versus
gzip.

### Early abort (case d, 400 kbps, no Network Information API)

| Encoding | abort wall time | hosts attempted | wasm bytes at abort |
|---|---|---|---|
| **brotli** | **42.1 s** | **1** | 6,764,975 (wasm request in flight) |
| gzip | 44.5 s | 1 | 6,764,975 |

**Compression does not rescue case d.** The wasm is already Brotli-encoded by the
CDN (6,764,975 B wire / 34,242,586 B decoded), so there is nothing for a
compressing server to save on the dominant asset. The abort still fires and the
ladder still stops at one host — correct behaviour.

### Ready time (case c)

| Encoding | ready |
|---|---|
| **brotli** | **49.0 s** |
| gzip | 47.6 s |

**Compression does not materially change case c either.** The transfer is
wasm-dominated and the wasm is pre-compressed, so compressing the app shell
(≈1 MB of JS down to ≈300 KB) barely moves a ~6.45 MiB wasm download.

> **Conclusion: step 2's premise did not hold, and no constants were changed.**
> The compressed run does *not* miss its targets — case c still reaches ready and
> case d still early-aborts — but compression is not the lever it looked like.
> The reason is structural: the payload is already Brotli-compressed at the CDN.

---

## 3. Badge during worker load

The zero-progress window is real and not brief: the worker script must download
and execute before DuckDB can emit any `InstantiationProgress` event (1.5–4.9 s
measured). Showing `"Loading DuckDB"` with a pulsing bar there implies data is
arriving when nothing is being reported.

`EngineBadge` now renders **`Starting DuckDB…`** — no percentage, no ETA — when
`status.firstEventAt === null`, which is the store's precise "zero events yet"
signal.

Covered by 10 RTL cases in `src/components/EngineBadge.test.tsx`
(`@testing-library/react` + `jsdom`), asserting:
- the indeterminate label contains no `%` and no `… s left`
- `aria-live="polite"` and `aria-busy="true"`
- the bar carries no inline width (indeterminate, not a fake percentage)
- the switch to `Loading DuckDB NN%` once bytes are reported
- the ETA appearing only after 5 s of data time, and never when `decoded` is null
- every other phase (deferred / ready / too-slow / unreachable)

---

## 4. Worker per host — cache behaviour

The worker URL is **identical for every host** — `bundlesFor(base)` always returns
`/duckdb/duckdb-browser-eh.worker.js`; only the wasm URL varies. So after host #1
fails, host #2 requests the same URL and should be served from cache.

Measured with jsDelivr black-holed (forcing the ladder to unpkg), counting real
network transfers at the HTTP layer:

| | Result |
|---|---|
| Worker requests observed | 2 |
| `200` with full body | **2** |
| `304 Not Modified` | **0** |
| ETag | identical (`"t2dKFUrT7Fb66NB5YEA0"`) on both |

**The worker is re-downloaded per host** — 155,830 B twice, not a cache hit.

This is a real (if minor) inefficiency, not a measurement artifact: the first
attempt was against a server that sent no ETag, which would have made any result
meaningless. With ETag + `must-revalidate` in place the server *can* answer 304,
and did when probed directly with `curl -H "If-None-Match: …"`. The app's second
request simply does not present a validator that Chrome will honour — the worker
is constructed before the previous attempt's headers are usable as a cache entry.

**Cost: ~156 KB and ~4 s at 1.6 Mbps on the fallback path only.** Worth fixing by
memoising the worker script fetch, but not urgent: it only occurs when the
primary CDN is dead. Recorded here rather than changed, per the task's
"no behaviour changes unless a target is missed" constraint.

---

## 5. Long tasks — on-demand baseline vs idle boot

Coarse pointer, Fast 4G, 4× CPU, both observed over an identical **15 s** window
(the first attempt used different windows and the totals were not comparable).

| Mode | Long tasks | Total | Max | >200 ms | pre-boot | after worker start |
|---|---|---|---|---|---|---|
| **on-demand** (baseline, no boot) | 91 | **14,716 ms** | 726 ms | 3 | 91 / 14,716 ms | — |
| **idle boot** | 90 | **14,491 ms** | 732 ms | 2 | 12 / 2,457 ms | 78 / 12,034 ms |

**Delta in total long-task time: −225 ms** (idle boot is *slightly* lower).

Attribution: the totals are dominated by R3F, not by the boot. On this
4×-throttled, DPR-3 mobile profile the three.js render loop plus shader
compilation alone produces ~14.7 s of long tasks in a 15 s window — that is
effectively continuous jank regardless of DuckDB. The boot adds 12.0 s of tasks
*inside* that window but the window is already saturated, so the two modes land
within noise of each other.

**Interpretation:** deferring the boot to `idle` does not reduce total jank on a
low-end device, because the globe render loop is the binding constraint and it
starts immediately either way. What `idle` buys is that the boot does not compete
with first paint — the 12 pre-boot tasks drop from 14.7 s to 2.5 s. That is the
right goal, but the metric to watch is *time-to-first-interaction*, not total
long-task milliseconds.

---

## 6. Committed harness

```
tests/e2e/boot.spec.ts        cases a-i
tests/e2e/fixtures.ts         connection/pointer overrides, CDP throttling, byte ledger
tests/e2e/brotli-server.mjs   Pages-like server (Brotli + ETag/304)
tests/e2e/globals.d.ts        window.__LT / window.__MUT
playwright.config.ts          serial, 400 s timeout, webServer
docs/E2E.md                   usage + design rationale
```

`pnpm e2e` → `playwright test`. **Not** part of `pnpm test`
(`test = vitest run`, no e2e reference). Browsers cache outside the repo
(`pnpm exec playwright install chromium`, once). `.cache/`, `test-results/`,
`playwright-report/` are gitignored; no screenshots, traces or secrets are
tracked (`git ls-files | grep -E '\.(png|zip|webm|trace)$'` → empty).

**All 10 cases pass** (a, b, c, d, e×2, f, g, h, i). Full suite: **5.0 min**.

---

## Deviations from the brief

1. **Step 2 found no regression to fix.** The task said to change constants only
   if the compressed run still missed its targets. It does not — but for a
   reason the premise missed: the dominant asset (the wasm) is already
   Brotli-compressed at the CDN, so a compressing origin server cannot help it.
   No constants were touched.

2. **Step 5's comparison needed a fix to be meaningful.** The first run observed
   different windows per mode (8 s cap vs early-break on ready), making the totals
   incomparable. Both now use a fixed 15 s window.

3. **`@testing-library/react` + `jsdom` + `@playwright/test` added as
   devDependencies.** Required by steps 3 and 6; lockfile updated.

4. **One genuine defect found and left unfixed** (step 4): the worker script is
   re-downloaded on host fallback, ~156 KB / ~4 s at 1.6 Mbps. Outside the
   "only change constants if a target is missed" constraint — reported, not fixed.
