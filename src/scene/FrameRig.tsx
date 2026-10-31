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

  /** The offset currently INSTALLED in the projection matrix, in px. */
  const appliedOffset = useRef({ dx: 0, dy: 0 });
  /**
   * The offset the ease has reached, in px — always at least as far along as `appliedOffset`.
   *
   * Two values rather than one, and the reason is a measured stall. Gating the PROJECTION WRITE on
   * "changed by more than 0.01 px" is right (a sub-hundredth shift is not worth rebuilding a matrix
   * for), but gating the EASE on the same test deadlocks: the remaining error shrinks by ~9 % per
   * frame, so once it drops under `0.01 / 0.09 ≈ 0.11 px` the step becomes smaller than the write
   * threshold, nothing is applied, and the eased value never advances again. Measured before this
   * fix: the offset stalled at `dx 22.3653` against a target of `22.4219` — 0.057 px short, forever,
   * which is outside the 0.05 px settle window and failed every case in `frame.spec.ts` that waits
   * on `settled`.
   *
   * Easing an ideal value that always advances, and letting the projection chase it in 0.01 px
   * steps, keeps the write rule AND converges.
   */
  const easedOffset = useRef({ dx: 0, dy: 0 });
  /** The (w, h) the offset was installed for; a resize invalidates it. */
  const appliedSize = useRef({ w: 0, h: 0 });
  /** The distance this rig last wrote — the `userZoomed` stand-in. See the header. */
  const lastFit = useRef<number | null>(null);
  /** Whether an offset has been applied yet: the first one snaps, later ones ease. */
  const hasApplied = useRef(false);
  /**
   * Does the rig currently own the distance, i.e. has nothing else moved the camera?
   *
   * Published so the probe can describe the distance honestly: while the rig drives it, "settled"
   * means the ease has ARRIVED at `dTarget`; while another writer owns it (a region fly-to, the
   * user's wheel), the rig is not animating the distance at all and "settled" must not demand that
   * the camera reach a target it is deliberately not pursuing. Without this flag the probe could
   * never report settled on any page with an open region drawer — which is precisely the case F8
   * exists to measure.
   */
  const rigOwnsDistance = useRef(true);
  /**
   * The last few distances, so "settled" can mean "not moving" without declaring stillness on a
   * single quiet frame.
   *
   * A ring rather than one previous value: a fly-to damps ASYMPTOTICALLY (0.0006^dt per frame), so
   * consecutive-frame deltas fall under any threshold long before the motion has visually stopped.
   * Measured on an open drawer with the fly-to in flight: the distance sat at 2.596 for four polls
   * 200 ms apart while still creeping, and a one-sample test called it settled and let a spec read a
   * value 0.0004 away from the one it settled at.
   */
  const recentDistances = useRef<number[]>([]);

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
       *
       * Eased from `easedOffset`, NOT from `appliedOffset`: see the comment on those two refs for
       * the stall that caused.
       */
      const dt = Math.min(delta, 1 / 30);
      const k = 1 - Math.exp(-dt / FRAME_TIME_CONSTANT_S);
      nextDx = easedOffset.current.dx + (frame.dx - easedOffset.current.dx) * k;
      nextDy = easedOffset.current.dy + (frame.dy - easedOffset.current.dy) * k;
      // Land exactly, so the dead zone below has a fixed point and the tail is not asymptotic.
      if (Math.abs(frame.dx - nextDx) < OFFSET_EPSILON_PX) nextDx = frame.dx;
      if (Math.abs(frame.dy - nextDy) < OFFSET_EPSILON_PX) nextDy = frame.dy;
    }
    easedOffset.current = { dx: nextDx, dy: nextDy };

    /*
     * The write rule, exactly as specified: touch the projection only when the value moved by more
     * than 0.01 px. `easedOffset` genuinely reaches the target, so this converges instead of
     * stalling — the projection trails the ease by up to one epsilon and then catches it.
     */
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
    rigOwnsDistance.current = !userHasMoved;
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
      /*
       * Report the EASED value, not the installed one. The installed projection trails the ease by
       * up to 0.01 px by design, so reporting it would make `settled` unreachable for any target
       * that is not an exact multiple of the write threshold — the same stall the two refs exist to
       * avoid, one layer up.
       */
      const dx = easedOffset.current.dx;
      const dy = easedOffset.current.dy;
      const pxError = Math.max(Math.abs(frame.dx - dx), Math.abs(frame.dy - dy));
      /*
       * "Settled" = the frame has stopped changing, in BOTH channels that the rig can move.
       *
       *   offset    — within 0.05 px of target, always required;
       *   distance  — if the rig owns it, within 0.0005 of target; if another writer owns it, merely
       *               not moving (|current - previous| < 2e-4).
       *
       * The second branch is what makes an open region drawer measurable at all: the fly-to parks
       * the camera at ~2.6 and the fit's target for the narrowed free rect is 5.0, so a rule of
       * "must reach the target" is unsatisfiable forever and every wait on `settled` times out.
       * Measured before this fix: F8 at 1440x900 and 1280x720 both timed out after 5 s with the
       * offset already correct to 0.03 px.
       */
      const recent = recentDistances.current;
      recent.push(camDistance);
      if (recent.length > 4) recent.shift();
      /*
       * Still = the last four frames span less than 2e-4. The SPAN, not the frame-to-frame delta:
       * a slow constant drift has a tiny per-frame delta and a large span, which is exactly the
       * signature of a damped fly-to in its tail.
       */
      /*
       * A fold, not `Math.max(...recent)`: `tests/e2e/source-guards.test.ts` forbids spreading into
       * Math.min/max anywhere in `src/` (a 1M-point array blows the stack), and the guard is right
       * to apply here even though this array is capped at four.
       */
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of recent) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      const spread = recent.length < 4 ? Infinity : hi - lo;
      const distanceQuiet = spread < 2e-4;
      const distanceArrived = Math.abs(frame.dTarget - camDistance) < 0.0005;
      const distanceSettled = rigOwnsDistance.current ? distanceArrived && distanceQuiet : distanceQuiet;
      probe.current = {
        state: {
          mode: 'live',
          insets: { ...insets },
          free: { ...frame.free },
          target: { dx: frame.dx, dy: frame.dy, d: frame.dTarget },
          current: { dx, dy, d: camDistance },
          settled: pxError < 0.05 && distanceSettled,
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
