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
import { isValidPin } from './pinValidity';
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

export interface GlareVerdict {
  clipped: number;
  largestBlob: number;
  blobCount: number;
  blobs: Array<{ size: number; w: number; h: number; cx: number; cy: number; rOverR: number }>;
  /** False when the frame carries no disc content, so the numbers mean nothing. */
  valid: boolean;
  invalidReason: string | null;
  pass: boolean;
}

/**
 * 3.2's rule as a PURE function of a bitmap.
 *
 * Split out from `measureGlare` so the negative suite can feed it a synthetic frame and
 * assert on the verdict object — the brief requires asserting the result, not catching a
 * throw.
 *
 * Input validity comes FIRST. An all-black frame has zero clipped pixels and zero blobs,
 * so it would "pass" the glare rule perfectly while measuring nothing at all. This is the
 * null-vs-null trap the whole spec family exists to avoid, and `N5` proves the guard
 * works by feeding exactly that frame.
 */
export function checkGlare(img: Bitmap, geom: DiscGeometry): GlareVerdict {
  const clipped = collectDiscPixels(img, geom, (r, g, b) => isClipped(r, g, b));
  const bright = collectDiscPixels(img, geom, (_r, _g, _b, l) => l >= 250);
  const blobs = labelBlobs(bright.points);

  // Is there a rendered disc at all? A frame that never drew has max luma 0, which makes
  // "0 clipped pixels" meaningless rather than clean.
  let sum = 0;
  let max = 0;
  let n = 0;
  const y0 = Math.max(0, Math.floor(geom.cy - geom.r));
  const y1 = Math.min(img.height - 1, Math.ceil(geom.cy + geom.r));
  const x0 = Math.max(0, Math.floor(geom.cx - geom.r));
  const x1 = Math.min(img.width - 1, Math.ceil(geom.cx + geom.r));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (!insideDisc(geom, x, y)) continue;
      const l = lumaAt(img, x, y);
      sum += l;
      if (l > max) max = l;
      n += 1;
    }
  }
  const mean = n ? sum / n : 0;

  let invalidReason: string | null = null;
  if (n === 0) invalidReason = 'no pixels inside the disc';
  else if (max === 0) invalidReason = `disc is entirely black (mean ${mean.toFixed(2)}, max ${max})`;
  else if (mean < 1) invalidReason = `disc mean luma ${mean.toFixed(4)} is indistinguishable from black`;

  const largestBlob = blobs.length ? blobs[0].size : 0;
  return {
    clipped: clipped.points.length,
    largestBlob,
    blobCount: blobs.length,
    blobs: blobs.slice(0, 8).map((b: Blob) => ({
      size: b.size,
      w: b.width,
      h: b.height,
      cx: Math.round(b.cx),
      cy: Math.round(b.cy),
      rOverR: +Math.hypot(b.cx - geom.cx, b.cy - geom.cy).toFixed(3) / geom.r,
    })),
    valid: invalidReason === null,
    invalidReason,
    // INVALID input cannot pass: a null measurement is not a clean one.
    pass: invalidReason === null && clipped.points.length === 0 && largestBlob <= 12,
  };
}

/** `checkGlare`'s verdict, re-exported under the name the specs and reports use. */
export type GlareResult = GlareVerdict;

/** 3.2 at one azimuth: capture, then apply `checkGlare`. */
export async function measureGlare(
  page: Page,
  azimuthDeg: number,
): Promise<{ result: GlareResult; geometry: DiscGeometry }> {
  await settleAt(page, azimuthDeg);
  await setLayers(page, { stars: false, pins: false, rings: false });
  const geom = await disc(page);
  const img = await capture(page);
  const verdict = checkGlare(img, geom);
  const result: GlareResult = verdict;
  return { result, geometry: geom };
}

// --------------------------------------------------------- specular mask (3.3)

export interface SpecularMaskResult {
  lookup(x: number, y: number): boolean;
  summary: {
    pixels: number;
    threshold: string;
    dilationPx: number;
    bbox: [number, number, number, number] | null;
    /** The specular state found at acquisition — proof that nothing was forced. */
    measuredWith: { intensity: number | null; overlay: boolean };
  };
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
  /*
   * AS SHIPPED, not forced.
   *
   * This used to call `specularIntensity(0.18)` before its "on" capture, which was correct
   * while 0.18 was the shipped value and silently wrong after 38aa091 set it to 0. The
   * consequence was measured: the "on" frame carried a material specular term the product
   * does not render, so the mask described the PRE-FIX glint — 105,313 px, wide enough to
   * excuse regions the shipped overlay never lights.
   *
   * The definition now has no override in it:
   *
   *     mask = |luma(F_as_shipped) - luma(F_all_specular_off)| > 3, dilated 8 px
   *
   * `F_as_shipped` is read, not written: whatever `__look.specularIntensity()` reports at
   * acquisition is the state captured, and the report says so. `F_all_specular_off` is that
   * same state with the overlay flag false and the intensity at 0.
   *
   * The mask is computed BEFORE any defect is installed and the committed state is restored
   * afterwards, so a negative test can never widen the mask it is about to be judged by.
   */
  const shipped = await page.evaluate(() => ({
    intensity: window.__look!.specularIntensity(),
    overlay: Boolean(window.__globe!.lookFlags().specular),
  }));

  await setLayers(page, { stars: false, pins: false, rings: false });

  // ON: the look exactly as found — no value is set here.
  const on = await capture(page);

  // OFF: both specular paths disabled, same flags, same frozen clock.
  await page.evaluate(() => {
    window.__look!.specularIntensity(0);
    window.__globe!.setLookFlags({ specular: false });
  });
  const off = await capture(page);

  // Restore the state that was found, not a hardcoded guess.
  await page.evaluate(
    (state: { intensity: number | null; overlay: boolean }) => {
      window.__look!.specularIntensity(state.intensity ?? 0);
      window.__globe!.setLookFlags({ specular: state.overlay });
    },
    shipped,
  );
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
      /** The state the mask was measured in, so a report can prove no override was applied. */
      measuredWith: shipped,
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
  glintMask: SpecularMaskResult['summary'];
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

  // Loops, not spreads: `lines` is bounded at 5 but the pattern is the one that blew the
  // stack in `labelBlobs`, and a bound that lives only in a caller's head is not a bound.
  let tMin = Infinity;
  let tMax = -Infinity;
  for (const l of lines) {
    if (l[0].t < tMin) tMin = l[0].t;
    if (l[l.length - 1].t > tMax) tMax = l[l.length - 1].t;
  }
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

  // Same reasoning: `windowed` is a slice of the terminator profile, i.e. pixel-derived.
  let hi = -Infinity;
  let lo = Infinity;
  for (const p2 of windowed) {
    if (p2.luma > hi) hi = p2.luma;
    if (p2.luma < lo) lo = p2.luma;
  }
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

export interface PinCoreSample {
  /** Per-pixel RGB inside the core region. */
  pixels: Array<[number, number, number]>;
  /** Median RGB. */
  median: [number, number, number];
  /** Median Rec.709 luma of the core pixels. */
  medianLuma: number;
  /** Median HSV-style saturation (max-min)/max. */
  medianSaturation: number;
  /** Pixels with min(R,G,B) >= 250. */
  blownPx: number;
  count: number;
}

export interface PinGateResult {
  az: number;
  id: string;
  x: number;
  y: number;
  /** Radius of the core region in px. */
  coreRadiusPx: number;
  /** r/R of the pin's projected CORE. */
  rOverR: number;
  /** Surface normal · camera direction. */
  facingDot: number;
  /** Surface normal · sun direction. */
  sunDot: number;
  side: 'day' | 'night' | 'terminator';
  valid: boolean;
  validityReason: string;
  sample: PinCoreSample | null;
  /** Gate outcomes (null when the pin is invalid). */
  gates: { P1: boolean; P2: boolean; P3: boolean; P4: boolean } | null;
}

/**
 * 3.5 — pin cores as a SEMANTIC gate, not a colour window.
 *
 * The hardcoded RGB windows are RETIRED, both the original brief's
 * (255,255,158..172) / (240,238,123)..(255,255,150) and the 2A4 "measured" 185/182.
 * B0 showed the render is byte-identical across eleven commits while those windows moved,
 * which means the windows were never describing the render — they were describing whatever
 * sampling happened to be used the day they were written. A gate that changes when the
 * measurement changes is not a gate.
 *
 * What the look actually INTENDS is stated instead: the core must be **not black, not
 * blown out, and still amber-tinted**. Those are four semantic predicates:
 *
 *   P1  median core luma >= 180          — visible against ocean, cloud and terminator
 *   P2  no pixel with min(R,G,B) >= 250  — the core is never a white blowout
 *   P3  median saturation >= 0.15        — still tinted, not grey (R=255 => B <= 217)
 *   P4  median R >= 240, G >= 200, B <= G — the amber ordering, not just any bright pixel
 *
 * The measured medians are printed as INFORMATION so a drift is visible without a threshold
 * having to be invented for it.
 *
 * Core region: pixels within 0.6 x r_core_px of the projected centre, where r_core_px is
 * the projected radius of the core sphere (measured by projecting a point offset by the
 * core's world radius), floored at a 3x3 box so a small viewport still samples something.
 */
export interface PinCoreOptions {
  /** Fraction of the core's projected radius to sample. */
  coreFrac?: number;
  /** Minimum sample count before a pin is judged. */
  minSamples?: number;
  /** Reject pins whose projected core is outside this r/R. */
  maxROverR?: number;
  /** Reject pins facing away from the camera by less than this. */
  minFacingDot?: number;
}

export async function measurePinGates(
  page: Page,
  azimuthDeg: number,
  opts: PinCoreOptions = {},
): Promise<{ results: PinGateResult[]; geometry: DiscGeometry }> {
  const { coreFrac = 0.6, minSamples = 5, maxROverR = 0.97, minFacingDot = 0.1 } = opts;

  await settleAt(page, azimuthDeg);
  await setLayers(page, { stars: false, rings: false, pins: true, atmosphere: true, clouds: true });

  const fit = await fitLimb(page);
  if (!Number.isFinite(fit.r)) throw new Error('measurePinGates: limb fit produced no circle');
  const geom: DiscGeometry = { cx: fit.cx, cy: fit.cy, r: fit.r };

  await setLayers(page, { stars: false, rings: false, pins: true, atmosphere: true, clouds: true });
  const img = await capture(page);

  const data = await page.evaluate(
    ({ coreFrac: cf }) => {
      const anchors = window.__globe!.pinAnchors();
      const pins = window.__globe!.pins();
      const cam = window.__camera as { position: { x: number; y: number; z: number } };
      const cl = Math.hypot(cam.position.x, cam.position.y, cam.position.z) || 1;
      const camDir = [cam.position.x / cl, cam.position.y / cl, cam.position.z / cl];

      let sun: number[] = [0.72, 0.36, 0.59];
      (window.__scene as { traverse(fn: (o: unknown) => void): void }).traverse((o) => {
        const l = o as { isDirectionalLight?: boolean; intensity?: number; position?: { x: number; y: number; z: number } };
        if (l.isDirectionalLight && (l.intensity ?? 0) > 1 && l.position) {
          sun = [l.position.x, l.position.y, l.position.z];
        }
      });
      const sl = Math.hypot(sun[0], sun[1], sun[2]) || 1;
      const sunDir = [sun[0] / sl, sun[1] / sl, sun[2] / sl];

      return pins.map((p) => {
        const a = anchors.find((x) => x.id === p.id);
        const w: [number, number, number] = a ? a.world : [0, 0, 0];
        const len = Math.hypot(w[0], w[1], w[2]) || 1;
        const n: [number, number, number] = [w[0] / len, w[1] / len, w[2] / len];
        /*
         * The core sphere's projected radius, from the geometry that actually draws it.
         *
         * `Hotspot.tsx` gives the core `<sphereGeometry args={[0.011, 16, 16]} />` (0.016
         * when active), so the core's world radius is 0.011 — NOT its offset from the
         * surface (0.055). Using the offset made the region 5x too large and every median
         * came back as the dark housing around the core: (76,71,61) at luma 71.6, which
         * reads as "the pin is black" when the pin is fine.
         */
        const coreWorldR = 0.011;
        const side = Math.hypot(n[1], n[2], n[0]);
        void side;
        const perp: [number, number, number] = [n[2], 0, -n[0]];
        const pl = Math.hypot(perp[0], perp[1], perp[2]) || 1;
        const off: [number, number, number] = [
          w[0] + (perp[0] / pl) * coreWorldR,
          w[1] + (perp[1] / pl) * coreWorldR,
          w[2] + (perp[2] / pl) * coreWorldR,
        ];
        const p0 = window.__globe!.project(w);
        const p1 = window.__globe!.project(off);
        const rCore = Math.max(1.5, Math.hypot(p1.x - p0.x, p1.y - p0.y));
        return {
          id: p.id,
          x: p.x,
          y: p.y,
          facingDot: n[0] * camDir[0] + n[1] * camDir[1] + n[2] * camDir[2],
          sunDot: n[0] * sunDir[0] + n[1] * sunDir[1] + n[2] * sunDir[2],
          coreRadiusPx: Math.max(1.5, rCore * cf),
        };
      });
    },
    { coreFrac },
  );

  const results: PinGateResult[] = [];
  for (const d of data) {
    const rOverR = Math.hypot(d.x - geom.cx, d.y - geom.cy) / geom.r;
    const side: 'day' | 'night' | 'terminator' =
      d.sunDot > 0.2 ? 'day' : d.sunDot < -0.1 ? 'night' : 'terminator';

    // Collect the core region.
    const pixels: Array<[number, number, number]> = [];
    const rr = d.coreRadiusPx;
    for (let y = Math.floor(d.y - rr); y <= Math.ceil(d.y + rr); y += 1) {
      for (let x = Math.floor(d.x - rr); x <= Math.ceil(d.x + rr); x += 1) {
        if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
        if ((x - d.x) ** 2 + (y - d.y) ** 2 > rr * rr) continue;
        const o = (y * img.width + x) * 4;
        pixels.push([img.data[o], img.data[o + 1], img.data[o + 2]]);
      }
    }

    // Validity comes FIRST: an invalid pin is listed, never counted as a pass.
    let validityReason = 'valid';
    if (d.facingDot < minFacingDot) validityReason = `faces away (normal·camDir ${d.facingDot.toFixed(3)} < ${minFacingDot})`;
    else if (rOverR > maxROverR) validityReason = `projected core at ${rOverR.toFixed(3)} R > ${maxROverR}`;
    else if (pixels.length < minSamples) validityReason = `only ${pixels.length} core samples (min ${minSamples})`;
    const valid = validityReason === 'valid';

    let sample: PinCoreSample | null = null;
    let gates: PinGateResult['gates'] = null;
    if (valid) {
      const med = (v: number[]) => median(v);
      const r = med(pixels.map((p) => p[0]));
      const g = med(pixels.map((p) => p[1]));
      const b = med(pixels.map((p) => p[2]));
      /*
       * Saturation by loop over each pixel's three channels.
       *
       * The spread here is over ONE RGB triple, so it is safe — but `pixels` itself is a
       * core region whose size is only bounded by the pin's projected radius, and the same
       * pattern one line away would be over ~1 M values. Looping removes the question.
       */
      const sat = pixels.map((p) => {
        let mx = p[0];
        let mn = p[0];
        for (let i = 1; i < p.length; i += 1) {
          if (p[i] > mx) mx = p[i];
          if (p[i] < mn) mn = p[i];
        }
        return mx === 0 ? 0 : (mx - mn) / mx;
      });
      sample = {
        pixels,
        median: [r, g, b],
        medianLuma: med(pixels.map((p) => luma(p[0], p[1], p[2]))),
        medianSaturation: med(sat),
        blownPx: pixels.filter((p) => p[0] >= 250 && p[1] >= 250 && p[2] >= 250).length,
        count: pixels.length,
      };
      gates = {
        P1: sample.medianLuma >= 180,
        P2: sample.blownPx === 0,
        P3: sample.medianSaturation >= 0.15,
        P4: r >= 240 && g >= 200 && b <= g,
      };
    }

    results.push({
      az: azimuthDeg,
      id: d.id,
      x: +d.x.toFixed(2),
      y: +d.y.toFixed(2),
      coreRadiusPx: +d.coreRadiusPx.toFixed(2),
      rOverR: +rOverR.toFixed(4),
      facingDot: +d.facingDot.toFixed(4),
      sunDot: +d.sunDot.toFixed(4),
      side,
      valid,
      validityReason,
      sample: sample
        ? { ...sample, pixels: sample.pixels.slice(0, 0) } // don't serialise every pixel
        : null,
      gates,
    });
  }

  await writeResult(`pin-gates-az${azimuthDeg}`, { geometry: geom, results });
  return { results, geometry: geom };
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
  /** Fraction of the 30..60 px annulus that lies inside the disc. Reported, not a rule. */
  annulusInsideFraction: number;
  /** Projected core r/R — an input to the SHARED validity rule. */
  rOverR: number;
  /** normal·camDir — the other input. */
  facingDot: number;
  /** False when `isValidPin` rejects the pin or its annulus is not mostly surface. */
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
  /**
   * Optional hook that runs AFTER the limb fit and BEFORE the captures.
   *
   * Exists for the negative suite. `fitLimb` swaps the surface to unlit white and restores
   * it, and the restore's material rebuild recompiles the shader — compiling the light
   * count in. A light injected before this point is present in the scene graph and
   * completely inert on screen (measured: 0.002% delta with lights 3 -> 4), so the negative
   * test would "fail" against a check that was working correctly.
   */
  { afterFit }: { afterFit?: () => Promise<void> } = {},
): Promise<{ results: RingCastResult[]; geometry: DiscGeometry }> {
  await settleAt(page, 0);
  await setLayers(page, { rings: false, atmosphere: false, stars: false, clouds: false });

  const fit = await fitLimb(page);
  if (!Number.isFinite(fit.r)) throw new Error('measureRingCast: limb fit produced no circle');
  const geom: DiscGeometry = { cx: fit.cx, cy: fit.cy, r: fit.r };
  await setLayers(page, { rings: false, atmosphere: false, stars: false, clouds: false });

  if (afterFit) await afterFit();

  /*
   * Pin geometry for the SHARED rule. `__globe.pins()` gives the screen position and a
   * boolean `facing`; 3.6 needs the numbers, so they are resolved here the same way
   * `measurePinGates` and the negative suite do — anchors -> world normal -> n·cam, and
   * the projected core distance over the FITTED radius.
   *
   * `facing` (a boolean with a 0.06 threshold) is deliberately NOT used: the rule's
   * threshold is 0.1 and it must come from one place.
   */
  const pinData = await page.evaluate((g: { cx: number; cy: number; r: number }) => {
    const anchors = window.__globe!.pinAnchors();
    const list = window.__globe!.pins();
    const cam = window.__camera as { position: { x: number; y: number; z: number } };
    const cl = Math.hypot(cam.position.x, cam.position.y, cam.position.z) || 1;
    const camDir = [cam.position.x / cl, cam.position.y / cl, cam.position.z / cl];
    return list.map((p) => {
      const a = anchors.find((x) => x.id === p.id);
      const w: [number, number, number] = a ? a.world : [0, 0, 0];
      const len = Math.hypot(w[0], w[1], w[2]) || 1;
      const n: [number, number, number] = [w[0] / len, w[1] / len, w[2] / len];
      return {
        id: p.id,
        x: p.x,
        y: p.y,
        facingDot: n[0] * camDir[0] + n[1] * camDir[1] + n[2] * camDir[2],
        rOverR: Math.hypot(p.x - g.cx, p.y - g.cy) / g.r,
      };
    });
  }, geom);
  const pins = pinData;
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
     * Validity, from ONE rule shared with 3.5 and the negative suite (`isValidPin`):
     * front-facing AND projected core inside the limb AND enough annulus on the surface.
     *
     * The coverage term stays because a pin can satisfy the geometric rule and still have
     * its 30–60 px annulus straddle the limb. What is gone is coverage ALONE, which called
     * horn-africa valid at az 0 (n·cam −0.5747, facing away) and sent the first N1 attempt
     * looking for cast light on the far side of the globe.
     */
    const interiorCount = 8478; // measured for interior pins at 1280x800
    const annulusInsideFraction = a.count / interiorCount;
    const coverageOk = annulusInsideFraction >= 0.7;
    const verdict = isValidPin(pin);
    const valid = verdict.valid && coverageOk;
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
      rOverR: +pin.rOverR.toFixed(4),
      facingDot: +pin.facingDot.toFixed(4),
      valid,
      validityReason: !verdict.valid
        ? verdict.reason
        : coverageOk
          ? 'valid'
          : `annulus is only ${(annulusInsideFraction * 100).toFixed(1)}% surface`,
      pass: valid && deltaPct <= allowedPct,
    });
  }
  await writeResult('ring-cast', { geometry: geom, results });
  return { results, geometry: geom };
}
