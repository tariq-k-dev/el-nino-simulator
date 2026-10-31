/**
 * PIN VALIDITY — the rule, and the defect it closed.
 *
 * The first test in this file is deliberately written against the OLD behaviour: it
 * keeps a copy of the retired coverage-only rule and shows, with numbers, that it marks
 * `horn-africa` at az 0 valid even though that pin faces away. That copy is the evidence
 * for why `isValidPin` exists; it is not used by any spec.
 *
 * The fixtures come from the measured F1b table (docs/globe-look/FACTS-2B.md V0(a)) —
 * real azimuths, real `n·cam`, real `r/R` — so the rule is tested against the geometry
 * the renderer actually produces rather than against invented decimals.
 */
import { describe, expect, it } from 'vitest';
import {
  PIN_VALIDITY,
  classifyPins,
  isValidPin,
  requireValidPins,
} from './pinValidity';

/** The F1b table: az, pin, n·cam, core r/R. Verbatim from docs/globe-look/FACTS-2B.md. */
const F1B = [
  { az: 0, id: 'pacific', facingDot: 0.4574, rOverR: 1.1013 },
  { az: 0, id: 'us-west', facingDot: 0.8561, rOverR: 0.7569 },
  { az: 0, id: 'se-asia', facingDot: -0.8877, rOverR: 0.375 },
  { az: 0, id: 'horn-africa', facingDot: -0.5747, rOverR: 0.7243 },
  { az: 90, id: 'horn-africa', facingDot: 0.74, rOverR: 0.938 },
  { az: 180, id: 'pacific', facingDot: -0.48, rOverR: 0.797 },
  { az: 180, id: 'se-asia', facingDot: 0.85, rOverR: 0.768 },
  { az: 180, id: 'horn-africa', facingDot: 0.67, rOverR: 1.0017 },
  { az: 270, id: 'pacific', facingDot: 0.8, rOverR: 0.857 },
  { az: 270, id: 'us-west', facingDot: 0.58, rOverR: 1.058 },
] as const;

const at = (az: number) => F1B.filter((p) => p.az === az);

describe('the retired coverage-only rule was wrong', () => {
  /**
   * `checkRingCast`'s old predicate, kept verbatim as evidence.
   *
   * It asks only "is at least 70% of the 30–60 px annulus inside the disc", which is a
   * question about where the pin PROJECTS, not about which side of the globe it is on.
   */
  const oldCoverageOnly = (annulusInsideFraction: number): boolean =>
    annulusInsideFraction >= 0.7;

  it('accepts horn-africa at az 0, which faces away', () => {
    const horn = F1B.find((p) => p.az === 0 && p.id === 'horn-africa')!;
    // horn-africa's core sits at 0.7243 R, well inside the disc, so its annulus is
    // mostly surface: 8,478-ish pixels, i.e. a coverage fraction near 1.
    const coverage = 1;
    expect(oldCoverageOnly(coverage)).toBe(true);
    expect(horn.facingDot).toBeLessThan(PIN_VALIDITY.minFacingDot);
    // The old rule called it measurable; the shared rule refuses it.
    expect(isValidPin(horn).valid).toBe(false);
    expect(isValidPin(horn).reason).toContain('faces away');
  });
});

describe('isValidPin', () => {
  it('rejects a back-facing pin even when its core is well inside the disc', () => {
    const verdict = isValidPin({ facingDot: -0.24, rOverR: 0.5 });
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toContain('faces away');
  });

  it('rejects a front-facing pin whose core floats past the limb at 1.100 R', () => {
    // pacific at az 0 — the handoff's §5.3 case: front-facing, but projected at 1.1013 R.
    const verdict = isValidPin({ facingDot: 0.4574, rOverR: 1.1013 });
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toContain('1.101');
  });

  it('rejects horn-africa at az 180, whose core projects at 1.0017 R', () => {
    const verdict = isValidPin({ facingDot: 0.67, rOverR: 1.0017 });
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toContain('projected core at 1.002 R');
    expect(verdict.reason).toContain(String(PIN_VALIDITY.maxROverR));
  });

  it('accepts a front-facing pin with a core inside the limb', () => {
    expect(isValidPin({ facingDot: 0.8561, rOverR: 0.7569 })).toEqual({
      valid: true,
      reason: 'valid',
    });
  });

  it('accepts exactly at the boundaries and rejects just past them', () => {
    // The rule is stated with >= and <=, so the boundary itself is valid. Asserted rather
    // than assumed: a spec that flipped one of these to > would silently shrink the set.
    expect(isValidPin({ facingDot: 0.1, rOverR: 0.97 }).valid).toBe(true);
    expect(isValidPin({ facingDot: 0.0999, rOverR: 0.97 }).valid).toBe(false);
    expect(isValidPin({ facingDot: 0.5, rOverR: 0.9701 }).valid).toBe(false);
  });

  it('treats non-finite geometry as INVALID, not valid', () => {
    // Every comparison with NaN is false, so a `!(bad)` predicate waves it through.
    expect(isValidPin({ facingDot: NaN, rOverR: 0.5 }).valid).toBe(false);
    expect(isValidPin({ facingDot: 0.5, rOverR: NaN }).valid).toBe(false);
  });
});

describe('the F1b fixtures', () => {
  it('az 0 yields only us-west', () => {
    const valid = classifyPins(at(0)).filter((p) => p.valid).map((p) => p.id);
    expect(valid).toEqual(['us-west']);
  });

  it('az 180 yields only se-asia', () => {
    const valid = classifyPins(at(180)).filter((p) => p.valid).map((p) => p.id);
    expect(valid).toEqual(['se-asia']);
  });

  it('az 90 yields only horn-africa, and az 270 only pacific', () => {
    expect(classifyPins(at(90)).filter((p) => p.valid).map((p) => p.id)).toEqual(['horn-africa']);
    expect(classifyPins(at(270)).filter((p) => p.valid).map((p) => p.id)).toEqual(['pacific']);
  });

  it('never yields all four pins at one azimuth', () => {
    // The property V0(c) established and the reason day+night needs az 300 or 330.
    for (const az of [0, 90, 180, 270]) {
      expect(classifyPins(at(az)).filter((p) => p.valid).length).toBeLessThanOrEqual(1);
    }
  });
});

describe('requireValidPins — vacuity is a FAILURE, never a skip', () => {
  it('throws when nothing is valid', () => {
    expect(() => requireValidPins([], 'at-least-one', '3.6 at az 30')).toThrow(/VACUOUS/);
  });

  it('names the caller in the message, so a failure points at the spec', () => {
    expect(() => requireValidPins([], 'at-least-one', '3.6 at az 30')).toThrow(/3\.6 at az 30/);
  });

  it('passes when one pin is valid', () => {
    expect(() => requireValidPins([{ side: 'day' }], 'at-least-one', '3.6 at az 0')).not.toThrow();
  });

  it('throws when day and night are not both represented', () => {
    expect(() =>
      requireValidPins([{ side: 'day' }, { side: 'day' }], 'some-day-and-some-night', '3.5'),
    ).toThrow(/VACUOUS/);
    expect(() =>
      requireValidPins([{ side: 'night' }], 'some-day-and-some-night', '3.5'),
    ).toThrow(/no day/);
  });

  it('passes when both sides are present', () => {
    expect(() =>
      requireValidPins([{ side: 'day' }, { side: 'night' }], 'some-day-and-some-night', '3.5 @ az 300'),
    ).not.toThrow();
  });
});
