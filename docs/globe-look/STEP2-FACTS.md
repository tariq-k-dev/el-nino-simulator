# STEP 2 facts — 3B-1a-CLOSE-A

Read-only measurement pass. **No visual constant was changed in this task**, and no
Step 3 work was started. Everything below is measured from the current build
(`pnpm build:e2e` at commit `879e490`) at 1280×800, DPR 1, DOM chrome hidden.

Reproduce with the harnesses committed alongside this doc:

```bash
pnpm build:e2e
node tests/e2e/brotli-server.mjs dist 4197 &
node tests/e2e/globe-facts.mjs     # (a) lights, (b) blue dot, (c) atmosphere, (d) pins, (f) shot
node tests/e2e/globe-probe2.mjs    # (d) pin core RGB, (e) naive pin-vs-off halo
node tests/e2e/globe-halo.mjs      # (e) noise-controlled halo  <- the number to trust
node tests/e2e/globe-control.mjs   # (e) proof the naive halo was contaminated
```

---

## (a) The 4 remaining lights

All four are direct children of `Scene` (`parentChain: ["Scene"]`). **All are
world-fixed** — nothing between them and the scene root is re-parented by
`CameraRig`, `OrbitControls` or any spinner. The camera's own parent chain is
empty (`rig.cameraParentChain: []`), confirming no rig group owns any light.

| # | Type | Colour | Intensity | Position | World-fixed? |
|---|---|---|---|---|---|
| 1 | `AmbientLight` | `#7aa7d9` | 0.055 | (0, 0, 0) — position irrelevant | World-fixed |
| 2 | `DirectionalLight` (key / sun) | `#fffaf2` | 3.6 | (5.76, 2.88, 4.72) = `SUN_POSITION` | World-fixed |
| 3 | `DirectionalLight` (cool fill) | `#2f6fb8` | 0.32 | (−5.2, −2.2, −4.6) | World-fixed |
| 4 | `DirectionalLight` (rim) | `#c9d8ff` | 0.38 | (−3.4, 1.8, −5.0) | World-fixed |

`castShadow: false` on all four; no `distance`/`decay` (they are not point lights).

**Before/after the pin-light removal: 8 → 4 lights.** The four removed were the
per-pin `<pointLight>`s in `Hotspot.tsx` (intensity 0.9 active / 0.35 idle,
distance 0.5, decay 2) — the mobile perf win the brief asked for.

One nuance worth recording: light 2 is world-fixed but the *planet* spins under
it, so the terminator is stable in world space while a pin's relationship to the
sun changes as the Earth turns. That is correct behaviour (a fixed sun) and is
what makes the day/night pin test in (d) possible by moving the camera only.

---

## (b) The blue dot at the left limb, near (345, 390)

**It is gone in the current build.** In `docs/globe-look/shot-a-default.png`
(the pre-Step-2 image) it is a compact **7×9 px cluster at (345, 391)**, which is
**r = 295 px = 0.91 R** — squarely inside the disc, near the left limb of the
*starfield-lit* hemisphere.

Colour evidence from the old shot:

| Sample | RGB | Reading |
|---|---|---|
| centre (344, 390) | **(255, 255, 255)** | pure white |
| (349, 391) | (65, 147, 243) | saturated blue |
| peak blue-dominance (348, 387) | (69, 155, 255) | `b − r = 186` |
| (345, 385) | (57, 132, 218) | blue |

That is a **white core with a blue fringe** — the exact signature of a star
sprite in `Starfield.tsx`, whose fragment shader is
`gl_FragColor = vec4(vColor * (0.85 + core * 0.5), alpha)` with a *blue-white*
palette (`[0.62, 0.74, 1.0]` etc.). A scene object would not be pure white at its
centre with blue only in the halo.

Supporting measurement: at the same coordinate in the current build the brightest
pixel is **(53, 123, 204), luminance 114** — the atmosphere rim at 0.91 R, not a
sprite. And the old shot contains **146 separate bright clusters** inside the
disc, the largest of which is a 118×110 px cloud mass; a one-off artifact it is
not.

**Conclusion:** it is a single star, i.e. part of the `Starfield` `Points` object
(14 000 sprites across three depth shells), and its position there is
**non-deterministic between builds** — `Starfield.tsx` seeds every star with
`Math.random()`:

```ts
const theta = Math.random() * Math.PI * 2;
const phi = Math.acos(2 * Math.random() - 1);
```

Nothing in the repo names or enumerates scene objects (`scene.children` reports
`name: null` for every entry), so there is no object name to give beyond "a
sprite inside the `Starfield` `Points` mesh". It is not a bug and nothing to fix.

**Scene child inventory** (for the record): `AmbientLight`, `DirectionalLight`
×3, an unnamed `Group` with 5 children (the Earth system: surface, clouds,
atmosphere, overlay, hotspots), and an unnamed empty `Group`. The `Starfield`
`Points` is *not* a scene child because `hideChrome`/`stars:false` had removed it
at inventory time — it mounts as a direct `Scene` child via R3F's `<points>`.

---

## (c) Raw atmosphere radial profile at the default view

Default camera `[0, 1.15, 3.15]`, globe centre (640, 400), **disc radius
R = 325.56 px**, atmosphere shell silhouette at **1.10 R = 358.11 px**.
16 rays at 22.5° spacing, nearest-pixel sampling, Rec. 709 luminance 0–255.
`mean` is the 16-ray average per radius offset; `off` is the same offset with the
atmosphere layer switched off, which is what isolates the shell.

### 10 px inside the limb → 40 px outside

| offset (px) | atmos OFF | **atmos ON** |
|---:|---:|---:|
| −10.56 | 61.0 | 66.4 |
| −9.56 | 60.6 | 64.1 |
| −8.56 | 61.1 | 61.0 |
| −7.56 | 54.2 | 51.8 |
| −6.56 | 56.3 | 57.6 |
| −5.56 | 56.2 | 55.8 |
| −4.56 | 48.3 | 48.4 |
| −3.56 | 46.1 | 47.4 |
| −2.56 | 52.2 | 50.6 |
| −1.56 | 52.3 | 52.0 |
| −0.56 | 41.8 | 55.4 |
| **+0.44** | 43.7 | **99.0** ← peak |
| +1.44 | 19.9 | 94.5 |
| +2.44 | 3.4 | 80.4 |
| +3.44 | 3.4 | 72.1 |
| +4.44 | 3.4 | 66.8 |
| +5.44 | 3.4 | 58.1 |
| +6.44 | 3.4 | 51.2 |
| +7.44 | 3.4 | 47.0 |
| +8.44 | 3.4 | 40.0 |
| +9.44 | 3.4 | 36.9 |
| +10.44 | 3.4 | 30.9 |
| +11.44 | 3.4 | 27.7 |
| +12.44 | 3.4 | 23.5 |
| +13.44 | 3.4 | 19.0 |
| +14.44 | 3.4 | 16.7 |
| +15.44 | 3.4 | 13.7 |
| +16.44 | 3.4 | 10.7 |
| +17.44 | 3.4 | 8.6 |
| +18.44 | 3.4 | 7.4 |
| +19.44 | 3.4 | 6.1 |
| +20.44 | 3.4 | 5.2 |
| +21.44 | 3.4 | 4.6 |
| +22.44 | 3.4 | 4.2 |
| +23.44 | 3.4 | 3.9 |
| +24.44 | 3.4 | 3.8 |
| +25.44 | 3.4 | 3.6 |
| +26.44 | 3.4 | 3.5 |
| +27.44 | 3.4 | 3.4 |
| +28.44 | 3.4 | 3.4 |
| +29.44 | 3.4 | 3.3 |
| +30.44 … +40.44 | 3.3–3.4 | **3.3** (floor) |

### Peak halo

| Quantity | Value |
|---|---|
| **Peak halo luminance** | **99.0 / 255** |
| **Peak pixel offset** | **+0.44 px** from the geometric limb (radius 326.0 px) |

The peak sits within half a pixel of the limb, which is the physically right
place: optical depth through the atmosphere is maximal where the view ray grazes
the surface.

### The step at the globe limb

| Transition | Δ luminance | Note |
|---|---:|---|
| −0.56 → +0.44 | **+43.6** | limb crossing: 55.4 → 99.0 |
| +0.44 → +1.44 | **−4.5** | first pixel of falloff |
| +1.44 → +2.44 | **−14.1** | steepest falloff pixel |
| at shell silhouette (358.1 px) | 3.3 | equals background 3.3 |

The limb step (+43.6) is *upward* and happens exactly at the geometric edge — this
is the planet's own bright rim, **not** a shell artifact: the atmosphere-off
column jumps 41.8 → 43.7 → 19.9 → 3.4 across the same pixels, i.e. the opaque
planet ends and space begins. Beyond the limb the shell only ever decays.

### Why the worst adjacent step is exactly 0.00 / 255

**Because I measured the wrong range in the earlier pass, and the brief's rule is
defined over a range where the profile is already smooth.**

Two facts:

1. The acceptance rule is about the profile **beyond the limb**. Measured over
   `r ≥ ceil(R)+1`, the worst upward step is **exactly 0.00** — every one of the
   16 rays is monotonic non-increasing from the first pixel outside the limb to
   the background 40 px later. That is not a suspiciously round number from a bug;
   it is a genuine floor of zero, because the profile is *strictly* decreasing
   there and no ray has any upward movement at all. The worst *downward* step over
   the same range is **36.1** at 292.5° (327→328 px: 125.5 → 89.4), which is the
   sharp falloff working as designed.

2. In the earlier measurement I sampled from **R − 4**, i.e. from *inside* the
   disc, and took the maximum of `value[k] − value[k−1]` over that whole span.
   Over that range the profile *must* rise steeply into the limb peak, so the
   "worst step" was simply the limb crossing (92–160 units) — a measurement error,
   not a rendering defect. Sampling a monotonically-rising function over the range
   where it rises can never report a small step.

So the regression that reported `worstUp 160.6` and the later `0.00` are the same
scene measured over two different ranges. The current answer, over the range the
rule actually specifies, is 0.00 because there is no upward movement outside the
limb at all.

Two supporting facts make the zero trustworthy rather than accidental:

- **Stars are off.** With stars on, exactly two rays (157.5° and 247.5°) each had
  a single-pixel upward spike 3.2 → 59.7, which is a star sprite sitting on the
  ray. Those were removed by the `stars` flag, not by tuning the atmosphere.
- **Shell silhouette == background.** 3.3 vs 3.3 (Δ 0.00, budget 2/255). The
  impact-parameter formulation reaches exactly 0 at 1.10 R by construction, so the
  shell has no edge to step at.

---

## (d) Pin housing check — California, day side and night side

Colour is reported alongside luminance because **luminance cannot tell amber from
white**: `(255,255,158)` and `(255,255,255)` differ by only 3 luminance points but
by 97 in channel spread. "Flat pure-white blob" is a channel question.

### Day side

Camera `[0, 1.15, 3.15]` (default), and `[0, 1.15, 1.25]` (min zoom, where the
core is largest: disc radius 759 px).

| View | Sample | Mean RGB | Mean lum | Max lum | Mean ch-spread | Pure-white share |
|---|---|---|---:|---:|---:|---:|
| default | 4 px disc | **(255, 255, 172)** | 249.0 | 250.2 | 83.4 | **0.00** |
| min zoom | 6 px disc | **(255, 255, 158)** | 248.2 | 249.1 | 97.3 | **0.00** |

### Night side

Anti-sun camera `[−1.84, −0.57, −1.51]` — moved to the anti-solar point at the
same distance, so the pins on that hemisphere are genuinely on the night side
(the sun is world-fixed, so rotating the *view* is the honest way to test this).

| Pin | Mean RGB | Mean lum | Max lum | Mean ch-spread | Pure-white share |
|---|---|---:|---:|---:|---:|
| `pacific` | (240, 238, 123) | 230.4 | 246.5 | 116.9 | 0.00 |
| `se-asia` | (255, 255, 150) | 247.4 | 247.7 | 104.9 | 0.00 |

**Verdict: the housing behaves.**

- **Day side:** mean core luminance **248–249 / 255**, RGB is amber-biased
  (blue channel 158–172 against R=G=255), channel spread **83–97**, and
  **zero** pure-white pixels. So the core is a bright saturated amber, **not a
  flat pure-white blob** — the earlier "black blob" symptom (mean ~10/255) is
  gone, and the fix was replacing the concentric housing *sphere* (radius 0.016,
  which enclosed the 0.011 core) with a dark **disc** behind it.
- **Night side:** mean core luminance **230–247 / 255** against a surface that is
  near-black. The emissive core does not depend on incident light, which is
  precisely why it reads on both limbs: brightness is a fixed property of the
  material, not of what the pin is standing on.
- Note the pinned R=G=255 with only B suppressed: the core is near-clipped in red
  and green. That is `emissiveIntensity 1.75 × toneMapped:false`, i.e. a
  deliberately self-lit emitter. It is *inside* the glare rule's exclusion discs
  (pins are allowed to be bright) and contributes 0 clipped pixels outside them,
  so it does not violate anything — but it is the reason `pins:false` and
  `pins:true` frames differ so violently in (e).

---

## (e) Bloom: configuration and halo width

### Configuration (from `GLOBE_LOOK.bloom`, `src/scene/globeLook.ts`)

| Parameter | Value |
|---|---|
| `intensity` | **0.42** |
| `radius` | **0.55** |
| `luminanceThreshold` | **0.95** |
| `luminanceSmoothing` | **0.22** |
| `mipmapBlur` | **true** (set as a flag; the mip chain is what spreads the glow) |

### Does a pin's bloom exceed the 30–60 px ring-luminance check radius?

**No.** A pin's total footprint — geometry plus any bloom — ends at about **22 px**
and is indistinguishable from noise by **24 px**. Well inside 30 px.

This needed three attempts, because the first two were measuring animation rather
than the pin. Recording all three, since the wrong numbers looked plausible:

| Attempt | Setup | Result | Why it was wrong |
|---|---|---|---|
| 1 | toggle `pins` **and** `hotspotRings` together, all layers on | delta ≥ 1/255 out to **80 px** | measured the pulsing ring's own additive glow, not the pin |
| 2 | toggle `pins` only, ring held on, atmosphere breathing | delta 12–22 at 30–70 px | contaminated — see control below |
| 3 | rings OFF, atmosphere OFF, stars OFF (fully static scene) | see below | **trustworthy** |

**The control that exposed attempt 2:** two consecutive frames with **pins
already off**, rings on, nothing toggled — pure animation noise, measured at
**up to 66 luminance units in the 0–12 px band and 26 in 25–75 px**. That is
larger than the pin's apparent contribution, so attempt 2's "halo" was the ring's
`uTime` pulse.

### Attempt 3 — static scene, the number to trust

Pin `us-west` at (327, 254); camera `[0, 1.15, 2.0]`; rings/atmosphere/stars off.
Noise floor from two identical frames: **max |Δ| = 5.96** over the whole 0–100 px
range (3.21 in 0–12, 5.96 in 25–75).

| Radius | Δ with bloom | Δ without bloom |
|---:|---:|---:|
| 0 | +156.5 | +142.9 |
| 4 | +166.8 | +172.8 |
| 7 | +179.5 | +190.2 |
| **8** | **+179.8** ← core edge | **+182.9** |
| 9 | +120.8 | +64.2 |
| 10 | +62.5 | −12.6 |
| 11 | +39.2 | −27.3 |
| 12 | +29.4 | −26.6 |
| 13 | +21.4 | −26.0 |
| 14 | +25.6 | −4.3 |
| 16 | +17.1 | −5.3 |
| 18 | +9.3 | −3.9 |
| 20 | +4.8 | −6.0 |
| **22** | **+6.8** ← last above noise | −5.4 |
| 24 | +1.8 | −2.8 |
| 30 | −0.7 | −4.4 |
| 45 | +1.2 | +0.3 |
| 60 | −2.8 | +2.1 |
| 80 | −0.1 | +0.9 |

| Summary | Bloom ON | Bloom OFF |
|---|---:|---:|
| Last radius with Δ above the 5.96 noise floor | **22 px** | 13 px (then noise) |
| Δ at 30 px | **−0.7** | −4.4 |
| Δ at 45 px | +1.2 | +0.3 |
| Δ at 60 px | −2.8 | +2.1 |
| Δ at 80 px | −0.1 | +0.9 |

**Conclusion.** Bloom **does** add a measurable skirt: with bloom on the pin's
influence extends to ~22 px versus ~13 px without it, so bloom contributes roughly
**9 px** of extra halo. That is far short of the 30–60 px ring-luminance check
radius, so **the ring-luminance check is not corrupted by pin bloom** — with the
one caveat that the check must start at ≥24 px, not at 12 px, or the pin's own
skirt leaks into it. At 30/45/60/80 px every delta is within the ±6 noise floor.

(This also explains why attempt 2 saw 15–21 at 30–60 px: that band was the ring,
not bloom.)

---

## (f) Screenshot

`docs/globe-look/step2-default.png` — default camera `[0, 1.15, 3.15]`, all layers
on, stars on, DOM chrome hidden, 1280×800, **238 KB (≤300 KB)**, 256-colour PNG.

---

## Gate state at this commit

| Command | Result |
|---|---|
| `pnpm tsc -b` | clean |
| `pnpm lint` | clean (`--max-warnings 0`) |
| `pnpm test` | **494 passed** (19 files) |
| `pnpm build` | 17 assets, **0 test hooks**, `check-assets` OK |

Commit: `879e490 feat(globe): remove pin pointLight, rim shell via impact parameter, tame specular/bloom`

---

## What is still open (Step 2 acceptance, from the brief)

These are **not** addressed here by design — this task was measurement only:

1. **Specs not written.** The acceptance rules live in the throwaway harnesses
   above, not in `tests/e2e/globe.spec.ts`. `globe.spec.ts` still holds only the
   5 Step 1 zoom cases.
2. **Pin cast-light ring check still noisy.** With rings isolated, deltas were
   0.12–8.02% against a 3% bar on two pins. Part of that is antialiasing at the
   core edge inside the sample ring; it needs a wider inner radius (the core edge
   is at 8 px, per (e)) before it can be called clean.
3. **Ring-luminance check radius must be ≥24 px**, not 12 px — see (e).
4. **Before/after screenshot pairs** not produced; `docs/globe-look/` still holds
   the three oversized pre-Step-2 PNGs (`shot-a/b/c`) which must be replaced by
   ≤300 KB images before Step 2 is called done.
