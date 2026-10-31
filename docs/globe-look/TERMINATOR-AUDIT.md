# TERMINATOR AUDIT — F4, 2B-C2B Part 2

Read-only audit of spec 3.4. Every number below was measured against the stamped E2E bundle
(`srcHash abce1f91f75a`, built from `69d428d`) and written by
`tests/e2e/look/terminatorAudit.spec.ts` into `test-results/look/terminator-audit-az*.json`.

**Outcome: the audit STOPPED the redefinition.** F4(e) says to stop if the F5 definition cannot
be applied at the default view, and it cannot — see §e. Nothing was redefined and no threshold
was touched.

---

## a) The luminance function of n·L that is actually implemented

Not Lambert. The Earth surface is a `MeshPhysicalMaterial` with three's own lighting model plus
an emissive night texture:

| element | source | value |
|---|---|---|
| surface material | `src/scene/Globe.tsx:298-317` | `MeshPhysicalMaterial` |
| diffuse map | `Globe.tsx:300` | `map={dayMap}` (`earth_day.jpg`) |
| **night texture as emissive** | `Globe.tsx:314-316` | `emissiveMap={nightMap}`, `emissive` `#6fb8ff`, `emissiveIntensity` **0.18** |
| material specular | `Globe.tsx:311` → `src/scene/globeLook.ts:126` | `specularIntensity` **0** |
| sheen / clearcoat | `globeLook.ts` surface block | `clearcoat` 0, `metalness` 0, `roughness` 0.9 with a `roughnessFloor` 0.55 |
| key light | `GlobeScene.tsx:310` | `directionalLight` intensity **3.6**, `#fffaf2`, at `SUN_POSITION` |
| ambient fill | `GlobeScene.tsx:309` | `ambientLight` intensity **0.055**, `#7aa7d9` |
| additive overlay | `Globe.tsx:321-329` | `surfaceOverlayFragment` — glint + anomaly heat, `SHELLS.overlay` 1.0012 |

So the implemented function is **three's Lambert diffuse (with the GGX specular term scaled to
zero) PLUS an emissive night texture that does not depend on n·L at all**:

```
luma(x) ≈ albedo(x) · max(0, n·L) · 3.6/π           ← day side, Lambert, no plateau
        + emissive(x) · 0.18 · #6fb8ff               ← night side, INDEPENDENT of n·L
        + ambient(x) · 0.055
        + overlay(x)                                 ← additive, day-weighted
```

Edge values, measured (median over the disc, az 0): **day 62.3**, **night 5.2**. The night level
is NOT zero because the emissive night texture is always on — that is what makes "night" a level
rather than a black.

**Why this matters for the old metric.** A Lambert term has **no day-side plateau**: `max(0, n·L)`
peaks at exactly one point (the sub-solar point) and falls as the cosine in every direction. There
is therefore no "top" and "bottom" of a transition to take a 90 %→10 % width from, which is the
direct cause of the historical "widths" of 162–188 % of R_fit.

## b) Default-view profile

Conditions: azimuth 0, flags `stars false, pins false, rings false` (the current 3.4's own set),
clock frozen by `settleAt`, viewport 1280×800, R_fit **325.664** (RMS 0.244, 360 rays, 0 misses).
Axis: projected sun direction through the disc centre. Each row's luma is the **median across 5
parallel lines** at perpendicular offsets −0.2R, −0.1R, 0, +0.1R, +0.2R; `n·L` is the analytic
value on the **axis** line, from the exact perspective ray-sphere intersection
(`nDotLAt` in `src/lib/look/helpers.ts`). Positions are 1 px; printed every 4 px.

| t | r/R | n·L | luma |
|---:|---:|---:|---:|
| -300 | 0.921 | -0.161 | 5.0 |
| -296 | 0.909 | -0.135 | 6.0 |
| -292 | 0.897 | -0.111 | 5.0 |
| -288 | 0.884 | -0.088 | 5.0 |
| -284 | 0.872 | -0.067 | 7.6 |
| -280 | 0.860 | -0.047 | 5.8 |
| -276 | 0.847 | -0.027 | 5.1 |
| -272 | 0.835 | -0.008 | 5.1 |
| -268 | 0.823 | 0.010 | 5.2 |
| -264 | 0.811 | 0.027 | 6.9 |
| -260 | 0.798 | 0.044 | 7.1 |
| -256 | 0.786 | 0.060 | 6.8 |
| -252 | 0.774 | 0.076 | 10.7 |
| -248 | 0.762 | 0.091 | 7.0 |
| -244 | 0.749 | 0.106 | 7.8 |
| -240 | 0.737 | 0.120 | 17.7 |
| -236 | 0.725 | 0.135 | 11.8 |
| -232 | 0.712 | 0.148 | 7.7 |
| -228 | 0.700 | 0.162 | 5.9 |
| -224 | 0.688 | 0.175 | 11.7 |
| -220 | 0.676 | 0.188 | 9.5 |
| -216 | 0.663 | 0.201 | 21.6 |
| -212 | 0.651 | 0.213 | 14.2 |
| -208 | 0.639 | 0.225 | 16.0 |
| -204 | 0.626 | 0.237 | 32.4 |
| -200 | 0.614 | 0.249 | 19.1 |
| -196 | 0.602 | 0.261 | 18.6 |
| -192 | 0.590 | 0.272 | 19.4 |
| -188 | 0.577 | 0.283 | 20.5 |
| -184 | 0.565 | 0.294 | 21.8 |
| -180 | 0.553 | 0.305 | 25.8 |
| -176 | 0.540 | 0.316 | 34.1 |
| -172 | 0.528 | 0.326 | 26.7 |
| -168 | 0.516 | 0.337 | 30.7 |
| -164 | 0.504 | 0.347 | 32.9 |
| -160 | 0.491 | 0.357 | 38.2 |
| -156 | 0.479 | 0.367 | 29.5 |
| -152 | 0.467 | 0.376 | 31.7 |
| -148 | 0.454 | 0.386 | 29.2 |
| -144 | 0.442 | 0.396 | 29.2 |
| -140 | 0.430 | 0.405 | 32.6 |
| -136 | 0.418 | 0.414 | 32.4 |
| -132 | 0.405 | 0.424 | 48.0 |
| -128 | 0.393 | 0.433 | 43.0 |
| -124 | 0.381 | 0.442 | 32.4 |
| -120 | 0.368 | 0.451 | 33.8 |
| -116 | 0.356 | 0.459 | 37.6 |
| -112 | 0.344 | 0.468 | 38.3 |
| -108 | 0.332 | 0.477 | 53.0 |
| -104 | 0.319 | 0.485 | 46.0 |
| -100 | 0.307 | 0.493 | 48.0 |
| -96 | 0.295 | 0.502 | 46.9 |
| -92 | 0.282 | 0.510 | 47.9 |
| -88 | 0.270 | 0.518 | 54.2 |
| -84 | 0.258 | 0.526 | 63.5 |
| -80 | 0.246 | 0.534 | 74.2 |
| -76 | 0.233 | 0.542 | 72.4 |
| -72 | 0.221 | 0.550 | 78.5 |
| -68 | 0.209 | 0.558 | 92.8 |
| -64 | 0.197 | 0.565 | 92.5 |
| -60 | 0.184 | 0.573 | 85.6 |
| -56 | 0.172 | 0.580 | 100.7 |
| -52 | 0.160 | 0.588 | 85.5 |
| -48 | 0.147 | 0.595 | 83.5 |
| -44 | 0.135 | 0.603 | 62.0 |
| -40 | 0.123 | 0.610 | 46.4 |
| -36 | 0.111 | 0.617 | 52.6 |
| -32 | 0.098 | 0.624 | 56.0 |
| -28 | 0.086 | 0.631 | 64.7 |
| -24 | 0.074 | 0.638 | 55.8 |
| -20 | 0.061 | 0.645 | 67.5 |
| -16 | 0.049 | 0.652 | 59.0 |
| -12 | 0.037 | 0.659 | 81.3 |
| -8 | 0.025 | 0.666 | 66.1 |
| -4 | 0.012 | 0.672 | 75.9 |
| 0 | 0.000 | 0.679 | 65.4 |
| 4 | 0.012 | 0.686 | 68.1 |
| 8 | 0.025 | 0.692 | 65.9 |
| 12 | 0.037 | 0.699 | 60.3 |
| 16 | 0.049 | 0.705 | 73.9 |
| 20 | 0.061 | 0.711 | 72.5 |
| 24 | 0.074 | 0.718 | 93.1 |
| 28 | 0.086 | 0.724 | 80.8 |
| 32 | 0.098 | 0.730 | 85.2 |
| 36 | 0.111 | 0.737 | 75.1 |
| 40 | 0.123 | 0.743 | 55.5 |
| 44 | 0.135 | 0.749 | 58.7 |
| 48 | 0.147 | 0.755 | 53.3 |
| 52 | 0.160 | 0.761 | 54.1 |
| 56 | 0.172 | 0.767 | 63.8 |
| 60 | 0.184 | 0.773 | 66.9 |
| 64 | 0.197 | 0.778 | 73.6 |
| 68 | 0.209 | 0.784 | 79.2 |
| 72 | 0.221 | 0.790 | 59.1 |
| 76 | 0.233 | 0.796 | 72.7 |
| 80 | 0.246 | 0.801 | 67.4 |
| 84 | 0.258 | 0.807 | 74.8 |
| 88 | 0.270 | 0.812 | 69.8 |
| 92 | 0.282 | 0.818 | 78.6 |
| 96 | 0.295 | 0.823 | 73.6 |
| 100 | 0.307 | 0.829 | 77.1 |
| 104 | 0.319 | 0.834 | 72.8 |
| 108 | 0.332 | 0.839 | 78.1 |
| 112 | 0.344 | 0.845 | 80.0 |
| 116 | 0.356 | 0.850 | 81.1 |
| 120 | 0.368 | 0.855 | 83.9 |
| 124 | 0.381 | 0.860 | 87.3 |
| 128 | 0.393 | 0.865 | 96.2 |
| 132 | 0.405 | 0.870 | 97.4 |
| 136 | 0.418 | 0.875 | 98.0 |
| 140 | 0.430 | 0.880 | 99.3 |
| 144 | 0.442 | 0.885 | 101.4 |
| 148 | 0.454 | 0.890 | 99.1 |
| 152 | 0.467 | 0.894 | 98.5 |
| 156 | 0.479 | 0.899 | 138.4 |
| 160 | 0.491 | 0.904 | 117.4 |
| 164 | 0.504 | 0.908 | 91.3 |
| 168 | 0.516 | 0.913 | 95.3 |
| 172 | 0.528 | 0.917 | 106.5 |
| 176 | 0.540 | 0.921 | 97.1 |
| 180 | 0.553 | 0.926 | 88.2 |
| 184 | 0.565 | 0.930 | 81.0 |
| 188 | 0.577 | 0.934 | 74.8 |
| 192 | 0.590 | 0.938 | 84.9 |
| 196 | 0.602 | 0.942 | 82.0 |
| 200 | 0.614 | 0.946 | 76.8 |
| 204 | 0.626 | 0.950 | 68.3 |
| 208 | 0.639 | 0.954 | 73.6 |
| 212 | 0.651 | 0.957 | 72.7 |
| 216 | 0.663 | 0.961 | 71.6 |
| 220 | 0.676 | 0.965 | 69.3 |
| 224 | 0.688 | 0.968 | 65.9 |
| 228 | 0.700 | 0.971 | 76.6 |
| 232 | 0.712 | 0.974 | 72.4 |
| 236 | 0.725 | 0.977 | 76.6 |
| 240 | 0.737 | 0.980 | 78.6 |
| 244 | 0.749 | 0.983 | 87.3 |
| 248 | 0.762 | 0.986 | 88.1 |
| 252 | 0.774 | 0.988 | 81.9 |
| 256 | 0.786 | 0.991 | 90.2 |
| 260 | 0.798 | 0.993 | 88.1 |
| 264 | 0.811 | 0.995 | 88.1 |
| 268 | 0.823 | 0.996 | 105.5 |
| 272 | 0.835 | 0.998 | 76.5 |
| 276 | 0.847 | 0.999 | 76.7 |
| 280 | 0.860 | 1.000 | 76.7 |
| 284 | 0.872 | 1.000 | 75.5 |
| 288 | 0.884 | 1.000 | 71.3 |
| 292 | 0.897 | 0.999 | 83.8 |
| 296 | 0.909 | 0.998 | 63.8 |
| 300 | 0.921 | 0.997 | 79.7 |

### Where the OLD 3.4 metric sat

The old gate measured width and step inside a **locally monotonic falloff segment** found by
`terminatorFalloff`, reported as `124.02 → 69.43` (31.0 px of the 9 px-smoothed profile). On this
profile that segment is on the **night side, past the crossing**:

| marker | t (px) | r/R | n·L |
|---|---:|---:|---:|
| n·L = 0 crossing | −270.1 | **0.829** | 0.000 |
| n·L = +0.25 | −199.7 | 0.613 | 0.250 |
| n·L = −0.25 | −311.6 | **0.957** | −0.250 |
| old segment begin (luma 124.02 equivalent region) | ≈ −230 | ≈ 0.71 | ≈ +0.15 |
| old segment end (luma 69.43 equivalent region) | ≈ −200 | ≈ 0.61 | ≈ +0.25 |

The old segment sits **between n·L ≈ +0.15 and +0.25 — entirely on the DAY side, and it does not
contain the n·L = 0 crossing.** That is the flaw, stated as a measurement rather than a suspicion.

## c) Day and night levels, and where luma actually falls

| quantity | value | definition |
|---|---:|---|
| **day level** | **62.31** | median luma over all disc pixels with n·L ∈ [0.30, 0.50] (56,280 px) |
| **night level** | **5.17** | median luma over all disc pixels with n·L ∈ [−0.50, −0.15] (8,886 px) |
| old metric's reported night mean | 11.04 | `nightFractionByLuma`'s below-threshold mean — a *different* quantity from the night level above, which is why they disagree |

Does the current segment contain the n·L = 0 crossing? **No.** The crossing is at r/R 0.829
(t = −270 px); the segment runs ≈ t −230 … −200 px, i.e. r/R ≈ 0.61 … 0.71.

Where does luma fall from 69 to the night level? Reading the profile outward on the night side:

| t | r/R | n·L | luma |
|---:|---:|---:|---:|
| −178 | 0.547 | +0.310 | 26.6 |
| −196 | 0.602 | +0.261 | 18.6 |
| −214 | 0.657 | +0.207 | 17.4 |
| −232 | 0.712 | +0.148 | 7.7 |
| −250 | 0.768 | +0.083 | 11.7 |
| −268 | 0.823 | +0.010 | **5.2** ← night level reached AT the crossing |

So the fall from ~69 to the night level of 5.2 happens over **t −160 → −268 px**, i.e. r/R
**0.49 → 0.82**, and it is essentially complete at the crossing. The drop is gradual and
texture-dependent, not a step — which is the look working as intended.

## d) All twelve azimuths

| az | θ deg | cross r/R | n·L=+0.25 r/R | n·L=−0.25 r/R | day lvl | night lvl | all ≤0.95 |
|---:|---:|---:|---:|---:|---:|---:|:--:|
| 0 | 47.2 | 0.829 | 0.613 | 0.957 | 62.3 | 5.2 | no |
| 30 | 19.4 | — | 0.950 | — | 62.1 | — | no |
| 60 | 8.8 | — | 0.994 | — | 73.3 | — | no |
| 90 | 36.7 | 0.931 | 0.779 | — | 78.8 | 6.9 | no |
| 120 | 64.3 | 0.565 | 0.261 | 0.797 | 85.1 | 13.4 | **yes** |
| 150 | 91.1 | 0.025 | 0.358 | 0.312 | 89.2 | 17.5 | **yes** |
| 180 | 115.6 | 0.563 | 0.796 | 0.260 | 91.0 | 20.5 | **yes** |
| 210 | 134.1 | 0.845 | 0.964 | 0.637 | 79.9 | 21.9 | no |
| 240 | 137.8 | 0.884 | 0.981 | 0.698 | 100.9 | 15.7 | no |
| 270 | 123.6 | 0.703 | 0.887 | 0.436 | 76.4 | 7.8 | **yes** |
| 300 | 100.7 | 0.250 | 0.556 | 0.090 | 66.8 | 6.2 | **yes** |
| 330 | 74.6 | 0.356 | 0.022 | 0.641 | 63.6 | 6.0 | **yes** |

`—` means the axis line never reaches that n·L inside the disc, i.e. the terminator (or that
band) is not in view at that azimuth.

**The evaluated set under F5's `r/R ≤ 0.95` rule is (120, 150, 180, 270, 300, 330) — six
azimuths, and the default view (az 0) is NOT among them.**

### Why the whole-disc width was 188 % of R

Because the Lambert diffuse has no plateau and the emissive night side is a second bright region,
a 90 %→10 % scan across the whole disc crosses the day maximum, the terminator, the night
minimum, and then *rises again* at the night limb where the emissive texture and the atmosphere
shell add light. `transitionWidth` direction-aware scanning then measured from the day peak to a
level reached only near the far limb — a span wider than the disc, hence 188 %. It was measuring
the shape of a sphere under a point light, not a transition.

### Why the step at az 60 was 13.69/255

At az 60, θ = **8.8°** — the sun is almost directly behind the camera, so the terminator is
almost entirely off the planet: there is no crossing anywhere on the axis and `n·L = −0.25` is
never reached. The 13.69 step was therefore not a terminator step at all; it was the largest
adjacent 1 px change anywhere in the "falloff" segment that `terminatorFalloff` returned when no
real descent exists — texture and limb aliasing. A gate of 16/255 was measuring image noise at
the one azimuth where the feature it names is absent.

## e) F4(e) — STOP

> "If the audit shows the F5 definition below CANNOT be applied at the default view (for example
> the ±0.25 points are outside r/R <= 0.95), STOP and report; do not redefine."

**It cannot.** At the default view:

| point | r/R | inside 0.95? |
|---|---:|:--:|
| crossing (n·L = 0) | 0.829 | yes |
| n·L = +0.25 | 0.613 | yes |
| **n·L = −0.25** | **0.957** | **NO** |

The night band's outer edge is 0.7 % of R outside the bound. F5 additionally requires the default
view to be in the evaluated set (*"The default view MUST be in the set (assert)"*) and at least 3
evaluated azimuths including the default. Both are unsatisfiable together: the default view fails
the applicability rule that the same paragraph imposes.

This is not a near-miss to be argued away, and it is not fixable by measuring differently — it is
a geometric consequence of the camera. The prompt's own hint gives the orthographic relations,
and they explain the gap exactly:

| point | orthographic (prompt hint) | measured, exact perspective | camera |
|---|---:|---:|---|
| crossing | 0.679 ("about 0.68 R") | **0.829** | 42° fov at d = 3.353 R |
| n·L = +0.25 | 0.474 | 0.613 | |
| n·L = −0.25 | 0.841 | **0.957** | |

The brief's "about 0.68 R" is the **orthographic** value. Under a 42° perspective camera at
3.35 R the terminator projects about 0.15 R further out, and that is what pushes the −0.25 point
past 0.95. At d = 3.35 the orthographic projection error on a limb-adjacent feature is ~22 % of R,
so the hint is a sanity check, not a substitute — exactly as the prompt says in its own preamble
("for unit tests and sanity ONLY; real values come from the exact perspective ray-sphere
intersection").

Two ways forward, both needing Tariq's decision, and neither is mine to take:

1. **Widen the applicability bound for the night band only** (e.g. `r/R ≤ 0.97`), keeping the
   day band and the crossing at 0.95. Costs: it admits pixels within 3 % of the limb, where
   anti-aliasing on the terminator's own far edge contributes. The measured night level there
   (5.17) is the emissive floor, not limb noise, so the risk is real but bounded.
2. **Move the applicability rule to `n·L`-space instead of `r/R`**: accept an azimuth when the
   ±0.25 points are *inside the disc* (`r/R ≤ 1.0`) and the *crossing* is at `r/R ≤ 0.95`. At the
   default view that admits −0.25 at 0.957 and keeps the bound meaningful where it matters — the
   crossing. This changes what the rule is about (the terminator's position, not the sampling
   geometry) and is the option I would argue for on the merits.

Until one is chosen, 3.4 keeps its current — known-flawed — definition and no test changes.

---

## What was built to produce this

| file | role |
|---|---|
| `src/lib/look/helpers.ts` — `nDotLAt`, `findAxisNDotL`, `sunViewAngleDeg` | exact perspective ray-sphere `n·L`, pure |
| `src/lib/look/terminatorGeometry.test.ts` | 12 tests pinning the conventions (see below) |
| `tests/e2e/look/terminatorProfile.ts` | the 1 px median-of-5 profile, levels, and the N6/N6b mutations |
| `tests/e2e/look/terminatorAudit.spec.ts` | drives the above over 12 azimuths, writes the JSON artefacts |

### Two geometry bugs the tests caught, and one fixture bug

1. `sunViewAngleDeg` used the camera's **look** direction instead of the axis to the **viewer**,
   giving θ = 132.8° at the default view. That is 180 − 47.2°: the brief's value, inverted.
2. The camera basis used `right = cross(up, f)`, which **mirrors** the field for a camera looking
   down `f`. Symptom: at az 150 the "day" band read darker (27.6) than its "night" band (60.0) —
   physically impossible, and the reason the first audit was discarded rather than reported.
3. The test fixture itself put the camera 200 units away with `R_fit` 325.96 px, which cannot
   happen; every off-centre ray missed. The fixture now derives `r` from the camera.

All three were caught before any number reached a threshold, by `terminatorGeometry.test.ts`,
which pins the cases with known answers: sun on the viewer's side → `n·L = +1` at centre; sun
behind the globe → `−1`; side-on → `0`; and in the far-camera limit the crossing lands at
`|cos θ|` with ±0.25 at `|sin(θ ∓ 14.48°)|`, matching the brief's relation to 2 dp.
