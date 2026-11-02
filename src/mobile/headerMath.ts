/**
 * The phoneLandscape header's geometry law. Pure: no DOM, no React.
 *
 * ## Why this is a module and not a comment in `HeaderCompact.tsx`
 *
 * The defect this replaces was a header whose height was a function of DATA: the ENSO chip's width
 * varied with `formatIsland(anomalyC)` (measured 128.53 px at `NEUTRAL` to 208.09 px at
 * `VERY STRONG EL NIÑO`), it sat beside an `h1` in a `flex-1` slot, and the `h1` wrapped whenever the
 * remaining space fell below its 229.06 px natural width. At 667x375 that produced a header measured at
 * **113.50 px at 265 ms and 194.75 px at 2326 ms** — a header that grew by 81.25 px after the page was
 * interactive, which moved the free rect, the radius budget and the camera fit underneath the reader.
 *
 * The fix has to be provable, so the two numbers that decide the layout are constants with a law over
 * them: a **fixed chip reservation** (so no chip text can change any width) and a **row count chosen by
 * viewport WIDTH alone**. Both are asserted in `headerMath.test.ts`, and the DOM is then a transcription
 * of them rather than a second derivation.
 *
 * ## The two rows, and why the breakpoint is 800
 *
 * One row needs, measured in the browser at `deviceScaleFactor 2`:
 *
 *     padL 12 + badge 20 + gap 8 + h1 229.06 + gap 12 + chip 252 + gap 12 + controls 194 + padR 12
 *     = 751.06 px
 *
 * (the 194 px controls cluster is its ICON-ONLY form — the Snapshot label is `sr-only` in landscape, or
 * the same row measures 864 px and cannot fit even at 932). So a single row is only honest at a viewport
 * that can hold 751.06 px of content, and 768 - 24 = 744 is 7 px short. The breakpoint is therefore
 * **800**, which leaves 24.94 px of slack and keeps every viewport in the acceptance matrix on the side
 * its own budget says it belongs.
 *
 * Below 800 the header is a fixed TWO-row layout: `h1` row, then chip + controls. Below 800 the chip and
 * the three controls need 252 + 12 + 194 = 458 px, and the narrowest landscape row (568) has 544, so the
 * second row fits with 86 px to spare while the first row (badge 20 + gap 8 + h1 229.06 = 257.06) has 287.
 *
 * ## The heights
 *
 *     one row  = pt 2 + max(chip 44, controls 50) + pb 2                            = 54
 *     two rows = pt 2 + identity 20 + row-gap 2 + max(chip 44, controls 50) + pb 2   = 76
 *
 * `LANDSCAPE_CONTROL_H = 50` is MEASURED: two 44 px unit buttons inside a `p-0.5` pill with 1 px
 * borders. 76 is not a preference. Two bounds fix it from opposite sides:
 *
 *   - `headerBottom <= 0.25 * H` is 80.00 px at 568x320, so a two-row header must be at most 80.
 *   - the 667x375 disc must render at `r >= 120 px`. `Rb = (H - top)/2 - 12` at 375 tall, and
 *     `r = 0.905 * Rb`, so `top <= 76.6` — a header of 78 gives `Rb` 136.5 and `r` 123.5 (passes), and
 *     one at 80 gives `Rb` 135.5 and `r` 122.6 (still passes) but leaves only 4 px under the F4 bound at
 *     568x320. 76 buys both bounds their slack at once.
 */

/**
 * Viewport width from which the landscape header is ONE row. See the module comment for the 751.06 px
 * content budget behind it: 800 is the first Tailwind step that fits it with slack.
 *
 * Deliberately NOT 768: at 768 the content budget is 744 px against a 751.06 px row, which is the
 * seven-pixel version of the original defect — an `h1` that has to wrap but is not allowed to.
 */
export const LANDSCAPE_ONE_ROW_MIN_W = 800;

/**
 * The ENSO chip's reserved width in landscape, px.
 *
 * The chip's text is `formatIsland(anomalyC)`, whose measured span is **128.53 px** (`ENSO: 0.0°C |
 * NEUTRAL`) to **208.09 px** (`ENSO: +2.0°C | VERY STRONG EL NIÑO`), plus 34 px of chrome (12 + 12
 * padding, 8 gap, 1 + 1 border). 252 reserves 218 px for text — 9.91 px more than the longest string
 * the store can produce — so the chip's box is identical for every data value in `SST_MIN..SST_MAX`.
 *
 * A `min-width` would NOT do: the box would still grow with the text, which is the data dependence
 * this constant exists to remove.
 */
export const LANDSCAPE_CHIP_W = 252;

/** The chrome inside the chip's button, px: 12 + 12 padding, 8 dot gap, 1 + 1 border. */
export const LANDSCAPE_CHIP_CHROME = 34;

/**
 * The tallest control cluster in landscape, px.
 *
 * MEASURED, not estimated: the unit toggle is two `h-11` (44 px) buttons inside a `p-0.5` pill with a
 * 1 px border, so the cluster is 44 + 4 + 2 = **50 px** — and 50 is what the browser reported as the
 * controls row's height at every landscape viewport before this step. An earlier draft of this module
 * carried 46 and the resulting 76 px box could not hold its own content, which is the class of error
 * the spec's DOM-vs-law comparison exists to catch.
 */
export const LANDSCAPE_CONTROL_H = 50;

/** The identity row's height in the two-row layout, px — the shrunk badge (`h-5`), not the `h-9` one. */
export const LANDSCAPE_IDENTITY_H = 20;

/**
 * Vertical padding, top and bottom, px.
 *
 * 2, not the portrait header's 8: landscape's height is the scarce dimension and the acceptance bound
 * is `headerBottom <= 0.25 * H`, which is 80.00 px at 568x320. With 50 px of controls and 20 px of
 * identity row, the total is `2 + 20 + 2 + 50 + 2 = 76` — four pixels of slack under the tightest row.
 */
export const LANDSCAPE_PAD_PX = 2;

/** The gap between the two rows in the two-row layout, px. */
export const LANDSCAPE_ROW_GAP_PX = 2;

/** How many rows the landscape header occupies at a viewport width. Width only — never content. */
export function landscapeHeaderRows(w: number): 1 | 2 {
  const W = Number.isFinite(w) && w > 0 ? w : 0;
  return W >= LANDSCAPE_ONE_ROW_MIN_W ? 1 : 2;
}

/**
 * The landscape header's height at a viewport width, px.
 *
 * This is the number `publishHeaderBottom` must report, and the reason F2 is checkable: it takes no
 * data argument, so no chip text and no `h1` wrap can reach it. The acceptance spec compares it against
 * the DOM's own `getBoundingClientRect().bottom` — at three moments per row — rather than trusting it.
 */
export function landscapeHeaderHeight(w: number): number {
  if (landscapeHeaderRows(w) === 1) {
    return LANDSCAPE_PAD_PX * 2 + Math.max(LANDSCAPE_CONTROL_H, LANDSCAPE_IDENTITY_H);
  }
  return (
    LANDSCAPE_PAD_PX * 2 + LANDSCAPE_IDENTITY_H + LANDSCAPE_ROW_GAP_PX + LANDSCAPE_CONTROL_H
  );
}

/** The horizontal content a one-row landscape header needs, px — the budget `LANDSCAPE_ONE_ROW_MIN_W` clears. */
export function landscapeOneRowWidth(): number {
  const PAD = 12;
  const GAP = 12;
  /* badge 20 + the identity row's own gap 8 + the h1's measured natural width 229.06 */
  const IDENTITY = LANDSCAPE_IDENTITY_H + 8 + 229.06;
  /* the three controls icon-only: two 44 px unit buttons + pill chrome 6, then 44 + 6 + 44 */
  const CONTROLS = 194;
  return PAD + IDENTITY + GAP + LANDSCAPE_CHIP_W + GAP + CONTROLS + PAD;
}
