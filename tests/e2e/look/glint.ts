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
import { diffStats } from '../../../src/lib/look/helpers';

export interface GlintStats {
  /** Largest per-pixel luma difference: F_current minus F_off. */
  max: number;
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

  if (!Number.isFinite(d.max)) return invalid('the difference image is empty');
  if (d.max === 0) {
    return invalid('the two frames are identical — the specular toggle did not take effect');
  }

  return {
    max: d.max,
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
    area6: 0,
    area3: 0,
    centroid: null,
    centroidROverR: null,
    maxAt: null,
    valid: false,
    invalidReason: reason,
  };
}
