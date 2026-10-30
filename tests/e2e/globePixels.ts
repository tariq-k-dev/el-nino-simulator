/**
 * Pixel measurements for the globe look rules.
 *
 * Every 3B-1 acceptance rule is a statement about rendered pixels — "clipped
 * pixels are <= 0.05% of the disc", "night side is < 25% of the day side",
 * "the largest step along a radial profile is <= 6/255". None of that is
 * visible to the DOM, so the specs decode screenshots here rather than trusting
 * a CSS assertion to stand in for a look.
 *
 * All coordinates are CSS pixels. Playwright's desktop context runs at
 * deviceScaleFactor 1, and the canvas' own devicePixelRatio affects only the
 * drawing buffer, not the composited screenshot — so one screenshot pixel is one
 * CSS pixel and these radii can be compared directly against `__globe.project()`.
 */
import { PNG } from 'pngjs';

export interface Bitmap {
  width: number;
  height: number;
  /** RGBA, row-major, 4 bytes per pixel. */
  data: Uint8Array;
}

export function decodePng(buffer: Buffer): Bitmap {
  const png = PNG.sync.read(buffer);
  return {
    width: png.width,
    height: png.height,
    data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength),
  };
}

/**
 * Rec. 709 relative luminance on the 0-255 scale.
 *
 * The coefficients are the sRGB ones because the screenshot is already
 * display-referred: gamma-encoded values as the eye receives them. Linearising
 * first would be more correct for a *physical* energy comparison but would make
 * "clipped" and "step of 6/255" meaningless, and those thresholds are stated in
 * display values.
 */
export function lum(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function pixelAt(img: Bitmap, x: number, y: number): { r: number; g: number; b: number } {
  const ix = Math.round(x);
  const iy = Math.round(y);
  const clampedX = Math.min(img.width - 1, Math.max(0, ix));
  const clampedY = Math.min(img.height - 1, Math.max(0, iy));
  const o = (clampedY * img.width + clampedX) * 4;
  return { r: img.data[o], g: img.data[o + 1], b: img.data[o + 2] };
}

export function lumAt(img: Bitmap, x: number, y: number): number {
  const p = pixelAt(img, x, y);
  return lum(p.r, p.g, p.b);
}

/**
 * Fraction of the disc whose pixels are clipped.
 *
 * "Clipped" is R, G and B all >= 250 — all three channels simultaneously, so a
 * saturated but legitimately colourful pin does not count. A pixel with a blown
 * single channel is a colour, not a glare patch.
 *
 * `exclude` holds circles that are allowed to be bright (the pins: they are the
 * UI's affordance and are meant to read as lights). Being outside them is what
 * makes this a test of the *surface*, not of the markers.
 */
export function clippedFraction(
  img: Bitmap,
  cx: number,
  cy: number,
  radius: number,
  exclude: Array<{ x: number; y: number; r: number }> = [],
  threshold = 250,
): { clipped: number; total: number; fraction: number } {
  let clipped = 0;
  let total = 0;
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(img.width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(img.height - 1, Math.ceil(cy + radius));

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;

      let skip = false;
      for (const e of exclude) {
        const ex = x - e.x;
        const ey = y - e.y;
        if (ex * ex + ey * ey <= e.r * e.r) {
          skip = true;
          break;
        }
      }
      if (skip) continue;

      total += 1;
      const o = (y * img.width + x) * 4;
      if (img.data[o] >= threshold && img.data[o + 1] >= threshold && img.data[o + 2] >= threshold) {
        clipped += 1;
      }
    }
  }
  return { clipped, total, fraction: total === 0 ? 0 : clipped / total };
}

/** Mean luminance inside an annulus (used for day/night halves and haze). */
export function annulusMean(
  img: Bitmap,
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  half?: (x: number, y: number) => boolean,
): number {
  let sum = 0;
  let count = 0;
  const x0 = Math.max(0, Math.floor(cx - rOuter));
  const x1 = Math.min(img.width - 1, Math.ceil(cx + rOuter));
  const y0 = Math.max(0, Math.floor(cy - rOuter));
  const y1 = Math.min(img.height - 1, Math.ceil(cy + rOuter));

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < rInner * rInner || d2 > rOuter * rOuter) continue;
      if (half && !half(x, y)) continue;
      sum += lumAt(img, x, y);
      count += 1;
    }
  }
  return count === 0 ? 0 : sum / count;
}

/**
 * A radial luminance profile, one sample per whole pixel of radius.
 *
 * Nearest-pixel sampling rather than bilinear: the acceptance rule is about
 * *adjacent visible pixels*, so a smoothed sample would hide exactly the step
 * being tested.
 */
export function radialProfile(
  img: Bitmap,
  cx: number,
  cy: number,
  angleRad: number,
  rFrom: number,
  rTo: number,
): number[] {
  const out: number[] = [];
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const start = Math.max(0, Math.ceil(rFrom));
  const end = Math.floor(rTo);
  for (let r = start; r <= end; r += 1) {
    out.push(lumAt(img, cx + cos * r, cy + sin * r));
  }
  return out;
}

/** Per-pixel differences between two equally-shaped profiles. */
export function profileDelta(a: number[], b: number[]): number[] {
  const n = Math.min(a.length, b.length);
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) out.push(a[i] - b[i]);
  return out;
}

/**
 * Statistics for a circular patch: mean luminance, clipped share, and the
 * channel spread that distinguishes a saturated colour from a white blob.
 *
 * `spread` is max(R,G,B) - min(R,G,B) averaged over pixels. A pure-white blob
 * has spread ~0 by definition; an amber pin has a large one. That is the
 * measurable content of "the pin core is not a flat pure-white blob".
 */
export function patchStats(
  img: Bitmap,
  cx: number,
  cy: number,
  radius: number,
): { mean: number; max: number; spread: number; whiteShare: number; count: number } {
  let sum = 0;
  let max = 0;
  let spread = 0;
  let white = 0;
  let count = 0;
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(img.width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(img.height - 1, Math.ceil(cy + radius));

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      const p = pixelAt(img, x, y);
      const l = lum(p.r, p.g, p.b);
      sum += l;
      max = Math.max(max, l);
      spread += Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b);
      if (p.r >= 245 && p.g >= 245 && p.b >= 245) white += 1;
      count += 1;
    }
  }
  return {
    mean: count === 0 ? 0 : sum / count,
    max,
    spread: count === 0 ? 0 : spread / count,
    whiteShare: count === 0 ? 0 : white / count,
    count,
  };
}

/** Bounding box of pixels brighter than `threshold`, for locating a glow. */
export function brightRegion(
  img: Bitmap,
  threshold: number,
  within?: { cx: number; cy: number; r: number },
): { x0: number; y0: number; x1: number; y1: number; count: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let count = 0;
  const r2 = within ? within.r * within.r : Infinity;

  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      if (within) {
        const dx = x - within.cx;
        const dy = y - within.cy;
        if (dx * dx + dy * dy > r2) continue;
      }
      if (lumAt(img, x, y) < threshold) continue;
      count += 1;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return { x0, y0, x1, y1, count };
}
