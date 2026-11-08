/**
 * The landscape header's geometry law, asserted against the numbers it was derived from.
 *
 * These are not tautologies: each case re-derives the quantity from the MEASURED browser inputs
 * recorded in this file's comments (the h1's 229.06 px natural width, the chip's 128.53–208.09 px text
 * span, the 50 px controls cluster) and compares the law's output against the bound the acceptance
 * spec enforces. A retune of any constant that breaks a bound fails here, in milliseconds, rather than
 * in a five-minute Playwright run.
 */
import { describe, expect, it } from "vitest";
import {
    LANDSCAPE_CHIP_CHROME,
    LANDSCAPE_CHIP_W,
    LANDSCAPE_CONTROL_H,
    LANDSCAPE_IDENTITY_H,
    LANDSCAPE_ONE_ROW_MIN_W,
    LANDSCAPE_PAD_PX,
    LANDSCAPE_ROW_GAP_PX,
    landscapeHeaderHeight,
    landscapeHeaderRows,
    landscapeOneRowWidth,
} from "@/mobile/headerMath";
import { formatIsland } from "@/mobile/ensoHud";
import { SST_MAX, SST_MIN } from "@/lib/model";

/** The h1's natural single-line width, px — MEASURED in Chromium at dsf 2, `text-[13px]`, `nowrap`. */
const H1_NATURAL_PX = 229.06;

/** `formatIsland`'s text span over the whole store range, px — MEASURED with a `width: max-content` clone. */
const CHIP_TEXT_MIN_PX = 128.53;
const CHIP_TEXT_MAX_PX = 208.09;

/** The landscape rows the acceptance matrix drives, widest-last. */
const LANDSCAPE_W = [568, 640, 667, 844, 924, 932] as const;

describe("the landscape header law", () => {
    it("reserves more chip text width than the longest string the store can produce", () => {
        const reserved = LANDSCAPE_CHIP_W - LANDSCAPE_CHIP_CHROME;
        expect(reserved).toBeGreaterThan(CHIP_TEXT_MAX_PX);
        /* And the reservation is not wastefully wide: it clears the longest text by under 20 px. */
        expect(reserved - CHIP_TEXT_MAX_PX).toBeLessThan(20);
        expect(reserved).toBeGreaterThan(CHIP_TEXT_MIN_PX);
    });

    it("every chip string the store can produce fits the reservation", () => {
        /*
         * An integer-stepped sweep of the store's own domain — `SST_MIN = 0` to `SST_MAX = 3`, one decimal
         * at a time, which is exactly the granularity `formatIsland` prints. Integer division rather than
         * `c += 0.01` so float drift cannot invent a value: the sampled set is the 31 strings a reader can
         * actually reach through the scrubber.
         *
         * `SST_MIN = 0` is worth stating plainly: the store is warm-only, so the LA NIÑA labels in
         * `ensoHud`'s table are NOT reachable here and the widest reachable string is a warm one. Measured
         * separately, a negative string is no wider than its positive twin (`−` and `+` are one monospace
         * cell each), so covering 0..3 covers the width question for every string in the table.
         */
        const reserved = LANDSCAPE_CHIP_W - LANDSCAPE_CHIP_CHROME;
        /* Measured widths are linear in character count at a monospace face: 208.09 px for 34 chars. */
        const PX_PER_CHAR =
            CHIP_TEXT_MAX_PX / "ENSO: +2.4°C | VERY STRONG EL NIÑO".length;
        expect(PX_PER_CHAR).toBeCloseTo(6.1203, 3);

        const strings: string[] = [];
        for (
            let i = Math.round(SST_MIN * 10);
            i <= Math.round(SST_MAX * 10);
            i += 1
        ) {
            strings.push(formatIsland(i / 10));
        }
        expect(strings).toHaveLength(31);
        expect([...new Set(strings)]).toHaveLength(31);
        /* Every band's label appears, so the sweep is not testing one string 31 times. */
        for (const label of [
            "NEUTRAL",
            "WEAK EL NIÑO",
            "MODERATE EL NIÑO",
            "STRONG EL NIÑO",
            "VERY STRONG EL NIÑO",
        ]) {
            expect(
                strings.some((t) => t.includes(label)),
                `${label} missing from the sweep`,
            ).toBe(true);
        }

        /*
         * Every reachable string fits the reservation. Several TIE at 34 characters (`+2.0`, `+2.4`, `+2.5`,
         * `+2.7` … all `VERY STRONG EL NIÑO`), so the assertion is over the whole set rather than over one
         * arbitrarily-chosen member.
         */
        const maxLen = strings.reduce((n, t) => Math.max(n, t.length), 0);
        expect(maxLen).toBe(34);
        for (const text of strings) {
            const px = text.length * PX_PER_CHAR;
            expect(
                px,
                `"${text}" implies ${px.toFixed(2)} px of text, over the ${reserved} px reserved`,
            ).toBeLessThanOrEqual(reserved);
        }
        /* And the 34-character tie really does reproduce the measured 208.09 px input. */
        expect(maxLen * PX_PER_CHAR).toBeCloseTo(CHIP_TEXT_MAX_PX, 1);
    });

    it("the row count is a function of width alone, and only of width", () => {
        for (const w of LANDSCAPE_W) {
            expect(landscapeHeaderRows(w)).toBe(
                w >= LANDSCAPE_ONE_ROW_MIN_W ? 1 : 2,
            );
        }
        /* Degenerate inputs report the two-row shape rather than throwing. */
        expect(landscapeHeaderRows(0)).toBe(2);
        expect(landscapeHeaderRows(Number.NaN)).toBe(2);
        expect(landscapeHeaderRows(-100)).toBe(2);
        /* The breakpoint itself belongs to the one-row side. */
        expect(landscapeHeaderRows(LANDSCAPE_ONE_ROW_MIN_W)).toBe(1);
        expect(landscapeHeaderRows(LANDSCAPE_ONE_ROW_MIN_W - 1)).toBe(2);
    });

    it("the one-row content budget is what the breakpoint clears — and 768 is short of it", () => {
        const budget = landscapeOneRowWidth();
        /* Measured content: 12 + (20 badge + 8 gap + 229.06 h1) + 12 + 252 + 12 + 194 + 12 = 751.06. */
        expect(budget).toBeCloseTo(
            12 + 20 + 8 + H1_NATURAL_PX + 12 + LANDSCAPE_CHIP_W + 12 + 194 + 12,
            6,
        );
        /* The chosen breakpoint has real slack inside the padding box. */
        expect(LANDSCAPE_ONE_ROW_MIN_W - 24).toBeGreaterThan(budget);
        /* 768 would NOT: that is the seven-pixel hole a 768 breakpoint would have re-created. */
        expect(768 - 24).toBeLessThan(budget);
    });

    it("the height is the sum of its rows, with no dependence on content", () => {
        expect(landscapeHeaderHeight(932)).toBe(
            LANDSCAPE_PAD_PX * 2 + LANDSCAPE_CONTROL_H,
        );
        expect(landscapeHeaderHeight(667)).toBe(
            LANDSCAPE_PAD_PX * 2 +
                LANDSCAPE_IDENTITY_H +
                LANDSCAPE_ROW_GAP_PX +
                LANDSCAPE_CONTROL_H,
        );
        /* One row is EXACTLY the control cluster plus padding; two rows add one identity row and one gap. */
        expect(landscapeHeaderHeight(932) - landscapeHeaderHeight(667)).toBe(
            -(LANDSCAPE_IDENTITY_H + LANDSCAPE_ROW_GAP_PX),
        );
        /* The function takes no data argument, so it cannot vary with the anomaly: same input, same output. */
        expect(landscapeHeaderHeight(667)).toBe(landscapeHeaderHeight(667));
        expect(landscapeHeaderRows(667)).toBe(2);
        expect(landscapeHeaderHeight(667)).toBe(76);
    });

    it("clears the F4 bound — headerBottom <= 0.25 * H — at every landscape row", () => {
        const ROWS = [
            { w: 667, h: 375 },
            { w: 844, h: 390 },
            { w: 924, h: 412 },
            { w: 932, h: 430 },
            { w: 568, h: 320 },
            { w: 640, h: 360 },
        ];
        for (const { w, h } of ROWS) {
            const top = landscapeHeaderHeight(w);
            expect(
                top,
                `${w}x${h} header ${top} vs 0.25H ${0.25 * h}`,
            ).toBeLessThanOrEqual(0.25 * h);
        }
        /* The tightest row is named rather than left to be rediscovered: 568x320 -> 76 vs 80.00. */
        const tight = ROWS.reduce((a, b) =>
            0.25 * b.h - landscapeHeaderHeight(b.w) <
            0.25 * a.h - landscapeHeaderHeight(a.w)
                ? b
                : a,
        );
        expect(tight).toEqual({ w: 568, h: 320 });
        expect(0.25 * tight.h - landscapeHeaderHeight(tight.w)).toBeCloseTo(
            4,
            6,
        );
    });

    it("leaves the 667x375 disc its 120 px — the radius budget the header term controls", () => {
        /*
         * In phoneLandscape `Rb = min(left.., right.., cy-top, bottom-cy) - 12` and `cy` is the vertical
         * midpoint, so the header term is `(H - top)/2 - 12`. The disc is `0.905 * Rb` (the same ratio the
         * committed matrix reports on every mobile row). At 667x375 with a 76 px header that is
         * `(375-76)/2 - 12 = 137.5` and `124.44 px` of radius — 4.44 px over the acceptance bound.
         */
        const H = 375;
        const top = landscapeHeaderHeight(667);
        const Rb = (H - top) / 2 - 12;
        expect(Rb).toBeCloseTo(137.5, 6);
        const r = 0.905 * Rb;
        expect(r).toBeGreaterThanOrEqual(120);
        expect(r).toBeCloseTo(124.44, 2);
        /* The pre-fix header (194.75) is what made this fail: Rb 78.125 and r 70.71. */
        const before = (H - 194.75) / 2 - 12;
        expect(before).toBeCloseTo(78.125, 6);
        expect(0.905 * before).toBeLessThan(120);
    });
});
