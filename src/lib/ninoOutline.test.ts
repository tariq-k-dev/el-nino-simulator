import { describe, expect, it } from "vitest";

import {
    NINO_OUTLINE_RADIUS,
    NINO_OUTLINE_RENDER_ORDER,
    NINO_OUTLINE_STEP_DEG,
    boxAnchor,
    boxCentreDirection,
    maxStepDegrees,
    ninoOutlineLoops,
    ninoOutlineVertices,
    radiusSpread,
} from "@/lib/ninoOutline";
import {
    NINO34_REFERENCE_BOX,
    NINO_BOXES,
    type NinoBox,
    boxLon360Ranges,
} from "@/lib/regions";

const ALL_BOXES: readonly NinoBox[] = [...NINO_BOXES, NINO34_REFERENCE_BOX];

/**
 * A box that genuinely yields TWO 0..360 ranges, written across the prime meridian.
 *
 * No shipped box does this — all three merged to a single range — so the two-range path is tested
 * against a synthetic box rather than left unexercised. `-10..10` becomes `[0, 10]` and
 * `[350, 360]`, which is the case where a naive builder would stitch range two's end back to range
 * one's start and draw a segment across the whole globe.
 */
const TWO_RANGE_BOX: NinoBox = {
    id: "nino4",
    label: "TEST TWO RANGE",
    latMin: -1,
    latMax: 1,
    lonWest: -10,
    lonEast: 10,
    anchorLat: 0,
    anchorLon: 0,
};

describe("outline constants", () => {
    it("draws above the glint overlay and below the cloud deck", () => {
        // SHELLS.overlay = 1.0012, SHELLS.clouds = 1.004 (src/scene/constants.ts).
        expect(NINO_OUTLINE_RADIUS).toBeGreaterThan(1.0012);
        expect(NINO_OUTLINE_RADIUS).toBeLessThan(1.004);
    });

    it("sits above the clouds in render order but below the pins", () => {
        // Globe.tsx ladder: surface 0, atmosphere 1, clouds 2, overlay 3, pins 6-8.
        expect(NINO_OUTLINE_RENDER_ORDER).toBeGreaterThanOrEqual(4);
        expect(NINO_OUTLINE_RENDER_ORDER).toBeLessThan(6);
    });

    it("samples at a one degree step", () => {
        expect(NINO_OUTLINE_STEP_DEG).toBe(1);
    });
});

describe("ninoOutlineLoops", () => {
    it("returns exactly one loop for every shipped box", () => {
        // All three boxes merge to a single 0..360 range, so no dateline split is needed.
        for (const box of ALL_BOXES) {
            expect(boxLon360Ranges(box)).toHaveLength(1);
            expect(ninoOutlineLoops(box)).toHaveLength(1);
        }
    });

    it("closes each loop explicitly: first vertex equals last", () => {
        for (const box of ALL_BOXES) {
            for (const loop of ninoOutlineLoops(box)) {
                expect(loop[0]).toEqual(loop[loop.length - 1]);
            }
        }
    });

    it("holds every vertex on one sphere of the requested radius", () => {
        for (const box of ALL_BOXES) {
            for (const loop of ninoOutlineLoops(box, 1.5)) {
                const spread = radiusSpread(loop);
                expect(spread.min).toBeCloseTo(1.5, 10);
                expect(spread.max).toBeCloseTo(1.5, 10);
            }
        }
    });

    it("honours a custom radius without changing the shape", () => {
        const a = ninoOutlineLoops(NINO_BOXES[0], 1);
        const b = ninoOutlineLoops(NINO_BOXES[0], 2);
        expect(a[0]).toHaveLength(b[0].length);
        // Doubling the radius doubles every coordinate, since the direction is radius-independent.
        for (let i = 0; i < a[0].length; i += 1) {
            expect(b[0][i][0]).toBeCloseTo(a[0][i][0] * 2, 10);
            expect(b[0][i][1]).toBeCloseTo(a[0][i][1] * 2, 10);
            expect(b[0][i][2]).toBeCloseTo(a[0][i][2] * 2, 10);
        }
    });

    it("rejects a non-positive radius and an out-of-range step", () => {
        expect(() => ninoOutlineLoops(NINO_BOXES[0], 0)).toThrow(RangeError);
        expect(() => ninoOutlineLoops(NINO_BOXES[0], -1)).toThrow(RangeError);
        expect(() => ninoOutlineLoops(NINO_BOXES[0], 1, 0)).toThrow(RangeError);
        expect(() => ninoOutlineLoops(NINO_BOXES[0], 1, 46)).toThrow(
            RangeError,
        );
    });
});

describe("continuity across the dateline", () => {
    it("never steps further than the box is tall, for any shipped box", () => {
        /*
         * The "no segment jumps across the globe" proof, restated for NINO-HARDEN B1.
         *
         * Before B1 this test's bound was `max(height, stepDeg) + 0.5` because a boundary walk always
         * contained the two VERTICAL legs as single chords — the legitimate worst step was the box's own
         * latitude span (10 degrees for Niño 1+2 and for Niño 4). The legs are now sampled at
         * `NINO_OUTLINE_STEP_DEG`, so the bound tightens to the sample step plus corner slack, and the
         * comment that said "the legitimate worst step is the box's own LATITUDE SPAN" is no longer true.
         *
         * What matters is unchanged: no step may approach a half-circumference. The separately-asserted
         * 90 degree cap is what would catch a jumped segment; a dateline stitch would produce ~180.
         */
        for (const box of ALL_BOXES) {
            const allowed = NINO_OUTLINE_STEP_DEG + 0.0001;
            const worst = maxStepDegrees(ninoOutlineVertices(box));
            expect(worst).toBeLessThanOrEqual(allowed);
            expect(worst).toBeLessThan(90);
        }
    });

    it("keeps Niño 4 continuous through lon 180, which is its middle", () => {
        /*
         * Niño 4 is 160E..150W. Its single 0..360 range is [160, 210], so lon 180 sits INSIDE it and
         * the vertex at 180 must exist with a neighbour on each side a sample apart. A dateline split
         * would have produced two loops ending and starting at 180 instead.
         */
        const loops = ninoOutlineLoops(NINO_BOXES[1]);
        expect(loops).toHaveLength(1);

        const loop = loops[0];
        /*
         * NINO-HARDEN B1: the latitude legs are sampled now, so the count is no longer
         * 51 south + 51 north + 1. It is
         *   51 south + 9 east-leg interior + 51 north + 9 west-leg interior + 1 closing repeat = 121.
         * The 9 comes from a 10-degree height at a 1-degree step: m = ceil(10/1) = 10, and `lats`
         * holds the m-1 = 9 INTERIOR vertices only — the two ends are already the corners the
         * horizontal edges produced, so including them would duplicate a vertex and produce a
         * zero-length segment.
         */
        expect(loop.length).toBe(51 + 9 + 51 + 9 + 1);
        /*
         * And the worst legitimate step is now the SAMPLE step, not the box height. Was
         * `<= 10.5` because the vertical legs were one chord each; it is `<= 1.0001` because they
         * are sampled at NINO_OUTLINE_STEP_DEG.
         */
        expect(maxStepDegrees(loop)).toBeLessThanOrEqual(1.0001);
    });

    it("emits two separate loops for a box that crosses the prime meridian", () => {
        const loops = ninoOutlineLoops(TWO_RANGE_BOX);
        expect(loops).toHaveLength(2);

        // Each is its own closed loop...
        for (const loop of loops) {
            expect(loop[0]).toEqual(loop[loop.length - 1]);
        }

        /*
         * ...and NEITHER spans the globe. This is the assertion that would fail under the old
         * concatenating builder: it appended every range into one array and closed it to the FIRST
         * point of the first range, producing a single ~20 degree gap turned into a segment across
         * most of the sphere. Flattening here is only safe because the loops are already built.
         */
        for (const loop of loops) {
            // Height is 2 degrees for the synthetic box, so the legs are 1 interior vertex each side.
            expect(maxStepDegrees(loop)).toBeLessThanOrEqual(1.0001);
            expect(maxStepDegrees(loop)).toBeLessThan(90);
        }
    });

    it("bounds the flattened worst step too, so a naive consumer is still correct", () => {
        /*
         * `ninoOutlineVertices` flattens the loops, and a consumer that draws the flattened array as ONE
         * line WOULD jump between them. The bound below documents that limit honestly: it is asserted
         * per loop above, and the flattened form is only for global properties (radius, counts). Kept as
         * a test so the distinction is visible rather than assumed.
         *
         * NINO-HARDEN B1 changed the threshold, not the property: the jump between loop two's start and
         * loop one's end for TWO_RANGE_BOX was > 2.5 degrees and is now > 1.0001, because both loops are
         * sampled at the 1-degree step. Asserting `> 1.0001` keeps this a statement about the
         * between-loop jump rather than about the sample size.
         */
        const flat = ninoOutlineVertices(TWO_RANGE_BOX);
        expect(flat.length).toBeGreaterThan(0);
        expect(maxStepDegrees(flat)).toBeGreaterThan(1.0001);
    });
});

describe("boxAnchor and boxCentreDirection", () => {
    it("reads the registry anchor rather than recomputing a centre", () => {
        expect(boxAnchor(NINO_BOXES[0])).toEqual([-5, -85]);
        expect(boxAnchor(NINO_BOXES[1])).toEqual([0, -175]);
        expect(boxAnchor(NINO34_REFERENCE_BOX)).toEqual([-2, -150]);
    });

    it("returns a unit direction", () => {
        for (const box of ALL_BOXES) {
            const d = boxCentreDirection(box);
            expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(1, 12);
        }
    });

    it("points where the anchor longitude says it should", () => {
        /*
         * `latLonToVector3` (regions.ts:68-76) is
         *   x = -sin(phi)cos(theta), y = cos(phi), z = sin(phi)sin(theta),  theta = lon + 180
         * At the equator phi = 90 so sin(phi) = 1 and cos(phi) = 0, leaving
         *   x = -cos(lon + 180) = +cos(lon),  z = sin(lon + 180) = -sin(lon).
         * Evaluated directly: lon 0 -> (1,0,0), lon 90 -> (0,0,-1), lon 180 -> (-1,0,0),
         * lon -90 -> (0,0,1).
         *
         * Two earlier versions of this test were wrong in opposite directions — first asserting +1/-1
         * with a sign slip in the comment, then "fixing" it to -1 when the real answer at lon 0 is +1.
         * The values below are the function's own output, checked outside the test suite.
         */
        const at = (lon: number) =>
            boxCentreDirection({
                ...NINO_BOXES[1],
                anchorLat: 0,
                anchorLon: lon,
            });

        expect(at(0)[0]).toBeCloseTo(1, 10);
        expect(at(0)[2]).toBeCloseTo(0, 10);

        expect(at(90)[0]).toBeCloseTo(0, 10);
        expect(at(90)[2]).toBeCloseTo(-1, 10);

        expect(at(180)[0]).toBeCloseTo(-1, 10);
        expect(at(180)[2]).toBeCloseTo(0, 10);

        // lon 0 and lon 180 are antipodal at the equator.
        expect(at(0)[0]).toBeCloseTo(-at(180)[0], 10);
        expect(at(0)[2]).toBeCloseTo(-at(180)[2], 10);

        // Both sit on the equator, so y is 0 for each.
        expect(at(0)[1]).toBeCloseTo(0, 10);
        expect(at(180)[1]).toBeCloseTo(0, 10);
    });
});

describe("sampling density and shape", () => {
    it("puts every vertex at exactly NINO_OUTLINE_RADIUS by default", () => {
        /*
         * C1.2: "every vertex has radius exactly NINO_OUTLINE_RADIUS". Called with no radius argument,
         * so this exercises the module default the scene actually uses. 1e-12 because the builder
         * scales a unit vector rather than re-deriving the position, so the only error is float
         * multiplication.
         */
        for (const box of ALL_BOXES) {
            for (const loop of ninoOutlineLoops(box)) {
                for (const vertex of loop) {
                    expect(
                        Math.hypot(vertex[0], vertex[1], vertex[2]),
                    ).toBeCloseTo(NINO_OUTLINE_RADIUS, 12);
                }
            }
        }
    });

    it("samples constant-latitude edges along the parallel instead of chording them", () => {
        /*
         * C1.2: "constant-latitude edges are sampled along longitude, so they follow the parallel and
         * are not chords."
         *
         * Niño 4 is 160E..150W, 5S..5N -> one 0..360 range [160, 210], 50 degrees wide at 1 degree
         * steps, so each parallel edge must carry 51 vertices. A chorded edge would carry 2 and its
         * span would be a straight line through the sphere rather than an arc hugging the surface.
         *
         * The proof is the ANGLE ABOUT THE POLAR AXIS between consecutive same-latitude vertices: on a
         * true 1-degree walk that is 1.00 degrees, and on a 50-degree chord it would be 50 degrees.
         */
        const loop = ninoOutlineLoops(NINO_BOXES[1])[0];
        /*
         * Drop the closing repeat first. The loop is SOUTH(51) + NORTH(51) + the repeat of its first
         * vertex = 103 points, so an unfiltered split counts the closing vertex on the south edge and
         * gives 52. That 52 was the test being wrong, not the builder: the repeat is what closes the
         * LineLoop, and the first version of this assertion failed on it.
         */
        const open = loop.slice(0, -1);
        expect(loop).toHaveLength(open.length + 1);
        expect(loop[loop.length - 1]).toEqual(loop[0]);

        /*
         * NINO-HARDEN B1: filter by the EDGE LATITUDE, not by the sign of y.
         *
         * The old filters were `v[1] > 0.01` and `v[1] < -0.01`, which was exact when a loop held only
         * two rows. Now each loop also carries the interior vertices of its two latitude legs, and those
         * sit at 9 different latitudes — so a sign filter would put 4 of the east leg's and 4 of the west
         * leg's vertices into `north` and 8 into `south`, and the "constant latitude" assertion below
         * would fail on a box that is built correctly.
         *
         * `latLonToVector3(lat, lon, radius)` returns y = radius·cos(φ), so with the outline radius the
         * rows sit at ±1.0025·cos(85°) = ±0.087353; comparing within 1e-9 selects exactly the 51
         * vertices of each row and nothing on the legs.
         */
        const yAt = (lat: number) =>
            NINO_OUTLINE_RADIUS * Math.cos(((90 - lat) * Math.PI) / 180);
        const northY = yAt(NINO_BOXES[1].latMax);
        const southY = yAt(NINO_BOXES[1].latMin);
        const north = open.filter((v) => Math.abs(v[1] - northY) < 1e-9);
        const south = open.filter((v) => Math.abs(v[1] - southY) < 1e-9);

        // 50 degrees at 1 degree per step is 51 samples, on each of the two parallel edges.
        expect(north).toHaveLength(51);
        expect(south).toHaveLength(51);

        const polarStepDeg = (a: readonly number[], b: readonly number[]) => {
            const la = Math.hypot(a[0], a[2]);
            const lb = Math.hypot(b[0], b[2]);
            const cos = Math.min(
                1,
                Math.max(-1, (a[0] * b[0] + a[2] * b[2]) / (la * lb)),
            );
            return (Math.acos(cos) * 180) / Math.PI;
        };

        for (const edge of [north, south]) {
            for (let i = 1; i < edge.length; i += 1) {
                // Exactly one degree, and certainly nowhere near the 50 degrees a chord would give.
                expect(polarStepDeg(edge[i - 1], edge[i])).toBeCloseTo(1, 6);
                expect(polarStepDeg(edge[i - 1], edge[i])).toBeLessThan(2);
            }
            // Both ends of the edge sit at the same latitude as its middle: the edge is constant-lat.
            // Written with an explicit loop, not Math.max(...ys): the repo's source guard
            // (tests/e2e/source-guards.test.ts) forbids spreading an array into Math.min/max, since it is
            // unbounded in general and overflows the argument stack on large inputs.
            let yMin = Infinity;
            let yMax = -Infinity;
            for (const v of edge) {
                if (v[1] < yMin) yMin = v[1];
                if (v[1] > yMax) yMax = v[1];
            }
            expect(yMax - yMin).toBeCloseTo(0, 12);
        }
    });

    it("keeps every segment close enough to the sphere that no chord dips inside it", () => {
        /*
         * NINO-HARDEN B1's actual defect, asserted for the first time.
         *
         * Before B1 the latitude legs were ONE chord each, spanning the box height. For Niño 1+2 that is
         * a 10-degree chord at radius 1.0025, whose midpoint sits at 1.0025·cos(5°) = 0.998685 — BELOW
         * the unit sphere. The outline was drawn above the surface at its corners (1.0025) and buried
         * under the globe in the middle of each vertical edge, so the box looked like two parallel arcs
         * rather than a closed loop.
         *
         * The brief asks for "every chord midpoint radius = 1.0020". That exact value is not what a
         * 1-degree sample at radius 1.0025 gives: the midpoint of a 1-degree chord sits at
         * 1.0025·cos(0.5°) = 1.002462. Asserting 1.0020 exactly would be asserting a number the geometry
         * never produces, so the assertion is the FLOOR the brief actually cares about — no midpoint may
         * be closer to the centre than 1.0020, i.e. every segment stays at least 2 mm above the surface
         * of a 1-unit globe — and the measured minimum is reported alongside it.
         *
         * Measured minimum midpoint radius across all shipped boxes: 1.002462 (see the printout in the
         * B1 report). The old builder's value is recorded in the comment above the leg sampling code.
         */
        for (const box of ALL_BOXES) {
            for (const loop of ninoOutlineLoops(box)) {
                for (let i = 1; i < loop.length; i += 1) {
                    const a = loop[i - 1];
                    const b = loop[i];
                    const midRadius = Math.hypot(
                        (a[0] + b[0]) / 2,
                        (a[1] + b[1]) / 2,
                        (a[2] + b[2]) / 2,
                    );
                    expect(midRadius).toBeGreaterThanOrEqual(1.002);
                    /*
                     * And no segment may be long enough for its midpoint to fall out of that band even in
                     * principle: at 1.0025 the midpoint radius is 1.0025·cos(θ/2), which stays >= 1.0020 for
                     * θ <= 2·acos(1.0020/1.0025) = 3.62 degrees. The 1.0001 step bound asserted above is well
                     * inside that, so the two assertions agree instead of one hiding the other.
                     */
                    const chordDeg =
                        (Math.acos(
                            Math.min(
                                1,
                                Math.max(
                                    -1,
                                    (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) /
                                        (Math.hypot(a[0], a[1], a[2]) *
                                            Math.hypot(b[0], b[1], b[2])),
                                ),
                            ),
                        ) *
                            180) /
                        Math.PI;
                    expect(chordDeg).toBeLessThanOrEqual(1.0001);
                }
            }
        }
    });

    it("puts every vertex at radius 1.0025 to twelve places, legs included", () => {
        /*
         * The legs are new vertices, so the radius invariant has to be re-proved over them rather than
         * inherited: `1.0025` to 1e-12 is what the brief asks for, and a leg vertex that used a
         * normalised direction instead of `latLonToVector3` would sit at 1.0 and pass no other test.
         */
        for (const box of ALL_BOXES) {
            for (const loop of ninoOutlineLoops(box)) {
                for (const v of loop) {
                    expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(
                        1.0025,
                        12,
                    );
                }
            }
        }
    });
});
