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
  bilinearLuma,
  blurLuma,
  cameraBasis,
  collectDiscPixels,
  diffStats,
  discRadiusNaivePx,
  discRadiusTangentPx,
  edgeCrossing,
  fitCircle,
  focalPxFromFov,
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
  specularMask,
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

describe('focalPxFromFov / discRadius*', () => {
  it('derives the focal from the VERTICAL fov and the height', () => {
    // 90deg vertical fov -> focal == height/2 exactly, which is the identity that
    // makes a width/height mistake obvious.
    expect(focalPxFromFov(90, 800)).toBeCloseTo(400, 9);
    expect(focalPxFromFov(42, 800)).toBeCloseTo(1042.04, 1);
  });

  it('the tangent form and the closed form agree', () => {
    const f = focalPxFromFov(42, 800);
    const tangent = Math.tan(Math.asin(1 / 3.3534)) * f;
    expect(discRadiusTangentPx(1, 3.3534, f)).toBeCloseTo(tangent, 6);
  });

  it('the naive form understates the disc, never overstates it', () => {
    const f = focalPxFromFov(42, 800);
    const exact = discRadiusTangentPx(1, 3.3534, f);
    const naive = discRadiusNaivePx(1, 3.3534, f);
    expect(naive).toBeLessThan(exact);
    // At the default camera the gap is ~15 px, i.e. far above any tolerance that
    // matters, which is why the naive form is not used anywhere.
    expect(exact - naive).toBeGreaterThan(10);
  });

  it('returns NaN with the camera at or inside the surface rather than a huge number', () => {
    expect(discRadiusTangentPx(1, 1, 1000)).toBeNaN();
    expect(discRadiusTangentPx(1, 0.5, 1000)).toBeNaN();
  });

  it('both forms agree in the far field', () => {
    const f = 1000;
    expect(discRadiusTangentPx(1, 100, f)).toBeCloseTo(discRadiusNaivePx(1, 100, f), 2);
  });
});

describe('bilinearLuma', () => {
  it('reproduces an integer-coordinate read exactly', () => {
    const img = makeImage(8, 8, (x, y) => [x * 30, y * 30, 0]);
    const p = pixelAt(img, 3, 4);
    expect(bilinearLuma(img, 3, 4)).toBeCloseTo(luma(p.r, p.g, p.b), 6);
  });

  it('interpolates halfway between two pixels', () => {
    const img = makeImage(4, 4, (x) => (x < 2 ? [0, 0, 0] : [255, 255, 255]));
    const mid = bilinearLuma(img, 1.5, 0);
    const lo = bilinearLuma(img, 0, 0);
    const hi = bilinearLuma(img, 3, 0);
    expect(mid).toBeGreaterThan(lo);
    expect(mid).toBeLessThan(hi);
  });

  it('clamps at the edges instead of reading out of bounds', () => {
    const img = makeImage(4, 4, () => [10, 10, 10]);
    expect(bilinearLuma(img, -5, -5)).toBeCloseTo(10, 6);
    expect(bilinearLuma(img, 99, 99)).toBeCloseTo(10, 6);
  });
});

describe('edgeCrossing', () => {
  /** A disc of `R` px, luma 200 inside, 20 outside, antialiased over 1 px. */
  const discImage = (R: number, cx = 60, cy = 60) =>
    makeImage(120, 120, (x, y) => {
      const d = Math.hypot(x - cx, y - cy);
      const cov = Math.max(0, Math.min(1, R + 0.5 - d));
      const v = Math.round(20 + (200 - 20) * cov);
      return [v, v, v];
    });

  it('finds the 50% crossing within a tenth of a pixel', () => {
    const img = discImage(40);
    for (const deg of [0, 45, 90, 180, 225, 315]) {
      const e = edgeCrossing(img, 60, 60, (deg * Math.PI) / 180, 40);
      expect(e, `no crossing at ${deg}deg`).not.toBeNull();
      expect(e!.radius).toBeCloseTo(40, 0);
      // 50% of (20..200) is 110.
      expect(e!.level).toBeGreaterThan(90);
      expect(e!.level).toBeLessThan(130);
    }
  });

  it('reports the levels it used, and they bracket the crossing', () => {
    const e = edgeCrossing(discImage(40), 60, 60, 0, 40)!;
    expect(e.innerLevel).toBeGreaterThan(e.level);
    expect(e.outerLevel).toBeLessThan(e.level);
  });

  it('returns null when there is no edge (a flat field)', () => {
    const flat = makeImage(60, 60, () => [128, 128, 128]);
    expect(edgeCrossing(flat, 30, 30, 0, 20)).toBeNull();
  });

  it('returns null when the guess is far from any edge', () => {
    const img = discImage(40);
    // Guess well outside, so the search window contains no fall.
    expect(edgeCrossing(img, 60, 60, 0, 58, 4)).toBeNull();
  });
});

describe('fitCircle', () => {
  /** Points on a circle, optionally with noise. */
  const ring = (cx: number, cy: number, r: number, n: number, noise = 0) =>
    Array.from({ length: n }, (_, i) => {
      const th = (i / n) * Math.PI * 2;
      // Deterministic pseudo-noise, so a failure is reproducible.
      const e = noise * Math.sin(i * 12.9898) * Math.cos(i * 78.233);
      return [cx + Math.cos(th) * (r + e), cy + Math.sin(th) * (r + e)] as [number, number];
    });

  it('recovers a known circle exactly from noiseless points', () => {
    const f = fitCircle(ring(325.4, 402.7, 328.6, 360))!;
    expect(f).not.toBeNull();
    expect(f.cx).toBeCloseTo(325.4, 6);
    expect(f.cy).toBeCloseTo(402.7, 6);
    expect(f.r).toBeCloseTo(328.6, 6);
    expect(f.rms).toBeLessThan(1e-6);
  });

  it('reports RMS for noisy points and keeps the radius within a pixel', () => {
    const f = fitCircle(ring(300, 400, 325, 360, 0.3))!;
    expect(f.r).toBeCloseTo(325, 0);
    expect(f.rms).toBeGreaterThan(0); // the noise is visible in the residual
    expect(f.rms).toBeLessThan(1);
  });

  it('returns null rather than a NaN circle for degenerate input', () => {
    expect(fitCircle([])).toBeNull();
    expect(fitCircle([[0, 0], [1, 1]])).toBeNull();
    // Collinear: no unique circle.
    expect(fitCircle([[0, 0], [1, 1], [2, 2], [3, 3]])).toBeNull();
  });
});

describe('diffStats', () => {
  const geom = { cx: 40, cy: 40, r: 30 };

  it('isolates the changed layer and ignores identical frames', () => {
    const same = makeImage(80, 80, () => [50, 50, 50]);
    const d = diffStats(same, same, geom);
    expect(d.max).toBe(0);
    expect(d.area6).toBe(0);
    expect(d.area3).toBe(0);
    expect(d.bbox).toBeNull();
    expect(d.centroid).toBeNull();
  });

  it('reports the peak where the layer actually changed, not where the scene is brightest', () => {
    // Bright everywhere, but the DIFFERENCE is a 4 px patch at (52, 40).
    const off = makeImage(80, 80, () => [10, 10, 10]);
    const on = makeImage(80, 80, (x, y) =>
      Math.abs(x - 52) <= 1 && Math.abs(y - 40) <= 1 ? [200, 200, 200] : [10, 10, 10],
    );
    const d = diffStats(on, off, geom);
    expect(d.max).toBeCloseTo(luma(200, 200, 200) - luma(10, 10, 10), 4);
    expect(d.area6).toBe(9);
    // The 3x3 patch ties, so maxAt is the first one in scan order - assert it is
    // INSIDE the patch rather than pinning an arbitrary tie-break.
    expect(Math.abs(d.maxAt![0] - 52)).toBeLessThanOrEqual(1);
    expect(Math.abs(d.maxAt![1] - 40)).toBeLessThanOrEqual(1);
    // The centroid is not a tie: it is the patch centre.
    expect(d.centroid![0]).toBeCloseTo(52, 6);
    expect(d.centroid![1]).toBeCloseTo(40, 6);
  });

  it('is SIGNED: a darkening is not counted as a glint', () => {
    const off = makeImage(80, 80, () => [200, 200, 200]);
    const on = makeImage(80, 80, () => [20, 20, 20]);
    const d = diffStats(on, off, geom);
    expect(d.max).toBeLessThan(0);
    expect(d.area6).toBe(0);
  });

  it('ignores differences outside the disc', () => {
    const off = makeImage(80, 80, () => [0, 0, 0]);
    const on = makeImage(80, 80, (x) => (x > 70 ? [255, 255, 255] : [0, 0, 0]));
    const d = diffStats(on, off, geom);
    expect(d.max).toBe(0);
  });

  it('reports the centroid in units of R', () => {
    const off = makeImage(80, 80, () => [0, 0, 0]);
    // A patch 15 px right of the centre, inside R=30 -> 0.5 R.
    const on = makeImage(80, 80, (x, y) =>
      Math.abs(x - 55) <= 1 && Math.abs(y - 40) <= 1 ? [255, 255, 255] : [0, 0, 0],
    );
    const d = diffStats(on, off, geom);
    expect(d.centroidROverR!).toBeCloseTo(15 / 30, 2);
  });
});

describe('specularMask', () => {
  const geom = { cx: 40, cy: 40, r: 30 };

  it('covers the changed pixels and dilates by the requested radius', () => {
    const off = makeImage(80, 80, () => [0, 0, 0]);
    const on = makeImage(80, 80, (x, y) => (x === 40 && y === 40 ? [255, 255, 255] : [0, 0, 0]));
    const m = specularMask(on, off, geom, { threshold: 3, radius: 4 });
    expect(m.mask[40 * 80 + 40]).toBe(1);
    expect(m.mask[40 * 80 + 44]).toBe(1); // +4 px
    expect(m.mask[40 * 80 + 46]).toBe(0); // +6 px, outside the dilation
    // 9x9 square from a 1 px seed.
    expect(m.pixels).toBe(81);
  });

  it('returns an empty mask when nothing changed', () => {
    const same = makeImage(80, 80, () => [100, 100, 100]);
    const m = specularMask(same, same, geom);
    expect(m.pixels).toBe(0);
  });

  it('ignores a change weaker than the threshold', () => {
    const off = makeImage(80, 80, () => [0, 0, 0]);
    const on = makeImage(80, 80, () => [2, 2, 2]);
    const m = specularMask(on, off, geom, { threshold: 3 });
    expect(m.pixels).toBe(0);
  });
});
