# The mobile layout (below 768 px)

Step `2B-STEP3-MOBILE1`. On a phone the product is a full-bleed globe, a floating HUD capsule at the top
centre, and a snap sheet along the bottom. The desktop layout is untouched.

Everything below is either a constant in one module or a measurement recorded with the run that produced it.

---

## 1. Constants, and where they live

All of them are in `src/mobile/snapMath.ts` unless the row says otherwise. Nothing is duplicated: the
Tailwind breakpoint, the media query, the director and the spec all read these.

| name | value | what it is |
|---|---|---|
| `BREAKPOINT_MAX` | `767.98` | the narrowest DESKTOP width, minus 0.01. A media query is evaluated against a fractional CSS width, so at 767.99 px a `max-width: 767px` test is false and desktop would get a phone's sheet for two hundredths of a pixel |
| `MOBILE_QUERY` | `(max-width: 767.98px)` | the one string the single `matchMedia` listener uses (`src/scene/viewStore.ts:178`) |
| `TIER_FRACTION` | peek `0.18`, half `0.48`, full `0.88` | visible fraction of the viewport height, per tier |
| `SHEET_HEIGHT_FRACTION` | `0.88` | the sheet's own height, as a fraction of `H`. Equal to the full tier's fraction, so full sits at `translateY(0)` with a 0.12·H band of globe still visible above it |
| `MOBILE_FREE_TOP_FRACTION` | `0.55` | the rectangle the globe may occupy: full width, the top 55 % of the height |
| `VIEW_CENTER_FRACTION` | `0.55 / 2` = `0.275` | where the globe's centre sits, as a fraction of `H` |
| `TAP_MAX_MOVE_PX` / `TAP_MAX_MS` | `6` / `300` | a gesture that moves less than 6 px in under 300 ms is a tap, and a tap cycles the tier |
| `FLICK_PROJECTION_MS` | `120` | the projection window a release velocity is extrapolated over |
| `RUBBER_ASYMPTOTE_FRACTION` | `0.25` | the overscroll asymptote, as a fraction of `H` |
| `SNAP_DURATION_MS` / `SNAP_EASING` | `320` / `cubic-bezier(0.22,1,0.36,1)` | the snap animation; 0 ms under `prefers-reduced-motion` |
| `VELOCITY_SAMPLES` / `VELOCITY_WINDOW_MS` | `5` / `100` | the trailing velocity ring |
| `MOBILE_SNAP_MARKER` | `mobile-snap-probe-3m1` | `src/mobile/SnapSheet.tsx:44`; 0 occurrences in `dist`, 1 in `dist-e2e` |
| DPR cap | `[1, 2]` | `src/scene/GlobeScene.tsx:235` |
| viewport meta | `width=device-width, initial-scale=1.0, viewport-fit=cover` | `index.html:5` |

### The snap points, at 390 × 844

`computeSnapPoints(H)` returns `translateY` in px:

    full = (0.88 − 0.88) · 844 =   0.00   -> rect.top  101.28
    half = (0.88 − 0.48) · 844 = 337.60   -> rect.top  438.88
    peek = (0.88 − 0.18) · 844 = 590.80   -> rect.top  692.08

The three `rect.top` values are the step's M4 numbers (692 / 439 / 101), measured to ±2 px.

### The view offset

    free rect   = (0, 0, W, 0.55·H)
    its centre  = (W/2, 0.275·H)      -> dy = 0.275·H − 0.5·H = −0.225·H
    installed   = camera.setViewOffset(W, H, 0, +0.225·H, W, H)

The sign was **measured, not reasoned** (`.cache/mob/probe-offset.mjs`), by projecting the world origin
through a real `PerspectiveCamera(42, 390/844, 0.1, 400)` at the shipped position:

| offset applied | projected y | error from the wanted 232.100 |
|---|---|---|
| none | 422.000 | 189.900 |
| `setViewOffset(…, −189.90)` | 611.900 | 379.800 — wrong direction, and by 2× |
| `setViewOffset(…, +189.90)` | **232.100** | **0.000** |
| `clearViewOffset()` | 422.000 | 189.900 |

So a POSITIVE `offsetY` moves the projected content UP. The spec re-derives the result from the live camera
rather than trusting the constant: M2 asserts the projected orbit target sits at `0.275·H` within 1.5 px.

The sub-window is the FULL width and height (`setViewOffset(W, H, 0, dy, W, H)`), never a smaller one — a
smaller sub-window also changes the zoom, which would make `d_fit` wrong by the ratio of the two heights.

---

## 2. The state machine

The sheet has exactly three tiers and one gesture surface. `tier` is React state in `SnapSheet`; **everything
else during a drag is a direct DOM write.**

```
            tap / Home                      tap / ArrowUp
   peek  ─────────────────▶  half  ─────────────────▶  full
     ▲                        │  ◀─────────────────────  │
     └────────────────────────┘   drag past the midpoint,   │
              drag back            or a flick, or End ──────┘
```

The tier a release resolves to is `resolveSnap(y, v, points)`:

1. project `y + v · 120 ms`, so a fast flick lands a tier further along than where the finger stopped;
2. clamp the projection to `[full, peek]`, so a large velocity cannot wrap past an end;
3. pick the nearest snap point.

A **tap** (under 6 px, under 300 ms) does not snap to the nearest point — it cycles: peak → half → full →
half. Full returns to half rather than to peek because a tap at full is a request for more map.

The snap points are derived from `H` on every resize, never cached, because a pixel tier would be wrong on
every phone but the one it was tuned on.

---

## 3. The event flow, gesture by gesture

### A drag on the handle

The handle zone (`role="slider"`, `touch-action: none`, ≥ 44 px tall) is the ONLY drag surface.

| step | what happens |
|---|---|
| `pointerdown` | ignore a secondary pointer or an already-active drag; `setPointerCapture(pointerId)` in a `try` (it throws `InvalidPointerId` on a fast tap on a busy page, and that must not abort the drag); record `startY`, `startTranslate`, `startedAt`; set `transition: none`, `will-change: transform` |
| `pointermove` | `y = clampDrag(startTranslate + ΔclientY)`; write `el.style.transform` directly. **No `setState`.** Push to the 5-sample / 100 ms velocity ring |
| `pointerup` / `pointercancel` / `lostpointercapture` | all three call ONE idempotent `finish()` |

`finish()` releases the capture (guarded by `hasPointerCapture`), computes the target tier, writes the snap
transform with the 320 ms transition, and calls `onTierChange` **once** — which is the only render a gesture
is allowed to cause. On a real device more than one of the three end events fires for the same gesture, so
`finish()` is idempotent through the `active` flag: otherwise the second call would snap with a velocity of 0
from an already-finished gesture and land on the nearest tier instead of the flicked one.

`pointercancel` and `lostpointercapture` pass velocity **0**: the browser took the gesture away, so the
honest choice is the nearest point from where the finger actually was.

### A drag on the canvas

At every tier the region above the sheet is the canvas, and touches there reach `OrbitControls` — the sheet
is a SIBLING of the `<Canvas>` wrapper, and its overlay wrapper is `pointer-events: none`. Measured: at peek a
touch at y = 400 orbits the camera (M4), and a drag at y = 200 moves the camera without moving the sheet (M6).

### A scroll at full

The body is `touch-action: pan-y` + `overscroll-behavior: contain` + `overflow-y: auto`, so the browser owns
the scroll with its momentum contained to the sheet. A scroll at full increases `scrollTop` and moves neither
the sheet's transform nor the camera pose (M7).

### The HUD island

The capsule is a `<button>` with `aria-expanded`; a tap expands it to the global anomaly scrubber, bound to
the same `setScenario({ sstAnomaly })` action as the desktop deck and the sheet's own slider. One action,
three surfaces, nothing to keep in sync.

---

## 4. The single-writer rule, extended to the projection matrix

`src/scene/projectionWriter.test.ts` scans `src/` for three patterns —

    .setViewOffset(        .clearViewOffset(        .updateProjectionMatrix(

— and fails on any hit outside `src/scene/CameraDirector.tsx`. The rule is the 3B single-writer rule one
matrix down: a second writer could un-centre the globe between two frames with nothing in the source saying
so. The scanner is vetted on two inline fixtures — a file that MUST fail and one that must pass — so the
proof of the guard's ability to fail travels with the guard.

The sheet, the island and the desktop overlays never touch the camera. They publish layout state only.

---

## 5. Known limits (recorded, not fixed)

1. **The globe is wider than a 390 px screen at the mobile fit.** The free rect allows `rMax = 171.0 px` of
   radius; the `dMax` ceiling of 5 renders a 248.5 px radius, so the disc spills 77.5 px past the free rect
   on each side and its 497 px diameter exceeds the 390 px viewport (`mobileFrame.test.ts` asserts all three
   numbers). Consequence the spec had to account for: the PACIFIC pin projects to `x = −9` at 390 × 844 —
   nine pixels off the left edge — so M3 taps only pins whose projected pixel is inside the viewport and
   above the sheet, and REPORTS the excluded ones rather than silently dropping them.
2. **The view offset does not follow the tier.** It is a fixed 0.225·H at every tier. A moving principal
   point is a moving picture: the globe would slide under the reader's thumb on every snap, and a pin they
   had just tapped would no longer be where they tapped it. Animating it per tier is explicitly out of scope.
3. **A 667 × 375 landscape phone is cramped.** The sheet's tiers are fractions of the HEIGHT, so at 375 px
   tall the peek tier is 67.5 px — below the 44 px handle plus a readable header. Orientation change is
   handled (the geometry recomputes), but the landscape phone was not tuned.
4. **Escape does not close a selected region on mobile.** The drawer owns the Escape handler
   (`src/components/RegionDrawer.tsx:150-157`) and the drawer is desktop-only on this release. Measured: on a
   phone, pressing Escape left `pacific` selected for the full 20 s poll. The mobile close paths are a tap on
   empty canvas and the sheet's own Clear button at full tier; M3 uses the canvas tap because that is a path
   a user actually has.
5. **The header's snapshot/download and unit-toggle buttons are dropped, not shrunk.** The download path
   writes a desktop-shaped PNG report, and the unit toggle changes labels inside the sheet, which reads the
   same `units` state — so neither feature is unavailable, they are simply not in the phone's top bar.
6. **The full-tier sections mount lazily and never unmount.** Reaching full the first time renders the
   deep-dive, the analogs table and the dataset footer; leaving full keeps them mounted so a second visit is
   free.

---

## 6. Test hooks

| hook | where | what it proves |
|---|---|---|
| `[data-mobile-sheet]` | the sheet root | the mobile shell mounted |
| `[data-tier]` | same element | which tier the sheet is in, without reading a rect |
| `window.__mobileSheet` | `SnapSheet.tsx`, `VITE_E2E` only | `{ tier, tierIndex, translateY, renders, drags, viewportH, sheetHeight, points, read() }` |
| `data-testid="mobile-island"` | `TopIsland.tsx` | the HUD is present |
| `mobile-snap-probe-3m1` | `MOBILE_SNAP_MARKER` | 0 in `dist`, 1 in `dist-e2e` — the same convention as `LOCKED_BRANCH_MARKER` |

Two counter-reading rules the spec learned the hard way, both now stated as code in
`tests/e2e/mobile-sheet.spec.ts`:

- **Baseline the render counter at REST.** After `open()` returns the counter climbs once more as the engine's
  history resolves and `App` hands `MobileShell` a new payload. Measured: 12 at t = 268 ms, 13 at t = 885 ms,
  and 13 for the following 18 s. Reading the baseline too early accuses a drag of the app's own boot render.
- **Compare easing offsets at the product's own settle bound (0.05 px), not at 1e-6.** `waitForDesktopFrame`
  guarantees a frame RAN, not that the fit has stopped easing. Measured: 196.8594 against a target of 196.875,
  and −59.1108 against −59.125 — 0.0156 and 0.0142 px of remaining ease on fits that are arrived by contract.


---

# Step 2B-STEP3-MOBILE2 — the layout law, the free rect, the unclamped ceiling

MOBILE1 asked one question with one media query ("is the viewport under 768 px wide?"). That answered
sheet-versus-desktop correctly and answered the SHAPE badly: an 844x390 phone is 844 px wide, so it got the
desktop overlays on a 390 px-tall screen. MOBILE2 replaces the question with a total function of two integers and
derives everything else — the free rectangle, the radius budget, the distance ceiling, the header, the dock — from
it.

## 1. The modes

`resolveLayoutMode(w, h)` (`src/mobile/layoutMath.ts`), evaluated in this order:

    1. phoneLandscape   if w < 1024 AND h < 600 AND w > h
    2. portrait         if w < 768  OR (w < 1024 AND h > w)
    3. desktop          otherwise

`phoneLandscape` is first because it is the narrowest condition and clause 2 would otherwise capture its members
(`844x390` has `h > w` false). Clause 2's `w < 768` is the only part of MOBILE1's breakpoint that survives
verbatim — it is what the M1 boundary case compares against — and the `(w < 1024 AND h > w)` half is what makes
768x1024 and 960x1440 portrait.

Computed from `innerWidth`/`innerHeight` on `resize` and `orientationchange`, coalesced to one
`requestAnimationFrame`, and **synchronously at store init** so no first paint is in the wrong mode. Published as
`data-layout-mode` on the app root and read non-reactively by the frame loop.

**Accepted gaps** (documented, deliberately not fixed — each is a real viewport nobody in the matrix uses, and
every fix moves a boundary the acceptance suite bands):

- a 768..1023 wide window in LANDSCAPE with `h >= 600` is portrait (1023x601 portrait, 1024x600 desktop);
- a square 768x768 or 900x900 is desktop (`h > w` false, `w < 768` false);
- 1024x1366 is desktop although it is a portrait tablet.

## 2. The free rectangle

Published to the store, consumed only by `CameraDirector`.

    headerBottom   measured by a ResizeObserver on the compact header (getBoundingClientRect().bottom),
                   published when it moves by 0.5 px or more.

    portrait       left 0, right W, top headerBottom, bottom H - peekVisible
                   peekVisible = max(0.18*H, 112 + safe-area-inset-bottom)
                   cx = W/2
                   cy = min(mid, 0.52*H - 28)

    phoneLandscape dockW = min(clamp(320, 0.38*W, 400), 0.5*W), docked RIGHT
                   left 0, right W - dockW, top headerBottom, bottom H
                   cx = right/2, cy = (top + bottom)/2

    both           Rb = max(min(cx-left, right-cx, cy-top, bottom-cy) - 12, 40)

The `min(mid, 0.52H - 28)` term in portrait is a legibility rule, not a fitting one: the Half tier's top is
`0.52*H`, so a centred face-pinned pin must sit above that line. At 390x844 with a two-row header the midpoint
(425.04) is BELOW the cap (410.88), so the cap binds; the camera is fitted to the cap, which is why the acceptance
case compares against the probe's published centre and not against the rectangle's midpoint.

## 3. The fit, and the ceiling

The law is `dContainFor(radiusPx, focalPx, re)` in `layout/frame.ts` — **one** function, called by the desktop
free-rect fit with the rectangle's `rMax` and by the mobile fit with `Rb`. Nothing re-derives it.

    re       = MOBILE_ENVELOPE = max(pin envelope 1.10242, atmosphere limb 1.1) = 1.10242
    dContain = sqrt(re^2 + (focalPx*re/Rb)^2)
    dFit     = dContain                      (mobile: no ceiling clamp)
    dMaxMode = max(5, 1.25 * dContain)

`dMaxMode` is written to `controls.maxDistance` by `CameraDirector` and nowhere else; desktop writes 5 back, so a
rotation to desktop cannot leave a mobile ceiling behind. Measured headroom: at 390x844 `dFit` 6.71, `dMaxMode`
8.39 — 1.25x, comfortably above the 1.2x the acceptance case requires.

**The view offset is a lens shift, not a rescale:**

    camera.setViewOffset(W, H, W/2 - cx, H/2 - cy, W, H)

The sub-window is the full `W x H`, so the frustum keeps its scale and the disc stays a circle. Both signs were
proven by projecting a real `PerspectiveCamera` (`mobileFrame.test.ts`), not by reasoning: the Y sign matches
MOBILE1's measurement, and the X sign is **positive** in landscape because the dock is on the right.

## 4. The header, the chip and the dock

`HeaderCompact` is the only header the mobile modes render, and it is a separate component from `Header.tsx`
precisely so the desktop header's measured 118.25 px and its pixel proofs cannot move. It shows the h1 (wraps to
two lines, never ellipsised), the unit toggle, Snapshot, Reset View and the ENSO chip; the subtitle is `sr-only`.
Portrait is two rows, phoneLandscape one. All controls are 44 px; `ResetViewButton`'s own class measures 26 px, so
it sits in a 44x44 stretch box **in `HeaderCompact` only**, leaving the shared component byte-identical.

The island (`TopIsland.tsx`) is DELETED, and with it the second rotate-ccw icon that reset the scenario rather than
the view — the "ghost duplicate" the prompt names.

The chip prints `formatIsland(anomalyC)` and opens a scrubber popover that floats above the canvas and changes no
layout, so it cannot re-fit the camera. Its anomaly honours the unit toggle with a **DELTA** conversion (`x1.8`,
no `+32`) while the CATEGORY always classifies the °C value, because the ONI bands are °C thresholds. Escape closes
the popover only — the handler is capture-phase and calls `stopPropagation`, so the app's own Escape (which clears
the region) never sees it. A pointerdown outside the whole HEADER closes it; taps on the unit toggle are inside by
design, because comparing the value in the other unit is the one thing a reader does next.

`LandscapeDock` is a fixed right-hand column of width `dockWidth(W)`, starting at the published `headerBottom`, with
no tiers and no drag. It and `SnapSheet` both render `SheetBody` — the Half/Full content including the FIX2 region
switcher and its single `selectRegion` path — so the two surfaces cannot select differently.

## 5. The single-writer list

After mount, `CameraDirector.tsx` is the ONLY module that writes:

    camera.position.set/copy · camera.quaternion · camera.up · camera.zoom · camera.fov
    setViewOffset · clearViewOffset · updateProjectionMatrix
    controls.target · controls.minDistance · controls.maxDistance · controls.update()

`singleWriter.test.ts` scans `src/` for each of those, allows only `CameraDirector.tsx` and (for the declarative
`<Canvas camera>` props and the `<OrbitControls>` bounds at mount) `GlobeScene.tsx`, and — since MOBILE2 — carries a
NEGATIVE FIXTURE: a synthetic source assigning each zoom bound must be flagged, and a comparison (`!==`) must not
be. Without that fixture the two patterns would pass vacuously.

## 6. The tier reset, and where it does NOT fire

The tier returns to peek on every **entry into portrait**. An entry is a mode TRANSITION, so a rotation
(portrait → phoneLandscape → portrait) resets, while a resize between two portrait viewports does not — resetting a
reader's tier on every resize would be the "sheet jumps under the thumb" defect in reverse. Measured: 390x844 to
320x568 keeps the tier; the LM7 rotation case asserts the reset.

## 7. The Snapshot finding (measured, not fixed)

`captureCanvas()` (`lib/canvasCapture.ts`) forces one `gl.render()` and reads `toDataURL()` in the same task, so the
capture is the FULL canvas with the CURRENT projection matrix — **the view offset IS included**, because
`setViewOffset` edits that matrix and nothing clears it. With `dpr={[1, 2]}` and `<AdaptiveDpr>`, the captured
pixel size can be below `2x` CSS. Report only; not changed here.

## 8. Test hooks (MOBILE2)

| hook | where | what it proves |
|---|---|---|
| `data-layout-mode` | the app root | the three-way mode, for the DOM and for a spec |
| `[data-occluder="compact-header"]` | `HeaderCompact` | the compact header mounted, and where its bottom is |
| `[data-testid="enso-chip"]` / `-chip-text` / `enso-popover` | `HeaderCompact` | the chip, its text node, the popover |
| `[data-landscape-dock]` / `[data-dock-scroll]` | `LandscapeDock` | the dock and its scroller |
| `[data-testid="sheet-title"]` | `SnapSheet` | the title, for the typography case |
| `window.__frame.{viewOffsetX,dMax,dFit,radiusBudget,headerBottom}` | `frameProbe.ts` | the fit, without reading three internals |
| `mobile-layout-probe-3m2` | `MOBILE_LAYOUT_MARKER` | 0 in `dist`, present in `dist-e2e` |
| `mobile-snap-probe-3m1` | `MOBILE_SNAP_MARKER` | unchanged: the sheet's own probe still ships to `dist-e2e` only |
