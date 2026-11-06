/**
 * Niño box schema — inertness and geometry.
 *
 * Two jobs, and the first one is the reason this file exists at all:
 *
 *  1. **Prove the schema is inert.** `NINO_BOXES` is a separate export from
 *     `REGIONS`, and the tests below pin the region list to its shipped length and
 *     ids. A future step that folds a box into `REGIONS` (to render a fifth card,
 *     say) turns these red HERE, in the unit gate, rather than in a locked e2e spec
 *     that only runs in the batched suite — `pin-click.spec.ts:830,909` both assert
 *     a literal 4.
 *  2. **Pin the geometry.** The dateline is where a box helper goes quietly wrong:
 *     a naive `lon >= west && lon <= east` returns the complement of Niño 4 (310
 *     degrees of ocean instead of 50). Every case below is one an implementation
 *     that ignored the crossing would fail.
 *
 * All boundaries are asserted from BOTH sides (inside at 160, outside at 159.9), so
 * an off-by-one in the comparison cannot pass as "close enough".
 */
import { describe, expect, it } from 'vitest';
import {
  NINO34_REFERENCE_BOX,
  NINO_BOXES,
  REGIONS,
  REGION_MAP,
  boxContainsPoint,
  boxLon360Ranges,
  boxLonSpan,
  normalizeLon180,
  toLon360,
  type NinoBox,
} from '@/lib/regions';

const box = (id: 'nino12' | 'nino4' | 'nino34'): NinoBox => {
  if (id === 'nino34') return NINO34_REFERENCE_BOX;
  const found = NINO_BOXES.find((b) => b.id === id);
  if (!found) throw new Error(`missing box ${id}`);
  return found;
};

describe('the region list is unchanged by the box schema', () => {
  it('still has exactly the six shipped entries, in order', () => {
    expect(REGIONS).toHaveLength(6);
    expect(REGIONS.map((r) => r.id)).toEqual([
      'pacific',
      'us-west',
      'se-asia',
      'horn-africa',
      'amazon-basin',
      'gulf-coast',
    ]);
  });

  it('still has exactly those six ids in the lookup map', () => {
    expect(Object.keys(REGION_MAP).sort()).toEqual([
      'amazon-basin',
      'gulf-coast',
      'horn-africa',
      'pacific',
      'se-asia',
      'us-west',
    ]);
  });

  it('keeps NINO_BOXES out of the region list entirely', () => {
    // Not a spread, not a push, not a derivation: the two id spaces are disjoint,
    // so a box id can never resolve through REGION_MAP to a card or a pin.
    const regionIds = new Set(REGIONS.map((r) => String(r.id)));
    for (const b of NINO_BOXES) {
      expect(regionIds.has(b.id)).toBe(false);
      expect(REGION_MAP[b.id as unknown as keyof typeof REGION_MAP]).toBeUndefined();
    }
  });

  it('leaves every shipped coordinate and zoom untouched', () => {
    expect(REGIONS.map((r) => [r.lat, r.lon, r.zoom])).toEqual([
      [-2, -150, 2.9],
      [37, -120, 2.6],
      [-3, 112, 2.7],
      [8, 42, 2.7],
      [-3.46, -62.21, 2.7],
      [28.5, -90, 2.6],
    ]);
  });
});

describe('NINO_BOXES — shape', () => {
  it('declares the two boxes this step defines, and no more', () => {
    expect(NINO_BOXES.map((b) => b.id)).toEqual(['nino12', 'nino4']);
  });

  it('every box has latMin < latMax and all-finite coordinates', () => {
    for (const b of NINO_BOXES) {
      expect(b.latMin, `${b.id} latMin < latMax`).toBeLessThan(b.latMax);
      for (const value of [b.latMin, b.latMax, b.lonWest, b.lonEast, b.anchorLat, b.anchorLon]) {
        expect(Number.isFinite(value), `${b.id} has a non-finite coordinate`).toBe(true);
      }
      // -180..180 is the stored convention; the 0..360 form is helpers-only.
      expect(b.lonWest).toBeGreaterThanOrEqual(-180);
      expect(b.lonWest).toBeLessThanOrEqual(180);
      expect(b.lonEast).toBeGreaterThanOrEqual(-180);
      expect(b.lonEast).toBeLessThanOrEqual(180);
      expect(b.label.length).toBeGreaterThan(0);
    }
  });

  it('every anchor sits inside its own box', () => {
    for (const b of NINO_BOXES) {
      expect(boxContainsPoint(b, b.anchorLat, b.anchorLon), `${b.id} anchor`).toBe(true);
    }
  });

  it('anchors are the box centres the prompt names', () => {
    expect([box('nino12').anchorLat, box('nino12').anchorLon]).toEqual([-5, -85]);
    expect([box('nino4').anchorLat, box('nino4').anchorLon]).toEqual([0, -175]);
  });
});

describe('boxContainsPoint — Niño 4 across the antimeridian', () => {
  const n4 = box('nino4');

  it.each([
    [0, 175],
    [0, -175],
    [0, 160],
    [0, -150],
    [4.9, 180],
  ])('contains (%s, %s)', (lat, lon) => {
    expect(boxContainsPoint(n4, lat, lon)).toBe(true);
  });

  it.each([
    [0, 159.9],
    [0, -149.9],
    [6, 180],
  ])('excludes (%s, %s)', (lat, lon) => {
    expect(boxContainsPoint(n4, lat, lon)).toBe(false);
  });

  it('does not contain the complement of the box', () => {
    // The failure mode of a naive west<=lon<=east: -175 is in, 0 (Greenwich) is not.
    expect(boxContainsPoint(n4, 0, 0)).toBe(false);
    expect(boxContainsPoint(n4, 0, 110)).toBe(false);
  });
});

describe('boxContainsPoint — Niño 1+2 off Peru', () => {
  const n12 = box('nino12');

  it('contains the box centre (-5, -85)', () => {
    expect(boxContainsPoint(n12, -5, -85)).toBe(true);
  });

  it.each([
    [5, -85],
    [-5, -75],
  ])('excludes (%s, %s)', (lat, lon) => {
    expect(boxContainsPoint(n12, lat, lon)).toBe(false);
  });

  it('is the 10-degree strip the CPC defines, nothing wider', () => {
    expect(boxContainsPoint(n12, -0.1, -89.9)).toBe(true);
    expect(boxContainsPoint(n12, -9.9, -80.1)).toBe(true);
    expect(boxContainsPoint(n12, -10.1, -85)).toBe(false);
    expect(boxContainsPoint(n12, 0.1, -85)).toBe(false);
  });
});

describe('boxLonSpan', () => {
  it('is 10 for Niño 1+2, 50 for Niño 4, 50 for Niño 3.4', () => {
    expect(boxLonSpan(box('nino12'))).toBe(10);
    expect(boxLonSpan(box('nino4'))).toBe(50);
    expect(boxLonSpan(box('nino34'))).toBe(50);
  });

  it('never reports a negative span, even though 160 - -150 is -310 eastward', () => {
    for (const b of NINO_BOXES) {
      expect(boxLonSpan(b)).toBeGreaterThan(0);
      expect(boxLonSpan(b)).toBeLessThanOrEqual(360);
    }
  });
});

describe('boxLon360Ranges — the form a BETWEEN filter needs', () => {
  it('collapses Niño 4 to a single [160, 210] range', () => {
    expect(boxLon360Ranges(box('nino4'))).toEqual([[160, 210]]);
  });

  it('gives Niño 1+2 a single range west of the prime meridian', () => {
    expect(boxLon360Ranges(box('nino12'))).toEqual([[270, 280]]);
  });

  it('returns TWO ranges for a synthetic box that crosses 0 degrees longitude', () => {
    // -10..10 spans the prime meridian: 350..360 plus 0..10, which cannot be one
    // BETWEEN clause. A box crossing the antimeridian is the mirror case (above).
    const primeMeridian: NinoBox = {
      id: 'nino12',
      label: 'SYNTHETIC',
      latMin: -1,
      latMax: 1,
      lonWest: -10,
      lonEast: 10,
      anchorLat: 0,
      anchorLon: 0,
    };
    expect(boxLon360Ranges(primeMeridian)).toEqual([
      [0, 10],
      [350, 360],
    ]);
    expect(boxLonSpan(primeMeridian)).toBe(20);
  });

  it('produces ranges whose total width equals the span, for every box', () => {
    for (const b of [...NINO_BOXES, NINO34_REFERENCE_BOX]) {
      const total = boxLon360Ranges(b).reduce((sum, [min, max]) => sum + (max - min), 0);
      expect(total, `${b.id} range width`).toBeCloseTo(boxLonSpan(b), 9);
    }
  });
});

describe('the longitude convention, stated and pinned', () => {
  /**
   * THE RULE: `normalizeLon180` is a CLOSED interval. -180..180 map to themselves,
   * sign preserved on both endpoints; only out-of-range inputs wrap, and a positive
   * input landing exactly on the antimeridian reports +180 so that 180 and 540 agree.
   * `-180` therefore stays -180 while `180` stays 180 — the two endpoints are NOT
   * aliased. That is what keeps a stored box readable in a diff: rewriting 180 as
   * -180 would be arithmetically harmless and would look like a coordinate change.
   */
  it('maps 190 to -170', () => {
    expect(normalizeLon180(190)).toBe(-170);
  });

  it('keeps -180 as -180', () => {
    expect(normalizeLon180(-180)).toBe(-180);
  });

  it('keeps 180 as 180', () => {
    expect(normalizeLon180(180)).toBe(180);
  });

  it('is idempotent and agrees with 360-equivalents', () => {
    for (const lon of [0, 179.9, -179.9, 190, -190, 370, -370, 540]) {
      const once = normalizeLon180(lon);
      expect(normalizeLon180(once), `${lon} idempotence`).toBe(once);
      expect(once).toBeGreaterThanOrEqual(-180);
      expect(once).toBeLessThanOrEqual(180);
    }
    expect(normalizeLon180(540)).toBe(normalizeLon180(180));
    expect(normalizeLon180(-540)).toBe(normalizeLon180(-180));
  });

  it('toLon360 covers 0..360 and puts the dateline at 180', () => {
    expect(toLon360(-170)).toBe(190);
    expect(toLon360(190)).toBe(190);
    expect(toLon360(0)).toBe(0);
    expect(toLon360(-180)).toBe(180);
    expect(toLon360(180)).toBe(180);
    for (const lon of [0, 90, -90, 179.9, -179.9, 190, -170]) {
      const wrapped = toLon360(lon);
      expect(wrapped).toBeGreaterThanOrEqual(0);
      expect(wrapped).toBeLessThanOrEqual(360);
    }
  });

  it('rejects non-finite input rather than returning NaN', () => {
    expect(() => normalizeLon180(Number.NaN)).toThrow(RangeError);
    expect(boxContainsPoint(box('nino4'), Number.NaN, 170)).toBe(false);
    expect(boxContainsPoint(box('nino4'), 0, Number.POSITIVE_INFINITY)).toBe(false);
  });
});
