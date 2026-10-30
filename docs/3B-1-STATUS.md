# 3B-1a status — globe zoom, specular glare, framing

Honest state at the point this work stopped. No half-applied step: every commit in
this document is green under `pnpm tsc -b && pnpm lint && pnpm test && pnpm build`.

---

## STEP 1 — ZOOM: **DONE**

Commit: `4354cd1 fix(globe): zoom was erased every frame by CameraRig; claim touch gestures`
Commit: `f878577 fix(probe): __globe.project() reported the globe centre as behind the camera`

### Root cause (diagnosed before patching)

Zoom was never disabled — it was **overwritten every frame**.

`CameraRig`'s `useFrame` re-derived the camera distance from
`desiredDistance.current` unconditionally, and that ref is only assigned by the
`activeRegion` effect. Between flights it held `DEFAULT_POSITION.length()` =
**3.3534** forever:

```ts
const wanted = desiredDistance.current;                     // 3.3534, constant
camera.position.copy(target).add(offset.setLength(lerp(cur, wanted, ease)));
```

OrbitControls applied each wheel notch correctly and the next frame (~17 ms later)
discarded it. The same block also rewrote `controls.minDistance` / `maxDistance`
every frame to a 1.55–3.63 window derived from `wanted`, so a surviving zoom had
nowhere to go.

| Evidence | Measurement |
|---|---|
| Idle distance, 10 samples 100 ms apart | `3.35336` × 10 — perfectly constant |
| 6 wheel notches in | 3.3534 → **3.3235** |
| 12 notches out | → 3.3764, drifting back toward 3.3534 |
| `elementFromPoint` at canvas centre | `CANVAS` (no overlay swallowing input) |
| `enableZoom` / OrbitControls config | correct before the fix |

The drift *toward* a fixed value is the signature of a per-frame writer, not of an
inert control — which is why the first hypothesis (an overlay eating the wheel) was
wrong and was ruled out by (b) before changing anything.

**Fix:** the rig drives the camera only while `travelling.current` is true;
otherwise it calls `controls.update()` and nothing else, so the controls own the
camera. The fly-to clamps its target distance into `[minDistance, maxDistance]`
rather than overriding those bounds.

### Two further defects found while testing pinch

**2. `touch-action` was `auto` on the canvas.** three-stdlib's OrbitControls writes
`domElement.style.touchAction = "none"` on connect and `"auto"` on **dispose**, and
the canvas ended up with inline `auto`. Inline beats both a stylesheet rule and the
inherited value, and R3F's `style` prop applies to its wrapper div, not the
`<canvas>`. With `auto` the browser claims a two-finger gesture as page zoom and
cancels the pointer stream, so pinch never reached the controls. A property-set trap
recorded **zero** canvas writes, so the winning writer sets `cssText`; a
`MutationObserver` on the `style` attribute is what wins regardless of who writes,
and it is idempotent so it settles after one pass.

**3. Wheel over a pin label did nothing.** A drei `<Html>` label is a *sibling* of
the canvas and `pointer-events: auto`, so a wheel aimed at a pin reached neither
OrbitControls' `domElement` listener nor open space. drei portals `<Html>` outside
the React root that owns `Hotspot`, so React's synthetic `onWheel` there is silently
dead — a native listener re-dispatches wheel onto the canvas.

### Requirements met

`enableZoom` on, `minDistance = EARTH_RADIUS * 1.25`, `maxDistance = EARTH_RADIUS * 5`
(both expressed against the radius rather than literals), `enablePan={false}`,
`enableDamping`, wheel **and** two-finger pinch, `touch-action: none` on the canvas,
`overscroll-behavior: contain`, `touches` named explicitly (`ONE: ROTATE`,
`TWO: DOLLY_PAN`).

### Acceptance — `tests/e2e/globe.spec.ts`, 5/5, 1.5 min

| Case | Result |
|---|---|
| wheel at globe centre: monotonic in, clamps at 1.25; monotonic out, clamps at 5 | **PASS** |
| wheel over an unoccluded pin label zooms | **PASS** |
| pinch at 375×667 via CDP `Input.synthesizePinchGesture` (+ manual two-point fallback) | **PASS** |
| zoom still works after a region fly-to | **PASS** |
| wheel over the control deck does **not** zoom | **PASS** |

Two test-side traps worth carrying forward:

- The default Playwright context is **not touch-capable**, so CDP touch events are
  accepted and silently discarded. `hasTouch: true` is required, and without it the
  failure reads exactly like a broken gesture handler.
- At 375×667 the canvas centre sits **behind the control deck** (panel spans
  x 16–359 / y 131–651), so a centre pinch reaches the panel and the canvas receives
  no `pointerdown` at all. The pinch origin is now computed from the largest
  uncovered area via `elementFromPoint`.

---

## STEP 2 — SPECULAR GLARE: **NOT STARTED** (diagnosed, not fixed)

Diagnosis is partially complete and one hypothesis has been **eliminated**.

### What the blowout is not

Screenshot `docs/globe-look/shot-b-upperleft.png` (fixed camera at `[2.2, 1.6, 2.2]`,
DOM chrome hidden) shows two distinct bright areas:

1. A **compact** specular highlight mid-Atlantic — this is the ocean glint, and it
   reads correctly as a highlight, not a floodlight.
2. A **large, broad** near-white/amber flood over the western US, coincident with
   the **California hotspot marker**.

The upper-left blowout is therefore **#2**, and it is not the specular term.
`Hotspot.tsx` gives every pin a `pointLight` (`intensity 0.9` when active, `0.35`
otherwise, `distance 0.5`, `decay 2`) sitting ON the surface at radius 1.012. At
0.5 units of range on a globe of radius 1, that light covers a large solid angle and
lights the cloud and surface shells from very close range — which is exactly the
"broad floodlight over the active region" visible in the shot.

Post-processing **bloom** was also checked as a candidate and is not implicated in
the flood: `Bloom` has `luminanceThreshold={0.62}`, which passes an already-bright
surface but does not create the underlying brightness.

### What remains

- Confirm quantitatively by toggling `isPointLight.intensity` to 0 at the fixed
  camera (the harness existed but measured through `project()`, which was returning
  `behind: true` for the globe centre — fixed in `f878577`, so the next run will
  produce real numbers instead of a 1-pixel sample).
- Introduce the single exported, commented `GLOBE_LOOK` constants object with the
  brief's starting values (`specularStrength ~0.12`, shininess `~48`, ocean-masked
  specular, bloom `luminanceThreshold >= 0.95`, surface colour clamped `<= 0.92`
  pre-tonemap).
- Move the hotspot light out of the surface (or drop it in favour of the existing
  emissive ring), which the diagnosis says is the actual fix.
- Implement the acceptance test: `pngjs` is already installed, and the probe now
  supports it — decoded PNGs, `R,G,B >= 250` inside `__globe`'s disc `<= 0.05%`,
  night-side mean luminance `< 25%` of day-side, three fixed camera angles.
- Save before/after pairs to `docs/globe-look/` (JPEG, `<= 300 KB`, max 6 files).

Current placeholder shots in `docs/globe-look/` (`shot-a-default.png`,
`shot-b-upperleft.png`, `shot-c-side.png`) are **before** images only, captured for
the diagnosis. They are PNG and over 300 KB, so they must be replaced by the
JPEG before/after pairs before this step is called done.

---

## STEP 3 — FRAMING: **NOT STARTED** (scaffolding only)

`src/lib/viewport/insets.ts` exists with the final `Insets` shape, a
`useSyncExternalStore`-compatible subscribe/get pair, and `__setInsets` / `__resetInsets`
seams. `getInsets()` returns zeros and `<FrameOffset>` does not exist yet, so
behaviour is unchanged.

Not yet built: occluder registration (`data-occluder`), measurement against the
canvas rect, the `ResizeObserver` + `transitionrun`/`transitionend` + 500 ms
mutation-window re-measure, `<FrameOffset>` damping with `setViewOffset`, the
`rho`-based fit distance, the manual-zoom flag, and the reset-view action.

---

## Gate state

| Command | Result |
|---|---|
| `pnpm tsc -b` | clean |
| `pnpm lint` | clean (`--max-warnings 0`) |
| `pnpm test` | **494 passed** (19 files) |
| `pnpm build` | 17 assets, **0 test hooks** |
| `pnpm e2e:globe` | **5/5**, 1.5 min |
| full `pnpm e2e` | **not run since STEP 1** — the last full run was 21/21 before this part |

`cross-env` and `pngjs` (+ `@types/pngjs`) are now devDependencies, and
`e2e:globe` is a script so the targeted run works identically on Windows and POSIX
shells.
