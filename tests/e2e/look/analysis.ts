/**
 * PURE ANALYSIS — checks that take bitmaps and geometry and touch nothing else.
 *
 * The rule this file enforces, and why it is a separate module rather than a convention:
 * every function here receives a capture that ALREADY EXISTS. None of them can set a
 * layer, fit a limb, install a defect, or render. That is the property that makes a
 * negative test meaningful — the check cannot influence the scene whose pixels it
 * judges, so "the check passed under a live defect" is a fact about the check rather
 * than an artifact of the order operations happened in.
 *
 * The previous design violated this through `measureRingCast({ afterFit })`, a callback
 * that ran a scene mutation from inside a measurement. D1 (docs/globe-look/D1-DIAGNOSIS.md)
 * shows what that cost: N1/N3/N4 were parked on `test.fixme` with the wrong explanation
 * because the delivery and the measurement were impossible to separate.
 *
 * `analysis.test.ts` asserts the purity mechanically: no import from `./capture` or
 * `./acquire`, and no reference to `window`, `page`, `fitLimb`, or `setLayers`.
 */
import type { Bitmap, DiscGeometry } from '../../../src/lib/look/helpers';
import {
  annulus,
  blurLuma,
  luma,
  lumaAt,
  median,
} from '../../../src/lib/look/helpers';

/** Luma at one pixel. Local so the signature stays `(bitmap, geometry)`. */
function px(img: Bitmap, x: number, y: number): number {
  return lumaAt(img, x, y);
}

/** HSL-style saturation of an RGB triple, 0 when the pixel is black. */
export function saturationOf(r: number, g: number, b: number): number {
  let mx = r;
  if (g > mx) mx = g;
  if (b > mx) mx = b;
  if (mx === 0) return 0;
  let mn = r;
  if (g < mn) mn = g;
  if (b < mn) mn = b;
  return (mx - mn) / mx;
}

function inDisc(geom: DiscGeometry, x: number, y: number): boolean {
  return (x - geom.cx) ** 2 + (y - geom.cy) ** 2 <= geom.r * geom.r;
}

// ------------------------------------------------------------------ 3.6 ring cast ---

export interface RingCastCheck {
  id: string;
  x: number;
  y: number;
  onMean: number;
  offMean: number;
  offMean2: number;
  deltaPct: number;
  noisePct: number;
  allowedPct: number;
  annulusPixels: number;
  annulusInsideFraction: number;
  valid: boolean;
  validityReason: string;
  pass: boolean;
}

/** The measured pixel count an interior pin's 30–60 px annulus yields at 1280×800. */
const INTERIOR_ANNULUS_PX = 8478;

/**
 * 3.6 — no ring-shaped light cast on the surface around a pin.
 *
 * Takes the three captures `measureRingCast` used to take itself: pins on, pins off, and
 * pins off again for the noise floor. The third exists because two frames of the same
 * scene differ slightly, and a gate tighter than the noise would be measuring the
 * renderer rather than the look.
 */
export function checkRingCast(
  on: Bitmap,
  off: Bitmap,
  off2: Bitmap,
  geom: DiscGeometry,
  pins: Array<{ id: string; x: number; y: number }>,
): RingCastCheck[] {
  const inside = (x: number, y: number): boolean => inDisc(geom, x, y);
  return pins.map((pin) => {
    const a = annulus(on, pin.x, pin.y, 30, 60, inside);
    const b = annulus(off, pin.x, pin.y, 30, 60, inside);
    const c = annulus(off2, pin.x, pin.y, 30, 60, inside);
    if (a.count === 0 || b.count === 0) {
      return {
        id: pin.id,
        x: +pin.x.toFixed(1),
        y: +pin.y.toFixed(1),
        onMean: 0,
        offMean: 0,
        offMean2: 0,
        deltaPct: 0,
        noisePct: 0,
        allowedPct: 3,
        annulusPixels: a.count,
        annulusInsideFraction: 0,
        valid: false,
        validityReason: 'the annulus sampled no pixels',
        pass: false,
      };
    }
    const deltaPct = Math.abs((a.mean - b.mean) / b.mean) * 100;
    const noisePct = Math.abs((c.mean - b.mean) / b.mean) * 100;
    const allowedPct = Math.max(3, 1.5 * noisePct);
    /*
     * Validity. The annulus is meant to be SURFACE around the pin; a pin near or beyond
     * the limb leaves most of it sky, and then the "delta" is the sky changing. pacific
     * at az 0 projects to 1.100 R and measured a 1828 px annulus against 8478 for an
     * interior pin — its 20.4% delta was not cast light.
     */
    const annulusInsideFraction = a.count / INTERIOR_ANNULUS_PX;
    const valid = annulusInsideFraction >= 0.7;
    const rPx = Math.hypot(pin.x - geom.cx, pin.y - geom.cy);
    return {
      id: pin.id,
      x: +pin.x.toFixed(1),
      y: +pin.y.toFixed(1),
      onMean: +a.mean.toFixed(3),
      offMean: +b.mean.toFixed(3),
      offMean2: +c.mean.toFixed(3),
      deltaPct: +deltaPct.toFixed(3),
      noisePct: +noisePct.toFixed(3),
      allowedPct: +allowedPct.toFixed(3),
      annulusPixels: a.count,
      annulusInsideFraction: +annulusInsideFraction.toFixed(4),
      valid,
      validityReason: valid
        ? 'valid'
        : `annulus is only ${(annulusInsideFraction * 100).toFixed(1)}% surface (centre at ${(
            rPx / geom.r
          ).toFixed(3)} R, ${rPx.toFixed(1)}px)`,
      pass: valid && deltaPct <= allowedPct,
    };
  });
}

// ------------------------------------------------------------------------- 3.2 glare ---

export interface GlareCheck {
  valid: boolean;
  invalidReason: string;
  pass: boolean;
  clipped: number;
  largestBlob: number;
  discPixels: number;
}

/** 3.2 — no clipped pixels and no blob larger than 12 px inside the disc. */
export function checkGlare(img: Bitmap, geom: DiscGeometry): GlareCheck {
  const r = Math.round(geom.r);
  let discPixels = 0;
  let sum = 0;
  const coords: number[] = [];
  for (let y = Math.max(0, Math.floor(geom.cy - r)); y <= Math.min(img.height - 1, Math.ceil(geom.cy + r)); y += 1) {
    for (let x = Math.max(0, Math.floor(geom.cx - r)); x <= Math.min(img.width - 1, Math.ceil(geom.cx + r)); x += 1) {
      if ((x - geom.cx) ** 2 + (y - geom.cy) ** 2 > r * r) continue;
      discPixels += 1;
      const o = (y * img.width + x) * 4;
      const l = luma(img.data[o], img.data[o + 1], img.data[o + 2]);
      sum += l;
      // Clipped = any channel at the ceiling, which is what a blown specular looks like.
      if (img.data[o] >= 254 || img.data[o + 1] >= 254 || img.data[o + 2] >= 254) {
        coords.push(y * img.width + x);
      }
    }
  }
  /*
   * Input validity BEFORE the verdict. An all-black frame trivially has zero clipped
   * pixels and zero blobs, so it would sail through the rule while measuring nothing —
   * the null-vs-null failure this whole family exists to prevent.
   */
  const discMean = discPixels > 0 ? sum / discPixels : 0;
  if (discPixels === 0) {
    return { valid: false, invalidReason: 'the disc sampled no pixels', pass: false, clipped: 0, largestBlob: 0, discPixels };
  }
  if (discMean < 3) {
    return {
      valid: false,
      invalidReason: `the disc is black (mean luma ${discMean.toFixed(2)})`,
      pass: false,
      clipped: 0,
      largestBlob: 0,
      discPixels,
    };
  }
  const largestBlob = largestComponent(coords, img.width);
  return {
    valid: true,
    invalidReason: '',
    pass: coords.length === 0 && largestBlob <= 12,
    clipped: coords.length,
    largestBlob,
    discPixels,
  };
}

/**
 * Largest 4-connected component size among `indices` (flat pixel indices).
 *
 * Iterative, and it never spreads an array into a call. `Math.min(...xs)` on an
 * all-white 1280×800 frame is one component of ~1 M points and blows the stack — measured,
 * not theorised. Everything here is loops.
 */
export function largestComponent(indices: number[], width: number): number {
  if (indices.length === 0) return 0;
  const set = new Set(indices);
  const seen = new Set<number>();
  let best = 0;
  for (const start of indices) {
    if (seen.has(start)) continue;
    let size = 0;
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const cur = stack.pop() as number;
      size += 1;
      const x = cur % width;
      const neighbours = [cur - width, cur + width];
      if (x > 0) neighbours.push(cur - 1);
      if (x < width - 1) neighbours.push(cur + 1);
      for (const n of neighbours) {
        if (!set.has(n) || seen.has(n)) continue;
        seen.add(n);
        stack.push(n);
      }
    }
    if (size > best) best = size;
  }
  return best;
}

// --------------------------------------------------------------------- 3.1 rim ---

export interface RimCheck {
  peak: number;
  peakOffsetPx: number;
  shellMinusBackground: number;
  worstIncreaseOutward: number;
  maxAbsStepBeyond2px: number;
  monotonicStartOffset: number;
  pass: boolean;
  failures: string[];
}

/** Offsets sampled outward from the fitted limb, in px. */
const RIM_OFFSETS = [-6, 60] as const;

/** 3.1 — soft monotonic halo, no hard edge. Pure: one bitmap, one geometry. */
export function checkRim(img: Bitmap, geom: DiscGeometry, rays = 16, samplesPerRay = 67): RimCheck {
  const profile: number[][] = [];
  for (let i = 0; i < rays; i += 1) {
    const angle = (i / rays) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const row: number[] = [];
    for (let s = 0; s < samplesPerRay; s += 1) {
      const offset = RIM_OFFSETS[0] + (s * (RIM_OFFSETS[1] - RIM_OFFSETS[0])) / (samplesPerRay - 1);
      const x = Math.round(geom.cx + (geom.r + offset) * cos);
      const y = Math.round(geom.cy + (geom.r + offset) * sin);
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) {
        row.push(Number.NaN);
        continue;
      }
      row.push(px(img, x, y));
    }
    profile.push(row);
  }
  const meanByOffset: number[] = [];
  for (let s = 0; s < samplesPerRay; s += 1) {
    const vals: number[] = [];
    for (const row of profile) {
      const v = row[s];
      if (Number.isFinite(v)) vals.push(v);
    }
    meanByOffset.push(vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : Number.NaN);
  }

  let peak = -Infinity;
  let peakIdx = 0;
  for (let s = 0; s < meanByOffset.length; s += 1) {
    if (Number.isFinite(meanByOffset[s]) && meanByOffset[s] > peak) {
      peak = meanByOffset[s];
      peakIdx = s;
    }
  }
  const peakOffsetPx =
    RIM_OFFSETS[0] + (peakIdx * (RIM_OFFSETS[1] - RIM_OFFSETS[0])) / (samplesPerRay - 1);

  // Background = the outermost sample, which is sky on every ray.
  const background = meanByOffset[meanByOffset.length - 1];
  const shellMinusBackground = peak - background;

  // Worst outward rise past the monotonic start offset, per ray.
  const startOffset = 3;
  let worstIncreaseOutward = 0;
  for (const row of profile) {
    for (let s = 1; s < row.length; s += 1) {
      const offset = RIM_OFFSETS[0] + (s * (RIM_OFFSETS[1] - RIM_OFFSETS[0])) / (samplesPerRay - 1);
      if (offset < startOffset) continue;
      const a = row[s - 1];
      const b = row[s];
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      worstIncreaseOutward = Math.max(worstIncreaseOutward, b - a);
    }
  }

  let maxAbsStepBeyond2px = 0;
  for (let s = 1; s < meanByOffset.length; s += 1) {
    const offset = RIM_OFFSETS[0] + (s * (RIM_OFFSETS[1] - RIM_OFFSETS[0])) / (samplesPerRay - 1);
    if (offset < 2) continue;
    const a = meanByOffset[s - 1];
    const b = meanByOffset[s];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    maxAbsStepBeyond2px = Math.max(maxAbsStepBeyond2px, Math.abs(b - a));
  }

  const failures: string[] = [];
  if (!(peak <= 110)) failures.push(`halo peak ${peak.toFixed(1)} exceeds 110/255`);
  if (!(peakOffsetPx >= 0)) failures.push(`halo peak at ${peakOffsetPx.toFixed(1)}px is inside the limb`);
  if (!(shellMinusBackground <= 2)) {
    failures.push(`shell minus background ${shellMinusBackground.toFixed(2)} exceeds 2/255`);
  }
  if (!(worstIncreaseOutward <= 1)) {
    failures.push(`worst outward rise ${worstIncreaseOutward.toFixed(2)} exceeds 1/255`);
  }
  if (!(maxAbsStepBeyond2px <= 16)) {
    failures.push(`max abs step ${maxAbsStepBeyond2px.toFixed(2)} exceeds 16/255`);
  }

  return {
    peak,
    peakOffsetPx,
    shellMinusBackground,
    worstIncreaseOutward,
    maxAbsStepBeyond2px,
    monotonicStartOffset: startOffset,
    pass: failures.length === 0,
    failures,
  };
}

// ------------------------------------------------------------------- 3.3 local peak ---

export interface LocalPeakCheck {
  ratio: number;
  peak: number;
  annulusMedian: number;
  pass: boolean;
}

/** 3.3 — a sigma-3 blurred local peak may not exceed 1.15× its own 8–20 px annulus. */
export function checkLocalPeak(
  img: Bitmap,
  geom: DiscGeometry,
  probeWindow: { rOverR: number; azimuthDeg: number },
): LocalPeakCheck {
  /*
   * The blur is a Gaussian on the luma channel (sigma 3), matching the committed
   * blue-circle probe: a single cloud pixel must not decide a "soft local peak".
   */
  const blurred = blurLuma(img, 3);
  const w = img.width;
  const lumaBlurredAt = (x: number, y: number): number => blurred[y * w + x];
  const angle = (probeWindow.azimuthDeg * Math.PI) / 180;
  const wx = geom.cx + geom.r * probeWindow.rOverR * Math.cos(angle);
  const wy = geom.cy + geom.r * probeWindow.rOverR * Math.sin(angle);
  const peak = lumaBlurredAt(Math.round(wx), Math.round(wy));
  const ring = annulusLuma(blurred, img, wx, wy, 8, 20, (x, y) => inDisc(geom, x, y));
  const annulusMedian = ring.count > 0 ? median(ring.values) : 0;
  const ratio = annulusMedian === 0 ? Number.POSITIVE_INFINITY : peak / annulusMedian;
  return { ratio, peak, annulusMedian, pass: ratio <= 1.15 };
}

/**
 * Median-of-pixels annular sample over a blurred luma plane.
 *
 * `annulus` in helpers averages; 3.3 needs the MEDIAN, because the gate is a ratio to a
 * robust centre and a mean lets one bright cloud pixel move the reference.
 */
function annulusLuma(
  plane: Float32Array,
  img: Bitmap,
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  keep?: (x: number, y: number) => boolean,
): { values: number[]; count: number } {
  const values: number[] = [];
  const x0 = Math.max(0, Math.floor(cx - rOuter));
  const x1 = Math.min(img.width - 1, Math.ceil(cx + rOuter));
  const y0 = Math.max(0, Math.floor(cy - rOuter));
  const y1 = Math.min(img.height - 1, Math.ceil(cy + rOuter));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (d2 < rInner * rInner || d2 > rOuter * rOuter) continue;
      if (keep && !keep(x, y)) continue;
      values.push(plane[y * img.width + x]);
    }
  }
  return { values, count: values.length };
}

// ----------------------------------------------------------------------- 3.5 pins ---

export interface PinCheck {
  id: string;
  side: 'day' | 'night' | 'terminator';
  valid: boolean;
  validityReason: string;
  median: [number, number, number];
  medianLuma: number;
  medianSaturation: number;
  blownPx: number;
  count: number;
  gates: { P1: boolean; P2: boolean; P3: boolean; P4: boolean };
  pass: boolean;
}

/**
 * 3.5 — pin cores readable, unblown, still amber. Semantic P1–P4, no RGB windows.
 *
 * Takes the already-taken capture plus the pin geometry the acquisition step resolved.
 * `minSamples` and the validity rule are part of the CHECK, not the acquisition, because
 * "was this pin measurable at all" is a question about the capture.
 */
export function checkPins(
  img: Bitmap,
  geom: DiscGeometry,
  pins: Array<{
    id: string;
    side: 'day' | 'night' | 'terminator';
    x: number;
    y: number;
    coreRadiusPx: number;
    rOverR: number;
    facingDot: number;
  }>,
  opts: { minSamples?: number; maxROverR?: number; minFacingDot?: number } = {},
): PinCheck[] {
  const { minSamples = 5, maxROverR = 0.97, minFacingDot = 0.1 } = opts;
  return pins.map((d) => {
    const rr = d.coreRadiusPx;
    const pixels: Array<[number, number, number]> = [];
    for (let y = Math.floor(d.y - rr); y <= Math.ceil(d.y + rr); y += 1) {
      for (let x = Math.floor(d.x - rr); x <= Math.ceil(d.x + rr); x += 1) {
        if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
        if ((x - d.x) ** 2 + (y - d.y) ** 2 > rr * rr) continue;
        const o = (y * img.width + x) * 4;
        pixels.push([img.data[o], img.data[o + 1], img.data[o + 2]]);
      }
    }

    let validityReason = 'valid';
    if (d.facingDot < minFacingDot) {
      validityReason = `faces away (normal·camDir ${d.facingDot.toFixed(3)} < ${minFacingDot})`;
    } else if (d.rOverR > maxROverR) {
      validityReason = `projected core at ${d.rOverR.toFixed(3)} R > ${maxROverR}`;
    } else if (pixels.length < minSamples) {
      validityReason = `only ${pixels.length} core samples (min ${minSamples})`;
    }
    const valid = validityReason === 'valid';

    const empty: PinCheck = {
      id: d.id,
      side: d.side,
      valid,
      validityReason,
      median: [0, 0, 0],
      medianLuma: Number.NaN,
      medianSaturation: Number.NaN,
      blownPx: 0,
      count: pixels.length,
      gates: { P1: false, P2: false, P3: false, P4: false },
      pass: false,
    };
    if (!valid) return empty;

    const medR = median(pixels.map((p) => p[0]));
    const medG = median(pixels.map((p) => p[1]));
    const medB = median(pixels.map((p) => p[2]));
    const lumaVals = pixels.map((p) => luma(p[0], p[1], p[2]));
    const sats = pixels.map((p) => saturationOf(p[0], p[1], p[2]));
    const blownPx = pixels.filter((p) => p[0] >= 250 && p[1] >= 250 && p[2] >= 250).length;

    /*
     * P1-luma readable, P2 not blown, P3 still tinted, P4 still amber.
     *
     * No RGB windows on purpose: B0 measured the render byte-identical across eleven
     * commits while the windows moved twice, so a window describes a sampling rather
     * than the look. These four predicates hold whatever the exact pixel values drift to.
     */
    const gates = {
      P1: median(lumaVals) >= 180,
      P2: blownPx === 0,
      P3: median(sats) >= 0.15,
      P4: medR >= 240 && medG >= 200 && medB <= medG,
    };

    return {
      id: d.id,
      side: d.side,
      valid,
      validityReason,
      median: [medR, medG, medB],
      medianLuma: median(lumaVals),
      medianSaturation: median(sats),
      blownPx,
      count: pixels.length,
      gates,
      pass: gates.P1 && gates.P2 && gates.P3 && gates.P4,
    };
  });
}
