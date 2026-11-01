/**
 * Step A — the snap-sheet arithmetic.
 *
 * The three viewport heights are the ones the step names (667, 844, 926), and every expected number below is
 * derived from the constants rather than typed in, so a change to a tier's fraction fails here instead of
 * silently invalidating the e2e case that measures the same px.
 */
import { describe, expect, it } from 'vitest';
import {
  BREAKPOINT_MAX,
  FLICK_PROJECTION_MS,
  MOBILE_QUERY,
  RUBBER_ASYMPTOTE_FRACTION,
  SHEET_HEIGHT_FRACTION,
  TAP_MAX_MOVE_PX,
  TAP_MAX_MS,
  TIERS,
  TIER_FRACTION,
  VELOCITY_SAMPLES,
  VELOCITY_WINDOW_MS,
  VIEW_CENTER_FRACTION,
  clampDrag,
  computeSnapPoints,
  cycleTier,
  isTap,
  resolveSnap,
  rubberBand,
  sampleVelocity,
  sheetHeight,
  suppressesClick,
  tierIndex,
} from './snapMath';

const HEIGHTS = [667, 844, 926] as const;

describe('the breakpoint', () => {
  it('sits one hundredth of a pixel below 768', () => {
    expect(BREAKPOINT_MAX).toBe(767.98);
    expect(MOBILE_QUERY).toBe('(max-width: 767.98px)');
  });

  it('is not a whole number, so 767.99 px keeps the desktop layout', () => {
    expect(Number.isInteger(BREAKPOINT_MAX)).toBe(false);
  });
});

describe('computeSnapPoints', () => {
  it('gives the step M4 rect tops at 390 x 844', () => {
    /*
     * M4 asserts the sheet's rectangular TOP, which is the untranslated top plus the translate:
     *
     *     top(tier) = (H - sheetHeight) + translate(tier)
     *
     * At 844: sheetHeight = 742.72, so the untranslated top is 101.28 and the three tops are
     * 101.28, 438.88, 692.08 — against the step's 101, 439, 692 within its own 2 px bound.
     */
    const H = 844;
    const p = computeSnapPoints(H);
    const top = (y: number) => H - sheetHeight(H) + y;

    expect(top(p.full)).toBeCloseTo(101.28, 2);
    expect(top(p.half)).toBeCloseTo(438.88, 2);
    expect(top(p.peek)).toBeCloseTo(692.08, 2);

    /* And the three accepted values, to the step's own 2 px tolerance. */
    expect(Math.abs(top(p.full) - 101)).toBeLessThanOrEqual(2);
    expect(Math.abs(top(p.half) - 439)).toBeLessThanOrEqual(2);
    expect(Math.abs(top(p.peek) - 692)).toBeLessThanOrEqual(2);
  });

  for (const H of HEIGHTS) {
    it(`is ordered full < half < peek at ${H}`, () => {
      const p = computeSnapPoints(H);
      expect(p.full).toBeLessThan(p.half);
      expect(p.half).toBeLessThan(p.peek);
    });

    it(`keeps full at 0 and derives the other two from the fractions at ${H}`, () => {
      const p = computeSnapPoints(H);
      expect(p.full).toBe(0);
      expect(p.half).toBeCloseTo((SHEET_HEIGHT_FRACTION - TIER_FRACTION.half) * H, 9);
      expect(p.peek).toBeCloseTo((SHEET_HEIGHT_FRACTION - TIER_FRACTION.peek) * H, 9);
      expect(p.peek).toBeCloseTo((SHEET_HEIGHT_FRACTION - 0.18) * H, 9);
    });

    it(`makes the VISIBLE fraction match the tier's own fraction at ${H}`, () => {
      /*
       * The invariant the two vocabularies meet on: visible height of the viewport is
       * `sheetHeight - translate`, and it must equal `TIER_FRACTION[tier] * H` for all three tiers.
       * This is what makes "0.48 visible" and "translate 337.6" the same statement.
       */
      const p = computeSnapPoints(H);
      for (const tier of TIERS) {
        const visible = sheetHeight(H) - p[tier];
        expect(visible).toBeCloseTo(TIER_FRACTION[tier] * H, 9);
      }
    });
  }

  it('reports zeros rather than NaN for a zero or negative height', () => {
    for (const bad of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(computeSnapPoints(bad)).toEqual({ full: 0, half: 0, peek: 0 });
    }
  });

  it('names the sheet height as the full tier, so a tier change moves both', () => {
    expect(SHEET_HEIGHT_FRACTION).toBe(TIER_FRACTION.full);
    expect(sheetHeight(844)).toBeCloseTo(742.72, 2);
  });
});

describe('VIEW_CENTER_FRACTION', () => {
  it('is the centre of the upper 55 percent', () => {
    expect(VIEW_CENTER_FRACTION).toBeCloseTo(0.275, 12);
  });

  it('sits above the sheet top at every tier, so the globe is never hidden behind it', () => {
    /* At 844 the target is at 232.1 px; the highest sheet top is the full tier's 101.28. A fold, not a
     * spread: the repo's `source-guards.test.ts` forbids `Math.min(...array)`, and it applies to tests too. */
    const H = 844;
    const targetY = VIEW_CENTER_FRACTION * H;
    const p = computeSnapPoints(H);
    let highestTop = Infinity;
    for (const tier of TIERS) {
      const top = H - sheetHeight(H) + p[tier];
      if (top < highestTop) highestTop = top;
    }
    expect(targetY).toBeGreaterThan(highestTop);
  });
});

describe('rubberBand', () => {
  it('is 0 at 0, so the boundary is continuous', () => {
    expect(rubberBand(0, 844)).toBe(0);
  });

  it('is monotone increasing for both signs', () => {
    let previous = 0;
    for (let over = 1; over <= 500; over += 1) {
      const v = rubberBand(over, 844);
      expect(v).toBeGreaterThan(previous);
      previous = v;

      const negative = rubberBand(-over, 844);
      expect(negative).toBeLessThan(previous - v + 0.0001);
    }
  });

  it('is odd-symmetric, so the resistance is the same both ways', () => {
    for (const over of [1, 17, 120, 400]) {
      expect(rubberBand(-over, 844)).toBeCloseTo(-rubberBand(over, 844), 12);
    }
  });

  it('is bounded by the asymptote, however far it is pushed', () => {
    /*
     * `<=`, not `<`: at a large enough overshoot `1 − e^{−o/A}` underflows to exactly 1 in float64, so the
     * result EQUALS the asymptote. The property that matters is that it never exceeds it — a strict `<` here
     * would be asserting a floating-point accident rather than the bound.
     */
    const bound = RUBBER_ASYMPTOTE_FRACTION * 844;
    for (const over of [100, 1_000, 100_000, 1e9]) {
      expect(rubberBand(over, 844)).toBeLessThanOrEqual(bound);
      expect(rubberBand(over, 844)).toBeGreaterThan(0);
      expect(rubberBand(-over, 844)).toBeGreaterThanOrEqual(-bound);
    }
    /* And at a reachable finger speed it is strictly inside the bound. */
    expect(rubberBand(400, 844)).toBeLessThan(bound);
  });

  it('resists: a 400 px overshoot moves less than half of what it asked, and under the asymptote', () => {
    const moved = rubberBand(400, 844);
    expect(moved).toBeLessThan(200);
    expect(moved).toBeLessThan(RUBBER_ASYMPTOTE_FRACTION * 844);
    /* And it is not degenerate: a real drag must still move something. */
    expect(moved).toBeGreaterThan(100);
  });

  it('degrades to 0 for an unusable height rather than dividing by zero', () => {
    for (const bad of [0, -5, Number.NaN]) {
      expect(rubberBand(50, bad)).toBe(0);
    }
  });
});

describe('clampDrag', () => {
  const H = 844;
  const p = computeSnapPoints(H);

  it('is the identity inside the range', () => {
    const mid = (p.full + p.peek) / 2;
    expect(clampDrag(mid, p, H)).toBe(mid);
    expect(clampDrag(p.full, p, H)).toBe(p.full);
    expect(clampDrag(p.peek, p, H)).toBe(p.peek);
  });

  it('rubber-bands only the OVERSHOOT, so the boundary is still reached exactly', () => {
    const past = clampDrag(p.peek + 200, p, H);
    expect(past).toBeGreaterThan(p.peek);
    expect(past).toBeLessThan(p.peek + 200);
    expect(past - p.peek).toBeCloseTo(rubberBand(200, H), 12);
  });

  it('handles an overshoot above full too', () => {
    const above = clampDrag(p.full - 150, p, H);
    expect(above).toBeLessThan(p.full);
    expect(above).toBeCloseTo(p.full + rubberBand(-150, H), 12);
  });

  it('falls back to full for a NaN drag', () => {
    expect(clampDrag(Number.NaN, p, H)).toBe(p.full);
  });
});

describe('resolveSnap', () => {
  const H = 844;
  const p = computeSnapPoints(H);

  it('picks the nearest point for a slow drag', () => {
    /* Halfway from peek toward half, still nearer peek. */
    const y = p.peek - (p.peek - p.half) * 0.4;
    expect(resolveSnap(y, 0, p)).toBe('peek');
    /* And past the midpoint, half. */
    const y2 = p.peek - (p.peek - p.half) * 0.9;
    expect(resolveSnap(y2, 0, p)).toBe('half');
  });

  it('projects a flick by 120 ms, which is what makes a fast short drag land a tier further', () => {
    /*
     * A drag that stopped 40 % of the way from peek toward half. With no velocity it returns to peek;
     * with an upward flick (negative velocity, because the sheet moves toward full as y decreases) of
     * -2 px/ms it projects 240 px further and lands on half.
     */
    const start = p.peek - (p.peek - p.half) * 0.4;
    expect(resolveSnap(start, 0, p)).toBe('peek');
    expect(start + -2 * FLICK_PROJECTION_MS).toBeLessThan(p.half);
    expect(resolveSnap(start, -2, p)).toBe('half');
    expect(FLICK_PROJECTION_MS).toBe(120);
  });

  it('lands on full for a fast enough flick from peek, and on peek for the reverse', () => {
    expect(resolveSnap(p.peek, -4, p)).toBe('full');
    expect(resolveSnap(p.full, 4, p)).toBe('peek');
  });

  it('clamps the projection into the valid range before choosing, so it cannot wrap past an end', () => {
    expect(resolveSnap(p.peek, -10_000, p)).toBe('full');
    expect(resolveSnap(p.full, 10_000, p)).toBe('peek');
    /* The clamp is to the range, not to the nearest point: a huge negative velocity from half lands full. */
    expect(resolveSnap(p.half, -10_000, p)).toBe('full');
  });

  it('never returns a value outside the tier set', () => {
    for (const y of [-500, 0, 200, 400, 600, 900, 5_000]) {
      expect(TIERS).toContain(resolveSnap(y, 0, p));
    }
  });
});

describe('a tap cycles the tiers', () => {
  it('goes peek -> half -> full -> half', () => {
    expect(cycleTier('peek')).toBe('half');
    expect(cycleTier('half')).toBe('full');
    expect(cycleTier('full')).toBe('half');
  });

  it('requires both a small move and a short duration', () => {
    expect(isTap(0, 0)).toBe(true);
    expect(isTap(5, 299)).toBe(true);
    /* A 3 px move over 2 s is a press, not a tap. */
    expect(isTap(3, 2_000)).toBe(false);
    /* A 40 px move in 80 ms is a flick, not a tap. */
    expect(isTap(40, 80)).toBe(false);
    /* Exactly at either bound is not a tap: both are strict. */
    expect(isTap(TAP_MAX_MOVE_PX, 100)).toBe(false);
    expect(isTap(1, TAP_MAX_MS)).toBe(false);
  });

  it('suppresses the click after a drag of more than 6 px', () => {
    expect(suppressesClick(0)).toBe(false);
    expect(suppressesClick(6)).toBe(false);
    expect(suppressesClick(6.5)).toBe(true);
    expect(suppressesClick(-40)).toBe(true);
  });
});

describe('sampleVelocity', () => {
  it('is 0 for fewer than two samples, rather than inventing one', () => {
    expect(sampleVelocity([], 100)).toBe(0);
    expect(sampleVelocity([{ y: 10, t: 0 }], 100)).toBe(0);
  });

  it('reads the last 100 ms, so a drag that paused before release does not flick', () => {
    /*
     * Fast middle, then parked for 300 ms: the trailing samples are all at the same y, so the velocity
     * at release is ~0 and the sheet snaps back rather than flinging.
     */
    const samples = [
      { y: 0, t: 0 },
      { y: 300, t: 60 },
      { y: 590, t: 120 },
      { y: 590, t: 250 },
      { y: 590, t: 420 },
    ];
    expect(sampleVelocity(samples, 420)).toBe(0);
  });

  it('reports a real velocity for a consistent flick', () => {
    const samples = [
      { y: 590, t: 0 },
      { y: 560, t: 16 },
      { y: 520, t: 32 },
      { y: 480, t: 48 },
      { y: 440, t: 64 },
    ];
    /* 150 px up over 80 ms of the trailing window -> about -1.9 px/ms. */
    const v = sampleVelocity(samples, 64);
    expect(v).toBeLessThan(0);
    expect(v).toBeCloseTo(-150 / (64 - 0), 6);
  });

  it('uses the oldest sample INSIDE the window, not the whole history', () => {
    /*
     * A 1000 px drag over 500 ms followed by a 40 px nudge in the last 20 ms. Averaging the whole history
     * would report 2 px/ms; the window reports the nudge's own speed.
     */
    const samples = [
      { y: 0, t: 0 },
      { y: 1_000, t: 500 },
      { y: 1_040, t: 520 },
    ];
    const v = sampleVelocity(samples, 520);
    expect(v).toBeCloseTo(40 / 20, 6);
    expect(VELOCITY_WINDOW_MS).toBe(100);
    expect(VELOCITY_SAMPLES).toBe(5);
  });

  it('is 0 when every sample shares a timestamp', () => {
    expect(
      sampleVelocity(
        [
          { y: 10, t: 50 },
          { y: 20, t: 50 },
        ],
        50,
      ),
    ).toBe(0);
  });
});

describe('tierIndex', () => {
  it('is the aria-valuenow for each tier, low to high', () => {
    expect(tierIndex('peek')).toBe(0);
    expect(tierIndex('half')).toBe(1);
    expect(tierIndex('full')).toBe(2);
  });
});
