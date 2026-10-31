/**
 * `computeInsets` — every case asserted with EXACT numbers.
 *
 * No `toBeCloseTo` anywhere: this is integer-ish rectangle arithmetic, and a tolerance in the test
 * would let an off-by-one in the clamp or the padding survive. The cases below are the ones a runtime
 * probe on a real page finds hardest to produce — several edges at once, two panels stacked on one
 * edge, a panel bigger than the screen — which is exactly why the arithmetic is a pure function.
 */
import { describe, expect, it } from 'vitest';
import { computeInsets, type OccluderRect, type Viewport } from './insets';

const VP: Viewport = { w: 1280, h: 800 };

/** Convenience: a rect from edges. */
const r = (id: string, left: number, top: number, right: number, bottom: number): OccluderRect => ({
  id,
  left,
  top,
  right,
  bottom,
});

describe('computeInsets', () => {
  it('empty list: no insets, free is the whole viewport, not degenerate', () => {
    const out = computeInsets(VP, []);
    expect(out).toEqual({
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      free: { x: 0, y: 0, w: 1280, h: 800 },
      degenerate: false,
      ignored: [],
    });
  });

  it('single left panel: left inset is its width', () => {
    const out = computeInsets(VP, [r('deck', 0, 311.5, 360.844, 800)]);
    expect(out.left).toBe(360.844);
    expect(out.right).toBe(0);
    expect(out.top).toBe(0);
    expect(out.bottom).toBe(0);
    expect(out.free).toEqual({ x: 360.844, y: 0, w: 919.156, h: 800 });
    expect(out.ignored).toEqual([]);
  });

  it('left + right + top: three insets at once', () => {
    const out = computeInsets(VP, [
      r('deck', 0, 311.5, 360.844, 800),
      r('cards', 964, 245.9, 1280, 554.1),
      r('header', 0, 0, 1280, 118.25),
    ]);
    expect(out.left).toBe(360.844);
    expect(out.right).toBe(316);
    expect(out.top).toBe(118.25);
    expect(out.bottom).toBe(0);
    expect(out.free).toEqual({ x: 360.844, y: 118.25, w: 603.156, h: 681.75 });
    /*
     * The header spans the full width AND touches the top edge. It is classified as a top element and
     * its cost there is its height (118.25), not its width — that is the "corner element goes to the
     * thinner edge" rule.
     */
    expect(out.ignored).toEqual([]);
  });

  it('overlapping panels on the same edge take the MAX, never the sum', () => {
    const out = computeInsets(VP, [
      r('cards', 964, 245.9, 1280, 554.1), // 316 wide
      r('drawer', 862, 0, 1280, 800), // 418 wide, overlapping cards
    ]);
    expect(out.right).toBe(418);
    expect(out.free.w).toBe(862);
  });

  it('a floating rect is ignored and reported', () => {
    const out = computeInsets(VP, [r('floating', 400, 300, 600, 500)]);
    expect(out).toEqual({
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      free: { x: 0, y: 0, w: 1280, h: 800 },
      degenerate: false,
      ignored: ['floating'],
    });
  });

  it('a zero-area rect (display:none / 0x0) is ignored and reported', () => {
    const out = computeInsets(VP, [
      r('hidden', 0, 0, 0, 0),
      r('flat', 0, 100, 400, 100), // zero height
      r('deck', 0, 311.5, 360.844, 800),
    ]);
    expect(out.left).toBe(360.844);
    expect(out.ignored).toEqual(['hidden', 'flat']);
  });

  it('a rect touching TWO edges is charged to the THINNER edge only', () => {
    /*
     * Full-width, 118.25 tall. Perpendicular to the top its thickness is 118.25; perpendicular to the
     * left/right it is the full 1280. The thinner axis is the one it actually costs space on, so it is
     * charged to the top and the horizontal insets stay 0. Charging every touched edge would report a
     * 1043-wide free rectangle for a header that only covers the top strip.
     */
    const out = computeInsets(VP, [r('header', 0, 0, 1280, 118.25)]);
    expect(out.top).toBe(118.25);
    expect(out.left).toBe(0);
    expect(out.right).toBe(0);
    expect(out.bottom).toBe(0);
    expect(out.free).toEqual({ x: 0, y: 118.25, w: 1280, h: 681.75 });
  });

  it('a full-height side panel is charged to its own side, not to top/bottom', () => {
    // 360 wide x 800 tall: thinner against the left (360) than against top/bottom (800).
    const out = computeInsets(VP, [r('deck', 0, 0, 360, 800)]);
    expect(out.left).toBe(360);
    expect(out.top).toBe(0);
    expect(out.bottom).toBe(0);
    expect(out.free.w).toBe(920);
  });

  it('insets larger than the viewport: free is 0, not negative, and it is degenerate', () => {
    /*
     * Two full-height side panels wider than the viewport between them, plus a tall bottom panel.
     * Each is assigned by the thinner-axis rule: 700 vs 800 -> its own side for the first two.
     */
    const out = computeInsets(VP, [
      r('left-wide', 0, 0, 700, 800),
      r('right-wide', 580, 0, 1280, 800),
      r('bottom-tall', 0, 300, 1280, 800),
    ]);
    expect(out.left).toBe(700);
    expect(out.right).toBe(700);
    expect(out.bottom).toBe(500);
    expect(out.free.w).toBe(0);
    expect(out.free.h).toBe(300);
    expect(out.degenerate).toBe(true);
  });

  it('padding shrinks the free rect and shifts its origin', () => {
    const out = computeInsets(VP, [r('deck', 0, 311.5, 360.844, 800)], { padding: 24 });
    expect(out.free).toEqual({ x: 384.844, y: 24, w: 871.156, h: 752 });
    expect(out.degenerate).toBe(false);
  });

  it('fractional rects keep their precision', () => {
    const out = computeInsets(VP, [r('deck', 0, 311.5, 360.844, 800), r('header', 0, 0, 1280, 118.25)]);
    expect(out.left).toBe(360.844);
    expect(out.top).toBe(118.25);
    expect(out.free.h).toBe(681.75);
    expect(out.free.w).toBe(919.156);
  });

  it('viewport 0 by 0 is degenerate with no negative dimensions', () => {
    const out = computeInsets({ w: 0, h: 0 }, [r('deck', 0, 0, 100, 100), r('header', 0, 0, 100, 50)]);
    expect(out.free.w).toBe(0);
    expect(out.free.h).toBe(0);
    expect(out.degenerate).toBe(true);
    expect(out.left).toBeGreaterThanOrEqual(0);
    expect(out.right).toBeGreaterThanOrEqual(0);
    expect(out.top).toBeGreaterThanOrEqual(0);
    expect(out.bottom).toBeGreaterThanOrEqual(0);
  });

  it('a panel translated OFF-canvas contributes nothing, even though it spans the full height', () => {
    /*
     * THE CLOSED DRAWER, from the live page: `translate-x-[110%]` puts it at x 1321..1739 on a
     * 1280 px viewport, while its top is 0 and its bottom is 800. An unclipped classifier sees it
     * touching TOP and BOTTOM and reports a top inset of the whole screen (measured: top 900,
     * free.h 0, degenerate true at all three viewports). Clipping to the viewport makes the visible
     * width 0, and a zero-area rect is ignored — from geometry, not a special case.
     */
    const out = computeInsets(VP, [r('right-drawer', 1321.8, 0, 1739.8, 800)]);
    expect(out.left).toBe(0);
    expect(out.right).toBe(0);
    expect(out.top).toBe(0);
    expect(out.bottom).toBe(0);
    expect(out.free).toEqual({ x: 0, y: 0, w: 1280, h: 800 });
    expect(out.degenerate).toBe(false);
    expect(out.ignored).toEqual(['right-drawer']);
  });

  it('a panel poking past one edge is charged only its on-canvas thickness', () => {
    // 418 wide but only 300 px of it is on a 1280 px viewport: right 1580.
    const out = computeInsets(VP, [r('overhang', 980, 0, 1580, 800)]);
    expect(out.right).toBe(300);
    expect(out.free.w).toBe(980);
  });

  it('edgeTolerance: a panel 2 px inside the edge still counts as attached', () => {
    // Touches left (2 px in) and bottom (2 px in). Left thickness 358.844 is the thinner axis.
    const out = computeInsets(VP, [r('deck', 2, 311.5, 360.844, 798)]);
    expect(out.left).toBe(358.844);
    expect(out.bottom).toBe(0);
    // And the floating case, 20 px in, is beyond the 8 px tolerance.
    const floating = computeInsets(VP, [r('deck', 20, 311.5, 360.844, 780)]);
    expect(floating.left).toBe(0);
    expect(floating.ignored).toEqual(['deck']);
  });

  it('edgeTolerance: a panel further in than the tolerance is floating and ignored', () => {
    const out = computeInsets(VP, [r('inset', 20, 311.5, 360.844, 780)]);
    expect(out.ignored).toEqual(['inset']);
    expect(out.left).toBe(0);
  });
});
