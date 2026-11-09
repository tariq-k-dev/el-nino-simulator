/**
 * The sole module responsible for camera positioning and movement.
 *
 * Handles:
 * - Orbit controls damping and constraints
 * - Viewport framing calculations
 * - Focus transitions between regions
 * - Mobile viewport adaptations
 * - Reset behavior coordination
 *
 * Maintains synchronization between:
 * - Three.js camera/controls
 * - React state
 * - Viewport insets
 * - Layout modes
 *
 * ## What this replaces, and what it must not change
 *
 * Before 3B there were six camera writers (`docs/STEP3B-DESIGN.md` §2). Two of them were React
 * components with their own `useFrame` (`CameraRig`, `FrameRig`), and the rest were configuration
 * (the Canvas prop, the OrbitControls bounds) or the E2E hook (`__globe.setCamera` /
 * `__look.setAzimuth`). This file absorbs the two components and the hook, and keeps the other two as
 * the allowlist's declared exceptions.
 *
 * The step is BEHAVIOR-PRESERVING, so the merge is deliberately not a rewrite. The old code ran two
 * `useFrame` callbacks in mount order on every frame:
 *
 *     1. `CameraRig`  — damp `controls.target`, ease the distance-from-target, `controls.update()`
 *     2. `FrameRig`   — install the view offset, then (if the fit owns the distance) ease that and
 *                       `controls.update()` again
 *
 * This file runs exactly those two bodies, in exactly that order, inside ONE `useFrame`. The ordering
 * is load-bearing: the fit must read the camera AFTER the fly-to has moved it, and a frame that ran
 * them the other way would compute `currentDistance` from a stale pose.
 *
 * ## Why one `useFrame` and one priority
 *
 * Two writers on the same frame cannot be reasoned about: whichever ran second won, and which one that
 * was depended on React's mount order. One callback makes the sequence a fact in the source rather
 * than a consequence of the tree, and it is what lets `userZoomed` be a single piece of state instead
 * of two flags that could disagree.
 *
 * ## `userZoomed`, and why a fly-to sets it too
 *
 * The prompt defines the flag from OrbitControls events: a `start`, or a `change` raised outside this
 * module's own writes, with a distance change above 0.002. That is the USER half, and it is
 * implemented verbatim below.
 *
 * But `userZoomed` is the replacement for `FrameRig`'s `lastFit` rule, and `lastFit` was invalidated
 * by ANY distance writer, not only the user:
 *
 *     const userHasMoved = Math.abs(currentDistance - lastFit.current) >= LAST_FIT_EPSILON;
 *
 * A fly-to moved the distance, so `lastFit` went stale and the fit never re-took the distance again —
 * which is exactly what `docs/STEP3B-DESIGN.md` §3 measured after a close (d ≈ 3.35, not the fit's
 * 3.7784). If this file set `userZoomed` only from user input, then after a region was closed the fit
 * WOULD re-take the distance and ease 3.3534 → 3.7784, which is a visible zoom-out that does not
 * happen today. So the flag also latches when a non-fit writer (the fly-to, `setPose`) changes the
 * distance by more than the epsilon.
 *
 * Read strictly, `userZoomed` therefore means **"the fit must not write the distance"**. That is
 * precisely what `lastFit` meant, generalised to one boolean, and it is stated here and in the
 * `STEP3B-DESIGN.md` "as built" section rather than left for a reader to infer.
 *
 * It gates the DISTANCE ONLY. The view offset is layout (`FrameRig.tsx:19-22`) and always follows the
 * insets — a wheel event must never un-centre the globe.
 *
 * ## Step 3B2 reverses that latch in LIVE mode (deviation 2 of 3B is reversed)
 *
 * The paragraph above describes step 3B, when the live fly-to damped the DISTANCE to the pin's own
 * `zoom`. The live fly-to no longer writes the distance at all: it orbits the camera to face the pin
 * and leaves the orbit radius alone. So nothing but the user can invalidate the fit in live mode, and
 * `userZoomed` is set ONLY by OrbitControls input (`start`/`change`, a distance change > 0.002 outside
 * this module's own writes). No `USER_ZOOM` is dispatched from `setPose` and none from the fly-to.
 *
 * The latch is KEPT, verbatim, inside the LOCKED branch below, because the legacy aim-at-pin fly-to
 * still moves the distance and `globe.spec.ts`'s "zoom still works after a region fly-to" depends on
 * the same `lastFit` behaviour. That is why the two policies are separate bodies rather than one body
 * with a mode flag: the locked one has to keep arithmetic and side effects this step must not touch.
 *
 * ## The two policies
 *
 * | mode | fly-to writes | on arrival |
 * |---|---|---|
 * | `locked` (E2E build, no `framing=live`) | `controls.target` → the pin, distance → the pin's `zoom` | pose within 0.004 R in both |
 * | `live` (production, and `?framing=live`) | the DIRECTION only: camera orbits to the pin's normal side, `controls.target` stays the origin, the radius is untouched | angular error < 0.004 rad, then the exact direction is written |
 *
 * The live arrival SNAPS the last 0.004 rad onto the target direction instead of leaving it there.
 * Without the snap the machine would stop animating with the camera up to 0.229 deg (about 4.7 px at
 * 1440x900) short of the pin, and the acceptance oracle — "the projected pin core is within 0.75 px of
 * the free-rect centre" — would measure that residual as a defect. The snap is the same device the fit
 * already uses for the distance (`|wanted - eased| < 1e-5` -> `wanted`).
 */
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import type { RegionId } from "@/types/enso";
import { NINO_BOXES, REGION_MAP, latLonToVector3 } from "@/lib/regions";
import {
    boxCentreLon360,
    freeRectFraction,
    ninoFlyToDistance,
} from "@/lib/ninoFraming";
import { GLOBE_LOOK } from "@/scene/globeLook";
import { PIN_HIT_GATE } from "@/scene/pinVisibilityBands";
import {
    ARRIVE_EPSILON_R,
    FLY_DISTANCE_EASE_BASE,
    FLY_TARGET_EASE_BASE,
    easeFactor,
} from "@/camera/easing";
import { arcStep, facingPose, isArrived, type Vec3 } from "@/camera/facing";
import {
    getLayoutSignal,
    getResetRequest,
    getViewState,
    publishViewState,
    startLayoutObserver,
    subscribeResetRequest,
} from "@/scene/viewStore";
import type { SpinState } from "@/scene/EarthSystem";
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
} from "@/layout/framing";
import { computeFrame } from "@/layout/frame";
import { getInsets } from "@/layout/useInsets";
import {
    initialFocus,
    isTravelling,
    step as stepFocus,
    type FocusEvent,
    type FocusSnapshot,
    type FocusState,
} from "@/scene/focusMachine";
import { registerCameraIntents, type CameraPose } from "@/scene/cameraIntents";
import {
    asMobileFrame,
    computeMobileFit,
    type MobileFrame,
} from "@/mobile/mobileFrame";
import type { LayoutMode2 } from "@/mobile/layoutMath";

/** The shipped start position; the same constants the `<Canvas camera>` prop uses. */
const DEFAULT_POSITION = new THREE.Vector3(0, 1.15, 3.15);
const DEFAULT_TARGET = new THREE.Vector3(0, 0, 0);

/** World-space direction of a lat/lon after the earth group's Y rotation. */
/**
 * The earth group's spin axis.
 *
 * Module scope and shared with the Niño box aim below, because the two must rotate about exactly the
 * same axis: the box outline is a child of that group, and `EarthSystem.tsx:84` assigns only
 * `rotation.y`, so Y is the whole of the group's transform. One constant also stops the region path
 * allocating a `Vector3` per call, which it did before this (a fresh `new THREE.Vector3(0, 1, 0)` for
 * every fly-to).
 */
const SPIN_AXIS_Y = new THREE.Vector3(0, 1, 0);

function regionDirection(id: RegionId, spinY: number): THREE.Vector3 {
    const region = REGION_MAP[id];
    const [x, y, z] = latLonToVector3(region.lat, region.lon, 1);
    return new THREE.Vector3(x, y, z).applyAxisAngle(SPIN_AXIS_Y, spinY);
}

/**
 * The WORLD position of a pin's visible HEAD, spun by the earth group's current rotation.
 *
 * The same point `Hotspot.tsx` draws its core at and `__globe.pins()` reports: the anchor radius
 * lifted by `idleLift`, then offset along the normal by `coreOffset`. Derived from `regionDirection`
 * rather than re-deriving the lat/lon, so the spin is applied in exactly one place — the reason
 * `regionDirection` exists at all.
 *
 * Used only by the screen-space fallback below, which needs the point the user SEES rather than the
 * surface anchor the raycast proxy is centred on.
 */
function regionHeadPosition(regionId: RegionId, spinY: number): THREE.Vector3 {
    const r =
        GLOBE_LOOK.pins.anchorRadius * GLOBE_LOOK.pins.idleLift +
        GLOBE_LOOK.pins.coreOffset;
    return regionDirection(regionId, spinY).multiplyScalar(r);
}

/**
 * Resolve a Niño box into a flight target: a WORLD-space aim direction and a fitted distance.
 *
 * Extracted in NINO-HARDEN B7 so the two places that need it cannot disagree:
 *
 *   - the button press (`focusNinoBox`);
 *   - the layout/viewport change that arrives while a box is still selected (B7's re-flight).
 *
 * Before the extraction the resolution lived inline in `focusNinoBox`, so the resize path had no way
 * to re-derive the distance for the NEW free rect and the rig's own fit took the radius instead
 * (A4 measured the box flight at 2.44644 jumping to 5.39548 on a 1280x720 -> 390x844 resize, and
 * 5.39548 is exactly `dFit`, not the box's distance).
 *
 * `freePx` lets the caller pass the free rect's SIZE the frame rig JUST computed, in viewport pixels,
 * rather than re-reading `getInsets()`. On the frame a mode change is first observed that matters: the
 * registry may still be publishing the previous mode's rect, and the rig's own `frame.free` is by
 * definition the rect this frame's offset came from. Omitted (the press path), it reads `getInsets()`
 * as before, so press-time behaviour is unchanged.
 *
 * Only `widthFrac`/`heightFrac` reach the fit (`FreeRectFrac`, `ninoFraming.ts:178`) — the rect's
 * POSITION is not a fit input, because the frame rig is what parks the aimed point at the free rect's
 * centre. So only `w`/`h` are needed here, not `x`/`y`.
 *
 * `spinY` is the earth group's Y rotation. The spin is paused while a box is selected (B4), so this
 * angle is stable for the life of the selection and the outline does not turn away from the camera.
 */
function ninoFlightTarget(
    box: (typeof NINO_BOXES)[number],
    camera: THREE.PerspectiveCamera,
    spinY: number,
    freePx?: { w: number; h: number },
    viewport?: { w: number; h: number },
): { direction: THREE.Vector3; distance: number } {
    const aspect = camera.aspect > 0 ? camera.aspect : 16 / 9;
    const freeRect =
        freePx && viewport && viewport.w > 0 && viewport.h > 0
            ? {
                  widthFrac: freePx.w / viewport.w,
                  heightFrac: freePx.h / viewport.h,
              }
            : freeRectFraction(
                  getInsets().free,
                  window.innerWidth || 0,
                  window.innerHeight || 0,
              );
    const distance = ninoFlyToDistance(box, {
        fovDeg: camera.fov,
        aspect,
        freeRect,
    });
    const [x, y, z] = latLonToVector3(
        box.anchorLat,
        boxCentreLon360(box),
        GLOBE_LOOK.pins.anchorRadius,
    );
    return {
        direction: new THREE.Vector3(x, y, z).applyAxisAngle(
            SPIN_AXIS_Y,
            spinY,
        ),
        distance,
    };
}

/**
 * Re-resolve a Niño flight when the FREE RECT it was framed for has changed.
 *
 * NINO-HARDEN-ADDENDUM (3) + B7. One mechanism serves two symptoms that turned out to be the same
 * defect: the box's distance is resolved ONCE, from whatever free rect exists at that moment, and
 * nothing revisits it when the rect moves.
 *
 *   - A2d (addendum 3). Region Pacific focused, then Niño 1+2 pressed while the region drawer is still
 *     open. The instrument added to `focusNinoBox` caught the press-time rect at
 *     `{x 360.84, w 501.16}` -> `widthFrac 0.39153` -> distance 1.45330. By settle the drawer had
 *     closed and the rect was `{x 360.84, w 603.16}` -> `widthFrac 0.47120` -> 1.39460. Measured settle
 *     1.45649, i.e. the flight landed exactly where it was told, for a rect that no longer existed.
 *     The distance was not wrong: it was STALE.
 *   - B7 (desktop). A mode or viewport change while a box is selected. The mobile branch had a re-fit
 *     gated on `reFit`; the desktop branch had none at all, so a desktop resize left the box at
 *     whatever distance the previous viewport wanted (A4: 2.44644 -> 5.39548 = `dFit`).
 *
 * Keying on the RECT rather than on "a layout change happened" is what makes both cases one code path:
 * the drawer closing is not a layout-mode change, and a mode change is just a very large rect change.
 *
 * The addendum's rule that a cancel must NOT block this is satisfied by keying on the SELECTION
 * (`activeNinoBoxId`), which survives a user drag or wheel; gating on `ninoFlight` would have made a
 * cancelled flight immune.
 *
 * Re-arming `ninoFlight` rather than writing the distance directly means the direction is re-derived
 * too and the same tween carries the camera, instead of the camera teleporting.
 *
 * Returns `true` when this frame re-armed the flight, so the caller's distance channel knows to stand
 * down and not fight the tween for the radius.
 */
function refitNinoForRect(args: {
    activeNinoBoxId: MutableRefObject<string | null>;
    ninoFlight: MutableRefObject<{
        direction: THREE.Vector3;
        distance: number;
    } | null>;
    ninoRect: MutableRefObject<{ wf: number; hf: number } | null>;
    camera: THREE.PerspectiveCamera;
    spinY: number;
    free: { x: number; y: number; w: number; h: number };
    viewport: { w: number; h: number };
}): boolean {
    const {
        activeNinoBoxId,
        ninoFlight,
        ninoRect,
        camera,
        spinY,
        free,
        viewport,
    } = args;
    const boxId = activeNinoBoxId.current;
    if (!boxId) return false;
    const box = NINO_BOXES.find((b) => b.id === boxId);
    if (!box) return false;
    if (viewport.w <= 0 || viewport.h <= 0) return false;

    const wf = free.w / viewport.w;
    const hf = free.h / viewport.h;
    const was = ninoRect.current;
    /*
     * A pixel-scale epsilon, not an exact compare: the rect is recomputed from layout numbers every frame
     * and float noise would otherwise re-arm the flight continuously. 1e-4 of the viewport is 0.13 px at
     * 1280 wide — far below anything that changes the fit (the A2d difference is 0.0797).
     */
    const changed =
        !was || Math.abs(was.wf - wf) > 1e-4 || Math.abs(was.hf - hf) > 1e-4;
    if (!changed) return false;

    ninoRect.current = { wf, hf };
    ninoFlight.current = ninoFlightTarget(box, camera, spinY, free, viewport);
    return true;
}

/**
 * The locked branch. Unchanged in purpose from `FrameRig.tsx:73-76`: a function with an OBSERVABLE side
 * effect, so that its survival in a bundle is a fact about emitted code rather than about a comment.
 */
function noteLocked(): void {
    (window as unknown as Record<string, unknown>).__frameLocked =
        LOCKED_BRANCH_MARKER;
}

/**
 * The locked FLY-TO's own marker — a string that exists only in the aim-at-pin branch.
 *
 * Distinct from `LOCKED_BRANCH_MARKER` (`'frame-locked-branch-7f3a'`) because they certify different
 * things: that one says the whole locked FRAMING survives, this one says the legacy aim-at-pin
 * arithmetic does. Both are called from inside `if (IS_LOCKED)` blocks, which `import.meta.env` folds to
 * `false` in production, so `scripts/check-assets.mjs` can prove from the bundle that neither ships.
 *
 * Placement note: this is called from the travelling half of the locked policy, so a locked page that
 * never starts a fly-to does not set it at runtime. The proof is about EMITTED CODE (`grep` on
 * `dist-e2e/assets/*.js`), which does not depend on it ever running.
 */
const FOCUS_POLICY_LOCKED_MARKER = "focus-policy-locked-3b2-a41";

function noteLockedPolicy(): void {
    (window as unknown as Record<string, unknown>).__frameLockedPolicy =
        FOCUS_POLICY_LOCKED_MARKER;
}

/** The default camera DIRECTION (unit), derived from the shipped position rather than retyped. */
const DEFAULT_DIRECTION: THREE.Vector3 = DEFAULT_POSITION.clone().normalize();

/*
 * Scratch vectors: `useFrame` runs 60 times a second and this module already allocates a `Vector3` per
 * frame for the offset. The policy code below must not add another per frame, so it works in place.
 */
const SCRATCH_OFFSET = new THREE.Vector3();
const SCRATCH_DIR = new THREE.Vector3();
/** Scratch for the screen-space fallback's normal. Pointer handlers are not re-entrant with the frame. */
const SCRATCH_HIT = new THREE.Vector3();

/** `viewIsDefault` tolerances: direction within 0.5 deg of the default, distance within 0.002. */
const VIEW_DEFAULT_ANGLE_DEG = 0.5;
const VIEW_DEFAULT_DISTANCE = 0.002;

/** Pointer travel (CSS px) after pointerdown before a box flight counts as user-dragged and is cancelled. */
const BOX_CANCEL_DRAG_PX = 6;

/**
 * True when a press that began at `downAt` ended as a CLICK/TAP rather than a drag.
 *
 * The same `BOX_CANCEL_DRAG_PX` threshold the drag-cancel uses, so "a drag" means exactly one thing in
 * this file: a press that travels further than this cancels the flight, and a press that does not is a
 * decision the pointerup is allowed to commit.
 *
 * `downAt` is CANVAS-relative (`onPointerDownCapture` subtracts the canvas rect's origin), while
 * `e.clientX`/`e.clientY` are VIEWPORT coordinates. The event is converted into the same space before
 * the comparison, or a canvas that does not start at (0, 0) — a header above it, a sidebar beside it —
 * would measure the press against the wrong origin and read a click as a drag.
 */
function isClick(
    downAt: { x: number; y: number } | null,
    e: PointerEvent,
    dom?: HTMLElement,
): boolean {
    if (downAt === null) return false;
    const rect = dom ? dom.getBoundingClientRect() : { left: 0, top: 0 };
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top;
    return Math.hypot(curX - downAt.x, curY - downAt.y) <= BOX_CANCEL_DRAG_PX;
}

/**
 * Radius (CSS px) of the screen-space fallback that recovers a pin press the raycast missed.
 *
 * Deliberately wider than the proxy's own 18 px (28 px coarse) radius: this is a RECOVERY path for a
 * press the ray already failed to resolve, so it should be forgiving rather than exact. It is not
 * consulted on the ordinary path, so it cannot widen the real hit target.
 */
const SCREEN_HIT_FALLBACK_PX = 50;

/**
 * The same fallback's radius while a FLIGHT is running (G3(a)).
 *
 * `Hotspot.tsx` measures 74.6 px of pin drift between pointerdown and pointerup during a fly-to, so the
 * 50 px recovery radius above is not enough to catch a press the ray lost mid-tween: the press falls
 * through to the cancel path, the camera freezes mid-flight and the box stays selected — "cancels
 * without deciding". 100 px covers the measured drift with margin.
 *
 * Only the box-flight press path uses this. The region-flight path keeps `SCREEN_HIT_FALLBACK_PX`, so
 * the radius the existing specs were written against does not move.
 */
const SCREEN_HIT_FALLBACK_FLIGHT_PX = 100;

/** The refs and helpers either policy needs. Passed explicitly so both policies stay module-level. */
interface PolicyContext {
    camera: THREE.PerspectiveCamera;
    controls: OrbitControlsImpl;
    stepDt: number;
    state: FocusState;
    spin: MutableRefObject<SpinState>;
    targetRegion: MutableRefObject<RegionId | null>;
    desiredTarget: MutableRefObject<THREE.Vector3>;
    desiredDistance: MutableRefObject<number>;
    lastFit: MutableRefObject<number | null>;
    /**
     * The Niño box flight target (step 2.3c-1, C2). `null` when no box flight is in progress.
     *
     * Kept separate from `targetRegion` because a box is not a `RegionId`: it has no drawer, no
     * metrics row and no accent, and reusing the region channel would make the region drawer think a
     * box was selected. The aim point and distance are resolved once, when the flight starts, so a
     * mid-flight aspect change cannot retarget an in-progress tween.
     */
    ninoFlight: MutableRefObject<{
        direction: THREE.Vector3;
        distance: number;
    } | null>;
    withOwnWrite: (fn: () => void) => void;
    dispatch: (event: FocusEvent) => void;
}

/**
 * The LOCKED focus policy — the legacy aim-at-pin fly-to, moved here from the frame body.
 *
 * The arithmetic is unchanged: same two eases (now read from `camera/easing.ts`, same values), same
 * `withOwnWrite` guard, same `lastFit` latch that dispatches `USER_ZOOM` when a non-fit writer moved the
 * distance, same 0.004 convergence in target distance AND distance error. This is what makes S3 a real
 * check rather than a restatement: the locked golden entries were captured against this code.
 *
 * Only reachable when `IS_LOCKED`, which folds to `false` in a production build, so the whole function
 * — and `FOCUS_POLICY_LOCKED_MARKER` with it — is removed from the shipped bundle.
 */
function runLockedFlyTo(ctx: PolicyContext): void {
    noteLockedPolicy();

    const {
        camera,
        controls,
        stepDt,
        state,
        spin,
        targetRegion,
        withOwnWrite,
        dispatch,
    } = ctx;

    const region = targetRegion.current;
    if (region) {
        const want = REGION_MAP[region];
        ctx.desiredTarget.current.copy(regionDirection(region, spin.current.y));
        ctx.desiredDistance.current = want.zoom;
    } else {
        ctx.desiredTarget.current.copy(DEFAULT_TARGET);
        ctx.desiredDistance.current = DEFAULT_POSITION.length();
    }

    const targetEase = easeFactor(FLY_TARGET_EASE_BASE, stepDt);
    const distanceEase = easeFactor(FLY_DISTANCE_EASE_BASE, stepDt);
    const wanted = ctx.desiredDistance.current;

    withOwnWrite(() => {
        /* Damp the orbit target. */
        controls.target.lerp(ctx.desiredTarget.current, targetEase);

        /*
         * Ease distance-from-target while preserving the viewing direction, clamped into the controls' own
         * limits so a fly-to can never park the camera outside the range the user may then zoom within.
         */
        const offset = camera.position.clone().sub(controls.target);
        const currentDistance = offset.length();
        if (currentDistance > 1e-6) {
            const clamped = THREE.MathUtils.clamp(
                wanted,
                controls.minDistance,
                controls.maxDistance,
            );
            const nextDistance = THREE.MathUtils.lerp(
                currentDistance,
                clamped,
                distanceEase,
            );
            camera.position
                .copy(controls.target)
                .add(offset.setLength(nextDistance));
        }

        /* update() derives the quaternion from target+offset and clamps the polar angle. */
        controls.update();
    });

    /* A fly-to IS a distance writer that is not the fit — see the header. */
    if (ctx.lastFit.current !== null) {
        const d = camera.position.distanceTo(controls.target);
        if (Math.abs(d - ctx.lastFit.current) > LAST_FIT_EPSILON)
            dispatch({ type: "USER_ZOOM" });
    }

    const targetSettled =
        controls.target.distanceTo(ctx.desiredTarget.current) <
        ARRIVE_EPSILON_R;
    const distanceSettled =
        Math.abs(camera.position.distanceTo(controls.target) - wanted) <
        ARRIVE_EPSILON_R;
    if (targetSettled && distanceSettled) {
        dispatch(
            state === "returning" ? { type: "RETURNED" } : { type: "ARRIVED" },
        );
    }
}

/**
 * The NIÑO BOX fly-to (step 2.3c-1, C2.3) — the existing tween, aimed at a box instead of a region.
 *
 * Reuses exactly the live policy's machinery: `arcStep` for the great-circle tween and `isArrived`
 * for the same convergence epsilon. What is different is where the destination comes from —
 * `ninoFlight`, resolved once at button-press time from `ninoFraming` — and that the distance is
 * eased toward the box's fitted distance rather than held constant.
 *
 * ## The dateline, and why nothing here interpolates longitude
 *
 * A flight cannot take the wrong way round the globe, structurally: `arcStep` interpolates between
 * two UNIT VECTORS on the shortest great circle, with the step size proportional to `acos(from·to)`,
 * which is by definition ≤ 180°. The 3D direction for lon 185 (Niño 4's centre) and for lon -150
 * (the pacific pin) are 25° apart, so the tween covers 25° — there is no scalar longitude anywhere
 * for a `+335°` long-way bug to live in. `ninoFraming.shortestLonDelta` exists to make that claim
 * TESTABLE at the longitude level (and is used by the tests for the two flights the step names);
 * the flight itself is correct by construction rather than by getting the sign right.
 *
 * ## Distance
 *
 * Eased with the same `FLY_DISTANCE_EASE_BASE` the locked policy uses and clamped into the controls'
 * own range, so a fly-to can never park the camera outside `[minDistance, maxDistance]` and the
 * pinch/wheel that follows stays in range by construction. minDistance is NOT touched here.
 */
function runNinoFlyTo(ctx: PolicyContext): void {
    const { camera, controls, stepDt, ninoFlight, withOwnWrite, dispatch } =
        ctx;

    const flight = ninoFlight.current;
    if (!flight) {
        /* No target: hand the camera back rather than tweening toward nothing. */
        withOwnWrite(() => controls.update());
        return;
    }

    const wanted = facingPose({
        pinDir: [flight.direction.x, flight.direction.y, flight.direction.z],
        distance: flight.distance,
        polarMin: controls.minPolarAngle,
        polarMax: controls.maxPolarAngle,
    }).direction;

    const from = orbitDirection(camera, controls);
    const arrived = isArrived(from, wanted);
    const next = arrived ? wanted : arcStep({ from, to: wanted, dtS: stepDt });

    /* Ease the radius toward the fitted distance while the direction tweens, clamped by the controls. */
    const currentDistance = orbitDistance(camera, controls);
    const distanceEase = easeFactor(FLY_DISTANCE_EASE_BASE, stepDt);
    const clampedWanted = THREE.MathUtils.clamp(
        flight.distance,
        controls.minDistance,
        controls.maxDistance,
    );
    const nextDistance = THREE.MathUtils.lerp(
        currentDistance,
        clampedWanted,
        distanceEase,
    );

    withOwnWrite(() => {
        camera.position
            .copy(controls.target)
            .add(
                SCRATCH_DIR.set(next[0], next[1], next[2]).multiplyScalar(
                    nextDistance,
                ),
            );
        controls.update();
    });

    /*
     * A box flight IS a distance writer that is not the fit, exactly like the locked fly-to above.
     *
     * Without this latch the frame rig's distance channel still owns the radius and eases it back to the
     * fit on the very next frame, so the flight's radius is overwritten mid-tween and the camera lands at
     * `frame.dTarget` instead of the box's fitted distance. The measured symptom is a "settled" distance
     * that is neither the requested value nor inside `[minDistance, maxDistance]` in a way the controls
     * would allow — 5.813 against a ceiling of 5 at 390x844 portrait.
     *
     * `withOwnWrite` suppresses the controls' own `change` listener while this module writes, so the
     * latch has to be dispatched here rather than relying on the listener to notice.
     */
    if (ctx.lastFit.current !== null) {
        const d = camera.position.distanceTo(controls.target);
        if (Math.abs(d - ctx.lastFit.current) > LAST_FIT_EPSILON)
            dispatch({ type: "USER_ZOOM" });
    }

    /*
     * Clear the flight on arrival. The selection itself (`activeBoxId`) lives in React state and the
     * outline highlight is driven from there, so this only stops the tween; the camera then falls back
     * to the "not travelling" branch where the controls own it.
     */
    if (arrived && Math.abs(nextDistance - clampedWanted) < ARRIVE_EPSILON_R) {
        ninoFlight.current = null;
        ctx.dispatch({ type: "ARRIVED" });
    }
}

/** The camera's unit direction from the orbit target. Zero-safe: never returns a zero vector. */
function orbitDirection(
    camera: THREE.PerspectiveCamera,
    controls: OrbitControlsImpl,
): Vec3 {
    const v = SCRATCH_OFFSET.copy(camera.position).sub(controls.target);
    if (v.lengthSq() < 1e-18)
        return [DEFAULT_DIRECTION.x, DEFAULT_DIRECTION.y, DEFAULT_DIRECTION.z];
    v.normalize();
    return [v.x, v.y, v.z];
}

/** The distance from the orbit target. */
function orbitDistance(
    camera: THREE.PerspectiveCamera,
    controls: OrbitControlsImpl,
): number {
    return camera.position.distanceTo(controls.target);
}

/**
 * The LIVE focus policy — orbit the camera to FACE the pin, at a distance it does not touch.
 *
 * Three properties, all structural rather than asserted:
 *
 *   - `controls.target` is never written, so it stays at the origin and the globe stays centred on the
 *     free rect (the whole point of replacing aim-at-pin, which overflowed it by up to +462 px).
 *   - the radius is read once and re-applied, so the distance is constant through the arc and cannot
 *     dip toward the globe (AM2/S8). Any change to it comes from the fit's own channel, not from here.
 *   - the aim is a great-circle arc from the camera's CURRENT direction, so a retarget continues from
 *     where the camera is instead of jumping back to the flight's start.
 */
function runLiveFlyTo(ctx: PolicyContext): void {
    const {
        camera,
        controls,
        stepDt,
        state,
        spin,
        targetRegion,
        withOwnWrite,
        dispatch,
    } = ctx;

    /*
     * Where the camera must point. `facingPose` owns the polar clamp, so the director never compares
     * angles itself; the limits are read off the controls rather than restated (they are the OrbitControls
     * defaults today, but a pin near a pole must not silently mis-frame if that ever changes).
     */
    let wanted: Vec3;
    if (state === "returning") {
        wanted = [
            DEFAULT_DIRECTION.x,
            DEFAULT_DIRECTION.y,
            DEFAULT_DIRECTION.z,
        ];
    } else {
        const region = targetRegion.current;
        if (region === null) {
            /* `focusing` with no region is unreachable (the machine names one); fall back to the default. */
            wanted = [
                DEFAULT_DIRECTION.x,
                DEFAULT_DIRECTION.y,
                DEFAULT_DIRECTION.z,
            ];
        } else {
            const pin = regionDirection(region, spin.current.y);
            wanted = facingPose({
                pinDir: [pin.x, pin.y, pin.z],
                distance: orbitDistance(camera, controls),
                polarMin: controls.minPolarAngle,
                polarMax: controls.maxPolarAngle,
            }).direction;
        }
    }

    const from = orbitDirection(camera, controls);
    const arrived = isArrived(from, wanted);
    const next = arrived ? wanted : arcStep({ from, to: wanted, dtS: stepDt });

    /*
     * The RADIUS is captured before the write and re-applied after it. `controls.update()` is allowed to
     * clamp the polar angle, which changes the direction but must not change the distance.
     */
    const radius = orbitDistance(camera, controls);

    withOwnWrite(() => {
        camera.position
            .copy(controls.target)
            .add(
                SCRATCH_DIR.set(next[0], next[1], next[2]).multiplyScalar(
                    radius,
                ),
            );
        controls.update();
    });

    if (arrived)
        dispatch(
            state === "returning" ? { type: "RETURNED" } : { type: "ARRIVED" },
        );
}

/** Angular error between two directions, degrees — for `viewIsDefault`. */
function angleDegBetween(a: Vec3, b: THREE.Vector3): number {
    const d = a[0] * b.x + a[1] * b.y + a[2] * b.z;
    const clamped = d > 1 ? 1 : d < -1 ? -1 : d;
    return (Math.acos(clamped) * 180) / Math.PI;
}

/**
 * The MOBILE view-offset applier — idempotent, keyed on `(mode, W, H)`.
 *
 * ## The sign, as measured
 *
 * `.cache/mob/probe-offset.mjs` builds a real `PerspectiveCamera(42, 390/844, 0.1, 400)` at the shipped
 * position, sets the offset, and projects the world origin:
 *
 *     no offset                  y = 422.000   (error 189.900 from the wanted 232.100)
 *     setViewOffset(…, -189.90)  y = 611.900   (error 379.800 — wrong direction, and by 2x)
 *     setViewOffset(…, +189.90)  y = 232.100   (error 0.000)   <- this one
 *     clearViewOffset            y = 422.000
 *
 * So a POSITIVE `offsetY` moves the projected content UP. `mobileFrame.ts` returns `viewOffsetY`; this
 * function applies it with that sign, and the assertion in `mobileFrame.test.ts` re-derives it from a real
 * camera on every gate run rather than trusting this comment.
 *
 * ## Why the sub-window is the FULL size
 *
 * `setViewOffset(W, H, 0, dy, W, H)`: the sub-window keeps the full width and height, so three's
 * `updateProjectionMatrix` shifts the principal point without rescaling the frustum. A smaller sub-window
 * would also change the zoom, which would make the fit's `d_fit` wrong by the ratio of the two heights.
 *
 * ## Why it is re-applied on every resize
 *
 * R3F rewrites `camera.aspect` from the canvas size and calls `updateProjectionMatrix()` itself on a resize,
 * which PRESERVES `camera.view` but recomputes the matrix from the OLD view parameters — so the offset is
 * still there and the matrix is still right for the new size only after a second `updateProjectionMatrix()`.
 * Re-applying on a size change covers both, and it is cheap because `setViewOffset` is a handful of float
 * writes.
 *
 * ## When it is cleared
 *
 * On leaving mobile mode, and only then. `clearViewOffset()` restores `camera.view = null`, which is the
 * desktop state every existing spec asserts (`cameraViewIsNull`), so a resize across the breakpoint in either
 * direction returns the camera to a state the 3A/3B proofs describe.
 */
interface MobileOffsetState {
    /** The mode and size the offset was last applied for, and the rect size it was fitted to. */
    mode: LayoutMode2 | null;
    w: number;
    h: number;
    /** The header bottom and the dock width the fit was computed from, so a re-fit happens when either moves. */
    headerBottom: number;
}

/**
 * Publish the mode's ceiling to `controls.maxDistance`, once per change.
 *
 * ## Why the director is the one writer
 *
 * `singleWriter.test.ts` bans `.maxDistance =` outside this file, and `GlobeScene.tsx`'s JSX prop sets the initial
 * value at mount. This function is the runtime half of that rule: it is called from the frame, compares against
 * what it last wrote, and writes only on a change — so an ordinary desktop frame is one float comparison and
 * nothing else, which is what keeps the desktop proofs untouched.
 *
 * ## Desktop writes 5, always
 *
 * Not "writes nothing": a page that was a phone and is now a desktop must have its ceiling RESTORED, or the user
 * could zoom out to a mobile `dMax` on a desktop viewport. Writing the same constant the JSX prop already holds is
 * a no-op in effect and is the state the desktop specs describe.
 */
function applyMaxDistance(
    controls: OrbitControlsImpl,
    written: { current: number | null },
    wanted: number,
): void {
    if (written.current !== null && Math.abs(written.current - wanted) < 1e-9)
        return;
    controls.maxDistance = wanted;
    written.current = wanted;
}

function applyMobileOffset(
    camera: THREE.PerspectiveCamera,
    state: MobileOffsetState,
    mode: LayoutMode2,
    w: number,
    h: number,
    headerBottom: number,
    compute: () => MobileFrame,
): MobileFrame | null {
    if (
        state.mode === mode &&
        state.w === w &&
        state.h === h &&
        state.headerBottom === headerBottom
    )
        return null;
    state.mode = mode;
    state.w = w;
    state.h = h;
    state.headerBottom = headerBottom;

    if (mode === "desktop") {
        /*
         * Leaving mobile: put the camera back to the null-view state the desktop proofs describe.
         *
         * `clearViewOffset()` also calls `updateProjectionMatrix()` itself, but the call is written out rather
         * than relied on: `clearViewOffset` doing it is an implementation detail of three r169, and a version
         * that stopped would leave the desktop matrix still shifted with `camera.view === null` — i.e. every
         * desktop spec's `cameraViewIsNull` check would pass while the picture stayed wrong.
         */
        if (camera.view !== null) {
            camera.clearViewOffset();
            camera.updateProjectionMatrix();
        }
        return null;
    }

    const frame = compute();
    /*
     * The GENERALISED offset: both axes, from the free rect's centre.
     *
     * `setViewOffset(W, H, ox, oy, W, H)` with `ox = W/2 - cx` and `oy = H/2 - cy`. The sub-window keeps the full
     * W x H, so the zoom is unchanged and the disc stays a circle — a lens shift, not a rescale. Both signs were
     * proven by projecting a real camera in `mobileFrame.test.ts`, which is what the prompt's "flip a sign if
     * needed" asks for; the answer was that neither needed flipping.
     */
    camera.setViewOffset(w, h, frame.viewOffsetX, frame.viewOffsetY, w, h);
    /*
     * Explicit, per the step: `setViewOffset` only STORES the parameters and flags the matrix, and the commit
     * is this call. Writing it out also makes the projection write visible to `projectionWriter.test.ts`, which
     * asserts the director contains all three of `setViewOffset`, `clearViewOffset` and this.
     */
    camera.updateProjectionMatrix();
    return frame;
}

/** `prefers-reduced-motion`, resolved once instead of once per frame. */
let reducedMotionQuery: MediaQueryList | null | undefined;
function prefersReducedMotion(): boolean {
    if (reducedMotionQuery === undefined) {
        reducedMotionQuery =
            typeof matchMedia === "function"
                ? matchMedia("(prefers-reduced-motion: reduce)")
                : null;
    }
    return reducedMotionQuery?.matches ?? false;
}

interface CameraDirectorProps {
    activeRegion: RegionId | null;
    spin: MutableRefObject<SpinState>;
    controlsRef: MutableRefObject<OrbitControlsImpl | null>;
    /** Bumped to force a re-focus on the same region (e.g. re-click). */
    focusNonce: number;
    /** Receives the per-frame probe state. */
    probe?: MutableRefObject<FrameProbeSink | null>;
    /**
     * The app's region-selection path, for the screen-space fallback.
     *
     * Optional so the director still mounts without it (a test harness, a future shell). When it is
     * absent the fallback is skipped and a press mid-flight cancels the flight exactly as before.
     */
    onSelectRegion?: (id: RegionId) => void;
}

export function CameraDirector({
    activeRegion,
    spin,
    controlsRef,
    focusNonce,
    probe,
    onSelectRegion,
}: CameraDirectorProps) {
    const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
    const size = useThree((state) => state.size);
    /**
     * The renderer, for its `domElement` — the canvas the pointer events actually land on.
     *
     * `controls.domElement` is normally the same node, but it is whatever the controls were constructed
     * with, and a canvas that is re-created (a context loss, a remount) leaves the controls holding the
     * old node. Reading the renderer's canvas first means the listeners are attached to the element the
     * user is actually pressing, with the controls' node as the fallback.
     */
    const gl = useThree((state) => state.gl);
    /**
     * The canvas size, readable from the pointer handlers.
     *
     * A ref rather than a dependency: `size` changes on every resize, and putting it in the
     * OrbitControls effect's dependency list would tear down and re-register four listeners on each
     * resize frame. The frame callback below refreshes it, so a handler always sees the size the last
     * rendered frame used — which is the size the user aimed at.
     */
    const sizeRef = useRef(size);

    /*
     * THE ONE layout-mode listener (step 3-MOBILE1 B).
     *
     * Started here rather than in `App` or `GlobeScene` for one reason: this component is inside `<Canvas>`,
     * so it is guaranteed to be mounted exactly once and exactly as long as the scene exists, and the value it
     * publishes is only ever read by this file's frame loop and by the DOM shell that decides which overlay to
     * render. A second listener anywhere else would be a second source of truth for the same boolean.
     *
     * `startLayoutObserver` is ref-counted and idempotent, so React 18's development double-mount cannot install
     * two, and joining the one `App` already started is one `refs += 1`.
     */
    useEffect(() => startLayoutObserver(), []);

    /* ---------------------------------------------------------------- focus machine */

    const machine = useRef<FocusSnapshot>(initialFocus());
    /** The region the machine is targeting; kept apart from React's prop so a retarget is one event. */
    const targetRegion = useRef<RegionId | null>(null);
    /** True while the fly-to is animating. The machine's `focusing`/`returning` states gate this. */
    const travelling = useRef(false);
    const desiredTarget = useRef(new THREE.Vector3().copy(DEFAULT_TARGET));
    const desiredDistance = useRef(DEFAULT_POSITION.length());

    /* ------------------------------------------------------------------ frame rig state */

    const appliedOffset = useRef({ dx: 0, dy: 0 });
    const easedOffset = useRef({ dx: 0, dy: 0 });
    const appliedSize = useRef({ w: 0, h: 0 });
    const lastFit = useRef<number | null>(null);
    /**
     * The Niño box flight target (C2). Resolved once when the flight starts so a mid-flight aspect
     * change cannot retarget an in-progress tween.
     */
    const ninoFlight = useRef<{
        direction: THREE.Vector3;
        distance: number;
    } | null>(null);
    /**
     * The box the user has SELECTED, or `null`.
     *
     * NINO-HARDEN B7, and NINO-HARDEN-ADDENDUM (1): this is "a box is active", NOT "a flight is framed".
     * The two are different lifetimes and conflating them was a defect in the first B7 attempt:
     *
     *   - `ninoFlight.current` is cleared on ARRIVAL (that is what stops the per-frame writer) and on a
     *     user cancel (B3b) — it answers "is a tween running";
     *   - this ref is cleared only when the SELECTION goes away: toggle-off, Reset, or a region select.
     *
     * B7 must gate on the second. The addendum is explicit: "A user drag or wheel that cancelled the
     * flight must not block the re-fit to the new free rect." A cancel clears the first ref by design,
     * so gating on it would have made a cancelled flight immune to the resize re-fit — the opposite of
     * the requirement.
     *
     * It is also what makes B7 inert flag-off: `focusNinoBox` is the only writer, and App.tsx calls
     * `submitNinoFocus` only inside `if (NINO_UI)`, so with the flag off this is `null` on every frame.
     */
    const activeNinoBoxId = useRef<string | null>(null);
    /**
     * The free rect (as viewport FRACTIONS) the current box flight was resolved against.
     *
     * NINO-HARDEN-ADDENDUM (3): seeded at press time from the same `getInsets()` the distance used, then
     * compared every frame by `refitNinoForRect`. A2d's drawer was still open at the press, so this is
     * the only record of which rect the 1.45330 was computed for — without it the re-fit cannot tell a
     * stale flight from a current one and would re-arm on the first frame or never.
     */
    const ninoRect = useRef<{ wf: number; hf: number } | null>(null);

    /**
     * Push the spin pause state from the two things that own it, instead of setting it ad hoc.
     *
     * NINO-HARDEN-ADDENDUM (2): the pause condition is `region active OR box active`, derived from
     * STATE, not from `ninoFlight`. The first B4 attempt guarded the resume site with
     * `else if (!ninoFlight.current)`, which was ref-shaped and wrong in a way the new acceptance
     * exposes directly: `ninoFlight` is cleared on arrival, so once the box flight landed the guard went
     * false and the spin could resume while the box was still selected and highlighted — the outline
     * would start turning away from a camera aimed at where it had been.
     *
     * `targetRegion` is the director's own record of the active region (set in the `activeRegion`
     * effect, cleared on deselect and Reset), so this needs no new state.
     */
    const syncSpinPause = useCallback((): void => {
        spin.current.paused =
            targetRegion.current !== null || activeNinoBoxId.current !== null;
    }, [spin]);
    const hasApplied = useRef(false);
    const rigOwnsDistance = useRef(true);
    const recentDistances = useRef<number[]>([]);

    /**
     * The distance `userZoomed` was last evaluated against, so a `change` event can tell whether the
     * USER moved it. `null` until the first frame has run (there is no distance to compare yet).
     */
    const lastSeenDistance = useRef<number | null>(null);
    /**
     * The mobile offset's idempotency key, and the last frame it produced.
     *
     * Both are refs rather than state: `useFrame` runs 60 times a second and reads/writes them in place, and
     * moving either into React state would re-render the scene subtree on every resize storm. The cache exists
     * so a frame that does NOT cross a mode or size boundary can reuse the previous `MobileFrame` instead of
     * recomputing the fit — the offset only changes when the window does.
     */
    const mobileOffset = useRef<MobileOffsetState>({
        mode: null,
        w: 0,
        h: 0,
        headerBottom: 0,
    });
    /** The `controls.maxDistance` this module last wrote, so it writes only on a change. */
    const maxDistanceWritten = useRef<number | null>(null);
    const mobileCache = useRef<MobileFrame | null>(null);
    /** True while THIS module is writing, so its own `change` events are ignored. */
    const writing = useRef(false);
    /** Last distance this module itself wrote — the "outside the director's own writes" test. */
    const ownDistance = useRef<number | null>(null);

    /** Apply a camera write with the "our own change events are not user input" guard held. */
    const withOwnWrite = (fn: () => void): void => {
        writing.current = true;
        try {
            fn();
        } finally {
            writing.current = false;
        }
    };

    /** Dispatch one machine event and record the resulting context. */
    const dispatch = (event: FocusEvent): void => {
        machine.current = stepFocus(machine.current, event);
    };

    /* ------------------------------------------------------------------- intents */

    /**
     * Register the synchronous pose setter the E2E hook submits through.
     *
     * Synchronous on purpose. `__globe.setCamera` used to write the camera immediately and resolve on
     * the second `requestAnimationFrame`; deferring the write to the next `useFrame` would have moved
     * that second rAF one frame later and put `ref.spec.ts`'s strict-0 comparison at risk. The write
     * still lives in this module — `globeProbe.ts` now only submits.
     */
    useEffect(() => {
        registerCameraIntents({
            setPose: (pose: CameraPose) => {
                withOwnWrite(() => {
                    camera.position.set(
                        pose.position[0],
                        pose.position[1],
                        pose.position[2],
                    );
                    camera.lookAt(
                        pose.target[0],
                        pose.target[1],
                        pose.target[2],
                    );
                    camera.updateMatrixWorld(true);
                });
                ownDistance.current = camera.position.distanceTo(
                    controlsRef.current?.target ?? new THREE.Vector3(),
                );
                /*
                 * NO `USER_ZOOM` HERE — step 3B2 reverses the 3B latch.
                 *
                 * In 3B a hook-driven pose had to invalidate `lastFit` because the LIVE fly-to wrote the
                 * distance and the fit would otherwise re-take it. The live fly-to writes no distance now, so
                 * `userZoomed` means exactly "the USER moved the distance" and nothing else. The LOCKED branch
                 * keeps its own latch internally (see `runLockedFlyTo`), which is where the behaviour
                 * `globe.spec.ts` depends on actually lives.
                 */
            },
            /**
             * Resolve a Niño box into a camera target. `null` cancels the flight.
             *
             * Everything that depends on the LIVE viewport is computed here, at press time: the aspect
             * comes from the camera the director already holds, so a portrait phone gets the width-limited
             * distance without the card having to know anything about the renderer. The whole framing
             * decision is `ninoFlyToDistance` — pure, unit-tested, no three.js.
             */
            focusNinoBox: (boxId: string | null) => {
                /*
                 * NINO-HARDEN B4 + ADDENDUM (2): clearing the box RESUMES the spin — via the DERIVED pause.
                 *
                 * The brief's rule: "Clearing the box (toggle off, Reset, region select) must resume spin."
                 * All three routes land here (`selectRegion` calls `submitNinoFocus(null)`, and Reset does too),
                 * so this is the single place that has to know. `syncSpinPause()` reads the two SELECTION refs
                 * and is the only writer of `paused` on this path — `spin.current.paused = false` would be wrong
                 * when a region happens to be selected at the same time, since the region still owns the pause.
                 */
                if (boxId === null) {
                    ninoFlight.current = null;
                    activeNinoBoxId.current = null;
                    /* B7: forget the rect too, so the next box press seeds a fresh one instead of re-arming. */
                    ninoRect.current = null;
                    syncSpinPause();
                    return;
                }
                const box = NINO_BOXES.find((b) => b.id === boxId);
                if (!box) {
                    ninoFlight.current = null;
                    activeNinoBoxId.current = null;
                    ninoRect.current = null;
                    syncSpinPause();
                    return;
                }
                /*
                 * NINO-HARDEN B3a (A2d): a box flight TAKES OVER from a region flight.
                 *
                 * Measured at 1280x720 (A2d): region Pacific focused at d 4.6943, then the Niño 1+2 button
                 * pressed — final d 4.69432, unchanged, against a predicted 1.4546. The press was never
                 * honoured: `useFrame` asked `isTravelling(state)` FIRST and the region machine was still in a
                 * travelling state, so the live fly-to owned the camera for the whole frame and the box branch
                 * was never reached. The flight object was set and then simply never read.
                 *
                 * Two halves, both needed:
                 *
                 *   1. the branch order in `useFrame` (below) — the box wins while it exists;
                 *   2. this reset of the region machine, because `App.showNinoOnGlobe` calls `selectRegion(null)`
                 *      and the `activeRegion` effect dispatches `SELECT(null)` a render LATER. Without the reset
                 *      the machine would land in `returning` behind the box flight and, the instant the flight
                 *      cleared itself on arrival, `runLiveFlyTo` would fly the camera back to the default pose —
                 *      a box focus that ends by flying away from the box.
                 *
                 * `initialFocus()` rather than a new machine event: the machine is a ref this component owns,
                 * and cancelling a region flight is a RESET OF ITS DATA, not a new transition rule. Adding an
                 * event would change `FOCUS_EVENTS` and thus the table the exhaustive test enumerates, for a
                 * transition only this file needs. When the `activeRegion` effect then dispatches `SELECT(null)`
                 * the machine is already `idle`, and `closeOrStay(idle)` is a no-op — so the two mechanisms
                 * agree instead of fighting.
                 */
                machine.current = initialFocus(machine.current.context.poseRef);
                targetRegion.current = null;
                /*
                 * NINO-HARDEN B4: PAUSE THE SPIN, then aim — in that order.
                 *
                 * This is the fix for A1, the headline defect: the outline is drawn as a child of the earth
                 * group and therefore rotates with it, but `focusNinoBox` built its aim point from LOCAL
                 * lat/lon only (no rotation), while the region fly-to applies `spinY` (`regionDirection`, :136).
                 * Measured at 1280x720, the resulting miss angle equalled the spin to 3 decimal places — set
                 * spin 0 -> 17.329 deg, 1.0 rad -> 57.296 deg, 4.6251 rad -> 95.001 deg — and predicted
                 * distance matched settled distance in every row, so the framing maths was right and only the
                 * direction was wrong.
                 *
                 * Approach (i) from the brief, and why: pause first, then resolve the world direction ONCE.
                 * The alternative (recomputing every frame during the flight) was rejected because the
                 * acceptance bound is "camera-vs-centre angle <= 0.5 deg" — a moving target would make that
                 * number measure the frame rate and the tween's phase rather than the fix. Pausing also fixes
                 * the second half of A1: with the planet still turning, the arrived camera watched the box
                 * drift away (bbox centre +284.1 -> +343.9 -> +387.1 px over 10 s).
                 *
                 * `paused` is the SAME mechanism region selection uses, and the resume route is the same one
                 * region deselect takes: `syncSpinPause()` derives it from the selection refs, so clearing the
                 * box below (or Reset) unpauses by removing the box from that expression rather than by
                 * writing `false` at each site.
                 *
                 * On `matrixWorld` versus `spinY`: the brief prefers the earth group's matrix so any tilt is
                 * included. The group's ONLY transform is `rotation.y`, assigned every frame in
                 * `EarthSystem.tsx:84` from this very ref, and `<EarthSystem>` is mounted with no transform
                 * prop (`GlobeScene.tsx:680-687`) — no tilt, no scale, no translation — so applying
                 * `spin.current.y` about Y is the matrix transform, exactly, and not an approximation of it.
                 * `earthGroupTransform.test.ts` now fails if that ever stops being true.
                 */
                activeNinoBoxId.current = boxId;
                /*
                 * Addendum (2): the pause is DERIVED. Set the selection first, then sync — a bare
                 * `paused = true` here would be a SECOND writer of the same boolean, and it re-paused after a
                 * clear whenever no region happened to be selected.
                 */
                syncSpinPause();
                /*
                 * The resolution is shared with the resize path (B7) — see `ninoFlightTarget`. Called with no
                 * free-rect override, so it reads `getInsets()` exactly as the inline code here did before:
                 * press-time behaviour is unchanged.
                 */
                ninoFlight.current = ninoFlightTarget(
                    box,
                    camera,
                    spin.current.y,
                );
                /*
                 * ADDENDUM (3) + B7. One `getInsets()` read serves two jobs:
                 *
                 *   1. Seed `ninoRect` with the rect this flight was resolved against, from the SAME snapshot
                 *      `ninoFlightTarget` used, so "the rect changed" is measured against where the distance
                 *      actually came from rather than against a later re-read.
                 *   2. Record the press-time inputs for A2d. That measurement is what proved the distance was
                 *      STALE rather than wrong: rect w 501.16 (widthFrac 0.39153) at the press, 603.16
                 *      (0.47120) at settle, 1.45330 vs 1.39460.
                 *
                 * Debug-only instrumentation, but the rect SEED is not — it runs unconditionally and is what the
                 * per-frame re-fit compares against. Only the `__ninoPress` record is gated, on the same
                 * `has('debug')` check `main.tsx:23` uses to install the e2e hooks.
                 */
                {
                    const pressInsets = getInsets();
                    const vw = window.innerWidth || 0;
                    const vh = window.innerHeight || 0;
                    ninoRect.current =
                        vw > 0 && vh > 0
                            ? {
                                  wf: pressInsets.free.w / vw,
                                  hf: pressInsets.free.h / vh,
                              }
                            : null;
                    if (
                        import.meta.env.VITE_E2E === "1" &&
                        new URLSearchParams(window.location.search).has("debug")
                    ) {
                        (
                            window as unknown as Record<string, unknown>
                        ).__ninoPress = {
                            boxId,
                            t: performance.now(),
                            innerW: vw,
                            innerH: vh,
                            insets: pressInsets,
                            freeRectFrac: freeRectFraction(
                                pressInsets.free,
                                vw,
                                vh,
                            ),
                            aspect: camera.aspect,
                            fov: camera.fov,
                            distance: ninoFlight.current.distance,
                        };
                    }
                }
            },
        });
        /*
         * `spin` joined this list in NINO-HARDEN B3a: `focusNinoBox` now unpauses the globe when a box
         * flight takes over from a region flight, so the callback closes over `spin` and the effect must
         * re-register when it changes. `spin` is a stable ref from `useRef`, so this cannot loop — the
         * entry is correctness for the linter and documentation for a reader, not a re-run.
         */
        return () => registerCameraIntents(null);
    }, [camera, controlsRef, spin, syncSpinPause]);

    /* -------------------------------------------------- OrbitControls as an input device */

    useEffect(() => {
        const controls = controlsRef.current;

        /*
         * The canvas, preferring the renderer's own element over the controls' — see `gl` above. `undefined`
         * rather than a cast, so a renderer that has not produced a canvas yet skips the listeners instead of
         * throwing on `addEventListener`.
         *
         * The controls are NOT required for the pointer listeners: those are attached to the canvas, and a
         * frame in which the controls have not been constructed yet (or have been torn down by a remount)
         * must still be able to resolve a press. Only the `start`/`change` subscriptions need the controls,
         * and those are guarded at the bottom of this effect.
         */
        const dom = (gl.domElement ?? controls?.domElement) as
            HTMLElement | undefined;
        if (!dom) return undefined;
        /* Where the current pointer press began; null when no pointer is down (so a `start` with null = wheel). */
        let downAt: { x: number; y: number } | null = null;
        /**
         * The pin the current press landed on, resolved at POINTERDOWN and held until the release decides.
         *
         * A closure variable rather than `dom.dataset`: it has the same lifetime as `downAt` beside it, it
         * cannot be observed or clobbered by anything outside this effect, and it needs no string parsing.
         */
        let pinHit: RegionId | null = null;

        /**
         * Cancel a Niño box flight because the USER took the camera.
         *
         * Extracted so the drag path and the wheel path run the identical cancel, and so the reasoning below
         * lives in one place instead of being duplicated at two call sites that could drift apart.
         *
         * ## NINO-HARDEN B3b (A2b and A2c): user input CANCELS a Niño box flight
         *
         * The machine's `USER_ORBIT_START` only knows about REGION flights; a box flight does not run
         * through the machine at all, so nothing was cancelling it. The measured effect at 1280x720:
         * a drag during the box tween traced 2.4881 -> 2.4426 and a wheel-out through it traced
         * 2.6996 -> 2.446, i.e. in both cases `runNinoFlyTo` kept writing the camera every frame and
         * pulled it back to the box's fitted distance. The user's input was overwritten in flight.
         *
         * ## Why the cancel is DEFERRED for a pointer press
         *
         * OrbitControls raises `start` on pointerdown, before R3F's parent-level handler has seen the event,
         * so cancelling there cancelled the flight for EVERY press — including a press that lands on a pin
         * and a bare tap that moves nothing. Measured consequence (G3(a)): a pin press 300 ms into a flight
         * froze the camera mid-tween and left the box selected, i.e. "cancels without deciding", and G3(h)'s
         * zero-movement tap cancelled a flight it must not touch.
         *
         * So a pointer press only RECORDS where it began (`onPointerDownCapture`); the cancel happens when
         * the pointer travels past `BOX_CANCEL_DRAG_PX` (`onPointerMoveCheck`), or when the selection changes
         * through `focusNinoBox(null)` because a pin's `onSelect` fired. A wheel or keyboard gesture has no
         * pointer down, so it still cancels immediately in `onStart`.
         *
         * `activeNinoBoxId` is deliberately NOT cleared: the brief's rule is that the box stays highlighted,
         * because the user interrupted the CAMERA, not the selection.
         *
         * ## NINO-HARDEN B7 + ADDENDUM (1): the SELECTION is deliberately NOT cleared here
         *
         * A user cancel stops the tween and hands the camera to the user; the box stays selected and
         * highlighted, and the spin stays paused. Clearing `activeNinoBoxId` here — which the first B7
         * attempt did — would make a cancelled flight immune to the resize re-fit, which the addendum
         * forbids: "A user drag or wheel that cancelled the flight must not block the re-fit to the new
         * free rect."
         *
         * ## Why `USER_ZOOM` is dispatched
         *
         * Cancelling the flight hands the radius back to the frame rig's fit channel, which would ease it to
         * `dFit` on the very next frame — so a cancelled flight would still end at the fit distance rather
         * than where the user left it. `USER_ZOOM` is the machine's own word for "the user owns the
         * distance", and it is the same event the wheel path dispatches, so this does not invent a second
         * meaning for `userZoomed`.
         */
        const cancelBoxFlight = (): void => {
            ninoFlight.current = null;
            dispatch({ type: "USER_ZOOM" });
            dispatch({ type: "USER_ORBIT_START" });
        };

        /*
         * CAPTURE phase on pointerdown, because OrbitControls' own pointerdown listener is on the same
         * element and raises `start` synchronously: the press position has to be recorded before `onStart`
         * runs, or `onStart` cannot tell a pointer press from a wheel.
         */
        const onPointerDownCapture = (e: PointerEvent): void => {
            /*
             * CANVAS-relative, not viewport-relative.
             *
             * `screenSpacePinAt` compares against `size.width`/`size.height`, which are the canvas's CSS size,
             * and projects into that same space. `clientX`/`clientY` are viewport coordinates, so on a canvas
             * that does not start at (0, 0) — a header above it, a sidebar beside it — the two disagree by the
             * canvas's offset and the fallback tests the wrong point. Subtracting the rect's origin puts the
             * press in the space the projection uses.
             */
            const rect = dom.getBoundingClientRect();
            downAt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            /*
             * Resolve a potential pin hit NOW, at the press, and hold it until the release decides.
             *
             * It cannot be resolved at pointerup: by then the flight has moved the camera on and the pin has
             * drifted (74.6 px between pointerdown and pointerup, `Hotspot.tsx`), so the point the user aimed
             * at is no longer under the pointer. Resolving at the press and committing at the release is what
             * makes "press on a pin during a flight" a decision rather than a cancel — without also making a
             * DRAG a decision, which is what `onPointerMoveCheck` below prevents.
             */
            pinHit = null;
            if (ninoFlight.current !== null && onSelectRegion) {
                pinHit = screenSpacePinAt(
                    downAt.x,
                    downAt.y,
                    SCREEN_HIT_FALLBACK_FLIGHT_PX,
                );
            }
        };
        const onPointerMoveCheck = (e: PointerEvent): void => {
            if (!downAt || !ninoFlight.current) return;
            /* Canvas-relative, matching `onPointerDownCapture` — see `isClick`. */
            const rect = dom.getBoundingClientRect();
            if (
                Math.hypot(
                    e.clientX - rect.left - downAt.x,
                    e.clientY - rect.top - downAt.y,
                ) > BOX_CANCEL_DRAG_PX
            ) {
                /* A drag is not a decision: drop the held hit so the release cannot commit it. */
                pinHit = null;
                downAt = null;
                cancelBoxFlight();
            }
        };
        const onPointerEnd = (e: PointerEvent): void => {
            /*
             * COMMIT a held pin hit — but only for a click/tap, and only for `pointerup`.
             *
             * `pointercancel` is not a decision (the browser took the pointer away), so it clears the hit
             * without selecting. A press that travelled past `BOX_CANCEL_DRAG_PX` has already had its hit
             * dropped by `onPointerMoveCheck`, so `isClick` is a second, independent guard rather than the
             * only one.
             */
            if (
                e.type === "pointerup" &&
                pinHit !== null &&
                isClick(downAt, e, dom) &&
                onSelectRegion
            ) {
                const hit = pinHit;
                pinHit = null;
                downAt = null;
                /*
                 * The refs are cleared HERE for the same reason the `onStart` branches clear them:
                 * `onSelectRegion` reaches `App.selectRegion`, which only clears them a render later and only
                 * when `NINO_UI` is on. Until then `refitNinoForRect` would re-arm a flight for a box the user
                 * has just navigated away from, and `syncSpinPause` would keep the planet frozen under a region
                 * that is about to be focused.
                 *
                 * `ninoFlight` is deliberately NOT cleared: `submitNinoFocus(null)` inside `selectRegion` is the
                 * one place that knows how to cancel a box flight, and a second writer here would make the
                 * ordering between the two decide what the frame loop sees.
                 */
                activeNinoBoxId.current = null;
                ninoRect.current = null;
                syncSpinPause();
                onSelectRegion(hit);
                return;
            }
            pinHit = null;
            downAt = null;
        };

        /**
         * The nearest pin whose projected HEAD lies within `radius` of a screen point.
         *
         * `radius` defaults to `SCREEN_HIT_FALLBACK_PX`; the box-flight press path passes the wider
         * `SCREEN_HIT_FALLBACK_FLIGHT_PX` (G3(a)). One implementation rather than two copies, so the facing
         * gate, the projection and the "nearest wins" rule cannot drift apart between the two callers.
         *
         * ## Why a 2D test exists at all
         *
         * The pin proxy is a real scene object and its `raycast` is the primary hit test, but it is
         * evaluated against the camera's matrices from the LAST RENDER. During a fly-to the camera is
         * written every frame and a pointer event can arrive between two frames, so the ray is cast from
         * a pose the picture has already left — `Hotspot.tsx` measures 74.6 px of pin drift between
         * pointerdown and pointerup. When a press lands in that gap the ray misses, nothing is selected,
         * and the flight is cancelled instead: the user's press is swallowed.
         *
         * This answers "is the pointer near where a pin is DRAWN" for exactly that case, and only that
         * case. It is not consulted on the ordinary path, so the proxy's 18 px (28 px coarse) radius and
         * its facing gate remain the single definition of "a pin was pressed" everywhere else.
         *
         * ## The projection refreshes the camera's matrices first
         *
         * `project()` reads `camera.matrixWorldInverse`, which R3F refreshes before each render — but a
         * pointer event can arrive BETWEEN two frames, and during a flight this module writes the camera
         * every frame. `Camera.updateMatrixWorld` recomputes the inverse, so the projection is against the
         * pose the camera holds right now: the pose the press is being resolved against and the one the
         * next frame will draw. Without it a press resolved mid-flight is compared against a pose the
         * picture has already left, which is the same staleness that loses the raycast.
         *
         * ## The facing gate is reproduced, and relaxed for the flight radius
         *
         * A back-facing pin projects to a point INSIDE the disc, so a pure proximity test would make an
         * invisible pin selectable through the globe. The test is the same dot product `pinFacesCamera`
         * performs (`pinVisibilityBands.ts`), with the globe centre at the origin and `camera.position`
         * standing in for the ray origin — the two differ by the near plane (0.1) against a radius of
         * ~3.8, which cannot move the verdict.
         *
         * The widened FLIGHT radius relaxes the gate to the front hemisphere (`facing > 0`) instead of
         * `PIN_HIT_GATE`: a pin near the limb is both the one a mid-flight press is most likely to be
         * aimed at and the one the ray is most likely to lose, and the ordinary radius keeps the strict
         * gate so the hit target the existing specs were written against does not move.
         */
        const screenSpacePinAt = (
            x: number,
            y: number,
            radius: number = SCREEN_HIT_FALLBACK_PX,
        ): RegionId | null => {
            const s = sizeRef.current;
            if (s.width <= 0 || s.height <= 0) return null;
            /* Fresh matrices — see "The projection refreshes the camera's matrices first" above. */
            camera.updateMatrixWorld(true);
            const camLen = camera.position.length() || 1;
            let bestId: RegionId | null = null;
            let bestDist = radius;
            for (const region of Object.values(REGION_MAP)) {
                const head = regionHeadPosition(region.id, spin.current.y);
                /* Facing first: a back pin is skipped without paying for a projection. */
                const n = SCRATCH_HIT.copy(head).normalize();
                const facing =
                    (n.x * camera.position.x +
                        n.y * camera.position.y +
                        n.z * camera.position.z) /
                    camLen;
                /* Strict gate at the ordinary radius, front hemisphere at the widened flight radius. */
                const gate = radius > SCREEN_HIT_FALLBACK_PX ? 0 : PIN_HIT_GATE;
                if (facing <= gate) continue;

                head.project(camera);
                /* `z > 1` is behind the camera; a non-finite NDC is a degenerate matrix. */
                if (head.z > 1 || !Number.isFinite(head.x + head.y)) continue;
                const sx = (head.x * 0.5 + 0.5) * s.width;
                const sy = (-head.y * 0.5 + 0.5) * s.height;
                const d = Math.hypot(sx - x, sy - y);
                if (d < bestDist) {
                    bestDist = d;
                    bestId = region.id;
                }
            }
            return bestId;
        };

        const onStart = (): void => {
            /*
             * A pin click fires pointerdown, which immediately raises OrbitControls' 'start' event.
             * If a region is actively being selected or targeted, do NOT let OrbitControls cancel
             * the focus transition by dispatching USER_ORBIT_START.
             */
            if (activeRegion !== null || targetRegion.current !== null) {
                if (ninoFlight.current) {
                    /*
                     * SCREEN-SPACE FALLBACK — see `screenSpacePinAt`.
                     *
                     * A press that lands on a pin while a region flight is running is the case the raycast
                     * loses: the proxy is tested against the last rendered pose, the camera has moved since,
                     * and the press is swallowed — the flight is cancelled and nothing is selected. So before
                     * cancelling, ask the 2D test whether the pointer is near a drawn pin, and if it is, treat
                     * the press as the selection it was meant to be.
                     *
                     * `onSelectRegion` is the app's own selection path (`GlobeScene`'s `handleSelect`), so the
                     * Niño selection is cleared and the spin resumed by `selectRegion` — which already calls
                     * `submitNinoFocus(null)` — rather than by a second copy of that rule here. A press the ray
                     * DID resolve also reaches this line, and the duplicate `selectRegion` is harmless: React
                     * batches the two state updates into one render, so the focus nonce moves once and the
                     * camera flies once.
                     */
                    if (downAt !== null && onSelectRegion) {
                        /*
                         * `pinHit` first: it was resolved at POINTERDOWN with the widened flight radius, against
                         * the pose the user actually aimed at. Re-projecting here would test the pin's CURRENT
                         * position, which the flight has already moved (74.6 px of drift, `Hotspot.tsx`), so the
                         * press-time hit is both cheaper and the more faithful answer. The projection is the
                         * fallback for a press whose capture-phase resolution found nothing.
                         */
                        const hit =
                            pinHit ??
                            screenSpacePinAt(
                                downAt.x,
                                downAt.y,
                                SCREEN_HIT_FALLBACK_FLIGHT_PX,
                            );
                        if (hit !== null) {
                            /*
                             * Clear the Niño SELECTION, and let the region selection own the camera.
                             *
                             * The FLIGHT is deliberately NOT cleared here. `onSelectRegion` reaches `App.selectRegion`,
                             * which calls `submitNinoFocus(null)` synchronously, and that is the one place that knows how
                             * to cancel a box flight. Writing `ninoFlight.current = null` here as well would make this
                             * branch a second writer of the same ref, and the ordering between the two would then decide
                             * which one the frame loop saw.
                             *
                             * The refs below still have to be cleared HERE, because `App.selectRegion` only clears them a
                             * render later, and only when `NINO_UI` is on. Until that render the director's own refs would
                             * still say "a box is selected", so `refitNinoForRect` would re-arm a flight for a box the
                             * user has just navigated away from, and `syncSpinPause` would keep the planet frozen under a
                             * region that is about to be focused.
                             *
                             * `ninoRect` goes with them: it is the record of which free rect the box distance was
                             * resolved against, and leaving it set would let the next box press compare against a stale
                             * rect instead of seeding a fresh one.
                             */
                            activeNinoBoxId.current = null;
                            ninoRect.current = null;
                            syncSpinPause();
                            onSelectRegion(hit);
                            return;
                        }
                        /*
                         * DEFER — the RELEASE decides (G3(a)/G3(b)).
                         *
                         * A pointer press that resolved no pin is not yet a decision: it may still become a drag
                         * (which must cancel the flight) or a bare tap (which must not). Cancelling here is what
                         * made a press 300 ms into a flight freeze the camera mid-tween and leave the box
                         * selected — "cancels without deciding" — and what made G3(h)'s zero-movement tap cancel a
                         * flight it must not touch.
                         *
                         * So nothing is written and nothing is dispatched: `onPointerMoveCheck` cancels once the
                         * press travels past `BOX_CANCEL_DRAG_PX`, and `onPointerEnd` commits a held `pinHit` only
                         * for a click/tap. `ninoFlight` is left alone for the same reason the hit branch leaves it
                         * alone — `submitNinoFocus(null)` inside `selectRegion` is the one place that knows how to
                         * cancel a box flight.
                         */
                        return;
                    }
                    /* No pointer is down (or no selection path): a wheel/keyboard gesture cancels immediately. */
                    ninoFlight.current = null;
                }
                return;
            }

            /* A drag the user started during a fly-to cancels it; the machine knows the rule. */
            if (ninoFlight.current) {
                if (downAt !== null) {
                    /*
                     * Pointer press: DEFER — the RELEASE decides.
                     *
                     * `onPointerDownCapture` has already resolved whether the press landed on a pin (at the
                     * widened flight radius) and held it; `onPointerEnd` commits it only if the press ends as a
                     * click/tap, and `onPointerMoveCheck` drops it and cancels the flight if the press becomes a
                     * drag. Deciding here instead would make every press a decision, which is the G3(a) defect
                     * this path exists to avoid: a press 300 ms into a flight froze the camera mid-tween and left
                     * the box selected, i.e. "cancels without deciding".
                     *
                     * Nothing is dispatched here, and `ninoFlight` is not touched: `submitNinoFocus(null)` inside
                     * `selectRegion` is the one place that knows how to cancel a box flight.
                     */
                    return;
                }
                /* No pointer is down, so this `start` is a wheel/keyboard gesture: cancel immediately, as before. */
                cancelBoxFlight();
                return;
            }
            dispatch({ type: "USER_ORBIT_START" });
        };

        const onChange = (): void => {
            /*
             * Ignore the `change` events THIS module raises by calling `controls.update()` — the controls
             * dispatch one on every internal damping step, and treating those as user input would latch
             * `userZoomed` on the very first frame and switch the fit's distance channel off forever.
             */
            if (writing.current) return;
            const controls2 = controlsRef.current;
            if (!controls2) return;
            const d = camera.position.distanceTo(controls2.target);
            const previous = lastSeenDistance.current;
            lastSeenDistance.current = d;
            if (previous === null) return;
            /*
             * `> LAST_FIT_EPSILON` (0.002), the prompt's threshold. A rotation changes the distance by ~0,
             * a one-notch wheel changes it by ~0.01 at this distance, so the test separates them.
             */
            if (Math.abs(d - previous) > LAST_FIT_EPSILON)
                dispatch({ type: "USER_ZOOM" });
        };

        controls?.addEventListener("start", onStart);
        controls?.addEventListener("change", onChange);
        dom.addEventListener("pointerdown", onPointerDownCapture, true);
        dom.addEventListener("pointermove", onPointerMoveCheck);
        dom.addEventListener("pointerup", onPointerEnd);
        dom.addEventListener("pointercancel", onPointerEnd);
        return () => {
            controls?.removeEventListener("start", onStart);
            controls?.removeEventListener("change", onChange);
            dom.removeEventListener("pointerdown", onPointerDownCapture, true);
            dom.removeEventListener("pointermove", onPointerMoveCheck);
            dom.removeEventListener("pointerup", onPointerEnd);
            dom.removeEventListener("pointercancel", onPointerEnd);
        };
    }, [
        camera,
        controlsRef,
        activeRegion,
        onSelectRegion,
        spin,
        syncSpinPause,
        gl,
    ]);

    /* ------------------------------------------- selection -> machine (replaces CameraRig's effect) */

    useEffect(() => {
        if (activeRegion) {
            dispatch({ type: "SELECT", regionId: activeRegion });
            targetRegion.current = activeRegion;
        } else if (machine.current.state !== "idle") {
            /* Deselecting is the CLOSE rule; `SELECT(null)` is routed there by the machine itself. */
            dispatch({ type: "SELECT", regionId: null });
            targetRegion.current = null;
        }
        /*
         * NINO-HARDEN-ADDENDUM (2): the pause is DERIVED, not written per branch.
         *
         * This effect runs on the render AFTER `showNinoOnGlobe`, which calls `selectRegion(null)` — so by
         * the time it runs, a box press has already paused the spin and set `activeNinoBoxId`. The previous
         * shape set `paused = false` here unconditionally (and then, in B4, behind an
         * `else if (!ninoFlight.current)` guard). Both were wrong for the addendum's acceptance:
         *
         *   - unconditional: measured as A2d's camera-vs-centre angle at 9.128 deg while fresh-boot A1 rows
         *     read 0.000-0.008 — the effect un-paused what the press had just paused;
         *   - the ref guard: `ninoFlight` is cleared on ARRIVAL, so once the box flight landed the guard
         *     went false and the spin resumed with the box still selected — the outline then turns away from
         *     a camera aimed at where it had been, which is the A1d drift this whole item exists to remove.
         *
         * `syncSpinPause` reads the two SELECTION refs (`targetRegion`, `activeNinoBoxId`), so the pause
         * lasts exactly as long as a region OR a box is selected, whatever the flight happens to be doing.
         */
        syncSpinPause();
        travelling.current = true;
    }, [activeRegion, focusNonce, spin, syncSpinPause]);

    /* --------------------------------------------------- the Reset View button's channel */

    /**
     * Subscribe to the RESET requests the header's button raises.
     *
     * A counter rather than an event bus: two clicks must be two events, and a subscriber that missed one
     * while unmounted must not replay it. The dispatch is synchronous, so the machine has already moved to
     * `returning` by the time the click handler returns.
     */
    useEffect(() => {
        let seen = getResetRequest();
        return subscribeResetRequest(() => {
            const now = getResetRequest();
            if (now === seen) return;
            seen = now;
            dispatch({ type: "RESET" });
            /*
             * RESET is the "back to the default view" intent, which is a running-planet intent — and it also
             * ENDS any Niño selection, so the derived pause must see that.
             *
             * NINO-HARDEN-ADDENDUM (2): `activeNinoBoxId` is cleared here because Reset is one of the three
             * documented ways to clear the box, and leaving it set would (a) keep the spin paused forever and
             * (b) let B7 re-fly to a box the user just reset away from on the next resize. `targetRegion` is
             * cleared by the `activeRegion` effect that follows this dispatch, so `syncSpinPause` is called
             * AFTER that clear is visible — which it is not on this line. Hence the explicit both-clears here
             * rather than a bare `syncSpinPause()` that would still read the stale region.
             */
            targetRegion.current = null;
            activeNinoBoxId.current = null;
            syncSpinPause();
        });
    }, [spin, syncSpinPause]);

    /* ------------------------------------------------------------------------ the frame */

    useFrame((_, delta) => {
        sizeRef.current = size;
        const controls = controlsRef.current;
        if (!controls) return;

        const stepDt = Math.min(delta, 1 / 30);
        const state = machine.current.state;

        /* ============================================================ 1. the focus policy ====
         *
         * Two bodies, chosen by MODE — not by a flag inside one body. The locked one is the legacy
         * aim-at-pin fly-to with its own `lastFit` latch; the live one orbits the camera and writes no
         * distance. Keeping them apart is what lets the locked arithmetic stay byte-identical (S3) while
         * the live policy reverses the 3B distance latch.
         */
        const ctx: PolicyContext = {
            camera,
            controls,
            stepDt,
            state,
            spin,
            targetRegion,
            desiredTarget,
            desiredDistance,
            lastFit,
            ninoFlight,
            withOwnWrite,
            dispatch,
        };

        /*
         * NINO-HARDEN B3a: the BOX flight is checked FIRST.
         *
         * It used to be `if (isTravelling(state)) { ... } else if (ninoFlight.current) { ... }`, which made
         * the region's travelling state own the camera even when a box flight was live — the A2d defect, where
         * pressing a Niño card during a region flight changed nothing (final d 4.69432 against a predicted
         * 1.4546). A box focus is the more recent user intent, so it wins while it exists.
         *
         * Flag-off this is provably inert: `ninoFlight.current` is only ever assigned inside
         * `focusNinoBox`, which is only called by `submitNinoFocus`, which App.tsx now calls only inside
         * `if (NINO_UI)`. With the flag off it is `null` on every frame, so `isTravelling` decides exactly
         * as before and the region branches below are reached by the same condition as before.
         */
        if (ninoFlight.current) {
            /*
             * A box flight is active. Checked OUTSIDE `isTravelling` because a box is not a region and does
             * not drive the focus machine: the machine stays `idle` and the controls own the camera during
             * the tween, so the flight has to be its own gate rather than a machine state.
             */
            runNinoFlyTo(ctx);
        } else if (isTravelling(state)) {
            if (IS_LOCKED) {
                runLockedFlyTo(ctx);
            } else {
                runLiveFlyTo(ctx);
            }
        } else {
            /*
             * Not travelling: the controls own the camera. `update()` still has to run every frame because
             * that is what applies OrbitControls' own damping to the user's wheel/pinch/rotate input.
             */
            withOwnWrite(() => controls.update());
        }

        /* ============================================================== 2. the frame ====
         *
         * `FrameRig`'s body. In LOCKED mode none of this runs — the component renders no offset, no fit
         * and leaves `camera.view` null, which is what keeps `ref.spec.ts` at strict 0.
         */
        if (IS_LOCKED) {
            noteLocked();
        } else if (getLayoutSignal().mode !== "desktop") {
            /*
             * ===================================================== 2a. THE MOBILE BRANCH ====
             *
             * A separate branch rather than a conditional inside the desktop body, for the same reason the two focus
             * policies are separate bodies: the desktop arithmetic has to stay byte-identical (S1 residual 0), and the
             * only way to be sure a shared branch did not perturb it is to not share one.
             *
             * Step MOBILE2 replaced MOBILE1's fixed 55 % band with the layout's own free rectangle, and the distance with
             * the unclamped fit:
             *
             *   - the free rect comes from `computeFreeRect` (header bottom, peek clamp, dock width);
             *   - the offset is the GENERALISED two-axis lens shift `W/2 - cx`, `H/2 - cy`;
             *   - `dFit = dContain` (no ceiling clamp) and `controls.maxDistance = max(5, 1.25·dContain)`.
             *
             * Everything else — the fit's distance channel, `userZoomed`, the probe — is the desktop code, moved
             * wholesale rather than reimplemented.
             */
            const w = size.width;
            const h = size.height;
            const signal = getLayoutSignal();
            const mode = signal.mode;

            /* One fit per layout change, reused for both the offset and the distance. */
            const fit = computeMobileFit(mode, w, h, signal.headerBottom);
            const mobile = applyMobileOffset(
                camera,
                mobileOffset.current,
                mode,
                w,
                h,
                signal.headerBottom,
                () => asMobileFrame(fit, w, h),
            );
            const frame = mobile ?? asMobileFrame(fit, w, h);
            mobileCache.current = frame;

            /*
             * THE CEILING. Written every mobile frame, and cleared back to 5 on the desktop branch below — so a rotation
             * to desktop cannot leave a mobile `maxDistance` behind.
             */
            applyMaxDistance(controls, maxDistanceWritten, fit.dMaxMode);

            const offset = camera.position.clone().sub(controls.target);
            const currentDistance = offset.length();

            if (lastFit.current === null) lastFit.current = currentDistance;
            lastSeenDistance.current = currentDistance;

            const userZoomedMobile = machine.current.context.userZoomed;
            rigOwnsDistance.current = !userZoomedMobile;
            /*
             * A MODE CHANGE re-fits with no animation, and resets the "the user owns the distance" latch.
             *
             * The prompt's rule: on a rotation or resize the director re-fits, keeps the camera DIRECTION and the
             * selected region, and sets the distance to the new dFit if the view was default. `mobile` is non-null
             * exactly when the mode or the size or the header changed, which is the definition of a mode change — and
             * on that frame the fit takes the distance even if the user had zoomed, because a distance chosen for a
             * 390x844 portrait band is meaningless at 844x390.
             */
            const reFit = mobile !== null;
            /*
             * NINO-HARDEN B7: a mode/size change while a Niño box is framed RE-FLIES to the new free rect.
             *
             * A4 measured the defect: Nino 4 flown at 1280x720 then resized to 390x844 settled at 5.39548,
             * which is exactly `dFit` — the rig's own fit took the radius because the box flight had already
             * cleared itself on arrival, and nothing re-derived the box's distance for the new rect. 390x844
             * then 844x390 did the same (3.6211 -> 3.75534, again `dFit`).
             *
             * The flight is re-armed rather than the distance forced, so the DIRECTION is re-derived too
             * (same world aim, spin paused) and the same tween carries the camera to the new pose instead of
             * teleporting it. `activeNinoBoxId` is what makes this inert with no box framed: it is only
             * non-null between a box press and a box clear, so flag-off — where `focusNinoBox` is never
             * called — it is null on every frame and this branch cannot run.
             *
             * Placed BEFORE the distance channel below so `frameWantsDistance` sees the re-fit's own
             * `USER_ZOOM_RESET` semantics: the box distance is written by `runNinoFlyTo`, not by the fit, and
             * `reFit` still clears `userZoomed` exactly as it did before.
             */
            /*
             * NINO-HARDEN B7 + ADDENDUM (1) + (3): re-resolve the box flight when the free rect moves.
             *
             * Previously this branch re-fitted only on `reFit` (a mode or size change), which left two holes:
             * a drawer closing after the press never re-fitted (A2d: stale 1.45330 for a rect 102 pt narrower
             * than the settled one), and the desktop branch had no re-fit at all. `refitNinoForRect` keys on
             * the RECT, so a mode change and a drawer closing are the same event to it.
             *
             * Returns true when it re-armed the flight, and `frameWantsDistance` stands down for that frame so
             * the fit does not fight the tween for the radius.
             */
            const ninoRefit = refitNinoForRect({
                activeNinoBoxId,
                ninoFlight,
                ninoRect,
                camera,
                spinY: spin.current.y,
                free: frame.free,
                viewport: { w, h },
            });
            const frameWantsDistance =
                (!userZoomedMobile || reFit) && !ninoRefit;
            if (
                frameWantsDistance &&
                Math.abs(frame.dTarget - currentDistance) > 1e-6
            ) {
                const k =
                    reFit || prefersReducedMotion()
                        ? 1
                        : 1 - Math.exp(-stepDt / FRAME_TIME_CONSTANT_S);
                const wanted = THREE.MathUtils.clamp(
                    frame.dTarget,
                    controls.minDistance,
                    controls.maxDistance,
                );
                const eased = THREE.MathUtils.lerp(currentDistance, wanted, k);
                const nextDistance =
                    Math.abs(wanted - eased) < 1e-5 ? wanted : eased;
                withOwnWrite(() => {
                    camera.position
                        .copy(controls.target)
                        .add(offset.setLength(nextDistance));
                    controls.update();
                });
                lastFit.current = nextDistance;
                lastSeenDistance.current = nextDistance;
            }
            if (reFit) dispatch({ type: "USER_ZOOM_RESET" });

            {
                const dir = orbitDirection(camera, controls);
                const d = orbitDistance(camera, controls);
                const viewIsDefault =
                    state === "idle" &&
                    !userZoomedMobile &&
                    angleDegBetween(dir, DEFAULT_DIRECTION) <=
                        VIEW_DEFAULT_ANGLE_DEG &&
                    Math.abs(d - frame.dTarget) <= VIEW_DEFAULT_DISTANCE;
                publishViewState({
                    viewIsDefault,
                    spinning: !spin.current.paused,
                    hasRegion: machine.current.context.regionId !== null,
                });
            }

            if (probe) {
                const camDistance = camera.position.distanceTo(controls.target);
                const recent = recentDistances.current;
                recent.push(camDistance);
                if (recent.length > 4) recent.shift();
                let lo = Infinity;
                let hi = -Infinity;
                for (const v of recent) {
                    if (v < lo) lo = v;
                    if (v > hi) hi = v;
                }
                const spread = recent.length < 4 ? Infinity : hi - lo;
                const distanceQuiet = spread < 2e-4;
                const distanceArrived =
                    Math.abs(frame.dTarget - camDistance) < 0.0005;
                const distanceSettled = rigOwnsDistance.current
                    ? distanceArrived && distanceQuiet
                    : distanceQuiet;

                probe.current = {
                    state: {
                        mode: "live",
                        insets: {
                            left: frame.free.x,
                            right: w - (frame.free.x + frame.free.w),
                            top: frame.free.y,
                            bottom: h - (frame.free.y + frame.free.h),
                        },
                        free: { ...frame.free },
                        target: {
                            dx: frame.dx,
                            dy: frame.dy,
                            d: frame.dTarget,
                        },
                        current: { dx: frame.dx, dy: frame.dy, d: camDistance },
                        settled: distanceSettled,
                        degenerate: frame.degenerate,
                        cameraViewIsNull:
                            camera.view === null ||
                            camera.view.enabled === false,
                        focus: machine.current.state,
                        userZoomed: userZoomedMobile,
                        regionId: machine.current.context.regionId,
                        viewIsDefault: getViewState().viewIsDefault,
                        spinning: getViewState().spinning,
                        hasRegion: getViewState().hasRegion,
                        focusPolicy: "live",
                        layoutMode: mode,
                        viewOffsetY: frame.viewOffsetY,
                        viewOffsetX: frame.viewOffsetX,
                        clampedByMax: frame.clampedByMax,
                        dMax: controls.maxDistance,
                        dFit: fit.dFit,
                        radiusBudget: fit.rect.radiusBudget,
                        headerBottom: signal.headerBottom,
                    },
                };
            }
        } else {
            const w = size.width;
            const h = size.height;
            const insets = getInsets();

            /*
             * Any frame at desktop size CLEARS a mobile offset this module installed earlier. Idempotent: the
             * applier returns immediately when the mode and size are already desktop's, and it only calls
             * `clearViewOffset` when `camera.view` is actually non-null — so on an ordinary desktop frame this is
             * one comparison and nothing else, which is what keeps `cameraViewIsNull` true and S1 at 0.
             */
            applyMobileOffset(
                camera,
                mobileOffset.current,
                "desktop",
                w,
                h,
                0,
                () => mobileCache.current as MobileFrame,
            );
            mobileCache.current = null;
            /*
             * THE CEILING, restored. A page that was a phone keeps `max(5, 1.25·dContain)` in `controls.maxDistance`
             * until this runs, and leaving it would let a desktop user zoom out past the design ceiling — a desktop
             * behaviour change, which is exactly what this step must not cause. Same constant the JSX prop holds.
             */
            applyMaxDistance(controls, maxDistanceWritten, MAX_DISTANCE);

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
                const k = 1 - Math.exp(-stepDt / FRAME_TIME_CONSTANT_S);
                nextDx =
                    easedOffset.current.dx +
                    (frame.dx - easedOffset.current.dx) * k;
                nextDy =
                    easedOffset.current.dy +
                    (frame.dy - easedOffset.current.dy) * k;
                if (Math.abs(frame.dx - nextDx) < OFFSET_EPSILON_PX)
                    nextDx = frame.dx;
                if (Math.abs(frame.dy - nextDy) < OFFSET_EPSILON_PX)
                    nextDy = frame.dy;
            }
            easedOffset.current = { dx: nextDx, dy: nextDy };

            const moved =
                Math.abs(nextDx - appliedOffset.current.dx) >
                    OFFSET_EPSILON_PX ||
                Math.abs(nextDy - appliedOffset.current.dy) > OFFSET_EPSILON_PX;
            const resized =
                appliedSize.current.w !== w || appliedSize.current.h !== h;

            if (moved || resized || first) {
                /* NEGATIVE offsets: a negative window offset moves the content right/down. */
                camera.setViewOffset(w, h, -nextDx, -nextDy, w, h);
                appliedOffset.current = { dx: nextDx, dy: nextDy };
                appliedSize.current = { w, h };
                hasApplied.current = true;
            }

            /* ---------------------------------------------------------------- distance */
            /*
             * THE FIT'S DISTANCE CHANNEL — AM1.
             *
             * It runs in EVERY state, not only `idle`/`returning`: while `userZoomed` is false it follows
             * `d_fit` of the CURRENT free rect, in both directions, floor `d0` ceiling `dMax`, 180 ms ease,
             * snap on first application. That is exactly what 3A2 shipped, and it is what lets the drawer
             * opening mid-flight zoom the camera OUT to the new containment distance while the arc runs
             * (1440x900: 3.7786 -> 4.3572). It cannot move the DIRECTION, so it cannot disturb the face-pin
             * aim, and the live fly-to never writes the distance, so the two channels never fight.
             *
             * When `userZoomed` is true the fit writes nothing here and containment is not asserted.
             */
            const offset = camera.position.clone().sub(controls.target);
            const currentDistance = offset.length();

            if (lastFit.current === null) lastFit.current = currentDistance;
            lastSeenDistance.current = currentDistance;

            const userZoomed = machine.current.context.userZoomed;
            rigOwnsDistance.current = !userZoomed;
            /*
             * NINO-HARDEN B7 on DESKTOP. The mobile branch had a re-fit and this one had none, so a desktop
             * resize while a box was framed left the box at the previous viewport's distance (A4 measured
             * 2.44644 -> 5.39548, exactly `dFit`, because the fit took the radius unopposed).
             *
             * Same helper as mobile: it keys on the free RECT, so it fires for a viewport change, a drawer
             * closing or a mode change, and it is inert when no box is selected (`activeNinoBoxId` is null on
             * every frame flag-off). While it holds a re-armed flight this frame, the fit's distance channel
             * below must not also write the radius.
             */
            const ninoRefitDesktop = refitNinoForRect({
                activeNinoBoxId,
                ninoFlight,
                ninoRect,
                camera,
                spinY: spin.current.y,
                free: frame.free,
                viewport: { w, h },
            });
            if (
                !userZoomed &&
                !ninoRefitDesktop &&
                Math.abs(frame.dTarget - currentDistance) > 1e-6
            ) {
                const k =
                    first || reduced
                        ? 1
                        : 1 - Math.exp(-stepDt / FRAME_TIME_CONSTANT_S);
                const wanted = THREE.MathUtils.clamp(
                    frame.dTarget,
                    controls.minDistance,
                    controls.maxDistance,
                );
                const eased = THREE.MathUtils.lerp(currentDistance, wanted, k);
                const nextDistance =
                    Math.abs(wanted - eased) < 1e-5 ? wanted : eased;
                withOwnWrite(() => {
                    camera.position
                        .copy(controls.target)
                        .add(offset.setLength(nextDistance));
                    controls.update();
                });
                lastFit.current = nextDistance;
                lastSeenDistance.current = nextDistance;
            }

            /* ----------------------------------------------------- viewIsDefault and spin */
            /*
             * Published OUTSIDE the probe gate, so a production build (which installs no probe) still drives
             * the Reset button. Computed here rather than at the top of the frame because it needs the fit's
             * `frame.dTarget`, which only the live half computes.
             *
             * A store rather than React state: this runs at 60 Hz and `publishViewState` drops a no-change
             * write, so the header only re-renders when one of the two booleans actually moves.
             */
            {
                const dir = orbitDirection(camera, controls);
                const d = orbitDistance(camera, controls);
                const viewIsDefault =
                    state === "idle" &&
                    !userZoomed &&
                    angleDegBetween(dir, DEFAULT_DIRECTION) <=
                        VIEW_DEFAULT_ANGLE_DEG &&
                    Math.abs(d - frame.dTarget) <= VIEW_DEFAULT_DISTANCE;
                /*
                 * `hasRegion` is carried from the machine so this frame's publish cannot CLEAR a selection flag
                 * that `GlobeScene` set a moment earlier (step 3B2-FIX1 B). It reads the SAME fact the app's
                 * `activeRegion` prop expresses — the machine's `regionId` — so the two writers cannot disagree
                 * for longer than the frame in which a selection is being handed over.
                 */
                publishViewState({
                    viewIsDefault,
                    spinning: !spin.current.paused,
                    hasRegion: machine.current.context.regionId !== null,
                });
            }

            /* ------------------------------------------------------------------- probe */

            if (probe) {
                const camDistance = camera.position.distanceTo(controls.target);
                const dx = easedOffset.current.dx;
                const dy = easedOffset.current.dy;
                const pxError = Math.max(
                    Math.abs(frame.dx - dx),
                    Math.abs(frame.dy - dy),
                );

                const recent = recentDistances.current;
                recent.push(camDistance);
                if (recent.length > 4) recent.shift();
                /* A fold, not `Math.max(...recent)`: the source guard forbids an unbounded spread. */
                let lo = Infinity;
                let hi = -Infinity;
                for (const v of recent) {
                    if (v < lo) lo = v;
                    if (v > hi) hi = v;
                }
                const spread = recent.length < 4 ? Infinity : hi - lo;
                const distanceQuiet = spread < 2e-4;
                const distanceArrived =
                    Math.abs(frame.dTarget - camDistance) < 0.0005;
                const distanceSettled = rigOwnsDistance.current
                    ? distanceArrived && distanceQuiet
                    : distanceQuiet;

                probe.current = {
                    state: {
                        mode: "live",
                        insets: { ...insets },
                        free: { ...frame.free },
                        target: {
                            dx: frame.dx,
                            dy: frame.dy,
                            d: frame.dTarget,
                        },
                        current: { dx, dy, d: camDistance },
                        settled: pxError < 0.05 && distanceSettled,
                        degenerate: frame.degenerate,
                        cameraViewIsNull:
                            camera.view === null ||
                            camera.view.enabled === false,
                        /* Step 3B additions — the machine's state, visible so a spec can poll it. */
                        focus: machine.current.state,
                        userZoomed,
                        regionId: machine.current.context.regionId,
                        /* Step 3B2 additions. */
                        viewIsDefault: getViewState().viewIsDefault,
                        spinning: getViewState().spinning,
                        hasRegion: getViewState().hasRegion,
                        focusPolicy: "live",
                        /** Desktop's ceiling, reported so LM8 can assert 5 without reading the controls. */
                        dMax: controls.maxDistance,
                    },
                };
            }
        }
    });

    return null;
}
