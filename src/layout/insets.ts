/**
 * Free-rectangle arithmetic for the framing work — pure, no DOM.
 *
 * Steps 3B onwards need to know which rectangle of the viewport the globe may be centred in, given
 * the panels that sit on top of a full-viewport canvas. Every panel in this app is an absolutely
 * positioned overlay (see `docs/STEP3-AUDIT.md` §2), so "how much does this panel cover" is a
 * question about rectangles, not about the camera or the scene.
 *
 * ## Why a PURE function, separated from the runtime
 *
 * The interesting cases are arithmetic, not observation: a panel touching two edges, two panels on
 * the same edge, a panel larger than the viewport. Those are the cases a runtime probe on a real
 * page finds hardest to produce and easiest to get wrong by eye. Keeping the arithmetic here means
 * every one of them is a table entry in a vitest file, and the runtime layer (`useInsets.ts`) has
 * nothing left to get wrong except plumbing.
 *
 * ## The rules, and why each one is a rule
 *
 * - **Zero/negative area is ignored**, and reported. A `display:none` panel and a `0x0` panel are
 *   indistinguishable to `getBoundingClientRect` in the way that matters here: neither covers
 *   anything. Reporting them separately from "floating" keeps the two causes distinguishable.
 * - **An element is assigned to the edge it lies within `edgeTolerance` of.** An overlay that starts
 *   2 px inside the viewport edge still occludes that edge; without a tolerance the registry would
 *   silently report zero insets for a panel nudged by a rounded corner.
 * - **A corner element is assigned to the edge it is THINNER against.** The header spans the full
 *   width and is 118 px tall: it is "on the top edge", not "on the left edge", because its thickness
 *   perpendicular to the top is its height and perpendicular to the left is the full width. Taking
 *   the smaller thickness is what makes a corner element contribute its real cost, not its span.
 * - **Insets are the MAX thickness per edge, not the sum.** The drawer and the Impact Zones both sit
 *   on the right and overlap; summing them would claim 734 px of a 1280 px viewport is covered when
 *   the correct answer is the 418 px of the outer one.
 * - **`free` can never be negative**, and `degenerate` says when it has collapsed below `minFree`.
 *   A consumer that centres a globe in a negative rectangle would place it off-screen, and a silent
 *   clamp would hide that the layout no longer fits.
 */

/** A viewport, in CSS pixels. */
export interface Viewport {
  w: number;
  h: number;
}

/** One occluding rectangle, in viewport CSS pixels. */
export interface OccluderRect {
  /** Stable id, as written in the `data-occluder` attribute. */
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface InsetsOptions {
  /** Padding to hold inside the free rectangle, in px. */
  padding?: number;
  /** How close to a viewport edge an element must start to count as attached to it. */
  edgeTolerance?: number;
  /** Free width/height below this makes the result degenerate. */
  minFree?: number;
}

/** The free rectangle a consumer may centre content in. */
export interface FreeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
  free: FreeRect;
  degenerate: boolean;
  /** Ids that contributed nothing: zero-area, or attached to no edge. */
  ignored: string[];
}

export const DEFAULT_OPTIONS: Required<InsetsOptions> = {
  padding: 0,
  edgeTolerance: 8,
  minFree: 64,
};

/**
 * Classify one rect against the viewport.
 *
 * Returns the edges it touches, each with the thickness measured PERPENDICULAR TO THAT EDGE: width
 * for left/right, height for top/bottom. `assigned` is the single edge the element is charged to —
 * for a corner element that is the edge it is THINNER against, because that is the axis along which
 * it actually costs space. A full-width 118 px header is "a top element", not "a left element whose
 * left inset is 1280".
 *
 * `null` means the rect covers nothing (zero/negative area) or is attached to no edge.
 */
function classify(
  rect: OccluderRect,
  viewport: Viewport,
  tol: number,
): { edges: Array<'left' | 'right' | 'top' | 'bottom'>; assigned: 'left' | 'right' | 'top' | 'bottom' } | null {
  /*
   * CLIP TO THE VIEWPORT FIRST.
   *
   * A closed panel is not removed from the DOM and not `display:none` — the region drawer sits at
   * `translate-x-[110%]`, i.e. at x 1321..1739 on a 1280 px viewport. Its `top` is 0 and its `bottom`
   * is the full viewport height, so an unclipped classifier sees it touching the TOP and BOTTOM edges
   * with a thickness of 800 and reports a top inset of the entire screen. Measured on the live page
   * before this fix: `top: 900`, `free.h: 0`, `degenerate: true` at all three viewports.
   *
   * Clipping to the viewport makes "off-canvas" fall out of the arithmetic instead of needing a
   * special case: the visible width becomes zero, and a zero-area rect is ignored — which is exactly
   * the answer the audit predicted ("its rect does not overlap the canvas, so the insets contribution
   * is correctly 0, and it comes from geometry, not from a special case").
   */
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(viewport.w, rect.right);
  const bottom = Math.min(viewport.h, rect.bottom);
  const w = right - left;
  const h = bottom - top;
  if (w <= 0 || h <= 0) return null;

  /*
   * Edge attachment is tested on the CLIPPED rect, so a panel that pokes past one edge and covers
   * nothing is rejected above, while a panel flush to an edge is still recognised.
   */
  const onLeft = left <= tol;
  const onRight = viewport.w - right <= tol;
  const onTop = top <= tol;
  const onBottom = viewport.h - bottom <= tol;

  const edges: Array<'left' | 'right' | 'top' | 'bottom'> = [];
  let assigned: 'left' | 'right' | 'top' | 'bottom' | null = null;
  let thinnest = Infinity;
  const consider = (edge: 'left' | 'right' | 'top' | 'bottom', thickness: number) => {
    edges.push(edge);
    if (thickness < thinnest) {
      thinnest = thickness;
      assigned = edge;
    }
  };
  if (onLeft) consider('left', w);
  if (onRight) consider('right', w);
  if (onTop) consider('top', h);
  if (onBottom) consider('bottom', h);

  if (edges.length === 0 || assigned === null) return null;
  return { edges, assigned };
}

/**
 * Thickness of a rect perpendicular to an edge, measured on the part that is ON the canvas.
 *
 * Clipped, for the same reason `classify` clips: a panel poking 460 px past the right edge covers
 * only its on-canvas part, and charging it its full width would over-report the inset.
 */
function thicknessFor(
  rect: OccluderRect,
  edge: 'left' | 'right' | 'top' | 'bottom',
  viewport: Viewport,
): number {
  const w = Math.min(viewport.w, rect.right) - Math.max(0, rect.left);
  const h = Math.min(viewport.h, rect.bottom) - Math.max(0, rect.top);
  return edge === 'left' || edge === 'right' ? w : h;
}

export function computeInsets(
  viewport: Viewport,
  occluders: readonly OccluderRect[],
  options: InsetsOptions = {},
): Insets {
  const padding = options.padding ?? DEFAULT_OPTIONS.padding;
  const tol = options.edgeTolerance ?? DEFAULT_OPTIONS.edgeTolerance;
  const minFree = options.minFree ?? DEFAULT_OPTIONS.minFree;

  const ignored: string[] = [];
  const thickness = { left: 0, right: 0, top: 0, bottom: 0 };

  for (const rect of occluders) {
    const c = classify(rect, viewport, tol);
    if (c === null) {
      ignored.push(rect.id);
      continue;
    }
    /*
     * MAX, not sum: overlapping panels on one edge cover that edge once (the drawer and the Impact
     * Zones both sit on the right; summing them would claim 734 px of a 1280 px viewport).
     *
     * Charged to the ASSIGNED edge only. A corner element is one panel; charging it to every edge it
     * touches would subtract it twice and report a free rectangle smaller than the real one.
     */
    const t = thicknessFor(rect, c.assigned, viewport);
    if (t > thickness[c.assigned]) thickness[c.assigned] = t;
  }

  // Clamp each inset to the viewport so a panel wider than the screen cannot invert the maths.
  const left = Math.max(0, Math.min(viewport.w, thickness.left));
  const right = Math.max(0, Math.min(viewport.w, thickness.right));
  const top = Math.max(0, Math.min(viewport.h, thickness.top));
  const bottom = Math.max(0, Math.min(viewport.h, thickness.bottom));

  const freeW = Math.max(0, viewport.w - left - right - 2 * padding);
  const freeH = Math.max(0, viewport.h - top - bottom - 2 * padding);
  // When both padding edges are used, the origin shifts by a full padding; when the axis has a free
  // span of zero there is nothing to shift, so the origin stays pinned to the inset.
  const freeX = freeW > 0 ? left + padding : left;
  const freeY = freeH > 0 ? top + padding : top;

  return {
    left,
    right,
    top,
    bottom,
    free: { x: freeX, y: freeY, w: freeW, h: freeH },
    degenerate: freeW < minFree || freeH < minFree,
    ignored,
  };
}
