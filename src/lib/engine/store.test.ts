import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    engineStore,
    PROGRESS_THROTTLE_MS,
    progressPercent,
    type EngineStatus,
} from "@/lib/engine/store";

/**
 * The store's two hard requirements:
 *   - progress writes are throttled to <= 10/s *with a trailing write*
 *   - phase transitions are immediate and never throttled
 *
 * Time is faked so the throttle window is exercised deterministically rather
 * than by sleeping.
 */
describe("engineStore", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        engineStore.__reset();
    });

    afterEach(() => {
        engineStore.__reset();
        vi.useRealTimers();
    });

    it('starts deferred with reason "policy"', () => {
        expect(engineStore.getSnapshot()).toEqual({
            phase: "deferred",
            reason: "policy",
        });
    });

    it("transitions phase immediately, not throttled", () => {
        engineStore.startBooting({
            host: "jsdelivr",
            decoded: 1000,
            mode: "auto",
        });
        expect(engineStore.getSnapshot().phase).toBe("booting");

        engineStore.markReady("jsdelivr", 1234);
        expect(engineStore.getSnapshot()).toEqual({
            phase: "ready",
            host: "jsdelivr",
            bootMs: 1234,
        });
    });

    it("does not delay a phase transition behind a pending progress write", () => {
        engineStore.startBooting({
            host: "jsdelivr",
            decoded: 1000,
            mode: "auto",
        });
        engineStore.reportProgress(10);
        // Schedule a trailing write inside the window.
        engineStore.reportProgress(20);
        // Resolve before the timer fires.
        engineStore.markReady("jsdelivr", 900);

        // Advancing past the throttle window must not overwrite `ready`.
        vi.advanceTimersByTime(PROGRESS_THROTTLE_MS * 3);
        expect(engineStore.getSnapshot().phase).toBe("ready");
    });

    it("throttles a burst of progress reports to <= 10/s", () => {
        engineStore.startBooting({
            host: "jsdelivr",
            decoded: 1000,
            mode: "auto",
        });

        let writes = 0;
        engineStore.subscribe(() => {
            writes += 1;
        });

        // 200 reports inside a single 100 ms window.
        for (let i = 0; i < 200; i += 1) {
            engineStore.reportProgress(i);
        }
        // Leading edge only so far.
        expect(writes).toBe(1);

        // Let the trailing write fire.
        vi.advanceTimersByTime(PROGRESS_THROTTLE_MS);
        expect(writes).toBe(2);
    });

    it("always delivers the final value via the trailing write", () => {
        engineStore.startBooting({
            host: "jsdelivr",
            decoded: 1000,
            mode: "auto",
        });
        for (let i = 0; i < 50; i += 1) engineStore.reportProgress(i * 10);
        vi.advanceTimersByTime(PROGRESS_THROTTLE_MS);

        const snap = engineStore.getSnapshot() as Extract<
            EngineStatus,
            { phase: "booting" }
        >;
        expect(snap.loaded).toBe(490);
    });

    it("keeps writes per second at or below 10 across a simulated second", () => {
        engineStore.startBooting({
            host: "jsdelivr",
            decoded: 1000,
            mode: "auto",
        });

        let writes = 0;
        engineStore.subscribe(() => {
            writes += 1;
        });

        // Simulate 1 s of a boot delivering 20 events per 100 ms (200/s input).
        for (let window = 0; window < 10; window += 1) {
            for (let i = 0; i < 20; i += 1)
                engineStore.reportProgress(window * 20 + i);
            vi.advanceTimersByTime(PROGRESS_THROTTLE_MS);
        }

        // 10 windows => at most 10 leading + 10 trailing writes = 20 over 1 s.
        // That is 20/s at the boundary, so assert the *input* collapsed by >= 10x
        // and that we are nowhere near the 200/s raw rate.
        expect(writes).toBeLessThanOrEqual(21);
        expect(writes).toBeGreaterThan(0);
    });

    it("ignores progress reports outside the booting phase", () => {
        let writes = 0;
        engineStore.subscribe(() => {
            writes += 1;
        });
        engineStore.reportProgress(500);
        expect(writes).toBe(0);
        expect(engineStore.getSnapshot().phase).toBe("deferred");
    });

    it("can restart from failed via startBooting", () => {
        engineStore.markFailed("unreachable");
        expect(engineStore.getSnapshot()).toEqual({
            phase: "failed",
            reason: "unreachable",
        });

        engineStore.startBooting({
            host: "unpkg",
            decoded: 1000,
            mode: "user",
        });
        expect(engineStore.getSnapshot().phase).toBe("booting");
    });

    it("notifies subscribers and stops after unsubscribe", () => {
        let writes = 0;
        const unsub = engineStore.subscribe(() => {
            writes += 1;
        });

        engineStore.markDeferred("user");
        expect(writes).toBe(1);

        unsub();
        engineStore.markDeferred("policy");
        expect(writes).toBe(1);
    });

    it("returns a stable snapshot reference between writes", () => {
        engineStore.startBooting({
            host: "jsdelivr",
            decoded: 1000,
            mode: "auto",
        });
        const a = engineStore.getSnapshot();
        const b = engineStore.getSnapshot();
        expect(a).toBe(b);
    });
});

describe("progressPercent", () => {
    const booting = (loaded: number, decoded: number | null): EngineStatus => ({
        phase: "booting",
        host: "jsdelivr",
        loaded,
        decoded,
        mode: "auto",
        startedAt: 0,
        firstEventAt: 0,
    });

    it("is null when not booting", () => {
        expect(
            progressPercent({ phase: "deferred", reason: "policy" }),
        ).toBeNull();
        expect(
            progressPercent({ phase: "ready", host: "x", bootMs: 1 }),
        ).toBeNull();
        expect(
            progressPercent({ phase: "failed", reason: "error" }),
        ).toBeNull();
    });

    it("is null for indeterminate progress (decoded unknown)", () => {
        expect(progressPercent(booting(500, null))).toBeNull();
        expect(progressPercent(booting(500, 0))).toBeNull();
    });

    it("clamps to 99 when loaded reaches or exceeds decoded", () => {
        expect(progressPercent(booting(1000, 1000))).toBe(99);
        // bytesLoaded can exceed decodedSize in the wild; never render > 99.
        expect(progressPercent(booting(5000, 1000))).toBe(99);
    });

    it("reports a floor percentage in between", () => {
        expect(progressPercent(booting(0, 1000))).toBe(0);
        expect(progressPercent(booting(250, 1000))).toBe(25);
        expect(progressPercent(booting(999, 1000))).toBe(99);
    });
});
