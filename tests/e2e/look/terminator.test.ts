/**
 * Unit tests for the redefined 3.4 — synthetic curves, the D2 oracle, and the applicability rule.
 *
 * The point of testing a pixel gate with synthetic data is that the REAL render is a fixed input: it
 * cannot tell you whether the gate would reject a hard step, because there is no hard step in it. So
 * the function is fed curves whose S and A are known in closed form, and only then pointed at the
 * render.
 *
 * The central quantity: for a linear ramp over n·L width `w`, S = 0.02 / w (bins are 0.02 wide), so
 * S <= 0.25 means a transition at least 0.08 wide in n·L. The tests below check that arithmetic
 * holds through the implementation rather than restating it.
 */
import { describe, expect, it } from 'vitest';
import type { Bitmap } from '../../../src/lib/look/helpers';
import { nDotLAt } from '../../../src/lib/look/helpers';
import {
  CATASTROPHE_S,
  DAY_BAND,
  NIGHT_BAND,
  TERMINATOR_GATE,
  curveBin,
  evaluateTerminator,
  gateTerminator,
  rOverROracle,
  type TerminatorVerdict,
} from './terminatorProfile';
import type { SunCameraGeometry } from '../../../src/lib/look/helpers';

/**
 * A geometry whose camera sits on +Z at the shipped distance, with the sun tilted `theta` from the
 * axis to the viewer. `r` is derived so the disc is geometrically possible — a fixture with an
 * impossible radius makes every off-centre ray miss and looks like a maths failure.
 */
function geom(thetaDeg = 47.234): SunCameraGeometry {
  const th = (thetaDeg * Math.PI) / 180;
  const cam: [number, number, number] = [0, 1.15, 3.15];
  const d = Math.hypot(cam[0], cam[1], cam[2]);
  const fov = 42;
  const heightPx = 800;
  const focal = heightPx / (2 * Math.tan((fov * Math.PI) / 360));
  return {
    cam,
    sun: [Math.sin(th), Math.cos(th), 0],
    fov,
    heightPx,
    cx: 640,
    cy: 400,
    r: focal / Math.sqrt(d * d - 1),
    radius: 1,
  };
}

/**
 * A frame painted from a chosen luminance curve of n·L: `lumaOf(nDotL)`.
 *
 * Painted rather than captured, so `evaluateTerminator` sees exactly the curve the test intends —
 * including curves no render would ever produce (a step, a flat field).
 */
function paint(g: SunCameraGeometry, lumaOf: (nDotL: number) => number): Bitmap {
  const width = Math.ceil(g.cx + g.r) + 2;
  const height = Math.ceil(g.cy + g.r) + 2;
  const data = new Uint8Array(width * height * 4);
  // Fill via the same nDotLAt the gate uses, so the painted field and the measured field agree.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const s = nDotLAt(g, x, y);
      const v = s.hit ? Math.max(0, Math.min(255, Math.round(lumaOf(s.nDotL)))) : 0;
      const o = (y * width + x) * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  return { width, height, data };
}

/** Day level 60, night level 5, with a smooth ramp of width `w` in n·L centred on 0. */
function ramp(w: number, day = 60, night = 5): (nDotL: number) => number {
  return (nDotL) => {
    const t = Math.max(0, Math.min(1, (nDotL + w / 2) / w));
    return night + (day - night) * t;
  };
}

/** A hard step at n·L = 0. */
const hardStep = (day = 60, night = 5) => (nDotL: number) => (nDotL > 0 ? day : night);

function verdictOf(v: TerminatorVerdict): string {
  return `A=${v.A.toFixed(2)} ratio=${v.ratio.toFixed(2)} S=${Number.isFinite(v.S) ? v.S.toFixed(3) : 'NaN'} ` +
    `Ld=${v.Ld.toFixed(2)} Ln=${v.Ln.toFixed(2)} evaluated=${v.evaluated} ${v.notEvaluatedReason ?? ''}`;
}

describe('rOverROracle — the D2 closed form', () => {
  /*
   * The numbers the prompt's D2 states for this camera (d = 3.3534, theta = 47.2 deg). The audit
   * measured 0.829 / 0.613 / 0.957 and the closed form must reproduce them to 0.002.
   */
  const D = 3.3534;

  it('reproduces the crossing at alpha 42.8 deg', () => {
    expect(rOverROracle(42.8, D)).toBeCloseTo(0.830, 2);
  });

  it('reproduces n·L = +0.25 at alpha 28.32 deg', () => {
    expect(rOverROracle(28.32, D)).toBeCloseTo(0.614, 2);
  });

  it('reproduces n·L = -0.25 at alpha 57.28 deg', () => {
    expect(rOverROracle(57.28, D)).toBeCloseTo(0.957, 2);
  });

  it('agrees with the measured audit values within 0.002', () => {
    const measured = { cross: 0.829, plus: 0.613, minus: 0.957 };
    expect(Math.abs(rOverROracle(42.8, D) - measured.cross)).toBeLessThan(0.002);
    expect(Math.abs(rOverROracle(28.32, D) - measured.plus)).toBeLessThan(0.002);
    expect(Math.abs(rOverROracle(57.28, D) - measured.minus)).toBeLessThan(0.002);
  });

  it('is 0 at alpha 0 and grows with alpha', () => {
    expect(rOverROracle(0, D)).toBeCloseTo(0, 6);
    expect(rOverROracle(50, D)).toBeGreaterThan(rOverROracle(40, D));
  });
});

describe('curveBin', () => {
  it('covers -0.10 to +0.30 in 20 bins of 0.02', () => {
    expect(TERMINATOR_GATE.curveBins).toBe(20);
    expect(curveBin(-0.1)).toBe(0);
    expect(curveBin(0)).toBe(5);
    expect(curveBin(0.29)).toBe(19);
  });

  it('returns -1 outside the range rather than clamping silently', () => {
    expect(curveBin(-0.11)).toBe(-1);
    expect(curveBin(0.3)).toBe(-1);
    expect(curveBin(Number.NaN)).toBe(-1);
  });
});

describe('evaluateTerminator — synthetic curves', () => {
  const g = geom();

  it('a 31 px-equivalent SMOOTH ramp PASSES', () => {
    // width 0.40 in n.L ~ 31 px at the default view; S should be ~0.05.
    const v = evaluateTerminator(paint(g, ramp(0.4)), g);
    expect(v.evaluated, verdictOf(v)).toBe(true);
    expect(v.visible, verdictOf(v)).toBe(true);
    expect(v.S, verdictOf(v)).toBeLessThanOrEqual(0.25);
    expect(v.pass, verdictOf(v)).toBe(true);
  });

  it('a ramp of n·L width 0.10 PASSES with S about 0.2', () => {
    const v = evaluateTerminator(paint(g, ramp(0.1)), g);
    expect(v.evaluated, verdictOf(v)).toBe(true);
    expect(v.S, verdictOf(v)).toBeCloseTo(0.2, 1);
    expect(v.soft, verdictOf(v)).toBe(true);
  });

  it('a ramp of n·L width 0.06 FAILS SOFT with S about 0.33', () => {
    const v = evaluateTerminator(paint(g, ramp(0.06)), g);
    expect(v.evaluated, verdictOf(v)).toBe(true);
    expect(v.S, verdictOf(v)).toBeGreaterThan(0.25);
    expect(v.S, verdictOf(v)).toBeCloseTo(0.33, 1);
    expect(v.soft, verdictOf(v)).toBe(false);
    // VISIBLE still holds — it is SOFTNESS that broke, and the report must say so.
    expect(v.visible, verdictOf(v)).toBe(true);
  });

  it('a HARD STEP fails SOFT with S about 1', () => {
    const v = evaluateTerminator(paint(g, hardStep()), g);
    expect(v.evaluated, verdictOf(v)).toBe(true);
    expect(v.S, verdictOf(v)).toBeGreaterThanOrEqual(0.6);
    expect(v.S, verdictOf(v)).toBeCloseTo(1, 0);
    expect(v.soft, verdictOf(v)).toBe(false);
    expect(v.visible, verdictOf(v)).toBe(true);
  });

  it('a FLAT field fails VISIBLE on A', () => {
    const v = evaluateTerminator(paint(g, () => 40), g);
    expect(v.evaluated, verdictOf(v)).toBe(true);
    expect(v.A, verdictOf(v)).toBeLessThan(25);
    expect(v.visible, verdictOf(v)).toBe(false);
  });

  it('a lifted night side fails VISIBLE on the RATIO', () => {
    // A = 60 - 30 = 30, which passes A >= 25, but 60/30 = 2 < 3.
    const v = evaluateTerminator(paint(g, ramp(0.2, 60, 30)), g);
    expect(v.evaluated, verdictOf(v)).toBe(true);
    expect(v.A, verdictOf(v)).toBeGreaterThanOrEqual(25);
    expect(v.ratio, verdictOf(v)).toBeLessThan(3);
    expect(v.visible, verdictOf(v)).toBe(false);
  });

  it('A <= 0 FAILS without producing a NaN S', () => {
    // Night BRIGHTER than day: A is negative, and S must not be Infinity/NaN-poisoned into a pass.
    const v = evaluateTerminator(paint(g, ramp(0.2, 10, 80)), g);
    expect(v.evaluated, verdictOf(v)).toBe(true);
    expect(v.A).toBeLessThan(0);
    expect(v.soft).toBe(false);
    expect(v.pass).toBe(false);
    expect(v.failures.join(' ')).toContain('<= 0');
  });

  it('reports the bin of the largest step, so a failure is locatable', () => {
    const v = evaluateTerminator(paint(g, hardStep()), g);
    expect(v.worstStepBin).toBeGreaterThanOrEqual(0);
    expect(v.worstStepLuma).toBeGreaterThan(10);
  });

  it('gives an azimuth with too few band pixels NOT EVALUATED, never a pass', () => {
    /*
     * A geometry whose disc is tiny: bands fall below 1000 px, so the claim cannot be supported.
     * "Not evaluated" must never be reported as a pass — this is the vacuity guard.
     */
    const small: SunCameraGeometry = { ...g, r: 8 };
    const v = evaluateTerminator(paint(small, ramp(0.3)), small);
    expect(v.evaluated).toBe(false);
    expect(v.pass).toBe(false);
    expect(v.notEvaluatedReason).toContain('terminator not in view');
  });

  it('states the D95 pixel set in its count', () => {
    const v = evaluateTerminator(paint(g, ramp(0.3)), g);
    // r/R <= 0.95 of a ~326 px disc is a bit over 290k pixels; assert the order, not the exact count.
    expect(v.pixelCount).toBeGreaterThan(200_000);
  });
});

describe('the gate constants are the ones the prompt fixed', () => {
  it('thresholds', () => {
    expect(TERMINATOR_GATE.visibleMinA).toBe(25);
    expect(TERMINATOR_GATE.visibleMinRatio).toBe(3);
    expect(TERMINATOR_GATE.softMaxS).toBe(0.25);
  });

  it('bands and applicability', () => {
    expect(DAY_BAND).toEqual([0.3, 0.5]);
    expect(NIGHT_BAND).toEqual([-0.5, -0.15]);
    expect(TERMINATOR_GATE.pixelSetMaxROverR).toBe(0.95);
    expect(TERMINATOR_GATE.minBandPixels).toBe(1000);
    expect(TERMINATOR_GATE.minBinPixels).toBe(200);
  });

  it('the S <= 0.25 threshold means a transition at least 0.08 wide in n·L', () => {
    // S = 0.02 / w <= 0.25  =>  w >= 0.08. Stated as an assertion so the claim cannot rot.
    expect(0.02 / 0.25).toBeCloseTo(0.08, 6);
  });
});

describe('gateTerminator — VISIBLE on the real curve, SOFT on the flat one', () => {
  const g = geom();

  /** A verdict with the fields the gate reads, so each case is explicit. */
  function verdict(over: Partial<TerminatorVerdict>): TerminatorVerdict {
    const base = evaluateTerminator(paint(g, ramp(0.4)), g);
    return { ...base, ...over };
  }

  it('passes when the real render is visible and the flat render is soft', () => {
    const real = verdict({ visible: true, soft: false, S: 0.294, failures: [] });
    const flat = verdict({ visible: true, soft: true, S: 0.0969, failures: [] });
    const v = gateTerminator(real, flat);
    expect(v.pass, v.failures.join('; ')).toBe(true);
    expect(v.catastrophePass).toBe(true);
  });

  it('SOFT comes from the FLAT curve: a soft real render cannot rescue a hard flat one', () => {
    /*
     * The failure this pins: swapping the two arguments would let a real render that happens to be
     * smooth upstream, and a flat render with a shader step, both pass. The flat curve is the one that
     * answers "is the lighting function soft".
     */
    const real = verdict({ visible: true, soft: true, S: 0.10, failures: [] }); // real LOOKS soft
    const flat = verdict({ visible: true, soft: false, S: 0.40, failures: [] }); // flat is HARD
    const v = gateTerminator(real, flat);
    expect(v.soft).toBe(false);
    expect(v.pass).toBe(false);
    expect(v.failures.join(' ')).toContain('albedo-neutral');
  });

  it('VISIBLE comes from the REAL curve: a visible flat render cannot rescue an invisible real one', () => {
    const real = verdict({ visible: false, soft: true, S: 0.10, failures: ['A 12.00 < 25 luma units'] });
    const flat = verdict({ visible: true, soft: true, S: 0.09, failures: [] });
    const v = gateTerminator(real, flat);
    expect(v.visible).toBe(false);
    expect(v.pass).toBe(false);
  });

  it('a real S >= 0.6 fails the catastrophe bound even when the flat curve is soft', () => {
    // The bound exists precisely for a hard step that survives the albedo correction.
    const real = verdict({ visible: true, soft: true, S: 0.75, failures: [] });
    const flat = verdict({ visible: true, soft: true, S: 0.09, failures: [] });
    const v = gateTerminator(real, flat);
    expect(v.catastrophePass).toBe(false);
    expect(v.pass).toBe(false);
    expect(v.failures.join(' ')).toContain('0.6');
  });

  it('classifies the catastrophe bound at exactly 0.59 / 0.60', () => {
    // The prompt's boundary: 0.59 passes, 0.60 fails. `<` not `<=`.
    const flatSoft = verdict({ visible: true, soft: true, S: 0.09, failures: [] });
    expect(gateTerminator(verdict({ visible: true, soft: true, S: 0.59, failures: [] }), flatSoft).catastrophePass).toBe(true);
    expect(gateTerminator(verdict({ visible: true, soft: true, S: 0.6, failures: [] }), flatSoft).catastrophePass).toBe(false);
  });

  it('reports NOT EVALUATED rather than passing when the geometry cannot support it', () => {
    const small: SunCameraGeometry = { ...g, r: 8 };
    const tiny = evaluateTerminator(paint(small, ramp(0.3)), small);
    const v = gateTerminator(tiny, tiny);
    expect(v.evaluated).toBe(false);
    expect(v.pass).toBe(false);
    expect(v.notEvaluatedReason).toContain('terminator not in view');
  });

  it('states the catastrophe constant the prompt fixed', () => {
    expect(CATASTROPHE_S).toBe(0.6);
    expect(TERMINATOR_GATE.softMaxS).toBe(0.25);
  });
});
