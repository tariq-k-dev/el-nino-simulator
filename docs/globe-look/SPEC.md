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
| **3.4 hard step** | Max adjacent 1 px luma step between the 90% and 10% crossings, all 12 azimuths. | <= 16/255 | **13.69** (az 60) | — |
| **3.5 pin core day** | Brightest pixel in the 13x13 core box of a day-side pin. | (255,255,185) +-12 | **[255, 255, 189]** | — |
| **3.5 pin core night** | Same, night-side pin. | (255,255,182) +-12 | **[255, 255, 182]** | — |
| **3.5 no blowout** | Pure-white pixels (R,G,B all >= 250) in the core. | == 0 | **0** on all four | — |
| **3.6 no cast light** | Mean luma of the r 30..60 px annulus, pins ON vs OFF. | abs(delta) <= max(3%, 1.5 x noise%) | us-west 2.849%, se-asia 0.018%, horn-africa 0.002% | N1 (fixme) |
| **3.7 console** | Warnings/errors and page errors from first navigation. | == 0 | **0** (3 driver notices filtered) | — |
| **3.8 zoom** | The five globe.spec.ts zoom cases. | all pass | **5/5** | — |

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
  the overlay shader alone. Measured as a difference image, that keeps 53.95% of the
  approved look's glint peak, which is why `CLIPPED-FACTS.md` carries
  "GLINT REMOVED - needs Tariq's decision".
