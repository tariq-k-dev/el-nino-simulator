/**
 * Determinism contract for the star field.
 *
 * The pixel specs sample open sky (the atmosphere profile walks 16 rays outward
 * from the limb), so a star that moves between loads makes those specs flaky in a
 * way that looks like a rendering bug. These tests pin the generator: same seed,
 * byte-identical buffers, and a different seed genuinely re-rolls.
 */
import { describe, expect, it } from "vitest";
import {
    STAR_SEED,
    buildStarfieldData,
    mulberry32,
} from "@/scene/starfieldData";

/** Bit-exact comparison of two Float32Arrays. */
function identical(a: Float32Array, b: Float32Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
    return true;
}

describe("mulberry32", () => {
    it("is a pure function of its seed", () => {
        const a = mulberry32(1234);
        const b = mulberry32(1234);
        for (let i = 0; i < 100; i += 1) expect(a()).toBe(b());
    });

    it("stays inside [0, 1)", () => {
        const r = mulberry32(7);
        for (let i = 0; i < 5000; i += 1) {
            const v = r();
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
    });

    it("produces a different sequence for a different seed", () => {
        const a = mulberry32(1);
        const b = mulberry32(2);
        const seqA = Array.from({ length: 20 }, () => a());
        const seqB = Array.from({ length: 20 }, () => b());
        expect(seqA).not.toEqual(seqB);
    });
});

describe("buildStarfieldData", () => {
    it("yields byte-identical buffers for the same seed across two independent builds", () => {
        const a = buildStarfieldData(500);
        const b = buildStarfieldData(500);
        expect(identical(a.positions, b.positions)).toBe(true);
        expect(identical(a.sizes, b.sizes)).toBe(true);
        expect(identical(a.colors, b.colors)).toBe(true);
        expect(identical(a.phases, b.phases)).toBe(true);
        expect(identical(a.rates, b.rates)).toBe(true);
        expect(identical(a.twinkle, b.twinkle)).toBe(true);
    });

    it("produces different positions for a different seed", () => {
        const a = buildStarfieldData(200, STAR_SEED);
        const b = buildStarfieldData(200, STAR_SEED + 1);
        expect(identical(a.positions, b.positions)).toBe(false);
    });

    it("emits every star on its declared shell radius, within floating-point error", () => {
        const count = 300;
        const { positions } = buildStarfieldData(count);
        // Shells are 26-42, 50-95 and 100-220 scene units.
        for (let i = 0; i < count; i += 1) {
            const r = Math.hypot(
                positions[i * 3],
                positions[i * 3 + 1],
                positions[i * 3 + 2],
            );
            expect(r).toBeGreaterThanOrEqual(26 - 1e-3);
            expect(r).toBeLessThanOrEqual(220 + 1e-3);
        }
    });

    it("keeps every attribute finite and in range", () => {
        const count = 400;
        const d = buildStarfieldData(count);
        for (let i = 0; i < count; i += 1) {
            expect(Number.isFinite(d.sizes[i])).toBe(true);
            expect(d.sizes[i]).toBeGreaterThan(0);
            expect(d.phases[i]).toBeGreaterThanOrEqual(0);
            expect(d.phases[i]).toBeLessThan(Math.PI * 2 + 1e-6);
            expect(d.rates[i]).toBeGreaterThanOrEqual(0.045);
            expect(d.rates[i]).toBeLessThanOrEqual(0.045 + 0.155 + 1e-6);
            expect(d.twinkle[i]).toBeGreaterThan(0);
            for (let c = 0; c < 3; c += 1) {
                expect(d.colors[i * 3 + c]).toBeGreaterThanOrEqual(0);
                expect(d.colors[i * 3 + c]).toBeLessThanOrEqual(1);
                expect(Number.isFinite(d.positions[i * 3 + c])).toBe(true);
            }
        }
    });

    it("is deterministic for the same seed at the production count", () => {
        const a = buildStarfieldData(14000);
        const b = buildStarfieldData(14000);
        expect(identical(a.positions, b.positions)).toBe(true);
    });
});
