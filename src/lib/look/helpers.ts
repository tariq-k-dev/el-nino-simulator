/**
 * Shared measurement helpers for the globe look specs.
 *
 * These exist because the LOOK2/CLOSE-A work accumulated seven throwaway
 * `globe-*.mjs` scripts that each re-implemented luma, blob labelling and ray
 * sampling slightly differently — and that divergence is *how* two attribution
 * errors and one sampling-range error got published as fact. One implementation,
 * unit-tested against synthetic images, is the fix for the class of bug.
 *
 * Everything here is PURE except `capture()` and `hideChrome()`, which need a
 * page, and every pure function is covered by `helpers.test.ts`.
 *
 * Coordinate convention: all positions are CSS pixels from the viewport's
 * top-left, matching `__globe.project()`. The viewport is fixed at 1280x800 and
 * Playwright's desktop context runs at deviceScaleFactor 1, so one screenshot
 * pixel is one CSS pixel.
 */
import { PNG } from 'pngjs';

/** The one viewport every look spec uses. Documented here, not per-spec. */
export const VIEWPORT = { width: 1280, height: 800 } as const;

export interface Bitmap {
  width: number;
  height: number;
  /** RGBA, row-major, 4 bytes per pixel. */
  data: Buffer | Uint8Array;
}

export interface DiscGeometry {
  cx: number;
  cy: number;
  r: number;
}

// --------------------------------------------------------------------------- luma

/**
 * Rec. 709 luma on the 0-255 display scale.
 *
 * The screenshot is display-referred (gamma-encoded), and every threshold in the
 * look rules is stated in display values — "clipped means >= 250", "step <= 6/255".
 * Linearising first would be more physically correct and would make those
 * thresholds meaningless.
 */
export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function pixelAt(img: Bitmap, x: number, y: number): { r: number; g: number; b: number } {
  const ix = Math.min(img.width - 1, Math.max(0, Math.round(x)));
  const iy = Math.min(img.height - 1, Math.max(0, Math.round(y)));
  const o = (iy * img.width + ix) * 4;
  return { r: img.data[o], g: img.data[o + 1], b: img.data[o + 2] };
}

export function lumaAt(img: Bitmap, x: number, y: number): number {
  const p = pixelAt(img, x, y);
  return luma(p.r, p.g, p.b);
}

/** True when every channel is >= threshold — a blown pixel, not just a bright one. */
export function isClipped(r: number, g: number, b: number, threshold = 250): boolean {
  return r >= threshold && g >= threshold && b >= threshold;
}

// ------------------------------------------------------------------- geometry

export function insideDisc(geom: DiscGeometry, x: number, y: number, scale = 1): boolean {
  const dx = x - geom.cx;
  const dy = y - geom.cy;
  const r = geom.r * scale;
  return dx * dx + dy * dy <= r * r;
}

/** Orthonormal camera basis: forward `f`, then right `u` and up `v`. */
export function cameraBasis(f: [number, number, number]): {
  f: [number, number, number];
  u: [number, number, number];
  v: [number, number, number];
} {
  const fn = norm3(f);
  const worldUp: [number, number, number] = [0, 1, 0];
  let u = cross3(worldUp, fn);
  if (Math.hypot(u[0], u[1], u[2]) < 1e-6) u = cross3([1, 0, 0], fn);
  u = norm3(u);
  const v = norm3(cross3(fn, u));
  return { f: fn, u, v };
}

function norm3(a: [number, number, number]): [number, number, number] {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
}

function cross3(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Signed screen distance from a world-space direction, along the sun's screen axis. */
export function sunScreenAxis(
  sun: [number, number, number],
  cam: [number, number, number],
): { ax: number; ay: number } {
  const { u, v } = cameraBasis(norm3(cam));
  const s = norm3(sun);
  const su = s[0] * u[0] + s[1] * u[1] + s[2] * u[2];
  const sv = s[0] * v[0] + s[1] * v[1] + s[2] * v[2];
  const n = Math.hypot(su, sv) || 1;
  return { ax: su / n, ay: -sv / n };
}

// ------------------------------------------------------------------ sampling

/**
 * Luma samples along a circle at radius `r` around (cx, cy).
 *
 * `n` samples at even angular spacing, starting at `phase`. Nearest-pixel
 * sampling, deliberately: the acceptance rules talk about *visible adjacent
 * pixels*, so a smoothed sample would hide the step being measured.
 */
export function raySamples(
  img: Bitmap,
  cx: number,
  cy: number,
  r: number,
  n = 16,
  phase = 0,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const th = phase + (i / n) * Math.PI * 2;
    out.push(lumaAt(img, cx + Math.cos(th) * r, cy + Math.sin(th) * r));
  }
  return out;
}

/**
 * A single radial profile, one sample per whole pixel of radius.
 *
 * Returns `{ r, luma }` pairs so a spec can report the raw profile rather than
 * just a verdict — which is the whole point of the "report raw tables" rule.
 */
export function radialProfile(
  img: Bitmap,
  cx: number,
  cy: number,
  angleRad: number,
  rFrom: number,
  rTo: number,
): Array<{ r: number; luma: number }> {
  const out: Array<{ r: number; luma: number }> = [];
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  for (let r = Math.ceil(rFrom); r <= Math.floor(rTo); r += 1) {
    out.push({ r, luma: lumaAt(img, cx + cos * r, cy + sin * r) });
  }
  return out;
}

/** Mean luma inside an annulus, optionally filtered by a predicate. */
export function annulus(
  img: Bitmap,
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  keep?: (x: number, y: number) => boolean,
): { mean: number; count: number } {
  let sum = 0;
  let count = 0;
  const x0 = Math.max(0, Math.floor(cx - rOuter));
  const x1 = Math.min(img.width - 1, Math.ceil(cx + rOuter));
  const y0 = Math.max(0, Math.floor(cy - rOuter));
  const y1 = Math.min(img.height - 1, Math.ceil(cy + rOuter));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (d2 < rInner * rInner || d2 > rOuter * rOuter) continue;
      if (keep && !keep(x, y)) continue;
      sum += lumaAt(img, x, y);
      count += 1;
    }
  }
  return { mean: count ? sum / count : NaN, count };
}

/** Median of a numeric array. Mutates nothing; returns NaN on empty. */
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Percentile in [0,1], linear interpolation. NaN on empty. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, p * (s.length - 1)));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

/**
 * Width of the transition between `highLevel` and `lowLevel`.
 *
 * Direction-aware, because the naive version is wrong in a silent way: searching
 * for "the first index at or above `highLevel`" returns index 0 whenever the
 * profile *starts* high, so a 25 px ramp was reported as 90 px — an error in the
 * direction that makes a hard edge look soft and lets a bad terminator pass.
 *
 * The direction is taken from the endpoints: a descending profile (day -> night) is
 * scanned high-to-low, an ascending one low-to-high. Each crossing is interpolated
 * for sub-sample precision.
 *
 * Returns null when either level is never crossed, so a caller must decide whether
 * that is a measurement failure or a genuine absence of transition — never 0.
 */
export function transitionWidth(
  profile: Array<{ r: number; luma: number }>,
  highLevel: number,
  lowLevel: number,
): { width: number; iHigh: number; iLow: number } | null {
  if (profile.length < 2) return null;
  const descending = profile[0].luma >= profile[profile.length - 1].luma;
  // Normalise to a descending scan by reversing an ascending profile.
  const p = descending ? profile : [...profile].reverse();

  let iHigh = -1;
  let iLow = -1;
  for (let i = 0; i < p.length; i += 1) {
    if (iHigh < 0 && p[i].luma <= highLevel) iHigh = i;
    if (iHigh >= 0 && p[i].luma <= lowLevel) {
      iLow = i;
      break;
    }
  }
  if (iHigh < 0 || iLow < 0) return null;

  const crossing = (i: number, level: number): number => {
    if (i === 0) return p[0].r;
    const a = p[i - 1];
    const b = p[i];
    const denom = b.luma - a.luma;
    if (Math.abs(denom) < 1e-9) return b.r;
    return a.r + (b.r - a.r) * ((level - a.luma) / denom);
  };

  const rHigh = crossing(iHigh, highLevel);
  const rLow = crossing(iLow, lowLevel);
  // Map the reversed indices back so the caller can locate the crossing.
  const back = (i: number) => (descending ? i : profile.length - 1 - i);
  return { width: Math.abs(rLow - rHigh), iHigh: back(iHigh), iLow: back(iLow) };
}

// -------------------------------------------------------------------- blobs

export interface Blob {
  size: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
}

/**
 * 8-connected blob labelling over a set of pixel coordinates.
 *
 * 8-connectivity (diagonals join) is what the look rules specify, and it is the
 * stricter choice for "largest blob <= 12 px": diagonal joins make blobs BIGGER, so
 * a threshold validated under 8-connectivity is also valid under 4.
 */
export function labelBlobs(points: Array<[number, number]>): Blob[] {
  const set = new Set(points.map(([x, y]) => `${x},${y}`));
  const seen = new Set<string>();
  const blobs: Blob[] = [];

  for (const [px, py] of points) {
    const key = `${px},${py}`;
    if (seen.has(key)) continue;
    const stack: Array<[number, number]> = [[px, py]];
    seen.add(key);
    const comp: Array<[number, number]> = [];
    while (stack.length) {
      const [x, y] = stack.pop()!;
      comp.push([x, y]);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          if (dx === 0 && dy === 0) continue;
          const k = `${x + dx},${y + dy}`;
          if (set.has(k) && !seen.has(k)) {
            seen.add(k);
            stack.push([x + dx, y + dy]);
          }
        }
      }
    }
    const xs = comp.map((c) => c[0]);
    const ys = comp.map((c) => c[1]);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    blobs.push({
      size: comp.length,
      x0,
      x1,
      y0,
      y1,
      cx: xs.reduce((a, b) => a + b, 0) / comp.length,
      cy: ys.reduce((a, b) => a + b, 0) / comp.length,
      width: x1 - x0 + 1,
      height: y1 - y0 + 1,
    });
  }
  return blobs.sort((a, b) => b.size - a.size);
}

/** Pixels inside the disc matching a predicate, as coordinates. */
export function collectDiscPixels(
  img: Bitmap,
  geom: DiscGeometry,
  predicate: (r: number, g: number, b: number, l: number) => boolean,
  exclude: Array<{ x: number; y: number; r: number }> = [],
  discScale = 1,
): { points: Array<[number, number]>; total: number } {
  const points: Array<[number, number]> = [];
  let total = 0;
  for (let y = Math.max(0, Math.floor(geom.cy - geom.r * discScale)); y <= Math.min(img.height - 1, Math.ceil(geom.cy + geom.r * discScale)); y += 1) {
    for (let x = Math.max(0, Math.floor(geom.cx - geom.r * discScale)); x <= Math.min(img.width - 1, Math.ceil(geom.cx + geom.r * discScale)); x += 1) {
      if (!insideDisc(geom, x, y, discScale)) continue;
      if (exclude.some((e) => (x - e.x) ** 2 + (y - e.y) ** 2 <= e.r * e.r)) continue;
      total += 1;
      const p = pixelAt(img, x, y);
      if (predicate(p.r, p.g, p.b, luma(p.r, p.g, p.b))) points.push([x, y]);
    }
  }
  return { points, total };
}

/**
 * Separable Gaussian blur of the luma channel, `sigma` in pixels.
 *
 * The blue-circle guard measures a *soft* local peak, so it must blur first or a
 * single cloud pixel decides the result. Returns a new Float32Array of luma.
 */
export function blurLuma(img: Bitmap, sigma: number): Float32Array {
  const { width: w, height: h } = img;
  const src = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) src[y * w + x] = lumaAt(img, x, y);
  }
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i += 1) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < kernel.length; i += 1) kernel[i] /= sum;

  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let acc = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        acc += src[y * w + xx] * kernel[k + radius];
      }
      tmp[y * w + x] = acc;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let acc = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        acc += tmp[yy * w + x] * kernel[k + radius];
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

/** Mean absolute difference between two equal-length buffers. NaN on mismatch. */
export function meanAbsDiff(a: Float32Array | number[], b: Float32Array | number[]): number {
  if (a.length !== b.length || a.length === 0) return NaN;
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

// ---------------------------------------------------------------- limb fitting

/**
 * Focal length in pixels for a vertical FOV.
 *
 * `fov` is three.js's VERTICAL field of view, so the height is what converts it to
 * pixels. Using the width here is the classic silent error: it returns a focal
 * ~1.6x too large at 1280x800 and the disc then "measures" 500 px.
 */
export function focalPxFromFov(fovDeg: number, heightPx: number): number {
  return heightPx / 2 / Math.tan((fovDeg * Math.PI) / 180 / 2);
}

/**
 * Apparent radius of a sphere, perspective-EXACT.
 *
 * The silhouette is where the view ray is tangent to the sphere, so
 * `sin(theta) = R / d` and the pixel radius is `tan(theta) * focal`. Algebraically
 * that equals `focal * R / sqrt(d^2 - R^2)`; both forms are the same number and
 * the closed form is used here because it avoids the asin/tan round trip.
 */
export function discRadiusTangentPx(R: number, d: number, focalPx: number): number {
  const denom = d * d - R * R;
  if (denom <= 0) return NaN; // camera at or inside the surface: no silhouette
  return (focalPx * R) / Math.sqrt(denom);
}

/** The small-angle / naive form `focal * R / d`. Understates the disc near the limb. */
export function discRadiusNaivePx(R: number, d: number, focalPx: number): number {
  if (d <= 0) return NaN;
  return (focalPx * R) / d;
}

/**
 * Bilinear luma sample.
 *
 * Needed for the limb fit: the edge crossing is located BETWEEN pixels, and
 * nearest-neighbour sampling quantises every ray's edge to a whole pixel, which
 * turns a sub-pixel circle fit into a ±0.5 px staircase.
 */
export function bilinearLuma(img: Bitmap, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (ix: number, iy: number) => {
    const cx = Math.min(img.width - 1, Math.max(0, ix));
    const cy = Math.min(img.height - 1, Math.max(0, iy));
    const o = (cy * img.width + cx) * 4;
    return luma(img.data[o], img.data[o + 1], img.data[o + 2]);
  };
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bot = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bot * fy;
}

export interface EdgeCrossing {
  /** Distance from the centre along the ray, in px, interpolated to sub-pixel. */
  radius: number;
  /** Luma level the crossing was taken at (the 50% midpoint). */
  level: number;
  /** Mean luma of the 4 px just inside the edge. */
  innerLevel: number;
  /** Mean luma of the far background outside the edge. */
  outerLevel: number;
}

/**
 * Sub-pixel edge crossing along one ray.
 *
 * Definition, as specified for the limb ground truth: walk outward from the
 * centre, find the steepest fall in luma inside `[rGuess-span, rGuess+span]`, take
 * the inner level as the mean of the 4 px just inside that fall and the outer level
 * as the background further out, then interpolate the 50% crossing linearly
 * between the two straddling samples.
 *
 * Why the 4-px inner mean rather than the peak: a single pixel at the limb is
 * itself a partial-coverage pixel, so using it as the "inside" level biases the
 * level toward the background and pulls the reported edge outward.
 *
 * Returns null when no fall of at least `minDrop` exists, so a caller cannot
 * mistake a smooth gradient for an edge.
 */
export function edgeCrossing(
  img: Bitmap,
  cx: number,
  cy: number,
  angleRad: number,
  rGuess: number,
  span = 14,
  minDrop = 20,
): EdgeCrossing | null {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const step = 0.25;
  const from = rGuess - span;
  const to = rGuess + span;
  const samples: Array<{ r: number; luma: number }> = [];
  for (let r = from; r <= to + 1e-9; r += step) {
    samples.push({ r, luma: bilinearLuma(img, cx + cos * r, cy + sin * r) });
  }
  if (samples.length < 8) return null;

  // Steepest fall over a 2 px window (averaging the difference a little keeps a
  // single noisy pixel from being elected as "the edge").
  const win = Math.round(2 / step);
  let bestIdx = -1;
  let bestDrop = 0;
  for (let i = win; i < samples.length - win; i += 1) {
    const drop = samples[i - win].luma - samples[i + win].luma;
    if (drop > bestDrop) {
      bestDrop = drop;
      bestIdx = i;
    }
  }
  if (bestIdx < 0 || bestDrop < minDrop) return null;

  // Inner level: the 4 px just inside the steepest point. Outer: 4..12 px beyond it.
  const innerOf = (r: number) => {
    let s = 0;
    let n = 0;
    for (let k = 1; k <= 4; k += 1) {
      const rr = r - k;
      if (rr < 0) continue;
      s += bilinearLuma(img, cx + cos * rr, cy + sin * rr);
      n += 1;
    }
    return n ? s / n : NaN;
  };
  const outerOf = (r: number) => {
    let s = 0;
    let n = 0;
    for (let k = 4; k <= 12; k += 1) {
      const rr = r + k;
      s += bilinearLuma(img, cx + cos * rr, cy + sin * rr);
      n += 1;
    }
    return n ? s / n : NaN;
  };

  const rPeak = samples[bestIdx].r;
  const innerLevel = innerOf(rPeak);
  const outerLevel = outerOf(rPeak);
  if (!Number.isFinite(innerLevel) || !Number.isFinite(outerLevel)) return null;
  if (innerLevel - outerLevel < minDrop) return null;
  const level = (innerLevel + outerLevel) / 2;

  /*
   * Scan the WHOLE sampled window for the 50% crossing, outward direction.
   *
   * Not from `bestIdx`: the steepest sample is by construction already partway
   * down the edge, and on a 1 px-wide edge it is already BELOW the level. Starting
   * there found no `>= level` sample to the right and returned null on every ray —
   * 360 silent misses, which is exactly the failure mode a "returns null rather
   * than a wrong number" contract must not hide. The scan starts at 0 and takes the
   * FIRST descending crossing, which is the top of this edge rather than an
   * interior one.
   */
  for (let i = 0; i < samples.length - 1; i += 1) {
    const a = samples[i];
    const b = samples[i + 1];
    if (a.luma >= level && b.luma < level) {
      const denom = b.luma - a.luma;
      const f = Math.abs(denom) < 1e-9 ? 0 : (level - a.luma) / denom;
      return { radius: a.r + (b.r - a.r) * f, level, innerLevel, outerLevel };
    }
  }
  return null;
}

export interface CircleFit {
  cx: number;
  cy: number;
  r: number;
  /** RMS of |P-C| - r over the input points, in px. */
  rms: number;
  n: number;
}

/**
 * Algebraic (Kasa) least-squares circle fit.
 *
 * Minimises sum (x^2 + y^2 + Dx + Ey + F)^2, which is linear in (D, E, F) and has
 * a closed form. Chosen over a geometric fit because it needs no iteration and no
 * initial guess, and for a well-sampled near-complete circle the two agree far
 * below the 0.4 px tolerance this feeds.
 *
 * Returns null for fewer than 3 points or a degenerate (collinear) system, rather
 * than a NaN circle that would silently compare as "close enough" against nothing.
 */
export function fitCircle(points: Array<[number, number]>): CircleFit | null {
  const n = points.length;
  if (n < 3) return null;

  // Normalise around the centroid for conditioning.
  let mx = 0;
  let my = 0;
  for (const [x, y] of points) {
    mx += x;
    my += y;
  }
  mx /= n;
  my /= n;

  let Suu = 0;
  let Svv = 0;
  let Suv = 0;
  let Suuu = 0;
  let Svvv = 0;
  let Suvv = 0;
  let Svuu = 0;
  for (const [x0, y0] of points) {
    const u = x0 - mx;
    const v = y0 - my;
    Suu += u * u;
    Svv += v * v;
    Suv += u * v;
    Suuu += u * u * u;
    Svvv += v * v * v;
    Suvv += u * v * v;
    Svuu += v * u * u;
  }

  const det = Suu * Svv - Suv * Suv;
  if (Math.abs(det) < 1e-9) return null;
  const rhs1 = 0.5 * (Suuu + Suvv);
  const rhs2 = 0.5 * (Svvv + Svuu);
  const uc = (rhs1 * Svv - rhs2 * Suv) / det;
  const vc = (rhs2 * Suu - rhs1 * Suv) / det;

  const cx = uc + mx;
  const cy = vc + my;
  let rSum = 0;
  for (const [x, y] of points) rSum += Math.hypot(x - cx, y - cy);
  const r = rSum / n;

  let sq = 0;
  for (const [x, y] of points) {
    const d = Math.hypot(x - cx, y - cy) - r;
    sq += d * d;
  }
  return { cx, cy, r, rms: Math.sqrt(sq / n), n };
}

// ------------------------------------------------------------ probe windows (A3)

export interface PolarWindow {
  id: string;
  /** Radius as a fraction of R_fit. */
  rFrac: number;
  /** Angle in degrees, measured from +x, CLOCKWISE on screen (screen y runs down). */
  angleDeg: number;
  /** Edge length of the square window, in px. */
  size: number;
}

/**
 * The probe window set, in disc-relative polar coordinates — **W1 only**.
 *
 * Polar rather than absolute pixels because the disc moves: at 1024x768 R_fit is 312.6
 * px instead of 325.7, so an absolute coordinate that sits at 0.91 R in one viewport
 * lands somewhere else entirely in another. The original list was absolute and included
 * `(300, 392)`, which is at 1.045 R — outside the disc, in pure atmosphere halo — and
 * it is what made 3.3 report a 3.7x "local peak".
 *
 * W1 is the `(344, 392)` regression window: it is where the removed fill light drew a
 * blue circle. It is the ONLY window that guards a known regression, so it is the only
 * one that stayed. W2-W8 were retired in 2A4: measured on the real render they were not
 * regressions but scene content (W5 the disc centre at 1.240, W8 the bright upper
 * centre at 1.191, W6 excused by the specular mask), and a window that flags the scene
 * doing its job is a false positive generator, not a guard.
 *
 * Angle convention: degrees measured from +x, CLOCKWISE on screen (x = cy + sin), so
 * 90 is DOWN and 270 is UP. W1 at 180 is horizontal, therefore y == cy.
 */
export const PROBE_WINDOWS: readonly PolarWindow[] = [
  { id: 'W1', rFrac: 0.91, angleDeg: 180, size: 40 },
] as const;

export interface ResolvedWindow extends PolarWindow {
  /** Pixel centre. */
  x: number;
  y: number;
  /** Radius in px (= rFrac * R_fit). */
  rPx: number;
}

/**
 * Convert a polar window to pixel coordinates on a given fitted disc.
 *
 * Screen y grows downward, so the sine term ADDS to `cy` — this is the "clockwise on
 * screen" convention, not the mathematical one.
 */
export function resolveWindow(w: PolarWindow, geom: DiscGeometry): ResolvedWindow {
  const th = (w.angleDeg * Math.PI) / 180;
  const rPx = w.rFrac * geom.r;
  return {
    ...w,
    rPx,
    x: geom.cx + Math.cos(th) * rPx,
    y: geom.cy + Math.sin(th) * rPx,
  };
}

export interface WindowValidity {
  ok: boolean;
  /** Centre radius in px and as a fraction of R_fit. */
  rPx: number;
  rFrac: number;
  /** Fraction of the window's pixels that lie inside the disc. */
  insideFraction: number;
  reason: string;
}

/**
 * A3's validity rule for a probe window.
 *
 * Two conditions, both asserted rather than hoped for:
 *
 *  1. the CENTRE must be at least 28 px inside the limb. The window's own half-diagonal
 *     is ~28 px (40 px square), so anything closer samples across the edge, where a
 *     local maximum in the halo is guaranteed and means nothing;
 *  2. at least 70% of the window's pixels must land inside the disc, which catches a
 *     small-R viewport even when the centre passes.
 *
 * Returns the measured fractions so a failure message can quote them.
 */
export function windowValidity(w: ResolvedWindow, geom: DiscGeometry): WindowValidity {
  const rPx = Math.hypot(w.x - geom.cx, w.y - geom.cy);
  const half = w.size / 2;
  let inside = 0;
  let total = 0;
  for (let y = Math.round(w.y - half); y <= Math.round(w.y + half); y += 1) {
    for (let x = Math.round(w.x - half); x <= Math.round(w.x + half); x += 1) {
      total += 1;
      if (insideDisc(geom, x, y)) inside += 1;
    }
  }
  const insideFraction = total ? inside / total : 0;
  const centreOk = rPx <= geom.r - 28;
  const coverOk = insideFraction >= 0.7;
  const reason = centreOk
    ? coverOk
      ? 'valid'
      : `only ${(insideFraction * 100).toFixed(1)}% of the window is inside the disc (min 70%)`
    : `centre is at ${rPx.toFixed(1)}px = ${(rPx / geom.r).toFixed(3)} R, needs <= R - 28px (${(geom.r - 28).toFixed(1)}px)`;
  return { ok: centreOk && coverOk, rPx, rFrac: rPx / geom.r, insideFraction, reason };
}

// ------------------------------------------------------------- rim monotonicity

/**
 * Where a shell of radius `shellR` puts its silhouette, in px beyond the limb.
 *
 * `f*r/sqrt(d^2 - r^2)` is the perspective-exact silhouette radius, so subtracting
 * the planet's own (`R_fit`) gives the offset in the profile's coordinate system.
 *
 * This is what turns "the profile rises at +1 px" into "the CLOUD SHELL is there",
 * which is the difference between a defect and an approved feature.
 */
export function shellSilhouetteOffsetPx(
  shellR: number,
  planetR: number,
  distance: number,
  focalPx: number,
): number {
  const outer = discRadiusTangentPx(shellR, distance, focalPx);
  const inner = discRadiusTangentPx(planetR, distance, focalPx);
  if (!Number.isFinite(outer) || !Number.isFinite(inner)) return NaN;
  return outer - inner;
}

export interface MonotonicResult {
  /** Worst outward rise on any ray, in 1/255 units. Negative means every ray fell. */
  worstIncrease: number;
  /** Which ray and which offset pair produced it, for the failure message. */
  at: { deg: number; fromOffset: number; toOffset: number } | null;
  /** First offset the check applies at (whole pixels). */
  startOffset: number;
}

/**
 * Strictly-decreasing check on every ray, measured OUTWARD OF `startOffset`.
 *
 * `startOffset` is not 0, and that is the whole point. Profiles near a limb are not
 * monotonic by physics: a shell that sits slightly OUTSIDE the planet (the cloud deck
 * at 1.004 R, i.e. +1.03 px) turns on across its own antialiased silhouette, so luma
 * rises by a few /255 within ~2 px of the limb before the halo takes over. Measuring
 * monotonicity from the peak instead of from the limb ignores that band; measuring it
 * across the band reports an approved feature as a defect. It did: 2.65/255 at
 * 247.5deg, of which ablation showed CLOUDS OFF leaves **-0.39** (no rise at all).
 *
 * The tolerance exists for PNG quantisation, not for slack.
 */
export function checkMonotonicOutward(
  profiles: Array<{ deg: number; points: Array<{ offset: number; luma: number }> }>,
  startOffset: number,
): MonotonicResult {
  let worstIncrease = -Infinity;
  let at: MonotonicResult['at'] = null;
  for (const { deg, points } of profiles) {
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const cur = points[i];
      // Only pairs at or beyond the start; the sample BEFORE it is still read, so the
      // first checked step spans the boundary rather than starting inside it.
      if (prev.offset < startOffset) continue;
      const rise = cur.luma - prev.luma;
      // Reports the RAW worst rise; the caller compares it against its tolerance so a
      // failure message can quote both numbers.
      if (rise > worstIncrease) {
        worstIncrease = rise;
        at = { deg, fromOffset: prev.offset, toOffset: cur.offset };
      }
    }
  }
  if (!Number.isFinite(worstIncrease)) worstIncrease = -Infinity;
  return { worstIncrease, at, startOffset };
}

/**
 * The offset a strict-monotonic gate may start at.
 *
 * `max(peak offset, outermost opaque silhouette + 1 px)`: past the peak (nothing
 * should rise once the halo has turned over) and past the outermost thing that
 * actually blocks the background. The atmosphere is deliberately excluded — it is an
 * additive halo, so treating its 1.1 R silhouette (+35.9 px) as opaque would skip the
 * entire profile.
 */
export function monotonicStartOffset(
  peakOffset: number,
  outermostOpaqueOffset: number,
): number {
  return Math.max(peakOffset, Math.ceil(outermostOpaqueOffset + 1));
}

// --------------------------------------------------- difference images (glint)

export interface DiffStats {
  /** Largest signed difference, /255. */
  max: number;
  maxAt: [number, number] | null;
  /** 99.9th percentile of the signed differences inside the disc. */
  p999: number;
  /** Pixels with a difference greater than 6/255. */
  area6: number;
  /** Pixels with a difference greater than 3/255. */
  area3: number;
  bbox: [number, number, number, number] | null;
  centroid: [number, number] | null;
  /** Centroid distance from the disc centre, in units of R. */
  centroidROverR: number | null;
}

/**
 * Statistics of a SIGNED luma difference between two frames, inside a disc.
 *
 * This is the only honest way to measure a glint. "Peak luma in the glint region"
 * counts cloud tops and diffuse ocean, which reach ~210 on their own — a metric that
 * reported a 92% "retained peak" for a build whose actual specular contribution had
 * dropped by half. A difference of two frames from the same frozen scene isolates the
 * layer under test by construction, because everything that did not change cancels.
 *
 * Signed, not absolute: the question is "how much BRIGHTER did this layer make the
 * pixel", and an absolute value would count a darkening as a glint.
 */
export function diffStats(a: Bitmap, b: Bitmap, geom: DiscGeometry): DiffStats {
  const n = Math.min(a.width * a.height, b.width * b.height);
  const vals: number[] = [];
  let max = -Infinity;
  let maxAt: [number, number] | null = null;
  let area6 = 0;
  let area3 = 0;
  let sx = 0;
  let sy = 0;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const r2 = geom.r * geom.r;
  for (let i = 0; i < n; i += 1) {
    const x = i % a.width;
    const y = Math.floor(i / a.width);
    const dx = x - geom.cx;
    const dy = y - geom.cy;
    if (dx * dx + dy * dy > r2) continue;
    const o = i * 4;
    const v =
      luma(a.data[o], a.data[o + 1], a.data[o + 2]) - luma(b.data[o], b.data[o + 1], b.data[o + 2]);
    vals.push(v);
    if (v > max) {
      max = v;
      maxAt = [x, y];
    }
    if (v > 6) {
      area6 += 1;
      sx += x;
      sy += y;
    }
    if (v > 3) {
      area3 += 1;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  const centroid: [number, number] | null = area6 ? [sx / area6, sy / area6] : null;
  return {
    max,
    maxAt,
    p999: percentile(vals, 0.999),
    area6,
    area3,
    bbox: area3 ? [x0, y0, x1, y1] : null,
    centroid,
    centroidROverR: centroid
      ? Math.hypot(centroid[0] - geom.cx, centroid[1] - geom.cy) / geom.r
      : null,
  };
}

/**
 * Mask of pixels a specular source actually lights.
 *
 * Replaces `sunGlintPoint`, which predicted the glint by projecting the half-vector
 * ORTHOGRAPHICALLY. That is meaningless for a broad lobe: under the 42deg perspective
 * camera it landed 89 px from where the lobe actually peaks (and the perspective-
 * correct projection was still 74 px off, because the lobe is broad, not a point).
 *
 * Empirical instead: diff two frames (specular sources on vs off, same frozen scene),
 * keep pixels over `threshold`, then dilate by `radius` so the mask covers the lobe's
 * soft shoulder rather than only its core.
 */
export function specularMask(
  on: Bitmap,
  off: Bitmap,
  geom: DiscGeometry,
  { threshold = 3, radius = 8 }: { threshold?: number; radius?: number } = {},
): { mask: Uint8Array; width: number; height: number; pixels: number } {
  const { width, height } = on;
  const raw = new Uint8Array(width * height);
  const r2 = geom.r * geom.r;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - geom.cx;
      const dy = y - geom.cy;
      if (dx * dx + dy * dy > r2) continue;
      const o = (y * width + x) * 4;
      const d =
        luma(on.data[o], on.data[o + 1], on.data[o + 2]) -
        luma(off.data[o], off.data[o + 1], off.data[o + 2]);
      if (d > threshold) raw[y * width + x] = 1;
    }
  }
  /*
   * Square dilation of `radius` px, done separably (two passes) rather than as a
   * (2r+1)^2 kernel: at r=8 that is 17x17 per pixel, i.e. 289 comparisons each, and
   * this runs over a 1280x800 frame inside a spec.
   */
  let cur = raw;
  for (let pass = 0; pass < 2; pass += 1) {
    const next = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!cur[y * width + x]) continue;
        if (pass === 0) {
          for (let k = Math.max(0, x - radius); k <= Math.min(width - 1, x + radius); k += 1) {
            next[y * width + k] = 1;
          }
        } else {
          for (let k = Math.max(0, y - radius); k <= Math.min(height - 1, y + radius); k += 1) {
            next[k * width + x] = 1;
          }
        }
      }
    }
    cur = next;
  }
  let pixels = 0;
  for (let i = 0; i < cur.length; i += 1) if (cur[i]) pixels += 1;
  return { mask: cur, width, height, pixels };
}

/** Decode a PNG buffer into a Bitmap. */
export function decodePng(buf: Buffer): Bitmap {
  const png = PNG.sync.read(buf);
  return {
    width: png.width,
    height: png.height,
    data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength),
  };
}
