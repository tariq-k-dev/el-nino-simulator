/**
 * assertShippedLook — refuse to measure a look the product does not render.
 *
 * Why this exists, stated as the bug it prevents. The first F3 attempt produced
 * max(D) 164.07 / area6 15469 against recorded values of 88.52 / 9594 — an 85 % error —
 * because the acquisition called `specularIntensity(0.18)` before capturing. 0.18 is the
 * PRE-FIX value; the shipped surface has been 0 since 38aa091. Nothing in the pipeline
 * objected: the numbers were plausible, self-consistent and wrong, and only the comparison
 * with the recorded pair revealed it.
 *
 * A comment cannot prevent that. A runtime comparison can: this reads what the live page
 * actually has and diffs it against the committed constants in `src/scene/globeLook.ts`. Any
 * forced override — a stray `specularIntensity(v)` in a helper, a stale flag default, a future
 * ablation seam left switched on — throws "not the shipped state" before a single pixel is
 * differenced.
 *
 * Deliberately reads the CONSTANT rather than restating 0 here. Hardcoding the expectation
 * would re-create the same failure one layer up: the test would then assert its own copy of
 * the truth instead of the shipped one.
 */
import type { Page } from '@playwright/test';
import { GLOBE_LOOK } from '../../../src/scene/globeLook';

export interface ShippedLookState {
  /** `specularIntensity` read off the live Earth material. */
  intensity: number | null;
  /** Whether the additive specular overlay is on. */
  overlay: boolean;
  /** The committed values the live state was compared against. */
  expected: { intensity: number; overlay: boolean };
}

/**
 * The overlay's committed on/off default.
 *
 * Read from the look flags the scene derives, not invented: `specular: true` is the approved
 * look — the overlay is the ONLY specular source at si 0, so a default of false would mean the
 * product ships with no glint at all.
 */
const EXPECTED_OVERLAY = true;

/**
 * Throw unless the live scene is the shipped look.
 *
 * @param page     open page with `__look` / `__globe` installed
 * @param context  where the check ran, for the failure message
 * @returns the state it verified, so the caller can echo it into a report
 */
export async function assertShippedLook(page: Page, context: string): Promise<ShippedLookState> {
  const live = await page.evaluate(() => ({
    intensity: window.__look!.specularIntensity(),
    overlay: Boolean(window.__globe!.lookFlags().specular),
  }));

  const expected = {
    intensity: GLOBE_LOOK.surface.specularIntensity,
    overlay: EXPECTED_OVERLAY,
  };

  const problems: string[] = [];
  if (live.intensity === null) {
    problems.push('the Earth surface material was not found, so nothing can be read');
  } else if (live.intensity !== expected.intensity) {
    problems.push(
      `specularIntensity is ${live.intensity}, but the committed value is ${expected.intensity}`,
    );
  }
  if (live.overlay !== expected.overlay) {
    problems.push(`the specular overlay is ${live.overlay ? 'on' : 'off'}, expected ${expected.overlay ? 'on' : 'off'}`);
  }

  if (problems.length > 0) {
    throw new Error(
      `${context}: not the shipped state — ${problems.join('; ')}. ` +
        `A glint measurement taken in any other state describes a render the product does not ` +
        `produce. Do not force a specular value anywhere in the acquisition path.`,
    );
  }

  return { ...live, expected };
}
