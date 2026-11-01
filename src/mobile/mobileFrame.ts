/**
 * The mobile framing, expressed through the EXISTING `d_fit` law rather than a second copy of it.
 *
 * ## The one idea
 *
 * `docs/STEP3-AUDIT.md`'s framing already answers "where may the globe be centred, and how big may it be"
 * from a free RECTANGLE. On mobile the free rectangle is not a measurement — the sheet's occluders are not
 * DOM panels and its tier must not move the globe — so it is the FIXED region the prompt names: full width,
 * the top 55 % of the viewport height. Handing that rectangle to `computeFrame` as insets gets the offset,
 * the `rMax` and the `d_fit` distance from the same code path desktop uses, so the two cannot drift.
 *
 *     free   = (0, 0, W, 0.55·H)
 *     centre = (W/2, 0.275·H)          -> dy = 0.275·H − 0.5·H = −0.225·H
 *
 * and `computeFrame`', own sign convention then produces the NEGATIVE window offset the director installs,
 * which is exactly `camera.setViewOffset(W, H, 0, 0.225·H, W, H)` once the director negates it. Stated as
 * arithmetic here so nobody has to re-derive the sign from prose.
 *
 * ## Why the offset does NOT follow the tier
 *
 * Because a moving principal point is a moving picture: the globe would slide under the reader's thumb every
 * time the sheet snapped, and a pin they had just tapped would no longer be where they tapped it. The prompt
 * places tier-following offsets explicitly out of scope; `docs/MOBILE.md` records it as a known limit.
 */

import { computeFrame, type Frame } from '@/layout/frame';
import { D0, FOV_DEG, MAX_DISTANCE, PIN_ENVELOPE } from '@/layout/framing';
import { MOBILE_FREE_TOP_FRACTION } from '@/mobile/snapMath';

/** What the director needs from one mobile layout pass. */
export interface MobileFrame extends Frame {
  /** The window offset in px, POSITIVE-DOWN, i.e. what `setViewOffset` takes directly. */
  viewOffsetY: number;
  /** True when the ceiling (`dMax`) bound the fit, so the disc is larger than `rMax` allows. */
  clampedByMax: boolean;
}

/**
 * Frame the globe for a mobile viewport.
 *
 * The insets are the COMPLEMENT of the free band: a bottom inset of `(1 − 0.55)·H` leaves
 * `[0, 0.55·H]` free with full width, which is the rectangle the prompt specifies. `paddingPx` is left at
 * the shared default so the mobile and desktop discs are fitted with the same margin.
 */
export function computeMobileFrame(viewportW: number, viewportH: number): MobileFrame {
  const W = Number.isFinite(viewportW) && viewportW > 0 ? viewportW : 0;
  const H = Number.isFinite(viewportH) && viewportH > 0 ? viewportH : 0;

  const frame = computeFrame({
    viewport: { w: W, h: H },
    insets: { left: 0, right: 0, top: 0, bottom: H * (1 - MOBILE_FREE_TOP_FRACTION) },
    fovDeg: FOV_DEG,
    d0: D0,
    dMax: MAX_DISTANCE,
    re: PIN_ENVELOPE,
  });

  return {
    ...frame,
    /* `dy` is negative when the centre is ABOVE the viewport middle; the window offset is its negation. */
    viewOffsetY: -frame.dy,
    clampedByMax: !frame.degenerate && frame.dContain > MAX_DISTANCE,
  };
}
