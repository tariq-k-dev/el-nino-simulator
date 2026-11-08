/**
 * The intent channel between the E2E hook and the `CameraDirector`.
 *
 * ## Why this indirection exists
 *
 * `src/lib/globeProbe.ts` is installed in `onCreated`, long before the scene's children have mounted,
 * and it has no way to hold a React ref. Before 3B it wrote `camera.position` itself — which made it
 * the second of six camera writers. Now it SUBMITS: it hands a pose to whatever is registered here,
 * and only the director writes.
 *
 * ## Why a module-level slot rather than a prop or context
 *
 * The probe is not a React component: it is a plain object built in `onCreated`. A module-level
 * setter is the smallest mechanism that reaches it, and it is the same shape `scene/globeLook.ts`
 * already uses (a module-scope store the probe calls directly from `page.evaluate`).
 *
 * ## Why the write is synchronous
 *
 * `setPose` runs the camera assignment in the caller's task, not on the next `useFrame`. The old
 * `setCamera` resolved on the second `requestAnimationFrame`; deferring the write by one frame would
 * have moved every probe-driven pose one frame later and put `ref.spec.ts`'s strict-0 comparison at
 * risk. Synchronous here, with the director still doing the actual assignment, keeps both properties.
 */

/** A complete camera pose. `target` is the orbit aim point, so `lookAt` and the controls agree. */
export interface CameraPose {
    position: [number, number, number];
    target: [number, number, number];
}

export interface CameraIntents {
    /** Park the camera at `pose`. Synchronous; returns nothing to await. */
    setPose(pose: CameraPose): void;
    /**
     * Fly to a Niño box by id (step 2.3c-1, C2). `null` clears the selection and returns to default.
     *
     * A separate entry point rather than a pose, because the framing depends on the live aspect and
     * the flight must use the EXISTING tween: the caller supplies only WHICH box, and the director
     * derives the aim point and the distance from `ninoFraming` at the moment the flight starts.
     */
    focusNinoBox(boxId: string | null): void;
}

let registered: CameraIntents | null = null;

/** Called by the director on mount (and with `null` on unmount). */
export function registerCameraIntents(intents: CameraIntents | null): void {
    registered = intents;
}

/**
 * Submit a pose. A no-op before the director mounts, which is what the probe's "wait two rAFs"
 * behaviour already implied: the camera is not written until a director exists to write it.
 */
export function submitPose(pose: CameraPose): void {
    registered?.setPose(pose);
}

/** True once a director is registered — lets a probe or a test assert the channel is live. */
export function hasCameraIntents(): boolean {
    return registered !== null;
}

/**
 * Submit a Niño box focus. A no-op before the director mounts, like `submitPose`.
 *
 * Separate wrapper so callers never reach into `registered` and do not have to know the channel's
 * shape; `null` is the clear/return-to-default request.
 */
export function submitNinoFocus(boxId: string | null): void {
    registered?.focusNinoBox(boxId);
}
