import { describe, expect, it } from "vitest";
import {
    BACK_EDGE,
    FRONT_EDGE,
    PIN_HIT_CLAMP_R,
    PIN_HIT_GATE,
    HIT_PX,
    HIT_PX_COARSE,
    NEAREST_PIN_PAIR_R,
    pinFacesCamera,
} from "@/scene/pinVisibilityBands";

/**
 * The gate, tested against the band edges it is derived from (step 3B2-FIX2-CONT A2/A4).
 *
 * The point of these tests is not that a dot product works. It is that the ONE number the product gate
 * reads sits strictly between the two numbers the acceptance spec asserts, and that the answer depends
 * on the facing value alone — not on camera distance, not on the pin's radius, not on where the globe
 * happens to be. The distance-dependence of the rejected design is what the audit measured at
 * 20/23 front rows.
 */

/** A camera at distance `D` from `centre`, on the unit direction whose dot with +Z is exactly `f`. */
function cameraAt(
    f: number,
    D: number,
    centre: [number, number, number] = [0, 0, 0],
) {
    const theta = Math.acos(Math.max(-1, Math.min(1, f)));
    return {
        x: centre[0] + D * Math.sin(theta),
        y: centre[1],
        z: centre[2] + D * Math.cos(theta),
    };
}

const Z = { x: 0, y: 0, z: 1 };

describe("pinVisibilityBands constants", () => {
    it("states the band edges the pin-click spec asserts", () => {
        expect(FRONT_EDGE).toBe(0.15);
        expect(BACK_EDGE).toBe(0);
    });

    it("derives the gate as the midpoint and keeps it strictly inside the bands", () => {
        expect(PIN_HIT_GATE).toBeCloseTo((FRONT_EDGE + BACK_EDGE) / 2, 12);
        expect(PIN_HIT_GATE).toBeCloseTo(0.075, 12);
        expect(FRONT_EDGE).toBeGreaterThan(PIN_HIT_GATE);
        expect(PIN_HIT_GATE).toBeGreaterThan(BACK_EDGE);
    });

    it("states the coarse pointer radius and the overlap clamp consistently", () => {
        expect(HIT_PX_COARSE).toBeGreaterThan(HIT_PX);
        expect(PIN_HIT_CLAMP_R).toBeCloseTo(NEAREST_PIN_PAIR_R / 2, 12);
    });
});

describe("pinFacesCamera — A4(a) the facing table", () => {
    /*
     * The set is the prompt's own, and it deliberately includes both sides of every boundary that
     * matters: 0.15 (the front edge), 0 (the back edge), and the two distances the audit quotes
     * (`d_fit` 3.77857 -> rb/D 0.27720, `dMax` 5 -> 0.20948), which are here to prove the gate no
     * longer moves with them.
     */
    const rows: Array<[number, boolean, string]> = [
        [0.9, true, "dead-on front"],
        [0.2772, true, "the old gate at d_fit — admitted"],
        [0.20948, true, "the old gate at dMax — admitted"],
        [
            FRONT_EDGE,
            true,
            "the front edge itself is inclusive on the hit side",
        ],
        [0.05, false, "grazing, below the gate"],
        [BACK_EDGE, false, "the back edge itself is not a hit"],
        [-0.05, false, "just past the back edge"],
        [-0.15, false, "back"],
        [-0.9, false, "far side"],
    ];

    for (const [f, expected, why] of rows) {
        it(`facing ${f} -> ${expected} (${why})`, () => {
            expect(
                pinFacesCamera(Z, cameraAt(f, 3.77857), { x: 0, y: 0, z: 0 }),
            ).toBe(expected);
        });
    }

    it("prints the table it asserted", () => {
        for (const [f, expected, why] of rows) {
            const got = pinFacesCamera(Z, cameraAt(f, 3.77857), {
                x: 0,
                y: 0,
                z: 0,
            });
            console.log(
                `[A4] f ${String(f).padStart(8)} -> ${String(got).padEnd(5)} expected ${String(expected).padEnd(5)} ${why}`,
            );
            expect(got, why).toBe(expected);
        }
    });
});

describe("pinFacesCamera — A4(b) D-independence", () => {
    /*
     * The rejected gate was `n·u > rb/D`, so the same facing value flipped its verdict when the camera
     * moved. The replacement reads no distance at all, and this is the assertion that keeps it that way:
     * every facing value gives the SAME answer at all four distances, including 50 R (well past
     * `maxDistance`, where an rb/D gate would admit almost everything).
     */
    const distances = [1.5, 3.77857, 5, 50];

    for (const f of [0.9, 0.2772, 0.20948, 0.15, 0.075, 0.05, 0, -0.15, -0.9]) {
        it(`facing ${f} is distance-independent at D = ${distances.join(", ")}`, () => {
            const answers = distances.map((D) =>
                pinFacesCamera(Z, cameraAt(f, D), { x: 0, y: 0, z: 0 }),
            );
            console.log(
                `[A4:D] f ${String(f).padStart(8)} -> ${answers.map((a) => (a ? "T" : "F")).join(" ")} at D ${distances.join(" / ")}`,
            );
            expect(
                new Set(answers).size,
                `facing ${f} must not depend on distance`,
            ).toBe(1);
        });
    }

    it("reproduces the old gate’s distance-dependence as a contrast, so the two are distinguishable", () => {
        /* `n·u > rb/D` for rb 1.04742: true at D = 5 for f = 0.2772, false at D = 3.77857. The new gate
         * says true at both — the contrast is the point of the test, not a tolerance. */
        const oldGate = (f: number, D: number) => f > 1.04742 / D;
        expect(oldGate(0.2772, 5)).toBe(true);
        expect(oldGate(0.2772, 3.77857)).toBe(false);
        expect(
            pinFacesCamera(Z, cameraAt(0.2772, 5), { x: 0, y: 0, z: 0 }),
        ).toBe(true);
        expect(
            pinFacesCamera(Z, cameraAt(0.2772, 3.77857), { x: 0, y: 0, z: 0 }),
        ).toBe(true);
    });
});

describe("pinFacesCamera — A4(c) the globe is not at the world origin", () => {
    it("measures the camera direction from the globe centre, not from (0,0,0)", () => {
        const centre = { x: 4, y: -2, z: 7 };
        /* If the function used the world origin, this camera — 8 units away along +Z from a centre that
         * is itself off-axis — would read a completely different facing value. */
        expect(
            pinFacesCamera(
                Z,
                cameraAt(0.9, 3.77857, [centre.x, centre.y, centre.z]),
                centre,
            ),
        ).toBe(true);
        expect(
            pinFacesCamera(
                Z,
                cameraAt(-0.9, 3.77857, [centre.x, centre.y, centre.z]),
                centre,
            ),
        ).toBe(false);
    });
});

describe("pinFacesCamera — A4(d) a spun earth group", () => {
    it("answers the same for a pin and camera rotated together about Y", () => {
        for (const spin of [
            0,
            Math.PI / 6,
            Math.PI / 2,
            (2 * Math.PI) / 3,
            Math.PI,
        ]) {
            const c = Math.cos(spin);
            const s = Math.sin(spin);
            /* Rotate the normal the same way EarthSystem rotates the group. */
            const n = { x: 0 * c + 1 * s, y: 0, z: -0 * s + 1 * c };
            const u = {
                x: Math.sin(Math.acos(0.9)),
                y: 0,
                z: Math.cos(Math.acos(0.9)),
            };
            const cam = {
                x: 3.77857 * (u.x * c + u.z * s),
                y: 0,
                z: 3.77857 * (-u.x * s + u.z * c),
            };
            expect(
                pinFacesCamera(n, cam, { x: 0, y: 0, z: 0 }),
                `spin ${spin}`,
            ).toBe(true);
        }
    });

    it("refuses a pin that the spin has carried to the far side", () => {
        /* The same pin, spun 180 degrees, faces away — the gate must follow the spin, which is why the
         * product recomputes the normal from the group's world matrix at raycast time. */
        const spin = Math.PI;
        const n = {
            x: 0 * Math.cos(spin) + 1 * Math.sin(spin),
            y: 0,
            z: -0 * Math.sin(spin) + 1 * Math.cos(spin),
        };
        expect(
            pinFacesCamera(n, { x: 0, y: 0, z: 3.77857 }, { x: 0, y: 0, z: 0 }),
        ).toBe(false);
    });
});

describe("pinFacesCamera — A4(e) degenerate input", () => {
    it("returns false and does not throw when the camera sits at the globe centre", () => {
        const centre = { x: 1, y: 2, z: 3 };
        expect(() => pinFacesCamera(Z, centre, centre)).not.toThrow();
        expect(pinFacesCamera(Z, centre, centre)).toBe(false);
    });

    it("returns false for a zero-length normal rather than letting NaN decide", () => {
        expect(
            pinFacesCamera(
                { x: 0, y: 0, z: 0 },
                { x: 0, y: 0, z: 5 },
                { x: 0, y: 0, z: 0 },
            ),
        ).toBe(false);
    });
});
