/**
 * GLINT ACQUISITION — the two frames the sentinel differences, taken AS SHIPPED.
 *
 * Separate from `glint.ts` for the same reason `acquire.ts` is separate from `analysis.ts`: one
 * module touches the scene, the other only reads bitmaps.
 *
 * THE METHOD, and why each condition is load-bearing:
 *
 *   - DEFAULT VIEW, azimuth 0. The look was approved there.
 *   - CLOCK FROZEN via `settleAt`, which pins the scene clock as well as the spin. The glint is
 *     a specular lobe: a moving sun or a drifting cloud deck would put the two captures on
 *     different scenes and the difference would be motion, not specular. The handoff records two
 *     loads differing by 17.4 mean luma inside the disc when only the spin was paused.
 *   - `stars false, pins false, rings false, clouds true`. Bright points on and off the disc
 *     survive a difference and would be counted as glint; clouds stay because they are part of
 *     the surface the glint falls on. These are the conditions the recorded numbers used.
 *   - `F_current` = the render EXACTLY as shipped. No `specularIntensity` call is made here at
 *     all — that omission is the fix for 2B-C2B's 85 % reproduction error.
 *   - `F_off` = overlay off AND specularIntensity 0.
 *
 * `assertShippedLook` runs first, so a forced override anywhere upstream throws instead of
 * producing a plausible wrong number.
 */
import type { Page } from '@playwright/test';
import type { Bitmap, DiscGeometry } from '../../../src/lib/look/helpers';
import { capture, fitLimb, setLayers, settleAt } from './capture';
import { GLINT_VIEW } from './glintConstants';
import { assertShippedLook, type ShippedLookState } from './shippedLook';

export interface GlintFrames {
  /** The look as shipped. */
  current: Bitmap;
  /** The same scene with the overlay off and the material specular at 0. */
  off: Bitmap;
  /** Geometry fitted on the same camera and flags the captures were taken with. */
  geometry: DiscGeometry;
  /** The verified shipped state, echoed so a report shows conditions rather than assuming. */
  shipped: ShippedLookState;
  /** Everything else the measurement depended on. */
  conditions: Record<string, unknown>;
}

const VIEW_FLAGS = {
  stars: GLINT_VIEW.stars,
  pins: GLINT_VIEW.pins,
  rings: GLINT_VIEW.rings,
  clouds: GLINT_VIEW.clouds,
};

/**
 * Take the two frames the sentinel differences.
 *
 * The specular state is restored from what it was found to be, in a `finally`: a sentinel run
 * must not leave the scene on a different look for the next spec.
 */
export async function acquireGlintFrames(page: Page): Promise<GlintFrames> {
  const before = await page.evaluate(() => ({
    intensity: window.__look!.specularIntensity(),
    overlay: Boolean(window.__globe!.lookFlags().specular),
  }));

  await settleAt(page, GLINT_VIEW.azimuth);
  await setLayers(page, VIEW_FLAGS);

  const fit = await fitLimb(page);
  if (!Number.isFinite(fit.r) || fit.r <= 0) {
    throw new Error(`acquireGlintFrames: limb fit produced no circle (r=${fit.r})`);
  }
  const geometry: DiscGeometry = { cx: fit.cx, cy: fit.cy, r: fit.r };

  // fitLimb restores every layer on its way out; re-establish the sentinel's view.
  await setLayers(page, VIEW_FLAGS);

  /*
   * The guard, AFTER the layer writes because `setLayers` re-renders React and could rebuild
   * materials. Anything that forced an intensity upstream is caught here, before a pixel is
   * differenced.
   */
  const shipped = await assertShippedLook(page, 'acquireGlintFrames');

  try {
    // (1) as shipped. Deliberately no specularIntensity() call — the render is taken as found.
    const current = await capture(page);

    // (2) both specular paths off. Same flags, same clock — only the specular terms change.
    await page.evaluate(() => {
      window.__look!.specularIntensity(0);
      window.__globe!.setLookFlags({ specular: false });
    });
    const off = await capture(page);

    return {
      current,
      off,
      geometry,
      shipped,
      conditions: {
        azimuth: GLINT_VIEW.azimuth,
        flags: VIEW_FLAGS,
        shippedState: { intensity: shipped.intensity, overlay: shipped.overlay },
        offState: { intensity: 0, overlay: false },
        rFit: +geometry.r.toFixed(3),
        rms: +fit.rms.toFixed(3),
        rays: fit.rays,
        misses: fit.misses,
        viewport: `${current.width}x${current.height}`,
      },
    };
  } finally {
    // Restore whatever the page had, not a hardcoded guess.
    await page.evaluate(
      (state: { intensity: number | null; overlay: boolean }) => {
        window.__look!.specularIntensity(state.intensity ?? 0);
        window.__globe!.setLookFlags({ specular: state.overlay });
      },
      before,
    );
    await setLayers(page, { stars: true, pins: true, rings: true, clouds: true });
  }
}
