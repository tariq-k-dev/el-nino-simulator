/**
 * Framing arithmetic — where the globe's centre goes, and how far away the camera must be.
 *
 * Pure, no DOM, no three.js import: same reason as `insets.ts`. The runtime half (step C's
 * `FrameRig`) reads the insets store and the live camera and calls this; every interesting
 * case here is arithmetic and can be a table entry in a vitest file.
 *
 * ## Two questions, one module
 *
 * 1. **Where should the globe be centred?** The layout covers parts of a full-viewport canvas
 *    with opaque panels (`docs/STEP3-AUDIT.md` §2). The free rectangle is what is left, and its
 *    centre is where the globe belongs. A camera can be made to render its centre anywhere
 *    without moving, by shifting the frustum: `camera.setViewOffset`, which three implements by
 *    editing the projection matrix only.
 *
 * 2. **How big should it be?** A disc that fits the free rectangle is a disc whose silhouette
 *    radius is `rMax`. That fixes the camera's distance from the globe's centre.
 *
 * ## The sign convention, and why it is written down twice
 *
 * `setViewOffset(fullW, fullH, offsetX, offsetY, w, h)` renders the sub-window whose top-left
 * corner is `(offsetX, offsetY)` in the full frame. A NEGATIVE `offsetX` selects a window to the
 * LEFT of the full frame, so the content appears to move RIGHT by the same proportion: the camera
 * "looks" further left, and the globe lands further right on screen. Hence
 *
 *     dx = centreX - W/2      offsetX = -dx
 *
 * That is the whole convention, and it is easy to get backwards because both signs are plausible
 * in isolation. It is not taken on trust anywhere: `frame.test.ts` builds a real
 * `PerspectiveCamera`, applies the offset this module returns, projects the actual globe centre,
 * and requires it to land on the free centre within 0.01 px. If the sign were wrong the test would
 * fail by twice the offset — 44 px at 1280x800 — not by a rounding error.
 *
 * ## Why the fit has a floor and a ceiling
 *
 * The floor is the shipped distance `d0` (read from the scene's own `DEFAULT_POSITION`, never
 * retyped): this step is **zoom-out only**, so the framing may never pull the camera closer than
 * the product already starts. The ceiling is `<OrbitControls maxDistance>` — a fit that parked the
 * camera beyond the range the user is then allowed to zoom inside would make the fitted distance
 * unreachable again the moment they touched the wheel.
 *
 * Those two bounds can genuinely disagree with the layout, and at one of the four spec viewports
 * they do: 1024x768 needs `dContain = 7.455` but the ceiling is 5, so the disc ends up larger than
 * `rMax` there (measured in `docs/STEP3-FRAME.md` §4). The clamp wins and the result reports it by
 * simply being `dTarget > dContain`-free: `dTarget` is what is honest, and no consumer should
 * assume `dTarget === dContain`.
 */

import type { Insets, Viewport } from './insets';

/** Padding held inside the free rectangle before the disc is fitted, in CSS px. */
export const FRAME_PADDING_PX = 24;

/** Inputs to the framing arithmetic. */
export interface FrameInput {
  /** Viewport size in CSS pixels — the canvas is full-viewport (`docs/STEP3-AUDIT.md` §2). */
  viewport: Viewport;
  /** Measured occluder insets. `free` is recomputed here, so a caller may pass a stale one. */
  insets: Pick<Insets, 'left' | 'right' | 'top' | 'bottom'>;
  /** Vertical field of view, degrees (three's `camera.fov`). */
  fovDeg: number;
  /** The shipped distance. Zoom-out only: the fit never goes below this. */
  d0: number;
  /** Design ceiling — `<OrbitControls maxDistance>`. */
  dMax: number;
  /** Globe radius to fit, in scene units. 1.10242 = the pin core envelope. */
  re: number;
  /** Padding inside the free rectangle. Defaults to `FRAME_PADDING_PX`. */
  paddingPx?: number;
}

/** The free rectangle, in CSS pixels from the viewport's top-left. */
export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Frame {
  /** The rectangle the globe may occupy, after padding. */
  free: FrameRect;
  /** View-offset shift: the globe centre moves by `(+dx, +dy)` from the viewport centre. */
  dx: number;
  dy: number;
  /** Largest allowed silhouette radius, px. */
  rMax: number;
  /** Distance at which the silhouette is exactly `rMax`, before clamping. */
  dContain: number;
  /** What the rig should use: `clamp(max(d0, dContain), d0, dMax)`. */
  dTarget: number;
  /** True when the free rectangle collapsed or the padding ate it: zero offset, `dTarget = d0`. */
  degenerate: boolean;
}

/**
 * Compute the framing for one viewport and one set of insets.
 *
 * `free` here is the free rectangle AFTER padding, matching `computeInsets`'s convention
 * (`free.x/y/w/h` already excludes the padding it was given). The padding is applied here too —
 * twice-removing it would shrink the disc silently — so this takes the raw insets and derives the
 * rectangle itself, and the two agree because both subtract the same `2 * padding`.
 */
export function computeFrame(input: FrameInput): Frame {
  const { viewport, insets, fovDeg, d0, dMax, re } = input;
  const padding = input.paddingPx ?? FRAME_PADDING_PX;

  const W = viewport.w;
  const H = viewport.h;

  /*
   * The inner rectangle: what the insets leave, before any padding.
   *
   * `Math.max(0, ...)` on each span: a viewport narrower than its insets is a real case (at
   * 1024 px the deck and the Impact Zones are 24 px apart, and the drawer is another 418), and a
   * negative width would propagate into `rMax` as a positive number and produce a confident,
   * wrong fit.
   */
  const innerW = Math.max(0, W - insets.left - insets.right);
  const innerH = Math.max(0, H - insets.top - insets.bottom);
  const hasInner = innerW > 0 && innerH > 0;

  /*
   * The free rectangle: the inner rectangle shrunk by the padding, which is the rectangle the
   * globe's silhouette may occupy. Reported, and used for the centre — the padding is symmetric,
   * so shrinking does not move the centre, and `dx`/`dy` are therefore the same with or without
   * it. That is deliberate: the offset is a property of the LAYOUT, and must not change because
   * the fit's padding was tuned.
   */
  const freeW = Math.max(0, innerW - 2 * padding);
  const freeH = Math.max(0, innerH - 2 * padding);

  const centreX = insets.left + innerW / 2;
  const centreY = insets.top + innerH / 2;

  const dx = centreX - W / 2;
  const dy = centreY - H / 2;

  /*
   * The disc is a circle in a rectangle, so the smaller side decides. Subtracting the padding from
   * BOTH sides here (rather than only from one) is the whole reason `free` is built above with
   * `innerW - 2 * padding`: at 1280x800 that is 277.578 px, where using the inner rectangle's own
   * half-width would silently budget 301.578 and push the disc 24 px past the padding on two
   * sides. The two differ by exactly `padding`, which is the kind of error that reads as "nearly
   * right" in a table.
   */
  const rMax = 0.5 * Math.min(freeW, freeH);

  /*
   * Degenerate: nothing to centre in, or no room left for a disc once the padding is taken.
   *
   * Reported as a flag AND as the honest numbers (zero offset, `dTarget = d0`), because a
   * consumer that silently clamped would hide that the layout no longer fits — the same reasoning
   * as `Insets.degenerate`.
   */
  const degenerate = !hasInner || !(freeW > 0) || !(freeH > 0);

  /*
   * Focal length in px, from the VERTICAL fov and the FULL viewport height.
   *
   * Full height, not `freeH`: `setViewOffset` shifts the frustum without rescaling it, so the
   * projection keeps the fov/CSS-px relationship of the whole canvas. Using the free height here
   * would make the offset change the apparent scale, which is exactly what it must not do.
   */
  const focalPx = H / 2 / Math.tan((fovDeg * Math.PI) / 180 / 2);

  /*
   * d_contain from the tangent-length form.
   *
   * The silhouette radius of a sphere of radius `re` at distance `d` is
   *
   *     r = f * re / sqrt(d^2 - re^2)
   *
   * Solving `r = rMax`:
   *
   *     d^2 = re^2 + (f * re / rMax)^2
   *
   * Written in this direction (rather than as `re / sin(atan(rMax / f))`) so the `re^2` term that
   * dominates at small `rMax` stays visible; the two forms agree to ~1e-15 here but only this one
   * stays well-conditioned as `rMax -> 0`.
   */
  const dContain = degenerate ? d0 : Math.sqrt(re * re + ((focalPx * re) / rMax) ** 2);

  /*
   * Zoom-out only, inside the control bound.
   *
   * `Math.max(d0, ...)` makes the floor explicit even though `dContain >= re` always; `d0 > re`
   * here (3.3534 vs 1.10242), so on a large viewport the floor is what binds and the fit is a
   * no-op — which is the intended behaviour, not a missing case.
   */
  const dTarget = degenerate ? d0 : Math.min(Math.max(d0, dContain), dMax);

  return {
    free: {
      x: centreX - freeW / 2,
      y: centreY - freeH / 2,
      w: freeW,
      h: freeH,
    },
    dx,
    dy,
    rMax: degenerate ? 0 : rMax,
    dContain,
    dTarget,
    degenerate,
  };
}
