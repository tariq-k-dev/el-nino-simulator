/**
 * GLINT SENTINEL CONSTANTS — regression sentinel of the accepted look (Tariq ACCEPT, V2 attenuated, shipped si 0)
 *
 * The recorded measurements of the APPROVED look, copied from the `Do` row of
 * `docs/globe-look/glint-diffs.md`. `Do` is the right row: it was measured as
 * `F[si 0, overlay on] - F[si 0, overlay off]`, which IS the shipped state — the material
 * specular has been 0 since 38aa091, and the overlay shader is the only specular source.
 *
 *     Do = F[0][on] - F[0][off]     max 88.52    area6 9594    centroid (780.8, 376.0)  r/R 0.4388
 *
 * (`Dt`/`Dm` in that file are the PRE-FIX si 0.18 rows and are NOT what this guards.)
 *
 * These are recorded measurements, NOT preferences and NOT tuned to the current render. Both
 * windows are stated as multiples of the recorded value so the tolerance is visible and
 * symmetric around a measurement rather than around whatever passed on the day.
 *
 * ── WHY THESE BOUNDS ────────────────────────────────────────────────────────────────────────
 *
 * max(D):  [70.8, 110.7]  = 0.8x and 1.25x of 88.52
 * area6:   [6716, 12472]  = 0.7x and 1.3x of 9594
 *
 * The LOWER bounds catch a loss of glint — the failure this look is most exposed to, since
 * anything that zeroes or halves the overlay shows up at once. The UPPER bounds catch a return
 * of the clipped blowout the attenuation removed. The bands are deliberately not tight: a
 * sentinel that flags every SwiftShader rounding difference is noise, and the two defects it
 * must catch (N9: overlay off; N10: si 1.0 with no roughness floor) move these numbers far more
 * than 20-30 %.
 *
 * `centroidROverR` is recorded but NOT gated: the lobe is broad and asymmetric, so a stable
 * centroid to a few hundredths is not something the render guarantees. It is printed as
 * information, the same treatment 3.5's medians get.
 */

/** The recorded measurement the windows are built on. Quote this; never re-derive a bound. */
export const GLINT_RECORDED = {
  /** max(D) for `Do` — the shipped look. From docs/globe-look/glint-diffs.md. */
  max: 88.52,
  /** Pixels with luma difference > 6/255. */
  area6: 9594,
  /** Area6 centroid, CSS px, and its r/R. */
  centroid: [780.8, 376.0] as const,
  centroidROverR: 0.4388,
} as const;

/** The gate. Every bound is `GLINT_RECORDED[k] * factor`, so the relationship is explicit. */
export const GLINT_GATE = {
  maxMin: 70.8, //   0.8  x 88.52
  maxMax: 110.7, //  1.25 x 88.52
  area6Min: 6716, // 0.7  x 9594
  area6Max: 12472, // 1.3  x 9594
  /** The factors, so a test can assert the bounds are what the comment claims. */
  maxFactors: [0.8, 1.25] as const,
  area6Factors: [0.7, 1.3] as const,
} as const;

/** The one view the sentinel is evaluated at: the look was approved here. */
export const GLINT_VIEW = {
  azimuth: 0,
  /**
   * Stars, pins and rings OFF — bright points on and off the disc survive a difference and would
   * be counted as glint. Clouds stay ON: they are surface the glint falls on, and the recorded
   * numbers were measured this way.
   */
  stars: false,
  pins: false,
  rings: false,
  clouds: true,
} as const;
