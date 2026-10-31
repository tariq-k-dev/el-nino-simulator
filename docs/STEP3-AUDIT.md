# STEP 3 — audit (part 1 of A in `docs/prompts/step3-a.md`)

Read-only. Nothing in this document changes a behaviour, a threshold or a window. Every number
below was measured on the tree at `8f9e1aa` (prompt commit; behaviour identical to `1f3b300`),
from the instrumented bundle `dist-e2e/` at 1280x800 / 1024x768 / 1440x900, DPR 1.

---

## 1. Camera writers

| writer | file:line | what it writes | units |
|---|---|---|---|
| `DEFAULT_POSITION` | `src/scene/CameraRig.tsx:17` | `(0, 1.15, 3.15)`; its `length()` = **3.3533727** is the initial distance | scene units, `EARTH_RADIUS = 1` |
| `CameraRig` fly-to | `src/scene/CameraRig.tsx:99` | `controls.target.lerp(desiredTarget)` | scene units |
| `CameraRig` fly-to | `src/scene/CameraRig.tsx:106-115` | preserves the viewing direction, re-scales the offset toward `region.zoom` (2.6–2.9, `src/lib/regions.ts:15,27,39,51`) clamped into the control limits, then `controls.update()` | scene units |
| `CameraRig` settle test | `src/scene/CameraRig.tsx:122-124` | reads only; stops the flight at < 0.004 | — |
| `<OrbitControls>` props | `src/scene/GlobeScene.tsx:669-681` | the **only** writer of the distance bounds: `minDistance={EARTH_RADIUS * 1.25}`, `maxDistance={EARTH_RADIUS * 5}`, `enableZoom`, `enablePan={false}`, `dampingFactor 0.06`, `rotateSpeed 0.45`, `zoomSpeed 0.7`, `autoRotate={false}`, `touches` | bounds expressed as multiples of `EARTH_RADIUS` |
| OrbitControls internals | `three-stdlib`, driven by wheel/pinch/drag | position + quaternion from (target, spherical offset) | scene units |
| `__globe.setCamera` | `src/lib/globeProbe.ts:212-219` | `camera.position.set(...)`, `lookAt(0,0,0)`, `updateMatrixWorld(true)`; also pauses the spin | probe only (E2E-gated) |
| `__globe.setAzimuth` | `src/lib/globeProbe.ts:233-241` | derives radius/elevation from the live camera, then calls `setCamera` | probe only |
| `__look.setAzimuth` | `src/scene/GlobeScene.tsx:413-425` | `setSpin(true, 0)` + `setLookFlags({animate:false})` + `__globe.setAzimuth(deg)` | probe only |
| `__look.animate` | `src/scene/GlobeScene.tsx:427` | releases the scene clock; not a camera writer | — |

No auto-rotate writer exists: `autoRotate={false}` and the planet's own spin lives on the
`<EarthSystem>` group (`src/scene/EarthSystem.tsx:49`), not on the camera.

**Where 3.3534 comes from.** `DEFAULT_POSITION.length() = sqrt(0 + 1.15² + 3.15²) = 3.3533727`.
It is not a tuned constant and it is not referenced by any look threshold directly; it reaches
the specs through `__globe.defaultOrbit().distance`, which `setAzimuth` preserves.

**Where the bounds come from.** `EARTH_RADIUS * 1.25 = 1.25` and `EARTH_RADIUS * 5 = 5`
(`src/scene/GlobeScene.tsx:677-678`). `EARTH_RADIUS = 1` (`src/scene/constants.ts:26`), so one
scene unit is one Earth radius and every distance in this document is in units of R.

---

## 2. Layout at three viewports

Canvas rect is `0,0,W,H` at every size: `#globe-canvas` is `absolute inset-0 z-10`
(`src/App.tsx:90-93`) inside a `relative h-full w-full` root, and the `<canvas>` fills it
exactly (measured `clientWidth/clientHeight` == viewport, drawing buffer ratio 1.0 at DPR 1).

| element | 1280x800 | 1024x768 | 1440x900 | kind |
|---|---|---|---|---|
| canvas | `0,0,1280,800` | `0,0,1024,768` | `0,0,1440,900` | full-viewport, in flow of the root |
| header (`src/App.tsx:124`) | `0,0,1280,118.3` | `0,0,1024,118.3` | `0,0,1440,118.3` | **overlay**, `absolute z-40`, `pointer-events:none` with interactive children |
| left deck wrapper (`src/App.tsx:133`) | `0,211.5,360.8,588.5` | `0,179.5,360.8,588.5` | `0,311.5,360.8,588.5` | **overlay**, `absolute z-20` |
| left deck panel (`ControlDeck`) | `24,235.5,312.8,~540` | `24,203.5,312.8,~540` | `24,335.5,312.8,~540` | child of the wrapper |
| right Impact Zones wrapper (`src/App.tsx:154`) | `964,245.9,316,308.3` | `708,229.9,316,308.3` | `1124,295.9,316,308.3` | **overlay**, `absolute z-20` |
| right Impact Zones panel (`RegionCards`) | `988,269.9,268,260.3` | `732,253.9,268,260.3` | `1148,319.9,268,260.3` | child of the wrapper |
| region drawer, **closed** (`RegionDrawer`, `src/components/RegionDrawer.tsx:154-160`) | `1321.8,0,418,800` — off-canvas, `translate-x-[110%]` | `1065.8,0,418,768` | `1481.8,0,418,900` | **overlay**, `absolute z-30`, still mounted, `aria-hidden="true"` |
| region drawer panel, closed | `1337.8,76,386,708` | `1081.8,76,386,676` | `1497.8,76,386,808` | child of the drawer |
| region drawer, **open** | `862,0,418,800` | `606,0,418,768` | `1022,0,418,900` | `translate-x-0`, `aria-hidden="false"` |
| region drawer panel, open | `878,76,386,708` | `622,76,386,676` | `1038,76,386,808` | — |

Notes that matter for insets:

- **Every one of them is an overlay on an unchanged full-viewport canvas.** Nothing is a
  sibling in a flex/grid layout, so no occluder can move the canvas; marking them changes
  layout only if a Tailwind class is added by mistake.
- The drawer's `pt-[76px]` (`RegionDrawer.tsx:157`) is a hardcoded clearance for the header,
  which is why the panel starts at y = 76 while the drawer starts at 0.
- Closed, the drawer still occupies `+(110% of 418) = 460 px` to the right of the viewport,
  so its rect does **not** overlap the canvas — the insets contribution is correctly 0, and it
  comes from geometry, not from a special case.
- The right column is `hidden lg:flex` (`src/App.tsx:154`), so below `lg` (1024 px) it is
  `display:none`. At exactly 1024 it is present (`lg` is `min-width: 1024px`). At 1024x768 the
  deck and the Impact Zones are 24 px apart, which is the tightest case.
- The header overlay covers y 0..118.3 across the whole width, i.e. **14.8 % of the height at
  1280x800**, and it is `pointer-events:none` with only its children interactive. It is a real
  occluder for *framing* even though it does not block orbit drags.

---

## 3. `src/lib/viewport/insets.ts` and `window.__globe` today

`src/lib/viewport/insets.ts` (58 lines) is a **stub with a finished shape**:

- `Insets = { top, right, bottom, left }`, `ZERO_INSETS`.
- An external store: `getInsets()`, `subscribeInsets(cb)`, `__setInsets(next)` (notifies only
  on change), `__resetInsets()` (clears listeners).
- Its header states the plan: "STEP 3 replaces the measurement below… For now every inset is
  zero, which is the honest answer while no occluder is registered."

Callers, all of them:

| caller | file:line | use |
|---|---|---|
| `getInsets` passed into the probe | `src/scene/GlobeScene.tsx:32, 268` | `readInsets` |
| `__globe.insets()` | `src/lib/globeProbe.ts:114, 247` | exposes the insets to specs |

`__setInsets` and `__resetInsets` have **no callers anywhere in `src/` or `tests/`** — the store
has never been written to by anything except a test seam that no test uses yet.

`window.__globe` (`src/lib/globeProbe.ts`) is the E2E-only screen-space probe. Its four members
named in the prompt:

- `project(point?)` — project a world point to CSS px via `Vector3.project`, using the same
  camera and the same canvas `clientWidth/clientHeight` the renderer uses (read through
  getters, so a resize or a fly-to is picked up). Returns `{x, y, behind}`.
- `discRadiusPx()` — the exact silhouette of a sphere from distance `d`:
  `sin θ = R/d`, `r_px = tan θ · focalPx`, `focalPx = (H/2)/tan(fov/2)`. Perspective-only; it
  guards a non-perspective camera. Measured today: **325.56 px** at 1280x800 with
  `fov = 42` (`GlobeScene.tsx:220`) ⇒ `focalPx = 400/tan(21°) = 1042.0` and
  `tan(asin(1/3.35336)) = 0.31244` ⇒ `0.31244 × 1042.0 = 325.56`.
- `distance()` — `camera.position.distanceTo(getTarget())`, i.e. exactly what zoom moves, with
  the target read live because the fly-to moves it.
- `insets()` — returns `getInsets()`, currently always `{0,0,0,0}`.

None of these four writes anything. `setCamera` / `setAzimuth` / `setSpin` are separate writers
(see §1).

---

## 4. Legacy specs: navigation, camera handling, and what a distance/offset change breaks

Legend: **dist** = depends on the exact camera distance; **canvas** = depends on canvas size;
**abs** = depends on absolute pixel positions.

| spec | how it navigates / sets the camera | depends on | verdict if distance or a view offset changes |
|---|---|---|---|
| `look.spec.ts` 3.1 rim | `openGlobe` → `settleAt(0)` → `fitLimb` (360-ray sub-pixel edge fit) | **canvas**, dist (through `discRadiusPx` as the fit's start radius and through `focalPx`) | **changes.** Every offset in the profile is expressed against the *fitted* limb, so a distance change rescales R and re-registers the whole curve. The fit follows the disc, so a pure centring offset is absorbed — which is exactly why the fit is the origin. |
| 3.2 glare | `settleAt(0)`, specular mask from world geometry | **dist** (blow-out area is disc-relative), canvas | **changes** via disc area; mask is world-derived so it follows an offset. |
| 3.3 local peak | `settleAt(0)` + `PROBE_WINDOWS` (polar, disc-relative) | **canvas**, dist | **changes** in r/R space only if R changes; polar coordinates absorb an offset. |
| 3.4 terminator | `settleAt(az)` for 12 azimuths, median of 5 parallel lines | **dist**, canvas | **changes** with R (width is reported as %R) but not with an offset. |
| 3.5 pin cores | `settleAt(az)` + `pinAnchors()` + `project()` | **dist**, canvas | **changes.** `rOverR` is measured from the *fitted* disc centre, and the validity rule rejects `rOverR > 0.97`; a distance change moves every pin's r/R (see §5). |
| 3.6 ring cast | `settleAt(0)`, 30–60 px annulus around each pin's projected centre | **dist** (annulus is in absolute px), canvas | **changes.** The annulus radius is a fixed pixel count, so its *fraction* of R changes with distance; `annulusInsideFraction` normalises by a hardcoded `interiorCount = 8478` measured at 1280x800 (`measure.ts:1112`), which is a distance-dependent constant baked as a literal. |
| 3.7 console | `page.on('console')`, no camera | — | unaffected. |
| 3.8 zoom (`globe.spec.ts`, 5 cases) | uses `<OrbitControls>` through real wheel events | **dist**, canvas | **is the spec that measures distance.** Its cases assert named distance values, so a fit distance replacing 3.3534 makes all five fail by design — that is what the step will need to re-baseline. |
| 3.9 sentinel | glint difference images at a frozen pose | **dist** | the sentinel pair (`max 88.52`, `area6 9594`) is measured on the current framing; a distance change moves the glint's pixel extent. |
| `negative.spec.ts` | same measurements, with a defect injected at run time | inherits the above | goes red for the same reasons as the measurement it wraps, which is correct — it must keep proving the check can fail, not prove the framing. |
| `limb.spec.ts` | `setCamera` to fixed world positions | **canvas**, dist | `fitLimb` is the oracle; survives an offset, rescales with distance. |
| `harden.spec.ts` | camera-free (boot/lazy-load behaviour) | — | unaffected. |
| `boot.spec.ts`, `boot-timeline.mjs`, `gate-clock`, `history-gate`, `scene-gate`, `determinism` | camera-free; `determinism` compares two loads of the same pose | — | unaffected by distance/offset, **but** see the B finding: `determinism` compares whole loads, not two frames inside one load. |

### The (344, 392) probe

`PROBE_WINDOWS` is **W1 only**: `{ id: 'W1', rFrac: 0.91, angleDeg: 180, size: 40 }`
(`src/lib/look/helpers.ts:808-810`). It is polar on purpose: the original list was absolute
pixels and included `(300, 392)`, which is at **1.045 R** — outside the disc, in pure
atmosphere halo — and that is what made 3.3 report a spurious 3.7× "local peak".

The `(344, 392)` figure is the **historical absolute coordinate** of the blue circle left by the
removed fill light, and it survives only as a regression anchor:

- `helpers.test.ts:743-751` asserts `resolveWindow(W1, geom).x ≈ 640 − 0.91·325.66 = 343.6`
  → rounds to **344**, and `y == 400` (not 392) because W1 is horizontal and the disc centre at
  the default viewport is y = 400. The 392 belongs to a *frame* whose disc centre sat at
  y = 392; the window follows the disc, so the y coordinate moved with the product.
- `globeLook.ts:209` records the luminance evidence (114 vs ~18 surrounding ocean) at that point.
- `look.spec.ts:236-237` asserts that **no absolute** `(300,392)` window survives, and
  `look.spec.ts:511` names the same mistake ("variation as a pin's delta is exactly the
  (300,392) mistake in another costume").

**Consequence for Step 3:** W1 is safe against a view offset *because* it is polar, but it is
**not** safe against a distance change — `rFrac` is a fraction of the fitted R, and the fitted
R already moves from 325.66 to ~312.6 between 1280x800 and 1024x768. Any step that changes the
distance must re-measure the window's own validity, not just its coordinates.

---

## 5. Pin geometry

Radius the cores float at, from `GLOBE_LOOK.pins` (`src/scene/globeLook.ts`) as composed in
`GlobeScene.tsx:297-299` and `pinsWorld`:

```
anchorRadius (1.012) × idleLift (1.035) + coreOffset (0.055) = 1.10242 R
```

Confirmed independently: `docs/globe-look/FACTS-2B.md:68` ("exactly the |position| of every
anchor") and `docs/globe-look/SPEC.md:46` ("All four cores sit at 1.012 × 1.035 + 0.055 =
1.10242 R").

Projected **r/R** of each pin's core at the default view, az 0, from the committed measurement
(`test-results/look/pin-gates-az0.json`, fit `cx 639.50, cy 399.49, R 325.66`):

| pin | x | y | r/R | core radius px | normal·camDir | counted valid |
|---|---:|---:|---:|---:|---:|---|
| pacific | 291.03 | 482.31 | **1.0999** | 1.5 (floor) | 0.4574 | no — projected core outside the limb |
| us-west | 449.63 | 243.57 | **0.7544** | 2.25 | 0.8561 | yes |
| se-asia | 540.80 | 328.83 | **0.3727** | 1.54 | −0.8877 | no — faces away |
| horn-africa | 852.04 | 296.86 | **0.7247** | 1.5 (floor) | −0.5747 | no — faces away |

`docs/globe-look/FACTS-2B.md:118` notes the same spread and explains it: all four sit at
1.10242 R in *world* space, but r/R is measured from the *projected* disc centre, so the
pacific core legitimately projects to 1.10 and se-asia to 0.375 (it is on the far side of the
sphere as seen from the default camera). Only **us-west** is both front-facing and inside the
limb at az 0, which is why `pinValidity.ts:21-25` documents the rule in terms of the projected
core rather than the world radius.

---

## 6. User-zoom flag, Reset control, drawer mechanics

- **Is there a user-zoom flag today?** **No.** There is no module, store or flag recording
  whether the user has zoomed/rotated. The nearest things are (a) `travelling.current` inside
  `CameraRig`, a per-component ref for an in-flight fly-to, and (b) `spin.current.paused`,
  which the region fly-to sets. Nothing is observable outside the component, nothing is exposed
  on `window`, and nothing survives a re-render.
- **Is there a Reset view control?** **No.** There is `onReset` on `ControlDeck`
  (`src/components/ControlDeck.tsx:17`, with a `RotateCcw` icon), but it resets the **scenario
  sliders** (`useScenario().reset`), not the camera. No control anywhere restores
  `DEFAULT_POSITION` / `DEFAULT_TARGET`.
- **How does the drawer open and close?** It is **always mounted** (`src/App.tsx:158-164`
  renders it unconditionally). Open/close is a `transform` transition on the `<aside>`:
  `transition-transform duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]`
  with `translate-x-0` (open) vs `translate-x-[110%]` (closed) —
  `src/components/RegionDrawer.tsx:158-159`. So: **CSS transform transition, 500 ms,
  `cubic-bezier(0.22,1,0.36,1)`, no mount/unmount**, and `aria-hidden` toggles with it. Because
  nothing unmounts, the element's `getBoundingClientRect()` is valid at all times — which is
  what makes a `ResizeObserver`/`transitionend` insets store viable without a mount hook.
