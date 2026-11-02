# MOBILE2 audit (step 2B-STEP3-MOBILE2, section P1)

Read-only audit. HEAD at the time of writing: **`cf8b0a6`** (P0: the prompt saved verbatim).
Baseline before this step: `f7a8332` (MOBILE1 closed, mobile-sheet.spec 15/15, unit 1020).

Every number below came out of a throwaway Playwright probe run against the E2E bundle
(`.cache/mob2-baseline.json`, 8 viewports, `?debug&framing=live`), not from hand arithmetic.

---

## 1. HEAD hash and the MOBILE1 file names

| thing | file:line |
|---|---|
| layout-mode lane (store fields, the one matchMedia listener) | `src/scene/viewStore.ts:118-224` (`LayoutMode = 'mobile' \| 'desktop'`, `getLayoutMode`, `startLayoutModeObserver`, `__setLayoutModeForTest`, `__resetLayoutMode`) |
| the media query itself | `src/mobile/snapMath.ts:35-38` (`BREAKPOINT_MAX = 767.98`, `MOBILE_QUERY`) |
| snap sheet | `src/mobile/SnapSheet.tsx` (559 lines; probe marker `mobile-snap-probe-3m1` at `:44`) |
| sheet drag engine | `src/mobile/useSheetDrag.ts` (348 lines) |
| sheet arithmetic | `src/mobile/snapMath.ts` (`TIER_FRACTION` 0.18/0.48/0.88 at `:55`, `MOBILE_FREE_TOP_FRACTION = 0.55` at `:92`) |
| floating island | `src/mobile/TopIsland.tsx` (128 lines) |
| island text | `src/mobile/ensoHud.ts` (`formatIsland` at `:199`, `formatAnomaly` at `:184`) |
| mobile frame | `src/mobile/mobileFrame.ts` (`computeMobileFrame` at `:45`) |
| mobile shell | `src/mobile/MobileShell.tsx` (sr-only h1, the scenario-reset icon, `ResetViewButton`, `SnapSheet`) |
| the director's offset code | `src/scene/CameraDirector.tsx:375-418` (`MobileOffsetState`, `applyMobileOffset`), mobile branch `:682-789` |

## 2. The desktop Header

`src/components/Header.tsx` (126 lines), one `<header data-occluder="top-panel">`:

- identity block `:31-70` — icon tile, `h1` (`:38-40`), subtitle `:41-43`, ENSO badge `:47-69`;
- controls cluster `:73-123` — `<EngineBadge>` in a `hidden md:flex` wrapper `:76-78`, the unit toggle (two
  `button[aria-pressed]` in a rounded pill, `:80-97`), a GitHub link `:99-107`, the Snapshot button
  `:109-117`, and `<ResetViewButton>` `:122`.

State flow: all props from `App.tsx:152-161` — `metrics`, `units`, `onToggleUnits` (`units`/`toggleUnits` out of
`useScenario`), `onExport`/`exporting` (App's own state round `handleExport`), `onClearSelection` (`App`'s
`clearSelection`). Nothing in the header owns state itself except `ResetViewButton`, which subscribes to
`scene/viewStore` via `useSyncExternalStore`.

**Shareable without touching desktop?** Yes. `ResetViewButton` is already a component (`src/components/
ResetViewButton.tsx`) used by both headers today (`Header.tsx:122`, `MobileShell.tsx:90`). The unit toggle and
Snapshot are INLINE markup inside `Header.tsx`, so the safe route is a second, compact copy in
`HeaderCompact.tsx` that calls the same two props — no extraction, therefore no diff to `Header.tsx` and no
pixel risk. That is what step B does. **STOP condition (a) is not hit: the desktop Header file is not edited
at all.**

## 3. Where the ghost duplicate Reset comes from

`src/mobile/MobileShell.tsx:77-92` renders two 44 px round buttons side by side:

1. `:82-89` a plain `<button>` with `<RotateCcw size={14}/>` and `aria-label="Reset the scenario levers to the
   Super El Niño baseline"` — resets the SCENARIO (`onResetScenario`);
2. `:90` `<ResetViewButton>` — resets the VIEW (`aria-label="Reset view"`), itself also `<RotateCcw size={12}>`.

Two adjacent identical rotate-ccw icons, one of which the prompt does not mention as a control. Measured at
390x844: `document.querySelectorAll('button')` filtered on `/reset view/i` → 1, but the visible cluster has two
icons. Step B deletes the scenario-reset button (it is not in the prompt's compact-header list) and the island.

## 4. Is the anomaly displayed with a unit conversion today?

**No.** `formatAnomaly` (`src/mobile/ensoHud.ts:184-190`) always prints `°C`; `SnapSheet.tsx:273` prints
`formatAnomaly(scenarioSst)`; `SnapSheet.tsx:307` prints `fixed(scenarioSst, 2) °C`. `units` is threaded into
the sheet but only reaches `FullTier`'s `Temp dev` stat (`SnapSheet.tsx:475`).

The conversion the prompt wants already exists and is the DELTA form:
`celsiusDeltaToFahrenheit = (c) => c * (9/5)` (`src/lib/regions.ts:90`), with the doc comment at `:86-89`
stating exactly why the `+32` must not be used; `deltaDisplay` (`:101-108`) wraps it. The one desktop user is
`RegionDrawer.tsx:73`. So `anomalyDeltaUnit` is a thin wrapper over an existing law, not a new one.

## 5. The fit: `d_contain`, `d_fit`, `dMax`, and the d-dependent items

| item | file:line | value today |
|---|---|---|
| `rMax = 0.5*min(freeW,freeH) - padding` | `src/layout/frame.ts:153` | padding `FRAME_PADDING_PX = 24` (`:52`) |
| `focalPx` | `src/layout/frame.ts:171` | `H/2 / tan(fov/2)`, FULL viewport height |
| `dContain` | `src/layout/frame.ts:188` | `sqrt(re² + (focalPx·re/rMax)²)` |
| `dTarget` (d_fit) | `src/layout/frame.ts:197` | `min(max(d0, dContain), dMax)`, `d0 = 3.3533565` |
| `dMax` | `src/layout/framing.ts:63` | `EARTH_RADIUS * 5` = 5 |
| `re` (envelope) | `src/layout/framing.ts:72-73` | `PIN_ENVELOPE = 1.012*1.035 + 0.055 = 1.10242` |

d-dependent items and their current values:

| item | where | value | safe up to `1.25·dContain` (≤ 9.2)? |
|---|---|---|---|
| camera `far` | `src/scene/GlobeScene.tsx:243` | **400** | yes — 400 ≫ 9.2 + 2 |
| camera `near` | same | **0.1** | yes (globe radius 1, so near only clips if `d < 1.1`) |
| `scene.fog` | `src/scene/GlobeScene.tsx:249` | `null` | n/a |
| atmosphere/limb shader | `src/scene/shaders.ts` | analytic, camera-distance independent (uniform `uShellRadius` only) | yes |
| sun distance | `src/scene/constants.ts:348-352` | `SUN_POSITION = dir * 8` (a light POSITION, not a range) | irrelevant to distance |
| label scale | drei `<Html>` (screen space) | no distance scale factor | yes |
| pin proxy clamp | `src/scene/Hotspot.tsx:183-185` | `worldR = hitPx·dist/focalPx`, clamped to `PIN_HIT_CLAMP_R` (`pinVisibilityBands.ts:73`) | recalculated every frame — scales with dist, so yes |
| `HIT_PX` | `src/scene/pinVisibilityBands.ts:57-60` | 14 px, 22 px on `pointer: coarse` | unchanged by distance |
| spin speed | `src/scene/EarthSystem.tsx:53` | `spin.y += delta * 0.045` rad/s | distance independent |
| `OrbitControls minDistance` | `src/scene/GlobeScene.tsx:726` | `EARTH_RADIUS * 1.25` | yes |
| `OrbitControls maxDistance` | `src/scene/GlobeScene.tsx:727` | `EARTH_RADIUS * 5` | **this is the clamp step C must lift on non-desktop** |

Atmosphere outer radius: `SHELLS.atmosphere = 1.1` (`src/scene/constants.ts:367`), consumed as
`<mesh scale={SHELLS.atmosphere}>` (`src/scene/Globe.tsx:265`) and as `uShellRadius`
(`src/scene/Globe.tsx:157`). Since `1.1 < 1.10242`, the pin envelope dominates: `re` unchanged.

## 6. globe.spec 375x667 pinch-origin heuristic (read only, NOT edited)

`tests/e2e/globe.spec.ts:211-230`: it scans the canvas rect on a 20 px grid, keeps every point where
`document.elementFromPoint(x,y) === canvas`, takes the topmost row of survivors and the middle cell of that
row. At 375x667 today the controls deck is `display:none` (mobile), the sheet top is 307.5 and the island sits
at the top centre — so the topmost open row is under the island. Measured open-canvas cells exist (the case
passed before this step, and the pinch origin is logged on failure only).

## 7. How Snapshot renders, and does it include the view offset?

`captureCanvas` (`src/lib/canvasCapture.ts:23-41`) calls `registerRenderer`'s `render()` (the live
`gl.render(scene, camera)`, `GlobeScene.tsx:252`) and then `domElement.toDataURL()`. It therefore captures the
FULL canvas (W×H CSS px × DPR) with the CURRENT projection matrix — **the view offset is included**, because
`setViewOffset` edits that matrix and nothing clears it. `dpr={[1, 2]}` (`GlobeScene.tsx:235`) plus
`<AdaptiveDpr>` (`:756`) means the capture's pixel size can be below `2×CSS`. Report only; not fixed here.

## 8. Inputs, viewport meta, DPR cap

- Text inputs: **none**. `grep -rn 'type="text"\|<textarea\|contentEditable' src` → 0 hits. The only inputs are
  `type="range"` sliders (`SnapSheet.tsx:309,326,343`, `TopIsland.tsx:309`). So there is no keyboard-driven
  resize risk from a focused field; a software keyboard can still fire `resize`, which the rAF-coalesced reader
  handles.
- Viewport meta: `index.html:5` — `width=device-width, initial-scale=1.0, viewport-fit=cover`. `viewport-fit=
  cover` is what makes `env(safe-area-inset-*)` non-zero; the sheet already uses
  `pb-[env(safe-area-inset-bottom)]` and the island `env(safe-area-inset-top)`.
- DPR cap: `dpr={[1, 2]}` on the Canvas (`GlobeScene.tsx:235`) — cap 2.

## 9. Baseline measurements (MOBILE1 code at `cf8b0a6`)

`free` and `d` from `window.__frame`; `disc`, `centre` from `window.__globe`; header from `<header>`'s rect.
`overflow` is the disc's edge against the free rect, positive = outside.

| viewport | mode | header h | free rect | d | dMax | disc r | centre | disc overflow (L/R/T/B) |
|---|---|---:|---|---:|---:|---:|---|---|
| 390x844 | mobile | none (sr-only h1) | 0,0,390,464.20 | 5 | 5 | 224.40 | 195, 232.10 | **+29.4**, **+29.4**, −7.7, −7.7 |
| 412x924 | mobile | none | 0,0,412,508.20 | 5 | 5 | 245.67 | 206, 254.10 | **+39.7**, **+39.7**, −8.4, −8.4 |
| 360x640 | mobile | none | 0,0,360,352.00 | 5 | 5 | 170.16 | 180, 176.00 | −9.8, −9.8, −5.8, −5.8 |
| 320x568 | mobile | none | 0,0,320,312.40 | 5 | 5 | 151.02 | 160, 156.20 | −9.0, −9.0, −5.2, −5.2 |
| 768x1024 | desktop | 174.75 | 0,174.75,768,280.75 | 5 | 5 | 272.26 | 384, 315.12 | −111.7, −111.7, **+131.9**, **+131.9** |
| 960x1440 | desktop | 132.50 | 0,132.50,960,739.00 | 5 | 5 | 382.87 | 480, 502.00 | −97.1, −97.1, **+13.4**, **+13.4** |
| 924x412 | desktop | 132.50 | 0,412,924,0 (degenerate) | 3.3534 | 5 | 167.66 | 462, 412.00 | **+294.3**, **+294.3**, **+167.7**, **+167.7** |
| 667x375 | mobile | none | 0,0,667,206.25 | 5 | 5 | 99.71 | 333.50, 103.13 | −233.8, −233.8, −3.4, −3.4 |

Three facts follow from the table, and step C is what fixes them:

1. **`d` is pinned at 5 on every mobile viewport** while `dContain` from the 24 px-padded free rect is
   7.17 (390x844), 7.37 (412x924), 6.15 (360x640), 6.27 (320x568). The `maxDistance` clamp is what makes the
   disc wider than the band: **+29.4 px per side at 390x844 and +39.7 px at 412x924**, i.e. the globe is
   clipped horizontally today, which is exactly what the prompt's "at least 8 px margin on all four sides"
   cannot tolerate.
2. **924x412 and 667x375 are the two worst cases and they are in different modes today**: 924x412 is desktop
   (`free` height 0, so `computeFrame` reports degenerate) and 667x375 is mobile with a 206 px band. The new
   `resolveLayoutMode` puts both in `phoneLandscape`.
3. `dMax` on mobile must become `max(5, 1.25·dContain)`, which for the table above is 7.17×1.25 = 8.97 at
   390x844 — above `far`'s needs (400) by a wide margin, so no `far`/`near` change is required.

Planned (not measured) values for the new free rect at an assumed compact-header height of 104 px portrait /
60 px phoneLandscape — these are the numbers step E measures, listed here so a later reader can see whether the
implementation matched the intent. **The 104 px figure was a planning assumption, superseded by the measured
158.00 px in `docs/MOBILE2-RECON.md` §R2; the table below is retained as the record of what was planned, not as a
description of the shipped header.**

| viewport | mode | free rect | cx, cy | Rb | dFit | dMaxMode |
|---|---|---|---:|---:|---:|---:|
| 390x844 | portrait | 0,104,390,692.08 | 195, 398.04 | 183 | 6.714 | 8.392 |
| 412x924 | portrait | 0,104,412,757.68 | 206, 430.84 | 194 | 6.928 | 8.660 |
| 360x640 | portrait | 0,104,360,524.80 | 180, 304.80 | 168 | 5.580 | 6.975 |
| 320x568 | portrait | 0,104,320,456.00 | 160, 267.36 | 148 | 5.620 | 7.025 |
| 375x667 | portrait | 0,104,375,546.94 | 187.5, 318.84 | 175.5 | 5.568 | 6.960 |
| 430x932 | portrait | 0,104,430,764.24 | 215, 434.12 | 203 | 6.684 | 8.355 |
| 667x375 | phoneLandscape | 0,60,347,375 | 173.5, 217.50 | 145.5 | 3.862 | 5 |
| 844x390 | phoneLandscape | 0,60,523.28,390 | 261.64, 225.00 | 153 | 3.823 | 5 |
| 924x412 | phoneLandscape | 0,60,572.88,412 | 286.44, 236.00 | 164 | 3.772 | 5 |
| 932x430 | phoneLandscape | 0,60,577.84,430 | 288.92, 245.00 | 173 | 3.736 | 5 |

## 10. STOP conditions

**(a) Would sharing the controls change a desktop rect or pixel?** Not hit — the fix is to NOT share markup:
`Header.tsx` is untouched, `HeaderCompact.tsx` is a new file reusing only `ResetViewButton` (already shared) and
the same two callbacks. Nothing desktop re-renders differently.

**(b) Can the director take a generic free rect without moving the desktop S1 residual or goldens?** Not hit —
the desktop half of the frame body keeps `computeFrame(insets)` exactly as it is; the new free rect is computed
ONLY inside the mobile branch (`CameraDirector.tsx:682-789`), which desktop never enters. The desktop camera far,
near, dMax and `camera.view` arithmetic are byte-identical.

Both clear, so the step continues.

## Accepted gaps (documented, not fixed)

- 768..1023 wide in LANDSCAPE with `h >= 600` resolves to `portrait` (e.g. 1024x600 is desktop, 1023x600 is
  portrait); a 1023x601 landscape tablet therefore gets a portrait sheet.
- 768x768 and 900x900 resolve to `desktop` (square, `w > 768`, `h > w` false).
- 1024x1366 resolves to `desktop` although it is a portrait tablet.
