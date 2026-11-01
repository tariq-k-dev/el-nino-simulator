/**
 * The mobile snap-sheet's arithmetic — pure, no DOM, no React, no three.js.
 *
 * Same reason `layout/insets.ts` and `layout/frame.ts` are pure: every interesting case here is
 * arithmetic (a flick that overshoots, a drag that stops one pixel short of a tier, a rubber-band that
 * must not run away), and those are the cases a browser probe finds hardest to produce and easiest to
 * get wrong by eye. The runtime half (`useSheetDrag.ts`) has nothing left to get wrong except plumbing.
 *
 * ## The coordinate system, stated once
 *
 * The sheet is `full × viewportH` tall and pinned to the bottom. Its `transform: translateY(y)` moves it
 * DOWN by `y` px, so:
 *
 *     y = 0        -> the sheet fills the screen   (FULL)
 *     y > 0        -> the sheet is pushed off the bottom, showing `full × H − y` of itself
 *
 * "The visible fraction of the viewport" is therefore `(full·H − y) / H`. The tiers in the prompt are
 * expressed as visible fractions, and `computeSnapPoints` is the single place the two vocabularies meet.
 *
 * ## Why the tiers are fractions and not pixels
 *
 * A pixel tier would be wrong on every phone but the one it was tuned on. A fraction survives an
 * orientation change and `visualViewport` resizing under the browser chrome, which is the whole reason
 * the geometry is recomputed from JS on resize.
 */

import { peekVisible } from '@/mobile/layoutMath';

/**
 * The narrowest desktop width, minus one hundredth of a pixel.
 *
 * `767.98` rather than `767` because a media query is evaluated against a fractional CSS width: at
 * 767.99 px (a 768 px layout in a 0.999 zoom) `max-width: 767px` is false and the desktop layout would
 * get a phone's sheet for two hundredths of a pixel. The value is duplicated in the Tailwind media query
 * and `MOBILE_QUERY` below, and `snapMath.test.ts` asserts the two are the same string.
 */
export const BREAKPOINT_MAX = 767.98;

/** The media query the single matchMedia listener in `layoutMode.ts` uses. */
export const MOBILE_QUERY = `(max-width: ${BREAKPOINT_MAX}px)`;

/**
 * Which tiers exist, low to high. The ORDER is load-bearing: it is the keyboard's `ArrowUp`/`ArrowDown`
 * direction, the `aria-valuenow` index, and the tie-breaker in `resolveSnap`.
 */
export const TIERS = ['peek', 'half', 'full'] as const;
export type Tier = (typeof TIERS)[number];
export type TierIndex = 0 | 1 | 2;

/**
 * Visible fraction of the viewport height, per tier.
 *
 * 0.18 leaves a sliver of map and the genre-standard handle; 0.48 puts the teleconnection sliders and the
 * core metrics in reach without hiding the pins; 0.88 keeps the top of the globe, the HUD and the hotspot
 * labels visible above the sheet at full, so a reader can still see what the prose is about.
 */
export const TIER_FRACTION: Record<Tier, number> = {
  peek: 0.18,
  half: 0.48,
  full: 0.88,
};

/**
 * The sheet's own height, as a fraction of the viewport.
 *
 * This is the FULL TIER'S OWN FRACTION, not `1`. The difference is not cosmetic and it was settled by
 * arithmetic against the step's acceptance numbers rather than chosen:
 *
 *   - The prompt's M4 asserts the sheet's rectangular top is 692, 439 and 101 px at 390 x 844 for peek,
 *     half and full.
 *   - `0.82 · 844 = 691.99`, `0.52 · 844 = 438.88`, `0.12 · 844 = 101.28`. Those are the three accepted
 *     values, and they are what `(1 − fraction) · H` gives.
 *   - A sheet of height `H` at `translateY(0)` has `rect.top = 0`, so `full` would read 0, not 101.
 *   - A sheet of height `0.88·H` sits at `rect.top = 0.12·H` before any transform, and at full the transform
 *     is 0 — so `full` reads 101.28. Adding the tier's translate gives 438.88 and 691.99 for the other two.
 *
 * So the sheet does NOT reach the top of the screen even at full: a 0.12·H band of globe, HUD and hotspot
 * labels stays visible above it, which is the same band the prose at full tier is describing. The prompt's
 * "full * viewportH" means the full TIER's fraction, and `fullTierHeight` below is that reading, stated as
 * code so the two cannot drift.
 */
export const SHEET_HEIGHT_FRACTION = TIER_FRACTION.full;

/**
 * Where the globe's centre sits, as a fraction of the viewport height.
 *
 * 0.275 is the centre of the upper 55 %: `0.55 / 2`. Written as the division rather than as `0.275` so
 * the relationship survives a change to the upper band — and so a reader can see why the number is not
 * round. `camera.setViewOffset` uses it in step B; the specs assert against `0.275 * H` directly.
 */
export const VIEW_CENTER_FRACTION = 0.55 / 2;

/** The viewport fraction the mobile fit may use: full width, top 55 % of the height. */
export const MOBILE_FREE_TOP_FRACTION = 0.55;

/** px a pointer may travel and still count as a TAP rather than a drag. */
export const TAP_MAX_MOVE_PX = 6;

/** ms a tap may last, so a slow press-and-release does not flick the sheet. */
export const TAP_MAX_MS = 300;

/** ms of projection for a flick's velocity. The prompt's own 120 ms. */
export const FLICK_PROJECTION_MS = 120;

/**
 * The rubber-band's asymptote, as a fraction of the viewport height.
 *
 * A finger that drags 400 px past `peek` on an 844 px phone moves the sheet by
 * `0.25·844·(1 − e^{−400/(0.25·844)}) = 179 px`, i.e. under half of what it asked for and never more than
 * 211 px. That is the property that keeps an overscroll from hiding the sheet: the resistance grows with
 * the overshoot, so there is no distance at which the sheet leaves the screen.
 */
export const RUBBER_ASYMPTOTE_FRACTION = 0.25;

/** The snap transition, and its reduced-motion duration. */
export const SNAP_DURATION_MS = 320;
export const SNAP_EASING = 'cubic-bezier(0.22,1,0.36,1)';

/** The snap points for one viewport height, in px of `translateY`, keyed by tier. */
export type SnapPoints = Record<Tier, number>;

/** How far back the velocity window looks, ms. Declared before its first use below. */
export const VELOCITY_WINDOW_MS = 100;

/** How many samples the ring buffer holds. Five, per the prompt. */
export const VELOCITY_SAMPLES = 5;

/** Clamp, without importing `lib/model.ts` (which is scenario maths, not geometry). */
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Guard a viewport height once, so every function below agrees about what "no height" means. */
const safeHeight = (viewportH: number): number =>
  Number.isFinite(viewportH) && viewportH > 0 ? viewportH : 0;

/** The sheet's pixel height for a viewport. Shared by the geometry and the snap points. */
export function sheetHeight(viewportH: number): number {
  return SHEET_HEIGHT_FRACTION * safeHeight(viewportH);
}

/**
 * The `translateY` in px for each tier.
 *
 *     full = (SHEET_HEIGHT − full) · H = 0
 *     half = (SHEET_HEIGHT − half) · H
 *     peek = (SHEET_HEIGHT − peek) · H
 *
 * At 844 px: 0, 337.60, 590.80. Add those to the sheet's untranslated top (`H − SHEET_HEIGHT` = 101.28) and
 * the three `rect.top` values are 101.28, 438.88 and 692.08 — the step's M4 numbers.
 *
 * A negative or non-finite height is reported as `0` everywhere rather than producing `NaN` transforms:
 * `visualViewport.height` is `0` during the first layout pass on some browsers, and a `translateY(NaN)`
 * silently drops the whole transform, which would leave the sheet at full on load.
 */
export function computeSnapPoints(viewportH: number): SnapPoints {
  const h = Number.isFinite(viewportH) && viewportH > 0 ? viewportH : 0;
  return {
    full: (SHEET_HEIGHT_FRACTION - TIER_FRACTION.full) * h,
    half: (SHEET_HEIGHT_FRACTION - TIER_FRACTION.half) * h,
    /*
     * The peek point is where the sheet's TOP sits at `h - peekVisible(h)`, which is the same line the camera's
     * free rect ends at. Written as the subtraction rather than as the fraction so the clamp is visible in the code
     * that places the sheet.
     */
    peek: h === 0 ? 0 : h - peekVisible(h) - (h - SHEET_HEIGHT_FRACTION * h),
  };
}

/**
 * Resistance for a drag that leaves the valid range.
 *
 * Three properties, each of which is a unit test:
 *
 *   - `rubberBand(0, H) === 0` — the boundary is continuous, so a drag that stops exactly at `peek` and
 *     one that stops one pixel past it differ by 0.98 px, not by a jump.
 *   - monotone increasing, and bounded by `RUBBER_ASYMPTOTE_FRACTION · H` — the sheet can never be dragged
 *     off the screen however hard it is thrown.
 *   - odd-symmetric in sign: dragging the other way is resisted identically, so the sheet does not feel
 *     different at the top of its range than at the bottom.
 *
 * The form is the standard iOS one, `A·(1 − e^{−o/A})`, with `A` the asymptote. `o` is the overshoot in
 * px and the result is the distance the sheet actually moves, in px.
 */
export function rubberBand(over: number, viewportH: number): number {
  if (!Number.isFinite(over) || over === 0) return 0;
  const h = Number.isFinite(viewportH) && viewportH > 0 ? viewportH : 0;
  const asymptote = RUBBER_ASYMPTOTE_FRACTION * h;
  if (asymptote <= 0) return 0;
  const sign = over < 0 ? -1 : 1;
  const magnitude = Math.abs(over);
  return sign * asymptote * (1 - Math.exp(-magnitude / asymptote));
}

/**
 * Convert a raw drag position into the value the sheet is actually drawn at.
 *
 * Inside `[full, peek]` this is the identity — the sheet tracks the finger exactly. Outside it, only the
 * OVERSHOOT is rubber-banded, so the sheet still reaches the boundary in full.
 *
 * The range is `[full, peek]` rather than `[peek, full]` because `full` is 0 and `peek` is the largest
 * translate; a caller that has the two the other way round would rubber-band the whole usable range.
 */
export function clampDrag(y: number, points: SnapPoints, viewportH: number): number {
  const lo = points.full;
  const hi = points.peek;
  if (!Number.isFinite(y)) return lo;
  if (y < lo) return lo + rubberBand(y - lo, viewportH);
  if (y > hi) return hi + rubberBand(y - hi, viewportH);
  return y;
}

/** Which tier a snap point corresponds to, by exact match within a tolerance. */
function tierOf(point: number, points: SnapPoints): Tier {
  let best: Tier = 'peek';
  let bestDelta = Infinity;
  for (const tier of TIERS) {
    const delta = Math.abs(points[tier] - point);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = tier;
    }
  }
  return best;
}

/** The index of a tier, for `aria-valuenow`. */
export function tierIndex(tier: Tier): TierIndex {
  return TIERS.indexOf(tier) as TierIndex;
}

/**
 * Project a velocity and pick the nearest snap point.
 *
 * ## Why the projection rather than a distance rule
 *
 * A pure "nearest point" rule makes a flick useless: a fast upward flick that stops a third of the way
 * from `peek` toward `half` would return to `peek`, because that is nearer. Projecting `y + v·120 ms`
 * first means a fast enough flick lands a tier further along even though the finger stopped short, which is
 * what every native sheet does and what the M5 case measures.
 *
 * ## The clamp is to the VALID RANGE, not to the nearest point
 *
 * The projected value can leave `[full, peek]` by any amount; it is clamped before the nearest-point
 * search so a large velocity cannot wrap past an end and choose the far tier.
 *
 * `points` is read, never recomputed, so a caller holding stale points for one frame snaps to those
 * rather than to a mid-resize set.
 */
export function resolveSnap(y: number, velocityPxPerMs: number, points: SnapPoints): Tier {
  const lo = points.full;
  const hi = points.peek;
  const projected = y + velocityPxPerMs * FLICK_PROJECTION_MS;
  const target = clamp(Number.isFinite(projected) ? projected : y, lo, hi);
  return tierOf(target, points);
}

/**
 * The tier a TAP on the handle cycles to.
 *
 * peek -> half -> full -> half. Full returns to half rather than to peek because a tap at full is a
 * request for more map, and dropping the reader two tiers for one tap is a surprise. This is the prompt's
 * rule verbatim and it is a separate function so the direction is a table entry rather than a branch
 * buried in an event handler.
 */
export function cycleTier(tier: Tier): Tier {
  if (tier === 'peek') return 'half';
  if (tier === 'half') return 'full';
  return 'half';
}

/**
 * Did this gesture qualify as a tap?
 *
 * Both bounds are needed: a 3 px move over 2 s is a press, and a 40 px move in 80 ms is a flick. Neither
 * is a tap, and treating either as one would make the handle cycle a tier in the middle of a careful
 * read. `TAP_MAX_MS` is what stops a long press from being a tap.
 */
export function isTap(movePx: number, durationMs: number): boolean {
  return (
    Number.isFinite(movePx) &&
    Number.isFinite(durationMs) &&
    Math.abs(movePx) < TAP_MAX_MOVE_PX &&
    durationMs < TAP_MAX_MS
  );
}

/** Whether a click following a drag must be suppressed. One rule, one place. */
export function suppressesClick(movePx: number): boolean {
  return Math.abs(movePx) > TAP_MAX_MOVE_PX;
}

/**
 * The velocity over the last few samples, in px/ms.
 *
 * ## Why a trailing window and not `Δy/Δt` over the whole drag
 *
 * A drag that ends with a 300 ms pause before release has a near-zero true velocity and must SNAP BACK,
 * not flick. Averaging over the whole gesture would carry the speed of its fast middle into the release
 * and fling a sheet the reader had deliberately parked. A window of the last 100 ms answers "how fast was
 * the finger moving when it let go", which is the question the projection needs.
 *
 * A single sample (or none) reports 0 — there is no velocity to infer from one point, and inventing one
 * from the drag's start would make a slow drag with one move event fling.
 *
 * Returned in px/ms with the sheet's own sign convention: a downward drag (increasing `y`) is positive.
 */
export function sampleVelocity(samples: ReadonlyArray<{ y: number; t: number }>, now: number): number {
  if (samples.length < 2) return 0;
  const cutoff = now - VELOCITY_WINDOW_MS;
  /* Oldest sample still inside the window, never the whole history. */
  let first = samples[0];
  for (const s of samples) {
    if (s.t >= cutoff) {
      first = s;
      break;
    }
  }
  const last = samples[samples.length - 1];
  const dt = last.t - first.t;
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  return (last.y - first.y) / dt;
}
