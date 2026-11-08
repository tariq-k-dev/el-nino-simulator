/**
 * The mobile framing: the free rect from `layoutMath` fed through the repo's own `d_contain` law.
 *
 * ## What MOBILE1 did, and why it is replaced
 *
 * MOBILE1 handed `computeFrame` a FIXED band (full width, top 55 % of the height). That is a measurement the
 * layout does not make: it ignores the header entirely, so the globe's top sits under the header's controls, and
 * its radius budget is derived from a band that has nothing to do with the sheet's actual peek clamp. Step
 * MOBILE2 replaces the band with `computeFreeRect` (`mobile/layoutMath.ts`), which knows the header's measured
 * bottom, the peek clamp and the landscape dock.
 *
 * ## The one law, called twice
 *
 * `dContainFor(radiusPx, focalPx, re)` in `layout/frame.ts` is the containment law. The desktop free-rect fit
 * calls it with the rectangle's `rMax`; this module calls it with the radius budget `Rb`. Neither derives it.
 *
 * ## Two distances, and why they are equal on mobile
 *
 *   - `dContain` — where the disc is exactly `Rb` in radius. This is the fit.
 *   - `dFit`     — what the camera should actually be at. On desktop this is `clamp(max(d0, dContain), d0, dMax)`,
 *                  which is where the 1024x768 clamp defect lives (`dMax = 5` binds at `dContain = 7.455`).
 *                  On MOBILE the ceiling is lifted instead (`dMaxMode`, below), so `dFit === dContain` and the
 *                  disc fits the budget by construction.
 *
 * ## `dMaxMode` — the unclamping, and its exact scope
 *
 *     dMaxMode = max(5, 1.25 * dContain)
 *
 * The `5` keeps the desktop design ceiling as a FLOOR, so a mobile viewport whose fit is nearer than the desktop
 * ceiling still lets the user zoom out to it, and the `1.25·dContain` term guarantees the acceptance case's
 * "zoom out to at least 1.2 · dFit" headroom. This value is written to `controls.maxDistance` by
 * `CameraDirector` — the single writer — and NEVER on desktop, where `maxDistance` stays 5 and the known 1024x768
 * clamp flag stays open.
 */

import { dContainFor, focalPxFor, type Frame } from "@/layout/frame";
import { D0, FOV_DEG, MAX_DISTANCE, PIN_ENVELOPE } from "@/layout/framing";
import { SHELLS } from "@/scene/constants";
import { computeFreeRect, type LayoutMode2 } from "@/mobile/layoutMath";

/**
 * The radius the fit frames: the LARGER of the pin envelope and the atmosphere limb.
 *
 * `PIN_ENVELOPE` is 1.10242 R (`anchorRadius·idleLift + coreOffset`) and the atmosphere shell is
 * `SHELLS.atmosphere = 1.1 R`, so the pin envelope wins today. Written as a `Math.max` rather than as the pin
 * envelope alone because the atmosphere is what the acceptance case measures as "nothing clipped", and a future
 * retune of either number must not quietly leave the disc sized for the smaller one.
 */
export const MOBILE_ENVELOPE = Math.max(PIN_ENVELOPE, SHELLS.atmosphere);

/** What the director needs from one mobile layout pass. */
export interface MobileFit {
    /** The free rectangle and its centre, from `computeFreeRect`. */
    rect: ReturnType<typeof computeFreeRect>;
    /** The window offsets in px, exactly as `setViewOffset` takes them (positive down/right). */
    offsetX: number;
    offsetY: number;
    /** The distance at which the silhouette is exactly `radiusBudget`. */
    dContain: number;
    /** What the camera should be at: `dContain` on mobile (no ceiling clamp). */
    dFit: number;
    /** `max(MAX_DISTANCE, 1.25 * dContain)` — the value `controls.maxDistance` must carry in this mode. */
    dMaxMode: number;
    /** True when the fit was computed from a degenerate rect and is therefore the shipped distance. */
    degenerate: boolean;
}

/**
 * The window offset for a free rect, in the sign `setViewOffset` takes.
 *
 * ## The algebra, and the measurement behind it
 *
 * `setViewOffset(fullW, fullH, offsetX, offsetY, w, h)` renders the sub-window whose top-left is
 * `(offsetX, offsetY)`. For the projected content to move to `(cx, cy)` from the viewport centre, the offset is
 * the NEGATIVE of the shift:
 *
 *     offsetX = W/2 - cx
 *     offsetY = H/2 - cy
 *
 * MOBILE1 verified the Y half by measurement (`.cache/mob/probe-offset.mjs`, quoted in `CameraDirector.tsx`):
 * a POSITIVE `offsetY` moves content UP, so a centre BELOW the viewport middle needs a positive offset, and
 * `H/2 - cy` is positive exactly then. The X half is the same law with the same sign, because `setViewOffset`
 * treats both axes identically — and `mobileFrame.test.ts` re-derives BOTH from a real `PerspectiveCamera` on
 * every gate run rather than trusting this paragraph.
 *
 * The sub-window is the FULL `W x H`, so this is a lens shift: the frustum is not rescaled, the zoom is unchanged
 * and the disc stays a circle.
 */
export function viewOffsetFor(
    viewportW: number,
    viewportH: number,
    cx: number,
    cy: number,
): { x: number; y: number } {
    return { x: viewportW / 2 - cx, y: viewportH / 2 - cy };
}

/** Frame the globe for one mobile viewport, from the layout's own free rect. */
export function computeMobileFit(
    mode: LayoutMode2,
    viewportW: number,
    viewportH: number,
    headerBottom: number,
): MobileFit {
    const W = Number.isFinite(viewportW) && viewportW > 0 ? viewportW : 0;
    const H = Number.isFinite(viewportH) && viewportH > 0 ? viewportH : 0;

    const rect = computeFreeRect(mode, W, H, headerBottom);
    const focalPx = focalPxFor(H, FOV_DEG);
    const { x: offsetX, y: offsetY } = viewOffsetFor(W, H, rect.cx, rect.cy);

    const dContain =
        rect.radiusBudget > 0
            ? dContainFor(rect.radiusBudget, focalPx, MOBILE_ENVELOPE)
            : D0;
    const dFit = dContain;
    const dMaxMode = Math.max(MAX_DISTANCE, 1.25 * dContain);

    return {
        rect,
        offsetX,
        offsetY,
        dContain,
        dFit,
        dMaxMode,
        degenerate: rect.radiusBudget <= 0,
    };
}

/**
 * MOBILE1's `MobileFrame` shape, kept for the probe's existing fields.
 *
 * The probe reports `free`, `dx`, `dy`, `dTarget` and `viewOffsetY`, and the acceptance suite reads them. Rather
 * than change every reader, this adapts the new fit onto that shape — the numbers are the new ones, so a spec
 * that compares them against the layout's own free rect is measuring the new behaviour.
 */
export interface MobileFrame extends Frame {
    viewOffsetY: number;
    /** Step MOBILE2: the horizontal half of the lens shift. 0 when the centre is the viewport's. */
    viewOffsetX: number;
    clampedByMax: boolean;
}

/** Adapt a `MobileFit` to the probe's MOBILE1-shaped record. */
export function asMobileFrame(
    fit: MobileFit,
    viewportW: number,
    viewportH: number,
): MobileFrame {
    const { rect } = fit;
    return {
        free: {
            x: rect.left,
            y: rect.top,
            w: rect.right - rect.left,
            h: rect.bottom - rect.top,
        },
        dx: rect.cx - viewportW / 2,
        dy: rect.cy - viewportH / 2,
        rMax: rect.radiusBudget,
        dContain: fit.dContain,
        dTarget: fit.dFit,
        degenerate: fit.degenerate,
        viewOffsetY: fit.offsetY,
        viewOffsetX: fit.offsetX,
        /* On mobile the ceiling is `max(5, 1.25·dContain)`, so the fit is never squashed by it. */
        clampedByMax: false,
    };
}
