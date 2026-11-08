/**
 * Step A — the island's category bands and formatting.
 *
 * The boundary values are the step's own list (0.49, 0.5, 1.49, 1.5, 1.99, 2.0) and each is asserted on
 * BOTH sides, because the whole point of a band edge is which band a value at the edge falls into.
 */
import { describe, expect, it } from "vitest";
import {
    MINUS,
    MODERATE_FROM,
    STRONG_FROM,
    VERY_STRONG_FROM,
    WEAK_FROM,
    ensoCategory,
    ensoLabel,
    formatAnomaly,
    formatIsland,
} from "./ensoHud";

describe("the band edges", () => {
    it("are the ONI thresholds named by the step", () => {
        expect(WEAK_FROM).toBe(0.5);
        expect(MODERATE_FROM).toBe(1.0);
        expect(STRONG_FROM).toBe(1.5);
        expect(VERY_STRONG_FROM).toBe(2.0);
    });
});

describe("ensoCategory — warm", () => {
    it("is neutral below 0.5 and weak from 0.5", () => {
        expect(ensoCategory(0)).toBe("neutral");
        expect(ensoCategory(0.1)).toBe("neutral");
        expect(ensoCategory(0.49)).toBe("neutral");
        expect(ensoCategory(0.5)).toBe("weak-el-nino");
        expect(ensoCategory(0.9)).toBe("weak-el-nino");
        expect(ensoCategory(0.99)).toBe("weak-el-nino");
    });

    it("is moderate from 1.0 and 1.49 is still moderate", () => {
        expect(ensoCategory(1.0)).toBe("moderate-el-nino");
        expect(ensoCategory(1.2)).toBe("moderate-el-nino");
        expect(ensoCategory(1.49)).toBe("moderate-el-nino");
    });

    it("is strong from 1.5 and 1.99 is still strong", () => {
        expect(ensoCategory(1.5)).toBe("strong-el-nino");
        expect(ensoCategory(1.75)).toBe("strong-el-nino");
        expect(ensoCategory(1.99)).toBe("strong-el-nino");
    });

    it("is very strong from 2.0", () => {
        expect(ensoCategory(2.0)).toBe("very-strong-el-nino");
        expect(ensoCategory(2.4)).toBe("very-strong-el-nino");
        expect(ensoCategory(3.0)).toBe("very-strong-el-nino");
    });
});

describe("ensoCategory — cold is mirrored", () => {
    it("mirrors every band onto La Niña", () => {
        expect(ensoCategory(-0.49)).toBe("neutral");
        expect(ensoCategory(-0.5)).toBe("weak-la-nina");
        expect(ensoCategory(-0.99)).toBe("weak-la-nina");
        expect(ensoCategory(-1.0)).toBe("moderate-la-nina");
        expect(ensoCategory(-1.49)).toBe("moderate-la-nina");
        expect(ensoCategory(-1.5)).toBe("strong-la-nina");
        expect(ensoCategory(-1.99)).toBe("strong-la-nina");
        expect(ensoCategory(-2.0)).toBe("very-strong-la-nina");
        expect(ensoCategory(-2.9)).toBe("very-strong-la-nina");
    });

    it("treats -0 as neutral, not as a La Niña of zero magnitude", () => {
        expect(ensoCategory(-0)).toBe("neutral");
    });

    it("reports neutral for a non-finite input rather than throwing", () => {
        expect(ensoCategory(Number.NaN)).toBe("neutral");
        expect(ensoCategory(Number.POSITIVE_INFINITY)).toBe("neutral");
    });
});

describe("formatAnomaly", () => {
    it("prints an explicit plus for positive values", () => {
        expect(formatAnomaly(1.5)).toBe("+1.5°C");
        expect(formatAnomaly(0.1)).toBe("+0.1°C");
    });

    it("prints the real minus sign, not a hyphen, for negative values", () => {
        const out = formatAnomaly(-1.5);
        expect(out).toBe(`${MINUS}1.5°C`);
        expect(out.startsWith("-")).toBe(false);
        expect(out.charCodeAt(0)).toBe(0x2212);
    });

    it("prints a bare 0.0 with no sign at zero, and at a value that rounds to zero from EITHER side", () => {
        /*
         * Both directions collapse to the same `0.0°C` on purpose. `+0.0` would read as a small warming that is
         * not there, and the island cannot distinguish a rounding artefact from a real reading at one decimal.
         */
        expect(formatAnomaly(0)).toBe("0.0°C");
        expect(formatAnomaly(-0)).toBe("0.0°C");
        expect(formatAnomaly(-0.04)).toBe("0.0°C");
        expect(formatAnomaly(0.04)).toBe("0.0°C");
    });

    it("rounds to one decimal place", () => {
        expect(formatAnomaly(1.449)).toBe("+1.4°C");
        expect(formatAnomaly(1.45)).toBe("+1.5°C");
        expect(formatAnomaly(-2.04)).toBe(`${MINUS}2.0°C`);
    });
});

describe("formatIsland", () => {
    it("is the step example verbatim", () => {
        expect(formatIsland(1.5)).toBe("ENSO: +1.5°C | STRONG EL NIÑO");
    });

    it("uses the La Niña label and the minus sign for negative values", () => {
        expect(formatIsland(-1.2)).toBe(
            `ENSO: ${MINUS}1.2°C | MODERATE LA NIÑA`,
        );
    });

    it("says neutral with no sign at zero", () => {
        expect(formatIsland(0)).toBe("ENSO: 0.0°C | NEUTRAL");
    });

    it("agrees with ensoLabel and formatAnomaly, which is what makes the spec comparison sound", () => {
        for (const v of [-2.4, -1.5, -0.6, 0, 0.5, 1.0, 1.5, 2.0, 2.9]) {
            expect(formatIsland(v)).toBe(
                `ENSO: ${formatAnomaly(v)} | ${ensoLabel(ensoCategory(v))}`,
            );
        }
    });

    it("never prints an empty or lowercase label", () => {
        for (const v of [-3, -1, 0, 1, 3]) {
            const label = ensoLabel(ensoCategory(v));
            expect(label.length).toBeGreaterThan(0);
            expect(label).toBe(label.toUpperCase());
        }
    });
});
