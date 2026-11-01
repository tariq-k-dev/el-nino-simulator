/**
 * The mobile layout law — mode, free rectangle, radius budget, dock width, peek height.
 *
 * Pure: no DOM, no React, no three.js. Same reason `layout/insets.ts`, `layout/frame.ts` and
 * `mobile/snapMath.ts` are pure — every claim these functions make is arithmetic, and every one of them is a
 * row in `layoutMath.test.ts`. The runtime half (the ResizeObserver publisher, the director) only measures and
 * calls.
 *
 * ## Why the mode is a TOTAL function of two numbers
 *
 * MOBILE1 decided the layout with `matchMedia('(max-width: 767.98px)')`, which is a WIDTH-only question. That
 * is correct for the sheet-vs-desktop choice it made and wrong for the two shapes a phone actually has: a
 * 844x390 phone in landscape is 844 px wide, so the width query says "desktop" and the reader gets the desktop
 * overlays on a 390 px-tall screen. The mode has to look at the aspect as well as the size, and it has to be a
 * function rather than a CSS query so the frame loop (which cannot await a media query) and the DOM agree by
 * construction.
 *
 * ## The order, and why each clause is first
 *
 *     1. phoneLandscape  if w < 1024 AND h < 600 AND w > h
 *     2. portrait        if w < 768  OR (w < 1024 AND h > w)
 *     3. desktop         otherwise
 *
 * `phoneLandscape` is tested FIRST because it is the narrowest condition and its members would otherwise be
 * captured by clause 2: 844x390 has `h > w` false, so it would fall through to desktop. Every landscape phone
 * therefore needs a height bound, and 600 px is the prompt's: the two real landscape phones (375 and 430 tall)
 * pass it, the smallest landscape tablet that reaches this branch (600x1024 is portrait by clause 2 anyway)
 * does not.
 *
 * Clause 2's `w < 768` is the ONLY clause of the old breakpoint that survives verbatim — deliberately, because
 * it is the one the 767/768 boundary spec (M1) compares against. The `(w < 1024 AND h > w)` half is what makes
 * 768x1024 and 960x1440 portrait: both are wider than the old breakpoint and both are unmistakably a tablet
 * held upright.
 *
 * ## Accepted gaps (documented in `docs/MOBILE2-AUDIT.md` §11, not fixed)
 *
 *   - a 768..1023 wide LANDSCAPE window with `h >= 600` is portrait (1023x601 -> portrait, 1024x600 -> desktop);
 *   - a square 768x768 or 900x900 is desktop (`h > w` false, `w < 768` false);
 *   - 1024x1366 is desktop although it is a portrait tablet.
 *
 * Each of those is a real viewport nobody in this step's matrix uses, and every "fix" for one of them moves a
 * boundary the acceptance suite bands. They are recorded rather than patched.
 */

/** Which layout the page runs. `mobile` in MOBILE1 is now two modes; `desktop` is unchanged. */
export type LayoutMode2 = 'desktop' | 'portrait' | 'phoneLandscape';

/**
 * Narrowest desktop WIDTH. The phoneLandscape clause and clause 2's second half both use it.
 *
 * 1024, not 1023.98: the mode is computed from `innerWidth` as an INTEGER (browsers report integer layout
 * viewports), so there is no fractional-edge case to defend against here — unlike `snapMath.BREAKPOINT_MAX`,
 * which is compared against a CSS media query that DOES see fractional widths.
 */
export const DESKTOP_MIN_W = 1024;

/** Old breakpoint, kept as the portrait clause's width test. Same value the M1 spec compares against. */
export const PORTRAIT_MAX_W = 768;

/** Tallest viewport that may still be a landscape phone. */
export const LANDSCAPE_MAX_H = 600;

/** ## The mode. Pure, total, and evaluate in the documented order. */
export function resolveLayoutMode(w: number, h: number): LayoutMode2 {
  const W = Number.isFinite(w) && w > 0 ? w : 0;
  const H = Number.isFinite(h) && h > 0 ? h : 0;
  if (W < DESKTOP_MIN_W && H < LANDSCAPE_MAX_H && W > H) return 'phoneLandscape';
  if (W < PORTRAIT_MAX_W || (W < DESKTOP_MIN_W && H > W)) return 'portrait';
  return 'desktop';
}

/** Is this mode one of the two mobile ones? The single predicate the director and the shell share. */
export function isMobileMode(mode: LayoutMode2): boolean {
  return mode !== 'desktop';
}

/* ------------------------------------------------------------------ the sheet's peek height */

/** Hard floor on the visible peek band, px. */
export const PEEK_MIN_PX = 112;

/** Fraction of the viewport the peek band occupies when that is the larger term. */
export const PEEK_FRACTION = 0.18;

/**
 * The visible peek band, px.
 *
 * `max(0.18·H, 112 + safeBottom)`, then clamped to the viewport: on a 320x568 phone 0.18·H is 102.24 and the
 * floor wins (112), while on a 390x844 phone 0.18·H is 151.9 and the fraction wins. The floor is what keeps the
 * sheet's handle row and its title legible on a short screen; the fraction is what keeps the sheet from being a
 * decorative strip on a tall one. The safe-area inset is added INSIDE the max rather than outside so the whole
 * band still fits on a device with a home indicator: at 844 px with a 34 px inset the floor term is 146, still
 * below 151.9, so the fraction wins and no band is stolen from the globe.
 */
export function peekVisible(h: number, safeBottom = 0): number {
  const H = Number.isFinite(h) && h > 0 ? h : 0;
  const inset = Number.isFinite(safeBottom) && safeBottom > 0 ? safeBottom : 0;
  if (H === 0) return 0;
  const wanted = Math.max(PEEK_FRACTION * H, PEEK_MIN_PX + inset);
  return Math.min(wanted, H);
}

/* ---------------------------------------------------------------------------- the free rect */

/** A rectangle in viewport CSS px, its edges rather than its origin+size. */
export interface FreeRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** What one mobile layout pass publishes for the director to consume. */
export interface MobileFreeRect extends FreeRect {
  /** Where the globe's centre belongs, in CSS px. */
  cx: number;
  cy: number;
  /** The largest silhouette radius that fits in the rect with `RADIUS_MARGIN_PX` held back. */
  radiusBudget: number;
}

/** Margin held inside the rect before the disc is fitted, px. */
export const RADIUS_MARGIN_PX = 12;

/** Floor on the radius budget, px — a rect smaller than this cannot happen at any supported viewport. */
export const MIN_RADIUS_BUDGET = 40;

/** Half the globe above the centre may use at most this fraction of the height, with a face-pinned pin. */
export const HALF_TOP_FRACTION = 0.52;

/** How far below the 0.52·H line the centre is allowed to sit, px — the pin's own lift plus its label. */
export const HALF_TOP_BACKOFF_PX = 28;

/**
 * The free rectangle and the centre for a mobile viewport.
 *
 * ## portrait
 *
 *     left 0, right W, top headerBottom, bottom H - peekVisible
 *     cx = W/2,  cy = min(mid, 0.52·H - 28)
 *
 * The `min` is the one non-obvious term and it is a legibility rule, not a fitting one. In the Half tier the
 * sheet's top is `0.52·H`, so a pin at the free centre must sit ABOVE that line to stay visible; a centre placed
 * at the plain midpoint of a tall band would put the pinned face exactly on the sheet's edge. Below
 * `0.52·H - 28` the midpoint already satisfies that (it is what binds on a short screen), so the two terms cross
 * over around 0.55·H of free band and both branches are reachable — 390x844 takes the `min` branch (398.04 vs
 * 410.72) and 360x640 takes it too (304.80 vs 304.80, equal to within float noise).
 *
 * ## phoneLandscape
 *
 *     dockW = min(clamp(320, 0.38·W, 400), 0.5·W)
 *     left 0, right W - dockW, top headerBottom, bottom H
 *
 * The dock is on the RIGHT and the globe keeps the left. `0.5·W` is the cap that stops a narrow landscape phone
 * (667x375: 0.38·W = 253.5, under the 320 floor, so the floor would give the dock 320 of 667 = 48 %) from taking
 * more than half the screen.
 *
 * ## Both
 *
 * `radiusBudget = max(min(cx-left, right-cx, cy-top, bottom-cy) - 12, 40)`. The margin is subtracted BEFORE the
 * floor is applied, so a tight rect reports the floor rather than a negative radius, and the acceptance case's
 * "at least 8 px margin" holds with 4 px to spare on every viewport in the matrix.
 */
export function computeFreeRect(mode: LayoutMode2, w: number, h: number, headerBottom: number): MobileFreeRect {
  const W = Number.isFinite(w) && w > 0 ? w : 0;
  const H = Number.isFinite(h) && h > 0 ? h : 0;
  const top = Number.isFinite(headerBottom) && headerBottom > 0 ? Math.min(headerBottom, H) : 0;

  let rect: FreeRect;
  let cx: number;
  let cy: number;

  if (mode === 'phoneLandscape') {
    const dockW = dockWidth(W);
    rect = { left: 0, right: W - dockW, top, bottom: H };
    cx = rect.right / 2;
    cy = (rect.top + rect.bottom) / 2;
  } else if (mode === 'portrait') {
    rect = { left: 0, right: W, top, bottom: Math.max(top, H - peekVisible(H)) };
    cx = W / 2;
    const mid = (rect.top + rect.bottom) / 2;
    cy = Math.min(mid, HALF_TOP_FRACTION * H - HALF_TOP_BACKOFF_PX);
  } else {
    /* Desktop never consumes this, but the function is total: the whole viewport, centred. */
    rect = { left: 0, right: W, top: 0, bottom: H };
    cx = W / 2;
    cy = H / 2;
  }

  return { ...rect, cx, cy, radiusBudget: radiusBudget(rect, cx, cy) };
}

/** The radius budget for a rect and a centre, with the margin and the floor applied. */
export function radiusBudget(rect: FreeRect, cx: number, cy: number): number {
  const inner = Math.min(cx - rect.left, rect.right - cx, cy - rect.top, rect.bottom - cy) - RADIUS_MARGIN_PX;
  return Math.max(inner, MIN_RADIUS_BUDGET);
}

/** The landscape dock's width for a viewport width. */
export function dockWidth(w: number): number {
  const W = Number.isFinite(w) && w > 0 ? w : 0;
  const clamped = Math.min(Math.max(320, 0.38 * W), 400);
  return Math.min(clamped, 0.5 * W);
}

/* --------------------------------------------------------------- the unit conversion for a DELTA */

/**
 * A temperature ANOMALY in °F, from the same anomaly in °C.
 *
 * Multiply by 1.8 and add nothing. A deviation is a difference of two temperatures, so the `+32` offset cancels
 * — applying the absolute formula would turn a +1.5 °C anomaly into +34.7 °F, which is not a number any climate
 * readout shows. `lib/regions.ts:90` already states this law (`celsiusDeltaToFahrenheit`) and this function is
 * deliberately a re-export-shaped wrapper rather than a second derivation: the store value is °C, the label is
 * whatever the units toggle says, and the CATEGORY (weak / strong / very strong) always classifies the °C value,
 * because the ONI bands are defined in °C.
 */
export function anomalyDeltaUnit(anomalyC: number, units: 'metric' | 'imperial'): { value: number; unit: string } {
  const c = Number.isFinite(anomalyC) ? anomalyC : 0;
  return units === 'imperial' ? { value: c * 1.8, unit: '°F' } : { value: c, unit: '°C' };
}
