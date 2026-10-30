/**
 * The measurement catalogues the look specs assert against.
 *
 * Every entry here replaces a throwaway `globe-*.mjs` / `look2-*.mjs` script. The
 * point of porting them is not tidiness: those scripts each re-derived luma, blob
 * labelling and ray sampling slightly differently, and that divergence is how two
 * wrong attributions and one sampling-range error got published as fact.
 *
 * Shared maths lives in `src/lib/look/helpers.ts` (unit-tested). This module holds
 * only the browser choreography.
 */
import type { Page } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  annulus,
  bilinearLuma,
  blurLuma,
  collectDiscPixels,
  insideDisc,
  isClipped,
  labelBlobs,
  lumaAt,
  median,
  raySamples,
  sunGlintPoint,
  sunScreenAxis,
  transitionWidth,
  type Blob,
  type DiscGeometry,
} from '../../../src/lib/look/helpers';
import {
  ALL_LAYERS,
  capture,
  disc,
  fitLimb,
  frameNoise,
  setLayers,
  settleAt,
  sunAndCamera,
} from './capture';

/** Results land here, and are echoed into the test output. */
export const RESULTS_DIR = 'test-results/look';

export async function writeResult(name: string, data: unknown): Promise<void> {
  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(path.join(RESULTS_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

// ------------------------------------------------------------------ 3.1 rim

export interface RimResult {
  peak: number;
  peakOffsetPx: number;
  /** Mean profile per radius offset, from -10 px inside the limb to +40 outside. */
  meanByOffset: Array<{ offset: number; luma: number }>;
  /** Worst monotonicity violation outward of the peak, in 1/255 units. */
  worstIncreaseOutward: number;
  worstIncreaseAtDeg: number;
  /** |profile at shell silhouette - far background|. */
  shellMinusBackground: number;
  /** Largest absolute adjacent step on the mean profile beyond +2 px from the limb. */
  maxAbsStepBeyond2px: number;
  /** The limb -> halo step, reported but not gated. */
  limbToHaloStep: number;
  rays: number;
  samplesPerRay: number;
  /** The fitted limb the profile is registered against. */
  origin: { cx: number; cy: number; r: number; rms: number; source: 'fit' };
}

/**
 * 3.1 — atmosphere rim at the default view.
 *
 * Stars OFF (a star on a ray is a spike no rim rule can satisfy) and the sun
 * pinned. Samples 16 rays from 6 px inside the limb to 60 px outside it.
 *
 * **Origin is the FITTED limb, not `discRadiusPx()`.** Offset 0 in this profile is
 * the per-angle point on the (cx, cy, R_fit) circle from `fitLimb`, so "the peak is
 * at +0.4 px" means 0.4 px outside the planet's edge. The earlier version used
 * `discRadiusPx()`, which happens to agree to 0.11 px — but it agrees by luck of
 * the formula, and the whole point of A2 was to stop treating a hook value as
 * ground truth. The brief requires the fit, so the fit is what this uses.
 *
 * The fit runs a 360-ray sub-pixel edge fit with the surface swapped to unlit white,
 * which restores the scene before returning.
 */
export async function measureRim(
  page: Page,
  { rays = 16, inside = 6, outside = 60 }: { rays?: number; inside?: number; outside?: number } = {},
): Promise<{ result: RimResult; geometry: DiscGeometry }> {
  await settleAt(page, 0);
  await setLayers(page, { stars: false });

  const fit = await fitLimb(page);
  if (!Number.isFinite(fit.r)) throw new Error('measureRim: limb fit produced no circle');
  const origin = { cx: fit.cx, cy: fit.cy, r: fit.r, rms: fit.rms, source: 'fit' as const };
  const geom: DiscGeometry = { cx: fit.cx, cy: fit.cy, r: fit.r };

  // Re-establish the view the rim is measured on: fitLimb restores ALL layers, so
  // stars must be switched off again for the actual capture.
  await setLayers(page, { stars: false });
  const img = await capture(page);

  const shellScale = 1.1;
  const offsets: number[] = [];
  for (let o = -inside; o <= outside; o += 1) offsets.push(o);

  const perRay: Array<Array<{ r: number; luma: number }>> = [];
  for (let i = 0; i < rays; i += 1) {
    const angle = (i / rays) * Math.PI * 2;
    const profile: Array<{ r: number; luma: number }> = [];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (const o of offsets) {
      const r = origin.r + o;
      profile.push({
        r: o,
        // Bilinear, because the fitted origin is sub-pixel and every threshold here
        // is a per-255 luma step measured on a 1 px grid.
        luma: bilinearLuma(img, origin.cx + cos * r, origin.cy + sin * r),
      });
    }
    perRay.push(profile);
  }

  // Mean profile per offset.
  const meanByOffset = offsets.map((o, idx) => ({
    offset: o,
    luma: perRay.reduce((s, p) => s + p[idx].luma, 0) / rays,
  }));

  // Peak and its offset, from the mean profile.
  let peak = -Infinity;
  let peakOffsetPx = 0;
  for (const row of meanByOffset) {
    if (row.luma > peak) {
      peak = row.luma;
      peakOffsetPx = row.offset;
    }
  }

  /*
   * Monotonicity, measured OUTWARD OF THE PEAK on every ray individually.
   *
   * Tolerance is 1/255: the profile is sampled at whole pixels from a
   * gamma-encoded PNG, so a single-unit rise can legitimately be rounding. Anything
   * larger is a real non-monotonicity.
   */
  let worstIncreaseOutward = 0;
  let worstIncreaseAtDeg = 0;
  for (let i = 0; i < rays; i += 1) {
    const p = perRay[i];
    const peakIdx = p.reduce((best, row, idx) => (row.luma > p[best].luma ? idx : best), 0);
    for (let k = peakIdx + 1; k < p.length; k += 1) {
      const rise = p[k].luma - p[k - 1].luma;
      if (rise > worstIncreaseOutward) {
        worstIncreaseOutward = rise;
        worstIncreaseAtDeg = (i / rays) * 360;
      }
    }
  }

  // Value at the shell silhouette vs far background.
  const shellOffset = geom.r * (shellScale - 1);
  const shellRow = meanByOffset.reduce((best, row) =>
    Math.abs(row.offset - shellOffset) < Math.abs(best.offset - shellOffset) ? row : best,
  );
  const bgRow = meanByOffset[meanByOffset.length - 1];

  // Largest adjacent step on the MEAN profile beyond +2 px from the limb.
  let maxAbsStepBeyond2px = 0;
  for (let i = 1; i < meanByOffset.length; i += 1) {
    if (meanByOffset[i].offset <= 2) continue;
    const step = Math.abs(meanByOffset[i].luma - meanByOffset[i - 1].luma);
    if (step > maxAbsStepBeyond2px) maxAbsStepBeyond2px = step;
  }

  // The limb -> halo step (reported, not gated).
  const atLimbIn = meanByOffset.find((r) => r.offset === -1)?.luma ?? NaN;
  const atPeak = peak;
  const limbToHaloStep = atPeak - atLimbIn;

  const result: RimResult = {
    peak,
    peakOffsetPx,
    meanByOffset,
    worstIncreaseOutward,
    worstIncreaseAtDeg,
    shellMinusBackground: Math.abs(shellRow.luma - bgRow.luma),
    maxAbsStepBeyond2px,
    limbToHaloStep,
    rays,
    samplesPerRay: offsets.length,
    origin,
  };
  await writeResult('rim', { geometry: geom, ...result });
  return { result, geometry: geom };
}

// ----------------------------------------------------------------- 3.2 glare

export interface GlareResult {
  clipped: number;
  largestBlob: number;
  blobCount: number;
  blobs: Array<{ size: number; w: number; h: number; cx: number; cy: number; rOverR: number }>;
}

/**
 * 3.2 — clipped pixels and the largest bright blob at one azimuth.
 *
 * stars/pins/rings OFF: the rule excludes pins, and a star or a ring is a bright
 * object that is not the surface.
 */
export async function measureGlare(
  page: Page,
  azimuthDeg: number,
): Promise<{ result: GlareResult; geometry: DiscGeometry }> {
  await settleAt(page, azimuthDeg);
  await setLayers(page, { stars: false, pins: false, rings: false });
  const geom = await disc(page);
  const img = await capture(page);

  const clipped = collectDiscPixels(img, geom, (r, g, b) => isClipped(r, g, b));
  const bright = collectDiscPixels(img, geom, (_r, _g, _b, l) => l >= 250);
  const blobs = labelBlobs(bright.points);

  const result: GlareResult = {
    clipped: clipped.points.length,
    largestBlob: blobs.length ? blobs[0].size : 0,
    blobCount: blobs.length,
    blobs: blobs.slice(0, 8).map((b: Blob) => ({
      size: b.size,
      w: b.width,
      h: b.height,
      cx: Math.round(b.cx),
      cy: Math.round(b.cy),
      rOverR: +Math.hypot(b.cx - geom.cx, b.cy - geom.cy).toFixed(3) / geom.r,
    })),
  };
  return { result, geometry: geom };
}

// ------------------------------------------------------- 3.3 blue-circle guard

export interface BlueCircleResult {
  windows: Array<{
    x: number;
    y: number;
    size: number;
    peak: number;
    annulusMedian: number;
    ratio: number;
    excluded: boolean;
    pass: boolean;
  }>;
  /** Ocean-wide sweep (only when the mask is available). */
  oceanSweep?: { sampled: number; failures: number; worstRatio: number };
}

/**
 * Fixed probe windows for the blue-circle guard, including the required 40x40
 * window at (344, 392) — the coordinate the fill light's specular lobe occupied
 * before it was removed.
 */
export const BLUE_CIRCLE_WINDOWS: Array<{ x: number; y: number; size: number }> = [
  { x: 344, y: 392, size: 40 },
  { x: 300, y: 392, size: 40 },
  { x: 400, y: 300, size: 40 },
  { x: 400, y: 500, size: 40 },
  { x: 520, y: 250, size: 40 },
  { x: 520, y: 540, size: 40 },
];

/**
 * 3.3 — the local-peak detector, on a blurred luma channel.
 *
 * Clouds/pins/rings/stars OFF so the surface is the only thing in frame, and the
 * scene clock pinned so the sun's glint does not drift between the measurement and
 * the exclusion point.
 */
export async function measureBlueCircle(
  page: Page,
  windows = BLUE_CIRCLE_WINDOWS,
): Promise<{ result: BlueCircleResult; geometry: DiscGeometry }> {
  await settleAt(page, 0);
  await setLayers(page, { stars: false, pins: false, rings: false, clouds: false });
  const geom = await disc(page);
  const img = await capture(page);
  const { sun, cam } = await sunAndCamera(page);
  const glint = sunGlintPoint(sun, cam, geom);

  const blurred = blurLuma(img, 3);
  const blurAt = (x: number, y: number) => {
    const ix = Math.min(img.width - 1, Math.max(0, Math.round(x)));
    const iy = Math.min(img.height - 1, Math.max(0, Math.round(y)));
    return blurred[iy * img.width + ix];
  };

  const rows: BlueCircleResult['windows'] = [];
  for (const w of windows) {
    // Peak inside the window.
    let peak = -Infinity;
    let px = w.x;
    let py = w.y;
    const half = w.size / 2;
    for (let y = Math.round(w.y - half); y <= Math.round(w.y + half); y += 1) {
      for (let x = Math.round(w.x - half); x <= Math.round(w.x + half); x += 1) {
        const v = blurAt(x, y);
        if (v > peak) {
          peak = v;
          px = x;
          py = y;
        }
      }
    }
    // Surrounding annulus median at radius 8..20 px around the PEAK.
    const ring: number[] = [];
    for (let a = 0; a < 32; a += 1) {
      const th = (a / 32) * Math.PI * 2;
      for (const r of [8, 11, 14, 17, 20]) ring.push(blurAt(px + Math.cos(th) * r, py + Math.sin(th) * r));
    }
    const med = median(ring);
    const ratio = med > 1e-6 ? peak / med : NaN;
    // Excluded inside 0.15 R of the analytically predicted glint point.
    const excluded = glint
      ? Math.hypot(px - glint.x, py - glint.y) <= glint.r
      : false;
    rows.push({
      x: w.x,
      y: w.y,
      size: w.size,
      peak: +peak.toFixed(2),
      annulusMedian: +med.toFixed(2),
      ratio: +ratio.toFixed(3),
      excluded,
      pass: excluded || !(ratio > 1.15),
    });
  }

  const result: BlueCircleResult = { windows: rows };
  await writeResult('blue-circle', { geometry: geom, glint, ...result });
  return { result, geometry: geom };
}

// ------------------------------------------------------------- 3.4 terminator

export interface TerminatorResult {
  /** Luma profile along the projected sun axis, median of 5 parallel lines. */
  profile: Array<{ t: number; luma: number }>;
  dayLevel: number;
  nightLevel: number;
  widthPx: number | null;
  widthPctR: number | null;
  axis: { ax: number; ay: number };
}

/**
 * 3.4 — terminator softness measured FROM PIXELS.
 *
 * The crossing is located analytically only to decide where to sample; the
 * measurement itself is the median of five parallel luminance lines, which is what
 * makes it immune to cloud texture. Luma is sampled along the sun's screen axis and
 * then smoothed, and the 90%->10% width is taken with the direction-aware
 * `transitionWidth` (a naive scan reported a 25 px ramp as 90 px).
 */
export async function measureTerminator(
  page: Page,
  { offsets = [-0.2, -0.1, 0, 0.1, 0.2] as number[], smooth = 9 } = {},
): Promise<{ result: TerminatorResult; geometry: DiscGeometry }> {
  await settleAt(page, 0);
  await setLayers(page, { stars: false, pins: false, rings: false });
  const geom = await disc(page);
  const img = await capture(page);
  const { sun, cam } = await sunAndCamera(page);
  const { ax, ay } = sunScreenAxis(sun, cam);

  // Build the sampled lines. Each is parallel to the sun axis, offset perpendicular
  // to it by `offset * R`.
  const lines: Array<Array<{ t: number; luma: number }>> = [];
  for (const o of offsets) {
    const ox = -ay * o * geom.r;
    const oy = ax * o * geom.r;
    const line: Array<{ t: number; luma: number }> = [];
    for (let t = -Math.floor(geom.r * 0.99); t <= Math.floor(geom.r * 0.99); t += 1) {
      const x = geom.cx + ax * t + ox;
      const y = geom.cy + ay * t + oy;
      if (!insideDisc(geom, x, y)) continue;
      line.push({ t, luma: lumaAt(img, x, y) });
    }
    lines.push(line);
  }

  // Median across the lines at each t, then smooth.
  const tMin = Math.min(...lines.map((l) => (l.length ? l[0].t : 0)));
  const tMax = Math.max(...lines.map((l) => (l.length ? l[l.length - 1].t : 0)));
  const merged: Array<{ t: number; luma: number }> = [];
  for (let t = tMin; t <= tMax; t += 1) {
    const vals: number[] = [];
    for (const line of lines) {
      const hit = line.find((p) => p.t === t);
      if (hit) vals.push(hit.luma);
    }
    if (vals.length) merged.push({ t, luma: median(vals) });
  }

  // Box smooth.
  const smoothed = merged.map((row, i) => {
    const half = smooth >> 1;
    const slice = merged.slice(Math.max(0, i - half), Math.min(merged.length, i + half + 1));
    return { t: row.t, luma: slice.reduce((s, p) => s + p.luma, 0) / slice.length };
  });

  const hi = Math.max(...smoothed.map((p) => p.luma));
  const lo = Math.min(...smoothed.map((p) => p.luma));
  const highLevel = lo + (hi - lo) * 0.9;
  const lowLevel = lo + (hi - lo) * 0.1;
  // `transitionWidth` speaks in `r` for the rim case; here the axis is `t`.
  const w = transitionWidth(
    smoothed.map((p2) => ({ r: p2.t, luma: p2.luma })),
    highLevel,
    lowLevel,
  );

  const result: TerminatorResult = {
    profile: smoothed.map((p) => ({ t: p.t, luma: +p.luma.toFixed(2) })),
    dayLevel: +hi.toFixed(2),
    nightLevel: +lo.toFixed(2),
    widthPx: w ? +w.width.toFixed(1) : null,
    widthPctR: w ? +((w.width / geom.r) * 100).toFixed(1) : null,
    axis: { ax, ay },
  };
  await writeResult('terminator', { geometry: geom, ...result });
  return { result, geometry: geom };
}

export { capture, disc, frameNoise, setLayers, settleAt, ALL_LAYERS, annulus, raySamples };
