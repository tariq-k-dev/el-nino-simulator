# STEP 3A2 — frame offset and fit distance (design memo)

Read-only. No behaviour is changed by this document. Line references are to the tree at
`9f38053` (parent `5db822c`, step 3A closed). Everything below was read, not assumed;
the two numbers that decide the fit (D0, the inset values) were measured, and every
arithmetic claim was re-derived numerically before being written down.

## 1. Camera writers today, and which write the distance

| writer | file:line | writes position? | writes **distance**? |
|---|---|---|---|
| `DEFAULT_POSITION` / `DEFAULT_TARGET` | `src/scene/CameraRig.tsx:17-18` | initial position only | sets initial distance (`length()` = **3.3533565**, shipped 3.3534) |
| `CameraRig` fly-to, target | `src/scene/CameraRig.tsx:99` | — | no |
| `CameraRig` fly-to, distance | `src/scene/CameraRig.tsx:106-115` | yes (scaled offset, clamped to control limits) | **yes**, every frame while `travelling.current` |
| `<OrbitControls>` props | `src/scene/GlobeScene.tsx:669-681` | configuration only | owns the **bounds** (`minDistance 1.25`, `maxDistance 5`) and is the only writer of them |
| OrbitControls internals (wheel / pinch / drag) | reacts to `domElement` events; applied inside `controls.update()` (`src/scene/CameraRig.tsx:120,132`) | yes | **yes** — the user's zoom |
| planet auto-rotate | `src/scene/EarthSystem.tsx:49` (`spin.current.y`) | no — it rotates the `<EarthSystem>` group | no |
| `__globe.setCamera` | `src/lib/globeProbe.ts:211-219` | yes (`camera.position.set` + `lookAt`) | yes, by construction (probe only, E2E-gated) |
| `__globe.setAzimuth` | `src/lib/globeProbe.ts:233-240` | via `setCamera` | **preserves** it (`defaultOrbit()` reads the live radius) |
| `__look.setAzimuth` | `src/scene/GlobeScene.tsx:413-425` | via `__globe.setAzimuth` | preserves, same as above |
| `__look.animate` | `src/scene/GlobeScene.tsx:427` | no camera write | no |

So there are exactly **four** writers that can move the distance: the fly-to
(`CameraRig.tsx:106-115`), OrbitControls' own wheel/pinch, `__globe.setCamera`, and the
initial `<Canvas camera position>` (`GlobeScene.tsx:220`). A fifth — the new fit — is what
step B/C add. The fly-to is the only one that runs **per frame**, which is what the
`lastFit` rule in §6 has to coexist with.

## 2. Projection consumers, and which would disagree with a view offset

The test is: does it go through `camera.projectionMatrix` (then `setViewOffset` moves it
consistently), or does it recompute from `fov` + a size (then it is wrong by the offset)?

| consumer | file:line | path | verdict under a view offset |
|---|---|---|---|
| `__globe.project` / `probe.pins()` | `src/lib/globeProbe.ts:141-153, 189-200` (via `projectVector`, `:262-294`) | hand-written `matrixWorldInverse` × **`projectionMatrix`** | **consistent** — and it is NDC→px with the full canvas size, which is exactly what `setViewOffset` preserves |
| `__globe.discRadiusPx` | `src/lib/globeProbe.ts:173-182` | recomputes `focalPx = H/2 / tan(fov/2)` from the **full** canvas height | **consistent** — the view offset keeps `fov` and the NDC mapping over the full viewport, so the pixel radius is unchanged |
| drei `<Html>` pin labels | `node_modules/@react-three/drei/web/Html.js:11-17` (`defaultCalculatePosition`), used by `src/scene/Hotspot.tsx:273-274` | `objectPos.project(camera)` → NDC × full canvas size | **consistent** — this is why the labels and the probe cannot drift apart |
| Raycaster (pin picking) | R3F's default pointer path, `onClick` at `src/scene/Hotspot.tsx:178-186` and the ring's `:147-150` | three's `Raycaster.setFromCamera` → `unproject` → **`projectionMatrixInverse`** | **consistent** by construction: the inverse of the matrix the offset modified. It is nonetheless *proved* by F9 rather than assumed |
| `fitLimb` (360-ray circle fit) | `tests/e2e/look/capture.ts:239`, `tests/e2e/look/measure.ts:1065` (`focalPxFromFov`), `src/lib/look/helpers.ts:458,470` | screenshot pixels; `focal` from fov + **height** | consistent in *value*; it **measures** the disc rather than computing its centre, so a centring offset is absorbed by the fit (this is why the look suite survives the offset) |
| post-processing (`EffectComposer`, `Bloom`, `Vignette`) | `src/scene/GlobeScene.tsx:691-704` | renders with the same camera; bloom/vignette are screen-space over the full canvas | **consistent** — full-canvas, unaffected by a view offset |
| starfield point size | `src/scene/Starfield.tsx:49,72` | `gl_PointSize` from `uPixelRatio` and view-space z only | unaffected (no fov, no size, no NDC) |
| `window.innerWidth/Height` reads | `src/layout/useInsets.ts:70` (`readViewport`) | feeds the *fit*, not the projection | correct input to the offset, not a projection consumer |
| `__globe.insets()` | `src/lib/viewport/insets.ts` (`getInsets`), wired at `src/scene/GlobeScene.tsx:268` | returns the **zero stub**, not the live `src/layout/useInsets.ts` store | no disagreement — nothing reads it, and it stays zero. Recorded because it is a live trap: a spec must not read it and expect real insets |

**No consumer recomputes a projection from fov and size in a way the offset would break.**
`discRadiusPx` and `fitLimb` do compute from fov, but both need only the *radius*, and a
view offset translates the frustum without scaling it. The one thing that would have been
wrong — projecting a world point through a hand-rolled `fov`/aspect matrix — does not exist
in this codebase.

## 3. Sign convention (to be verified numerically in B, not assumed)

For viewport `W x H` and free-rect centre `(cx, cy)`:

```
dx = cx - W/2        dy = cy - H/2        camera.setViewOffset(W, H, -dx, -dy, W, H)
```

`setViewOffset(fullW, fullH, offsetX, offsetY, width, height)` renders the sub-window at
`(offsetX, offsetY)` in a full frame of `fullW x fullH`. A **negative** `offsetX` shifts the
window left, which moves the projected content **right** in the same proportion; the
inverse of the offset is that proportional shift. Step B proves the two signs by
construction: it builds a `PerspectiveCamera`, applies the computed offset, places it at
`dTarget`, projects the projected centre of a `Re` sphere, and asserts it lands on
`(cx, cy)` within 0.01 px.

## 4. Fit math (pure, in `computeFrame`)

```
Re = 1.10242                      pin envelope, pin core radius override: see §5
f  = H / (2 * tan(fov/2))         px, full viewport height (fov = 42, GlobeScene.tsx:220)
r_max      = 0.5 * min(freeW, freeH) - FRAME_PADDING_PX   (24)
d_contain  = sqrt(Re^2 + (f * Re / r_max)^2)
d_target   = clamp(max(d0, d_contain), d0, d_max)          d_max = 5 (GlobeScene.tsx:678)
```

`d_contain` is the tangent-length form: the silhouette radius of a sphere of radius `Re` at
distance `d` is `f * Re / sqrt(d^2 - Re^2)`, and solving `= r_max` gives the expression
above. `d0` is **read** from `DEFAULT_POSITION.length()`, never retyped: measured
**3.3533565** (the shipped 3.3534 is its 4-dp rounding). Zoom-out only, so
`d_target >= d0` always; the clamp to `d_max` is the existing OrbitControls bound.

Degenerate (`r_max <= 0` or an empty free rect): zero offset, `d_target = d0`, `degenerate`
flagged.

**Measured, at insets `L 360.844 R 316 T 118.3 B 0` and the four spec viewports:**

| viewport | free | free centre | dx, dy | r_max | d_contain | d_target | silhouette at d_target |
|---|---|---|---|---|---|---|---|
| 1280x800 | 603.156 x 681.700 | 662.422, 459.150 | +22.422, +59.150 | 277.578 | 4.283 | **4.283** | 277.57 (−0.01) |
| 1024x768 | 347.156 x 649.700 | 534.422, 443.150 | +22.422, +59.150 | 149.578 | 7.455 | **5.000** (clamped) | 226.13 (+76.55) |
| 1440x900 | 763.156 x 781.750 | 742.422, 509.125 | +22.422, +59.125 | 357.578 | 3.779 | **3.779** | 357.54 (−0.04) |
| 1280x720 | 603.156 x 601.700 | 662.422, 419.150 | +22.422, +59.150 | 276.850 | 3.894 | **3.894** | 276.83 (−0.02) |

The 1440x900 centre reproduces the Step C figure shipped in the prompt (**742.422, 509.125**)
exactly — the arithmetic here and the insets store agree.

**Consequence, recorded up front:** at 1024x768 the layout needs `d_contain = 7.455` but
`d_max` is 5, so the clamp binds and the disc is **larger** than `r_max` by 76.55 px. Fit
can only zoom out to the existing control limit, so F4 (every front-facing pin inside the
free rect) is arithmetically unreachable at that viewport without changing `d_max`. That is
a measured prediction, not a discovery to be made at report time.

## 5. Mode resolution

Production: **always live**. With `import.meta.env.VITE_E2E === '1'`: **locked** unless the
URL has `framing=live`. The locked branch is guarded by that one expression only, so Rollup
folds it away in a production build; step C proves it by grepping `dist/assets/*.js` for a
marker string that exists nowhere else.

Why the locked mode must be byte-identical rather than "close": `ref.spec.ts` compares a
crop of the frame to a committed PNG at **strict 0** (`docs/E2E.md`, "The reference frame"),
and the five `globe.spec.ts` zoom cases assert named distances. Locked mode therefore
writes **no** view offset, makes **no** fit, and leaves `camera.view` null.

Note the pre-existing gate mismatch, **reported, not fixed**: `__globe` and friends are
installed under `VITE_E2E === '1' && ?debug` (`src/scene/GlobeScene.tsx:234`), while the
build is gated on `VITE_E2E` alone. `__frame` follows the `__globe` gate (both), so a spec
that wants `__frame` must also pass `?debug` — the same shape every globe spec already has.

## 6. Distance rule and offset application (step C)

`lastFit` is the distance the rig last wrote. When `d_target` changes: if
`|currentDistance - lastFit| < 0.002` the user has not moved it, so ease to the new
`d_target` and set `lastFit`; otherwise leave the distance alone (user zoom or another
writer owns it). The **offset always** follows the insets — it is layout, not preference.

First application snaps; later changes ease with a frame-rate-independent exponential, time
constant 180 ms, and snap instantly under `prefers-reduced-motion`. The offset is applied
only when it changed by more than 0.01 px. The rig reads the insets store **imperatively
inside `useFrame`** (no React re-render per frame) and re-applies `view.fullWidth` /
`fullHeight` on every canvas resize, because R3F resets the projection on resize.

`lastFit` initialises to the **live** distance at mount, not to `d0`. Otherwise the very
first frame would read "the user has not moved it" while sitting at some other distance and
the first fit application would be invisible.

## 7. Contradictions with the audit

None. Items 3-6 are consistent with `docs/STEP3-AUDIT.md` §1 (writers), §2 (insets inputs)
and §6 (no user-zoom flag, no reset control). Two facts worth carrying forward, both
already in the audit and neither a contradiction:

1. The `d_max` clamp in §4 is a **new** limit on the fit that the audit did not anticipate;
   it is the existing control bound, so honouring it cannot regress zoom.
2. `__globe.insets()` reads the zero stub, not the live store (§2). Nothing consumes it, so
   it is harmless today and would be a silent trap for a future spec.
