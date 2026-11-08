/**
 * The focus state machine — a PURE, TOTAL reducer.
 *
 * ## Why this file exists
 *
 * The camera has six writers (`docs/STEP3B-DESIGN.md` §2) and no shared notion of "what the camera is
 * doing". Every question a spec or a reader might ask — is a fly-to in flight? did the user take the
 * camera back? is a close still animating? — is answered today by reading mutable refs that only
 * `CameraRig` and `FrameRig` know about. That is the thing this reducer replaces, and it replaces it
 * as data rather than as more refs: a state, a context, and one function from `(state, event)` to the
 * next pair.
 *
 * ## Totality is the contract
 *
 * `STEP` is defined for every one of the 4 states x 8 events, and the table test asserts that by
 * enumerating the cross product rather than by listing cases someone remembered. A combination with
 * no rule returns the SAME state and the SAME context object — no throw, no `undefined`. An unhandled
 * event in a camera machine must not be able to unmount a canvas, and a throw on a transition nobody
 * anticipated is exactly how that happens.
 *
 * ## Rules (step 3B, unchanged by the director)
 *
 * | from | event | to |
 * |---|---|---|
 * | idle | SELECT | focusing |
 * | focusing | ARRIVED | focused |
 * | focusing, focused | SELECT(other) | focusing, retargeted from the current pose |
 * | focusing, focused | CLOSE | returning |
 * | returning | RETURNED | idle |
 * | focusing | USER_ORBIT_START | focused (fly cancelled, `orbitedDuringFocus = true`) |
 * | any | USER_ZOOM | same state, `userZoomed = true` |
 * | any | RESET | returning, `userZoomed = false` |
 * | any | FRAME_CHANGED | same state |
 * | any other | — | same state |
 *
 * ## What it does NOT do
 *
 * It computes no camera pose and touches no THREE object. `userZoomed` is a flag here; the director
 * is what makes it gate the fit's distance channel, and what makes `returning` restore the default
 * pose. Keeping the geometry out is what makes the table testable without a browser.
 */

/** The four states. A union rather than an enum so a `switch` is exhaustive without a default. */
export type FocusState = "idle" | "focusing" | "focused" | "returning";

/** Exported so the table test can enumerate the state axis instead of retyping it. */
export const FOCUS_STATES: readonly FocusState[] = [
    "idle",
    "focusing",
    "focused",
    "returning",
];

/**
 * The events, as a discriminated union with their payloads.
 *
 * `SELECT` carries a `RegionId | null` because the app's own selection channel is nullable
 * (`App.tsx:29`, `onPointerMissed`). `SELECT(null)` is the pointer-miss path and is treated exactly
 * as `CLOSE` — see `step` below. Making it a separate event type would let a caller forget the null
 * case, which is how a click on empty space would leave the machine in `focused` forever.
 */
export type FocusEvent =
    | { type: "SELECT"; regionId: string | null }
    | { type: "ARRIVED" }
    | { type: "CLOSE" }
    | { type: "RETURNED" }
    | { type: "USER_ZOOM" }
    /**
     * Step MOBILE2: the fit has taken the distance back because the LAYOUT changed.
     *
     * Needed because a mode change intentionally overrides `userZoomed` — a distance chosen for a portrait band is
     * meaningless in landscape — and without clearing the flag the very next frame would hand the distance straight
     * back to the user's (now stale) zoom.
     */
    | { type: "USER_ZOOM_RESET" }
    | { type: "USER_ORBIT_START" }
    | { type: "RESET" }
    | { type: "FRAME_CHANGED" };

/** The event axis, for the exhaustiveness test. Payloads are supplied by the test's factory. */
export const FOCUS_EVENTS: readonly FocusEvent["type"][] = [
    "SELECT",
    "ARRIVED",
    "CLOSE",
    "RETURNED",
    "USER_ZOOM",
    "USER_ZOOM_RESET",
    "USER_ORBIT_START",
    "RESET",
    "FRAME_CHANGED",
];

export interface FocusContext {
    /** The region being flown to, focused on, or flown back from. `null` outside a selection. */
    regionId: string | null;
    /**
     * Has the user taken the distance channel back?
     *
     * The director uses this where `FrameRig` used `lastFit`: while it is false the fit may ease the
     * distance to `dFit`; once it is true the fit never touches the distance again until a `RESET`.
     * It does NOT gate the offset — a view offset is layout, and a wheel event must never un-centre
     * the globe.
     */
    userZoomed: boolean;
    /**
     * Did the user orbit away while the fly-to was still in flight?
     *
     * Recorded rather than acted on in this step. It is the fact a later step needs to decide whether
     * `ARRIVED` should still fire for a flight the user interrupted (they took the camera; the fly-to
     * stopped, so the machine is `focused` without ever arriving).
     */
    orbitedDuringFocus: boolean;
    /**
     * An opaque identity for the pose the machine is currently targeting.
     *
     * `undefined` until the first `SELECT`. The retarget rule must NOT replace it, which is what the
     * "retarget keeps the previous pose reference" test asserts: a retarget continues from where the
     * camera IS, so the pose it started from is still the one in hand.
     */
    poseRef?: object;
}

export interface FocusSnapshot {
    state: FocusState;
    context: FocusContext;
}

/** The initial snapshot: nothing selected, nothing touched. */
export function initialFocus(poseRef?: object): FocusSnapshot {
    return {
        state: "idle",
        context: {
            regionId: null,
            userZoomed: false,
            orbitedDuringFocus: false,
            poseRef,
        },
    };
}

/** True when the machine is in a state that should be animating a camera pose. */
export function isTravelling(state: FocusState): boolean {
    return state === "focusing" || state === "returning";
}

/**
 * One transition. Total: every `(state, event)` pair returns a snapshot.
 *
 * Returns the SAME `snapshot` object when nothing changes, so a caller can compare identity to decide
 * whether to publish — the same trick `getInsets()` uses to avoid re-renders.
 */
export function step(
    snapshot: FocusSnapshot,
    event: FocusEvent,
): FocusSnapshot {
    const { state, context } = snapshot;

    /*
     * `USER_ZOOM` and `FRAME_CHANGED` are checked FIRST, and out of order with the table, because they
     * are the two events that are legal in every state and must not be shadowed by a state-specific
     * rule. `FRAME_CHANGED` is deliberately a no-op: the layout moving is not a focus event, and if it
     * could change state then resizing the window during a fly-to would cancel the focus.
     */
    if (event.type === "USER_ZOOM") {
        if (context.userZoomed) return snapshot;
        return { state, context: { ...context, userZoomed: true } };
    }

    if (event.type === "USER_ZOOM_RESET") {
        if (!context.userZoomed) return snapshot;
        return { state, context: { ...context, userZoomed: false } };
    }
    if (event.type === "FRAME_CHANGED") return snapshot;

    /*
     * `RESET` clears the flag even when it is already false, and returns to `returning` from every
     * state including `idle`. From `idle` that means "fly back to the default pose", which is a real
     * animation (the camera may have been orbited or zoomed without ever selecting anything) — not a
     * no-op, and the director treats it as such.
     */
    if (event.type === "RESET") {
        return {
            state: "returning",
            context: { ...context, userZoomed: false, regionId: null },
        };
    }

    switch (event.type) {
        case "SELECT": {
            /*
             * `SELECT(null)` is the pointer-miss path (`GlobeScene.tsx:598`, `onPointerMissed`), i.e.
             * "deselect". Treating it as a region would put `regionId: null` into a `focusing` flight and
             * leave the machine animating a pose with no target, so it is routed to the close rule below.
             */
            if (event.regionId === null) return closeOrStay(snapshot);
            if (state === "focusing" || state === "focused") {
                /* Retarget from the current pose: same states, new region, pose reference PRESERVED. */
                return {
                    state: "focusing",
                    context: {
                        ...context,
                        regionId: event.regionId,
                        orbitedDuringFocus: false,
                    },
                };
            }
            /*
             * From `idle` and from `returning`. Cancelling a return to focus something else is the same
             * animation continued from wherever it had got to, so it re-enters `focusing` directly.
             */
            return {
                state: "focusing",
                context: {
                    ...context,
                    regionId: event.regionId,
                    orbitedDuringFocus: false,
                },
            };
        }

        case "ARRIVED":
            if (state === "focusing") return { state: "focused", context };
            return snapshot;

        case "CLOSE":
            return closeOrStay(snapshot);

        case "RETURNED":
            if (state === "returning") {
                return {
                    state: "idle",
                    context: {
                        ...context,
                        regionId: null,
                        orbitedDuringFocus: false,
                    },
                };
            }
            return snapshot;

        case "USER_ORBIT_START":
            /*
             * Only `focusing` is cancelled. In `focused` the user is orbiting a camera that has already
             * arrived, so the flag records the fact and the state does not move; in `returning` the same
             * applies to the way back, and cancelling there would strand the machine in `returning`
             * forever with no `ARRIVED` to complete it.
             */
            if (state === "focusing") {
                return {
                    state: "focused",
                    context: { ...context, orbitedDuringFocus: true },
                };
            }
            return { state, context: { ...context, orbitedDuringFocus: true } };

        default:
            /*
             * Unreachable for the union as written; kept so a future event added without a rule degrades to
             * "no change" instead of returning `undefined` through the exhaustiveness hole.
             */
            return snapshot;
    }
}

/**
 * The close rule, shared by `CLOSE` and `SELECT(null)`.
 *
 * `focusing` and `focused` go to `returning`. `idle` stays `idle` — closing something that was never
 * open must not start an animation back to a pose the camera is already at. `returning` stays
 * `returning` for the same reason in the other direction.
 */
function closeOrStay(snapshot: FocusSnapshot): FocusSnapshot {
    const { state, context } = snapshot;
    if (state === "focusing" || state === "focused") {
        return { state: "returning", context };
    }
    return snapshot;
}
