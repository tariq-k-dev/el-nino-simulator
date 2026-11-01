/**
 * Step B — the mobile frame, and the view-offset SIGN, proven by projection.
 *
 * The prompt is explicit that the sign must be established by measurement and not guessed: "Project the
 * controls target and require its screen y to equal 0.275 * H within 1 px. If the sign is wrong, flip it."
 * So every geometric claim here is checked by building a REAL `THREE.PerspectiveCamera`, applying the offset
 * this module returns, and projecting the world origin through the resulting matrix. A wrong sign fails by
 * 2 x the offset (379.8 px at 390x844), not by a rounding error.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { computeMobileFrame } from './mobileFrame';
import { MOBILE_FREE_TOP_FRACTION, VIEW_CENTER_FRACTION } from './snapMath';
import { FOV_DEG, MAX_DISTANCE } from '@/layout/framing';

/** The step's own viewport. */
const W = 390;
const H = 844;

/** A camera at the shipped pose, with the mobile offset installed exactly as the director installs it. */
function cameraWith(frame: ReturnType<typeof computeMobileFrame>): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(FOV_DEG, W / H, 0.1, 400);
  camera.position.set(0, 1.15, 3.15);
  camera.lookAt(0, 0, 0);
  camera.setViewOffset(W, H, 0, frame.viewOffsetY, W, H);
  camera.updateMatrixWorld(true);
  return camera;
}

/** Where a world point lands, in CSS px from the viewport's top-left. */
function project(camera: THREE.PerspectiveCamera, point: [number, number, number]) {
  const v = new THREE.Vector3(...point).project(camera);
  return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H };
}

describe('the offset sign, measured', () => {
  it('puts the orbit target at 0.275 * H within 1 px', () => {
    const frame = computeMobileFrame(W, H);
    const camera = cameraWith(frame);
    const p = project(camera, [0, 0, 0]);
    const wanted = VIEW_CENTER_FRACTION * H;

    expect(VIEW_CENTER_FRACTION).toBeCloseTo(0.275, 12);
    expect(Math.abs(p.y - wanted), `projected y ${p.y} vs wanted ${wanted}`).toBeLessThanOrEqual(1);
    /* And the x is untouched: the offset is vertical only. */
    expect(Math.abs(p.x - W / 2)).toBeLessThanOrEqual(0.001);
  });

  it('would fail by 2x the offset if the sign were flipped, which is what makes the check meaningful', () => {
    /*
     * The negative control. Same camera, same position, offset negated: the target lands at
     * H - 0.275*H + ... i.e. far below the wanted line. If this test ever starts PASSING, the projection
     * convention changed and the product's sign is now wrong.
     */
    const frame = computeMobileFrame(W, H);
    const flipped = new THREE.PerspectiveCamera(FOV_DEG, W / H, 0.1, 400);
    flipped.position.set(0, 1.15, 3.15);
    flipped.lookAt(0, 0, 0);
    flipped.setViewOffset(W, H, 0, -frame.viewOffsetY, W, H);
    flipped.updateMatrixWorld(true);

    const wanted = VIEW_CENTER_FRACTION * H;
    const p = project(flipped, [0, 0, 0]);
    expect(Math.abs(p.y - wanted)).toBeGreaterThan(300);
  });

  it('leaves the target at the canvas centre with no offset, so the effect is attributable', () => {
    const plain = new THREE.PerspectiveCamera(FOV_DEG, W / H, 0.1, 400);
    plain.position.set(0, 1.15, 3.15);
    plain.lookAt(0, 0, 0);
    plain.updateMatrixWorld(true);
    const p = project(plain, [0, 0, 0]);
    expect(p.y).toBeCloseTo(H / 2, 6);
  });

  it('holds at 667 and 926 too, not only at the step viewport', () => {
    for (const height of [667, 844, 926]) {
      const frame = computeMobileFrame(390, height);
      const camera = new THREE.PerspectiveCamera(FOV_DEG, 390 / height, 0.1, 400);
      camera.position.set(0, 1.15, 3.15);
      camera.lookAt(0, 0, 0);
      camera.setViewOffset(390, height, 0, frame.viewOffsetY, 390, height);
      camera.updateMatrixWorld(true);
      const v = new THREE.Vector3(0, 0, 0).project(camera);
      const y = ((1 - v.y) / 2) * height;
      expect(Math.abs(y - VIEW_CENTER_FRACTION * height), `height ${height}`).toBeLessThanOrEqual(1);
    }
  });
});

describe('the free rect and the fit', () => {
  it('is full width and the top 55 percent', () => {
    const frame = computeMobileFrame(W, H);
    expect(frame.free.w).toBeCloseTo(W, 6);
    expect(frame.free.h).toBeCloseTo(MOBILE_FREE_TOP_FRACTION * H, 6);
    expect(frame.free.x).toBeCloseTo(0, 6);
    expect(frame.free.y).toBeCloseTo(0, 6);
  });

  it('reports dMax as the binding constraint at 390 x 844', () => {
    /*
     * The prompt asks this to be reported rather than assumed. `dContain` 7.1726 needs a camera further out
     * than `<OrbitControls maxDistance>` 5 allows, so the disc ends up larger than `rMax` — the same honest
     * clamp the 1024x768 desktop case already documents.
     */
    const frame = computeMobileFrame(W, H);
    expect(frame.dContain).toBeCloseTo(7.172611, 5);
    expect(frame.dTarget).toBe(MAX_DISTANCE);
    expect(frame.clampedByMax).toBe(true);
  });

  it('clamps on EVERY mobile viewport probed, not only at 390 x 844', () => {
    /*
     * Measured, not assumed (`.cache/mob/probe-fit.mjs`): `dContain` is 5.79 to 7.85 across 375x667,
     * 390x844, 390x926, 360x740, 667x375, 1024x768, 1200x600, 1920x1080 and 768x1024, and the asymptote is
     * 6.8167 as the viewport widens without bound — every one above the ceiling of 5. So this is not a quirk
     * of the spec viewport: on a phone the fit ALWAYS exceeds `<OrbitControls maxDistance>` and the ceiling
     * always wins.
     *
     * That is reported as a known limit rather than fixed, because raising `maxDistance` is a
     * `<GlobeScene>` change and the step's scope excludes desktop changes.
     */
    const probe = [
      [375, 667],
      [390, 844],
      [390, 926],
      [360, 740],
      [667, 375],
      [1024, 768],
      [768, 1024],
    ] as const;
    for (const [w, h] of probe) {
      const frame = computeMobileFrame(w, h);
      expect(frame.clampedByMax, `${w}x${h}`).toBe(true);
      expect(frame.dTarget, `${w}x${h}`).toBe(MAX_DISTANCE);
      expect(frame.dContain, `${w}x${h}`).toBeGreaterThan(MAX_DISTANCE);
    }
  });

  it('consequently draws the disc LARGER than rMax at 390 x 844, which is the limit to report', () => {
    /*
     * The size of the compromise, as a number: the free rect allows an `rMax` of 171.0 px radius, and the
     * ceiling of 5 renders a 248.5 px radius — so the globe spills 77.5 px past the free rect on each side
     * and its 497 px diameter is wider than the 390 px screen. Recorded in `docs/MOBILE.md`, not fixed.
     */
    const frame = computeMobileFrame(W, H);
    const focalPx = H / 2 / Math.tan((FOV_DEG * Math.PI) / 180 / 2);
    const rendered = Math.tan(Math.asin(1.10242 / MAX_DISTANCE)) * focalPx;

    expect(frame.rMax).toBeCloseTo(171, 6);
    expect(rendered).toBeCloseTo(248.5, 1);
    expect(rendered).toBeGreaterThan(frame.rMax);
    expect(frame.rMax - rendered).toBeCloseTo(-77.5, 1);
  });

  it('offsets DOWN in the positive direction, which is the sign `setViewOffset` takes', () => {
    const frame = computeMobileFrame(W, H);
    /* The centre is above the middle, so `dy` (the reported shift) is negative and the window offset is its
     * negation: +0.225 * H. */
    expect(frame.dy).toBeCloseTo(-0.225 * H, 6);
    expect(frame.viewOffsetY).toBeCloseTo(0.225 * H, 6);
    expect(frame.viewOffsetY).toBeGreaterThan(0);
  });

  it('keeps the view offset independent of the viewport height, as a FRACTION', () => {
    for (const height of [600, 667, 844, 926, 1200]) {
      const frame = computeMobileFrame(390, height);
      expect(frame.viewOffsetY / height).toBeCloseTo(0.225, 9);
    }
  });

  it('degrades to a degenerate frame rather than NaN for a zero viewport', () => {
    const frame = computeMobileFrame(0, 0);
    expect(frame.degenerate).toBe(true);
    expect(Number.isFinite(frame.viewOffsetY)).toBe(true);
    expect(Number.isFinite(frame.dTarget)).toBe(true);
  });
});
