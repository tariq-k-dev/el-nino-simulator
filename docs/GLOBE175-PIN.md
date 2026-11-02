# GLOBE175-PIN — measurement report

Prompt: `docs/prompts/globe175-pin.md` (GLOBE175-PIN v1). READ-ONLY measurement step: no source, spec,
config or runner file was edited. `globe.spec` was not touched. All probes, worktrees and drivers live
under `D:\Dev\Handshake\_triage`, outside the repo.

Base commit: `89cb5e8` (`docs: N10-TRIAGE — isolated re-measurement of the batched reds`).

## 0. Environment and load

| item | value |
|---|---|
| host | Windows 11, Git Bash, node v24.22.1, pnpm 12.4.2 |
| browser | Playwright 1.64.1 chromium, `--use-gl=swiftshader --enable-unsafe-swiftshader` |
| harness | one detached `git worktree` per commit under `_triage/wt-pin-<sha>`; `pnpm install --frozen-lockfile`; `pnpm build:e2e`; isolated `npx playwright test tests/e2e/globe.spec.ts --grep "<case>"` on a dedicated port |
| load sampling | 5 × 1 s CPU samples (GetSystemTimes) + free RAM before and after every run, per `_triage/driver.py` |
| load, measured | CPU mean 4.4–20.8 %, max single sample 53.7 %; free RAM 11.49–15.76 GB; memory load 47–62 % |
| ports | 5300–5320 (arms), 5400+ (bisect), 5600–5640 (probes); each freed before and after, `free_now: true` recorded every time |

No run was excluded for load. The one 53.7 % sample landed in a `sample()` bracket after a build, not
inside a test run.

## 1. Step 1 — read only

### 1a. `tests/e2e/globe.spec.ts:175` — `pinch at 375x667 changes the distance`

- **Context**: `browser.newContext({ viewport: {375, 667}, hasTouch: true, isMobile: true, deviceScaleFactor: 3 })`.
  The comment at `:176–184` states that a non-touch context accepts `Input.dispatchTouchEvent` and
  `Input.synthesizePinchGesture` and then silently discards them.
- **Touch coordinates**: not fixed. `:211–228` scans the canvas rect on a 20 px grid from
  `(round(r.x)+10, round(r.y)+10)` to `(r.x+r.width-10, r.y+r.height-10)`, keeps cells where
  `document.elementFromPoint(x,y) === canvas`, takes `minY` of the survivors, and returns the **horizontal
  midpoint of that topmost row** as `{x, y}`. The relation to the viewport is therefore *derived at run
  time* from the layout, and the spec's own comment (`:198–209`) records that a centre pinch reaches the
  panel, not the canvas.
- **Primary gesture**: `Input.synthesizePinchGesture` at that point, `scaleFactor: 2.2`,
  `relativeSpeed: 800`, `gestureSourceType: 'touch'` (`:242–248`). 2.2 > 1 → **spread**.
- **Fallback gesture** (`:256–281`), used when `|after − before| < 0.02`: `Input.dispatchTouchEvent`
  touchStart with two points at `(cx−20, cy)` and `(cx+20, cy)`, six touchMoves widening to
  `(cx±90, cy)`, then touchEnd. Also a **spread**, symmetric about the chosen point, ±20 px start and
  ±90 px end.
- **Expected sign and threshold**: no sign is asserted. `:283–287` is
  `expect(after).not.toBeCloseTo(before, 2)` — the distance must move by more than ~0.005 in *either*
  direction. A spread is expected to reduce `d` (zoom in), but the assertion would accept an increase.
- **Second assertion** (`:289–300`): computed `touch-action` must be `none` on the canvas *and* on
  `#globe-canvas`.

### 1b. Camera controller, pinch/zoom, `touch-action`, `dMin`/`dMax`/`d_fit`

- **Pinch/zoom is OrbitControls', not custom code.** `src/scene/GlobeScene.tsx:726–727`:
  `minDistance={EARTH_RADIUS * 1.25}` (= 1.25) and `maxDistance={EARTH_RADIUS * 5}` (= 5).
  The director only runs `controls.update()` for non-travelling states
  (`src/scene/CameraDirector.tsx:715`) — that is what applies OrbitControls' own damping to wheel/pinch.
- **`touch-action`**: `CanvasTouchAction` (`GlobeScene.tsx:767–813`) re-asserts
  `el.style.touchAction = 'none'` and `overscrollBehavior = 'contain'` on the canvas after OrbitControls
  mounts, and keeps re-asserting it, because `three-stdlib`'s `dispose()` writes `auto` back. Wrapper:
  `App.tsx:126` `style={{ touchAction: 'none', overscrollBehavior: 'contain' }}`, plus `src/index.css:42`.
  Measured at all three commits: canvas `none` (inline `none`), wrapper `none`, body/html `auto`.
- **`d_fit`** — `computeMobileFit` (`src/mobile/mobileFrame.ts:94–120`):
  `dContain = dContainFor(rect.radiusBudget, focalPxFor(H, FOV_DEG), MOBILE_ENVELOPE)`, `dFit = dContain`,
  `dMaxMode = max(MAX_DISTANCE, 1.25 · dContain)`. `applyMaxDistance` (`CameraDirector.tsx:385–406`) is
  the single writer of `controls.maxDistance`; the mobile branch calls it every frame
  (`:760`), the desktop branch restores `MAX_DISTANCE` (`:879`).
- **`dMin`/`dMax` at 375x667, measured**: `dFit = 3.353356527421443`, `dMax = 5`, `minDistance = 1.25`,
  `clampedByMax: false`, `degenerate: false`.

### 1c. `git log --oneline --stat 5e7c826..270ab35`

32 commits. Marked below: camera / controls / pointer / touch / layout / isMobileMode / canvas wrapper.

| commit | subject | touches |
|---|---|---|
| `270ab35` | B+C: compact header, free-rect camera fit, unclamped dMax, shared sheet body, landscape dock | **camera, layout, canvas wrapper, isMobile** — `CameraDirector.tsx`, `mobileFrame.ts`, `layout/frame.ts`, `layout/framing.ts`, `App.tsx`, `HeaderCompact.tsx`, `SnapSheet.tsx`, `SheetBody.tsx`, `MobileShell.tsx`, `TopIsland.tsx`, `LandscapeDock.tsx`, `snapMath.ts`, `frameProbe.ts` (22 files) |
| `337f536` | A: the pure layout law — mode, free rect, radius budget, dock width, peek clamp, delta conversion | **layout** — `mobile/layoutMath.ts` + test |
| `f84a3a4` | P1: audit the MOBILE1 surface, the shared controls and the d-dependent items | docs only |
| `cf8b0a6` | P0: save prompt 2B-STEP3-MOBILE2 verbatim | docs only |
| `f7a8332` | F: the full run's six reds, attributed one by one | **docs only** — `docs/E2E.md`, `docs/STEP3-STATUS.md` |
| `8bc8e60` | F: append the mobile notes to E2E.md and STEP3-STATUS.md | docs only |
| `6e46f7c` | F: docs/MOBILE.md | docs only |
| `133b2fe` | E: make M10 a real assertion and fund the spec on two measured walls | spec + runner |
| `959bbef` | E: the mobile snap-sheet acceptance spec (M1-M10), registered in the batched runner | spec + runner |
| `f5b9a48` | D: the floating HUD island and the mobile shell, with the desktop overlays gated out | **isMobile, canvas wrapper, layout** — `App.tsx`, `MobileShell.tsx`, `TopIsland.tsx` |
| `90b7932` | C: the snap sheet and its native pointer engine | **pointer/touch** — `SnapSheet.tsx`, `useSheetDrag.ts` |
| `be1b3d2` | B: mobile view offset in the director, with the sign proven by projection | **camera** — `CameraDirector.tsx`, `mobileFrame.ts`, `framing.ts`, `frameProbe.ts` |
| `8488e10` | A: snap-sheet arithmetic and the island's ENSO text, with 57 unit tests | layout maths (`snapMath.ts`, `ensoHud.ts`) |
| `ef09ab3` | P1: mobile audit | docs only |
| `96c4ffc` | P0: step3-mobile1 prompt | docs only |
| `72b667c` | fix(scene): attach native DOM listeners to hotspot HTML label buttons | **pointer** — `Hotspot.tsx` |
| `ce85442` | fix(scripts): add explicit type cast for Polars date column max() | scripts only |
| `27acd39` | C2: fund pin-click's 7 cases and record the batched run | runner + docs |
| `7362d13` | C: docs for the pin proxy and the corrected gate | docs |
| `7bde152` | WAIVER W5: pin-click spec rewritten for the proxy | spec |
| `1a3b44f` | A: pin hit proxy gated on the facing band | **pointer** — pin proxy |
| `282528b` | P0: step3-b2-fix2-cont prompt | docs |
| `783a605` | B: in-drawer region switcher | `App.tsx` |
| `9e291a9` | A: step3-b2-fix2 audit | docs |
| `7a143bc` | P0: step3-b2-fix2 prompt | docs |
| `54a93f2` | F: docs for the fix1 step | docs |
| `a9df3ab` | E: D10 diagnostic report | docs |
| `199187e` | D: measure pin clicks and record the hypothesis verdicts | docs + probe |
| `dcf2214` | C: audit the card occlusion and STOP before any fix | docs |
| `aad1338` | B: Reset View returns to the exact load state | **camera, layout, canvas wrapper** — `CameraDirector.tsx`, `GlobeScene.tsx`, `App.tsx`, `Header.tsx`, `framing.ts`, `frameProbe.ts` (15 files) |
| `9d6bbaf` | A: runner hardening | runner |
| `2a76c2e` | P0: step3-b2-fix1 prompt | docs |

**MOBILE1 (`f7a8332`) is inside the range** — position 5 counting back from `270ab35`, and it is a
**docs-only** commit (no source, spec or config file).

## 2. Step 2 — the bounds, verified before trusting them

Isolated single-case runs, 3 per commit, fresh worktree, fresh `build:e2e`, port per run.

| commit | run 1 | run 2 | run 3 | verdict |
|---|---|---|---|---|
| `ce85442` | green, 18.0 s | green, 11.2 s | green, 11.2 s | **3/3 GREEN** |
| `270ab35` | red `3.3534 -> 3.3534`, 12.0 s | red `3.3534 -> 3.3534`, 12.0 s | red `3.3534 -> 3.3534`, 12.1 s | **0/3 RED, zero-motion signature** |

Both expectations held, so the range was **not** widened to `5e7c826..414caf5`. The control arm at
`5e7c826` was run anyway for Step 5: **3/3 green** (11.5 / 11.4 / 11.2 s).

## 3. Step 3 — bisect

Pre-registered rule applied verbatim: GOOD = 3/3 green; BAD = 0/3 red with the zero-motion signature;
anything else = MIXED. 4 steps, no MIXED, no SKIP-UNBUILDABLE (every candidate installed and built).

| commit | verdict | raw outcomes (3 runs) | load (CPU mean before/after, free RAM) |
|---|---|---|---|
| `ce85442` (base) | GOOD | from Step 2 | 12.8/12.0 %, 11.63/11.71 GB |
| `8488e10` | **GOOD** | green / green / green (12.5, 11.1, 11.7 s) | 6.1/9.9, 9.4/10.9, 12.1/7.0 %; 12.04–12.23 GB |
| `90b7932` | **GOOD** | green / green / green (12.9, 11.6, 11.7 s) | 12.3/11.5, 9.8/10.6, 11.1/12.0 %; 11.59–12.00 GB |
| `f5b9a48` | **BAD** | red `3.3534->3.3534` ×3 (13.9, 13.0, 14.2 s) | 10.4/9.7, 10.6/9.5, 9.2/5.1 %; 11.49–11.79 GB |
| `959bbef` | BAD | red `3.3534->3.3534` ×3 (12.7, 12.7, 12.6 s) | 9.5/5.4, 9.8/11.9, 4.4/11.0 %; 12.19–12.24 GB |
| `270ab35` (tip) | BAD | from Step 2 | 9.4/9.9, 9.4/6.8, 10.5/10.0 %; 12.18–12.27 GB |

**Last good: `90b7932`** — "C: the snap sheet and its native pointer engine".
**First bad: `f5b9a48`** — "D: the floating HUD island and the mobile shell, with the desktop overlays
gated out" (`f5b9a4823398fcc1dcb348cc202ef1b72ea8b61e`).

## 4. Step 4 — mechanism at the first-bad commit and its parent

Throwaway Playwright script (`_triage/pin-probe.mjs`) against each commit's own `dist-e2e`, 375x667,
`hasTouch: true, isMobile: true, dSF 3`, `/?debug`. Event counts come from an injected capture-phase
listener in the page, not from a repo edit.

| measurement | `90b7932` (parent, GOOD) | `f5b9a48` (first bad) | `270ab35` (HEAD) |
|---|---|---|---|
| open-pixel cells / topmost-row width | 94 / **18** (x = 10…350) | 430 / **2** (x = 10, 30) | 359 / **1** (x = 10) |
| chosen point `(cx, cy)` | (190, 10) | (30, 10) | (10, 10) |
| `elementFromPoint(cx)` | CANVAS, `pe: auto`, `ta: none` | CANVAS, `pe: auto`, `ta: none` | CANVAS, `pe: auto`, `ta: none` |
| `elementFromPoint(cx−20)` | CANVAS | CANVAS | **`HTML.dark`** (x = −10, off-screen; `elementFromPoint` returns null) |
| `elementFromPoint(cx+20)` | CANVAS | **`DIV.pointer-events-auto flex flex-col items-center`**, inside `pointer-events-none fixed inset-x-0 top-0 z-40` | **`DIV` header button (`h-9 w-9 … rounded-xl`), `data-occluder="compact-header"`** |
| canvas `touch-action` / wrapper | `none` / `none` | `none` / `none` | `none` / `none` |
| canvas inline `touch-action` | `none` | `none` | `none` |
| `synthesizePinchGesture` Δd | 0.0000 | −8.9e−16 | −8.9e−16 |
| pointerdown / touchstart total | 3 / 3, all on canvas | 3 / 3 (2 on canvas) | 3 / 3 (1 on canvas) |
| manual spread Δd | **3.3534 → 1.2500 (Δ −2.1034)** | **0** | **0** |
| `pointercancel` during the manual spread | 0 | 0 | **2** |
| `d` / `dFit` / `dMax` | 3.3534 / 3.3534 / 5 | 3.3534 / 3.3534 / 5 | 3.3534 / 3.3534 / 5 |
| at a clamp? | no (`clampedByMax: false`; d = dFit, far from 1.25 and 5) | no | no |

### Verdict: **M3 COORDINATES**

The gesture path is intact — the canvas and wrapper both claim `touch-action: none`, the canvas receives
the pointer stream, and at the parent the *same* synthesised pinch moves `d` by 2.1034. What changed at
`f5b9a48` is where the spec's two touch points land. The floating HUD island makes the top band
non-empty, so the open-pixel search collapses from an 18-cell row to a 2-cell row (then a 1-cell row at
HEAD), the chosen `cx` walks left to 30 and then 10, and the spec's fixed `cx ± 20` pair straddles the
island (`f5b9a48`) and then the compact header (`270ab35`). At HEAD `cx − 20 = −10` is off-screen and
`cx + 20 = 30` is the header's icon button; the browser then issues `pointercancel` ×2 and OrbitControls
never sees a two-finger sequence.

Ruled out: **M1** (events do reach the canvas — 3 pointerdowns, and the parent moves `d`), **M2**
(`dMax = 5`, `d = 3.3534`, `clampedByMax: false`; neither clamp is in play), **M4** (no commit message or
prompt in `5e7c826..270ab35` states pinch was moved, disabled or replaced — `f5b9a48`'s message is about
the HUD island and the shell).

### The diff that explains it

Import chain: `tests/e2e/globe.spec.ts:175` → `#globe-canvas canvas` (the element `elementFromPoint`
must return) → `src/App.tsx` → `src/mobile/MobileShell.tsx` → `src/mobile/TopIsland.tsx` (at `f5b9a48`)
/ `src/mobile/HeaderCompact.tsx` (at `270ab35`).

`f5b9a48` changes exactly three files (`git show --stat`): `src/App.tsx`, `src/mobile/MobileShell.tsx`,
`src/mobile/TopIsland.tsx`. The relevant hunk is the `isMobile` gate in `App.tsx`:

```diff
+  const layoutMode = useSyncExternalStore(subscribeLayoutMode, getLayoutMode, getLayoutMode);
+  const isMobile = layoutMode === 'mobile';
...
+      {isMobile ? (
+        <MobileShell scenario={scenario} metrics={analytics.metrics} … />
+      ) : null}
```

`MobileShell` → `TopIsland` renders a `pointer-events-none fixed inset-x-0 top-0 z-40` band with
`pointer-events-auto` children. At `270ab35` that band is `HeaderCompact`, whose first row is
`pointer-events-auto flex min-w-0 items-center gap-2` at `px-3` with an `h-9 w-9` icon — the element at
`(30, 10)`. `pointer-events: none` on the band does **not** help: the children re-enable it, and the
spec's search only asks for pixels where the hit test returns the *canvas*.

## 5. Step 5 — product reality check

`hasTouch: true`, `isMobile: true`, CDP `Input.dispatchTouchEvent`, two-finger spread (20 → 90 px) and
contract (90 → 20 px) at the globe's **projected centre** (`__globe.project([0,0,0])`), 3 each, 700 ms
settle.

### HEAD (`270ab35`)

| viewport | gesture | run | d before | d after | Δ signed | at clamp |
|---|---|---|---|---|---|---|
| 375x667 | spread | 1 | 3.3534 | **1.2500** | −2.1034 | yes, `minDistance` |
| 375x667 | spread | 2 | 1.2500 | 1.2500 | 0.0000 | yes, `minDistance` |
| 375x667 | spread | 3 | 1.2500 | 1.2500 | 0.0000 | yes, `minDistance` |
| 375x667 | contract | 1 | 1.2500 | **3.5823** | +2.3323 | no |
| 375x667 | contract | 2 | 3.5823 | **5.0000** | +1.4177 | yes, `maxDistance` |
| 375x667 | contract | 3 | 5.0000 | 5.0000 | 0.0000 | yes, `maxDistance` |
| 390x844 | spread | 1 | 3.3534 | **1.2500** | −2.1034 | yes, `minDistance` |
| 390x844 | spread | 2–3 | 1.2500 | 1.2500 | 0.0000 | yes, `minDistance` |
| 390x844 | contract | 1 | 1.2500 | **3.5823** | +2.3323 | no |
| 390x844 | contract | 2 | 3.5823 | **5.0000** | +1.4177 | yes, `maxDistance` |
| 390x844 | contract | 3 | 5.0000 | 5.0000 | 0.0000 | yes, `maxDistance` |

Event counts at the centre: `pointerdown` 2 and `touchstart` 2 per gesture, all on the canvas; the globe
centre is `CANVAS` with `touch-action: none` at both viewports. Zero-motion runs 2 and 3 of each
direction are the clamp, not a failure — the camera was already at 1.25 (spread) or 5.0 (contract).

### Wheel, HEAD

| viewport | gesture | d before | d after | Δ signed |
|---|---|---|---|---|
| 1440x900 | 6 notches in | 3.3534 | 2.7035 | −0.6499 |
| 1440x900 | 8 notches out | 2.7035 | 3.6030 | +0.8996 |
| 375x667 | 6 notches in | 3.3534 | 2.7035 | −0.6499 |
| 375x667 | 8 notches out | 2.7035 | 3.6030 | +0.8996 |

### Control (`5e7c826`)

| viewport | gesture | runs | d before | d after | Δ | note |
|---|---|---|---|---|---|---|
| 375x667 | spread ×3 | 3 | 3.3534 | 3.3534 | 0.0000 | **0 pointerdown / 0 touchstart reached the canvas** |
| 375x667 | contract ×3 | 3 | 3.3534 | 3.3534 | 0.0000 | same |
| 390x844 | spread ×3 | 3 | 3.3534 | 3.3534 | 0.0000 | same |
| 390x844 | contract ×3 | 3 | 3.3534 | 3.3534 | 0.0000 | same |

The `5e7c826` centre is covered: `elementFromPoint(188, 334)` returns a `path` inside the control deck
(`data-occluder="left-panel"`), and at 390x844 a `DIV.relative` in the same deck. **The control arm is
therefore not a like-for-like measurement of pinch** — it measures "the globe centre is behind the
desktop control deck in the pre-mobile layout", which is the layout the mobile work replaced. It is
recorded as printed and not used to argue anything about pinch.

### Verdict: **PINCH WORKS IN PRODUCT (spec issue only)**

Two-finger spread and contract both move the camera at the globe's centre, at both viewports, with the
full pointer stream reaching the canvas and the expected clamp at each end. The red at `globe:175` is
produced by the spec's own coordinate heuristic, not by the product.

## 6. Step 6 — `globe:305`

**Shared code path?** Yes, at the level that matters, with one different writer:

- Both gestures end in `controls.update()` — pinch/wheel through the non-travelling branch
  `src/scene/CameraDirector.tsx:715`, and the fly-to's own distance channel through the same
  `controls.update()` inside `withOwnWrite` at `:786` (mobile) / `:950` (desktop).
- Both are bounded by the same pair: `controls.minDistance = 1.25` and `controls.maxDistance = 5`
  (`GlobeScene.tsx:726–727`), the latter re-written on mobile by `applyMaxDistance`
  (`CameraDirector.tsx:385–406`, called at `:760`, restored to `MAX_DISTANCE` at `:879`).
- The fit's distance channel clamps `frame.dTarget` with
  `THREE.MathUtils.clamp(frame.dTarget, controls.minDistance, controls.maxDistance)` at
  `CameraDirector.tsx:783` (mobile) and `:943` (desktop) — the same clamp object, so a fit can never
  park the camera outside the range a wheel or pinch can reach.

**`globe:305` alone at HEAD, 5 runs**: **5/5 green** (11.3, 11.2, 11.3, 11.0, 11.4 s), rc 0 each, load
4.8–11.4 % CPU mean, 15.55–15.76 GB free.

**Signed distance delta, printed** (my reproduction of the case at 1440x900, 6 notches out):

| run | d before | d after | Δ signed |
|---|---|---|---|
| 1 | 3.3822 | 3.3809 | **−0.00132** |
| 2 | 3.3821 | 3.3809 | **−0.00117** |
| 3 | 3.3793 | 3.3809 | **+0.00163** |
| 4 | 3.3817 | 3.3839 | **+0.00214** |
| 5 | 3.3821 | 3.3809 | **−0.00125** |

At 1280x720 (the config's default viewport): 3.3673 → 3.3665, **Δ −0.00089**.

No conclusion is drawn beyond this, per the prompt. Two printed facts worth a later reader's attention:
the deltas are ~10× smaller than the 0.02 the spec asserts, and `userZoomed` reads `false` both before
and after — so the passing assertion and the printed delta are not obviously measuring the same thing.
That is a question for the spec's author, not a finding of this step.

## 7. UNMEASURED

| item | status |
|---|---|
| Step 2 widened range `5e7c826..414caf5` | not run — the primary bounds both held, so widening was not triggered |
| Step 4 `dMin`/`dMax` from the probe's `free`/`radiusBudget` channel | **NOT MEASURED** — `__frame.snapshot()` reports `free: {0,0,0,0}`, `radiusBudget: 0`, `headerBottom: 0` at all three commits including the two that pass. `dFit`/`dMax` read correctly, so the distance channel is live and the free-rect channel is not populated in these runs. The clamp question was answered from `controls.minDistance`/`maxDistance` and `clampedByMax` instead |
| Step 5 control arm as a pinch measurement | **NOT MEASURED** — the `5e7c826` globe centre is behind the control deck; 0 events reached the canvas. Printed, not used |
| `synthesizePinchGesture` as a working gesture | **NOT MEASURED at any commit** — Δd was 0 or −8.9e−16 at all three, and the counters show 1 touchstart with 0 touchmove, i.e. the CDP pinch synthesises a single-point tap here. The spec's fallback is what actually exercises pinch, at every commit including the green ones |
| Step 6 signed delta from the spec itself | **NOT MEASURED** — the spec prints no delta; the table above is my reproduction, not the spec's own output |

## 8. Proposed fix design (NOT implemented)

1. Replace the spec's "topmost open row, midpoint" heuristic with the largest open **rectangle** (or the
   open cell whose 4-neighbourhood is also open), so a 1-cell row cannot be chosen.
2. Require the chosen point to have `cx ± 20` also on the canvas before the fallback pair is dispatched —
   a guard that fails loudly ("no 40 px open span") instead of silently measuring nothing.
3. Better: dispatch the fallback pair **vertically** (`cy ± 20`) when the horizontal span is too narrow,
   since the header is a horizontal band and the sheet is at the bottom.
4. Or drop the fixed ±20 offset and derive the gap from the open span (e.g. `min(20, span/3)`).
5. Keep the `touch-action` assertions and the `not.toBeCloseTo` threshold as they are.
6. Optional product-side hardening, independent of the spec: the compact header's `pointer-events-auto`
   row could stay `none` over empty space so the top band reaches the canvas — but that is a product
   decision, not a spec fix, and it is not needed for pinch to work.

**Would the fix require editing the locked `globe.spec`?** Yes — items 1–4 are all inside
`tests/e2e/globe.spec.ts:211–281`. That needs a **pre-registered waiver**. No source change is required
for the product behaviour, which is already correct at HEAD.

## 9. Arms and counts

| arm | expected | passed | failed | skipped |
|---|---|---|---|---|
| `ce85442` Step 2 | 3 | 3 | 0 | 0 |
| `270ab35` Step 2 | 3 | 0 | 3 | 0 |
| `5e7c826` control | 3 | 3 | 0 | 0 |
| `8488e10` bisect | 3 | 3 | 0 | 0 |
| `90b7932` bisect | 3 | 3 | 0 | 0 |
| `f5b9a48` bisect | 3 | 0 | 3 | 0 |
| `959bbef` bisect | 3 | 0 | 3 | 0 |
| `270ab35` `globe:305` | 5 | 5 | 0 | 0 |

`skipped` is 0 everywhere; the runner printed no `skipped` field (it omits the line when nothing is
skipped), so the 0 is read from the absence of skips rather than from a printed zero.

## 10. Gate

Run as four separate calls on a clean tree at the commit that adds this document, after the seven
worktrees were removed with `git worktree remove --force` and `git worktree prune`:

| command | exit | tail |
|---|---|---|
| `pnpm tsc -b` | 0 | no output |
| `pnpm lint` | 0 | `$ eslint . --max-warnings 0` |
| `pnpm test` | 0 | `Test Files 49 passed (49)` / `Tests 1097 passed (1097)` |
| `pnpm build` | 0 | `OK no test hooks in 3 production JS assets` / `OK all 17 assets within Cloudflare Pages limits` |

`git status --porcelain` is empty at that commit.

