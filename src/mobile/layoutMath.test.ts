/**
 * The layout law as a table.
 *
 * Every viewport the step's acceptance matrix names, plus the boundaries where two clauses meet, plus the
 * geometry at six viewports. Hand arithmetic would be how a wrong threshold is born — so the expected values in
 * the geometry cases are RECOMPUTED here from the published constants rather than typed in as decimals; only the
 * published constants themselves are literals, and each is asserted once.
 */
import { describe, expect, it } from "vitest";
import {
    DESKTOP_MIN_W,
    HALF_TOP_BACKOFF_PX,
    HALF_TOP_FRACTION,
    LANDSCAPE_MAX_H,
    MIN_RADIUS_BUDGET,
    PEEK_FRACTION,
    PEEK_MIN_PX,
    PORTRAIT_MAX_W,
    RADIUS_MARGIN_PX,
    TABLET_PORTRAIT_MAX_W,
    anomalyDeltaUnit,
    computeFreeRect,
    dockWidth,
    isMobileMode,
    peekVisible,
    radiusBudget,
    resolveLayoutMode,
    type LayoutMode2,
} from "./layoutMath";

/* ------------------------------------------------------------------ the mode: the full table */

const TABLE: Array<[number, number, LayoutMode2]> = [
    /* portrait phones */
    [390, 844, "portrait"],
    [412, 924, "portrait"],
    [360, 640, "portrait"],
    [375, 667, "portrait"],
    [430, 932, "portrait"],
    [320, 568, "portrait"],
    /* portrait tablets */
    [768, 1024, "portrait"],
    [820, 1180, "portrait"],
    [960, 1440, "portrait"],
    /* landscape phones */
    [667, 375, "phoneLandscape"],
    [844, 390, "phoneLandscape"],
    [924, 412, "phoneLandscape"],
    [932, 430, "phoneLandscape"],
    /* desktop */
    [1024, 768, "desktop"],
    [1280, 800, "desktop"],
    [1440, 960, "desktop"],
    [1280, 500, "desktop"],
    /*
     * WAS `desktop` BEFORE TABLET-PORTRAIT, and the change is the point of the rule: an iPad Pro 11 held upright
     * is 1024 wide, which used to clear the width-only clause at exactly `DESKTOP_MIN_W`. It is portrait now, by
     * the aspect clause, because 1024 < `TABLET_PORTRAIT_MAX_W`.
     */
    [1024, 1366, "portrait"],
];

/**
 * The TABLET-PORTRAIT table: the rows the rule was written FOR, plus the four edges it must not move.
 *
 * Kept separate from `TABLE` above so the diff records which expectations changed because of this rule rather
 * than because someone retyped the matrix. Each entry names its own reason, because a bare expected mode is
 * indistinguishable from a typo.
 */
const TABLET_PORTRAIT: Array<[number, number, LayoutMode2, string]> = [
    /* --- the target: portrait viewports from 1024 to 1279 wide, which the old law sent to desktop --- */
    [
        1032,
        1376,
        "portrait",
        "iPad Pro 13 upright: the viewport this rule exists for",
    ],
    [
        1024,
        1366,
        "portrait",
        "iPad Pro 11 upright: exactly DESKTOP_MIN_W, now caught by the aspect clause",
    ],
    [
        1279,
        1400,
        "portrait",
        "one px under TABLET_PORTRAIT_MAX_W is still portrait",
    ],
    /* --- the upper edge: 1280 is desktop, strictly --- */
    [
        1280,
        1400,
        "desktop",
        "1280 wide upright is DESKTOP: the comparison is strict",
    ],
    /* --- squares are desktop, at three sizes --- */
    [1032, 1032, "desktop", "square: h > w is false, and 1032 is not < 768"],
    [1376, 1032, "desktop", "the same viewport rotated: landscape, unaffected"],
    [
        1194,
        834,
        "desktop",
        "iPad Pro 13 landscape: must NOT move, this is the row that was fine",
    ],
    [1024, 768, "desktop", "iPad Pro 11 landscape: must NOT move"],
    /* --- landscape below the landscape-phone height bound is desktop, not mobile --- */
    [
        1100,
        500,
        "desktop",
        "landscape 1100 wide fails the w < 1024 clause, so it stays desktop",
    ],
    [
        1023,
        500,
        "phoneLandscape",
        "one px narrower and under 600 tall: the landscape clause takes it",
    ],
    /* --- the rows that were already portrait must stay portrait --- */
    [834, 1194, "portrait", "iPad Pro 11 upright at its other reported size"],
    [820, 1180, "portrait", "iPad Air upright"],
    [768, 1024, "portrait", "aspect clause, unchanged"],
    [767, 700, "portrait", "width clause, unchanged"],
    [375, 667, "portrait", "phone, unchanged"],
    [667, 375, "phoneLandscape", "landscape phone, unchanged"],
];

describe("resolveLayoutMode — TABLET-PORTRAIT: portrait under 1280 wide", () => {
    for (const [w, h, expected, why] of TABLET_PORTRAIT) {
        it(`${w}x${h} is ${expected} — ${why}`, () => {
            expect(resolveLayoutMode(w, h)).toBe(expected);
        });
    }

    /*
     * The two thresholds are asserted DISTINCT, because the defect this rule fixes was one number doing both
     * jobs. A future edit that sets TABLET_PORTRAIT_MAX_W = DESKTOP_MIN_W would put the 13-inch tablet back on the
     * desktop shell and every row above would fail — but this states the invariant directly rather than leaving it
     * as a consequence.
     */
    it("the aspect bound is NOT DESKTOP_MIN_W", () => {
        expect(TABLET_PORTRAIT_MAX_W).not.toBe(DESKTOP_MIN_W);
        expect(TABLET_PORTRAIT_MAX_W).toBe(1280);
    });

    /*
     * Monotonicity, so the rule cannot be satisfied at one width by breaking another: for a fixed upright height,
     * once a width is desktop it stays desktop as the width grows (until the mode is desktop for good).
     */
    it("is monotonic in width for an upright viewport: portrait holds right up to 1279", () => {
        for (let w = 768; w < TABLET_PORTRAIT_MAX_W; w += 1) {
            expect(resolveLayoutMode(w, 1400), `${w}x1400`).toBe("portrait");
        }
        expect(resolveLayoutMode(TABLET_PORTRAIT_MAX_W, 1400)).toBe("desktop");
    });
});

describe("resolveLayoutMode — the step’s viewport table", () => {
    for (const [w, h, expected] of TABLE) {
        it(`${w}x${h} is ${expected}`, () => {
            expect(resolveLayoutMode(w, h)).toBe(expected);
        });
    }
});

describe("resolveLayoutMode — boundaries", () => {
    /*
     * Each row is the pair that shares an edge, so a `<` widened to a `<=` fails one of them rather than both
     * looking plausible.
     */
    const BOUNDARY: Array<[number, number, LayoutMode2, string]> = [
        [
            767,
            1024,
            "portrait",
            "one px under PORTRAIT_MAX_W is portrait by the width clause",
        ],
        [
            768,
            1024,
            "portrait",
            "768 itself is portrait by the ASPECT clause, not the width one",
        ],
        [
            1023,
            1024,
            "portrait",
            "still portrait: w < TABLET_PORTRAIT_MAX_W and h > w",
        ],
        [
            1024,
            768,
            "desktop",
            "1024 wide LANDSCAPE is desktop: the aspect clause needs h > w",
        ],
        [
            1279,
            768,
            "desktop",
            "the aspect clause stops at 1280, but landscape is desktop at any of these widths",
        ],
        [
            1280,
            1366,
            "desktop",
            "exactly TABLET_PORTRAIT_MAX_W and upright: strict, so desktop",
        ],
        [1023, 599, "phoneLandscape", "both bounds satisfied and w > h"],
        /* The documented accepted gap: a 768..1023 wide LANDSCAPE window with h >= 600 is desktop. */
        [
            1023,
            600,
            "desktop",
            "h = 600 fails the landscape clause and nothing else catches a wide short viewport",
        ],
        [
            1024,
            599,
            "desktop",
            "w = 1024 fails the landscape clause and the aspect clause",
        ],
        [600, 600, "portrait", "square is portrait: w < 768"],
        [
            768,
            768,
            "desktop",
            "square AT the breakpoint is desktop — a documented accepted gap",
        ],
        [900, 900, "desktop", "the same gap, larger"],
        [
            767,
            599,
            "phoneLandscape",
            "both bounds clear and w > h, so the landscape clause wins over the width one",
        ],
        [599, 767, "portrait", "w < h, w < 768"],
    ];

    for (const [w, h, expected, why] of BOUNDARY) {
        it(`${w}x${h} is ${expected} — ${why}`, () => {
            expect(resolveLayoutMode(w, h)).toBe(expected);
        });
    }

    /*
     * A viewport of no size is not a real browser state — `innerWidth` is never 0 before the first layout — but the
     * function has to answer, and `w < 768` is true of 0, so the honest answer is `portrait`. Asserted rather than
     * left to a reader's guess: the mobile shell is the safe render for an unknown size, because the desktop
     * overlays assume measured panels.
     */
    it("a viewport with no size is portrait, not desktop", () => {
        expect(resolveLayoutMode(0, 0)).toBe("portrait");
        expect(resolveLayoutMode(Number.NaN, Number.NaN)).toBe("portrait");
        expect(resolveLayoutMode(-100, -100)).toBe("portrait");
    });

    it("the published constants are the ones the table was written against", () => {
        expect(PORTRAIT_MAX_W).toBe(768);
        expect(DESKTOP_MIN_W).toBe(1024);
        expect(LANDSCAPE_MAX_H).toBe(600);
        /* TABLET-PORTRAIT's threshold, asserted here with the others so all four live in one place. */
        expect(TABLET_PORTRAIT_MAX_W).toBe(1280);
    });
});

describe("isMobileMode", () => {
    it("is false only for desktop", () => {
        expect(isMobileMode("desktop")).toBe(false);
        expect(isMobileMode("portrait")).toBe(true);
        expect(isMobileMode("phoneLandscape")).toBe(true);
    });
});

/* ---------------------------------------------------------------------------- the free rect */

/** The peek band, recomputed from the constants so the geometry cases cannot drift. */
const peekOf = (h: number): number => Math.max(PEEK_FRACTION * h, PEEK_MIN_PX);

/** Header heights used below: the compact header's own measured height at each shape. */
const HEADER_PORTRAIT = 104;
const HEADER_LANDSCAPE = 60;

describe("computeFreeRect — portrait at the four phones and the tablet", () => {
    const CASES: Array<{ w: number; h: number }> = [
        { w: 390, h: 844 },
        { w: 320, h: 568 },
        { w: 960, h: 1440 },
    ];

    for (const { w, h } of CASES) {
        it(`${w}x${h}`, () => {
            const r = computeFreeRect("portrait", w, h, HEADER_PORTRAIT);
            /* The band: header bottom to the peek line. */
            expect(r.left).toBe(0);
            expect(r.right).toBe(w);
            expect(r.top).toBe(HEADER_PORTRAIT);
            expect(r.bottom).toBeCloseTo(h - peekOf(h), 9);
            /* The centre: horizontally the viewport's, vertically the min of the midpoint and the Half-tier rule. */
            expect(r.cx).toBeCloseTo(w / 2, 9);
            const mid = (HEADER_PORTRAIT + (h - peekOf(h))) / 2;
            expect(r.cy).toBeCloseTo(
                Math.min(mid, HALF_TOP_FRACTION * h - HALF_TOP_BACKOFF_PX),
                9,
            );
            /* And the budget is the narrowest half-span minus the margin. */
            const span = Math.min(w / 2, r.cy - r.top, r.bottom - r.cy);
            expect(r.radiusBudget).toBeCloseTo(
                Math.max(span - RADIUS_MARGIN_PX, MIN_RADIUS_BUDGET),
                9,
            );
        });
    }
});

describe("computeFreeRect — phoneLandscape", () => {
    const CASES: Array<{ w: number; h: number }> = [
        { w: 924, h: 412 },
        { w: 568, h: 320 },
        { w: 667, h: 375 },
    ];

    for (const { w, h } of CASES) {
        it(`${w}x${h}`, () => {
            const r = computeFreeRect("phoneLandscape", w, h, HEADER_LANDSCAPE);
            expect(r.left).toBe(0);
            expect(r.right).toBeCloseTo(w - dockWidth(w), 9);
            expect(r.top).toBe(HEADER_LANDSCAPE);
            expect(r.bottom).toBe(h);
            expect(r.cx).toBeCloseTo(r.right / 2, 9);
            expect(r.cy).toBeCloseTo((HEADER_LANDSCAPE + h) / 2, 9);
            expect(r.radiusBudget).toBeGreaterThanOrEqual(MIN_RADIUS_BUDGET);
        });
    }

    it("the dock is on the right, so cx is in the LEFT half of the viewport", () => {
        const r = computeFreeRect("phoneLandscape", 924, 412, HEADER_LANDSCAPE);
        expect(r.cx).toBeLessThan(924 / 2);
    });
});

describe("computeFreeRect — the shape invariants", () => {
    it("the rect is never inverted, and the centre is always inside it", () => {
        for (const [w, h] of TABLE) {
            const mode = resolveLayoutMode(w, h);
            for (const header of [0, 60, 104, 200]) {
                const r = computeFreeRect(mode, w, h, header);
                expect(r.right, `${w}x${h} @${header}`).toBeGreaterThanOrEqual(
                    r.left,
                );
                expect(r.bottom, `${w}x${h} @${header}`).toBeGreaterThanOrEqual(
                    r.top,
                );
                expect(r.cx).toBeGreaterThanOrEqual(r.left);
                expect(r.cx).toBeLessThanOrEqual(r.right);
                expect(r.cy).toBeGreaterThanOrEqual(r.top);
                expect(r.cy).toBeLessThanOrEqual(r.bottom);
                expect(r.radiusBudget).toBeGreaterThanOrEqual(
                    MIN_RADIUS_BUDGET,
                );
            }
        }
    });

    it("a header taller than the viewport does not produce a negative band", () => {
        const r = computeFreeRect("portrait", 390, 844, 2000);
        expect(r.top).toBe(844);
        expect(r.bottom).toBeGreaterThanOrEqual(r.top);
        expect(r.radiusBudget).toBe(MIN_RADIUS_BUDGET);
    });
});

describe("radiusBudget", () => {
    /* The four half-spans for this rect and centre are 200 (left), 200 (right), 200 (top), 200 (bottom), so the
     * narrowest is 200 and the budget is 200 - 12. Written as arithmetic rather than as 188 so the margin is
     * visible in the expectation. */
    const RECT = { left: 0, right: 400, top: 100, bottom: 500 };

    it("is the narrowest of the four half-spans, minus the margin", () => {
        expect(radiusBudget(RECT, 200, 300)).toBeCloseTo(
            200 - RADIUS_MARGIN_PX,
            9,
        );
    });

    it("the TOP span is what binds when the centre sits high in the rect", () => {
        /* cy = 170: spans 200, 200, 70, 330 -> the top one binds, and 70 - 12 is above the floor. */
        expect(radiusBudget(RECT, 200, 170)).toBeCloseTo(
            70 - RADIUS_MARGIN_PX,
            9,
        );
        /* cy = 160: top span 60 - 12 = 48, still above the floor. */
        expect(radiusBudget(RECT, 200, 160)).toBeCloseTo(
            60 - RADIUS_MARGIN_PX,
            9,
        );
        /* cy = 120: top span 20 - 12 = 8 -> the floor. */
        expect(radiusBudget(RECT, 200, 120)).toBe(MIN_RADIUS_BUDGET);
    });

    it("floors at 40 px rather than going negative", () => {
        expect(radiusBudget(RECT, 200, 102)).toBe(MIN_RADIUS_BUDGET);
        expect(
            radiusBudget({ left: 0, right: 0, top: 0, bottom: 0 }, 0, 0),
        ).toBe(MIN_RADIUS_BUDGET);
    });
});

describe("dockWidth", () => {
    it("clamps to [320, 400] and then caps at half the viewport", () => {
        /* 0.38·667 = 253.46 -> the 320 floor, and 320 <= 333.5 so the floor is what ships. */
        expect(dockWidth(667)).toBe(320);
        /* 0.38·844 = 320.72 -> inside the range -> under the 422 cap. */
        expect(dockWidth(844)).toBeCloseTo(0.38 * 844, 9);
        /* 0.38·924 = 351.12 -> inside the range. */
        expect(dockWidth(924)).toBeCloseTo(0.38 * 924, 9);
        /* 0.38·1440 = 547.2 -> ceiling 400. */
        expect(dockWidth(1440)).toBe(400);
        /* The cap, isolated: 500 allows only 250, which is below the floor. */
        expect(dockWidth(500)).toBe(250);
    });

    it("is never wider than half the viewport, at any width", () => {
        for (const w of [320, 375, 500, 667, 844, 924, 932, 1024, 1440, 2000]) {
            expect(dockWidth(w)).toBeLessThanOrEqual(w / 2 + 1e-9);
        }
    });

    it("a zero or nonsense width yields zero", () => {
        expect(dockWidth(0)).toBe(0);
        expect(dockWidth(Number.NaN)).toBe(0);
    });
});

describe("peekVisible", () => {
    it("is the larger of the fraction and the floor", () => {
        /* 0.18·844 = 151.92 > 112: the fraction wins. */
        expect(peekVisible(844)).toBeCloseTo(PEEK_FRACTION * 844, 9);
        /* 0.18·568 = 102.24 < 112: the floor wins. */
        expect(peekVisible(568)).toBe(PEEK_MIN_PX);
    });

    it("adds the safe area inside the max, so the band still fits", () => {
        expect(peekVisible(568, 34)).toBe(PEEK_MIN_PX + 34);
        /* And the fraction still wins where it is larger than the floored term. */
        expect(peekVisible(844, 34)).toBeCloseTo(PEEK_FRACTION * 844, 9);
    });

    it("never exceeds the viewport", () => {
        /* 0.18·120 = 21.6, floor 112 -> clamped to the viewport itself. */
        expect(peekVisible(120)).toBe(112);
        expect(peekVisible(60)).toBe(60);
        expect(peekVisible(0)).toBe(0);
        expect(peekVisible(-5)).toBe(0);
    });

    it("the peek line it implies stays on screen for every phone in the matrix", () => {
        for (const h of [568, 640, 667, 844, 924, 932]) {
            const top = h - peekVisible(h);
            expect(top).toBeGreaterThan(0);
            expect(top).toBeLessThan(h);
        }
    });
});

describe("anomalyDeltaUnit — the delta conversion, no +32", () => {
    it("+1.5 C is +2.7 F", () => {
        expect(anomalyDeltaUnit(1.5, "imperial").value).toBeCloseTo(2.7, 12);
        expect(anomalyDeltaUnit(1.5, "imperial").unit).toBe("°F");
    });

    it("-0.5 C is -0.9 F", () => {
        expect(anomalyDeltaUnit(-0.5, "imperial").value).toBeCloseTo(-0.9, 12);
    });

    it("metric is the identity, and the unit is °C", () => {
        expect(anomalyDeltaUnit(1.5, "metric")).toEqual({
            value: 1.5,
            unit: "°C",
        });
        expect(anomalyDeltaUnit(-2.25, "metric")).toEqual({
            value: -2.25,
            unit: "°C",
        });
    });

    it("zero and nonsense map to zero, not to 32 or NaN", () => {
        expect(anomalyDeltaUnit(0, "imperial").value).toBe(0);
        expect(anomalyDeltaUnit(Number.NaN, "imperial").value).toBe(0);
    });

    it("is NOT the absolute conversion: the difference is exactly 32", () => {
        /* `celsiusToFahrenheit` would give 34.7; the delta form gives 2.7. Stated as a difference so a reader sees
         * which law is which. */
        expect(anomalyDeltaUnit(1.5, "imperial").value).toBeCloseTo(
            1.5 * 1.8 + 32 - 32,
            9,
        );
    });
});
