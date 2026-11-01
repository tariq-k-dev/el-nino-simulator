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
