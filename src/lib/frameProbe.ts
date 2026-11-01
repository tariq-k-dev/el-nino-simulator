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
import { getViewState } from '@/scene/viewStore';

export interface FrameProbeSnapshot {
  mode: FramingMode;
  insets: { top: number; right: number; bottom: number; left: number };
  free: { x: number; y: number; w: number; h: number };
  target: { dx: number; dy: number; d: number };
  current: { dx: number; dy: number; d: number };
  settled: boolean;
  degenerate: boolean;
  cameraViewIsNull: boolean;
  focus: 'idle' | 'focusing' | 'focused' | 'returning';
  userZoomed: boolean;
  regionId: string | null;
  /** Step 3B2: the camera is at the framed default pose (Reset is disabled when true). */
  viewIsDefault: boolean;
  /** Step 3B2: the planet's spin is running. */
  spinning: boolean;
  /** Step 3B2: which focus policy this build runs — `locked` keeps aim-at-pin, `live` faces the pin. */
  focusPolicy: FramingMode;
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
  /** Step 3B: the focus machine's state. */
  readonly focus: 'idle' | 'focusing' | 'focused' | 'returning';
  /** Step 3B: whether the fit's distance channel is switched off. */
  readonly userZoomed: boolean;
  /** Step 3B: the targeted region, or null. */
  readonly regionId: string | null;
  /** Step 3B2: true when the camera is at the framed default pose. */
  readonly viewIsDefault: boolean;
  /** Step 3B2: true while the planet spins. */
  readonly spinning: boolean;
  /** Step 3B2: `locked` (aim-at-pin) or `live` (face-pin). */
  readonly focusPolicy: FramingMode;
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
    /*
     * Step 3B fields, reported honestly for the locked case: no director state exists here, so the
     * machine IS idle (nothing can be focusing on a page with no live rig), nothing has zoomed
     * through the fit's channel, and no region is targeted. Filled in rather than defaulted by the
     * reader, because `FrameProbeState` is a total type and a locked page must still answer.
     */
    focus: 'idle',
    userZoomed: false,
    regionId: null,
    /*
     * Step 3B2 fields, locked truth. There is no live rig here, so the camera IS at the shipped pose
     * and nothing has zoomed: `viewIsDefault` is true, and that is reported rather than defaulted by
     * the reader. `spinning` is read from the store, because the spin is scene state that exists in
     * locked mode too. `focusPolicy` is the RESOLVED mode: in a production/vitest build that is
     * 'live', in an E2E build without `framing=live` it is 'locked' — so a spec can assert which
     * policy it is measuring instead of assuming.
     */
    viewIsDefault: getViewState().viewIsDefault,
    spinning: getViewState().spinning,
    focusPolicy: FRAMING_MODE,
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
    get focus() {
      return state().focus;
    },
    get userZoomed() {
      return state().userZoomed;
    },
    get regionId() {
      return state().regionId;
    },
    get viewIsDefault() {
      const s = state();
      return s.viewIsDefault ?? true;
    },
    get spinning() {
      const s = state();
      return s.spinning ?? true;
    },
    get focusPolicy() {
      const s = state();
      return s.focusPolicy ?? s.mode;
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
        focus: s.focus,
        userZoomed: s.userZoomed,
        regionId: s.regionId,
        viewIsDefault: s.viewIsDefault ?? true,
        spinning: s.spinning ?? true,
        focusPolicy: s.focusPolicy ?? s.mode,
      };
    },
  };
  return probe;
}
