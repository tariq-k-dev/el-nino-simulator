import { describe, expect, it } from "vitest";
import {
    fixed,
    hasNegativeZero,
    magnitude,
    percent,
    signed,
} from "@/lib/format";
import { computeMetrics, regionHeadline } from "@/lib/model";

/**
 * The formatting layer is the ONLY place -0 is normalised. Numeric parity with
 * DuckDB is preserved because nothing here touches a value that feeds a
 * comparison — these functions return strings.
 */

describe("fixed()", () => {
    it('prints -0 as 0, never "-0.00"', () => {
        expect(fixed(-0, 2)).toBe("0.00");
        expect(fixed(-0, 1)).toBe("0.0");
        expect(fixed(-0, 0)).toBe("0");
    });

    it("treats a value that rounds to -0 as 0", () => {
        expect(fixed(-0.001, 2)).toBe("0.00");
        expect(fixed(-0.0001, 3)).toBe("0.000");
    });

    it("does not alter genuine negatives", () => {
        expect(fixed(-0.01, 2)).toBe("-0.01");
        expect(fixed(-1.91, 2)).toBe("-1.91");
        expect(fixed(-46.2, 1)).toBe("-46.2");
    });

    it("does not alter positives or zero", () => {
        expect(fixed(0, 2)).toBe("0.00");
        expect(fixed(1.725, 2)).toBe("1.73");
    });
});

describe("signed()", () => {
    it("prints zero without any sign", () => {
        expect(signed(0, 1)).toBe("0.0");
        expect(signed(-0, 1)).toBe("0.0");
        expect(signed(-0.001, 1)).toBe("0.0");
    });

    it("marks positives with + and negatives with -", () => {
        expect(signed(46.2, 1)).toBe("+46.2");
        expect(signed(-46.2, 1)).toBe("-46.2");
    });

    it("appends a unit when given", () => {
        expect(signed(1.73, 2, "°C")).toBe("+1.73°C");
        expect(signed(0, 2, "°C")).toBe("0.00°C");
    });
});

describe("magnitude() and percent()", () => {
    it("magnitude is always non-negative", () => {
        expect(magnitude(-46.2, 1)).toBe("46.2");
        expect(magnitude(-0, 1)).toBe("0.0");
    });

    it("percent scales a ratio and normalises -0", () => {
        expect(percent(0, 0)).toBe("0%");
        expect(percent(-0, 0)).toBe("0%");
        expect(percent(0.397, 0)).toBe("40%");
    });
});

describe("hasNegativeZero() — the assertion helper", () => {
    it("detects the shapes the UI could print", () => {
        expect(hasNegativeZero("-0.0")).toBe(true);
        expect(hasNegativeZero("-0.00")).toBe(true);
        expect(hasNegativeZero("-0%")).toBe(true);
        expect(hasNegativeZero("-0°C")).toBe(true);
        expect(hasNegativeZero("value -0.0 here")).toBe(true);
    });

    it("does not flag legitimate negatives or zeros", () => {
        expect(hasNegativeZero("0.0")).toBe(false);
        expect(hasNegativeZero("0%")).toBe(false);
        expect(hasNegativeZero("-0.01")).toBe(false);
        expect(hasNegativeZero("-1.0")).toBe(false);
        expect(hasNegativeZero("-10.0")).toBe(false);
        expect(hasNegativeZero("-0.5")).toBe(false);
    });
});

describe("rendered headlines at strength 0", () => {
    it('regionHeadline never emits a negative zero or a "+0.00"', () => {
        // Strength at its minimum: several terms are exactly zero.
        const m = computeMetrics({
            sstAnomaly: 0,
            jetStreamShift: 0,
            agricultureWeight: 0,
        });

        for (const region of [
            "pacific",
            "us-west",
            "se-asia",
            "horn-africa",
        ] as const) {
            const h = regionHeadline(m, region);
            expect(hasNegativeZero(h), `${region}: ${h}`).toBe(false);
            // A hardcoded "+" used to print "+0.00" and, with -0, "+-0.00".
            expect(h).not.toContain("+-");
            expect(h).not.toContain("++");
        }
    });

    it("regionHeadline is clean across the extreme corners too", () => {
        const cases = [
            { sstAnomaly: 0, jetStreamShift: -1, agricultureWeight: 0 },
            { sstAnomaly: 0, jetStreamShift: 1, agricultureWeight: 1 },
            { sstAnomaly: 0.01, jetStreamShift: -1, agricultureWeight: 0 },
            { sstAnomaly: 0.01, jetStreamShift: 1, agricultureWeight: 0 },
        ];
        for (const s of cases) {
            const m = computeMetrics(s);
            for (const region of [
                "pacific",
                "us-west",
                "se-asia",
                "horn-africa",
            ] as const) {
                const h = regionHeadline(m, region);
                expect(
                    hasNegativeZero(h),
                    `${JSON.stringify(s)} ${region}: ${h}`,
                ).toBe(false);
            }
        }
    });

    it("every metric formats cleanly at strength 0", () => {
        const m = computeMetrics({
            sstAnomaly: 0,
            jetStreamShift: 0,
            agricultureWeight: 0,
        });
        for (const [k, v] of Object.entries(m)) {
            if (typeof v !== "number") continue;
            expect(hasNegativeZero(fixed(v, 2)), k).toBe(false);
            expect(hasNegativeZero(signed(v, 2)), k).toBe(false);
        }
    });
});
