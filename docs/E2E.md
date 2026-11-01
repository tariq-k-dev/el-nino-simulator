# End-to-end acceptance suite

Playwright specs that encode the lazy-boot acceptance criteria (2B, cases a–i) as
executable checks.

These are **not** part of `pnpm test`. That gate stays fast, offline and
browser-free; this suite needs a browser, a built `dist/`, and the DuckDB wasm
from a CDN.

```bash
pnpm e2e         # BATCHED: one Playwright process per spec file (see below)
pnpm e2e:raw     # single process, for a targeted run: pnpm e2e:raw -- --grep globe
pnpm e2e:report  # open the HTML report from the last run

pnpm build:e2e   # REQUIRED for the look specs: they need the VITE_E2E hooks
pnpm e2e:look    # builds, then look specs + negative tests + the five globe zoom cases
```

### Two bundles, two directories

`pnpm build` writes the PRODUCTION bundle to `dist/`. `pnpm build:e2e` writes the INSTRUMENTED
bundle to **`dist-e2e/`**, and that is what Playwright serves.

This matters because both used to write `dist/`: the gate's own `pnpm build` replaced the
instrumented bundle, and `tests/e2e/global-setup.ts` then refused the next run with
`STALE E2E BUNDLE ... dist/ was replaced since the build`. The guard was firing on the normal
workflow, which teaches people to ignore guards. Now:

| command | writes | serves |
|---|---|---|
| `pnpm build` | `dist/` | nothing (deploy artefact) |
| `pnpm build:e2e` | `dist-e2e/` | Playwright, port from `E2E_PORT` (default 4197) |
| `pnpm e2e:look` | runs `build:e2e` first | as above |

### The batched runner (`pnpm e2e`)

`scripts/e2e-batched.mjs` runs ONE Playwright process per spec file, sequentially. Reasons,
all measured rather than theoretical:

1. **The single-process full run crashed.** `browserContext.newPage: Target crashed`,
   `worker process exited unexpectedly (code=3221225794)` — 0xC0000142 is a DLL init failure.
   Chromium exhausts itself after a long serial run under SwiftShader (`workers: 1`, dozens of
   1280×800 captures). Splitting per file gives each one a fresh browser and a fresh server.
2. **Per-file ports.** `playwright.config.ts` reads `E2E_PORT`; the runner allocates a distinct
   port per file, so a listener that has not released between files cannot answer the next file's
   requests. That is how `ERR_CONNECTION_REFUSED` appeared mid-run in an earlier attempt.
3. **Per-file artifacts directory,** because Playwright deletes `outputDir` at startup — with a
   shared one, file N+1 wiped file N's trace mid-teardown and produced
   `browserContext.close: ENOENT ... traces/<id>.trace`.
4. **Traces are OFF in the batched runner** (`--trace=off`). The config's
   `trace: 'retain-on-failure'` regularly lost the finalise race on this machine and the resulting
   `ENOENT` was reported as the TEST's failure — 3.2 "failed" that way while passing on its own
   minutes earlier. Teardown must never decide a result. `e2e:raw` keeps traces.
5. **Retry once, only on a worker crash.** `scripts/lib/e2e-batch-core.mjs` holds the decision and
   is unit-tested: crash code retries, **assertion failures never retry** (a retried red test turns
   a broken product green in the summary), a second crash fails.
6. **Cleanup between files, never during one.** After each file the runner kills the process TREE it
   started (`taskkill /PID <pid> /T /F`), waits for it to disappear, and removes orphaned
   `ms-playwright` browsers only — the user's own Chrome is never matched.

Measured on this machine (SwiftShader, 1280×800):

| file | wall |
|---|---:|
| `boot.spec.ts` (400 kbps case dominates) | 6.3 min |
| `look.spec.ts` (10 tests) | 2.6 min |
| `negative.spec.ts` (9 tests) | 2.1 min |
| `negative.spec.ts` (9 tests) | 2.1 min |
| `globe.spec.ts` (5 tests) | 0.9–2.2 min |
| `harden.spec.ts` | 2.9 min |
| `limb.spec.ts` | 0.7 min |
| `determinism.spec.ts`, `gate-clock.spec.ts`, `history-gate.spec.ts`, `scene-gate.spec.ts` | 0.3–1.1 min each |

### Test counts are guarded

`tests/e2e/suiteInventory.test.ts` holds the 23 expected titles of the three look files and fails when
one is removed or renamed without updating the constant. Additions are allowed. This exists because a
report once said "22" where the suite had 23 — nothing had been lost, but a suite that cannot state its
own size is one rename away from silently testing less than it claims.

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

### Runner invariants (C1-C3), verified

| | invariant | how it is enforced |
|---|---|---|
| **C1** | The runner owns the server lifecycle | `startServer()` spawns `tests/e2e/brotli-server.mjs dist-e2e <port>` directly from the runner, so the server is a **sibling** of the Playwright process, never a descendant. Playwright is told to stand down via `E2E_EXTERNAL_SERVER=1` in `playwright.config.ts`. Each file's server is torn down in the same `close` handler that ends the file. |
| **C2** | `killTree` targets only the spawned Playwright pid | `validateKillTarget()` in `scripts/lib/e2e-batch-core.mjs` refuses the runner's own pid, the server's pid, pid 0, non-integers, and any pid that is not the one this run spawned. A refusal is logged. Unit-tested. |
| **C3** | Per-file timeouts are a backstop | `FILE_TIMEOUTS_MS` with >= 1.5x margin on measured durations, overridable by `E2E_FILE_TIMEOUT_MS_OVERRIDE` for testing. A timeout kills only that file's tree, marks it **TIMEOUT**, tears down its server, and the next file gets a fresh server on a fresh port. |

### Timeout table (measured -> budget)

| file | measured | budget |
|---|---:|---:|
| look.spec.ts | 10.0 min raw / 320-324 s batched | 15 min |
| negative.spec.ts | 4.7 min raw / 192 s batched | 8 min |
| boot.spec.ts | 403-406 s | 10 min |
| camera-golden.spec.ts | 125.3-129.0 s | 6 min |
| frame-director.spec.ts | 41.8 s | 6 min |
| focus-ux.spec.ts | 5.9-6.3 min (22 cases) | 13 min |
| harden.spec.ts | 110 s | 4 min |
| globe.spec.ts | 54-61 s | 3 min |
| gate-clock.spec.ts | 52 s | 2 min |
| determinism, history-gate, limb, scene-gate | 12-17 s | 2 min each |

### Expected counts

`look.spec.ts` **9**, `negative.spec.ts` **14**, `globe.spec.ts` **5** = **28** for `e2e:look`.
Full suite: boot 10, **camera-golden 9**, determinism 2, **focus-ux 22**, **frame 20**,
**frame-director 5**, gate-clock 1, globe 5, harden 8, history-gate 1, limb 2, look 9, negative 14,
**ref 2**, scene-gate 2 = **112**
(was 76 at the close of Step 3A2; Step 3B added `camera-golden.spec.ts` **9** and
`frame-director.spec.ts` **5** = 90; Step 3B2 added `focus-ux.spec.ts` **22** = 112). The 74 recorded in an earlier revision omitted `ref.spec.ts`'s two
tests from the sum while the runner itself reported 76, which is how the arithmetic drifted from the
table it was describing.
The runner's `expectedCounts()` holds these and the summary fails on any mismatch, so a file that
exits 0 having run fewer tests still fails the run. `frame.spec.ts` also carries a 5 min per-file
backstop (2x its measured 125 s, rounded up).

### Step 3B2: the live focus policy, the two waivers, and what they cost

**What changed in the product.** In LIVE mode, selecting a region no longer aims the camera at the pin.
It ORBITS the camera to the pin's own normal, at a distance it does not touch: `controls.target` stays at
the origin, so the globe stays centred on the free rect and the pin lands on the free-rect centre by
construction. LOCKED mode keeps the legacy aim-at-pin fly-to, moved verbatim into `runLockedFlyTo`.

**What changed in the specs: exactly two files, under two named waivers.**

| waiver | file | what changed | diff |
|---|---|---|---|
| **W1** | `tests/e2e/frame.spec.ts` F8 | `expect(aimMoved).toBeGreaterThan(0.1)` + its comment -> `expect(aimMoved).toBeLessThanOrEqual(1e-6)` | **3 added, 3 removed** |
| **W2** | `tests/e2e/camera-golden.spec.ts` | `flyTo()`'s start signal and the target assertion made mode-aware | 69 added, 18 removed |

Neither waiver touches a threshold, a window, a timeout or a test count: `frame.spec.ts` is still 20 and
`camera-golden.spec.ts` still 9.

**Why W1 was necessary.** F8's `aimMoved` certified the behaviour this step removes. Under face-pin
`|controls.target|` is exactly `0.000` R, so the assertion was a hard red. It is replaced by the
guarantee that replaces it — face-pin keeps the target at the origin — and the same case's two `aim`
oracle assertions (`:643-644`, the projection of the target onto the free centre) still pass unchanged,
which is why the oracle itself did not have to move.

**Why W2 was necessary, and why it was not in the first waiver.** `camera-golden.spec.ts` used
`|__globe.target()| > 0.02` as its "the selection was received" signal in `flyTo()`, the helper behind all
nine cases, and asserted the fixture's target at `1e-5` R. Under face-pin the target is `(0,0,0)` for the
whole arc, so the poll could never become true (15 s timeout) and the target error would have been
`0.999` R. Because `flyTo()` is also what `UPDATE_GOLDEN=1` runs, the live golden entries could not be
regenerated at all — the failure was in the procedure, not just in an assertion. Hence the second waiver:

- **start signal**, live: `__frame.focus !== 'idle'` (the machine's own "a flight was accepted");
  locked: the original `|target| > 0.02`, verbatim;
- **target assertion**, live: `|controls.target| <= 1e-6` and the fixture's `target` excluded from the
  comparison; locked: the original `<= 1e-5` comparison, verbatim.

The live golden entries were then regenerated with `UPDATE_GOLDEN=1`. The **locked** entries are
byte-identical in every asserted field (position, target, quaternion, distance); only `flyMs`, which is
recorded and never asserted, differs between captures.

**What the live golden entries now say** (1440x900, after the fly-to settles): `target = (0,0,0)` and
`distance = 4.35719` for all four regions, i.e. `d_fit` of the OPEN rect — the fit's distance channel, not
the pin's legacy `zoom` of 2.6-2.9.

**`focus-ux.spec.ts` is 22 cases** (U1 x4 viewports, U2 x3 + the 1024x768 centring-only branch, U3 x2,
U4, S8(a), S8(b), U5 x3 close paths, U6, U7 x2 timings, U8, U9, U10). Expected total is now **112**.

Two measurement facts worth carrying forward, both of which cost a failed run to learn:

1. **The Impact Zones cards are occluded once the drawer is open.** The drawer is a 418 px `z-30` panel
   over a `z-20` card list, so a real mouse click at a card's own centre lands on the drawer — measured:
   `document.elementFromPoint` at the card centre returns a `DIV` inside the drawer, and the state stayed
   on the previous region. A retarget therefore has to be driven by the keyboard (focus + Enter on the
   same `<button>`) or by clicking a PIN, which is what `selectRegion()` and U9 do.
2. **A `page.evaluate` round trip is 100-300 ms, not a frame.** Measuring "the first pose after the click"
   from Playwright put it 44 deg away — 38 % of a 116 deg arc, i.e. ~18 frames. Any per-frame claim
   (U4, S8(a), S8(b), U7) has to be sampled in-page at rAF resolution; the specs stamp `regionId` and
   `focus` into the trace so the moment of the click can be located in it. With that, U7's first frame
   measures exactly **26.4 %** of the remaining arc in both runs — the theoretical cap
   `1 - 0.0001^(1/30)` — and S8(b)'s span is **0.0e+0**.

### The launch and poll method that works on this machine

```js
subprocess.Popen(["node","scripts/e2e-batched.mjs"], stdout=fh, stderr=subprocess.STDOUT)
```
then poll in cells of **under 300 s**. Anything longer kills the kernel and takes the child tree with it,
which reads as a product failure. Do **not** use a shell `>` redirect inside a tracked background wrapper:
it produces a 19-byte `stdin is not a tty` log and the command never runs.

### Known cost of the 12-az 3.4 test

`3.4 terminator: every evaluated azimuth` takes **3.3 min** inside the file (6.4 min when the whole file
runs alone), because each of the 7 evaluated azimuths needs a real capture, a flat capture, and — at
present — a **page reload** to restore the surface. That is 7 reloads. `look.spec.ts` therefore carries a
600 s budget of its own rather than the suite's 240 s.

### Verified runs

| run | result | wall |
|---|---|---|
| `e2e:look` (batched) | **3/3 files, 28/28 tests, 0 retries** | 9.4 min |
| full `pnpm e2e` (batched) | **10/10 files, 54/54 tests, 0 retries** | 20.0 min |

## Framing modes (Step 3A2) — locked and live

`tests/e2e/frame.spec.ts` drives the globe framing, and the framing is **opt-in** in the E2E build so
that every legacy spec keeps measuring the picture it has always measured.

| build | URL | mode | camera |
|---|---|---|---|
| production | anything | **live** | view offset + fit distance |
| `pnpm build:e2e` | no `framing` param | **locked** | untouched — identical to pre-3A2 |
| `pnpm build:e2e` | `?framing=live` | **live** | view offset + fit distance |

Locked is the default because the alternative inverts the risk: a spec that forgets a parameter would
silently measure a different framing and blame the look. `resolveFramingMode` fails closed on
anything that is not exactly `framing=live` (unit-tested in `src/layout/framing.test.ts`).

**What locked guarantees**, and how it is proved:

| guarantee | proof |
|---|---|
| no view offset, `camera.view` null | F1 asserts `mode === 'locked'`, `cameraViewIsNull`, and projection-matrix element `[8]` (the x-shear a view offset writes) is 0 |
| the distance never moves | F1 asserts `__globe.distance() === 3.3534`; `globe.spec.ts` 5/5 green |
| pixels are byte-identical | `ref.spec.ts` residual **exactly 0**, PNG sha256 unchanged, in two separate runner processes |
| the locked branch is not in the production bundle | `grep` for `frame-locked-branch-7f3a` in `dist/assets/*.js`: **0 hits** in `dist/`, exactly **1** in `dist-e2e/` |

Two frames specs need `?debug` as well as `framing=live`, because `__globe` and `__frame` are both
installed under `VITE_E2E === '1' && ?debug`. That build-gate/probe-gate mismatch is pre-existing and
deliberately **not** fixed here — it is recorded in `docs/STEP3-FRAME.md` §5.

**The one case that is not `framing=live`** is F1, whose subject is the locked default.

### Golden camera poses (`camera-golden.spec.ts`, Step 3B)

Eight recorded cases — four regions x (locked 1280x800, live 1440x900) — plus one comparison test.
Camera position, quaternion, `controls.target` and distance are asserted against
`tests/e2e/golden/camera-poses.json` within **1e-5 R**; `flyMs` is recorded but not asserted.

**The spin must be pinned or the poses are not reproducible.** Measured without `setSpin(true, 0)`:
`controls.target` differed by up to **8.36e-3 R** between loads, which would force a tolerance of
0.084 R and make the comparison meaningless. With it, three separate processes agreed to **5.55e-17**.

```bash
UPDATE_GOLDEN=1 pnpm e2e:raw -- tests/e2e/camera-golden.spec.ts   # writes the fixture
pnpm e2e:raw -- tests/e2e/camera-golden.spec.ts                   # verifies it
```

Regenerate **only before** a refactor. Full detail: `docs/STEP3B-GOLDEN.md`.

### Director behaviours (`frame-director.spec.ts`, Step 3B)

Five cases covering what is NEW rather than what is unchanged: a wheel sets `userZoomed` and leaves the
machine `idle`; a resize afterwards does not move the distance; selecting reaches `focused` and the
state is readable through `__frame.focus`; closing passes through `returning` to `idle` with the target
back at the origin; a drag during `focusing` ends in `focused` (the fly-to is cancelled, not fought).

### The reference frame (`ref.spec.ts`)

`tests/e2e/ref.spec.ts` is the **strict-0** gate: it re-captures the reference pose and compares the
result to the committed PNG at `tests/e2e/ref/default-1280x800.png` with exact equality — max
|dLuma| 0, 0 differing pixels, and every R/G/B channel identical. There is no tolerance.

| | |
|---|---|
| part of | **full `pnpm e2e` only** — `e2e:look` stays 28 tests |
| tests | 2 (in-page determinism, then the committed-frame comparison) |
| measured | 12.2–13.2 s per file through the batched runner; 17.1 s as a raw single process |
| backstop | `FILE_TIMEOUTS_MS['ref.spec.ts'] = 1 min` (2x the measured 17.1 s, rounded up) |

**Regenerating it:**

```bash
UPDATE_REF=1 pnpm e2e:raw -- tests/e2e/ref.spec.ts   # writes the PNG
pnpm e2e:raw -- tests/e2e/ref.spec.ts                # verifies it
```

Review the PNG diff **visually** before committing a regenerated file — a green run only says the new
file matches the new render, not that the new render is right. The default run never writes, and a
`UPDATE_REF=1` run does not certify itself: generation and verification are separate processes by
design, which is also why B3.4 verified in three of them.

**The PNG is SwiftShader-specific.** It was rendered under `--use-gl=swiftshader
--enable-unsafe-swiftshader --ignore-gpu-blocklist`, the same flags `playwright.config.ts` passes. A
different GPU stack will produce different shaded pixels and the comparison will fail — regenerate on
the machine you intend to certify, do not "fix" it by adding a tolerance.

**Size note:** 735.2 KB of a Tariq-approved 800 KB budget. The crop removes the cheap sky, so every
lossless pngjs setting lands at 545–680 KB; the budget was raised rather than shrinking the crop or
going lossy.

**Known open question:** the cross-load control pair flipped by 0.7152 luma over 213–221 px inside the
real `negative.spec` process (twice), and no D8 arm reproduced it. See
`docs/globe-look/SPEC.md` §5.5 and `docs/STEP3-DIAG.md`. It is not covered by this spec's result.

## Known load-sensitive test (Step 3A waiver)

`tests/e2e/globe.spec.ts:305` — **"zoom still works after a region fly-to"**, assertion at
`globe.spec.ts:345`.

| | |
|---|---|
| assertion | `after > before + 0.02` |
| measured on failure | **3.3779 → 3.3665** (needed > **3.397931150930327**) |
| wheel sequence | 6 × `mouse.wheel(0, 120)` at 80 ms intervals (`:335-336`) |
| settle before measuring | **500 ms** (`:338`) |
| where it failed | once, in a **20.3 min** full batched run, near the end of the run |
| load at the time | Hermes **564** and **274**, python **222** CPU-seconds; zero retries |
| isolation rerun | **5/5 passed, 52.3 s**, same bundle `srcHash 8917ea9a14ab` |

**The cause is UNEXPLAINED and is accepted as a waiver by Tariq's decision.** It was **not**
attributed by ablation — the `data-occluder` markup was deliberately not ablated, so nothing here
should be read as clearing it. What supports the waiver instead is the layout evidence: the C.5 probe
compared `getBoundingClientRect` for all 15 panel/viewport combinations (canvas, header, deck, cards,
drawer at 1440x900, 1280x720 and 1920x1080) before and after the markers were added and found them
**identical**, so the markers do not move anything.

**Rule from Step 3A2 on:** any failure of this test — in a full run *or* in isolation — is treated as
a **real regression**, because Step 3A2 changes camera and zoom behaviour. The waiver applies only to
this one occurrence against a bundle that predates those changes.

**Operating advice:** close heavy background apps (JetBrains indexers, extra Chrome profiles, Python
jobs) before a full `pnpm e2e`. The run that failed took 20.3 min; the same suite on a quiet machine
was ~10 min, and this test measures a time-based settle, not a state.
