/**
 * `window.__frame` — the framing probe the `frame.spec.ts` cases read.
 *
 * A property-per-field object with GETTERS rather than a snapshot function, because every spec
 * polls it the same way (`expect.poll(() => page.evaluate(() => window.__frame.settled))`) and a
 * getter makes that read look like what it is. `snapshot()` exists for the cases that want one
 * coherent object — a poll of six separate getters can straddle two frames, and "centre is right
 * but distance is still easing" is a real state that would make a flaky assertion look like a bug.
 *
 * ## Locked mode
 *
 * In locked mode `read()` is null (no rig ever ran) and every field reports the locked truth:
 * zero offset, the shipped distance, `cameraViewIsNull === true`. `mode` comes from the shared
 * resolution in `layout/framing.ts`, so a spec can assert `mode === 'locked'` and then assert the
 * camera was never touched — which is the whole locked guarantee, stated in one place.
 *
 * Like `__globe`, this is installed only under `import.meta.env.VITE_E2E === '1' && ?debug`, and
 * `scripts/check-assets.mjs` fails a production build that contains the name.
 */
import type * as THREE from 'three';
import { D0, FRAMING_MODE, type FrameProbeState, type FramingMode } from '@/layout/framing';

export interface FrameProbeSnapshot {
  mode: FramingMode;
  insets: { top: number; right: number; bottom: number; left: number };
  free: { x: number; y: number; w: number; h: number };
  target: { dx: number; dy: number; d: number };
  current: { dx: number; dy: number; d: number };
  settled: boolean;
  degenerate: boolean;
  cameraViewIsNull: boolean;
}

export interface FrameProbe {
  readonly mode: FramingMode;
  readonly insets: { top: number; right: number; bottom: number; left: number };
  readonly free: { x: number; y: number; w: number; h: number };
  readonly target: { dx: number; dy: number; d: number };
  readonly current: { dx: number; dy: number; d: number };
  readonly settled: boolean;
  readonly degenerate: boolean;
  readonly cameraViewIsNull: boolean;
  /** One coherent read of every field, from the same frame. */
  snapshot(): FrameProbeSnapshot;
}

/** The state to report in locked mode — or before the first live frame. */
function lockedState(camera: THREE.Camera): FrameProbeState {
  const view = (camera as THREE.PerspectiveCamera).view;
  return {
    mode: FRAMING_MODE,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    free: { x: 0, y: 0, w: 0, h: 0 },
    target: { dx: 0, dy: 0, d: D0 },
    current: { dx: 0, dy: 0, d: camera.position.length() },
    settled: true,
    degenerate: false,
    /*
     * Read from the CAMERA, not hardcoded to true. In locked mode nothing installs a view offset so
     * this is true, but asserting it from the camera is what makes the field evidence rather than a
     * restatement of the mode.
     *
     * `enabled` is tested as well as `null`, because three's `clearViewOffset()` only sets
     * `view.enabled = false` — it leaves the object in place (`PerspectiveCamera.js:202-212`). A
     * null check alone would report `false` for a camera with no offset applied, i.e. exactly
     * backwards in the one case this field exists to catch.
     */
    cameraViewIsNull: view === null || view === undefined || view.enabled === false,
  };
}

/**
 * Build the probe.
 *
 * `read` returns the rig's last published state, or null when no live rig exists — the locked case.
 */
export function createFrameProbe(
  read: () => FrameProbeState | null,
  camera: THREE.Camera,
): FrameProbe {
  const state = (): FrameProbeState => read() ?? lockedState(camera);

  const probe: FrameProbe = {
    get mode() {
      return state().mode;
    },
    get insets() {
      return { ...state().insets };
    },
    get free() {
      return { ...state().free };
    },
    get target() {
      return { ...state().target };
    },
    get current() {
      return { ...state().current };
    },
    get settled() {
      return state().settled;
    },
    get degenerate() {
      return state().degenerate;
    },
    get cameraViewIsNull() {
      return state().cameraViewIsNull;
    },
    snapshot() {
      const s = state();
      return {
        mode: s.mode,
        insets: { ...s.insets },
        free: { ...s.free },
        target: { ...s.target },
        current: { ...s.current },
        settled: s.settled,
        degenerate: s.degenerate,
        cameraViewIsNull: s.cameraViewIsNull,
      };
    },
  };
  return probe;
}
