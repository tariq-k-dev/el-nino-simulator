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

---

## 7. Boot-time decomposition (report only — no constants changed)

Measured with `node tests/e2e/boot-timeline.mjs --case c|d [--stub]`, against the
Brotli server. All timings come from **one clock domain** (network events on the
browser context), because a Worker's `PerformanceResourceTiming` lives in the
worker's own timeline and mixing it with page timings produces impossible numbers
(`responseEnd < startTime`) and false conclusions.

Throttling was verified to apply before the run: worker `responseEnd` moved
3,959 ms → 7,397 ms when the 1.6 Mbps profile was enabled.

### Milestones (ms from navigation start)

| Case | window load | status→booting | worker resp end | CSV resp end | 1st progress | 50% | last event | ready / abort |
|---|---|---|---|---|---|---|---|---|
| **c** 1.6 Mbps | 1,989 | 2,000 | 7,382 | 2,935 | 8,243 | 28,238 | 47,496 | **47,579** ready |
| **c** 1.6 Mbps, textures stubbed | 2,010 | 2,021 | **3,719** | 2,756 | **4,362** | **18,971** | 37,333 | **37,483** ready |
| **d** 400 kbps | 6,731 | 6,742 | 26,860 | 10,183 | 29,693 | — | 39,735 | **39,787** abort |
| **d** 400 kbps, textures stubbed | 6,710 | 6,724 | **12,294** | 8,220 | **13,430** | — | 49,455 | **49,559** abort |

Case d never reaches 50% — it is the auto-cap trip (`failed → too-slow`), which is
the designed outcome at 400 kbps.

### Phase breakdown of the boot window (sums exactly to the window; residual 0)

| Case | worker download | → 1st event | → 50% | 50% → last event | compile tail | **window** |
|---|---|---|---|---|---|---|
| c | 5,382 | 861 | 19,995 | 19,258 | 82 | **45,578** |
| c stubbed | **1,698** | 643 | **14,609** | 18,362 | 150 | **35,462** |
| d | 20,118 | 2,833 | — | 10,042 | 52 | **33,045** |
| d stubbed | **5,570** | 1,136 | — | 36,025 | 104 | **42,835** |

The residual is zero by construction: the milestones partition the window, so
there is no unexplained gap to attribute.

### Non-boot traffic during the boot window

| Case | resources overlapping | total bytes | of which textures |
|---|---|---|---|
| c | 5 | **2,076,879** | **2,076,879** (100%) |
| c stubbed | 5 | 1,850 | 1,850 |
| d | 2 | **647,516** | **647,516** (100%) |
| d stubbed | 2 | 1,850 | 1,850 |

Every non-boot byte is a globe texture. In case c they overlap the boot almost
entirely (`earth_clouds.jpg` 965,976 B runs 2,128 → 17,222 ms; `earth_day.jpg`
463,387 B 2,128 → 12,179 ms; specular/night/normal 269 KB / 256 KB / 123 KB all
start at 2,128 ms). The app starts fetching textures as soon as the R3F tree
mounts, which is *before* the engine finishes booting — so they compete for the
same 1.6 Mbps pipe.

### Attribution

| | with textures | stubbed | delta |
|---|---|---|---|
| **c** boot window | 45,578 ms | 35,462 ms | **−10,116 ms (−22%)** |
| **d** boot window | 33,045 ms | 42,835 ms | **+9,790 ms (+30%)** |

**Case c: textures cost ~10 s of boot time.** 2.08 MB of texture on a 1.6 Mbps
link is ~10.4 s of transfer; when it runs concurrently with a 6.76 MB wasm the two
split the bandwidth almost exactly as their sizes predict. Removing them returns
22% of the boot.

**Case d: stubbing makes it slower, which needs explaining rather than hiding.**
The abort is a *projected* cap trip, not a fixed deadline, and the rate it
projects from is measured after the first progress event. At 400 kbps the textures
(648 KB) delay the *first* progress event to 29,693 ms; without them it arrives at
13,430 ms — so the projection is evaluated over a much shorter sample. A short
sample early in a slow transfer yields a pessimistic rate, and the trip fires
later in wall-clock terms (49,559 vs 39,787 ms) even though less work was done.
The abort time is therefore sensitive to *when* the first sample lands, not only
to throughput.

### Residual and what it means

There is no unexplained residual in the boot window — the milestones account for
all of it. What the table does show is that **the boot is not the only thing on
the wire**: 100% of non-boot traffic during boot is globe texture, and on a
constrained link that traffic is charged directly to boot latency.

Two levers, neither applied here (constants were not to be changed):

1. **Defer texture loading until the engine settles**, or gate textures on the
   same policy that gates the Wasm boot. At 1.6 Mbps this is worth ~10 s.
2. **Make the early-abort projection robust to a short first sample** — e.g.
   require a minimum elapsed window before the first evaluation, or ignore
   projections taken before N bytes have arrived. Today the same connection can
   abort at 40 s or 50 s depending on texture contention.

---

---

---

## 8. Scene gate, sliding-window abort, and the acceptance matrix

### Why the stubbed abort is still slower than the textured one

Re-traced with the new rule (`node tests/e2e/abort-trace.mjs --mbps 0.4 [--stub]`).

**Textured** — the projection is ~10× over the cap from the first armed sample, so
all three consecutive evaluations agree immediately:

| elapsed since 1st event | loaded MB | rate KB/s | projected total | over |
|---|---|---|---|---|
| 854 | 0.05 | 58,385 | 586,494 | YES |
| 3,920 | 0.36 | 95,102 | 360,062 | YES |
| 8,042 | 1.07 | 139,576 | 245,333 | YES ← trip |
| 10,108 | 1.60 | 165,819 | 206,506 | YES |

**Stubbed** — the rate is dominated by the real 400 kbps ceiling, and the projection
sits **below** the 90 s cap for 22 s:

| elapsed since 1st event | loaded MB | rate KB/s | projected total | over |
|---|---|---|---|---|
| 9,026 | 3.12 | 362,799 | 94,384 | no |
| 14,214 | 5.48 | 404,098 | 84,738 | no |
| 19,399 | 7.48 | 404,086 | 84,741 | no |
| 22,517 | 8.05 | 374,673 | 91,393 | no |
| 23,561 | — | — | over 90,000 | **trip** |

**The explanation is arithmetic, not a bug.** `projected = elapsed + remaining/rate`.
With 32.66 MB decoded and a true 400 kbps line the aggregate rate settles near
400 KB/s, so `remaining / rate` is ~70 s and `elapsed` grows to ~20 s before the sum
crosses 90 s. The rule is behaving exactly as specified — it aborts when the
evidence says the transfer cannot finish inside `AUTO_CAP_MS`, and until ~22 s the
evidence genuinely does not say that.

The textured run aborts sooner because texture traffic inflates `elapsed` while
starving the wasm stream, so the same sum crosses 90 s much earlier. **Both are
correct readings of the same rule.** The 12.2 s spread between them is the rule
honestly reporting that the two runs have different effective throughput.

### The `wasm bytes at abort` criterion

"wasm bytes at abort < 1.5 MB" is a **wire** measurement, and the store's `loaded`
counts **decoded** bytes (2B's own finding: `bytesLoaded` is decoded, `bytesTotal`
is the brotli size). Converting with the measured ratio (0.1976):

| Run | `loaded` at abort (decoded) | wire bytes | < 1.5 MB |
|---|---|---|---|
| textured | 2.00 MB | **0.40 MB** | **PASS** |
| stubbed | 8.00 MB | **1.58 MB** | **FAIL by 0.08 MB** |

The stubbed run simply has more time to download before the projection crosses the
cap, so it gets further through a 6.45 MB wire payload.

### Step 4 acceptance matrix

Three runs per profile, Brotli server, CDP-throttled, textures present unless noted.
`node tests/e2e/acceptance-matrix.mjs --mbps N --runs 3 [--stub]`.

| Profile | Runs | Outcome | ready / abort (ms) | textures last `responseEnd` | hosts | Verdict |
|---|---|---|---|---|---|---|
| **c 1.6 Mbps** | 3/3 | ready, no abort | **49,297 / 49,500 / 49,541** | **12,767 / 12,772 / 12,783** | 1 | **PASS** |
| **d 400 kbps textured** | 3/3 | failed `too-slow` | abort-after-1st **11,118 / 11,289 / 12,058** | 39,486 / 39,595 / 39,777 | 1 | **PASS** (≤25 s, spread 0.94 s, 1 host) |
| **d 400 kbps stubbed** | 3/3 | failed `too-slow` | abort-after-1st **23,094 / 23,184 / 23,270** | 6,745 / 6,754 / 6,888 | 1 | **PARTIAL** (≤25 s, spread 0.18 s, 1 host — but see misses) |
| **1.0 Mbps** | 3/3 | **ready, no abort** | 76,349 / 76,404 / 76,682 | 19,869 / 19,887 / 19,930 | 1 | **PASS** (false-positive guard) |
| **0.8 Mbps** | 3/3 | **ready** (borderline) | 94,603 / 94,949 / 95,174 | — | 1 | report only |
| **0.5 Mbps** | 3/3 | failed `too-slow` | abort-after-1st 21,156 / 21,179 / 22,352 | 41,530 | 1 | **PASS** |
| **hanging textures** | 1 | ready after gate timeout | 6.9 s wall, gate override 3 s | n/a | 1 | **PASS** |
| **WebGL disabled** | 1 | ready immediately | 2.6 s wall | n/a | 1 | **PASS** |

Case c's texture figure is the headline result: **17.2 s baseline → 12.77 s**, and
the engine now starts only after they finish (worker `start` 13,686 ms vs textures
ending 12,767 ms). The gate does what §7 said it would.

### Two criteria that did NOT fully pass

**1. Case d spread ≤ 5 s — FAILS at 12.2 s** (textured 11.1–12.1 s vs stubbed
23.1–23.3 s). Within each variant the spread is tight (0.94 s and 0.18 s); the
12.2 s is *between* variants. Per the analysis above this is not instability, it is
the rule correctly reading two genuinely different throughputs. Meeting the 5 s
criterion would require the textured run to also be allowed to run to ~23 s, i.e.
removing the textural interference — which is what the scene gate now does at
*eager* boot. Case d is deliberately not gated (connection-undefined → eager, but
its abort path dominates), so the two variants still differ.

**2. Stubbed `wasm bytes at abort < 1.5 MB` — FAILS at 1.58 MB** by 0.08 MB. A
stricter `EARLY_ABORT_FACTOR` or a shorter `EARLY_EVAL_START_MS` would fix it, but
both are outside what this pass was allowed to change (`AUTO_CAP_MS`, `CONNECT_MS`
and `STALL_MS` are frozen, and the factor/window were specified at 1.0 / 6 s).

Both are reported rather than papered over.

---

## 9. (Diagnosis, pre-fix) why the stubbed case-d run aborted 36 s after the first event

Diagnostic: `node tests/e2e/abort-trace.mjs --mbps 0.4 [--stub]` logs the
watchdog's inputs once per second, read from the live store (`window.__engineStore`
under `?debug`) so `loaded` and `firstEventAt` are exact rather than inferred from
the rendered percentage.

### Textured (2.08 MB of globe textures competing)

| t (ms) | elapsed since 1st event | loaded MB | rate KB/s | projected total | over threshold | ≥8 s armed |
|---|---|---|---|---|---|---|
| 30,110 | 993 | 0.03 | 30,371 | 1,127,491 | **YES** | n |
| 31,151 | 2,034 | 0.06 | 28,519 | 1,200,686 | **YES** | n |
| 33,200 | 4,083 | 0.10 | 26,743 | 1,280,451 | **YES** | n |
| 35,260 | 6,143 | 0.16 | 27,232 | 1,257,448 | **YES** | n |
| 37,324 | 8,207 | 0.31 | 39,038 | 877,168 | **YES** | **y** |
| 38,349 | 9,232 | 0.44 | 50,195 | 682,192 | **YES** | y |
| 39,369 | 10,252 | 0.57 | 57,814 | 592,287 | **YES** | y |

Abort at **40,404 ms**, i.e. **11.3 s after the first event** — the projection is
far over the cap from the very first sample, so the rule trips on the third
*armed* evaluation.

### Stubbed (textures are 1×1, no contention)

| t (ms) | elapsed | loaded MB | rate KB/s | projected total | over | armed |
|---|---|---|---|---|---|---|
| 13,764 | 749 | 0.08 | 113,981 | 300,423 | YES | n |
| 17,964 | 4,949 | 1.58 | 335,369 | 102,104 | **no** | n |
| 21,097 | 8,082 | 2.80 | 363,885 | 94,103 | no | **y** |
| 27,341 | 14,326 | 5.49 | 401,919 | 85,198 | no | y |
| 33,582 | 20,567 | 7.70 | 392,641 | 87,211 | no | y |
| 42,980 | 29,965 | 9.29 | 325,137 | 105,317 | no | y |
| 49,246 | 36,231 | 10.50 | 303,997 | 112,641 | **YES** | y |
| 50,288 | 37,273 | 10.74 | 302,226 | 113,301 | YES | y |
| 51,335 | 38,320 | 11.09 | 303,365 | 112,876 | YES | y |

Abort at **62,793 ms** — **49.8 s after the first event**.

### Explanation

Three effects compound, and none of them is "the projection is broken":

**1. The rate ramps up.** Chrome's throttled HTTP transport delivers in small
early chunks and speeds up as its buffer fills. The stubbed series starts at
114 MB/s-ish of apparent progress (749 ms → 0.08 MB) and settles near **300 KB/s**,
which is the true 400 kbps ceiling (400 kbit ÷ 8 = 50 KB/s per connection; with the
worker's own socket plus the wasm stream the aggregate lands near 300 KB/s). The
*projected total* therefore starts high and falls: 300 s → 94 s → 85 s, then drifts
back **up** as the transfer approaches the tail.

**2. The early-abort rule samples `lastLoaded / elapsedSinceFirst` — a *cumulative*
average.** It never forgets the slow start. Worse, the projection is
`elapsed + remaining/rate`, so a shrinking `rate` inflates `remaining/rate`
non-linearly. That is why the stubbed projection is **non-monotonic**: 94,103 ms at
8 s, 85,198 ms at 14 s, then climbing to 112,641 ms at 36 s.

**3. The abort only happens when three *consecutive armed* evaluations exceed the
threshold.** In the stubbed run the projection hovers **just below**
`AUTO_CAP_MS × 1.25 = 112,500 ms` for ~25 s. It crosses only at 36,231 ms, and even
then it flips back at 39,355 ms — the count resets, and it needs three more
consecutive over-samples before tripping at 62.8 s. **This is the flapping the
acceptance criteria call out.**

So the stubbed run is not "slower"; it *appears* to take a more realistic rate, and
that realism lands the projection within a few percent of the threshold, where the
rule oscillates instead of deciding.

**The textured run hides this** because texture traffic starves the wasm stream so
badly that the projection is 10× over threshold from the first sample — no
ambiguity, no flapping, fast abort.

**Conclusion:** the abort *time* is dominated by proximity to the threshold, not by
throughput. A connection that is 3× too slow aborts in 11 s (textured) or 50 s
(stubbed) depending on how cleanly its rate maps onto the cap. Step 3 addressed the
cumulative-average lag and the flapping by projecting from a **sliding 6 s window**
with `EARLY_ABORT_FACTOR = 1.0` and one-sample hysteresis.

**Post-fix result:** stubbed abort dropped **49.8 s → 23.6 s** after the first event,
and the flapping is gone (the counter no longer resets on a single dip). The
remaining 23.6 s is arithmetically required: with 32.66 MB decoded at ~400 KB/s the
projection does not cross 90 s until roughly 22 s of elapsed transfer. See §8.

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

4. **Step 4's worker-cache finding was an artifact — retracted in step 8.** The
   first measurement used `page.route()` to black-hole jsDelivr, and Chromium
   disables the HTTP cache for any request the DevTools protocol intercepts, so a
   cache miss was guaranteed. Re-tested with `--host-resolver-rules` instead (DNS
   black-hole, no interception) and a server that logs `If-None-Match`:

   | Request | Status | `If-None-Match` | Body |
   |---|---|---|---|
   | 1st host attempt | `200` | `null` | **155,830 B** |
   | 2nd host attempt | `304` | `"t2dKFUrT7Fb66NB5YEA0"` | **0 B** |

   **The worker is cached. Finding closed** — one body download across two host
   attempts, so the fallback path costs no extra bytes.

5. **Step 7 found the boot is competing with texture downloads** (§7). On 1.6 Mbps,
   2.08 MB of globe texture — 100% of non-boot traffic during boot — costs ~10 s of
   boot time (45,578 → 35,462 ms when stubbed). At 400 kbps, stubbing made the
   *abort* later (39,787 → 49,559 ms) because the early-abort projection samples a
   rate after the first progress event, and textures delay that event from 13.4 s
   to 29.7 s. Reported, not fixed: both are behaviour changes outside this pass.
