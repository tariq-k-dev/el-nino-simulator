/**
 * The mobile fit, and the view-offset SIGN on BOTH axes, proven by projection.
 *
 * The prompt is explicit that the sign must be established by measurement and not guessed: "Project the controls
 * target and require its screen position to equal (cx, cy) within 1 px. If the sign is wrong, flip it." So every
 * geometric claim here builds a REAL `THREE.PerspectiveCamera`, applies the offset this module returns, and
 * projects the world origin through the resulting matrix. A wrong sign fails by 2 x the offset (measured: 379.8 px
 * at 390x844 for the Y axis), not by a rounding error.
 *
 * Step MOBILE2 replaced the fixed 55 % band with `computeFreeRect`, so the wanted centre is no longer
 * `0.275·H` — it is whatever the layout law says, which is what these cases read. The sign proof is unchanged in
 * kind and now covers X as well as Y, because the landscape dock moves the centre horizontally.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MOBILE_ENVELOPE, computeMobileFit, viewOffsetFor } from './mobileFrame';
import { computeFreeRect, resolveLayoutMode } from './layoutMath';
import { D0, FOV_DEG, MAX_DISTANCE, PIN_ENVELOPE } from '@/layout/framing';
import { SHELLS } from '@/scene/constants';

/** The step's own viewport, and a landscape one for the X-axis proof. */
const PORTRAIT = { w: 390, h: 844, header: 104 };
const LANDSCAPE = { w: 924, h: 412, header: 60 };

/**
 * A camera at the shipped pose with the fit's offsets installed exactly as the director installs them.
 *
 * The camera's aspect is the FULL viewport's, and the sub-window is the full `W x H` — a lens shift, so the
 * projection keeps the same scale and the disc stays a circle.
 */
function cameraWith(vp: { w: number; h: number }, offset: { x: number; y: number }): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(FOV_DEG, vp.w / vp.h, 0.1, 400);
  camera.position.set(0, 1.15, 3.15);
  camera.lookAt(0, 0, 0);
  camera.setViewOffset(vp.w, vp.h, offset.x, offset.y, vp.w, vp.h);
  camera.updateMatrixWorld(true);
  return camera;
}

/** Where a world point lands, in CSS px from the viewport's top-left. */
function project(camera: THREE.PerspectiveCamera, vp: { w: number; h: number }, point: [number, number, number]) {
  const v = new THREE.Vector3(...point).project(camera);
  return { x: ((v.x + 1) / 2) * vp.w, y: ((1 - v.y) / 2) * vp.h };
}

describe('the offset signs, measured', () => {
  it('PORTRAIT: the orbit target lands on (cx, cy) within 1 px', () => {
    const fit = computeMobileFit('portrait', PORTRAIT.w, PORTRAIT.h, PORTRAIT.header);
    const camera = cameraWith(PORTRAIT, { x: fit.offsetX, y: fit.offsetY });
    const p = project(camera, PORTRAIT, [0, 0, 0]);
    expect(Math.abs(p.x - fit.rect.cx), `x ${p.x} vs cx ${fit.rect.cx}`).toBeLessThanOrEqual(1);
    expect(Math.abs(p.y - fit.rect.cy), `y ${p.y} vs cy ${fit.rect.cy}`).toBeLessThanOrEqual(1);
  });

  it('LANDSCAPE: the same, with a NON-zero X offset — this is the axis MOBILE1 never had to prove', () => {
    const fit = computeMobileFit('phoneLandscape', LANDSCAPE.w, LANDSCAPE.h, LANDSCAPE.header);
    /*
     * The dock is on the right, so the centre sits LEFT of the viewport middle and `W/2 - cx` is POSITIVE — the
     * measured sign, not the guessed one. A positive `offsetX` selects a window to the right of the full frame, so
     * the content appears to move left, which is exactly where the centre belongs.
     */
    expect(fit.offsetX).toBeCloseTo(LANDSCAPE.w / 2 - fit.rect.cx, 12);
    expect(fit.offsetX).toBeGreaterThan(0);
    const camera = cameraWith(LANDSCAPE, { x: fit.offsetX, y: fit.offsetY });
    const p = project(camera, LANDSCAPE, [0, 0, 0]);
    expect(Math.abs(p.x - fit.rect.cx), `x ${p.x} vs cx ${fit.rect.cx}`).toBeLessThanOrEqual(1);
    expect(Math.abs(p.y - fit.rect.cy), `y ${p.y} vs cy ${fit.rect.cy}`).toBeLessThanOrEqual(1);
  });

  it('a flipped X sign misses by twice the offset, which is what makes the check meaningful', () => {
    const fit = computeMobileFit('phoneLandscape', LANDSCAPE.w, LANDSCAPE.h, LANDSCAPE.header);
    const flipped = cameraWith(LANDSCAPE, { x: -fit.offsetX, y: fit.offsetY });
    const p = project(flipped, LANDSCAPE, [0, 0, 0]);
    /* Twice the offset, within a pixel of float noise: 2 x 175.56 = 351.1. */
    expect(Math.abs(p.x - fit.rect.cx)).toBeGreaterThan(2 * Math.abs(fit.offsetX) - 1);
  });

  it('a flipped Y sign misses by twice the offset', () => {
    const fit = computeMobileFit('portrait', PORTRAIT.w, PORTRAIT.h, PORTRAIT.header);
    const flipped = cameraWith(PORTRAIT, { x: fit.offsetX, y: -fit.offsetY });
    const p = project(flipped, PORTRAIT, [0, 0, 0]);
    /* Twice the offset, within a pixel: 2 x 23.96 = 47.9. */
    expect(Math.abs(p.y - fit.rect.cy)).toBeGreaterThan(2 * Math.abs(fit.offsetY) - 1);
    /* ...and the product does not ship the flipped sign. The inequality is the measured size of the error. */
    const right = project(cameraWith(PORTRAIT, { x: fit.offsetX, y: fit.offsetY }), PORTRAIT, [0, 0, 0]);
    expect(Math.abs(right.y - fit.rect.cy)).toBeLessThanOrEqual(1);
  });

  it('the offset is the layout centre expressed the way setViewOffset wants it', () => {
    const fit = computeMobileFit('portrait', PORTRAIT.w, PORTRAIT.h, PORTRAIT.header);
    expect(fit.offsetX).toBeCloseTo(PORTRAIT.w / 2 - fit.rect.cx, 12);
    expect(fit.offsetY).toBeCloseTo(PORTRAIT.h / 2 - fit.rect.cy, 12);
    /* And the helper agrees with the fit, so nothing re-derives it. */
    expect(viewOffsetFor(PORTRAIT.w, PORTRAIT.h, fit.rect.cx, fit.rect.cy)).toEqual({
      x: fit.offsetX,
      y: fit.offsetY,
    });
  });
});

describe('the fit', () => {
  it('uses the LARGER of the pin envelope and the atmosphere shell', () => {
    expect(MOBILE_ENVELOPE).toBeCloseTo(Math.max(PIN_ENVELOPE, SHELLS.atmosphere), 12);
    /* Today the pin envelope wins; asserted so a retune of either number shows up as a diff here. */
    expect(MOBILE_ENVELOPE).toBeCloseTo(1.10242, 5);
  });

  it('dFit equals dContain: no ceiling clamp on mobile', () => {
    for (const vp of [PORTRAIT, LANDSCAPE, { w: 320, h: 568, header: 104 }, { w: 960, h: 1440, header: 104 }]) {
      const mode = resolveLayoutMode(vp.w, vp.h);
      const fit = computeMobileFit(mode, vp.w, vp.h, vp.header);
      expect(fit.dFit, `${vp.w}x${vp.h}`).toBeCloseTo(fit.dContain, 12);
    }
  });

  it('dMaxMode is max(5, 1.25 * dContain), so zoom-out headroom is always at least 1.2 * dFit', () => {
    for (const vp of [PORTRAIT, LANDSCAPE, { w: 320, h: 568, header: 104 }, { w: 412, h: 924, header: 104 }]) {
      const mode = resolveLayoutMode(vp.w, vp.h);
      const fit = computeMobileFit(mode, vp.w, vp.h, vp.header);
      expect(fit.dMaxMode, `${vp.w}x${vp.h}`).toBeCloseTo(Math.max(MAX_DISTANCE, 1.25 * fit.dContain), 12);
      expect(fit.dMaxMode).toBeGreaterThanOrEqual(1.2 * fit.dFit);
      /* And the floor: the desktop ceiling is never lowered. */
      expect(fit.dMaxMode).toBeGreaterThanOrEqual(MAX_DISTANCE);
    }
  });

  it('the disc fits the radius budget at the fitted distance', () => {
    /*
     * The inverse check of the d_contain law: at `dFit`, a sphere of radius `MOBILE_ENVELOPE` must have a
     * silhouette radius no larger than `Rb`. This is the arithmetic the LM3 case then measures in pixels.
     */
    for (const vp of [PORTRAIT, LANDSCAPE]) {
      const mode = resolveLayoutMode(vp.w, vp.h);
      const fit = computeMobileFit(mode, vp.w, vp.h, vp.header);
      const focalPx = vp.h / 2 / Math.tan((FOV_DEG * Math.PI) / 180 / 2);
      const silhouette = (focalPx * MOBILE_ENVELOPE) / Math.sqrt(fit.dFit ** 2 - MOBILE_ENVELOPE ** 2);
      expect(silhouette, `${vp.w}x${vp.h}`).toBeLessThanOrEqual(fit.rect.radiusBudget + 1e-9);
    }
  });

  it('the rect it reports is the layout law’s rect, not a second computation', () => {
    const fit = computeMobileFit('portrait', PORTRAIT.w, PORTRAIT.h, PORTRAIT.header);
    expect(fit.rect).toEqual(computeFreeRect('portrait', PORTRAIT.w, PORTRAIT.h, PORTRAIT.header));
  });

  it('a header taller than the viewport floors the radius budget rather than producing a negative one', () => {
    /*
     * `computeFreeRect` clamps the header's bottom to the viewport and floors the budget at 40 px, so this
     * pathological input yields a usable — if tiny — disc rather than a negative radius or a NaN distance. The fit
     * is NOT reported degenerate, because the rect never actually collapses: that is the floor doing its job.
     */
    const fit = computeMobileFit('portrait', 390, 844, 5000);
    expect(fit.rect.radiusBudget).toBe(40);
    expect(fit.degenerate).toBe(false);
    expect(Number.isFinite(fit.dFit)).toBe(true);
    /* And with a 40 px budget the camera has to sit far back — that is the honest consequence. */
    expect(fit.dFit).toBeGreaterThan(D0);
  });

  it('a zero-size viewport reports the shipped distance rather than NaN', () => {
    const fit = computeMobileFit('portrait', 0, 0, 0);
    expect(Number.isFinite(fit.dContain)).toBe(true);
    expect(Number.isFinite(fit.dFit)).toBe(true);
    expect(Number.isFinite(fit.dMaxMode)).toBe(true);
  });
});
