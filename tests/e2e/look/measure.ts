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
import { SHELLS } from '../../../src/scene/constants';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  annulus,
  bilinearLuma,
  checkMonotonicOutward,
  monotonicStartOffset,
  shellSilhouetteOffsetPx,
  blurLuma,
  collectDiscPixels,
  insideDisc,
  isClipped,
  labelBlobs,
  luma,
  lumaAt,
  median,
  PROBE_WINDOWS,
  resolveWindow,
  windowValidity,
  specularMask,
  raySamples,
  sunScreenAxis,
  transitionWidth,
  terminatorFalloff,
  focalPxFromFov,
  type Blob,
  type PolarWindow,
  type Bitmap,
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
  twoFrames,
  cameraGeometry,
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
  /** Where the strict-monotonic gate starts, and why. */
  monotonic: {
    startOffset: number;
    reason: string;
    outermostOpaqueOffset: number;
    cloudShellOffset: number;
    peakOffset: number;
  };
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
   * Monotonicity, measured outward of `startOffset`.
   *
   * NOT from the peak, and not from the limb. B2's ablation showed the 2.65/255 rise
   * at 247.5deg is the CLOUD DECK turning on across its own antialiased silhouette
   * (1.004 R = +1.03 px past the fit): clouds OFF gives -0.39/255, i.e. no rise at all,
   * while rings and pins move it by <1/255. A shell slightly outside the planet
   * legitimately brightens the first ~2 px, so the gate starts past it.
   *
   * Tolerance is 1/255: the profile comes from a gamma-encoded PNG, so a single-unit
   * rise can legitimately be quantisation.
   */
  const peakRowOffset = meanByOffset.reduce((best, row) => (row.luma > best.luma ? row : best)).offset;
  const cam = await cameraGeometry(page);
  const focal = focalPxFromFov(cam.fov, cam.height);
  const cloudShellOffset = shellSilhouetteOffsetPx(SHELLS.clouds, cam.radius, cam.distance, focal);
  const overlayOffset = shellSilhouetteOffsetPx(SHELLS.overlay, cam.radius, cam.distance, focal);
  const outermostOpaqueOffset = Math.max(cloudShellOffset, overlayOffset);
  const startOffset = monotonicStartOffset(peakRowOffset, outermostOpaqueOffset);
  const monotonicCheck = checkMonotonicOutward(
    perRay.map((p, i) => ({
      deg: (i / rays) * 360,
      points: p.map((row) => ({ offset: row.r, luma: row.luma })),
    })),
    startOffset,
  );
  const worstIncreaseOutward =
    monotonicCheck.worstIncrease > -Infinity ? monotonicCheck.worstIncrease : 0;
  const worstIncreaseAtDeg = monotonicCheck.at?.deg ?? 0;

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
    monotonic: {
      startOffset,
      reason:
        `max(peak ${peakRowOffset}px, outermost opaque silhouette ${outermostOpaqueOffset.toFixed(2)}px + 1px) = ${startOffset}px. ` +
        `The cloud deck's own silhouette sits ${cloudShellOffset.toFixed(2)}px past the limb, so the rise it produces inside that band is an approved part of the look.`,
      outermostOpaqueOffset: +outermostOpaqueOffset.toFixed(3),
      cloudShellOffset: +cloudShellOffset.toFixed(3),
      peakOffset: peakRowOffset,
    },
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


// --------------------------------------------------------- specular mask (3.3)

export interface SpecularMaskResult {
  lookup(x: number, y: number): boolean;
  summary: { pixels: number; threshold: string; dilationPx: number; bbox: [number, number, number, number] | null };
}

/**
 * The region the SPECULAR sources light, measured rather than predicted.
 *
 * Two captures of the same frozen scene — every specular source on, then all off —
 * differenced, thresholded at 3/255, dilated 8 px. Used by the local-peak rule to
 * excuse the sun glint, which is allowed to be bright.
 *
 * The previous exclusion was a 0.15 R circle at `sunGlintPoint`'s orthographic
 * projection of the half-vector, which landed 89 px from the lobe's actual peak: it
 * excused a patch of ocean while the glint it meant to excuse sat outside it.
 */
export async function measureSpecularMask(
  page: Page,
  geom: DiscGeometry,
): Promise<SpecularMaskResult> {
  // ON: the approved look's specular sources (material lobe + overlay).
  await setLayers(page, { stars: false, pins: false, rings: false });
  await page.evaluate(() => {
    window.__look!.specularIntensity(0.18);
    window.__globe!.setLookFlags({ specular: true });
  });
  const on = await capture(page);

  // OFF: both specular paths disabled.
  await page.evaluate(() => {
    window.__look!.specularIntensity(0);
    window.__globe!.setLookFlags({ specular: false });
  });
  const off = await capture(page);

  // Restore the committed look before returning.
  await page.evaluate(() => {
    window.__look!.specularIntensity(0);
    window.__globe!.setLookFlags({ specular: true });
  });
  await setLayers(page, ALL_LAYERS);
  await twoFrames(page);

  const m = specularMask(on, off, geom, { threshold: 3, radius: 8 });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let y = 0; y < m.height; y += 1) {
    for (let x = 0; x < m.width; x += 1) {
      if (!m.mask[y * m.width + x]) continue;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  return {
    lookup: (x: number, y: number) => {
      const ix = Math.round(x);
      const iy = Math.round(y);
      if (ix < 0 || iy < 0 || ix >= m.width || iy >= m.height) return false;
      return m.mask[iy * m.width + ix] === 1;
    },
    summary: {
      pixels: m.pixels,
      threshold: '3/255',
      dilationPx: 8,
      bbox: m.pixels ? [x0, y0, x1, y1] : null,
    },
  };
}

// ------------------------------------------------------- 3.3 blue-circle guard

export interface BlueCircleResult {
  windows: Array<{
    id: string;
    rFrac: number;
    angleDeg: number;
    x: number;
    y: number;
    rPx: number;
    rOverR: number;
    insideFraction: number;
    valid: boolean;
    validityReason: string;
    size: number;
    peak: number;
    annulusMedian: number;
    ratio: number;
    excluded: boolean;
    pass: boolean;
  }>;
  glintMask: { pixels: number; threshold: string; dilationPx: number; bbox: [number, number, number, number] | null };
}

/**
 * 3.3 — the local-peak detector, on a blurred luma channel.
 *
 * Windows are POLAR (fraction of R_fit, degrees clockwise from +x on screen) and are
 * resolved against the FITTED limb, so they follow the disc between viewports. The old
 * absolute list included `(300, 392)`, which sits at 1.045 R — outside the disc, in pure
 * atmosphere halo — and produced a 3.7x "local peak" that was the halo doing its job.
 *
 * Clouds/pins/rings/stars OFF so the surface is the only thing in frame, and the scene
 * clock pinned so the glint does not drift between the measurement and its exclusion.
 * The glint is excluded via `specularMask` (measured), not a 0.15 R circle around a
 * predicted point.
 */
export async function measureBlueCircle(
  page: Page,
  windows: readonly PolarWindow[] = PROBE_WINDOWS,
): Promise<{ result: BlueCircleResult; geometry: DiscGeometry }> {
  await settleAt(page, 0);
  await setLayers(page, { stars: false, pins: false, rings: false, clouds: false });

  const fit = await fitLimb(page);
  if (!Number.isFinite(fit.r)) throw new Error('measureBlueCircle: limb fit produced no circle');
  const geom: DiscGeometry = { cx: fit.cx, cy: fit.cy, r: fit.r };

  // fitLimb restores every layer on the way out, so re-establish the 3.3 view.
  await setLayers(page, { stars: false, pins: false, rings: false, clouds: false });
  const img = await capture(page);
  const glintMask = await measureSpecularMask(page, geom);
  await setLayers(page, { stars: false, pins: false, rings: false, clouds: false });
  await twoFrames(page);
  const img2 = await capture(page);
  const blurred = blurLuma(img2, 3);
  void img;

  const blurAt = (x: number, y: number) => {
    const ix = Math.min(blurred.length ? img2.width - 1 : 0, Math.max(0, Math.round(x)));
    const iy = Math.min(img2.height - 1, Math.max(0, Math.round(y)));
    return blurred[iy * img2.width + ix];
  };

  const rows: BlueCircleResult['windows'] = [];
  for (const w of windows) {
    const resolved = resolveWindow(w, geom);
    const validity = windowValidity(resolved, geom);

    // Peak inside the window.
    let peak = -Infinity;
    let px = resolved.x;
    let py = resolved.y;
    const half = w.size / 2;
    for (let y = Math.round(resolved.y - half); y <= Math.round(resolved.y + half); y += 1) {
      for (let x = Math.round(resolved.x - half); x <= Math.round(resolved.x + half); x += 1) {
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
      for (const r of [8, 11, 14, 17, 20]) {
        ring.push(blurAt(px + Math.cos(th) * r, py + Math.sin(th) * r));
      }
    }
    const med = median(ring);
    const ratio = med > 1e-6 ? peak / med : NaN;
    // Excluded where a specular source is actually lighting the surface.
    const excluded = glintMask.lookup(px, py);
    rows.push({
      id: w.id,
      rFrac: w.rFrac,
      angleDeg: w.angleDeg,
      x: +resolved.x.toFixed(2),
      y: +resolved.y.toFixed(2),
      rPx: +validity.rPx.toFixed(2),
      rOverR: +validity.rFrac.toFixed(4),
      insideFraction: +validity.insideFraction.toFixed(4),
      valid: validity.ok,
      validityReason: validity.reason,
      size: w.size,
      peak: +peak.toFixed(2),
      annulusMedian: +med.toFixed(2),
      ratio: +ratio.toFixed(3),
      excluded,
      pass: excluded || !(ratio > 1.15),
    });
  }

  const result: BlueCircleResult = { windows: rows, glintMask: glintMask.summary };
  await writeResult('blue-circle', { geometry: geom, ...result });
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
  /** Night fraction by luma: share of disc pixels below 25% of the day mean. */
  nightFractionLuma: number;
  nightMeanLuma: number;
  dayMeanLuma: number;
  /** Max adjacent 1 px step across the terminator on the median profile. */
  crossTerminatorStep: number;
  /** Radius the profile is registered against. */
  rFit: number;
  rms: number;
  /** The locally monotonic falloff the width and step were measured inside. */
  falloff: { fromT: number; toT: number; samples: number; fromLuma: number; toLuma: number };
}

/**
 * Night fraction by luma — the definition that produced the 14.1% default-view figure.
 *
 * From LOOK2.md: "share of disc pixels with luminance < 25% of the day mean". That is
 * NOT the 10-30% / 70-90% bands used for relative before/after comparisons; those are
 * reported elsewhere and are not gated. Stated here because "night fraction" means
 * something different in each of the two harnesses and the numbers are not comparable.
 */
export function nightFractionByLuma(
  img: Bitmap,
  geom: DiscGeometry,
): { fraction: number; dayMean: number; nightMean: number; below: number; total: number } {
  const vals: number[] = [];
  for (let y = Math.max(0, Math.floor(geom.cy - geom.r)); y <= Math.min(img.height - 1, Math.ceil(geom.cy + geom.r)); y += 1) {
    for (let x = Math.max(0, Math.floor(geom.cx - geom.r)); x <= Math.min(img.width - 1, Math.ceil(geom.cx + geom.r)); x += 1) {
      if (!insideDisc(geom, x, y)) continue;
      vals.push(lumaAt(img, x, y));
    }
  }
  if (!vals.length) return { fraction: NaN, dayMean: NaN, nightMean: NaN, below: 0, total: 0 };
  const sorted = [...vals].sort((a, b) => a - b);
  // Day mean = mean of the upper half, which is a stable "lit" plateau reference.
  const dayVals = sorted.slice(Math.floor(sorted.length / 2));
  const dayMean = dayVals.reduce((a, b) => a + b, 0) / dayVals.length;
  const threshold = 0.25 * dayMean;
  const night = vals.filter((v) => v < threshold);
  return {
    fraction: night.length / vals.length,
    dayMean,
    nightMean: night.length ? night.reduce((a, b) => a + b, 0) / night.length : NaN,
    below: night.length,
    total: vals.length,
  };
}

/**
 * 3.4 — terminator softness measured FROM PIXELS, at one azimuth.
 *
 * The analytic crossing only chooses where to sample; the measurement is the median of
 * five parallel luminance lines offset perpendicular to the sun's screen axis by
 * -0.2R..+0.2R, smoothed, with the 90%->10% width taken by the direction-aware
 * `transitionWidth` (a naive scan reported a 25 px ramp as 90 px).
 */
export async function measureTerminator(
  page: Page,
  { azimuthDeg = 0, offsets = [-0.2, -0.1, 0, 0.1, 0.2] as number[], smooth = 9 } = {},
): Promise<{ result: TerminatorResult; geometry: DiscGeometry }> {
  await settleAt(page, azimuthDeg);
  await setLayers(page, { stars: false, pins: false, rings: false });

  const fit = await fitLimb(page);
  if (!Number.isFinite(fit.r)) throw new Error('measureTerminator: limb fit produced no circle');
  const geom: DiscGeometry = { cx: fit.cx, cy: fit.cy, r: fit.r };

  await setLayers(page, { stars: false, pins: false, rings: false });
  const img = await capture(page);
  const { sun, cam } = await sunAndCamera(page);
  const { ax, ay } = sunScreenAxis(sun, cam);
  const night = nightFractionByLuma(img, geom);

  // Each line is parallel to the sun axis, offset perpendicular to it by offset * R.
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
    if (line.length) lines.push(line);
  }

  const tMin = Math.min(...lines.map((l) => l[0].t));
  const tMax = Math.max(...lines.map((l) => l[l.length - 1].t));
  const merged: Array<{ t: number; luma: number }> = [];
  for (let t = tMin; t <= tMax; t += 1) {
    const vals: number[] = [];
    for (const line of lines) {
      const hit = line.find((p) => p.t === t);
      if (hit) vals.push(hit.luma);
    }
    if (vals.length) merged.push({ t, luma: median(vals) });
  }

  const smoothed = merged.map((row, i) => {
    const half = smooth >> 1;
    const slice = merged.slice(Math.max(0, i - half), Math.min(merged.length, i + half + 1));
    return { t: row.t, luma: slice.reduce((s, p) => s + p.luma, 0) / slice.length };
  });

  /*
   * Width and step are measured ONLY inside the terminator's own locally monotonic
   * falloff (see `terminatorFalloff`). Scanning the whole disc is what produced
   * "widths" of 162-188% of R_fit — wider than the planet.
   */
  const falloff = terminatorFalloff(smoothed.map((p2) => ({ t: p2.t, luma: p2.luma })));
  const windowed = smoothed
    .slice(falloff.start, falloff.end + 1)
    .map((p2) => ({ r: p2.t, luma: p2.luma }));

  const hi = Math.max(...windowed.map((p) => p.luma));
  const lo = Math.min(...windowed.map((p) => p.luma));
  const highLevel = lo + (hi - lo) * 0.9;
  const lowLevel = lo + (hi - lo) * 0.1;
  const w = transitionWidth(windowed, highLevel, lowLevel);

  /*
   * Max adjacent 1 px step ACROSS the terminator: between the two crossings found by
   * `transitionWidth`, not over the whole profile. A step anywhere else is limb or
   * texture, which no terminator rule may be blamed for.
   */
  let crossTerminatorStep = 0;
  if (w) {
    const i0 = Math.min(w.iHigh, w.iLow);
    const i1 = Math.max(w.iHigh, w.iLow);
    for (let i = Math.max(1, i0); i <= Math.min(windowed.length - 1, i1); i += 1) {
      const step = Math.abs(windowed[i].luma - windowed[i - 1].luma);
      if (step > crossTerminatorStep) crossTerminatorStep = step;
    }
  }

  const result: TerminatorResult = {
    profile: smoothed.map((p) => ({ t: p.t, luma: +p.luma.toFixed(2) })),
    dayLevel: +hi.toFixed(2),
    nightLevel: +lo.toFixed(2),
    widthPx: w ? +w.width.toFixed(1) : null,
    widthPctR: w ? +((w.width / geom.r) * 100).toFixed(2) : null,
    axis: { ax, ay },
    nightFractionLuma: +night.fraction.toFixed(4),
    nightMeanLuma: +night.nightMean.toFixed(2),
    dayMeanLuma: +night.dayMean.toFixed(2),
    crossTerminatorStep: +crossTerminatorStep.toFixed(2),
    rFit: +geom.r.toFixed(3),
    rms: +fit.rms.toFixed(3),
    falloff: {
      fromT: smoothed[falloff.start].t,
      toT: smoothed[falloff.end].t,
      samples: falloff.length,
      fromLuma: +falloff.startLuma.toFixed(2),
      toLuma: +falloff.endLuma.toFixed(2),
    },
  };
  await writeResult(`terminator-az${azimuthDeg}`, { geometry: geom, ...result });
  return { result, geometry: geom };
}

export { capture, disc, frameNoise, setLayers, settleAt, ALL_LAYERS, annulus, raySamples };

// ------------------------------------------------------------ 3.5 pin cores

export interface PinCoreResult {
  az: number;
  id: string;
  x: number;
  y: number;
  /** Brightest pixel in the 29x29 core search box. */
  coreRgb: [number, number, number];
  coreAt: [number, number];
  /** Pure-white pixels (R,G,B all >= 250) in the 13x13 core. */
  pureWhitePx: number;
  /** All-black pixels in the 13x13 core — "core RGB not black". */
  blackPx: number;
  side: 'day' | 'night';
}

/**
 * 3.5 — read every FACING pin's core RGB at one azimuth.
 *
 * The core is found as the brightest pixel in a 29x29 box around the projected pin
 * centre, then judged on a 13x13 box: the core is a small emissive sphere and its
 * centre is what carries the colour, while the surrounding housing is deliberately dark
 * (#080c14) and would drag any mean toward black.
 */
export async function measurePinCores(
  page: Page,
  azimuthDeg: number,
): Promise<{ cores: PinCoreResult[]; geometry: DiscGeometry }> {
  await settleAt(page, azimuthDeg);
  await setLayers(page, { stars: false, rings: false, pins: true, atmosphere: true, clouds: true });
  const fit = await fitLimb(page);
  if (!Number.isFinite(fit.r)) throw new Error('measurePinCores: limb fit produced no circle');
  const geom: DiscGeometry = { cx: fit.cx, cy: fit.cy, r: fit.r };
  await setLayers(page, { stars: false, rings: false, pins: true, atmosphere: true, clouds: true });
  const img = await capture(page);

  const pins = await page.evaluate(() => window.__globe!.pins());
  const cores: PinCoreResult[] = [];
  for (const pin of pins) {
    if (!pin.facing) continue;
    let best = { L: -Infinity, x: 0, y: 0, rgb: [0, 0, 0] as [number, number, number] };
    for (let y = Math.round(pin.y) - 14; y <= Math.round(pin.y) + 14; y += 1) {
      for (let x = Math.round(pin.x) - 14; x <= Math.round(pin.x) + 14; x += 1) {
        if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
        const o = (y * img.width + x) * 4;
        const L = luma(img.data[o], img.data[o + 1], img.data[o + 2]);
        if (L > best.L) {
          best = { L, x, y, rgb: [img.data[o], img.data[o + 1], img.data[o + 2]] };
        }
      }
    }
    let pureWhitePx = 0;
    let blackPx = 0;
    for (let y = Math.round(pin.y) - 6; y <= Math.round(pin.y) + 6; y += 1) {
      for (let x = Math.round(pin.x) - 6; x <= Math.round(pin.x) + 6; x += 1) {
        if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
        const o = (y * img.width + x) * 4;
        const [r, g, b] = [img.data[o], img.data[o + 1], img.data[o + 2]];
        if (r >= 250 && g >= 250 && b >= 250) pureWhitePx += 1;
        if (r === 0 && g === 0 && b === 0) blackPx += 1;
      }
    }
    /*
     * Day or night from the pin's own surface NORMAL against the sun.
     *
     * Not from its screen position: a screen-axis projection classifies a pin by where it
     * sits on the 2D disc, and the sub-solar point is not the screen centre — the camera
     * looks from (0, 1.15, 3.15) while the sun is at (0.72, 0.36, 0.59), so pins near
     * screen centre are lit obliquely. The normal test is the same `dot(n, sun)` the
     * shader uses to light the surface, which is what decides day and night on screen.
     */
    const sunRel = await page.evaluate(
      ({ x, y, cx, cy, R }) => {
        let pos: number[] = [0.72, 0.36, 0.59];
        (window.__scene as { traverse(fn: (o: unknown) => void): void }).traverse((o) => {
          const l = o as { isDirectionalLight?: boolean; intensity?: number; position?: { x: number; y: number; z: number } };
          if (l.isDirectionalLight && (l.intensity ?? 0) > 1 && l.position) {
            pos = [l.position.x, l.position.y, l.position.z];
          }
        });
        const n = Math.hypot(pos[0], pos[1], pos[2]) || 1;
        const s3 = [pos[0] / n, pos[1] / n, pos[2] / n];
        // Reconstruct the camera-facing surface normal of this screen point.
        const dx = (x - cx) / R;
        const dy = (y - cy) / R;
        const nz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
        const cam = window.__camera as { position: { x: number; y: number; z: number } };
        const cl = Math.hypot(cam.position.x, cam.position.y, cam.position.z) || 1;
        const c3 = [cam.position.x / cl, cam.position.y / cl, cam.position.z / cl];
        // Screen +x/+y expressed in world via the camera basis (right = up x fwd).
        const up = [0, 1, 0];
        const cr = (a: number[], b: number[]) => [
          a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0],
        ];
        let u = cr(up, c3);
        const ul = Math.hypot(u[0], u[1], u[2]);
        u = [u[0] / ul, u[1] / ul, u[2] / ul];
        const v = cr(c3, u);
        const nx = u[0] * dx + v[0] * -dy + c3[0] * nz;
        const ny = u[1] * dx + v[1] * -dy + c3[1] * nz;
        const nz2 = u[2] * dx + v[2] * -dy + c3[2] * nz;
        const nl = Math.hypot(nx, ny, nz2) || 1;
        return (nx / nl) * s3[0] + (ny / nl) * s3[1] + (nz2 / nl) * s3[2];
      },
      { x: pin.x, y: pin.y, cx: geom.cx, cy: geom.cy, R: geom.r },
    );
    const rel = sunRel;
    cores.push({
      az: azimuthDeg,
      id: pin.id,
      x: +pin.x.toFixed(1),
      y: +pin.y.toFixed(1),
      coreRgb: best.rgb,
      coreAt: [best.x, best.y],
      pureWhitePx,
      blackPx,
      side: rel >= 0 ? 'day' : 'night',
    });
  }
  await writeResult(`pins-az${azimuthDeg}`, { geometry: geom, cores });
  return { cores, geometry: geom };
}

// -------------------------------------------------------- 3.6 ring light cast

export interface RingCastResult {
  id: string;
  x: number;
  y: number;
  /** Mean luma of the 30..60 px annulus, pins ON. */
  onMean: number;
  /** Mean luma of the same annulus, pins OFF. */
  offMean: number;
  /** A second pins-OFF capture, for the noise floor. */
  offMean2: number;
  /** |on - off| / off, as a percentage. */
  deltaPct: number;
  /** |off - off2| / off, as a percentage — an unchanged scene's own movement. */
  noisePct: number;
  /** max(3%, 1.5 x noise%) for this pin. */
  allowedPct: number;
  annulusPixels: number;
  /** Fraction of the 30..60 px annulus that lies inside the disc. */
  annulusInsideFraction: number;
  /** False when the pin's annulus is not mostly surface, so cast light is unmeasurable. */
  valid: boolean;
  validityReason: string;
  pass: boolean;
}

/**
 * 3.6 — does a pin cast light on the surface around it?
 *
 * Static frame: rings, atmosphere and stars OFF, clock frozen, so a delta cannot be the
 * ring animation or a drifting cloud. Annulus r = 30..60 css px around each pin's
 * projected centre, outside-disc pixels excluded.
 *
 * Why 30 px and not 10: the pins carry a ~22 px bloom skirt, so anything closer measures
 * the bloom halo rather than cast light. The brief's own floor is 24 px; 30 keeps clear
 * of it.
 *
 * PASS iff |delta%| <= max(3%, 1.5 x noise%), where noise is a pins-OFF vs pins-OFF
 * comparison of two captures — "the surface changed" is meaningless without knowing how
 * much an unchanged surface moves between frames.
 */
export async function measureRingCast(
  page: Page,
): Promise<{ results: RingCastResult[]; geometry: DiscGeometry }> {
  await settleAt(page, 0);
  await setLayers(page, { rings: false, atmosphere: false, stars: false, clouds: false });

  const fit = await fitLimb(page);
  if (!Number.isFinite(fit.r)) throw new Error('measureRingCast: limb fit produced no circle');
  const geom: DiscGeometry = { cx: fit.cx, cy: fit.cy, r: fit.r };
  await setLayers(page, { rings: false, atmosphere: false, stars: false, clouds: false });

  const pins = await page.evaluate(() => window.__globe!.pins());
  const inside = (x: number, y: number) => insideDisc(geom, x, y);

  const annulusMean = (img: Bitmap, cx: number, cy: number) =>
    annulus(img, cx, cy, 30, 60, inside);

  // pins ON
  await setLayers(page, { rings: false, atmosphere: false, stars: false, clouds: false, pins: true });
  const on = await capture(page);
  // pins OFF, twice
  await setLayers(page, { pins: false });
  const off = await capture(page);
  const off2 = await capture(page);
  await setLayers(page, { pins: true });

  const results: RingCastResult[] = [];
  for (const pin of pins) {
    const a = annulusMean(on, pin.x, pin.y);
    const b = annulusMean(off, pin.x, pin.y);
    const c = annulusMean(off2, pin.x, pin.y);
    if (a.count === 0 || b.count === 0) continue;
    const deltaPct = Math.abs((a.mean - b.mean) / b.mean) * 100;
    const noisePct = Math.abs((c.mean - b.mean) / b.mean) * 100;
    const allowedPct = Math.max(3, 1.5 * noisePct);

    /*
     * Validity. The annulus is meant to be SURFACE around the pin; if the pin sits near
     * or beyond the limb most of it is sky. pacific at az 0 projects to 1.100 R — outside
     * the disc entirely — and its annulus measured 1828 px against 8478 for an interior
     * pin, so its 20.4% "delta" was the sky changing, not cast light.
     *
     * The reference is the pixel count an interior pin yields; requiring 70% of that is
     * the same coverage idea as the probe-window rule.
     */
    const interiorCount = 8478; // measured for interior pins at 1280x800
    const annulusInsideFraction = a.count / interiorCount;
    const valid = annulusInsideFraction >= 0.7;
    const rPx = Math.hypot(pin.x - geom.cx, pin.y - geom.cy);
    results.push({
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
        : `annulus is only ${(annulusInsideFraction * 100).toFixed(1)}% surface (centre at ${(rPx / geom.r).toFixed(3)} R, ${rPx.toFixed(1)}px)`,
      pass: valid && deltaPct <= allowedPct,
    });
  }
  await writeResult('ring-cast', { geometry: geom, results });
  return { results, geometry: geom };
}
