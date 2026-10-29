# Mobile Layout Audit — Super El Niño Global Impact Simulator

**Date:** 2026-10-29
**Scope:** read-only audit. No source file was modified. This document is the only artifact added to the repo.
**Target viewports (CSS px):** 375×667 (iPhone SE, minimum supported), 390×844, 360×740, 667×375 (landscape SE).
**Regression baseline:** desktop at ≥1024px (`lg`), captured at 1262×568.
**Method:** Playwright 1.64.1 (chromium, `--use-gl=swiftshader --enable-unsafe-swiftshader`), `isMobile: true`, `hasTouch: true`, DPR 3, against `vite preview` of the production `dist/`. All numbers below are measured from the live DOM, not estimated.
**Screenshots:** `.cache/audit/shots/` (throwaway, deleted at end of session — regenerate with the scripts described in Appendix A).

---

## Summary

| # | Check | Status | Severity |
|---|---|---|---|
| 1 | Horizontal overflow at all viewports | **PASS** | — |
| 2 | Touch targets ≥44×44 | **FAIL** — 11/11 targets undersized at 375 | **P0** |
| 3 | Viewport units / safe-area | **FAIL** — no `dvh`, no `env(safe-area-inset-*)` | P1 |
| 4 | Panel layout at <1024px | **FAIL** — panel covers 71.4% of viewport; 2 of 3 pin labels off-screen | **P0** |
| 5 | Pin label overlap / legibility | **FAIL** — effective font 5.4–7.6px; labels clipped at viewport edge | **P0** |
| 6 | Gesture conflicts | **FAIL** — `touch-action: auto` on canvas and on all 3 range inputs | **P0** |
| 7 | Hover-only affordances | **FAIL** — 4 `group-hover`-gated content blocks; hint bar is mouse-only wording | P1 |
| 8 | R3F performance / context loss | **FAIL** — 4 sphere geometries at 128², 2.6 MB textures, no context-loss handler, dpr to 2 | P1 |
| 9 | Typography / contrast at 375 | **FAIL** — 8px minimum x-height text; 6 clipped containers | P1 |
| 10 | Header single row at 375 | **PASS** — all 4 controls on one row (pointer-events caveat below) | — |
| 11 | `prefers-reduced-motion` | **FAIL** — globe auto-rotates identically under `reduce` | P1 |
| 12 | Cold load on mobile | **FAIL beyond spec** — engine **never boots** on Slow 4G | **P0** |

**P0 count: 6.** The app is not usable as designed on a phone: the control deck consumes 71.4% of the screen, every interactive control is below the 44px touch minimum, and on a realistic mobile network the analytics engine fails to boot at all.

---

## Per-check evidence

### 1. Horizontal overflow — PASS

| Viewport | `scrollWidth` | `innerWidth` | Overflow |
|---|---|---|---|
| 375×667 | 375 | 375 | none |
| 390×844 | 390 | 390 | none |
| 360×740 | 360 | 360 | none |
| 667×375 | 667 | 667 | none |
| 1262×568 | 1262 | 1262 | none |

The document is height-locked (`body { overflow: hidden }`, `src/index.css:25`) and `docScrollHeight === docClientHeight === 667`, so nothing can scroll at all. **Note:** zero overflow is partly a consequence of that lock — content that would overflow is instead clipped (see #9). Widening the layout without fixing the clipping will surface this.

### 2. Touch targets — FAIL (P0)

Every visible interactive element at 375×667, measured:

| Element | Box (w×h) | ≥44×44 |
|---|---|---|
| Pin label `Niño 3.4` | 69.7 × 18.0 | ✗ |
| Pin label `California` | 72.8 × 16.2 | ✗ |
| Pin label `Indonesia` | 54.1 × 12.9 | ✗ |
| `°C` toggle | 33.0 × 19.5 | ✗ |
| `°F` toggle | 33.0 × 19.5 | ✗ |
| `Snapshot` button | 38.0 × 26.0 | ✗ |
| `Reset` button | 57.7 × 17.5 | ✗ |
| SST range input | 309.0 × 26.0 | ✗ (h) |
| Jet stream range input | 309.0 × 26.0 | ✗ (h) |
| Agriculture range input | 309.0 × 26.0 | ✗ (h) |
| Panel close button (`×`) | 27.0 × 27.0 | ✗ |

**11 of 11 fail.** Sources:

- `src/scene/Hotspot.tsx:159` — label button has no min height; computed 12.9–18.0px tall at 375px.
- `src/scene/Hotspot.tsx:136` — the hot-spot tap ring is a `sphereGeometry` with radius `0.016`/`0.011` on a unit sphere. At the current portrait camera distance this projects to roughly **6–12 CSS px**, not a tappable target, and it is not in the DOM so it has no accessibility surface.
- `src/components/Header.tsx:96-108` — unit toggle: `px-2.5 py-[3px]` on `text-[9px]` → 33×19.5.
- `src/components/Header.tsx:120-131` — Snapshot: `px-3 py-1.5` on `text-[10px]` → 38×26.
- `src/components/ControlDeck.tsx` (Reset) — `px-1.5 py-0.5` on `text-[9px]` → 57.7×17.5.
- `src/index.css:118-160` — `.slider` is `height: 26px`; the thumb is styled 15×15. The input box is 26px tall, so the touch band is 26px, not 44px.
- `src/components/RegionDrawer.tsx:~200` — close button `p-1.5` around a `size={13}` icon → 27×27.

### 3. Viewport units & safe-area — FAIL (P1)

Grep for `100vh`, `h-screen`, `min-h-screen`, `100dvh` across `src/` and `index.html`:

| Match | File:line | Assessment |
|---|---|---|
| `h-[140vh] w-[140vh]` | `src/App.tsx:67` | Decorative background radial. `vh` here is cosmetic; on iOS the overlay would resize with the toolbar. Low impact, but it is the only `vh` in the app and it does not need `dvh` — it should use `vmax` or be clamped. |
| `h-[80vh] w-[120vw]` | `src/App.tsx:74` | Same — decorative gradient. |

No `h-screen`, no `min-h-screen`, **no `100dvh` anywhere**. The root layout uses `h-full` (`src/App.tsx:63`) which resolves against `html, body, #root { height: 100% }` (`src/index.css:20-24`) — this inherits the *initial containing block*, so it is stable under the iOS toolbar but exposes the app to the iOS URL-bar overlap: content pinned to `bottom-0` (the control deck) can sit under the toolbar.

- `<meta name="viewport">` **does** have `viewport-fit=cover` (`index.html:5`). ✅
- `env(safe-area-inset-*)`: **used nowhere** (grep across `src/` and `index.html`). ❌ With `viewport-fit=cover` present, `viewport-fit: cover` extends the canvas under the notch/home indicator, and because no inset is consumed, the `Snapshot` button (top-right, `x=321…359` at 375px) and the bottom `Impact Index` cards sit inside the unsafe area on notched hardware.

Recommendation: add `--sat/--sab` CSS vars from `env()`, apply to the header top padding and the sheet's bottom padding, and switch the root to `100dvh` with a `100vh` fallback.

### 4. Panel layout at <1024px — FAIL (P0)

There is **no mobile layout branch at all** (`grep -rn "isMobile|useMediaQuery|matchMedia" src/` → none). The desktop composition simply reflows:

- Left control deck: `src/App.tsx:124` — `absolute bottom-0 left-0 w-full p-4`. At <1024px it spans the **full** width and is pinned to the bottom.
- Right Impact Zones: `src/App.tsx:143` — `hidden … lg:flex`. **Entirely absent below 1024px.** On a phone the region cards do not exist in any form; the only way to select a region is the pin labels (see #5).
- Bottom hint bar: `src/App.tsx:156` — `hidden … lg:block`. Absent on mobile, which is the correct call for a mouse-wording bar (see #7).

Measured at 375×667:

| Region | Box | % of viewport |
|---|---|---|
| Canvas | 0,0 → 375×667 | 100% (behind everything) |
| Scenario Engine panel (`.glass`) | x=16 → 359, y=130.5 → 651 | **91.5% of width**, **78.0% of height** = **71.4% of viewport area** |
| Header block (title + alert pill) | y=16 → 49 | ~7% of height |
| Impact Zones | not rendered | 0% |

**Globe visible: ~28% of the viewport**, and that remaining strip is split between the header band (y<130) and the 16px gutter — i.e. a ~80px tall band across the top plus slivers at the edges. The globe is effectively a background image, not the centrepiece. The full-screen `#globe-canvas` is 375×667 but is occluded from y=130 downward.

### 5. Pin labels — FAIL (P0)

Overlap: **0** overlapping pairs measured at every viewport (the depth-aware limb fade added previously works). The failure is legibility and placement, not collision.

Legibility — drei `<Html distanceFactor={1.55}>` scales the DOM with camera distance, so the **computed** 9px is not what the user sees:

| Label | Computed px | Camera scale | **Effective px** | ≥11px |
|---|---|---|---|---|
| Niño 3.4 | 9 | 0.840 | **7.56** | ✗ |
| California | 9 | 0.751 | **6.76** | ✗ |
| Indonesia | 9 | 0.601 | **5.41** | ✗ |

Placement — portrait framing pushes labels outside the viewport:

| Label | Box x | Inside viewport | Occluded by control panel |
|---|---|---|---|
| Niño 3.4 | 280.9 | yes | **yes** (panel spans x 16–359, y 130.5–651) |
| California | **376.8** | **no** (right edge 375) | no |
| Indonesia | **−139.2** | **no** (left edge 0) | no |
| Horn of Africa | — | yes | no |

At 375px the default camera (`position [0,1.15,3.15]`, `fov 42`, `src/scene/GlobeScene.tsx`) shows only ~40° of longitude, so the four hotspots cannot all be on screen simultaneously. The pin labels are `text-[9px]` (`src/scene/Hotspot.tsx:159`) with no viewport-aware collision avoidance and no minimum effective size.

### 6. Gesture conflicts — FAIL (P0)

Computed `touch-action` at 375×667:

| Element | `touch-action` | `overscroll-behavior` |
|---|---|---|
| `html` | auto | auto |
| `body` | auto | auto |
| `#root` | auto | auto |
| `#globe-canvas` wrapper | auto | auto |
| `<canvas>` | **auto** | **auto** |
| SST `input[type=range]` | **auto** | — |
| Jet stream range | **auto** | — |
| Agriculture range | **auto** | — |

Nowhere in `src/` or `index.html` is `touch-action` set (grep → none). Consequences:

1. **Vertical gesture on the canvas** initiates OrbitControls rotation *and* competes with any browser pan gesture. Today the page cannot scroll (`canScroll: false`), so the practical effect is that a vertical drag on the globe rotates the globe — acceptable here, but it becomes a real conflict the moment the proposed bottom sheet introduces scrolling.
2. **Vertical drag on a range input** is delivered as a page gesture; the thumb only moves on horizontal drag. Users who drag diagonally on a 26px-tall slider lose the gesture. Needs `touch-action: pan-y` on the input so horizontal gestures are captured for the thumb and vertical ones pass through to the sheet.
3. **OrbitControls captures touches that start on a panel?** No — the panel is `pointer-events-auto` and sits above the canvas at `z-20`, so touches starting on the panel do not reach the canvas. But the *canvas wrapper* is `absolute inset-0` beneath the panel, and the panel is only 343×520 of a 375×667 canvas, so the ~28% uncovered area (including the 80px top band under the header, which is `pointer-events-none`) forwards gestures to OrbitControls. On a phone that means the visible sliver of globe is the only place a rotation gesture works — a poor target.
4. No `-webkit-tap-highlight-color` handling on the WebGL surface (present for `*` in `src/index.css:9` → `transparent`, so taps give no feedback).

### 7. Hover-only affordances — FAIL (P1)

13 `hover:` utilities; 4 elements gate *content* behind `group-hover`:

| File:line | Behaviour |
|---|---|
| `src/components/RegionCards.tsx:94` | Region card summary paragraph: `max-h-0 opacity-0 group-hover:max-h-16 group-hover:opacity-100` — **the explanatory sentence is invisible on touch**. Desktop-only component, so impact is contained, but the pattern must not be reused in the chip rail. |
| `src/components/RegionCards.tsx:86` | Chevron affordance `group-hover:translate-x-0` — decorative only. |
| `src/components/ui/Stat.tsx:49` | Underline reveal on `group-hover/stat` — decorative only. |
| `src/scene/GlobeScene.tsx:151` | `hidden … group-hover:inline sm:inline` — headline metric; visible at `sm` so not lost on phone. |

`src/scene/Hotspot.tsx:159` `onPointerEnter` sets a hover glow only — no information is hover-gated there.

**Bottom hint bar** (`src/App.tsx:158-168`): copy is `Drag → orbit`, `Scroll → zoom`, `Click pin → inspect`. `Scroll` and `Click` are mouse verbs. It is `hidden lg:block`, so it is correctly absent on a phone — but there is then **no touch affordance hint at all** on mobile. Touch wording should be `Drag → rotate`, `Pinch → zoom`, `Tap pin → inspect`.

### 8. R3F performance & context loss — FAIL (P1)

| Setting | Value | File:line |
|---|---|---|
| `<Canvas dpr>` | `[1, 2]` | `src/scene/GlobeScene.tsx:44` |
| `antialias` | `true` | `:46` |
| `powerPreference` | `high-performance` | `:48` |
| Post-processing | `EffectComposer` + `Bloom` (`intensity 0.42`, `mipmapBlur`) + `Vignette` | `:114-117` |
| `AdaptiveDpr` | present (`pixelated`) | `:119` |
| Shadows | none | — |
| `webglcontextlost` handler | **none** (`grep -rn webglcontextlost src/` → none) | — |

Geometry (triangle-heavy for a phone):

| Mesh | Segments | Approx. triangles |
|---|---|---|
| Atmosphere shell | 96² | 18.4k |
| Cloud shell | 96² | 18.4k |
| Surface | **128²** | **32.8k** |
| Glint overlay | **128²** | **32.8k** |
| **Total sphere** | | **~102k** + 14k star points |

Textures (all 2048×1024, decoded to 8 MB each in VRAM regardless of file size):

| File | Dimensions | Size |
|---|---|---|
| `earth_clouds.jpg` | 2048×1024 | 943 KB |
| `earth_day.jpg` | 2048×1024 | 452 KB |
| `earth_specular.jpg` | 2048×1024 | 263 KB |
| `earth_night.jpg` | 2048×1024 | 249 KB |
| `earth_normal.jpg` | 2048×1024 | 119 KB |
| **Total decode** | | **~40 MB VRAM** |

Files in `public/` over 500 KB: `earth_clouds.jpg` (0.92 MB), `duckdb-browser-mvp.worker.js` (0.81 MB), `duckdb-browser-eh.worker.js` (0.74 MB).

**Context loss:** no `THREE.WebGLRenderer: Context Lost` observed in any of the 5 viewport runs or the 2 throttled runs (0 occurrences). The earlier sighting was not reproduced. Risk remains structurally: with no `webglcontextlost` listener and no renderer re-init, a mobile OS reclaiming the GPU context leaves a permanently black canvas. On a phone this is a likely event (backgrounding the tab), so the missing handler is a real P1 regardless of not reproducing it.

At `dpr: [1,2]` on a DPR-3 phone, R3F clamps to 2 → a 750×1334 drawing buffer with post-processing, ~102k sphere triangles and additive blending on the atmosphere/glint layers. `AdaptiveDpr` helps only after a sustained performance drop.

### 9. Typography / contrast at 375 — FAIL (P1)

Smallest computed font sizes in use:

| Size | Examples |
|---|---|
| **8px** | `Live Scenario Controls`, slider stop labels `Neutral`, `Moderate` |
| 8.5px | `Mega El Niño`, `Teleconnection modifiers` |
| 9px | `°C`, `°F`, `%` |
| 9.5px | `Initialising globe`, `ENSO Alert: Strong El Niño`, engine badge |
| 10px | `Global SST Anomaly`, `Jet Stream Displacement` |
| 11.5px | region card titles (desktop only) |

8px uppercase letter-spaced text is below any usable mobile minimum (WCAG does not set a floor, but 16px body / 12px caption is the practical convention; 8px with `tracking-[0.24em]` is decorative-only).

Clipped containers (`scrollWidth > clientWidth`):

| Element | scrollW | clientW | Note |
|---|---|---|---|
| Root layout div | 788 | 375 | Pin `<Html>` labels positioned outside the viewport inflate scroll width |
| `#globe-canvas` neighbours | 450 | 375 | Same cause |
| Slider stop-label row | 319 | 309 | `Neutral · Moderate · Strong · Mega` captions overflow by 10px |
| Drawer header | 381 | 349 | `Impact Zone · °S 0°W` truncates |

No bad wrapping in the header at 375: title, badge, `°C/°F` and Snapshot all fit without truncation.

### 10. Header single row at 375 — PASS

Measured boxes, all sharing one row band (`y ≈ 16–49`):

| Element | x | y | w×h |
|---|---|---|---|
| `h1` title | 52.5 | 19.0 | 174.6 × 30.0 |
| `°C` | 246.1 | 19.3 | 33.0 × 19.5 |
| `°F` | 279.0 | 19.3 | 33.0 × 19.5 |
| `Snapshot` | 321.0 | 16.0 | 38.0 × 26.0 |

Header row bands: **1**. Everything fits.

Two caveats: (a) the engine badge is hidden (`hidden md:flex`, `src/components/Header.tsx:83`) so the mobile user gets no indication of engine state — given #12 that is unfortunate; (b) `Snapshot` ends at x=359 and the header has no `env(safe-area-inset-right)`, so on notched hardware it can be clipped or fall under the notch. Also note the drawer is `z-30` (`src/components/RegionDrawer.tsx:154`) while the header is `z-40`, which is correct — but at 375 the drawer occupies `max-w-[418px]` = the full width, hiding the globe entirely while open (observed: the `--region` screenshots are 100% panel).

### 11. `prefers-reduced-motion` — FAIL (P1)

`src/index.css:56` has a `@media (prefers-reduced-motion: reduce)` block that forces `animation-duration: 0.01ms` and `transition-duration: 0.01ms`. That covers **CSS** only.

Measured globe motion over 1.5 s:

| Media setting | `matchMedia` matches | Pixel delta | Globe still animating | CSS animations active |
|---|---|---|---|---|
| `reduce` | true | **525,510** | **yes** | 2 |
| `no-preference` | false | 523,460 | yes | 2 |

Identical motion under both settings: the auto-rotate lives in `useFrame` (`src/scene/EarthSystem.tsx` / `src/scene/Starfield.tsx`) and is never gated on the media query. The starfield drift and atmosphere breathing continue too. Vestibular-safe delivery requires reading `window.matchMedia('(prefers-reduced-motion: reduce)')` inside the R3F frame loop and freezing rotation.

### 12. Cold load on mobile — FAIL (P0)

Throttling: CPU **4×** slowdown + **Slow 4G** (400 ms RTT, 400 kbps down/up) — Lighthouse's mobile profile, via CDP `Network.emulateNetworkConditions` + `Emulation.setCPUThrottlingRate`.

| Milestone | Time from navigation start |
|---|---|
| Slider mounted | 9,020 ms |
| Slider responsive to input | **9,397 ms** |
| Boot veil cleared (first WebGL frame) | 9,684 ms |
| Engine label resolved | **never** |

Final state at 375×667 on Slow 4G: **`Client-side model (CDN unreachable)`**, `918 mo` never appears (shows `0`), Impact Index / Ag Exposure do render (the optimistic `computeMetrics` path works).

Unthrottled at the same viewport, for contrast:

| Run | Settled | Badge |
|---|---|---|
| 375×667, no throttle | 4,469 ms | `DuckDB-WASM · jsdelivr · 555.9 ms` |
| 375×667, Slow 4G + 4× CPU | 38,862 ms | `Client-side model (CDN unreachable)` |

**Root cause**, from the throttled console:

```
[duckdb] wasm host "jsdelivr" failed, trying next: Error: DuckDB boot timed out after 15000 ms (jsdelivr)
[duckdb] wasm host "unpkg"    failed, trying next: Error: DuckDB boot timed out after 15000 ms (unpkg)
[duckdb] scenario query failed: Error: DuckDB boot timed out after 15000 ms (unpkg)
```

Two upstream facts make this deterministic:

1. **The wasm is not 33–39 MB — it is 6.76 MB.** Measured on the wire: `duckdb-eh.wasm` → `content-length: 6764975` (6.45 MiB). Both CDNs serve it with `content-encoding: br`, so the documented "25 MiB Pages limit" rationale is based on the *uncompressed* file size; the transfer is ~6.8 MB.
2. **The boot also pulls a second, undeclared wasm:** `https://extensions.duckdb.org/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm` — fetched at runtime, even though the project already ships `public/data/enso_historical.parquet` and reads it directly. That is an uncontrolled third-party dependency and extra bytes on every cold load.

At 400 kbps, 6.45 MiB ≈ **135 s** of pure transfer, plus the parquet extension, plus a 33 MB JS bundle on the same pipe — so the 15 s per-host budget can never be met. Both hosts time out by design, and the ladder fails over to the TS fallback. **On a real mobile connection the DuckDB path is dead on arrival**, which also means all 918 months of real NOAA data and every analog table are unavailable on phones.

Also relevant to #12: the UI **is** usable before DuckDB (`sliderInteractive` at 9.4 s, engine never), so the "optimistic metrics" architecture is vindicated — but 9.4 s to first interaction under 4× CPU is itself too slow, and the boot veil ("Initialising globe") is what the user stares at during most of it.

---

## Proposed component split (bottom sheet) — design only, not implemented

Target: full-viewport `100dvh` canvas, no overlay at rest, three-snap bottom sheet, Impact Zones as a horizontal scroll-snap chip rail, one shared state source, desktop (≥1024px) unchanged.

### State

Single source stays where it already is: `useScenario()` (`src/state/useScenario.ts`) owns `scenario`, `analytics`, `status`, `engineLabel`, `units`. Two additions, both in that hook (or a thin sibling `useLayoutStore`):

- `sheetSnap: 'peek' | 'half' | 'full'` — presentation only.
- `activeRegion: RegionId | null` — **must move out of `App.tsx`** (`src/App.tsx:24`) so the chip rail and the drawer read one value. Today it is local `useState` in `App`, which is fine for one consumer but will duplicate the moment a second region UI exists.

Expose via a context provider in `App`, or lift to a `zustand`-style store if re-render cost across the sheet/canvas boundary becomes measurable. **Do not** create a second data path for mobile — the whole risk in this refactor is two trees diverging.

### Reuse vs. wrap

| Component | Verdict | Notes |
|---|---|---|
| `useScenario` | **reuse as-is** | No layout knowledge inside it. |
| `ControlDeck` | **reuse, needs wrapper** | Already self-contained (`max-w-[352px]`, own `.glass`). Needs its `reset` header row and the "Live Scenario Controls" label separated so PEEK can render only the slider + chips. Split into `<SstLever>`, `<Sparkline strip>`, `<ModifierSliders>`, `<CompositeReadouts>` — four presentational pieces composed differently per snap point. |
| `RegionCards` | **reuse the data, replace the shell** | The card body (icon, name, headline metric, accent) is right; the `group-hover` reveal at `src/components/RegionCards.tsx:94` must die. Extract `<RegionChip>` for the rail and keep `RegionCards` untouched for `lg:` so desktop is byte-identical. |
| `RegionDrawer` | **reuse, needs wrapper** | It is already a full-height scroll container with its own close/Esc handling. For FULL snap it becomes the sheet's content; the `absolute … translate-x-[110%]` slide must be replaced by sheet-height animation. Keep the component, change the positioning wrapper only. |
| `Header` | **reuse, needs wrapper** | Single row already fits at 375 (#10 PASS). Needs `env(safe-area-inset-*)` padding and to stop hiding the engine badge at `md` — the badge is the only engine-state signal a phone user has. |
| `GlobeScene` | **reuse as-is** | Layout-agnostic. Mobile perf tuning (#8) is a separate concern from layout. |
| `ControlDeck`'s `.glass` styling | **reuse tokens** | The `.glass` / `.glass-soft` / `.hairline` classes in `src/index.css:75-100` are exactly the sheet's visual language already. |
| New: `BottomSheet` | **new** | Drag handle, 3 snap points (peek ≈ 132px, half ≈ 46dvh, full ≈ 88dvh), `touch-action: none` on the handle only, `pan-y` on scrollable content, `env(safe-area-inset-bottom)` padding. |
| New: `ChipRail` | **new** | Horizontal `scroll-snap-type: x mandatory`, 44px min target, tap → `setActiveRegion` + `focusNonce++` (the existing camera-flight trigger). |
| New: `LayoutShell` | **new** | The only component that branches on viewport: `<LayoutShell desktop>` renders today's tree verbatim; `<LayoutShell mobile>` renders canvas + sheet + rail. **No duplication of content components — only of arrangement.** |

### Breakpoint

Branch on `lg` (1024px) to match existing conventions and keep desktop frozen. Implement as a `useMediaQuery('(min-width: 1024px)')` hook + `<LayoutShell>` conditional, **not** CSS-only — because PEEK/HALF/FULL need different DOM structure (the sheet must not render three copies of the deck and hide two with `hidden`, which would triple-mount the sliders and their `useFrame`-adjacent state).

### Landing order

1. Move `activeRegion` into shared state (unblocks everything, no visual change).
2. Extract `ControlDeck` into four pieces (no visual change at any width).
3. Add `LayoutShell` + `BottomSheet` + `ChipRail`, mobile-only branch.
4. Fix P0s independently: touch targets (#2), `touch-action` (#6), engine boot budget (#12).

---

## Risks / open questions

**Risks**

1. **The P0 in #12 is not a layout bug and the sheet will not fix it.** On Slow 4G the engine never boots because a 6.45 MiB wasm plus a 33 MB JS bundle cannot transfer inside 15 s. Proposed sheet work will make the *UI* pleasant while the analytics engine stays dead on real phones. The boot budget must be addressed separately — options: raise `BOOT_TIMEOUT_MS`, load DuckDB lazily only when the FULL snap is opened, pre-warm from a service worker, or gate the initial query on `navigator.connection.effectiveType` and skip straight to the TS model on 2G/3G.
2. **Moving `activeRegion` into shared state touches the desktop path.** Low risk but it is the one change in this plan that can regress the frozen baseline; it must be verified at 1262×568 before any sheet work.
3. **`drei <Html>` labels do not participate in layout.** Even after the sheet exists, portrait framing puts labels off-screen (#5, `x = -139` and `x = 376.8`). The chip rail may make the labels redundant on mobile — worth deciding whether to hide pin labels below `lg` entirely rather than fight the projection.
4. **`100dvh` + a draggable sheet + `touch-action` is where mobile Safari bugs live.** Needs real-device testing; Playwright's chromium does not reproduce iOS toolbar or rubber-band behaviour.
5. **Removing the `overflow: hidden` lock** (needed once the sheet scrolls) risks revealing the horizontal overflow currently masked by clipping (#1, #9 — `scrollWidth 788` on the root caused by off-viewport pin labels). The pin-label fix must land before or with the scroll enablement.

**Open questions**

1. Is `928 mo`/`918 mo` real data expected on mobile at all, or is the TS fallback acceptable there? That determines whether #12 is a P0 or a P2.
2. Why is `extensions.duckdb.org/…/parquet.duckdb_extension.wasm` being fetched when `public/data/enso_historical.parquet` is already local? If it can be disabled, cold-load bytes drop materially and #12 gets much cheaper. **Needs an owner decision — it is an undeclared third-party runtime dependency.**
3. Minimum supported device: 375×667 is specified, but is a 320px (iPhone 5/SE1) or a low-end Android (2 GB RAM) in scope? The texture budget (~40 MB VRAM) argues for a `dpr`/texture-quality tier below a width breakpoint.
4. Should the pin labels be tappable at all on mobile, or is the chip rail the sole entry point (making the 6–12px ring targets a non-issue by removal rather than enlargement)?
5. Landscape (667×375) passes overflow and has more width than portrait, but the sheet design assumes portrait. Is landscape in scope for the sheet, or is "rotate to portrait" acceptable?

---

## Appendix A — reproducing this audit

All scripts were throwaway, under `.cache/audit/` (deleted at end of session). To regenerate:

```bash
# 1. build + serve
pnpm build
node node_modules/vite/bin/vite.js preview --port 4180 --strictPort   # background

# 2. isolated harness (does not touch package.json / lockfile)
mkdir -p .cache/audit && cd .cache/audit
printf '{"name":"audit","private":true,"version":"1.0.0"}' > package.json
npm i playwright@1.64.1 --no-audit --no-fund

# 3. the three scripts used above
node audit.mjs      # checks 1,2,4,5,9,10 across 5 viewports -> results.json + shots/
node wasmdiag.mjs   # check 12 root cause: wasm content-length, host ladder, throttled boot
node gestures.mjs   # checks 6,11: touch-action chain, range inputs, reduced-motion pixel delta
```

Chromium launch args: `--use-gl=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`.
Contexts: `isMobile: true, hasTouch: true, deviceScaleFactor: 3` for the four mobile viewports, `deviceScaleFactor: 1` for the desktop baseline.
