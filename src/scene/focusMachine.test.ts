import { describe, expect, it } from "vitest";
import {
    FOCUS_EVENTS,
    FOCUS_STATES,
    type FocusContext,
    type FocusEvent,
    type FocusSnapshot,
    type FocusState,
    initialFocus,
    isTravelling,
    step,
} from "./focusMachine";

/**
 * The focus machine's table, asserted as a TABLE.
 *
 * The point of this file is not to test the rules one by one — it is to prove the machine is TOTAL.
 * The first block walks all 4 states x all 8 events and asserts a defined result for every pair, so
 * an event added without a rule fails here rather than throwing at 60 fps inside a canvas. The rest
 * pins each named rule with the specific expectation the prompt states.
 */

/** A context that has already selected something, so `regionId` is not trivially null. */
const CONTEXT: FocusContext = {
    regionId: "pacific",
    userZoomed: false,
    orbitedDuringFocus: false,
    poseRef: { id: "pose-1" },
};

/** A snapshot in `state`, with the shared context. */
function at(
    state: FocusState,
    context: Partial<FocusContext> = {},
): FocusSnapshot {
    return { state, context: { ...CONTEXT, ...context } };
}

/** Events with their payloads, one per axis member, so the cross product is real. */
function eventOf(type: FocusEvent["type"]): FocusEvent {
    switch (type) {
        case "SELECT":
            return { type: "SELECT", regionId: "us-west" };
        case "ARRIVED":
        case "CLOSE":
        case "RETURNED":
        case "USER_ZOOM":
        case "USER_ZOOM_RESET":
        case "USER_ORBIT_START":
        case "RESET":
        case "FRAME_CHANGED":
            return { type } as FocusEvent;
        default: {
            // Exhaustiveness: adding an event to the union without a case here fails to compile.
            const never: never = type;
            throw new Error(`unhandled event ${String(never)}`);
        }
    }
}

describe("focus machine — totality", () => {
    it("every state x every event returns a defined snapshot (4 x 9)", () => {
        let pairs = 0;
        for (const state of FOCUS_STATES) {
            for (const type of FOCUS_EVENTS) {
                const before = at(state);
                const after = step(before, eventOf(type));
                expect(
                    after,
                    `${state} + ${type} must return a snapshot`,
                ).toBeDefined();
                expect(
                    FOCUS_STATES,
                    `${state} + ${type} must return a known state`,
                ).toContain(after.state);
                expect(
                    after.context,
                    `${state} + ${type} must return a context`,
                ).toBeDefined();
                pairs += 1;
            }
        }
        /*
         * 4 states x 9 events. The count is asserted rather than derived so that ADDING an event without adding it to
         * this file's switch is a visible edit here too — step MOBILE2 added `USER_ZOOM_RESET`, which took it from 32.
         */
        expect(pairs).toBe(36);
    });

    it("never throws on any pair", () => {
        for (const state of FOCUS_STATES) {
            for (const type of FOCUS_EVENTS) {
                expect(
                    () => step(at(state), eventOf(type)),
                    `${state} + ${type}`,
                ).not.toThrow();
            }
        }
    });

    it("is pure: the input snapshot is not mutated", () => {
        for (const state of FOCUS_STATES) {
            for (const type of FOCUS_EVENTS) {
                const before = at(state);
                const frozen = JSON.stringify(before);
                step(before, eventOf(type));
                expect(JSON.stringify(before), `${state} + ${type}`).toBe(
                    frozen,
                );
            }
        }
    });

    it("returns the same object when nothing changes", () => {
        const before = at("idle");
        expect(step(before, { type: "ARRIVED" })).toBe(before);
        expect(step(before, { type: "CLOSE" })).toBe(before);
        expect(step(before, { type: "RETURNED" })).toBe(before);
    });
});

describe("focus machine — the named rules", () => {
    it("idle + SELECT -> focusing with that region", () => {
        const after = step(initialFocus(), {
            type: "SELECT",
            regionId: "pacific",
        });
        expect(after.state).toBe("focusing");
        expect(after.context.regionId).toBe("pacific");
    });

    it("focusing + ARRIVED -> focused", () => {
        const after = step(at("focusing"), { type: "ARRIVED" });
        expect(after.state).toBe("focused");
    });

    it("ARRIVED outside focusing does nothing", () => {
        for (const state of ["idle", "focused", "returning"] as const) {
            const before = at(state);
            expect(step(before, { type: "ARRIVED" }), state).toBe(before);
        }
    });

    it("focusing or focused + SELECT(other) -> focusing, retargeted", () => {
        for (const state of ["focusing", "focused"] as const) {
            const after = step(at(state), {
                type: "SELECT",
                regionId: "horn-africa",
            });
            expect(after.state, state).toBe("focusing");
            expect(after.context.regionId, state).toBe("horn-africa");
        }
    });

    it("retarget keeps the previous pose reference", () => {
        const before = at("focused", { poseRef: { id: "pose-1" } });
        const after = step(before, { type: "SELECT", regionId: "se-asia" });
        // Identity, not deep equality: the director holds this reference to interpolate FROM.
        expect(after.context.poseRef).toBe(before.context.poseRef);
    });

    it("retarget from returning also preserves the pose reference and clears the orbit flag", () => {
        const before = at("returning", {
            poseRef: { id: "pose-2" },
            orbitedDuringFocus: true,
        });
        const after = step(before, { type: "SELECT", regionId: "us-west" });
        expect(after.state).toBe("focusing");
        expect(after.context.poseRef).toBe(before.context.poseRef);
        expect(after.context.orbitedDuringFocus).toBe(false);
    });

    it("focusing or focused + CLOSE -> returning", () => {
        for (const state of ["focusing", "focused"] as const) {
            expect(step(at(state), { type: "CLOSE" }).state, state).toBe(
                "returning",
            );
        }
    });

    it("CLOSE outside a selection does nothing", () => {
        for (const state of ["idle", "returning"] as const) {
            const before = at(state);
            expect(step(before, { type: "CLOSE" }), state).toBe(before);
        }
    });

    it("SELECT(null) is the pointer-miss path and behaves as CLOSE", () => {
        expect(
            step(at("focused"), { type: "SELECT", regionId: null }).state,
        ).toBe("returning");
        expect(
            step(at("focusing"), { type: "SELECT", regionId: null }).state,
        ).toBe("returning");
        const idle = at("idle");
        expect(step(idle, { type: "SELECT", regionId: null })).toBe(idle);
    });

    it("returning + RETURNED -> idle with no region", () => {
        const after = step(at("returning"), { type: "RETURNED" });
        expect(after.state).toBe("idle");
        expect(after.context.regionId).toBeNull();
    });

    it("RETURNED outside returning does nothing", () => {
        for (const state of ["idle", "focusing", "focused"] as const) {
            const before = at(state);
            expect(step(before, { type: "RETURNED" }), state).toBe(before);
        }
    });

    it("focusing + USER_ORBIT_START -> focused, fly cancelled, flag set", () => {
        const after = step(at("focusing"), { type: "USER_ORBIT_START" });
        expect(after.state).toBe("focused");
        expect(after.context.orbitedDuringFocus).toBe(true);
    });

    it("USER_ORBIT_START outside focusing records the flag and does not move", () => {
        for (const state of ["idle", "focused", "returning"] as const) {
            const after = step(at(state), { type: "USER_ORBIT_START" });
            expect(after.state, state).toBe(state);
            expect(after.context.orbitedDuringFocus, state).toBe(true);
        }
    });

    it("USER_ZOOM sets userZoomed in all four states and changes no state", () => {
        for (const state of FOCUS_STATES) {
            const after = step(at(state), { type: "USER_ZOOM" });
            expect(after.state, state).toBe(state);
            expect(after.context.userZoomed, state).toBe(true);
        }
    });

    it("RESET -> returning and clears userZoomed, from all four states", () => {
        for (const state of FOCUS_STATES) {
            const after = step(at(state, { userZoomed: true }), {
                type: "RESET",
            });
            expect(after.state, state).toBe("returning");
            expect(after.context.userZoomed, state).toBe(false);
        }
    });

    it("FRAME_CHANGED never changes state, in all four states", () => {
        for (const state of FOCUS_STATES) {
            const before = at(state);
            expect(step(before, { type: "FRAME_CHANGED" }), state).toBe(before);
        }
    });

    it("any other pair returns the same state", () => {
        // The pairs the table above does not name, asserted explicitly so "same state" is a claim.
        const pairs: Array<[FocusState, FocusEvent["type"]]> = [];
        for (const state of FOCUS_STATES) {
            for (const type of FOCUS_EVENTS) {
                const changes =
                    type === "SELECT" ||
                    (type === "ARRIVED" && state === "focusing") ||
                    (type === "CLOSE" &&
                        (state === "focusing" || state === "focused")) ||
                    (type === "RETURNED" && state === "returning") ||
                    (type === "USER_ORBIT_START" && state === "focusing") ||
                    type === "RESET";
                if (!changes) pairs.push([state, type]);
            }
        }
        for (const [state, type] of pairs) {
            expect(
                step(at(state), eventOf(type)).state,
                `${state} + ${type}`,
            ).toBe(state);
        }
        expect(pairs.length).toBeGreaterThan(0);
    });
});

describe("focus machine — helpers", () => {
    it("isTravelling is true exactly for focusing and returning", () => {
        expect(FOCUS_STATES.filter(isTravelling)).toEqual([
            "focusing",
            "returning",
        ]);
    });

    it("initialFocus is idle with a clean context and no region", () => {
        const s = initialFocus();
        expect(s.state).toBe("idle");
        expect(s.context.regionId).toBeNull();
        expect(s.context.userZoomed).toBe(false);
        expect(s.context.orbitedDuringFocus).toBe(false);
    });

    it("a SELECT/ARRIVED/CLOSE/RETURNED cycle ends where it started", () => {
        let s = initialFocus();
        s = step(s, { type: "SELECT", regionId: "pacific" });
        s = step(s, { type: "ARRIVED" });
        s = step(s, { type: "CLOSE" });
        s = step(s, { type: "RETURNED" });
        expect(s.state).toBe("idle");
        expect(s.context.regionId).toBeNull();
    });
});

/**
 * Step 3B2 — the `userZoomed` semantics that changed.
 *
 * The flag used to mean "the fit must not write the distance", and anything that moved the distance
 * (including the live fly-to) set it. It now means what its name says: the USER moved the distance.
 * The live fly-to writes no distance at all, so the only writers left are the wheel/pinch (USER_ZOOM)
 * and RESET, which clears it. These cases pin that from the machine's side — the director's side
 * (that the live fly-to never dispatches USER_ZOOM) is what `singleWriter`/`frame-director` cover.
 */
describe("focus machine — userZoomed semantics (3B2)", () => {
    it("CLOSE does not clear userZoomed: a zoomed close keeps the zoomed distance", () => {
        const zoomed = at("focused", { userZoomed: true });
        const returning = step(zoomed, { type: "CLOSE" });
        expect(returning.state).toBe("returning");
        expect(returning.context.userZoomed).toBe(true);
    });

    it("RESET clears userZoomed from every state, including focused and returning", () => {
        for (const state of FOCUS_STATES) {
            const cleared = step(at(state, { userZoomed: true }), {
                type: "RESET",
            });
            expect(cleared.state, state).toBe("returning");
            expect(cleared.context.userZoomed, state).toBe(false);
            expect(cleared.context.regionId, state).toBeNull();
        }
    });

    it("RESET then USER_ZOOM re-latches the flag (a zoom during the return still wins)", () => {
        let s = step(at("focused", { userZoomed: true }), { type: "RESET" });
        expect(s.context.userZoomed).toBe(false);
        s = step(s, { type: "USER_ZOOM" });
        expect(s.state).toBe("returning");
        expect(s.context.userZoomed).toBe(true);
    });

    it("a full close cycle leaves userZoomed false when it started false", () => {
        let s = step(initialFocus(), { type: "SELECT", regionId: "pacific" });
        s = step(s, { type: "ARRIVED" });
        expect(s.context.userZoomed).toBe(false);
        s = step(s, { type: "CLOSE" });
        s = step(s, { type: "RETURNED" });
        expect(s.state).toBe("idle");
        expect(s.context.userZoomed).toBe(false);
    });

    it("USER_ZOOM is idempotent and allocates nothing the second time", () => {
        const once = step(at("idle"), { type: "USER_ZOOM" });
        const twice = step(once, { type: "USER_ZOOM" });
        expect(twice).toBe(once);
    });
});
