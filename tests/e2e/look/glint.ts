/**
 * GLINT — pure measurement of the accepted look's specular difference.
 *
 * The metric is a DIFFERENCE IMAGE rather than peak luma in a region, and that distinction is
 * why earlier attempts produced wrong answers: peak-luma-in-a-window counts cloud tops (they
 * reach ~210), so a build that had lost half its specular still reported a "92 % retained peak".
 * Subtracting frames with the specular sources off removes everything that is not specular —
 * clouds, ocean, terminator, atmosphere — and leaves only the glint.
 *
 * PURE, like `analysis.ts`: three finished captures in, statistics out. No page, no rendering,
 * no layer writes. That split is what lets N9/N10 prove the gate goes RED on synthetic frames.
 *
 * The arithmetic comes from `diffStats` in `src/lib/look/helpers.ts` — the same function the
 * Dt/Dm/Do table in docs/globe-look/glint-diffs.md was computed with — so the sentinel measures
 * the quantity the decision was made on rather than a re-derivation of it.
 */
import type { Bitmap, DiscGeometry } from '../../../src/lib/look/helpers';
import { diffStats, luma } from '../../../src/lib/look/helpers';

export interface GlintStats {
  /** Largest per-pixel luma difference: F_current minus F_off. Signed; can be negative. */
  max: number;
  /** Largest difference by magnitude — 0 only when the frames agree exactly. */
  maxAbs: number;
  /** Pixels where that difference exceeds 6/255. */
  area6: number;
  /** Pixels where it exceeds 3/255 — reported, not gated. */
  area3: number;
  /** Area6 centroid, and its distance from the disc centre over R_fit. */
  centroid: [number, number] | null;
  centroidROverR: number | null;
  /** Where the maximum sits. */
  maxAt: [number, number] | null;
  /** False when the frames cannot support a comparison at all. */
  valid: boolean;
  invalidReason: string | null;
}

/**
 * Measure the specular difference between two captures of the same frozen scene.
 *
 * INPUT VALIDITY COMES FIRST, and it is the failure this check is most likely to meet. Two
 * identical frames yield `max: 0`, which sails through any upper bound and reads as "the glint
 * is small" when it means "the toggle did not take effect". A zero measured on no signal is not
 * a zero measured on the look.
 */
export function measureGlint(on: Bitmap, off: Bitmap, geom: DiscGeometry): GlintStats {
  if (on.width !== off.width || on.height !== off.height) {
    return invalid(`frame sizes differ (${on.width}x${on.height} vs ${off.width}x${off.height})`);
  }
  if (!Number.isFinite(geom.r) || geom.r <= 0) {
    return invalid(`disc radius ${geom.r} is not a positive finite number`);
  }

  const d = diffStats(on, off, geom);

  /*
   * The IDENTICAL case is `maxAbs === 0`, not `max === 0`.
   *
   * `max` is the largest SIGNED difference. When the overlay goes off and a whole region gets
   * darker, every difference is negative, the signed running max stays -Infinity, and this function
   * used to report "the two frames are identical" for a 200/255 darkening. Measured in N9 while
   * tightening that assertion: the frames differed in 303 disc pixels and the code called them
   * identical.
   */
  if (!Number.isFinite(d.maxAbs)) return invalid('the difference image is empty');
  if (d.maxAbs === 0) {
    return invalid('the two frames are identical — the specular toggle did not take effect');
  }

  return {
    max: d.max,
    maxAbs: d.maxAbs,
    area6: d.area6,
    area3: d.area3,
    centroid: d.centroid,
    centroidROverR: d.centroidROverR,
    maxAt: d.maxAt,
    valid: true,
    invalidReason: null,
  };
}

function invalid(reason: string): GlintStats {
  return {
    max: Number.NaN,
    maxAbs: Number.NaN,
    area6: 0,
    area3: 0,
    centroid: null,
    centroidROverR: null,
    maxAt: null,
    valid: false,
    invalidReason: reason,
  };
}

/**
 * How many disc pixels have a NON-ZERO LUMA difference between two frames.
 *
 * N9's "identical frames" case needs a number, not a NaN: `measureGlint` returns INVALID when the
 * maximum difference is exactly 0, but INVALID is also what a mis-fitted disc or a zero-radius
 * geometry returns. Those are opposite findings — one says the toggle had no effect, the other says
 * the measurement never happened — and a test that accepts either is not testing anything.
 *
 * LUMA, NOT RAW RGB, and the distinction is measured rather than assumed. The first version of this
 * function compared raw channels and reported **303 differing disc pixels** on frames whose luma
 * difference was exactly 0 — 303 pixels differing by one channel unit that the 0.2126/0.7152/0.0722
 * weighting rounds out. Both numbers were correct about different quantities, and using the wrong
 * one made the tight assertion reject a legitimate collapse.
 *
 * The gate measures luma (`diffStats`), so "D != 0" in the N9 rule means "luma difference != 0".
 * Count in the same units the threshold is stated in.
 *
 * @returns the count, or Infinity when the frame sizes disagree (which must never read as identical)
 */
export function countDifferingPixels(a: Bitmap, b: Bitmap, geom: DiscGeometry): number {
  if (a.width !== b.width || a.height !== b.height) return Number.POSITIVE_INFINITY;
  const r2 = geom.r * geom.r;
  let differing = 0;
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      if ((x - geom.cx) ** 2 + (y - geom.cy) ** 2 > r2) continue;
      const o = (y * a.width + x) * 4;
      const la = luma(a.data[o], a.data[o + 1], a.data[o + 2]);
      const lb = luma(b.data[o], b.data[o + 1], b.data[o + 2]);
      if (la !== lb) differing += 1;
    }
  }
  return differing;
}

/**
 * The largest raw-channel difference inside the disc, for REPORTING only.
 *
 * Exists so a report can show why 303 pixels "differ" while the luma difference is 0: the answer is
 * a 1/255 channel delta that the luma weights cancel. Never gated — the gate is luma.
 */
export function maxRawChannelDelta(a: Bitmap, b: Bitmap, geom: DiscGeometry): number {
  if (a.width !== b.width || a.height !== b.height) return Number.POSITIVE_INFINITY;
  const r2 = geom.r * geom.r;
  let max = 0;
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      if ((x - geom.cx) ** 2 + (y - geom.cy) ** 2 > r2) continue;
      const o = (y * a.width + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const d = Math.abs(a.data[o + c] - b.data[o + c]);
        if (d > max) max = d;
      }
    }
  }
  return max;
}

/**
 * Frame-identity statistics — the N10 detector.
 *
 * N10 used to ask whether the amp metric 3.9 went over its upper bound under a defect. In a
 * DETERMINISTIC frozen frame it does not: measured over an exact N10 reproduction, the defect's
 * contribution lands at [344,390] (249.9 luma, 8470 px) while the diff's maximum stays on the
 * shipped glint at [781,374], and `max` there is the control's 88.52 minus one 8-bit step because
 * the OFF frame moves by one, not because the defect does anything. 3.9 measures overlay
 * AMPLITUDE; this defect changes the SURFACE. So N10's pass criterion for that defect was an
 * artifact of an earlier non-deterministic frame, and the fix is to detect the defect by the thing
 * it actually does: change the frame.
 *
 * These are computed over the fitted disc, the same ROI `diffStats` uses, so they are
 * *distribution* statistics of the whole change rather than a single maximum that a brighter
 * neighbouring feature can mask.
 */
export interface FrameDeltaStats {
  /** Largest per-pixel luma change, either direction. 0 iff the frames are luma-identical. */
  maxAbs: number;
  /** Largest increase. */
  maxGain: number;
  /** Largest decrease, as a positive number. */
  maxDrop: number;
  /** Pixels whose luma changed by more than `threshold`. */
  gt6: number;
  /** Pixels whose luma changed by more than 1/255 in either direction. */
  differing: number;
  /** Where the largest absolute change sits. */
  maxAbsAt: [number, number] | null;
  /** Pixels inside the disc that were sampled. */
  sampled: number;
}

/** Frame-identity statistics between two captures, over a disc. Pure. */
export function frameDelta(a: Bitmap, b: Bitmap, geom: DiscGeometry): FrameDeltaStats {
  if (a.width !== b.width || a.height !== b.height) {
    // Never let a size mismatch read as "identical".
    return { maxAbs: Infinity, maxGain: Infinity, maxDrop: Infinity, gt6: Infinity, differing: Infinity, maxAbsAt: null, sampled: 0 };
  }
  const r2 = geom.r * geom.r;
  let maxAbs = 0;
  let maxGain = 0;
  let maxDrop = 0;
  let gt6 = 0;
  let differing = 0;
  let sampled = 0;
  let maxAbsAt: [number, number] | null = null;
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      if ((x - geom.cx) ** 2 + (y - geom.cy) ** 2 > r2) continue;
      sampled += 1;
      const o = (y * a.width + x) * 4;
      const la = luma(a.data[o], a.data[o + 1], a.data[o + 2]);
      const lb = luma(b.data[o], b.data[o + 1], b.data[o + 2]);
      const d = la - lb;
      if (d > maxGain) maxGain = d;
      if (-d > maxDrop) maxDrop = -d;
      if (Math.abs(d) > maxAbs) {
        maxAbs = Math.abs(d);
        maxAbsAt = [x, y];
      }
      if (Math.abs(d) > 6) gt6 += 1;
      if (d !== 0) differing += 1;
    }
  }
  return { maxAbs, maxGain, maxDrop, gt6, differing, maxAbsAt, sampled };
}

/**
 * Where two frames differ, for DIAGNOSIS ONLY. Never used to relax a gate.
 *
 * The in-page control pair is allowed a 1.0 / 50 px noise floor, and a tolerance with no stated
 * location is a tolerance nobody can challenge. This returns the differing pixels — largest first,
 * at most `limit` — so the spec can print their r/R, band, distance to the glint peak and nearest
 * pin, and a later reader can tell limb shimmer from an actual scene change.
 */
export function locateDiffering(
  a: Bitmap,
  b: Bitmap,
  geom: DiscGeometry,
  limit = 20,
): Array<{ x: number; y: number; d: number }> {
  if (a.width !== b.width || a.height !== b.height) return [];
  const r2 = geom.r * geom.r;
  const hits: Array<{ x: number; y: number; d: number }> = [];
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      if ((x - geom.cx) ** 2 + (y - geom.cy) ** 2 > r2) continue;
      const o = (y * a.width + x) * 4;
      const d = luma(a.data[o], a.data[o + 1], a.data[o + 2]) - luma(b.data[o], b.data[o + 1], b.data[o + 2]);
      if (d !== 0) hits.push({ x, y, d: +d.toFixed(4) });
    }
  }
  hits.sort((p, q) => Math.abs(q.d) - Math.abs(p.d));
  return hits.slice(0, limit);
}

/** What N9 measured, as one of a small closed set. */
export type GlintCollapseKind =
  /** Both frames byte-identical: the toggle genuinely had no effect. */
  | 'identical'
  /** A finite residual below the lower bound: the difference collapsed but re-rendered slightly. */
  | 'residual'
  /** INVALID for a reason other than identical frames — the measurement did not happen. */
  | 'invalid-other'
  /** Still a glint-sized difference: the sentinel failed to notice the overlay is off. */
  | 'not-collapsed';

export interface GlintCollapseVerdict {
  kind: GlintCollapseKind;
  /** True only for the two legitimate N9 outcomes. */
  acceptable: boolean;
  /** Human-readable, printed by the spec so a failure says which case it landed in. */
  reason: string;
}

/**
 * Classify an overlay-off measurement for N9.
 *
 * Exactly two outcomes count as N9 passing:
 *
 *   (a) `identical` — INVALID, `max` is NaN, the invalid reason is the identical-frames one, and
 *       ZERO disc pixels differ. All three together, because the reason string alone is a claim
 *       made by the code under test.
 *   (b) `residual` — VALID, finite `max`, and `max < min` of the gate.
 *
 * Everything else is a failure of the TEST's premise: `invalid-other` means the capture or the
 * geometry broke (so nothing was measured), and `not-collapsed` means the sentinel did not notice.
 * An earlier version accepted any INVALID, which would have kept N9 green on a broken capture.
 */
export function classifyGlintCollapse(
  stats: GlintStats,
  differingPixels: number,
  gate: { maxMin: number; maxMax: number },
): GlintCollapseVerdict {
  if (stats.valid) {
    if (!Number.isFinite(stats.max)) {
      return { kind: 'not-collapsed', acceptable: false, reason: `valid but max is ${stats.max}` };
    }
    if (stats.max < gate.maxMin) {
      return {
        kind: 'residual',
        acceptable: true,
        reason: `valid, max ${stats.max.toFixed(2)} < gate min ${gate.maxMin}`,
      };
    }
    return {
      kind: 'not-collapsed',
      acceptable: false,
      reason: `valid, max ${stats.max.toFixed(2)} still inside/above the gate [${gate.maxMin}, ${gate.maxMax}]`,
    };
  }

  const identicalReason = (stats.invalidReason ?? '').toLowerCase().includes('identical');
  if (identicalReason && differingPixels === 0 && Number.isNaN(stats.maxAbs)) {
    return {
      kind: 'identical',
      acceptable: true,
      reason: 'INVALID for identical frames, 0 differing disc pixels, max NaN',
    };
  }
  return {
    kind: 'invalid-other',
    acceptable: false,
    reason:
      `INVALID for "${stats.invalidReason}" — not the identical-frames case ` +
      `(differing disc pixels ${differingPixels}); nothing was measured`,
  };
}
