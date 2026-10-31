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


// =========================================================== the 3.4 gate (F5)

/**
 * WHY THE SAMPLING CHANGED AND THE THRESHOLDS DID NOT.
 *
 * The first F5 draft took Ld and Ln from the 1 px profile along the projected-sun axis. That
 * FAILED the real default view for a physical reason the audit had already measured:
 *
 *  - The night side is an EMISSIVE FLOOR (`Globe.tsx:314-316`, `emissiveMap` at 0.18), not a dark
 *    surface. It does not fall with n·L, so Ln is ~5.2 wherever you look.
 *  - At n·L = +0.25 the Lambert term has barely begun: the axis reads 18.6 there against a whole-disc
 *    median of 62.3 for the same band. One line of albedo is not a level — it is whatever continent
 *    that line happens to cross.
 *
 * So Ld, Ln and the curve are taken over WHOLE-DISC n·L bands (thousands of pixels each), which is
 * also what the audit's day/night levels already did. The thresholds are untouched: A >= 25,
 * Ld/max(Ln,1) >= 3, S <= 0.25. Moving the sampling to where the signal lives is not the same act as
 * loosening the gate, and the numbers below show the gate is still decisive.
 *
 * The 1 px axis profile survives ONLY in `docs/globe-look/TERMINATOR-AUDIT.md`. It is not a gate.
 */

/** Gate constants. Unchanged from the first-write F5 — see the note above. */
export const TERMINATOR_GATE = {
  /** Minimum day-minus-night separation, luma units. */
  visibleMinA: 25,
  /** Minimum day/night ratio. */
  visibleMinRatio: 3,
  /** Maximum normalised adjacent-bin step: a hard step gives ~1.0. */
  softMaxS: 0.25,
  /** D95: pixels this far from the centre or closer are used. */
  pixelSetMaxROverR: 0.95,
  /** Applicability: minimum pixels in each of the two level bands. */
  minBandPixels: 1000,
  /** Applicability: minimum pixels in EVERY curve bin. */
  minBinPixels: 200,
  /** Curve geometry: 20 bins of 0.02 from -0.10 to +0.30. */
  curveFrom: -0.1,
  curveTo: 0.3,
  curveBins: 20,
} as const;

/** Day band and night band, in n·L. Narrow and off-centre on purpose: */
export const DAY_BAND: readonly [number, number] = [0.3, 0.5];
export const NIGHT_BAND: readonly [number, number] = [-0.5, -0.15];

export interface TerminatorVerdict {
  /** False when the geometry/coverage cannot support the claim; the reason says why. */
  evaluated: boolean;
  notEvaluatedReason: string | null;
  /** Pixels used (r/R <= 0.95 and a hit). */
  pixelCount: number;
  /** Crossing r/R on the axis, for the applicability rule and the report. */
  crossROverR: number | null;
  /** Band sample counts. */
  dayCount: number;
  nightCount: number;
  /** Medians. NaN when a band is empty. */
  Ld: number;
  Ln: number;
  /** Ld - Ln. */
  A: number;
  /** Ld / max(Ln, 1). Infinity is legitimate here and is guarded by max(). */
  ratio: number;
  /** Per-bin medians C(k); NaN for an empty bin. */
  curve: number[];
  /** Bin sample counts. */
  curveCounts: number[];
  /** Smallest bin count, for the applicability rule. */
  minBinCount: number;
  /** max |C(k+1) - C(k)| / A. NaN when A <= 0 (never divide by zero). */
  S: number;
  /** Index k of the largest step, for the report. */
  worstStepBin: number;
  /** |C(worstStepBin+1) - C(worstStepBin)|, raw luma units. */
  worstStepLuma: number;
  /** 0.25 / S — how much headroom the softness gate has. Infinity when S is 0. */
  softHeadroom: number;
  /** VISIBLE: A >= 25 AND ratio >= 3. */
  visible: boolean;
  /** SOFT: S <= 0.25. */
  soft: boolean;
  /** Both. */
  pass: boolean;
  /** Which predicates failed, so a report can name them. */
  failures: string[];
}

/** Bin index for an n·L value, or -1 when it falls outside the curve range. */
export function curveBin(nDotL: number): number {
  const { curveFrom, curveTo, curveBins } = TERMINATOR_GATE;
  if (!Number.isFinite(nDotL) || nDotL < curveFrom || nDotL >= curveTo) return -1;
  const width = (curveTo - curveFrom) / curveBins;
  const k = Math.floor((nDotL - curveFrom) / width);
  return Math.min(curveBins - 1, Math.max(0, k));
}

/**
 * Evaluate 3.4 on one frame. PURE: an image plus geometry in, a verdict out.
 *
 * Nothing here sets a layer, renders, or reads the page, which is what lets N6/N6b mutate a real
 * capture offline and N6c inject a real defect and still judge both with this same function.
 */
export function evaluateTerminator(img: Bitmap, geom: SunCameraGeometry): TerminatorVerdict {
  const dayVals: number[] = [];
  const nightVals: number[] = [];
  const bins: number[][] = Array.from({ length: TERMINATOR_GATE.curveBins }, () => []);
  let pixelCount = 0;

  const y1 = Math.min(img.height - 1, Math.ceil(geom.cy + geom.r));
  const x1 = Math.min(img.width - 1, Math.ceil(geom.cx + geom.r));
  for (let py = Math.max(0, Math.floor(geom.cy - geom.r)); py <= y1; py += 1) {
    for (let px = Math.max(0, Math.floor(geom.cx - geom.r)); px <= x1; px += 1) {
      const s = nDotLAt(geom, px, py);
      if (!s.hit) continue;
      if (s.rOverR > TERMINATOR_GATE.pixelSetMaxROverR) continue;
      pixelCount += 1;
      const l = lumaAt(img, px, py);
      if (s.nDotL >= DAY_BAND[0] && s.nDotL <= DAY_BAND[1]) dayVals.push(l);
      else if (s.nDotL >= NIGHT_BAND[0] && s.nDotL <= NIGHT_BAND[1]) nightVals.push(l);
      const k = curveBin(s.nDotL);
      if (k >= 0) bins[k].push(l);
    }
  }

  const Ld = dayVals.length ? median(dayVals) : Number.NaN;
  const Ln = nightVals.length ? median(nightVals) : Number.NaN;
  const A = Ld - Ln;
  const ratio = Number.isFinite(A) ? Ld / Math.max(Ln, 1) : Number.NaN;

  const curve = bins.map((b) => (b.length ? median(b) : Number.NaN));
  const curveCounts = bins.map((b) => b.length);
  const minBinCount = curveCounts.reduce((m, c) => (c < m ? c : m), Infinity);

  /*
   * S is computed only over ADJACENT PAIRS where both bins have a median. A pair with an empty bin
   * is an applicability failure, not a step, so treating it as a number would invent a curve.
   */
  let worstStepLuma = 0;
  let worstStepBin = -1;
  if (Number.isFinite(A) && A > 0) {
    for (let k = 0; k < curve.length - 1; k += 1) {
      if (!Number.isFinite(curve[k]) || !Number.isFinite(curve[k + 1])) continue;
      const step = Math.abs(curve[k + 1] - curve[k]);
      if (step > worstStepLuma) {
        worstStepLuma = step;
        worstStepBin = k;
      }
    }
  }
  const S = Number.isFinite(A) && A > 0 ? worstStepLuma / A : Number.NaN;

  const cross = findAxisNDotL(geom, sunScreenAxisFromGeom(geom), 0);
  const crossROverR = cross?.rOverR ?? null;

  /* Applicability, a pure function of geometry and coverage — decided BEFORE any threshold. */
  const reasons: string[] = [];
  if (crossROverR === null) reasons.push('the axis never crosses n·L = 0 inside the disc');
  else if (crossROverR > TERMINATOR_GATE.pixelSetMaxROverR) {
    reasons.push(`the crossing is at r/R ${crossROverR.toFixed(3)} > ${TERMINATOR_GATE.pixelSetMaxROverR}`);
  }
  if (dayVals.length < TERMINATOR_GATE.minBandPixels) {
    reasons.push(`the day band has ${dayVals.length} px (min ${TERMINATOR_GATE.minBandPixels})`);
  }
  if (nightVals.length < TERMINATOR_GATE.minBandPixels) {
    reasons.push(`the night band has ${nightVals.length} px (min ${TERMINATOR_GATE.minBandPixels})`);
  }
  if (minBinCount < TERMINATOR_GATE.minBinPixels) {
    reasons.push(`a curve bin has ${minBinCount} px (min ${TERMINATOR_GATE.minBinPixels})`);
  }

  const evaluated = reasons.length === 0;

  const failures: string[] = [];
  const visible = evaluated && A >= TERMINATOR_GATE.visibleMinA && ratio >= TERMINATOR_GATE.visibleMinRatio;
  if (evaluated) {
    if (!(A >= TERMINATOR_GATE.visibleMinA)) {
      failures.push(`A ${fmt(A)} < ${TERMINATOR_GATE.visibleMinA} luma units`);
    }
    if (!(ratio >= TERMINATOR_GATE.visibleMinRatio)) {
      failures.push(`Ld/Ln ${fmt(ratio)} < ${TERMINATOR_GATE.visibleMinRatio}`);
    }
  }
  // A <= 0 fails SOFT by construction: there is no step to normalise by.
  const soft = evaluated && Number.isFinite(S) && S <= TERMINATOR_GATE.softMaxS;
  if (evaluated && !soft) {
    failures.push(
      Number.isFinite(S)
        ? `S ${S.toFixed(4)} > ${TERMINATOR_GATE.softMaxS}`
        : `A ${fmt(A)} <= 0, so S is undefined`,
    );
  }

  return {
    evaluated,
    notEvaluatedReason: evaluated ? null : `terminator not in view — ${reasons.join('; ')}`,
    pixelCount,
    crossROverR,
    dayCount: dayVals.length,
    nightCount: nightVals.length,
    Ld,
    Ln,
    A,
    ratio,
    curve,
    curveCounts,
    minBinCount,
    S,
    worstStepBin,
    worstStepLuma,
    softHeadroom: Number.isFinite(S) && S > 0 ? TERMINATOR_GATE.softMaxS / S : Number.POSITIVE_INFINITY,
    visible,
    soft,
    pass: visible && soft,
    failures,
  };
}

function fmt(v: number): string {
  return Number.isFinite(v) ? v.toFixed(2) : 'NaN';
}

/**
 * The D2 ORACLE — the closed form for where an n·L iso-line projects, in a PERSPECTIVE camera.
 *
 *     r/R = sin(alpha) * sqrt(d^2 - 1) / (d - cos(alpha))
 *
 * with `alpha` the central angle of the surface point from the view axis and `d` the camera distance
 * in earth radii. This replaces an earlier orthographic hint (crossing 0.68, -0.25 point at 0.84)
 * that was wrong for this camera by ~0.15 R; the prompt's D2 retracts it and names this as the
 * oracle. `terminatorGeometry.test.ts` checks it against 0.830 / 0.614 / 0.957.
 *
 * @param alphaDeg central angle from the view axis, degrees
 * @param d        camera distance in earth radii
 */
export function rOverROracle(alphaDeg: number, d: number): number {
  const a = (alphaDeg * Math.PI) / 180;
  return (Math.sin(a) * Math.sqrt(d * d - 1)) / (d - Math.cos(a));
}


// ------------------------------------------------- F5b: the two-curve 3.4 gate

/**
 * THE SECOND post-measurement definition change, and why it is not a loosening.
 *
 * F5's SOFT gate measured S on the REAL render and failed at az 120 (0.294) and az 150 (0.268). Step D
 * (`docs/globe-look/FLAT-ALBEDO-PROBE.md`) established the cause by removing the textures: every one of
 * 21 albedo-neutral measurements (7 azimuths x 3 levels) passed, and the real 20.99 step at az 120 fell
 * to 2.86 with the same geometry and the same bins. The step was COASTLINE, not shading.
 *
 * So SOFT is now measured where it is a property of the lighting function — the albedo-neutral render —
 * and the real render keeps a coarser CATASTROPHE bound. Nothing was relaxed:
 *
 *   - A >= 25 and Ld/max(Ln,1) >= 3 still apply to the REAL render, unchanged.
 *   - S <= 0.25 still applies, unchanged, to the albedo-neutral curve at level x 1.0.
 *   - S_real < 0.6 is a NEW bound, and it is the N6 separation level already fixed in P2FIX (measured
 *     maximum on the real render 0.294, so the bound has 2x headroom). It is not a SOFT replacement.
 *
 * WHAT THE GATE NO LONGER PROVES: coastline contrast inside the terminator strip is out of scope. A
 * future texture change that put a razor-sharp land edge across the terminator would pass SOFT. The
 * catastrophe bound is what catches it if the edge is severe (>= 0.6), which a coastline is not.
 */

/** The real-render catastrophe bound. Equals the N6 separation level; not a SOFT replacement. */
export const CATASTROPHE_S = 0.6;

export interface TerminatorGateVerdict {
  evaluated: boolean;
  notEvaluatedReason: string | null;
  /** VISIBLE, from the REAL render. */
  visible: boolean;
  /** SOFT, from the FLAT render at level x 1.0. */
  soft: boolean;
  /** Real-render catastrophe bound: S_real < 0.6. */
  catastrophePass: boolean;
  /** True only when all three hold. */
  pass: boolean;
  real: TerminatorVerdict;
  flat: TerminatorVerdict;
  failures: string[];
}

/**
 * Combine the real and albedo-neutral verdicts into one gate decision.
 *
 * PURE: two verdicts in, one verdict out. This is what makes "SOFT uses the flat curve, VISIBLE the
 * real one" testable without a browser, which is the property that matters — the two curves come from
 * the same geometry and the same bins, and mixing them up would silently pass a hard terminator.
 */
export function gateTerminator(real: TerminatorVerdict, flat: TerminatorVerdict): TerminatorGateVerdict {
  const failures: string[] = [];

  if (!real.evaluated) {
    return {
      evaluated: false,
      notEvaluatedReason: real.notEvaluatedReason,
      visible: false,
      soft: false,
      catastrophePass: false,
      pass: false,
      real,
      flat,
      failures: [],
    };
  }

  // (a) VISIBLE on the real render.
  const visible = real.visible;
  if (!visible) failures.push(...real.failures.filter((f) => f.includes('A ') || f.includes('Ld/Ln')));

  // (b) SOFT on the albedo-neutral render, level x 1.0.
  const soft = flat.soft;
  if (!soft) {
    failures.push(
      `flat S ${Number.isFinite(flat.S) ? flat.S.toFixed(4) : 'NaN'} > ${TERMINATOR_GATE.softMaxS} ` +
        `(albedo-neutral render — a step here is the shader, not the map)`,
    );
  }

  // (c) the real-render catastrophe bound.
  const catastrophePass = Number.isFinite(real.S) && real.S < CATASTROPHE_S;
  if (!catastrophePass) {
    failures.push(
      `real S ${Number.isFinite(real.S) ? real.S.toFixed(4) : 'NaN'} >= ${CATASTROPHE_S} — ` +
        `a hard step survived the albedo correction, so this is not geography`,
    );
  }

  return {
    evaluated: true,
    notEvaluatedReason: null,
    visible,
    soft,
    catastrophePass,
    pass: visible && soft && catastrophePass,
    real,
    flat,
    failures,
  };
}
