/**
 * TERMINATOR PROFILE — the pure, 1 px, median-of-5 profile and its analytic n·L.
 *
 * One implementation shared by the F4 audit, the F5 gate and the N6/N6b mutations. The reason it
 * is one module rather than three: the old 3.4 measured a SMOOTHED, mean-based profile and then
 * scanned for a locally monotonic run, which is how it reported a 31 px "width" for an edge whose
 * night level is 11/255. Every quantity below is either a count of pixels or a median of pixels;
 * nothing is smoothed, and no mean is taken across the edge.
 *
 * WHY MEDIAN, NOT MEAN. A mean across 5 parallel lines smears a hard 1 px step into a ~4 px
 * ramp: with 5 lines, one line landing on the far side of a step moves the mean by 1/5 of the
 * step, so a step that should read S ≈ 1.0 reads S ≈ 0.2 and passes a 0.25 gate. The median
 * across 5 lines rejects up to 2 outliers, so a real step survives.
 *
 * The `n·L` at each position is the analytic value on the AXIS line, from `nDotLAt` (exact
 * perspective ray-sphere). The profile's LUMA at a position is the median across the 5 lines, so
 * the two are deliberately different quantities: `n·L` answers "where on the sphere is this",
 * luma answers "what did those pixels render". Mixing them — e.g. taking n·L per line and
 * averaging — would put a terminator position on a value no single pixel has.
 *
 * Pure: no page, no `window`, no rendering. Unit-tested against synthetic profiles.
 */
import type { Bitmap } from '../../../src/lib/look/helpers';
import {
  findAxisNDotL,
  lumaAt,
  median,
  nDotLAt,
  sunScreenAxis,
  sunViewAngleDeg,
  type SunCameraGeometry,
} from '../../../src/lib/look/helpers';

/** Perpendicular offsets of the 5 parallel lines, as fractions of R_fit. */
export const AXIS_OFFSETS = [-0.2, -0.1, 0, 0.1, 0.2] as const;

/** The azimuths the audit and the 12-az gate sweep. */
export function auditedAzimuthSet(): number[] {
  return Array.from({ length: 12 }, (_, i) => i * 30);
}

export interface TerminatorProfileRow {
  /** Position along the projected-sun axis, CSS px from the disc centre. */
  t: number;
  /** Median luma across the 5 parallel lines at this position. */
  luma: number;
  /** Analytic `n·L` on the axis line at this position. */
  nDotL: number;
  /** |t| / R_fit. */
  rOverR: number;
  /** How many of the 5 lines contributed (fewer near the limb). */
  samples: number;
}

export interface TerminatorSummary {
  thetaDeg: number;
  /** Axis position where `n·L = 0`, and its r/R. Null when the axis never reaches it. */
  crossT: number | null;
  crossROverR: number | null;
  /** Axis position where `n·L = +0.25` / `-0.25`. */
  plus25T: number | null;
  plus25ROverR: number | null;
  minus25T: number | null;
  minus25ROverR: number | null;
  /** Median luma over all pixels with n·L in [0.30, 0.50]. */
  dayLevel: number | null;
  /** Median luma over all pixels with n·L in [-0.50, -0.15]. */
  nightLevel: number | null;
  /** True when crossing, +0.25 and -0.25 are all at r/R <= 0.95 and were found. */
  allInView: boolean;
  /** Counts behind each level, so a thin band is visible rather than assumed. */
  daySamples: number;
  nightSamples: number;
}

export interface TerminatorField {
  profile: TerminatorProfileRow[];
  summary: TerminatorSummary;
}

/** r/R ceiling for "in view". One constant, quoted by the spec and the audit. */
export const TERMINATOR_VIEW_MAX_R = 0.95;

/**
 * Build the 1 px profile and the analytic summary for one frame.
 *
 * Positions run from -0.99R to +0.99R at 1 px, so the limb's own 1-2 px of aliasing is excluded
 * from both ends but nothing near it is silently clipped.
 */
export function buildProfile(img: Bitmap, geom: SunCameraGeometry): TerminatorField {
  // The axis direction is derived from the camera and sun, same as `sunScreenAxis`.
  const cross = findAxisCross(geom);

  const tMax = Math.floor(geom.r * 0.99);
  const profile: TerminatorProfileRow[] = [];
  for (let t = -tMax; t <= tMax; t += 1) {
    const vals: number[] = [];
    for (const o of AXIS_OFFSETS) {
      // Perpendicular offset: rotate the axis by 90 degrees.
      const ox = -cross.ay * o * geom.r;
      const oy = cross.ax * o * geom.r;
      const px = geom.cx + cross.ax * t + ox;
      const py = geom.cy + cross.ay * t + oy;
      if (px < 0 || py < 0 || px > img.width - 1 || py > img.height - 1) continue;
      vals.push(lumaAt(img, px, py));
    }
    if (!vals.length) continue;
    const axisSample = nDotLAt(geom, geom.cx + cross.ax * t, geom.cy + cross.ay * t);
    profile.push({
      t,
      luma: median(vals),
      nDotL: axisSample.nDotL,
      rOverR: Math.abs(t) / geom.r,
      samples: vals.length,
    });
  }

  const at = (target: number) => findAxisNDotL(geom, cross, target);
  const zero = at(0);
  const plus = at(0.25);
  const minus = at(-0.25);

  const { dayLevel, daySamples, nightLevel, nightSamples } = levels(img, geom);

  const allInView =
    zero !== null &&
    plus !== null &&
    minus !== null &&
    zero.rOverR <= TERMINATOR_VIEW_MAX_R &&
    plus.rOverR <= TERMINATOR_VIEW_MAX_R &&
    minus.rOverR <= TERMINATOR_VIEW_MAX_R;

  return {
    profile,
    summary: {
      thetaDeg: sunViewAngleDeg(geom),
      crossT: zero?.t ?? null,
      crossROverR: zero?.rOverR ?? null,
      plus25T: plus?.t ?? null,
      plus25ROverR: plus?.rOverR ?? null,
      minus25T: minus?.t ?? null,
      minus25ROverR: minus?.rOverR ?? null,
      dayLevel,
      nightLevel,
      allInView,
      daySamples,
      nightSamples,
    },
  };
}

/** The projected-sun axis in screen space, from the camera and sun alone. */
function findAxisCross(geom: SunCameraGeometry): { ax: number; ay: number } {
  return sunScreenAxisFromGeom(geom);
}

/** Local re-statement so this module does not need `sunScreenAxis`'s tuple shapes. */
export function sunScreenAxisFromGeom(geom: SunCameraGeometry): { ax: number; ay: number } {
  return sunScreenAxis(geom.sun, geom.cam);
}

/**
 * True day and night luminance levels, from ALL disc pixels binned by analytic n·L.
 *
 * Bands are the prompt's: day = n·L in [0.30, 0.50], night = n·L in [-0.50, -0.15]. They are
 * deliberately narrow and off-centre: `n·L > 0.5` includes the specular sheen and the sub-solar
 * highlight, and `n·L < -0.5` runs into the limb where aliasing dominates, so neither is a
 * clean "level".
 */
export function levels(
  img: Bitmap,
  geom: SunCameraGeometry,
): { dayLevel: number | null; daySamples: number; nightLevel: number | null; nightSamples: number } {
  const day: number[] = [];
  const night: number[] = [];
  const y1 = Math.min(img.height - 1, Math.ceil(geom.cy + geom.r));
  const x1 = Math.min(img.width - 1, Math.ceil(geom.cx + geom.r));
  for (let py = Math.max(0, Math.floor(geom.cy - geom.r)); py <= y1; py += 1) {
    for (let px = Math.max(0, Math.floor(geom.cx - geom.r)); px <= x1; px += 1) {
      const s = nDotLAt(geom, px, py);
      if (!s.hit || s.rOverR > 0.995) continue;
      const l = lumaAt(img, px, py);
      if (s.nDotL >= 0.3 && s.nDotL <= 0.5) day.push(l);
      else if (s.nDotL >= -0.5 && s.nDotL <= -0.15) night.push(l);
    }
  }
  return {
    dayLevel: day.length ? median(day) : null,
    daySamples: day.length,
    nightLevel: night.length ? median(night) : null,
    nightSamples: night.length,
  };
}

/**
 * Blank a disc-grey frame's pixels by analytic `n·L` — the shared mutation for N6 and N6b.
 *
 * The mutation is applied OFFLINE to a real capture, which is the point: it isolates the CHECK
 * from the renderer. No material, light or layer is touched, so "the check went red" cannot be an
 * artefact of the injection having failed to reach the GPU.
 *
 * @param mode  'step'  → grey Ld where n·L > 0, grey Ln where n·L <= 0, only inside |n·L| <= 0.25
 *              'flat'  → grey Ln everywhere n·L > -0.25 (the lit side is erased)
 */
export function mutateTerminator(
  img: Bitmap,
  geom: SunCameraGeometry,
  mode: 'step' | 'flat',
  grey: { lit: number; dark: number },
): Bitmap {
  const out: Bitmap = { width: img.width, height: img.height, data: new Uint8Array(img.data) };
  const y1 = Math.min(img.height - 1, Math.ceil(geom.cy + geom.r));
  const x1 = Math.min(img.width - 1, Math.ceil(geom.cx + geom.r));
  for (let py = Math.max(0, Math.floor(geom.cy - geom.r)); py <= y1; py += 1) {
    for (let px = Math.max(0, Math.floor(geom.cx - geom.r)); px <= x1; px += 1) {
      const s = nDotLAt(geom, px, py);
      if (!s.hit || s.rOverR > 0.995) continue;
      let value: number | null = null;
      if (mode === 'step') {
        if (Math.abs(s.nDotL) <= 0.25) value = s.nDotL > 0 ? grey.lit : grey.dark;
      } else if (s.nDotL > -0.25) {
        value = grey.dark;
      }
      if (value === null) continue;
      const o = (py * img.width + px) * 4;
      out.data[o] = value;
      out.data[o + 1] = value;
      out.data[o + 2] = value;
      out.data[o + 3] = img.data[o + 3];
    }
  }
  return out;
}

/** Serialise the page-read camera data into the shape the pure helpers take. */
export function serializeGeometry(input: {
  cam: [number, number, number];
  sun: [number, number, number];
  fov: number;
  heightPx: number;
  cx: number;
  cy: number;
  r: number;
  radius: number;
}): SunCameraGeometry {
  return { ...input };
}
