/**
 * PIN VALIDITY — one rule, one implementation, every pixel spec.
 *
 * Why this module exists. Validity was duplicated: `checkPins` tested `n·cam >= 0.1`
 * and `r/R <= 0.97`, while `checkRingCast` tested ANNULUS COVERAGE (`a.count / 8478
 * >= 0.7`) and nothing else. Coverage is not facing: `horn-africa` at az 0 faces away
 * (n·cam −0.5747) but its 30–60 px annulus still lands mostly inside the disc, so
 * `checkRingCast` called it valid. That is how the first N1 attempt ended up injecting a
 * light on the FAR side of the globe and reporting no change: the check had handed it a
 * back-facing pin and called it measurable.
 *
 * The duplication is what allowed that. A rule stated once cannot disagree with itself,
 * so 3.5, 3.6 and every negative test now call `isValidPin`.
 *
 * THE RULE (from the measured F1b table):
 *
 *   valid  iff  facingDot >= 0.1        -- the pin is on the near side
 *           AND rOverR   <= 0.97        -- its core is inside the fitted limb
 *
 * Both halves are needed. `facingDot` alone admits a pin whose core has floated past the
 * limb (pins sit at 1.10242 R by design — see docs/globe-look/FACTS-2B.md §5.3), and
 * `rOverR` alone admits a pin on the far side, which is exactly horn-africa's case.
 *
 * PIN FRAMES ARE NOT CENTRED AT ONE RADIUS. The four anchors all sit at |position|
 * 1.10242, and yet their cores project to r/R 0.375 … 1.101 because r/R is measured from
 * the DISC CENTRE in screen space, not from the globe's centre in world space. A pin near
 * the limb is foreshortened toward it, so the same world radius reads as anything from
 * 0.37 to 1.10 depending on where it is on the sphere. That is why the bound is on the
 * projected quantity, and why it can be exceeded without any pin floating.
 *
 * This module is PURE on purpose: no import from `./capture` or `./acquire`, no
 * `window`, no `page`. `analysis.ts` imports it, and `purity.test`-style guards in
 * `look/analysis.test` forbid exactly those references, so keeping the rule here is what
 * lets a check apply it without gaining the ability to touch the scene.
 */

/** The rule's constants, quoted by tests and reports instead of being repeated. */
export const PIN_VALIDITY = {
  /** Minimum `normal·camDir` for a pin to count as front-facing. */
  minFacingDot: 0.1,
  /** Maximum projected core `r/R_fit`. Above this the core is off the disc. */
  maxROverR: 0.97,
} as const;

/** The minimum `isValidPin` needs to know. Structural, so any caller's shape fits. */
export interface PinValidityInput {
  /** Pin identity, used only in the human-readable reason. */
  id?: string;
  /** Normal of the pin's surface point · unit vector from that point to the camera. */
  facingDot: number;
  /** Distance of the projected CORE from the disc centre, over the fitted radius. */
  rOverR: number;
}

export interface PinValidity {
  valid: boolean;
  /** 'valid', or the reason it is not — never empty, so a report can always print it. */
  reason: string;
}

/**
 * Is this pin measurable in a pixel spec? The single implementation.
 *
 * Order matters only for the message: a pin can fail both tests, and reporting facing
 * first names the more fundamental of the two (a far-side pin is unmeasurable no matter
 * where its core projects).
 */
export function isValidPin(
  pin: PinValidityInput,
  opts: { minFacingDot?: number; maxROverR?: number } = {},
): PinValidity {
  const { minFacingDot = PIN_VALIDITY.minFacingDot, maxROverR = PIN_VALIDITY.maxROverR } = opts;

  /*
   * NaN is INVALID, not valid. Every comparison against NaN is false, so a `!(...)`
   * predicate would wave it through — and a NaN facing dot comes from a pin whose anchor
   * could not be resolved, which is exactly the case that must not be measured.
   */
  if (!Number.isFinite(pin.facingDot) || !Number.isFinite(pin.rOverR)) {
    return { valid: false, reason: `non-finite geometry (n·cam ${pin.facingDot}, r/R ${pin.rOverR})` };
  }

  if (pin.facingDot < minFacingDot) {
    return {
      valid: false,
      reason: `faces away (normal·camDir ${pin.facingDot.toFixed(3)} < ${minFacingDot})`,
    };
  }
  if (pin.rOverR > maxROverR) {
    return { valid: false, reason: `projected core at ${pin.rOverR.toFixed(3)} R > ${maxROverR}` };
  }
  return { valid: true, reason: 'valid' };
}

/**
 * The pins a spec may use at one azimuth, plus the reason each rejection happened.
 *
 * Non-vacuity is the caller's job (see `requireValidPins`): this only filters. Returns
 * every pin, valid and invalid, so a report can show the whole table — a spec that
 * silently dropped invalid rows is how a suite stops testing.
 */
export function classifyPins<T extends PinValidityInput>(
  pins: readonly T[],
): Array<T & PinValidity> {
  return pins.map((pin) => ({ ...pin, ...isValidPin(pin) }));
}

/**
 * FAIL LOUDLY when a spec's azimuth set cannot carry the claim it makes.
 *
 * The failure mode this prevents is vacuity: "no ring cast around any measurable pin"
 * is a true statement about zero pins. The spec must therefore assert that its input set
 * is non-empty in the specific way its claim needs, and must FAIL rather than skip when
 * it is not — a skip is how a spec quietly stops running.
 *
 * @param valid         the pins that passed `isValidPin`
 * @param need          what the caller's assertion requires
 * @param context       e.g. '3.6 at az 0'; only used in the message
 */
export function requireValidPins<T>(
  valid: readonly T[],
  need: 'at-least-one' | 'some-day-and-some-night',
  context: string,
): void {
  if (need === 'at-least-one') {
    if (valid.length === 0) {
      throw new Error(
        `${context}: VACUOUS — no pin passes isValidPin (needs n·cam >= ${PIN_VALIDITY.minFacingDot} ` +
          `and r/R <= ${PIN_VALIDITY.maxROverR}), so this check would assert a property of nothing`,
      );
    }
    return;
  }

  const sides = valid as ReadonlyArray<{ side?: string }>;
  const anyDay = sides.some((p) => p.side === 'day');
  const anyNight = sides.some((p) => p.side === 'night');
  if (!anyDay || !anyNight) {
    throw new Error(
      `${context}: VACUOUS — needs a valid DAY pin and a valid NIGHT pin; got ` +
        `${anyDay ? 'day' : 'no day'} / ${anyNight ? 'night' : 'no night'} among ${valid.length} valid pin(s)`,
    );
  }
}
