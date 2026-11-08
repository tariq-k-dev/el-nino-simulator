/**
 * `lookTime` — the frozen-scene time rule.
 *
 * These tests exist because the two shader-uniform writers it replaced were both unconditional,
 * and nothing caught it: the look suite measures one frozen frame at a time, so a halo that keeps
 * breathing between two captures passes every threshold in the spec and still makes a pixel
 * baseline meaningless.
 */
import { describe, expect, it } from "vitest";
import { GLOBE_LOOK } from "./globeLook";
import { FROZEN_LOOK_TIME, lookTime } from "./lookTime";

describe("lookTime", () => {
    it("returns elapsedTime unchanged when the scene is animating", () => {
        // The live product's path. Byte-identical to the `uTime = elapsedTime` it replaced.
        expect(lookTime(true, 0)).toBe(0);
        expect(lookTime(true, 12.3456)).toBe(12.3456);
        expect(lookTime(true, 1e6)).toBe(1e6);
    });

    it("returns the frozen constant for ANY elapsed value when animate is false", () => {
        /*
         * The point of the constant: two page loads reach their first screenshot at different
         * `elapsedTime`s, so a value that carries the clock through would render a different frame
         * per load. Iterating over elapsed values is what makes that a property of the helper rather
         * than of one call site's timing.
         */
        for (const elapsed of [0, 0.016, 1, 12.3456, 600, 1e6]) {
            expect(lookTime(false, elapsed)).toBe(FROZEN_LOOK_TIME);
        }
    });

    it("freezes at 0, the same constant the starfield already used", () => {
        // Not "whatever the clock said last": a literal, and the same literal as Starfield.tsx:109.
        expect(FROZEN_LOOK_TIME).toBe(0);
    });

    it("is a pure function of its arguments — no clock, no state", () => {
        // Calling it twice with the same input cannot differ, which is what makes it safe to use
        // inside useFrame (once per component, per frame).
        expect(lookTime(false, 5)).toBe(lookTime(false, 5));
        expect(lookTime(true, 5)).toBe(lookTime(true, 5));
        expect(lookTime(true, 5)).not.toBe(lookTime(false, 5));
    });

    it("gives the atmosphere breathe term the same value as a frozen starfield", () => {
        /*
         * `shaders.ts:114`: `breathe = 1 - amp + amp * sin(uTime * 0.6)`. At the frozen constant the
         * sine is 0, so breathe is exactly `1 - amp` = 0.985 with the shipped `breatheAmplitude`
         * 0.015 — the trough of the cycle, and a fixed number rather than wherever the clock was.
         */
        const amp = GLOBE_LOOK.atmosphere.breatheAmplitude;
        const breathe = 1 - amp + amp * Math.sin(lookTime(false, 47.2) * 0.6);
        expect(breathe).toBeCloseTo(1 - amp, 12);
        expect(breathe).toBeCloseTo(0.985, 12);
    });

    it("gives the pin ring pulse a fixed phase that depends only on uPhase", () => {
        /*
         * `shaders.ts:227`: `t = fract(uTime * 0.45 + uPhase)`. At the frozen constant `t` collapses
         * to `fract(uPhase)`, so the ring is a still image whose shape is set by the per-pin phase —
         * deterministic within a load, and identical across loads.
         */
        for (const phase of [0, 0.31, 0.5, 0.999]) {
            const t = (lookTime(false, 12.3) * 0.45 + phase) % 1;
            expect(t).toBeCloseTo(phase % 1, 12);
        }
    });
});
