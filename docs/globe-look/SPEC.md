# SPEC — the globe look, as checks

One row per check. "Negative test" names the test that proves the check can go RED; where
that is `fixme`, the delivery failure is recorded in `tests/e2e/negative.spec.ts` and in
`3B-1-STATUS.md`.

| Check | Definition in words | Threshold | Measured | Negative test |
|---|---|---|---|---|
| **3.1 rim peak** | Mean luma along 16 rays at offset 0 = the FITTED limb; the maximum of that mean profile. | <= 110/255 | **93.9** at +1 px | N3 (fixme) |
| **3.1 monotonic** | On every ray, luma must fall strictly outward from `max(peak, outermost opaque silhouette + 1 px)`. | rise <= 1/255 | **0.44/255** from +3 px | N3 (fixme) |
| **3.1 silhouette** | Difference between the mean profile at the shell silhouette and the far background. | <= 2/255 | **0.31/255** | N3 (fixme) |
| **3.1 halo step** | Largest adjacent step on the MEAN profile beyond +2 px from the limb. | <= 16/255 | **7.94/255** | N3 (fixme) |
| **3.1 limb->halo** | Peak minus the value 1 px inside the limb. | reported only | **35.2/255** | — |
| **3.2 clipped** | Pixels inside the disc with min(R,G,B) >= 250. | == 0 | **0** at all 12 azimuths | **N2 (passing)** |
| **3.2 blob** | Largest 8-connected blob of luma >= 250 inside the disc. | <= 12 px | **0** at all 12 azimuths | **N2 (passing)** |
| **3.3 local peak** | W1 (0.91 R, 180 deg): sigma-3-blurred peak over the median of the 8..20 px annulus around it, excluding the measured specular mask. | ratio <= 1.15 | **0.982** (peak 6.03, med 6.14) | N4 (fixme) |
| **3.4 width** | 90%->10% of (day plateau - night plateau), median of 5 parallel lines, measured ONLY inside the terminator's own locally monotonic falloff. | >= 6% of R_fit | **31.0 px = 9.51%** | — |
| **3.4 night fraction** | Share of disc pixels with luma < 25% of the day mean. | 10-30% | **15.40%** | — |
| **3.4 night mean** | Mean luma of those night pixels. | >= 4/255 | **11.04** (all 12 az) | — |
| **3.4 hard step** | Max adjacent 1 px luma step between the 90% and 10% crossings, all 12 azimuths. | <= 16/255 (fixed constant; equals `ceil(1.25 x 12.31)` from the pre-`terminatorFalloff` scan, i.e. `ceil(1.25 x 13.69)` would now be 18) | **13.69** (az 60) — headroom 1.169 | — |
| **3.5 P1 visible** | Median luma of the valid core pixels (circle of radius `coreFrac 0.6` x the measured core radius). | >= 180 | **247.3 .. 249.8** | N7 (pending C2) |
| **3.5 P2 no blowout** | Count of core pixels with `min(R,G,B) >= 250`. | == 0 | **0** on every valid pin | N7 (pending C2) |
| **3.5 P3 still tinted** | Median saturation `(max-min)/max` of the core pixels. | >= 0.15 | **0.282 .. 0.420** | N8 (pending C2) |
| **3.5 P4 amber ordering** | Median `R >= 240`, `G >= 200`, `B <= G`. | all three | **[255,255,149] / [255,255,179] / [255,255,183]** | N8 (pending C2) |
| **3.5 validity** | A pin is gated only if `n·cam >= 0.1`, `r/R <= 0.97` and `n >= 5` samples; otherwise INVALID, listed, never counted. | 4 of 16 pin/az pairs valid | pacific@0 1.100 R, horn-africa@180 1.001 R, us-west@90 0.980 R fall out on r/R; the rest face away | — |
| **3.5 day/night coverage** | The suite fails if no valid DAY pin (`n·sun > 0.2`) or no valid NIGHT pin (`n·sun < -0.1`) is found across az {0,90,180,270}. | >= 1 of each | **1 day (us-west@0), 2 night (se-asia@180, pacific@270)** | — |
| **3.6 no cast light** | Mean luma of the r 30..60 px annulus, pins ON vs OFF. | abs(delta) <= max(3%, 1.5 x noise%) | us-west 2.849%, se-asia 0.018%, horn-africa 0.002% | N1 (fixme) |
| **3.7 console** | Warnings/errors and page errors from first navigation. | == 0 | **0** (3 driver notices filtered) | — |
| **3.8 zoom** | The five globe.spec.ts zoom cases. | all pass | **5/5** | — |

## 3.5 — the semantic gate, in full

3.5 no longer measures a colour window. The four predicates hold whatever the exact pixel
values drift to, and the measured medians are printed as **INFORMATION** so drift stays
visible without a threshold having to be invented for it.

- **P1 visible** — median core luma >= 180. The core must read against ocean, cloud and the
  terminator at once.
- **P2 no blowout** — zero core pixels with `min(R,G,B) >= 250`. Clipping is what 3.2 exists
  to prevent on the disc; a pin core is no exception.
- **P3 still tinted** — median saturation >= 0.15, i.e. `R = 255` implies `B <= 217`. A grey
  or white core has lost the amber.
- **P4 amber ordering** — median `R >= 240`, `G >= 200`, `B <= G`. Brightness plus tint is
  not enough: the channel ORDER is what makes it amber rather than merely warm.

**Validity rule** (checked before any verdict): `n·cam >= 0.1` (the core is on the visible
hemisphere), `r/R <= 0.97` (the sample box is on surface, not sky) and `>= 5` pixels.
Anything failing is reported INVALID and never counted as a pass. `r/R <= 0.97` is a
conservative proxy — see `FACTS-2B.md` §b: the pin core floats 0.10242 R above the surface
by design, so a *visible* core can sit outside the disc.

**Day/night coverage assertion**: the suite fails if no valid day-side pin (`n·sun > 0.2`) or
no valid night-side pin (`n·sun < -0.1`) is found across az {0, 90, 180, 270}. Without it the
gate could silently pass on four day-side pins.

**Measured, az {0, 90, 180, 270} — INFORMATIONAL, not gated:**

| az | pin | side | n | median RGB | luma | saturation | P1 | P2 | P3 | P4 |
|---:|---|---|---:|---|---:|---:|---|---|---|---|
| 0 | us-west | day | 15 | (255, 255, 179) | 249.5 | 0.298 | ok | ok | ok | ok |
| 90 | horn-africa | terminator | 9 | (255, 255, 183) | 249.8 | 0.282 | ok | ok | ok | ok |
| 180 | se-asia | night | 22 | (255, 255, 149) | 247.3 | 0.416 | ok | ok | ok | ok |
| 270 | pacific | night | 15 | (255, 255, 148) | 247.3 | 0.420 | ok | ok | ok | ok |

Twelve of the sixteen pin/azimuth pairs are INVALID and reported as such: nine face away
(`n·cam < 0.1`) and three project outside 0.97 R (pacific@0 1.100, horn-africa@180 1.001,
us-west@90 0.980).

**Negative tests N7 / N8 — pending C2.** N7 will force the core to pure white (P2 and P4 must
go RED); N8 will desaturate it to grey (P3 must go RED while P1 stays green, which is the
only way to prove P3 is not redundant with P1). Neither exists yet, and the two existing
3.5 rows that used to claim "—" for a negative test now name them.

## What changed versus the earlier proxies

- **Terminator softness is pixel-measured.** The old figure came from an analytic band
  (|n·L| <= 0.1) projected through a model of the sphere. It is now the 90%->10% luma width
  of a median-of-5 line profile taken from the rendered frame, and only inside the
  terminator's own locally monotonic falloff — the whole-disc scan reported widths of
  162-188% of R_fit, i.e. wider than the planet.
- **The old 6/255 rim rule is retired.** It was replaced by the 16/255 adjacent-step gate
  beyond +2 px, plus the separate 2/255 silhouette-vs-background check. The 6/255 figure
  measured a different thing (a step at the limb) than the rule it was named for.
- **An upward-only step metric is NOT used.** Measuring only rises outward of the peak
  reported a 15.37/255 violation that was almost entirely limb mis-registration. The
  metric is now the largest ABSOLUTE adjacent step on the mean profile, which is what a
  hard edge actually is.
- **The rim origin is the fitted limb.** Offset 0 is the per-angle point on the
  360-ray sub-pixel circle fit (R_fit 325.66, RMS 0.244), not `discRadiusPx()`. The hook
  agrees to 0.107 px — it was right — but a hook value is not ground truth.
- **Probe windows are disc-relative.** Polar (fraction of R_fit, degrees clockwise from +x)
  resolved at run time, so they follow the disc between viewports. The absolute list
  included `(300, 392)` at 1.045 R — outside the disc, in pure atmosphere halo — which
  produced a 3.7x "local peak" that was the halo behaving correctly.
- **Specular is removed from the material.** `specularIntensity` is 0; the visible glint is
  the overlay shader alone. Measured as a signed difference image that keeps **53.95%** of
  the approved look's glint peak but **62.0%** of its `area6` lobe, so the verdict is
  **V2: glint ATTENUATED, not removed** — the earlier "GLINT REMOVED" label overstated it.
  `tests/e2e/look/glint.spec.ts` stays absent: the rule is to write it only when V1 passes
  (peak >= 60%) or a candidate is adopted, and neither happened.
