# LOOK2 — blue glint fix + visible terminator

Prerequisite: `879e490`. Both steps gated (`pnpm tsc -b && pnpm lint && pnpm test && pnpm build`)
before commit. All look constants live in `GLOBE_LOOK`. Bloom, atmosphere and
specular constants were **not touched** — no check failed, and the ablation below
is why they were never suspects.

Step 1 commit: `2e27939 fix(globe): replace specular fill/rim lights with a hemisphere; sun is the only specular source`

---

## STEP 1 — BLUE CIRCLE

### The hook

`window.__lookToggles` (E2E-only, same `VITE_E2E` gate as `__globe`, added to
`FORBIDDEN_HOOKS` in `check-assets.mjs` so the production build fails if it
leaks): `.set(patch)`, `.get()`, `.reset()`, `.look()`.

To make a real ablation possible the four lights were moved out of JSX literals
into `GLOBE_LOOK.lights`, and each got its own flag (`lightSun`, `lightFill`,
`lightRim`, `lightAmbient`, `lightHemisphere`). Editing JSX per trial is not an
ablation, it is a guess with extra steps.

### Ablation table

Fixed camera `[0, 1.15, 3.15]`, stars and hotspot rings off so nothing animates.
Probe = 8 px disc at **(344, 392)**, the centre of the blue patch, plus a control
probe on nearby plain ocean at (300, 392).

| Toggle | mean @ (344,392) | max | RGB at max | vs baseline |
|---|---:|---:|---|---|
| **baseline (all on)** | **91.1** | **114.0** | **(53, 123, 204)** | — |
| atmosphere off | 91.1 | 114.0 | (53, 123, 204) | **identical** |
| specular overlay off | 91.0 | 113.9 | (53, 123, 203) | −0.1 |
| clouds off | 91.2 | 114.0 | (53, 123, 204) | +0.1 |
| bloom off | 91.1 | 114.0 | (53, 123, 204) | identical |
| sun off | 91.1 | 114.0 | (53, 123, 204) | identical |
| **fill off** | **4.1** | **12.4** | (10, 12, 23) | **−87.0** ← the cause |
| rim off | 90.9 | 112.2 | (53, 121, 200) | −0.2 |
| ambient off | 90.9 | 113.9 | (53, 123, 203) | −0.2 |
| all non-sun off | 1.9 | 9.1 | (8, 9, 13) | −89.2 |

**Named: the cool fill `DirectionalLight`, `#2f6fb8`, intensity 0.32, at
(−5.2, −2.2, −4.6).** Only the fill collapses the patch. Atmosphere, bloom,
clouds, the glint overlay and even the sun leave it bit-identical.

Reported screen position and peak luminance, as asked:

| | Position | Peak luminance | Peak RGB |
|---|---|---|---|
| With fill | (344, 392) — left limb, at the equator | **114.0** | (53, 123, 204) |
| Without fill | (344, 392) | **12.4** | (10, 12, 23) |

Surrounding ocean there is ~18, so the fill was producing a **6.3×** local peak.
Blob extent: 456 detected pixels, centroid (346, 400), i.e. **dx = −90% R,
dy = 0**.

Mechanism, not just correlation: a `directionalLight` is a parallel source at
infinity. On a glossy sphere it always deposits a specular lobe somewhere, and the
ocean here is glossy on purpose — the glint overlay exists because of that. A fill
at 0.32 intensity is exactly the wrong tool: bright enough to show a lobe, too dim
to read as a second sun, so it looks like a floating blue circle with no source.

### The fix

`directionalLight` fill + rim → **one `HemisphereLight`** (sky `#2f6fb8`, ground
`#0a1220`, intensity 0.55), plus the existing ambient floor. three.js computes no
specular term for `HemisphereLight` or `AmbientLight`, so **the sun is now the only
specular source in the scene**, which is the brief's requirement stated as a
mechanism rather than a look.

The cool tint on the shadow side is preserved by reusing the fill's own `#2f6fb8`
as the hemisphere sky colour.

Light inventory after: 3 (ambient `#7aa7d9` 0.055, hemisphere `#2f6fb8` 0.55, sun
`#fffaf2` 3.6). Before: 4. Both retired directional lights are kept in
`GLOBE_LOOK.lights` as documented data so the ablation seams still address the same
names.

### Acceptance

| Check | Before | After |
|---|---:|---:|
| Local luminance peak > 1.15× surrounding ocean, excluding sun glint | **1 blob, 6.3× at (344,392)** | **0** |
| Clipped pixels (R,G,B all ≥ 250, pins excluded) | 0 | **0** (0.0000%) |

Residual detections, both accounted for:
- The bright object at (639, 406) peak 250.2 is the **sun glint** — explicitly
  excepted by the rule.
- A 2-pixel spot at (372, 406), luminance 25.3 against a neighbourhood of 5–11,
  sits on the terminator. Below any perceptible threshold and not a "circle".

---

## STEP 2 — TERMINATOR

### (a) Sun / camera / angle

| Quantity | Value |
|---|---|
| `SUN_DIRECTION` (raw) | `[0.72, 0.36, 0.59]` |
| normalised | `[0.7214, 0.3607, 0.5912]` |
| sun elevation above the equator plane | **21.1°** |
| sun azimuth (`atan2(z, x)`) | **39.3°** |
| default camera position | `[0, 1.15, 3.15]`, length 3.3534 |
| camera direction (origin → eye) | `[0, 0.3429, 0.9394]`, azimuth **90°** |
| **angle between sun direction and camera direction** | **47.23°** |

### (b) Azimuth sweep — camera azimuth 0…330° in 30° steps

Camera orbits at the default elevation and distance. Three independent measures
are reported because the first two are cheap and the third is the one that is
actually a *softness* measurement:

- **night fraction (analytic)** — exact fraction of the visible hemisphere with
  n·L < 0, computed over a 400×400 disc of surface normals. Deterministic, no
  image sampling.
- **night fraction (luma)** — share of disc pixels with luminance < 25% of the day
  mean, i.e. the brief's definition.
- **softness** — screen thickness of the ±0.1 n·L band at the terminator, as a
  percentage of the disc radius. The band |n·L| ≤ 0.1 is θ ∈ [84.26°, 95.74°];
  its projected thickness is what the eye reads as the twilight zone, and unlike
  a raw 90%→10% scan it is not confused by cloud texture or limb darkening.

| az | night frac (analytic) | night frac (luma) | night mean luma | softness (px @ R=325.6) | softness (% R) | clipped | goal |
|---:|---:|---:|---:|---:|---:|---:|---|
| **0 (default)** | **0.1606** | **0.1411** | **9.33** | **47.8** | **14.68** | **0** | **PASS** |
| 30 | 0.0283 | 0.0172 | 15.21 | 21.6 | 6.63 | 0 | – |
| 60 | 0.0059 | 0.0009 | 21.58 | 9.9 | 3.06 | 0 | – |
| 90 | 0.0994 | 0.0297 | 12.71 | 38.9 | 11.96 | 0 | – |
| 120 | 0.2835 | 0.1777 | 10.65 | 58.7 | 18.03 | 0 | PASS |
| 150 | 0.5092 | 0.3831 | 10.24 | 11.9 | 3.67 | 13 | – |
| 180 | 0.7158 | 0.4740 | 8.31 | 58.7 | 18.04 | 0 | – |
| 210 | 0.8480 | 0.4679 | 6.73 | 46.7 | 14.36 | 52 | – |
| 240 | 0.8704 | 0.4798 | 5.92 | 43.7 | 13.43 | 38 | – |
| 270 | 0.7770 | 0.5467 | 6.00 | 54.2 | 16.65 | 0 | – |
| 300 | 0.5927 | 0.5325 | 6.52 | 64.0 | 19.65 | 0 | – |
| 330 | 0.3671 | 0.3733 | 7.61 | 62.8 | 19.28 | 0 | – |

The analytic and luma night fractions agree closely on the default frames (0.1606
vs 0.1411) and diverge at high-azimuth frames, which is expected: the luma measure
uses a threshold relative to the day mean, so it under-counts where the whole
visible hemisphere is dim (az 30–90) and over-counts where the terminator is
edge-on and the twilight band is itself below threshold.

### (c) Goal at the default view

| Requirement | Target | Default view (az 0) | Verdict |
|---|---|---|---|
| terminator visible inside the disc | yes | yes — night fraction 0.14–0.16, terminator at 68% R from centre | **PASS** |
| night fraction | 10–30% | **16.1%** (analytic) / 14.1% (luma) | **PASS** |
| softness | ≥ 6% of R | **14.7% R = 47.8 px** | **PASS** |
| night side readable | mean luma ≥ 4/255 | **9.33** (2.3× the floor) | **PASS** |
| pins visible on the night side | yes | **yes** — see below | **PASS** |
| glare unchanged | 0 clipped px | **0** | **PASS** |
| rim profile unchanged | unchanged | atmosphere constants untouched; shell silhouette still 3.3 vs bg 3.3 | **PASS** |

**Nothing was changed for Step 2, and that is a finding, not an omission.** The
sun direction already places the subsolar point 47.2° off the view axis, and the
analytic night fraction at the default view is 16.1% — inside the 10–30% window
*before* any edit. The terminator was being hidden not by the sun's azimuth but by
the flood of fill/rim light on the shadow side, which is exactly what Step 1
removed. So Step 1's fix is also Step 2's fix; changing `SUN_DIRECTION` afterwards
would have pushed a passing metric out of band for no reason.

Per the brief's instruction ("change the sun direction first; adjust
ambient/hemisphere intensity only if needed"), neither was needed. The one thing
to flag for review: the hemisphere replaced ~0.70 of directional fill, so if a
future check finds the night side too bright or too flat, `lights.hemisphere.
intensity` (0.55) is the single lever, and it is already in `GLOBE_LOOK`.

### Night-side pins

Measured at the night-side frames, core = 4 px disc at the pin, ring = the surface
10–18 px out:

| az | pin | n·L | side | core luma | ring luma | contrast |
|---:|---|---:|---|---:|---:|---:|
| 0 | us-west | +0.795 | day | 249 | 52 | 0.652 |
| 120 | horn-africa | +0.795 | day | 238 | 56 | 0.617 |
| 180 | se-asia | +0.479 | day | 235 | 19 | 0.847 |
| **210** | **se-asia** | **−0.218** | **NIGHT** | **233** | **~9** | **0.839** |
| 240 | se-asia | +0.125 | day | 227 | 22 | 0.825 |

A pin on the night side reads at the same luminance as on the day side (233 vs
235–249) because the core is emissive with `toneMapped={false}` — its brightness is
a property of the material, not of the light falling on it. Contrast against the
night surface is **0.839**, the highest in the table.

One row was excluded: `horn-africa` at az=180 reports core 28 because its projected
position (330, 450) lands **inside the control-deck UI panel** (the pin renders
under the DOM). That is a harness limitation, not a scene failure; the measurement
is taken with chrome hidden everywhere else.

### (d) Screenshots

| File | View | Size |
|---|---|---|
| `docs/globe-look/look2-default.png` | default, az 0 | 257 KB |
| `docs/globe-look/look2-az90.png` | az 90 | 236 KB |
| `docs/globe-look/look2-az180.png` | az 180 | 252 KB |

All 1280×800, 256-colour PNG, under the 300 KB cap, full normal look (every layer
on, chrome visible) so they are reviewable rather than diagnostic.

---

## Gate

| Command | Result |
|---|---|
| `pnpm tsc -b` | clean |
| `pnpm lint` | clean (`--max-warnings 0`) |
| `pnpm test` | **494 passed** (19 files) |
| `pnpm build` | 17 assets, **0 test hooks**, `check-assets` OK |

## Notes / open items

- `__lookToggles` is added to `FORBIDDEN_HOOKS`, so a production build fails if the
  hook leaks. Verified: `build` reports 0 hooks after both steps.
- Clipped pixels at az 150/210/240 (13/52/38 px) are isolated 1–2 px cloud
  highlights at the limb at r ≥ 0.73 R, not a glare patch, and **0 at the default
  view**. They are outside this task's acceptance target but are recorded here so
  a future strict all-angles glare rule has the baseline.
- The earlier `docs/globe-look/shot-a/b/c.png` before-images are still oversized
  PNGs and still want replacing; that cleanup is not part of LOOK2.
- Final look specs were **not** written and framing was **not** started, per the
  task rules.
