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

/**
 * Analytically predicted specular point: the point on the sphere where the
 * half-vector of (sun, camera) meets the surface.
 *
 * Used to EXCLUDE the sun glint, which is allowed to be bright. Returns null when
 * the sun is behind the camera, because then there is no forward-scatter point on
 * the visible hemisphere and there is nothing to exclude.
 *
 * `sun` and `cam` are world-space directions pointing FROM the globe TOWARD the
 * light/camera, which is what `SUN_DIRECTION` and `project(0,0,0) - camera.position`
 * give.
 */
export function sunGlintPoint(
  sun: [number, number, number],
  cam: [number, number, number],
  geom: DiscGeometry,
): { x: number; y: number; r: number } | null {
  const nSun = norm3(sun);
  const nCam = norm3(cam);
  const half: [number, number, number] = [
    nSun[0] + nCam[0],
    nSun[1] + nCam[1],
    nSun[2] + nCam[2],
  ];
  const len = Math.hypot(half[0], half[1], half[2]);
  if (len < 1e-6) return null; // sun exactly opposite the camera
  const n: [number, number, number] = [half[0] / len, half[1] / len, half[2] / len];

  // Visible only if the half-vector faces the camera.
  const facing = n[0] * nCam[0] + n[1] * nCam[1] + n[2] * nCam[2];
  if (facing <= 0) return null;

  /*
   * Project onto the screen disc. Build a camera basis and express `n` in it: the
   * disc is the unit circle, so the screen offset is (n.u, -n.v) scaled by R.
   * The sign flip on v is because screen y runs downward while camera v runs up.
   */
  const { u, v } = cameraBasis(nCam);
  const su = n[0] * u[0] + n[1] * u[1] + n[2] * u[2];
  const sv = n[0] * v[0] + n[1] * v[1] + n[2] * v[2];
  return { x: geom.cx + su * geom.r, y: geom.cy - sv * geom.r, r: geom.r * 0.15 };
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

/** Decode a PNG buffer into a Bitmap. */
export function decodePng(buf: Buffer): Bitmap {
  const png = PNG.sync.read(buf);
  return {
    width: png.width,
    height: png.height,
    data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength),
  };
}
