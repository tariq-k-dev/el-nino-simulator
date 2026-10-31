import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createFrameProbe } from './frameProbe';
import { D0, type FrameProbeState } from '@/layout/framing';

/*
 * The probe is a thin adapter, so what these tests pin down is the two things an adapter gets wrong:
 *
 * 1. it must report the LOCKED truth when no live rig exists, rather than zeros that look live (a
 *    spec asserting `cameraViewIsNull === false` on a locked page would otherwise pass), and
 * 2. it must read through to the rig, so a poll observes the LATEST frame rather than a snapshot
 *    taken at mount.
 */

function cameraAt(distance: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(42, 1.6, 0.1, 400);
  cam.position.set(0, 0, distance);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  return cam;
}

const liveState = (over: Partial<FrameProbeState> = {}): FrameProbeState => ({
  mode: 'live',
  insets: { top: 118.3, right: 316, bottom: 0, left: 360.844 },
  free: { x: 384.844, y: 142.3, w: 555.156, h: 633.7 },
  target: { dx: 22.422, dy: 59.15, d: 4.283 },
  current: { dx: 22.422, dy: 59.15, d: 4.283 },
  settled: true,
  degenerate: false,
  cameraViewIsNull: false,
  /* Step 3B: the fixture needs the machine fields, which are now part of the total state type. */
  focus: 'idle',
  userZoomed: false,
  regionId: null,
  ...over,
});

describe('createFrameProbe — locked', () => {
  it('reports the locked truth when the rig has never run', () => {
    const cam = cameraAt(D0);
    const probe = createFrameProbe(() => null, cam);

    expect(probe.mode).toBe('live'); // production/vitest default, see framing.test.ts
    expect(probe.target).toEqual({ dx: 0, dy: 0, d: D0 });
    expect(probe.current.dx).toBe(0);
    expect(probe.current.dy).toBe(0);
    expect(probe.settled).toBe(true);
    expect(probe.degenerate).toBe(false);
  });

  it('reads cameraViewIsNull from the CAMERA, not from a constant', () => {
    /*
     * This is the field S1's sibling assertion turns on: "locked mode leaves camera.view null". If
     * the probe hardcoded `true` the assertion would be a restatement of the mode rather than
     * evidence about the camera, so the test installs a view offset and requires the probe to
     * notice.
     */
    const cam = cameraAt(D0);
    const probe = createFrameProbe(() => null, cam);
    expect(probe.cameraViewIsNull).toBe(true);

    cam.setViewOffset(1280, 800, -22, -59, 1280, 800);
    expect(probe.cameraViewIsNull).toBe(false);

    /*
     * `clearViewOffset()` sets `enabled = false` and leaves the object in place
     * (`three/src/cameras/PerspectiveCamera.js:202-212`), so the probe must test `enabled` and not
     * merely `view !== null`. Measured: a null-only check reported `false` here — the exact
     * inverse of the truth, on the one assertion this field exists to support.
     */
    cam.clearViewOffset();
    expect(cam.view).not.toBeNull();
    expect(probe.cameraViewIsNull).toBe(true);
  });

  it('reports the LIVE distance in current.d even with no rig', () => {
    // The camera may have been moved by a legacy writer; `d` must not claim d0 regardless.
    const probe = createFrameProbe(() => null, cameraAt(2.7));
    expect(probe.current.d).toBeCloseTo(2.7, 9);
  });
});

describe('createFrameProbe — live', () => {
  it('reads through to the rig on every access', () => {
    let state: FrameProbeState | null = liveState({ settled: false });
    const probe = createFrameProbe(() => state, cameraAt(4.283));

    expect(probe.mode).toBe('live');
    expect(probe.settled).toBe(false);

    // The rig publishes a newer frame; the probe must see it without being rebuilt.
    state = liveState({ settled: true });
    expect(probe.settled).toBe(true);
    expect(probe.free.w).toBeCloseTo(555.156, 6);
  });

  it('returns copies, so a caller cannot mutate the rig state', () => {
    const state = liveState();
    const probe = createFrameProbe(() => state, cameraAt(4.283));

    const free = probe.free;
    free.w = -1;
    probe.insets.left = -1;

    expect(probe.free.w).toBeCloseTo(555.156, 6);
    expect(probe.insets.left).toBeCloseTo(360.844, 6);
  });

  it('snapshot() is one coherent read', () => {
    let reads = 0;
    const probe = createFrameProbe(() => {
      reads += 1;
      return liveState({ settled: reads > 1 });
    }, cameraAt(4.283));

    const snap = probe.snapshot();
    expect(reads).toBe(1);
    expect(snap.settled).toBe(false);
    expect(snap.mode).toBe('live');
    expect(snap.cameraViewIsNull).toBe(false);
  });

  it('falls back to the locked report if the rig slot is cleared', () => {
    let state: FrameProbeState | null = liveState();
    const probe = createFrameProbe(() => state, cameraAt(D0));
    expect(probe.settled).toBe(true);
    expect(probe.free.w).toBeCloseTo(555.156, 6);

    // A remount clears the slot; the probe must not keep reporting the last live frame as current.
    state = null;
    expect(probe.free.w).toBe(0);
    expect(probe.target.d).toBeCloseTo(D0, 9);
  });
});
