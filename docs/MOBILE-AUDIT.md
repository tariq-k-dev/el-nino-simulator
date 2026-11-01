# Step 3-MOBILE1 — Step P1 read-only audit

Prompt: `docs/prompts/step3-mobile1.md` (sentinel `END OF PROMPT 2B-STEP3-MOBILE1`).
HEAD at the start of this session: **`96c4ffcdaca45448820572bf37bfe99e7fc29e2f`** (`P0: step3-mobile1 prompt — mobile
snap-sheet and floating HUD`), working tree clean.

Not to be confused with `docs/MOBILE_AUDIT.md` (underscore), which is step 3A's layout audit of 2026-10-29 and is
untouched here. This file is the hyphenated `MOBILE-AUDIT.md` the prompt asks for.

Everything below is read from the repo at `96c4ffc`. No source file was modified to produce it.

---

## 1. HEAD, and whether FIX2 is present

**FIX2 is merged.** Five commits:

| commit | what |
|---|---|
| `282528b` | `P0: step3-b2-fix2-cont prompt` |
| `1a3b44f` | `A: pin hit proxy gated on the facing band` |
| `7bde152` | `WAIVER W5: pin-click spec rewritten for the proxy` |
| `7362d13` | `C: docs for the pin proxy and the corrected gate` |
| `27acd39` | `C2: fund pin-click's 7 cases and record the batched run` |

Both named features are in the tree:

| feature | component | where |
|---|---|---|
| pin hit proxy, 22 px on `pointer: coarse` | **`Hotspot`** | `src/scene/Hotspot.tsx:385-405` (`<mesh ref={proxyRef} name={pin-hit-…} raycast={proxyRaycast} visible={false}>`); radius constants `HIT_PX = 14` / `HIT_PX_COARSE = 22` at `src/scene/pinVisibilityBands.ts:57,60`; the coarse query at `Hotspot.tsx:66-70`, read once per mount at `Hotspot.tsx:92`; per-frame projected-radius scaling at `Hotspot.tsx:177-186`; the facing gate at `Hotspot.tsx:303-345` |
| in-drawer region switcher | **`RegionDrawer`** | `src/components/RegionDrawer.tsx:255-318` (`data-testid="drawer-switcher"`, one `<button data-region-id=…>` per region, active chip `aria-current` and a no-op, `tabIndex={open ? 0 : -1}`) |

The switcher retargets through `App.selectRegion` (`src/App.tsx:30-36`), passed in at `App.tsx:193` — the same path
the cards (`App.tsx:178`) and the pins (`App.tsx:109`) use.

---

## 2. How desktop free-rect centring and `d_fit` work today

**Yes — it already uses `setViewOffset`, with a FULL-SIZE sub-window.** That is the single most important fact for
this step: the offset mechanism this prompt needs is already installed and already proven, so mobile mode adds a
second caller of the same device rather than a new one.

| question | answer | where |
|---|---|---|
| where the free rect comes from | elements marked `data-occluder` (`top-panel`, `left-panel`, `right-panel`, `right-drawer`) | `src/layout/useInsets.ts:46`, read at `:97-105`; attributes at `Header.tsx:27`, `App.tsx:151,175`, `RegionDrawer.tsx:170` |
| how insets are derived | max thickness **per edge**, clipped to the viewport, corner elements charged to their thinner edge | `src/layout/insets.ts:98-151,169-220` |
| how a free rect is expressed | `Insets {left,right,top,bottom}` → `FrameRect {x,y,w,h}`; centre written as `inset + half` so one panel moves the centre by half its thickness | `src/layout/frame.ts:72-78,132-147` |
| the offset | `dx = centreX − W/2`, `dy = centreY − H/2`; installed NEGATIVE, `camera.setViewOffset(w, h, −dx, −dy, w, h)` | `frame.ts:146-147`, applied at `src/scene/CameraDirector.tsx:612` |
| the sub-window | **`(W, H)` — full width and height**, so the frustum is shifted, never rescaled; zoom is unchanged | `CameraDirector.tsx:612`, rationale at `frame.ts:164-171` |
| `d_fit` | `focalPx = H/2 / tan(fov/2)`; `rMax = 0.5·min(freeW,freeH) − padding`; `dContain = √(re² + (focalPx·re/rMax)²)`; `dTarget = clamp(max(d0,dContain), d0, dMax)` | `frame.ts:153,171,188,197` |
| what `re` is | the pin envelope, `1.10242 R` | `src/layout/framing.ts:72-73` |
| the clamp | `d0 = 3.3534` floor, `dMax = 5` ceiling — reachable and reported (1024×768 already binds at `dMax`) | `framing.ts:60,63`; `frame.ts:43-46` |
| the ease | 180 ms exponential on the distance and on the offset, snapped on the first frame / under `prefers-reduced-motion` | `CameraDirector.tsx:590-603,639-650` |

There is **no target offset**: `controls.target` is moved only by the locked aim-at-pin policy. The live policy never
writes it (`CameraDirector.tsx:268-325`), which is what keeps the globe centred on the free rect.

---

## 3. Every place that assumes the globe centre equals the canvas centre

This is the list the prompt asks to be fixed in step B. Only two entries actually **break** under a view offset;
the rest are either offset-correct by construction or desktop-only. Distinguishing them is what makes step B small
instead of a hunt.

### 3a. Already correct — `projectionMatrixInverse` or a full-height focal length

| site | why it survives an offset |
|---|---|
| `src/lib/globeProbe.ts:63-75` `project()` | projects through `camera.projectionMatrix`, which `setViewOffset` has already folded in. This is also why raycasting needs no change (`three` unprojects with `projectionMatrixInverse`). |
| `src/lib/globeProbe.ts:95-104` `discRadiusPx()` | a **radius**, from `focalPx = H/2/tan(fov/2)` on the FULL height. A full-window offset does not change the scale, so the radius is unaffected — the same reason `frame.ts:171` uses `H` and not `freeH`. |
| `src/scene/Hotspot.tsx:177-186` pin-proxy scaling | the same focal-length form on `state.size.height`; a radius, not a centre. |
| `src/scene/Hotspot.tsx:480-541` hotspot label positioning | drei `<Html>` positions from the camera's own projection matrix, so the label follows the offset with no change. |
| `src/lib/frameProbe.ts` + `CameraDirector.tsx:684-726` | the probe does not assume a centre: it EXPORTS `frame.free`, `frame.dx/dy` and `camera.view`, and every spec derives the centre as `free.x + free.w/2`. |
| `tests/e2e/look/*` limb and silhouette code | the circle is FITTED from pixels (`fitLimb`, 360 rays), not derived from the viewport centre. |

### 3b. Desktop-only, and must stay untouched at ≥768 px

| site | note |
|---|---|
| `tests/e2e/focus-ux.spec.ts:562,882,888`, `frame-director.spec.ts:92,115` | drag origins at `w/2, h/2`. All of these run at 1440×900 / 1280×720 / 1024×768, where the offset is the desktop one, so `(w/2, h/2)` is a *canvas* coordinate and correctly not a globe coordinate. |
| `src/lib/look/helpers.ts:20-21` `VIEWPORT = 1280×800` | every look spec's coordinate frame. |
| `src/layout/frame.ts:146` `dx = centreX − W/2` | the DEFAULT the mobile branch overrides; not a bug. |

### 3c. The two that do NOT survive, and are therefore step B's work

1. **`CameraDirector.tsx:572-680` (the frame body) assumes the free rectangle is where the globe belongs, and it is
   computed from the DOM.** On a phone the sheet covers the bottom 82 %, 52 % or 12 % of the screen depending on the
   tier, and the tier is *not* a DOM occluder — reading it as one would move the globe every time the sheet moved.
   Step B therefore installs the **fixed** offset `(0.5 − 0.275)·H` in mobile mode and derives only the DISTANCE
   from a mobile free rect (full width, top 55 % of the height). The fixed-offset-by-tier question is recorded as a
   known limit in `docs/MOBILE.md` rather than implemented.
2. **`src/lib/frameProbe.ts` has no mobile field.** The probe reports `mode: 'live' | 'locked'`; a spec asserting
   "the projected target is at 0.275·H" needs `camera.view` to be non-null and the target's screen y, both of which
   are already exposed (`cameraViewIsNull` at `CameraDirector.tsx:714`, `target()` at `globeProbe.ts:180-183`).

---

## 4. What `singleWriter.test.ts` scans and how

`src/scene/singleWriter.test.ts`.

- **Scans** every `.ts`/`.tsx` under `src/` by walking the tree (`sources()`, `:73-87`), reporting repo-relative
  POSIX paths.
- **Strips comments first**, replacing comment characters with SPACES so line numbers stay true (`stripComments`,
  `:90-94`).
- **Matches a fixed pattern table** (`WRITE_PATTERNS`, `:51-70`) line by line: `camera.position =`,
  `camera.position.set/copy`, `camera.quaternion.*`, `camera.up =`, `camera.zoom =`, `camera.fov =`,
  **`setViewOffset(`**, **`clearViewOffset(`**, **`updateProjectionMatrix(`**, `controls.target.copy/set/lerp`,
  `controls.minDistance =`, `controls.maxDistance =`.
- **Exempts** `ALLOWLIST` (`CameraDirector.tsx`, `GlobeScene.tsx` — `:44-48`) and `*.test.ts(x)`.
- Three further tests: the intent channel must contain no write (`:118-123`); `controls.update()` must be called by
  the director only (`:125-139`); the allowlist must be real and the director must actually write, asserted by
  `toContain('setViewOffset')` (`:141-168`).

So the three patterns step B must forbid outside the director are **already in the table**. What is missing is
(a) they are currently exempted for `GlobeScene.tsx` along with everything else, and (b) there is no negative
fixture proving the scan can fail. Step B narrows (a) and adds (b).

---

## 5. The R3F event source, and `onPointerMissed`

- `<Canvas>` renders a **wrapper `<div>`** (ref `divRef`) and R3F connects its DOM listeners to that div, not to the
  `<canvas>` and not to the parent of the div: `state.events.connect(… divRef.current)`
  (`node_modules/@react-three/fiber/dist/react-three-fiber.esm.js:86`; the `connect` body is at
  `events-776716bd.esm.js:2304-2320`).
- The app's canvas host is `<div id="globe-canvas">` (`App.tsx:100-113`), so the chain is
  `#globe-canvas > div.Canvas-wrapper > canvas`.
- **Therefore the sheet must not be a DOM descendant of `#globe-canvas`.** If it were, a pointerdown on the sheet
  would reach R3F's listener, the raycast would find nothing (the sheet covers the globe), and `onPointerMissed`
  would fire — clearing the selection on every tap on the sheet.
- `onPointerMissed` fires in `handleIntersects` (`events-*.esm.js:1157-1162`): on a **click-class event**
  (`onClick`/`onContextMenu`/`onDoubleClick`) with **zero intersections** and a pointer travel of `≤ 2 px`. The app
  wires it to `onSelect(null)` at `GlobeScene.tsx:622`.
- `pointerdown` also records `internal.initialClick` / `initialHits` (`:1152-1156`), and a click whose target was not
  in `initialHits` is dropped (`:1209-1213`) — this is what makes "drag from the handle, release, no click" free.

---

## 6. The store library, and how each control is wired

**There is no store library.** No zustand, no nanostores, no jotai (grep over `src/` for all three: zero hits). The
pattern throughout is a **module-scope object plus `useSyncExternalStore`**, with a stable snapshot reference:

| store | file | consumers |
|---|---|---|
| insets | `src/layout/useInsets.ts:59-89` | the director reads `getInsets()` imperatively per frame |
| view state / RESET channel | `src/scene/viewStore.ts` | `ResetViewButton.tsx:69` |
| globe look flags | `src/scene/globeLook.ts:314` | `GlobeScene.tsx:208`, `EarthSystem.tsx:47`, `Globe.tsx:68` |
| engine | `src/lib/engine/store.ts:219` | `useScenario` |
| texture timeline | `src/lib/engine/textureTimeline.ts:271` | `GlobeScene.tsx:53` |

Wiring:

| thing | container | action |
|---|---|---|
| ENSO value (the global SST anomaly) | `useScenario`'s `scenario.sstAnomaly`, `src/state/useScenario.ts:31-35,90-113` | `setScenario({ sstAnomaly })` |
| the **global anomaly scrubber** | `Slider` inside `ControlDeck`, `src/components/ControlDeck.tsx:84-94` — `min 0`, `max 3`, `step 0.01`, `label="Global SST Anomaly"` | `onChange={(v) => onChange({ sstAnomaly: v })}` → `App.tsx:167` `onChange={setScenario}` |
| category | `metrics.riskTier` from `riskTier(sst)`, `src/lib/model.ts:105-112` — bands `<0.5`, `<1.0`, `<1.5`, `<2.0`, `<2.6`, else | computed in `computeMetrics`, `model.ts:170` |
| region cards | `RegionCards`, `src/components/RegionCards.tsx:25-43` | `onClick={() => onSelect(id)}` |
| drawer | `RegionDrawer`, `src/components/RegionDrawer.tsx:133-140` | `onClose={() => selectRegion(null)}`, `onSelect={selectRegion}` |
| **exact `selectRegion` path** | `App.tsx:30-36` | `setActiveRegion(prev => { if (prev === id && id !== null) setFocusNonce(n => n + 1); return id })` |

`selectRegion` is a `useState` updater: a repeat click on the ACTIVE region bumps `focusNonce`, which re-fires the
director's selection effect (`CameraDirector.tsx:485-500`). Selecting `null` is the CLOSE rule and is routed by the
focus machine itself. The `focusNonce` bump is exactly the behaviour the drawer switcher deliberately does NOT
reuse for the active chip (`RegionDrawer.tsx:273-277`).

**The global anomaly scrubber exists and is desktop-reachable** — stop condition (c) is not hit. `TopIsland` in
step D binds a second `Slider` to the SAME `setScenario({ sstAnomaly })`, not to a parallel state.

---

## 7. Viewport meta, DPR cap, probe and marker convention

| item | value | where |
|---|---|---|
| `<meta name="viewport">` | `width=device-width, initial-scale=1.0, viewport-fit=cover` — **both present** | `index.html:5` |
| DPR cap | `dpr={[1, 2]}` | `src/scene/GlobeScene.tsx:235` |
| safe-area | **no `env(safe-area-inset-*)` anywhere in `src/`** | grep: zero hits — `SnapSheet` and `TopIsland` introduce the first uses |
| probe install condition | `import.meta.env.VITE_E2E === '1' && new URLSearchParams(location.search).has('debug')` | `GlobeScene.tsx:255` |
| production guard | `scripts/check-assets.mjs:54-78` `FORBIDDEN_HOOKS` (`__globe`, `__look`, `__frame`-family, `__camera`, …) greps `dist/assets/*.js` and fails the build | `check-assets.mjs:150-171` |
| marker convention | a string literal that exists ONLY inside a `VITE_E2E`-gated branch, so it is dead-code-eliminated in production and greppable in the instrumented bundle. `LOCKED_BRANCH_MARKER = 'frame-locked-branch-7f3a'` (`src/layout/framing.ts:45`) is the reference | verified this session: `grep frame-locked-branch-7f3a dist-e2e/assets/*.js` → **1 hit**; same grep on `dist/assets/*.js` → **0 hits** |
| the two output dirs | `dist/` = production (`pnpm build`), `dist-e2e/` = instrumented (`pnpm build:e2e`, forced `--outDir` at `scripts/build-e2e.mjs:44`) | `playwright.config.ts:74-88` |

Step C adds one marker of this shape, `mobile-snap-probe-3m1`, plus the hook name `__mobileSheet`, and asserts both
the 0-in-`dist` / present-in-`dist-e2e` counts.

---

## 8. Where the batched runner lists spec files, and how its timeouts are derived

- **Listing**: `selectSpecs(filters)` at `scripts/e2e-batched.mjs:58-64` reads `tests/e2e/` with
  `readdirSync`, keeps `*.spec.ts`, sorts, and filters by filename substring. It is therefore **directory-driven**:
  a new file in `tests/e2e/` is picked up with no registry edit. There are **18** such files today.
- **Timeouts**: `fileTimeoutMs(file)` at `scripts/lib/e2e-batch-core.mjs:243-250` reads
  `FILE_TIMEOUTS_MS` (`:168-193`) and falls back to `DEFAULT_FILE_TIMEOUT_MS = 10 min` (`:196`). The table is funded
  per file at ~2× its measured wall (`boot` 900 s, `look` 636 s, `focus-ux` 634 s, `pin-click` 1 200 s, …), and the
  rule is stated in the file. `E2E_FILE_TIMEOUT_MS_OVERRIDE` forces a value for control runs.
- **Counts**: `expectedCounts()` at `e2e-batched.mjs:666-703` holds the per-file expected test count and the summary
  compares it to Playwright's own footer. A file absent from that table reports `?`, so a new spec must be added
  there as well as to `FILE_TIMEOUTS_MS`.
- **Summary archive**: `.cache/e2e-archive/<utc>-batched-summary.json` (`:492-512`), outside any `outputDir`.

---

## 9. Stop conditions

| # | condition | verdict |
|---|---|---|
| **a** | FIX2 is not merged | **NOT HIT.** Five commits, both features present — §1. |
| **b** | the desktop centring cannot take a second free rect without changing desktop pixels | **NOT HIT.** The second rect is a *branch* in the director: mobile installs a fixed offset and a mobile-rect `d_fit`; the desktop body runs verbatim behind `if (mode === 'mobile') … else { existing }`, so no desktop pixel can move. `camera.view` also stays `null` on desktop because the mobile branch never runs there. |
| **c** | no global anomaly scrubber or equivalent exists on desktop | **NOT HIT.** `ControlDeck.tsx:84-94`, bound to `setScenario({ sstAnomaly })` — §6. |

Proceeding to step A.
