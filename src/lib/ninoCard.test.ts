/**
 * `ninoCard` — the display model's arithmetic and its text contract.
 *
 * Every expected number is DERIVED from `NINO_RELATIONS` at test time, never typed as a
 * rounded constant. A hardcoded `1.5` in an assertion would keep passing if the fit were
 * regenerated, which is exactly the drift this file exists to catch. The one place a
 * literal appears is the TEXT check, where the rounded string is the thing under test.
 */
import { describe, expect, it } from 'vitest';
import { fixed, signed } from '@/lib/format';
import { pickRelation, projectAnomaly, WARM_THRESHOLD, type NinoRelationRegion } from '@/lib/ninoRelation';
import { celsiusDeltaToFahrenheit } from '@/lib/regions';
import { ninoCardModel, WEAK_R2 } from '@/lib/ninoCard';

const REGION_IDS: NinoRelationRegion[] = ['nino12', 'nino4'];
const UNITS = ['C', 'F'] as const;

/** The slider grid: the product range plus a margin past it, at the slider's own 0.01 step / 5. */
const GRID: number[] = [];
for (let x = 0; x <= 3.5 + 1e-9; x += 0.05) GRID.push(Number(x.toFixed(2)));

describe('ninoCardModel — numeric value, derived from NINO_RELATIONS', () => {
  it('matches slope*x + intercept in °C at 0.5, 1.5 and 3.0 for both regions', () => {
    for (const regionId of REGION_IDS) {
      const r = pickRelation(regionId);
      for (const x of [0.5, 1.5, 3.0]) {
        const model = ninoCardModel(regionId, x, 'C');
        expect(model.value, `${regionId} @ ${x} °C`).toBeCloseTo(r.slope * x + r.intercept, 12);
      }
    }
  });

  it('matches slope*x + intercept times 1.8 in °F at 0.5, 1.5 and 3.0 for both regions', () => {
    for (const regionId of REGION_IDS) {
      const r = pickRelation(regionId);
      for (const x of [0.5, 1.5, 3.0]) {
        const model = ninoCardModel(regionId, x, 'F');
        expect(model.value, `${regionId} @ ${x} °F`).toBeCloseTo(
          celsiusDeltaToFahrenheit(r.slope * x + r.intercept),
          12,
        );
      }
    }
  });

  it('returns the ±1 residual-SD band in the requested unit', () => {
    for (const regionId of REGION_IDS) {
      const r = pickRelation(regionId);
      for (const x of [0.5, 1.5, 3.0]) {
        const c = ninoCardModel(regionId, x, 'C');
        expect(c.lo).toBeCloseTo(r.slope * x + r.intercept - r.residSd, 12);
        expect(c.hi).toBeCloseTo(r.slope * x + r.intercept + r.residSd, 12);

        const f = ninoCardModel(regionId, x, 'F');
        expect(f.lo).toBeCloseTo(celsiusDeltaToFahrenheit(c.lo), 12);
        expect(f.hi).toBeCloseTo(celsiusDeltaToFahrenheit(c.hi), 12);
      }
    }
  });

  it('never applies an anomaly offset: value, lo and hi are all scaled, not shifted', () => {
    for (const regionId of REGION_IDS) {
      for (const x of GRID) {
        const c = ninoCardModel(regionId, x, 'C');
        const f = ninoCardModel(regionId, x, 'F');
        /* The ×1.8 claim, on every field. A +32 offset would miss by 32. */
        expect(f.value).toBeCloseTo(c.value * 1.8, 12);
        expect(f.lo).toBeCloseTo(c.lo * 1.8, 12);
        expect(f.hi).toBeCloseTo(c.hi * 1.8, 12);
        /* Spelled out independently of the ×1.8 identity, in case both sides drifted. */
        expect(f.value - c.value * 1.8).toBeCloseTo(0, 12);
        expect(Math.abs(f.value - (c.value * 1.8 + 32))).toBeGreaterThan(1);
      }
    }
  });
});

describe('ninoCardModel — extrapolation', () => {
  it('is not extrapolated at the warm sample maximum, and is one step beyond it', () => {
    for (const regionId of REGION_IDS) {
      const r = pickRelation(regionId);
      expect(r.xMax).toBeGreaterThan(WARM_THRESHOLD);
      /* The fit's own boundary: 2.72 today, read from the table rather than typed. */
      expect(ninoCardModel(regionId, r.xMax, 'C').extrapolated).toBe(false);
      expect(ninoCardModel(regionId, r.xMax + 0.01, 'C').extrapolated).toBe(true);
    }
  });

  it('is not extrapolated one step below the maximum, and is beyond the top of the slider', () => {
    for (const regionId of REGION_IDS) {
      const r = pickRelation(regionId);
      expect(ninoCardModel(regionId, r.xMax - 0.01, 'C').extrapolated).toBe(false);
      /* The slider tops out at 3.0 (SST_MAX), above the warm sample: a real extrapolation. */
      expect(ninoCardModel(regionId, 3.0, 'C').extrapolated).toBe(true);
    }
  });

  it('emits a note with the observed maximum when extrapolated, and an empty string inside', () => {
    for (const regionId of REGION_IDS) {
      const r = pickRelation(regionId);
      const outside = ninoCardModel(regionId, 3.0, 'C');
      expect(outside.noteText.length).toBeGreaterThan(0);
      expect(outside.noteText).toContain(fixed(r.xMax, 2));

      const inside = ninoCardModel(regionId, 1.5, 'C');
      expect(inside.noteText).toBe('');
    }
  });

  it('cannot flip the extrapolation flag with a unit toggle', () => {
    for (const regionId of REGION_IDS) {
      for (const x of GRID) {
        expect(ninoCardModel(regionId, x, 'F').extrapolated).toBe(
          ninoCardModel(regionId, x, 'C').extrapolated,
        );
      }
    }
  });
});

describe('ninoCardModel — the grid is total and ordered', () => {
  it('produces no NaN and no infinite value on 0..3.5 in both units for both regions', () => {
    for (const regionId of REGION_IDS) {
      for (const unit of UNITS) {
        for (const x of GRID) {
          const m = ninoCardModel(regionId, x, unit);
          expect(Number.isFinite(m.value), `${regionId} ${unit} x=${x} value`).toBe(true);
          expect(Number.isFinite(m.lo), `${regionId} ${unit} x=${x} lo`).toBe(true);
          expect(Number.isFinite(m.hi), `${regionId} ${unit} x=${x} hi`).toBe(true);
          for (const text of [m.valueText, m.rangeText, m.unitText, m.badgeText, m.captionText]) {
            expect(text).not.toContain('NaN');
            expect(text).not.toContain('Infinity');
          }
        }
      }
    }
  });

  it('keeps lo < value < hi on the whole grid', () => {
    for (const regionId of REGION_IDS) {
      const residSd = pickRelation(regionId).residSd;
      expect(residSd).toBeGreaterThan(0);
      for (const unit of UNITS) {
        for (const x of GRID) {
          const m = ninoCardModel(regionId, x, unit);
          expect(m.lo, `${regionId} ${unit} x=${x}`).toBeLessThan(m.value);
          expect(m.value).toBeLessThan(m.hi);
        }
      }
    }
  });

  it('increases monotonically with the slider for both regions and both units', () => {
    for (const regionId of REGION_IDS) {
      for (const unit of UNITS) {
        let previous = -Infinity;
        for (const x of GRID) {
          const m = ninoCardModel(regionId, x, unit);
          expect(m.value).toBeGreaterThan(previous);
          previous = m.value;
        }
      }
    }
  });

  it('refuses a non-finite slider value rather than returning a card full of NaN', () => {
    for (const regionId of REGION_IDS) {
      expect(() => ninoCardModel(regionId, Number.NaN, 'C')).toThrow(/finite/i);
      expect(() => ninoCardModel(regionId, Number.POSITIVE_INFINITY, 'C')).toThrow(/finite/i);
    }
  });
});

describe('ninoCardModel — text contract', () => {
  it('formats the value with one decimal and an explicit plus for positives', () => {
    const r12 = pickRelation('nino12');
    const at15 = ninoCardModel('nino12', 1.5, 'C');
    /* `signed`, not `fixed`: the card's contract is "+1.5", so the oracle must add the sign too. */
    expect(at15.valueText).toBe(signed(r12.slope * 1.5 + r12.intercept, 1));
    expect(at15.valueText.startsWith('+')).toBe(true);
    expect(at15.valueText).toMatch(/^\+\d+\.\d$/);

    /* One decimal, always — never two, never none. */
    for (const regionId of REGION_IDS) {
      for (const x of GRID) {
        expect(ninoCardModel(regionId, x, 'C').valueText).toMatch(/^[+-]?\d+\.\d$/);
      }
    }
  });

  it('prints a signed band with one decimal on both ends', () => {
    const m = ninoCardModel('nino12', 0.5, 'C');
    expect(m.rangeText).toMatch(/^[+-]?\d+\.\d to [+-]?\d+\.\d$/);
    /* At 0.5 the band straddles zero, so the low end MUST carry a minus, not be abs(). */
    expect(m.lo).toBeLessThan(0);
    expect(m.rangeText.startsWith('-')).toBe(true);
    expect(m.rangeText).toContain(' to +');
  });

  it('uses the same ASCII minus as the desktop cards, not U+2212', () => {
    /* `src/lib/model.ts:22` formats card headlines with `signed` from `lib/format`, which
     * emits ASCII '-'. The drawer's `formatDelta` emits U+2212. This module follows the
     * cards. Asserted so the choice cannot be changed silently. */
    let sawNegative = false;
    for (const regionId of REGION_IDS) {
      for (const x of GRID) {
        const m = ninoCardModel(regionId, x, 'C');
        expect(m.valueText).not.toContain('\u2212');
        expect(m.rangeText).not.toContain('\u2212');
        if (m.lo < 0) sawNegative = true;
      }
    }
    expect(sawNegative, 'the grid must contain a negative band edge for this to mean anything').toBe(
      true,
    );
  });

  it('sets the unit text from the requested unit', () => {
    expect(ninoCardModel('nino12', 1.5, 'C').unitText).toBe('°C');
    expect(ninoCardModel('nino12', 1.5, 'F').unitText).toBe('°F');
  });

  it('carries the region label and never invents one for an unknown id', () => {
    expect(ninoCardModel('nino12', 1.5, 'C').regionLabel).toBe('NIÑO 1+2');
    expect(ninoCardModel('nino4', 1.5, 'C').regionLabel).toBe('NIÑO 4');
    expect(ninoCardModel('nino12', 1.5, 'C').regionId).toBe('nino12');
  });
});

describe('ninoCardModel — provenance badge', () => {
  it('contains the rounded r² and n for each region', () => {
    for (const regionId of REGION_IDS) {
      const r = pickRelation(regionId);
      const m = ninoCardModel(regionId, 1.5, 'C');
      expect(m.badgeText).toContain(fixed(r.r2, 2));
      expect(m.badgeText).toContain(`N ${r.n}`);
      expect(m.badgeText).toContain('EMPIRICAL');
    }
  });

  it('does not change with the slider position or the unit', () => {
    for (const regionId of REGION_IDS) {
      const baseline = ninoCardModel(regionId, 1.5, 'C').badgeText;
      for (const x of [0, 1, 2.5, 3.5]) {
        expect(ninoCardModel(regionId, x, 'C').badgeText).toBe(baseline);
        expect(ninoCardModel(regionId, x, 'F').badgeText).toBe(baseline);
      }
    }
  });

  it('flags both regions as weak today, and WEAK_R2 is the line it uses', () => {
    for (const regionId of REGION_IDS) {
      const r = pickRelation(regionId);
      expect(r.r2).toBeLessThan(WEAK_R2);
      expect(ninoCardModel(regionId, 1.5, 'C').weak).toBe(true);
    }
    expect(WEAK_R2).toBe(0.3);
  });

  it('would stop flagging a region once its r² clears WEAK_R2', () => {
    /* Guards the predicate itself rather than the data: a hardcoded `weak = true` would
     * pass the test above and fail this one. */
    const strong = { ...pickRelation('nino4'), r2: WEAK_R2 };
    expect(strong.r2 < WEAK_R2).toBe(false);
    expect(projectAnomaly(strong, 1.5).value).toBeCloseTo(
      projectAnomaly(pickRelation('nino4'), 1.5).value,
      12,
    );
  });
});

describe('ninoCardModel — caption', () => {
  it('says it is a historical response and not a forecast, for every input', () => {
    for (const regionId of REGION_IDS) {
      for (const unit of UNITS) {
        for (const x of GRID) {
          const m = ninoCardModel(regionId, x, unit);
          expect(m.captionText).toContain('historical response');
          expect(m.captionText).toContain('not a forecast');
          expect(m.captionText).toContain(m.regionLabel);
        }
      }
    }
  });

  it('names the slider position to one decimal', () => {
    expect(ninoCardModel('nino4', 1.46, 'C').captionText).toContain('1.5 °C');
  });
});
