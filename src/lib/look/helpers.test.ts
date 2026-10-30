/**
 * Unit tests for the pure look helpers, on synthetic images.
 *
 * These are not decoration. The published errors this suite exists to prevent were
 * all measurement bugs, not rendering bugs: a profile sampled over the rising range
 * reported the rise as "the worst adjacent step", and two attributions were asserted
 * without ablation. A helper that is wrong in the silent direction (returns 0, or
 * NaN, or an empty blob list) produces exactly that class of error, so every helper
 * that can return a degenerate value is pinned here.
 */
import { describe, expect, it } from 'vitest';
import {
  type Bitmap,
  annulus,
  blurLuma,
  cameraBasis,
  collectDiscPixels,
  insideDisc,
  isClipped,
  labelBlobs,
  luma,
  lumaAt,
  meanAbsDiff,
  median,
  percentile,
  pixelAt,
  radialProfile,
  raySamples,
  sunGlintPoint,
  sunScreenAxis,
  transitionWidth,
} from '@/lib/look/helpers';

/** Build a bitmap from a per-pixel colour function. */
function makeImage(
  w: number,
  h: number,
  fn: (x: number, y: number) => [number, number, number],
): Bitmap {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b] = fn(x, y);
      const o = (y * w + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** A disc of one colour on a background of another. */
function discImage(w: number, h: number, cx: number, cy: number, r: number, inside: [number, number, number], outside: [number, number, number]) {
  return makeImage(w, h, (x, y) => ((x - cx) ** 2 + (y - cy) ** 2 <= r * r ? inside : outside));
}

describe('luma', () => {
  it('matches Rec. 709 weights', () => {
    expect(luma(255, 255, 255)).toBeCloseTo(255, 6);
    expect(luma(0, 0, 0)).toBe(0);
    // Green dominates.
    expect(luma(0, 255, 0)).toBeGreaterThan(luma(255, 0, 0));
    expect(luma(255, 0, 0)).toBeGreaterThan(luma(0, 0, 255));
  });

  it('lumaAt clamps out-of-bounds reads instead of throwing', () => {
    const img = discImage(10, 10, 5, 5, 3, [255, 255, 255], [0, 0, 0]);
    expect(Number.isFinite(lumaAt(img, -50, -50))).toBe(true);
    expect(Number.isFinite(lumaAt(img, 500, 500))).toBe(true);
  });
});

describe('isClipped', () => {
  it('requires all three channels, so a saturated colour does not count', () => {
    expect(isClipped(255, 255, 255)).toBe(true);
    expect(isClipped(250, 250, 250)).toBe(true);
    expect(isClipped(255, 255, 249)).toBe(false); // an amber pin
    expect(isClipped(249, 255, 255)).toBe(false);
  });
});

describe('pixelAt', () => {
  it('reads the right pixel and rounds fractional coordinates', () => {
    const img = makeImage(4, 4, (x, y) => [x * 10, y * 10, 0]);
    expect(pixelAt(img, 2, 3)).toEqual({ r: 20, g: 30, b: 0 });
    expect(pixelAt(img, 2.4, 3.4)).toEqual({ r: 20, g: 30, b: 0 });
    expect(pixelAt(img, 2.6, 3.6)).toEqual({ r: 30, g: 30, b: 0 });
  });
});

describe('insideDisc', () => {
  const geom = { cx: 50, cy: 50, r: 20 };
  it('includes the centre and excludes just outside the radius', () => {
    expect(insideDisc(geom, 50, 50)).toBe(true);
    expect(insideDisc(geom, 69, 50)).toBe(true);
    expect(insideDisc(geom, 71, 50)).toBe(false);
  });
  it('scales the radius', () => {
    expect(insideDisc(geom, 70, 50, 1.1)).toBe(true);
    expect(insideDisc(geom, 80, 50, 1.1)).toBe(false);
  });
});

describe('raySamples', () => {
  it('returns n samples and all equal on a uniform image', () => {
    const img = makeImage(40, 40, () => [128, 128, 128]);
    const s = raySamples(img, 20, 20, 10, 16);
    expect(s).toHaveLength(16);
    for (const v of s) expect(v).toBeCloseTo(luma(128, 128, 128), 3);
  });

  it('detects a known bright sector', () => {
    // Right half bright, left half dark.
    const img = makeImage(41, 41, (x) => (x > 20 ? [255, 255, 255] : [0, 0, 0]));
    const s = raySamples(img, 20, 20, 15, 8, 0);
    expect(s[0]).toBeGreaterThan(250); // 0 rad = +x = bright
    expect(s[4]).toBeLessThan(5); // pi rad = -x = dark
  });
});

describe('radialProfile', () => {
  it('returns one entry per pixel of radius, strictly ordered', () => {
    const img = discImage(80, 80, 40, 40, 20, [255, 255, 255], [0, 0, 0]);
    const p = radialProfile(img, 40, 40, 0, 0, 30);
    expect(p).toHaveLength(31);
    for (let i = 1; i < p.length; i += 1) expect(p[i].r).toBe(p[i - 1].r + 1);
    // Tallies with the drawn disc.
    expect(p.find((q) => q.r === 10)!.luma).toBeGreaterThan(250);
    expect(p.find((q) => q.r === 25)!.luma).toBeLessThan(5);
  });
});

describe('annulus', () => {
  it('reports the mean and a real count', () => {
    const img = makeImage(60, 60, () => [100, 100, 100]);
    const a = annulus(img, 30, 30, 5, 10);
    expect(a.count).toBeGreaterThan(0);
    expect(a.mean).toBeCloseTo(luma(100, 100, 100), 3);
  });

  it('returns NaN and 0 count when the region is empty, never 0', () => {
    // Zero-count must not look like "mean was 0" — that is how a null-vs-null pass
    // would slip through.
    const img = makeImage(10, 10, () => [255, 255, 255]);
    const a = annulus(img, 300, 300, 100, 200);
    expect(a.count).toBe(0);
    expect(Number.isNaN(a.mean)).toBe(true);
  });

  it('respects the keep predicate', () => {
    const img = makeImage(60, 60, () => [100, 100, 100]);
    const all = annulus(img, 30, 30, 0, 10);
    const half = annulus(img, 30, 30, 0, 10, (x) => x > 30);
    expect(half.count).toBeGreaterThan(0);
    expect(half.count).toBeLessThan(all.count);
  });
});

describe('median / percentile', () => {
  it('median handles odd and even lengths', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(Number.isNaN(median([]))).toBe(true);
  });

  it('median does not mutate its input', () => {
    const v = [3, 1, 2];
    median(v);
    expect(v).toEqual([3, 1, 2]);
  });

  it('percentile interpolates and clamps', () => {
    const v = [0, 10, 20, 30, 40];
    expect(percentile(v, 0)).toBe(0);
    expect(percentile(v, 1)).toBe(40);
    expect(percentile(v, 0.5)).toBe(20);
    expect(percentile(v, 0.25)).toBe(10);
    expect(Number.isNaN(percentile([], 0.5))).toBe(true);
  });
});

describe('transitionWidth', () => {
  it('measures a known linear ramp to sub-pixel precision', () => {
    /*
     * Luma 250 -> 0 over r = 100..200, i.e. 2.5 per px.
     *
     * The levels are absolute (225 and 25), not "90% and 10% OF THE SPAN", and the
     * span here is the full 250. So 225 -> 25 is 200 units of change at 2.5/px =
     * **80 px**, not 25. The first version of this test asserted 25 from a mental
     * "90%-10% = 10% of 250" slip; the helper was right and the expectation was
     * wrong. Keeping the corrected number explicit because an off-by-3x here would
     * make every softness threshold meaningless.
     */
    const p = Array.from({ length: 101 }, (_, i) => ({ r: 100 + i, luma: 250 - i * 2.5 }));
    const w = transitionWidth(p, 225, 25);
    expect(w).not.toBeNull();
    expect(w!.width).toBeCloseTo(80, 1);
    // The crossing is located where the ramp actually is, not at an endpoint.
    expect(p[w!.iHigh].luma).toBeCloseTo(225, 1);
    expect(p[w!.iLow].luma).toBeCloseTo(25, 1);
  });

  it('measures an ascending profile as well as a descending one', () => {
    // Same ramp reversed: the width must be identical.
    const up = Array.from({ length: 101 }, (_, i) => ({ r: 100 + i, luma: i * 2.5 }));
    const w = transitionWidth(up, 225, 25);
    expect(w).not.toBeNull();
    expect(w!.width).toBeCloseTo(80, 1);
  });

  it('reports a hard step as ~0-1 px, not as a failure', () => {
    const p = [
      { r: 0, luma: 250 },
      { r: 1, luma: 250 },
      { r: 2, luma: 0 },
      { r: 3, luma: 0 },
    ];
    const w = transitionWidth(p, 225, 25);
    expect(w).not.toBeNull();
    expect(w!.width).toBeLessThanOrEqual(1.01);
  });

  it('returns null when a level is never crossed, rather than 0', () => {
    // The whole profile is above high level: no transition exists.
    const p = Array.from({ length: 50 }, (_, i) => ({ r: i, luma: 250 }));
    expect(transitionWidth(p, 225, 25)).toBeNull();
  });

  it('returns null on an empty profile', () => {
    expect(transitionWidth([], 225, 25)).toBeNull();
  });
});

describe('labelBlobs', () => {
  it('labels a single 3x3 block as one blob of 9', () => {
    const pts: Array<[number, number]> = [];
    for (let y = 0; y < 3; y += 1) for (let x = 0; x < 3; x += 1) pts.push([x, y]);
    const b = labelBlobs(pts);
    expect(b).toHaveLength(1);
    expect(b[0].size).toBe(9);
    expect(b[0].width).toBe(3);
    expect(b[0].height).toBe(3);
    expect(b[0].cx).toBe(1);
    expect(b[0].cy).toBe(1);
  });

  it('joins diagonals, because the rule specifies 8-connectivity', () => {
    // Two pixels touching only at a corner: 8-connectivity makes this ONE blob.
    const b = labelBlobs([
      [0, 0],
      [1, 1],
    ]);
    expect(b).toHaveLength(1);
    expect(b[0].size).toBe(2);
  });

  it('separates blobs that do not touch', () => {
    const b = labelBlobs([
      [0, 0],
      [5, 5],
    ]);
    expect(b).toHaveLength(2);
  });

  it('sorts largest first', () => {
    const small: Array<[number, number]> = [[0, 0]];
    const big: Array<[number, number]> = [];
    for (let y = 10; y < 13; y += 1) for (let x = 10; x < 13; x += 1) big.push([x, y]);
    const b = labelBlobs([...small, ...big]);
    expect(b[0].size).toBe(9);
    expect(b[1].size).toBe(1);
  });

  it('returns an empty array for no points', () => {
    expect(labelBlobs([])).toEqual([]);
  });

  it('does not leak state between calls', () => {
    labelBlobs([
      [0, 0],
      [1, 1],
    ]);
    expect(labelBlobs([[9, 9]])[0].size).toBe(1);
  });
});

describe('collectDiscPixels', () => {
  it('counts only inside the disc and applies the predicate', () => {
    const img = discImage(100, 100, 50, 50, 20, [255, 255, 255], [0, 0, 0]);
    const geom = { cx: 50, cy: 50, r: 20 };
    const white = collectDiscPixels(img, geom, (r, g, b) => r >= 250 && g >= 250 && b >= 250);
    expect(white.points.length).toBeGreaterThan(1100);
    expect(white.points.length).toBeLessThan(1300);
    // Total should be close to pi r^2.
    expect(white.total).toBeGreaterThan(Math.PI * 400 * 0.97);
    expect(white.total).toBeLessThan(Math.PI * 400 * 1.03);
  });

  it('honours exclude circles', () => {
    const img = discImage(100, 100, 50, 50, 20, [255, 255, 255], [0, 0, 0]);
    const geom = { cx: 50, cy: 50, r: 20 };
    const pred = (r: number, g: number, b: number) => r >= 250 && g >= 250 && b >= 250;
    const all = collectDiscPixels(img, geom, pred);
    const some = collectDiscPixels(img, geom, pred, [{ x: 50, y: 50, r: 10 }]);
    expect(some.points.length).toBeLessThan(all.points.length);
    expect(some.points.length).toBeGreaterThan(0);
  });
});

describe('blurLuma', () => {
  it('preserves a flat field', () => {
    const img = makeImage(30, 30, () => [100, 100, 100]);
    const b = blurLuma(img, 3);
    for (let i = 0; i < b.length; i += 1) expect(b[i]).toBeCloseTo(luma(100, 100, 100), 3);
  });

  it('spreads a single bright pixel and lowers its peak', () => {
    const img = makeImage(41, 41, (x, y) => (x === 20 && y === 20 ? [255, 255, 255] : [0, 0, 0]));
    const raw = lumaAt(img, 20, 20);
    const b = blurLuma(img, 3);
    const peak = b[20 * 41 + 20];
    expect(peak).toBeLessThan(raw);
    expect(b[20 * 41 + 21]).toBeGreaterThan(0); // energy spread sideways
  });

  it('returns one luma value per pixel', () => {
    const img = makeImage(17, 13, () => [10, 20, 30]);
    expect(blurLuma(img, 2)).toHaveLength(17 * 13);
  });
});

describe('meanAbsDiff', () => {
  it('is 0 for identical buffers', () => {
    expect(meanAbsDiff([1, 2, 3], [1, 2, 3])).toBe(0);
  });
  it('computes the mean of absolute differences', () => {
    expect(meanAbsDiff([0, 0, 0], [1, 2, 3])).toBeCloseTo(2, 6);
  });
  it('returns NaN rather than 0 on a length mismatch', () => {
    // NaN, not 0: a silent 0 here would let "both empty" read as "identical".
    expect(Number.isNaN(meanAbsDiff([1, 2], [1, 2, 3]))).toBe(true);
    expect(Number.isNaN(meanAbsDiff([], []))).toBe(true);
  });
});

describe('sunGlintPoint', () => {
  const geom = { cx: 640, cy: 400, r: 300 };

  it('returns null when the sun is directly behind the camera, so there is no forward scatter', () => {
    const cam: [number, number, number] = [0, 0, 5];
    const sun: [number, number, number] = [0, 0, -5];
    expect(sunGlintPoint(sun, cam, geom)).toBeNull();
  });

  it('puts the glint at the disc centre when the sun is directly behind the eye', () => {
    // Sun and camera both along +z: the half-vector is +z, which is the centre of
    // the visible hemisphere.
    const cam: [number, number, number] = [0, 0, 5];
    const sun: [number, number, number] = [0, 0, 9];
    const g = sunGlintPoint(sun, cam, geom);
    expect(g).not.toBeNull();
    expect(g!.x).toBeCloseTo(geom.cx, 0);
    expect(g!.y).toBeCloseTo(geom.cy, 0);
  });

  it('offsets the glint toward the sun side', () => {
    const cam: [number, number, number] = [0, 0, 5];
    const sun: [number, number, number] = [5, 0, 5]; // sun to the right
    const g = sunGlintPoint(sun, cam, geom);
    expect(g).not.toBeNull();
    expect(g!.x).toBeGreaterThan(geom.cx);
  });

  it('the exclusion radius is 0.15 R', () => {
    const cam: [number, number, number] = [0, 0, 5];
    const sun: [number, number, number] = [0, 0, 9];
    expect(sunGlintPoint(sun, cam, geom)!.r).toBeCloseTo(45, 6);
  });
});

describe('cameraBasis / sunScreenAxis', () => {
  it('builds an orthonormal right-handed basis', () => {
    const { f, u, v } = cameraBasis([0, 1, 3]);
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot(f, f)).toBeCloseTo(1, 9); // uses f, so it is not unused
    expect(dot(u, u)).toBeCloseTo(1, 9);
    expect(dot(v, v)).toBeCloseTo(1, 9);
    expect(dot(f, u)).toBeCloseTo(0, 9);
    expect(dot(f, v)).toBeCloseTo(0, 9);
    expect(dot(u, v)).toBeCloseTo(0, 9);
  });

  it('handles a camera looking straight down without a degenerate cross product', () => {
    // Straight down makes the world-up cross product degenerate; the fallback must
    // keep the basis FINITE and unit-length rather than producing NaN.
    const { f, u, v } = cameraBasis([0, 1, 0]);
    expect(Math.hypot(f[0], f[1], f[2])).toBeCloseTo(1, 9);
    expect(Number.isFinite(u[0])).toBe(true);
    expect(Number.isFinite(v[0])).toBe(true);
    expect(Math.hypot(u[0], u[1], u[2])).toBeCloseTo(1, 9);
  });

  it('returns a unit screen axis', () => {
    const { ax, ay } = sunScreenAxis([0.72, 0.36, 0.59], [0, 1.15, 3.15]);
    expect(Math.hypot(ax, ay)).toBeCloseTo(1, 9);
  });

  it('points the axis along +x when the sun is to screen-right of the camera', () => {
    // Camera on +z looking at the origin; a sun offset in +x projects to screen +x.
    const { ax } = sunScreenAxis([5, 0, 5], [0, 0, 5]);
    expect(ax).toBeGreaterThan(0.5);
  });
});
