# 3B-1a status — globe zoom, lighting/atmosphere, framing

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

## STEP 2 — LIGHTING + ATMOSPHERE: **FIXED, MEASURED** (specs + screenshots outstanding)

Commits:
`879e490 feat(globe): remove pin pointLight, rim shell via impact parameter, tame specular/bloom`
`f4f0fe8 docs(3b-1): STEP 2 facts -- light inventory, limb profile, pin RGB, bloom halo`

Full measurement record: **`docs/globe-look/STEP2-FACTS.md`**.

### 2a — pin lights

`<pointLight>` removed from `Hotspot.tsx`. **Light count 8 -> 4** (1 ambient,
3 directional; all world-fixed, none rig- or camera-attached). The pin core was
`meshBasicMaterial`, which ignores `emissive` — switched to `MeshStandardMaterial`
with `toneMapped={false}`, amber emissive at **1.75** idle / **1.95** active.
The `rgba()` -> `THREE.Color` console warning is gone: the material takes a
`THREE.Color`; CSS alpha only reaches the DOM.

The housing was also wrong and is now fixed: it was a concentric *sphere* of
radius 0.016 around a 0.011 core, i.e. it **enclosed** the core and the pin
rendered as a black blob (measured ~10/255). It is now a dark **disc** behind the
core. Measured core: mean RGB `(255,255,158-172)`, luminance **248-249/255**,
channel spread **83-97**, **0% pure-white pixels**.

### 2b — atmosphere

Exponent tuning alone could not work, and the reason is structural: on a BackSide
shell the fresnel `1 - |dot(n,v)|` runs from ~0.77 at the planet limb UP to 1.0 at
the shell silhouette, so alpha peaked exactly at the geometry edge.

Replaced the driver with the **impact parameter** `b`:
`x = (b-R)/(S-R)`, `fade = 1-x`, so alpha is **exactly 0 at the shell silhouette**.
Exponents **2.4 -> 1.6** and **5.5 -> 3.8** (-33% / -31%); shell scale
**1.028 -> 1.10**.

| Measure | Before | After | Budget |
|---|---:|---:|---:|
| Worst adjacent upward step, beyond the limb, 16 rays | 160.6/255 | **0.00/255** | <= 6/255 |
| Value at shell silhouette vs background | 12.6 | **0.00** (3.3 vs 3.3) | <= 2/255 |
| Peak halo luminance / offset | — | **99.0 @ +0.44 px** from the limb | — |
| Haze guard (interior vs atmosphere-off) | — | **0.32-0.89%** | <= 3% |

The `0.00` is a genuine floor, not a bug: measured over `r >= ceil(R)+1` the
profile is *strictly* decreasing on all 16 rays, so there is no upward movement
at all. An earlier pass reported 160.6 because it sampled from `R-4` — inside the
disc, over the range where the profile legitimately rises into the limb peak.
Sampling a rising function over the range where it rises can never report a small
step. (With stars ON, exactly two rays showed a single-pixel 3.2 -> 59.7 spike: a
star sprite sitting on the ray, removed by the `stars` flag.)

### 2c — residual glare

Contributor found by **ablation**, one toggle at a time at a fixed camera:

| Toggle | Clipped share |
|---|---:|
| all on | 0.1008% |
| pins off | 0.1008% (no contribution) |
| specular off | 0.1002% (~2 px) |
| clouds off | 0.0989% |
| atmosphere off | 0.1005% |
| **bloom off** | **0.0372%** (dominant) |
| surface only | 0.0372% |

Two causes, both fixed inside the single exported `GLOBE_LOOK` object:

1. **Bloom** — `luminanceThreshold` **0.62 -> 0.95**.
2. **`meshPhysicalMaterial`** — `earth_specular.jpg` is white on water and
   `roughness` MULTIPLIES the map, so inverting the mask and multiplying by 0.72
   gave water roughness **0** (a literal mirror). Added `roughnessFloor` 0.55
   compressing the inverted mask into `[floor,1]`, plus `specularIntensity` 0.18.
   Roughness tuning alone only traded a small blown disc (0.037%) for a larger one
   (0.062%); specular intensity is the lever that removes it.

**Result: 0.0000% clipped at all three camera angles**, including the upper-left
lit area. Night/day **0.14** (budget < 0.25).

### Bloom halo (asked in CLOSE-A)

A pin's total footprint — geometry + bloom — ends at **~22 px** and is at noise by
**24 px**: inside the 30-60 px ring-luminance check radius, so the check is sound.
Two earlier passes were contaminated by the pulsing ring (control: two frames with
pins off measured up to 66 units of animation noise). Measured in a fully static
scene with a **5.96** noise floor. Operational consequence: **the ring-luminance
check must start at >= 24 px, not 12 px**, or the pin's own skirt leaks into it.

### Still outstanding for STEP 2

- **Specs not written.** `tests/e2e/globe.spec.ts` still holds only the 5 STEP 1
  zoom cases. The acceptance logic exists and runs, but lives in
  `tests/e2e/globe-{measure,ablate,facts,probe2,halo,control}.mjs` and
  `globePixels.ts` — evidence, not assertions.
- **Pin cast-light ring check noisy**: 0.12-8.02% against a 3% bar on two pins,
  partly antialiasing at the core edge (core edge is at 8 px) inside the sample ring.
- **Screenshots**: `docs/globe-look/` still holds the three oversized pre-Step-2
  PNGs (`shot-a/b/c`); only `step2-default.png` (238 KB) exists so far. Before/after
  pairs and the required night-side-pin + limb close-ups are not produced.

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
| `pnpm e2e:globe` | **not re-run this pass** (nothing in the zoom path changed) |
| full `pnpm e2e` | **not run since STEP 1** — the last full run was 21/21 before this part |

`cross-env` and `pngjs` (+ `@types/pngjs`) are now devDependencies, and
`e2e:globe` is a script so the targeted run works identically on Windows and POSIX
shells.
