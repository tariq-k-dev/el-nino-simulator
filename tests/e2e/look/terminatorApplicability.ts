/**
 * APPLICABILITY — which azimuths 3.4 may be evaluated at, decided from GEOMETRY ALONE.
 *
 * Why this is a separate, pure function and why it runs first: the prompt requires the evaluated set
 * to be printed BEFORE any measurement, so that the set cannot be chosen to fit the numbers. It uses
 * only the camera, the sun and the fitted radius — no pixels — which is what makes "the default view
 * must be in the set" an assertion about the geometry rather than about the result.
 *
 * The three conditions, verbatim from the brief:
 *   (i)   the n·L = 0 crossing on the projected-sun axis is at r/R <= 0.95,
 *   (ii)  the day band and the night band each have >= 1000 px in D95,
 *   (iii) each of the 20 curve bins has >= 200 px in D95.
 *
 * (ii) and (iii) need pixel COUNTS, which need an image — but only its geometry, not its content, so
 * a single cheap pass over the disc answers them and the result is independent of what was rendered.
 * That pass is `countBands`, and it deliberately does not look at luma at all.
 */
import type { Bitmap, SunCameraGeometry } from '../../../src/lib/look/helpers';
import { nDotLAt } from '../../../src/lib/look/helpers';
import {
  DAY_BAND,
  NIGHT_BAND,
  TERMINATOR_GATE,
  curveBin,
} from './terminatorProfile';

export interface ApplicabilityRow {
  az: number;
  thetaDeg: number;
  /** The n·L = 0 crossing on the projected-sun axis, r/R. Null when the axis never crosses it. */
  crossROverR: number | null;
  dayCount: number;
  nightCount: number;
  minBinCount: number;
  pixelCount: number;
  /** True when all three conditions hold. */
  evaluated: boolean;
  /** Why not, when not. Never empty for an unevaluated row. */
  reason: string | null;
}

/**
 * Pixel counts by band and curve bin inside D95 — geometry only, no luma.
 *
 * Separated from `evaluateTerminator` so the applicability decision cannot depend on the render. If
 * this looked at pixel values, "the bands are too small" and "the bands are wrong" would be
 * indistinguishable, and a dark frame could fail applicability for a reason that is not geometric.
 */
export function countBands(
  img: Bitmap,
  geom: SunCameraGeometry,
): { dayCount: number; nightCount: number; curveCounts: number[]; pixelCount: number } {
  const curveCounts = new Array<number>(TERMINATOR_GATE.curveBins).fill(0);
  let dayCount = 0;
  let nightCount = 0;
  let pixelCount = 0;

  const y1 = Math.min(img.height - 1, Math.ceil(geom.cy + geom.r));
  const x1 = Math.min(img.width - 1, Math.ceil(geom.cx + geom.r));
  for (let py = Math.max(0, Math.floor(geom.cy - geom.r)); py <= y1; py += 1) {
    for (let px = Math.max(0, Math.floor(geom.cx - geom.r)); px <= x1; px += 1) {
      const s = nDotLAt(geom, px, py);
      if (!s.hit || s.rOverR > TERMINATOR_GATE.pixelSetMaxROverR) continue;
      pixelCount += 1;
      if (s.nDotL >= DAY_BAND[0] && s.nDotL <= DAY_BAND[1]) dayCount += 1;
      else if (s.nDotL >= NIGHT_BAND[0] && s.nDotL <= NIGHT_BAND[1]) nightCount += 1;
      const k = curveBin(s.nDotL);
      if (k >= 0) curveCounts[k] += 1;
    }
  }
  return { dayCount, nightCount, curveCounts, pixelCount };
}

/**
 * Decide the evaluated set for a batch of azimuths.
 *
 * `probe` supplies one capture (and its geometry) per azimuth. Only its SIZE is used, so the caller
 * can pass a frame captured for another purpose — see the spec, which reuses the 3.6 view rather than
 * taking captures purely for this.
 */
export function decideApplicability(
  inputs: ReadonlyArray<{ az: number; img: Bitmap; geom: SunCameraGeometry; thetaDeg: number; crossROverR: number | null }>,
): ApplicabilityRow[] {
  return inputs.map(({ az, img, geom, thetaDeg, crossROverR }) => {
    const { dayCount, nightCount, curveCounts, pixelCount } = countBands(img, geom);
    const minBinCount = curveCounts.reduce((m, c) => (c < m ? c : m), Number.POSITIVE_INFINITY);

    const reasons: string[] = [];
    if (crossROverR === null) reasons.push('the axis never crosses n·L = 0 inside the disc');
    else if (crossROverR > TERMINATOR_GATE.pixelSetMaxROverR) {
      reasons.push(
        `crossing at r/R ${crossROverR.toFixed(3)} > ${TERMINATOR_GATE.pixelSetMaxROverR}`,
      );
    }
    if (dayCount < TERMINATOR_GATE.minBandPixels) {
      reasons.push(`day band ${dayCount} px < ${TERMINATOR_GATE.minBandPixels}`);
    }
    if (nightCount < TERMINATOR_GATE.minBandPixels) {
      reasons.push(`night band ${nightCount} px < ${TERMINATOR_GATE.minBandPixels}`);
    }
    if (minBinCount < TERMINATOR_GATE.minBinPixels) {
      reasons.push(`min curve bin ${minBinCount} px < ${TERMINATOR_GATE.minBinPixels}`);
    }

    return {
      az,
      thetaDeg,
      crossROverR,
      dayCount,
      nightCount,
      minBinCount,
      pixelCount,
      evaluated: reasons.length === 0,
      reason: reasons.length === 0 ? null : reasons.join('; '),
    };
  });
}
