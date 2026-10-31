/**
 * `FrameRig` — puts the globe in the free rectangle, and sizes it to fit there.
 *
 * Lives inside the `<Canvas>` as a sibling of `<CameraRig>` and `<OrbitControls>`. It is the only
 * writer of the view offset, and the only writer that changes the distance because the LAYOUT
 * changed; it never touches the orbit target, the spherical orientation, or the control bounds.
 *
 * ## Locked and live
 *
 * In locked mode this component renders nothing and its `useFrame` does not exist, so an E2E spec
 * that does not ask for `framing=live` runs exactly the code it ran before this file existed. See
 * `src/layout/framing.ts` for the mode table and for why the branch is removed from the production
 * bundle rather than being a runtime `if`. `IS_LOCKED` below is written as `VITE_E2E === '1' && …`
 * so a production build folds it to `false` and drops both the branch and `noteLocked()` — which is
 * where `LOCKED_BRANCH_MARKER` lives, and therefore what the bundle grep in step C is testing.
 *
 * ## Two jobs, kept independent
 *
 * 1. **The offset is layout, and it always wins.** Where the globe sits is a function of which
 *    panels cover the canvas. Nothing the user does with the wheel or a drag may change it, so the
 *    offset is re-derived from the insets store every frame and applied whenever it moved by more
 *    than `OFFSET_EPSILON_PX`.
 *
 * 2. **The distance is the user's, unless they have not touched it.** A fit that reasserted itself
 *    every frame would do to the wheel exactly what the pre-3B `CameraRig` bug did
 *    (`CameraRig.tsx:64-84`: a per-frame distance writer that silently erased every zoom). The
 *    stand-in for step 3B's `userZoomed` flag is `lastFit`, the distance THIS rig last wrote. If
 *    the live distance still equals it, nobody else has moved the camera and the fit may ease to a
 *    new target; if it does not, another writer owns the camera and the fit stays out of the way.
 *
 * ## Why the insets are read imperatively
 *
 * Per frame, not per render: a React subscription would re-render this component (and its subtree)
 * on every frame of a panel transition. `getInsets()` returns a stable object that changes only
 * when a number does, so the read costs a property access and no render.
 *
 * ## Why the projection is re-installed on resize
 *
 * `setViewOffset` writes `camera.projectionMatrix` immediately, and R3F recomputes that matrix from
 * `fov`/`aspect`/`near`/`far` whenever the canvas resizes — which throws the offset away. The rig
 * therefore remembers the size it last wrote for and re-applies whenever the size OR the offset
 * changed; the resize case and the layout case share one code path.
 */
import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { MutableRefObject } from 'react';
import {
  D0,
  FRAME_TIME_CONSTANT_S,
  FOV_DEG,
  IS_LOCKED,
  LAST_FIT_EPSILON,
  LOCKED_BRANCH_MARKER,
  MAX_DISTANCE,
  OFFSET_EPSILON_PX,
  PIN_ENVELOPE,
  type FrameProbeSink,
} from '@/layout/framing';
import { computeFrame } from '@/layout/frame';
import { getInsets } from '@/layout/useInsets';

/**
 * The locked branch.
 *
 * A function with an OBSERVABLE side effect rather than a bare `return null`, for one reason: a
 * side effect cannot be tree-shaken away on its own, so this function surviving in a bundle is a
 * fact about emitted code rather than about a comment. In an E2E bundle it runs and sets
 * `window.__frameLocked`; in a production bundle `IS_LOCKED` folds to `false`, the call is
 * unreachable, and `LOCKED_BRANCH_MARKER` appears nowhere in `dist/assets/*.js`.
 */
function noteLocked(): null {
  (window as unknown as Record<string, unknown>).__frameLocked = LOCKED_BRANCH_MARKER;
  return null;
}

/**
 * `prefers-reduced-motion`, resolved once instead of once per frame.
 *
 * `matchMedia` allocates a `MediaQueryList`; calling it inside `useFrame` would be ~60 allocations
 * a second for a value that changes approximately never.
 */
let reducedMotionQuery: MediaQueryList | null | undefined;
function prefersReducedMotion(): boolean {
  if (reducedMotionQuery === undefined) {
    reducedMotionQuery =
      typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  }
  return reducedMotionQuery?.matches ?? false;
}

interface FrameRigProps {
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
  /** Receives the per-frame probe state. Optional so a test can mount a rig without a probe. */
  probe?: MutableRefObject<FrameProbeSink | null>;
}

/**
 * The rig. Renders nothing in either mode; drives `camera.projectionMatrix` and, when allowed, the
 * distance.
 */
export function FrameRig({ controlsRef, probe }: FrameRigProps) {
  /*
   * THE LOCKED BRANCH. No offset, no fit, `camera.view` stays null — byte-identical behaviour to
   * the tree this step started from, which is what `ref.spec.ts` at strict 0 requires.
   */
  if (IS_LOCKED) return noteLocked();
  return <LiveFrameRig controlsRef={controlsRef} probe={probe} />;
}

/**
 * The live half, a separate component so the hooks below are never registered in locked mode.
 *
 * That is the difference between "renders nothing" and "writes nothing": with the logic inline
 * behind an early return, a `useFrame` would still be subscribed (hooks cannot be conditional) and
 * would run every frame only to return immediately. As its own component it is simply not mounted.
 */
function LiveFrameRig({ controlsRef, probe }: FrameRigProps) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);

  /** The eased offset currently installed in the projection matrix, in px. */
  const appliedOffset = useRef({ dx: 0, dy: 0 });
  /** The (w, h) the offset was installed for; a resize invalidates it. */
  const appliedSize = useRef({ w: 0, h: 0 });
  /** The distance this rig last wrote — the `userZoomed` stand-in. See the header. */
  const lastFit = useRef<number | null>(null);
  /** Whether an offset has been applied yet: the first one snaps, later ones ease. */
  const hasApplied = useRef(false);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    const w = size.width;
    const h = size.height;
    const insets = getInsets();

    const frame = computeFrame({
      viewport: { w, h },
      insets,
      fovDeg: FOV_DEG,
      d0: D0,
      dMax: MAX_DISTANCE,
      re: PIN_ENVELOPE,
    });

    /* ------------------------------------------------------------------ offset */

    const reduced = prefersReducedMotion();
    const first = !hasApplied.current;
    const snap = first || reduced || frame.degenerate;

    let nextDx = frame.dx;
    let nextDy = frame.dy;
    if (!snap) {
      /*
       * Frame-rate independent exponential: `1 - exp(-dt / tau)`. `delta` is clamped because a
       * long frame (tab regaining focus, a SwiftShader capture) would otherwise take a very large
       * step and the ease would read as a jump — the same reasoning as `CameraRig.tsx:91`.
       */
      const dt = Math.min(delta, 1 / 30);
      const k = 1 - Math.exp(-dt / FRAME_TIME_CONSTANT_S);
      nextDx = appliedOffset.current.dx + (frame.dx - appliedOffset.current.dx) * k;
      nextDy = appliedOffset.current.dy + (frame.dy - appliedOffset.current.dy) * k;
      // Settle exactly, so "within 0.01 px" is reachable rather than merely asymptotic.
      if (Math.abs(frame.dx - nextDx) < OFFSET_EPSILON_PX) nextDx = frame.dx;
      if (Math.abs(frame.dy - nextDy) < OFFSET_EPSILON_PX) nextDy = frame.dy;
    }

    const moved =
      Math.abs(nextDx - appliedOffset.current.dx) > OFFSET_EPSILON_PX ||
      Math.abs(nextDy - appliedOffset.current.dy) > OFFSET_EPSILON_PX;
    const resized = appliedSize.current.w !== w || appliedSize.current.h !== h;

    if (moved || resized || first) {
      /*
       * `setViewOffset(fullW, fullH, offsetX, offsetY, w, h)`. The sign convention is derived and
       * proved numerically in `src/layout/frame.ts` and `frame.test.ts`: a NEGATIVE offset selects
       * the window left of / above the full frame, which moves the rendered content right / down.
       * Passing `+dx` here would put the globe 2·dx off centre.
       */
      camera.setViewOffset(w, h, -nextDx, -nextDy, w, h);
      appliedOffset.current = { dx: nextDx, dy: nextDy };
      appliedSize.current = { w, h };
      hasApplied.current = true;
    }

    /* ---------------------------------------------------------------- distance */

    const offset = camera.position.clone().sub(controls.target);
    const currentDistance = offset.length();

    /*
     * `lastFit` starts at the LIVE distance, not at `d0`. A page that mounts and then resizes has
     * not been zoomed either, but the value must be the live one: initialising to `d0` would make
     * the first comparison "not moved" while the camera sat somewhere else, and the first fit
     * application would then be a silent jump.
     */
    if (lastFit.current === null) lastFit.current = currentDistance;

    const userHasMoved = Math.abs(currentDistance - lastFit.current) >= LAST_FIT_EPSILON;
    if (!userHasMoved && Math.abs(frame.dTarget - currentDistance) > 1e-6) {
      const dt = Math.min(delta, 1 / 30);
      const k = first || reduced ? 1 : 1 - Math.exp(-dt / FRAME_TIME_CONSTANT_S);
      const wanted = THREE.MathUtils.clamp(
        frame.dTarget,
        controls.minDistance,
        controls.maxDistance,
      );
      const eased = THREE.MathUtils.lerp(currentDistance, wanted, k);
      // Snap the last millionth so a poll for `settled` can actually terminate.
      const nextDistance = Math.abs(wanted - eased) < 1e-5 ? wanted : eased;
      camera.position.copy(controls.target).add(offset.setLength(nextDistance));
      controls.update();
      lastFit.current = nextDistance;
    }

    /* ------------------------------------------------------------------- probe */

    if (probe) {
      const camDistance = camera.position.distanceTo(controls.target);
      const dx = appliedOffset.current.dx;
      const dy = appliedOffset.current.dy;
      const pxError = Math.max(Math.abs(frame.dx - dx), Math.abs(frame.dy - dy));
      probe.current = {
        state: {
          mode: 'live',
          insets: { ...insets },
          free: { ...frame.free },
          target: { dx: frame.dx, dy: frame.dy, d: frame.dTarget },
          current: { dx, dy, d: camDistance },
          settled: pxError < 0.05 && Math.abs(frame.dTarget - camDistance) < 0.0005,
          degenerate: frame.degenerate,
          // `enabled` too: `clearViewOffset()` leaves `view` non-null (three
          // PerspectiveCamera.js:202-212), so a null check alone reports the inverse of the truth.
          cameraViewIsNull: camera.view === null || camera.view.enabled === false,
        },
      };
    }
  });

  return null;
}
