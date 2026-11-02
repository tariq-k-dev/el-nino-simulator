# NINO-UI-RECON — UI impact map, residual diagnostics, inert card display model

Repo: `D:\Dev\Handshake\Build-an-Interactive-Data-Visualization`
Base HEAD: `0686ad1c19a59ed50d2d680da9146eaceb641767`, `git status --porcelain` empty at start.
Part A is read-only. Diagnostics scripts live outside the repo in `D:\Dev\Handshake\_triage\`:
`nino-residuals.mjs` (A7), `nino-framing.mjs` (design memo).

---

## A1. Consumers of the region list

**The headline correction: `REGIONS` is not what the desktop card stack iterates.**

| consumer | file:line | iterates / indexes / looks up |
|---|---|---|
| Desktop cards — order | `src/components/RegionCards.tsx:13` | **neither** — hardcoded `ORDER: RegionId[] = ['pacific','us-west','se-asia','horn-africa']` |
| Desktop cards — count text | `RegionCards.tsx:34` | `{ORDER.length} active` — reads **`ORDER`**, not `REGIONS` |
| Desktop cards — body | `RegionCards.tsx:37-41` | iterates `ORDER`; `REGION_MAP[id]` by id (`:38`); `ICONS[id]` by id (`:39`) |
| Card icons | `RegionCards.tsx:6-11` | `Record<RegionId, typeof Waves>` — **exhaustive type**; a new `RegionId` is a tsc error here |
| Card headline | `RegionCards.tsx:41` → `src/lib/model.ts:175-189` | `switch (region)` — exhaustive; a new id is a tsc error |
| Drawer chips | `src/components/RegionDrawer.tsx:289` | iterates `REGIONS` |
| Pins (scene) | `src/scene/EarthSystem.tsx:62` | iterates `REGIONS` → one `<Hotspot>` each |
| Pin probe `__globe.pins()` | `src/scene/GlobeScene.tsx:307` | iterates `REGIONS`; `latLonToVector3(region.lat, region.lon, r)` |
| Pin probe `pinsWorld()` | `src/scene/GlobeScene.tsx:585` | iterates `REGIONS` |
| Legend chips | `src/scene/GlobeScene.tsx:839` | iterates `REGIONS` |
| Single pin | `src/scene/Hotspot.tsx:96,387,538` | one `region` prop; `name={"pin-hit-"+region.id}`; label `region.shortName` |
| **Fly-to camera target** | `src/scene/CameraDirector.tsx:134-138` | **lookup by id** — `REGION_MAP[id]` then `latLonToVector3(region.lat, region.lon, 1)` |
| **Fly-to distance** | `src/scene/CameraDirector.tsx:213-215` | **`want.zoom` — a scalar. There is no box or framing math in the fly-to at all.** |
| Live fly-to direction | `CameraDirector.tsx:301` | `regionDirection(region, spin)` → same `lat`/`lon` |
| Snapshot / report — focus line | `src/lib/report.ts:58` | `REGION_MAP[activeRegion]`, one lookup |
| Report metric table | `report.ts:29-42` | **hardcoded 10 rows** — does not touch `REGIONS` |
| Report prose | `report.ts:184-188` | hardcoded equation text |
| Mobile sheet chips | `src/mobile/SheetBody.tsx:158` | iterates `REGIONS`; `data-region-id={r.id}` (`:164`) |
| Mobile header | `src/mobile/HeaderCompact.tsx:465` | `export const HEADER_REGIONS = REGIONS` (alias, iterated downstream) |
| URL / deep link of region ids | — | **none.** Only `?framing=` (`src/layout/framing.ts:86`) and `?debug` (`src/main.tsx:23`, `GlobeScene.tsx:257`) |
| localStorage / sessionStorage | — | **none** (zero hits across `src/`) |
| Keyboard / focus order | — | no order constant; traversal is the DOM order of the three `map`s above |

**Consequence:** appending to `REGIONS` adds pins, legend chips, drawer chips and sheet chips — but **zero cards**, because the card stack reads `ORDER`. "Impact Zones · 4 active" would keep reading 4 while the scene gained two pins.

## A2. Count / order / golden assertions (whole repo)

Locked 15 (per prompt): boot, camera-golden, determinism, focus-ux, frame-director, frame, gate-clock, globe, harden, history-gate, limb, look, negative, ref, scene-gate.

| file:line | what it asserts | locked? |
|---|---|---|
| `src/lib/regions.test.ts:43` | `expect(REGIONS).toHaveLength(4)` | no (unit) |
| `src/lib/regions.test.ts:44` | exact id array `['pacific','us-west','se-asia','horn-africa']` | no |
| `src/lib/regions.test.ts:64` | exact `[lat, lon, zoom]` triples per region | no |
| `src/components/RegionDrawer.test.tsx:82` | `toHaveLength(REGIONS.length)` — **relative, survives growth** | no |
| `src/components/RegionDrawer.test.tsx:83-84` | chip ids = `REGIONS.map(id)`, labels = `shortName` — relative | no |
| `src/lib/model.test.ts:225-226` | unique `(lat,lon)` set size equals `REGIONS.length` | no |
| `src/lib/model.test.ts:165,171,227` | iterates `REGIONS` for headline/coords | no |
| `src/camera/facing.test.ts:37,49,65,131,295` | local 3–4 entry array, iterated | no |
| `src/lib/ninoRelation.test.ts:262` | `NINO_RELATIONS` has 4 entries — unrelated to regions | no |
| `tests/e2e/pin-click.spec.ts:49` | local `REGION_IDS` 4-array | no |
| **`tests/e2e/pin-click.spec.ts:830`** | `expect(summary).toHaveLength(4)` — **hard 4** | no |
| **`tests/e2e/pin-click.spec.ts:909`** | `expect(sizes).toHaveLength(4)` — **hard 4** | no |
| `tests/e2e/camera-golden.spec.ts:90` | local 4-array driving pose iteration | **camera-golden — YES** |
| `tests/e2e/golden/camera-poses.json:255,295,…` | 8 keys = 4 regions × 2 modes; **no pose exists for a new region** | **camera-golden — YES** |
| `tests/e2e/focus-ux.spec.ts:51` | 4-entry `{id, card}` list | **focus-ux — YES** |
| `tests/e2e/reset-ux.spec.ts:45` | 4-entry `{id, card}` list | no |
| `tests/e2e/switcher-ux.spec.ts:47` | 4-entry list; `:429` clicks horn-africa as POSITIVE CONTROL | no |
| `tests/e2e/mobile-sheet.spec.ts:1035` | loops hidden ids incl. all 4 region ids | no |
| `tests/e2e/mobile-sheet.spec.ts:1040` | reachable ids incl. `pacific`, `horn-africa` | no |
| **`tests/e2e/look/pinValidity.test.ts:114-115`** | `az 90 yields only horn-africa, az 270 only pacific` — **a new equatorial-Pacific pin breaks this outright** | **look folder — YES** |
| `tests/e2e/look/pinValidity.test.ts:26-30,47,74` | per-pin `facingDot` / `rOverR` tables incl. horn-africa, pacific | **look — YES** |
| `tests/e2e/negative.spec.ts:687` | `pins().map(...)` — snapshot of ALL pin x,y | **negative — YES** |

`toHaveLength(4)` appears **exactly twice** in `tests/e2e` (`pin-click:830,909`), both non-locked. The locked exposure is `camera-golden` (const array + golden JSON) and `look/pinValidity` (per-pin facing tables and the "only horn-africa / only pacific" azimuth assertions).

## A3. State and URL

- Slider state: **`src/state/useScenario.ts:90`** — `const [scenario, setScenarioState] = useState<ScenarioState>(INITIAL)`; `INITIAL` at `:31-35` = `{sstAnomaly, jetStreamShift, agricultureWeight}`. Units are separate at `:92`. `setScenario` `:111`, `reset` `:115`.
- **Nothing is persisted.** No URL sync, no `history.pushState`/`replaceState`, no localStorage/sessionStorage anywhere in `src/`.
- A UI-only boolean added as another `useState` in that hook (or in `App`) touches no persisted state and no Snapshot output: `buildReportHtml` (`report.ts:52`) reads only `scenario`, `metrics`, `analytics`, `activeRegion`, `snapshot`.
- Existing params are **flag-style**: `new URLSearchParams(search).has('debug')` (`main.tsx:23`, `GlobeScene.tsx:257`) and `.get('framing') === 'live'` (`framing.ts:86`).
- **`nino` collision: none.** No `URLSearchParams` key anywhere contains `nino`. The namespace holds only `debug` and `framing`, so a bare `?nino` flag follows the `debug` mechanism exactly. A value-bearing `?nino=12` would be a *new* mechanism in this codebase and is not advisable.

## A4. Card formatting, sign, units

| helper | file:line | behaviour |
|---|---|---|
| `fixed(value, digits)` | `src/lib/format.ts:24` | `toFixed` with **−0 normalised** (both `value === 0` and "rounds to −0") |
| **`signed(value, digits, unit?)`** | `format.ts:47` | `+1.5` / `-1.5` / `0.0`; sign decided **after** rounding; **ASCII `-`** (`:60`) |
| `magnitude`, `percent`, `hasNegativeZero` | `format.ts:68,72,78` | — |
| `formatDelta(value, unit, digits=1)` | `src/lib/regions.ts:78` | sign `value > 0 ? '+' : value < 0 ? '−' : ''` — **U+2212 MINUS SIGN** (`regions.ts:79`) |
| `celsiusToFahrenheit(c)` | `regions.ts:83` | `c * 1.8 + 32` — **absolute** temperatures |
| `fahrenheitDeltaToCelsius(f)` | `regions.ts:90` | `f * 5/9`, no offset |
| **`celsiusDeltaToFahrenheit(c)`** | `regions.ts:91` | `c * 9/5`, **no offset** |
| `tempDisplay(c, units)` | `regions.ts:94` | offset path |
| **`deltaDisplay(celsiusDelta, units)`** | `regions.ts:101` | **the offset-free path** |

**Yes, an offset-free path exists** and the codebase already argues for it: `regions.ts:85-89` — "a delta scales by 5/9 with no +32 offset. Using `celsiusToFahrenheit()` here turns a -1.91 °F anomaly into -18.8 °C, which is a nonsense number on a dashboard." Call sites: `RegionDrawer.tsx:38,73`, `SheetBody.tsx:256`.

**Glyph question — settled.** `src/lib/model.ts:22` imports `signed` from `@/lib/format` and formats the Pacific card headline at `:181`, so **the desktop cards emit ASCII `-`**. The drawer independently uses `formatDelta` (U+2212). Two conventions coexist in shipped UI text. `ninoCard.ts` follows **`signed`** (the cards), and `ninoCard.test.ts` asserts it cannot drift back to U+2212 silently.

## A5. Layout capacity (code/CSS only — pixels **NOT MEASURED**)

- Card column: `RegionCards.tsx:31` — `flex w-[268px] flex-col gap-2`; **no `overflow-y`, no `max-h`**. Parent is `absolute right-0 top-1/2 -translate-y-1/2 p-6` (`App.tsx:238`), so the list grows **symmetrically about the mid-line** and can never scroll.
- Card metrics: `px-3 py-2.5` = 10 px vertical padding (`RegionCards.tsx:52`), 24 px icon (`:70`), name 11.5 px (`:79`), headline 10 px (`:82`); the summary is collapsed to `max-h-0` unless active/hovered (`:98`).
- **6 cards do not overflow 720 px** at roughly 60 px per card + 8 px gaps ⇒ ~410 px tall, and there is no scroll container to break.
- The real constraint is the **insets registry**: `[data-occluder="right-panel"]` contributes a **right** inset equal to its width (268 + 2×24 = 316 px), not its height — `src/layout/insets.ts:117-123` clips the rect to the viewport, `:144-147` considers every attached edge, and `:149` assigns the **thinnest**. Card count changes height, not width, so the right inset should not move. **Risk to name:** if the panel ever grows taller than ~316 px *and* touches both top and bottom edges, `assigned` flips to the smaller thickness and the inset silently changes axis. At 720 px with 6 cards there is ~205 px clearance per side — safe, but not proven by measurement.
- Mobile: chips are `REGIONS.map` in a `flex flex-wrap gap-1.5` (`SheetBody.tsx:157`), each `min-h-[44px] px-2.5` (`:172`) — they **wrap, never scroll**. Two more chips at 390 px wide costs one extra 44 px row out of the `showControls` budget, not out of the sheet.

**NOT MEASURED:** rendered card heights, the right-panel rect, and the resulting `computeFrame` `d_fit` shift at 4 vs 6 cards. Would need a live `__globe`/Playwright read.

## A6. The CSV path

| path | exists? | read by |
|---|---|---|
| `public/data/enso.csv` | ✅ **225,838 B** | app via `src/lib/duckdb.ts:72` (`DATA_URL = '/data/enso.csv'`); the `ninoRelation.test.ts` drift guard via `parseDataset` |
| `data/enso_historical.parquet` | ✅ 74,467 B | nothing at runtime (repo-only source of truth, `README.md:116`) |
| `data/enso.csv` | ❌ **does not exist** | — |

Third consecutive step where the prompt's `data/enso.csv` is wrong. Both readings of "public or data" are answered by the table: only the `public/` path exists as CSV.

---

## A7. Residual diagnostics — full output

`node D:/Dev/Handshake/_triage/nino-residuals.mjs` — independent CSV split (not the app parser), two-pass OLS, bins with sample SD (denominator n−1), percentiles by linear interpolation.

```
=== source ===
file: D:/Dev/Handshake/Build-an-Interactive-Data-Visualization/public/data/enso.csv
rows (data rows): 918
x column: nino_34_anomaly   warm threshold (x >=): 0.5

=== nino12 / warm (x >= 0.5) ===
  n         = 181
  slope     = 1.155607599959169
  intercept = -0.25204338136877236
  r2        = 0.2885724419372131
  residSd   = 0.9824540884715575

  residual SD by x bin (sample SD, denominator n-1):
    0.50-1.00  n= 98  residSd=0.970992
    1.00-1.50  n= 44  residSd=0.982841
    1.50-2.00  n= 22  residSd=1.007547
    2.00-2.72  n= 17  residSd=0.982222
    top/bottom ratio = 1.0116

  residual percentiles:
    q16 = -0.861139
    q50 = -0.183541
    q84 = 1.055365
    |q84+q16| / (q84-q16) = 0.101344

  coverage of fitted +/- 1 residSd:
    inside = 128 / 181 = 70.72%
    above  = 32 = 17.68%
    below  = 21 = 11.60%

  PRE-REGISTERED CLASSES:
    HETEROSCEDASTIC: no   (top/bottom 1.0116 vs > 1.3)
    SKEWED:          no   (0.1013 vs > 0.25)
    COVERAGE-OK:     YES   (70.72% vs 60-76%)

  fitted value and +/- 1 residSd band at slider positions:
    x= 0.50  fitted=  0.325760  band=[-0.656694, 1.308215]  width=1.964908  inside observed x
    x= 1.00  fitted=  0.903564  band=[-0.078890, 1.886018]  width=1.964908  inside observed x
    x= 1.50  fitted=  1.481368  band=[ 0.498914, 2.463822]  width=1.964908  inside observed x
    x= 2.00  fitted=  2.059172  band=[ 1.076718, 3.041626]  width=1.964908  inside observed x
    x= 2.50  fitted=  2.636976  band=[ 1.654522, 3.619430]  width=1.964908  inside observed x
    x= 2.72  fitted=  2.891209  band=[ 1.908755, 3.873663]  width=1.964908  inside observed x
    x= 3.00  fitted=  3.214779  band=[ 2.232325, 4.197234]  width=1.964908  OUTSIDE observed x

=== nino4 / warm (x >= 0.5) ===
  n         = 181
  slope     = 0.32437059345513547
  intercept = 0.20741137766178214
  r2        = 0.20922651873081777
  residSd   = 0.3414468569834548

  residual SD by x bin (sample SD, denominator n-1):
    0.50-1.00  n= 98  residSd=0.347859
    1.00-1.50  n= 44  residSd=0.313689
    1.50-2.00  n= 22  residSd=0.341626
    2.00-2.72  n= 17  residSd=0.382349
    top/bottom ratio = 1.0991

  residual percentiles:
    q16 = -0.380690
    q50 = 0.049025
    q84 = 0.344305
    |q84+q16| / (q84-q16) = 0.050187

  coverage of fitted +/- 1 residSd:
    inside = 113 / 181 = 62.43%
    above  = 31 = 17.13%
    below  = 37 = 20.44%

  PRE-REGISTERED CLASSES:
    HETEROSCEDASTIC: no   (top/bottom 1.0991 vs > 1.3)
    SKEWED:          no   (0.0502 vs > 0.25)
    COVERAGE-OK:     YES   (62.43% vs 60-76%)

  fitted value and +/- 1 residSd band at slider positions:
    x= 0.50  fitted=  0.369597  band=[0.028150, 0.711044]  width=0.682894  inside observed x
    x= 1.00  fitted=  0.531782  band=[0.190335, 0.873229]  width=0.682894  inside observed x
    x= 1.50  fitted=  0.693967  band=[0.352520, 1.035414]  width=0.682894  inside observed x
    x= 2.00  fitted=  0.856153  band=[0.514706, 1.197599]  width=0.682894  inside observed x
    x= 2.50  fitted=  1.018338  band=[0.676891, 1.359785]  width=0.682894  inside observed x
    x= 2.72  fitted=  1.089699  band=[0.748253, 1.431146]  width=0.682894  inside observed x
    x= 3.00  fitted=  1.180523  band=[0.839076, 1.521970]  width=0.682894  OUTSIDE observed x
```

**Interpretation.** Neither fit is heteroscedastic (1.0116 / 1.0991 against the 1.3 line) and neither is skewed (0.1013 / 0.0502 against 0.25). A **constant ±1 residSd band is therefore defensible** and is the right thing to render — a fan or a log transform would be inventing structure that is not there. Coverage lands inside the pre-registered window for both (70.72 %, 62.43 %) *despite* the weak r², which is the expected independence: coverage describes residual spread, not explained variance. Residuals straddle asymmetrically (nino12 17.68 % above / 11.60 % below; nino4 17.13 % / 20.44 %) — small-sample noise, not a distributional skew worth modelling.

---

## Design memo

### Measured fly-to framing

Method: `_triage/nino-framing.mjs` builds a real `PerspectiveCamera(42, W/H, 0.1, 400)`, points it at the anchor via `latLonToVector3` **copied verbatim from `src/lib/regions.ts:68-76`**, projects 82 boundary samples of each box, and bisects for the smallest distance that lands every sample inside the padded viewport (`FRAME_PADDING_PX = 24`).

`d0 = 3.353357` (`framing.ts:59-60`). Shipped zooms: `pacific 2.9`, `us-west 2.6`, `se-asia 2.7`, `horn-africa 2.7`. `controls.minDistance = EARTH_RADIUS * 1.25 = 1.25` (`GlobeScene.tsx:727`), `maxDistance = 5`.

| box | lon × lat span | anchor | d_fit @1440×900 (box centre) | d_fit (aimed at −2,−150) |
|---|---|---|---|---|
| **nino12** | 10° × 10° | (−5, −85) | **1.2360** | 1.2611 |
| **nino4** | 50° × 10° | (0, −175) | **1.1430** | 1.3279 |
| nino34 (ref) | 50° × 10° | (0, −145) | 1.2040 | 1.3279 |

At `1280×720`: nino12 **1.2395**, nino4 **1.1289**.

**The sharp finding: a distance that actually frames either box is at or below `controls.minDistance` (1.25).** Niño 4 needs ≈1.14 — **below the floor**, i.e. the box cannot be framed at all without relaxing the clamp. Niño 1+2 needs ≈1.24, marginally inside. The existing fly-to has no box concept whatsoever: it reads a scalar `region.zoom` (`CameraDirector.tsx:215`) and every shipped zoom (2.6–2.9) is *larger* than a box-fit, because the product frames a **point**, not a box. "Frame the 50° box" is therefore not a tweak to `CameraDirector` — it is a new concept that collides with an existing OrbitControls clamp.

**Anchor recommendation:** use the **`NINO_BOXES` box centres**, `nino12 (−5, −85)` and `nino4 (0, −175)`, not the Niño 3.4 pin (−2, −150). For Niño 4 the pin sits 25° east of the box centre — half a box width — which costs ~0.185 of distance and pushes the box off-centre. (−175) is dateline-safe because `latLonToVector3` consumes the raw −175 directly.

**Zoom recommendation:** keep the sibling scalar convention — `nino12: 2.7`, `nino4: 2.7` — rather than the measured 1.24/1.14, because (a) anything below 1.25 is clamped by `minDistance` and would break the focus machine's "arrived at the requested distance" invariant, and (b) 2.6–2.9 is the established point-framing scale. Box framing is a separate, later concern.

### G1 — append to `REGIONS`

- Tests that break: `src/lib/regions.test.ts:43` (hard 4), `:44` (exact ids), `:64` (exact triples); `tests/e2e/pin-click.spec.ts:830,909` (hard 4); **`tests/e2e/camera-golden.spec.ts:90` + `golden/camera-poses.json`** (locked; no pose exists for the new ids); **`tests/e2e/focus-ux.spec.ts:51`** (locked 4-entry list); `reset-ux.spec.ts:45`; `switcher-ux.spec.ts:47`; `mobile-sheet.spec.ts:1035,1040`; and the sharpest, **`tests/e2e/look/pinValidity.test.ts:114-115`** ("az 90 yields only horn-africa, az 270 only pacific").
- tsc errors (good ones): `RegionCards.tsx:6` `ICONS: Record<RegionId, …>` and `model.ts:175` `switch` are exhaustive over `RegionId`.
- Locked specs affected: **camera-golden, focus-ux, look, negative** (4 of 15).
- Size: ~8 test files + a golden regeneration + two exhaustive maps.
- Determinism/golden risk: **high** — new pins change `__globe.pins()` snapshots (`negative.spec.ts:687`) and every pin-iterating pixel metric, plus a regenerated `camera-poses.json`.
- SheetBody composition: irrelevant; it is desktop-first.

### G2 — separate list behind a default-OFF flag

- Locked specs affected: **zero**, conditional on the flag-OFF DOM being identical. That holds because cards already read `ORDER` (`:13`), and pins/legend/drawer/sheet already read `REGIONS` — so a *new* list rendered from a *new* component changes neither.
- Positional-indexing hazards to watch: `RegionCards.tsx:6` `ICONS` is a keyed `Record` (safe — add keys); `GlobeScene.tsx:307,585` and `EarthSystem.tsx:62` iterate (safe); `pin-click.spec.ts` addresses pins by `pin-hit-${id}` (safe, ids are new). **The real hazard is the occluder:** if the new cards render *inside* `[data-occluder="right-panel"]`, the measured rect grows and the right inset moves even when visually empty — so the new stack must sit outside that element or be conditionally mounted the way `{!isMobile ? …}` already is (`App.tsx:231`).
- Size: one component + one flag + one test file. No golden churn.
- Determinism risk: **none while OFF**; low while ON.
- SheetBody composition: **best** — the flag becomes the same predicate a later layer toggle at `SheetBody.tsx:157` would read.

### G3 — mobile `SheetBody` only

- Locked specs affected: **none** of the locked 15 (they are desktop-framing specs). `mobile-sheet.spec.ts:1035,1040` (not locked) gains two chips.
- But `SheetBody.tsx:158` reads `REGIONS`, so G3 still needs either an append (inheriting G1's breakage inside the sheet) or a second list.
- Size: smallest. Determinism risk: none for the locked 15.
- SheetBody composition: **worst** — a later desktop layer toggle would have to be built twice, which is exactly the fragmentation G2 avoids.

### Rule outcome and recommendation

> Rule: "choose G2 unless A2 shows zero count or order assertions anywhere, in which case G1 is acceptable."

A2 shows **six** count/order assertions plus a golden JSON and a per-pin azimuth assertion, four of them inside the locked set.

**Rule outcome: G2. Recommendation: G2** — a separate list behind a default-OFF flag, rendered outside the `right-panel` occluder.
