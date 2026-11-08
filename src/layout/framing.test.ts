import { describe, expect, it } from "vitest";
import {
    D0,
    FRAME_TIME_CONSTANT_S,
    IS_LOCKED,
    LAST_FIT_EPSILON,
    MAX_DISTANCE,
    OFFSET_EPSILON_PX,
    PIN_ENVELOPE,
    resolveFramingMode,
} from "./framing";
import { FRAME_PADDING_PX } from "./frame";

/*
 * Mode resolution is the one piece of 3A2 whose failure mode is silent in BOTH directions:
 *
 *  - a production build that resolves to `locked` ships a globe with no framing at all, and
 *  - an E2E run that resolves to `live` when it did not ask for it moves the camera under specs
 *    that assert exact pixels, turning the whole look suite red for a reason that looks like a
 *    rendering regression.
 *
 * So the table is enumerated here rather than described in a comment.
 */
describe("resolveFramingMode", () => {
    it("is ALWAYS live in a production build", () => {
        expect(resolveFramingMode("", false)).toBe("live");
        expect(resolveFramingMode("?framing=live", false)).toBe("live");
        // Even a URL that says otherwise: production has no mode to choose, only one branch ships.
        expect(resolveFramingMode("?framing=locked", false)).toBe("live");
    });

    it("is locked in an E2E build with no parameter", () => {
        expect(resolveFramingMode("", true)).toBe("locked");
        expect(resolveFramingMode("?", true)).toBe("locked");
        expect(resolveFramingMode("?debug", true)).toBe("locked");
    });

    it("is live in an E2E build when asked", () => {
        expect(resolveFramingMode("?framing=live", true)).toBe("live");
        expect(resolveFramingMode("?debug&framing=live", true)).toBe("live");
        expect(resolveFramingMode("?framing=live&debug", true)).toBe("live");
    });

    it('fails closed on anything that is not exactly "live"', () => {
        // A typo must measure the shipped look and say so, not measure a new framing silently.
        for (const search of [
            "?framing=LIVE",
            "?framing=true",
            "?framing=1",
            "?framing=",
            "?framing",
        ]) {
            expect(resolveFramingMode(search, true), search).toBe("locked");
        }
    });
});

describe("the framing constants", () => {
    it("d0 is the shipped camera distance, to the fourth decimal", () => {
        // sqrt(0^2 + 1.15^2 + 3.15^2) = 3.3533565...; the product ships "3.3534".
        expect(D0).toBeCloseTo(3.3534, 4);
        expect(D0).toBeGreaterThan(3.3533);
    });

    it("the pin envelope is 1.10242 R", () => {
        // anchorRadius 1.012 * idleLift 1.035 + coreOffset 0.055, from GLOBE_LOOK.
        expect(PIN_ENVELOPE).toBeCloseTo(1.10242, 5);
    });

    it("the fit ceiling is the OrbitControls maxDistance, above d0", () => {
        expect(MAX_DISTANCE).toBe(5);
        expect(MAX_DISTANCE).toBeGreaterThan(D0);
    });

    it("the tolerances are the documented ones, and are not zero", () => {
        expect(FRAME_PADDING_PX).toBe(24);
        expect(FRAME_TIME_CONSTANT_S).toBeCloseTo(0.18, 9);
        expect(OFFSET_EPSILON_PX).toBeCloseTo(0.01, 9);
        /*
         * 0.002 must sit between one wheel notch (~0.01 at d0) and float noise from
         * `OrbitControls.update()` (measured well under 1e-6). Stated as a range so a future edit that
         * "rounds it up" to something that swallows a notch fails here instead of in F6.
         */
        expect(LAST_FIT_EPSILON).toBeGreaterThan(1e-4);
        expect(LAST_FIT_EPSILON).toBeLessThan(0.01);
    });

    it("is not locked under vitest, where VITE_E2E is undefined", () => {
        // `IS_LOCKED` folds on `import.meta.env.VITE_E2E === '1'`; the unit-test run does not set it.
        expect(IS_LOCKED).toBe(false);
    });
});
