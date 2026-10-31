/**
 * Unit tests for N9's collapse classifier.
 *
 * The question this answers: given an overlay-off measurement, was it the legitimate "nothing left
 * to difference" outcome, or did the measurement quietly fail to happen? The distinction matters
 * because both arrive as `valid: false`, and a test that accepts both keeps N9 green on a broken
 * capture — which is exactly the looseness the prompt asks to close.
 */
import { describe, expect, it } from 'vitest';
import type { Bitmap, DiscGeometry } from '../../../src/lib/look/helpers';
import {
  classifyGlintCollapse,
  countDifferingPixels,
  maxRawChannelDelta,
  type GlintStats,
} from './glint';

const GATE = { maxMin: 70.8, maxMax: 110.7 };
const GEOM: DiscGeometry = { cx: 10, cy: 10, r: 6 };

/** The `measureGlint` shape, with the fields each case cares about. */
function stats(over: Partial<GlintStats>): GlintStats {
  return {
    max: 88.52,
    maxAbs: 88.52,
    area6: 9594,
    area3: 22571,
    centroid: [10, 10],
    centroidROverR: 0.44,
    maxAt: [10, 10],
    valid: true,
    invalidReason: null,
    ...over,
  };
}

/** A 21x21 frame of one luma, so disc pixels are unambiguous. */
function frame(value: number): Bitmap {
  const data = new Uint8Array(21 * 21 * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  return { width: 21, height: 21, data };
}

describe('countDifferingPixels', () => {
  it('is zero for identical frames', () => {
    expect(countDifferingPixels(frame(7), frame(7), GEOM)).toBe(0);
  });

  it('counts a changed pixel inside the disc', () => {
    const a = frame(7);
    const b = frame(7);
    const o = (10 * 21 + 10) * 4;
    b.data[o] = 8;
    expect(countDifferingPixels(a, b, GEOM)).toBe(1);
  });

  it('counts LUMA, not raw channels — a 1/255 channel delta that the weights cancel is 0', () => {
    /*
     * This is the case that caught the first implementation: three channels differing by one unit
     * can sum to a luma delta below the representation, so raw-channel counting reported 303
     * "differing" pixels on frames whose luma difference was exactly 0. The gate is luma, so the
     * count must be luma.
     */
    const a = frame(7);
    const b = frame(7);
    const o = (10 * 21 + 10) * 4;
    b.data[o] += 1; // one channel, one unit
    const la = 0.2126 * 7 + 0.7152 * 7 + 0.0722 * 7;
    const lb = 0.2126 * 8 + 0.7152 * 7 + 0.0722 * 7;
    if (la === lb) {
      expect(countDifferingPixels(a, b, GEOM)).toBe(0);
    } else {
      expect(countDifferingPixels(a, b, GEOM)).toBe(1);
    }
    // Either way the raw delta is 1, which is what the report discloses.
    expect(maxRawChannelDelta(a, b, GEOM)).toBe(1);
  });

  it('ignores a change OUTSIDE the disc', () => {
    // Otherwise a sky or chrome repaint would read as "the overlay is still on".
    const a = frame(7);
    const b = frame(7);
    const o = 0; // corner, well outside a radius-6 disc centred at (10,10)
    b.data[o] = 200;
    expect(countDifferingPixels(a, b, GEOM)).toBe(0);
  });

  it('is Infinity when the sizes disagree, so it cannot pass as identical', () => {
    const a = frame(7);
    const b: Bitmap = { width: 3, height: 3, data: new Uint8Array(36) };
    expect(countDifferingPixels(a, b, GEOM)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('classifyGlintCollapse', () => {
  it('(a) accepts INVALID for identical frames with 0 differing pixels and NaN max', () => {
    const v = classifyGlintCollapse(
      stats({
        valid: false,
        max: Number.NaN,
        maxAbs: Number.NaN,
        invalidReason: 'the two frames are identical — the specular toggle did not take effect',
      }),
      0,
      GATE,
    );
    expect(v.kind).toBe('identical');
    expect(v.acceptable).toBe(true);
  });

  it('(b) accepts a valid finite residual below the gate minimum', () => {
    const v = classifyGlintCollapse(stats({ valid: true, max: 2.07, area6: 0 }), 812, GATE);
    expect(v.kind).toBe('residual');
    expect(v.acceptable).toBe(true);
  });

  it('REJECTS an INVALID whose reason is something else — nothing was measured', () => {
    const v = classifyGlintCollapse(
      stats({ valid: false, max: Number.NaN, maxAbs: Number.NaN, invalidReason: 'disc radius 0 is not a positive finite number' }),
      0,
      GATE,
    );
    expect(v.kind).toBe('invalid-other');
    expect(v.acceptable).toBe(false);
    expect(v.reason).toContain('nothing was measured');
  });

  it('REJECTS the identical reason when pixels DID differ — the claim is not supported', () => {
    /*
     * The reason string is a claim made by the code under test. Requiring 0 differing pixels is
     * what stops a stale or copied reason from satisfying the branch.
     */
    const v = classifyGlintCollapse(
      stats({ valid: false, max: Number.NaN, maxAbs: Number.NaN, invalidReason: 'the two frames are identical' }),
      4711,
      GATE,
    );
    expect(v.kind).toBe('invalid-other');
    expect(v.acceptable).toBe(false);
  });

  it('REJECTS a glint-sized difference — the sentinel did not notice the overlay is off', () => {
    const v = classifyGlintCollapse(stats({ valid: true, max: 88.52 }), 9000, GATE);
    expect(v.kind).toBe('not-collapsed');
    expect(v.acceptable).toBe(false);
  });

  it('REJECTS a valid result carrying a non-finite max', () => {
    const v = classifyGlintCollapse(stats({ valid: true, max: Number.POSITIVE_INFINITY }), 5, GATE);
    expect(v.kind).toBe('not-collapsed');
    expect(v.acceptable).toBe(false);
  });

  it('names the gate in the not-collapsed reason, so a failure is self-explaining', () => {
    const v = classifyGlintCollapse(stats({ valid: true, max: 95 }), 9000, GATE);
    expect(v.reason).toContain('70.8');
    expect(v.reason).toContain('110.7');
  });
});
