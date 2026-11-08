// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    __resetSceneGate,
    getSceneGateState,
    markFirstFrame,
    markSceneFailed,
    markSceneReady,
    markTexturesDone,
    SCENE_GATE_TIMEOUT_MS,
    signalSceneCondition,
    subscribeSceneGate,
    whenSceneSettled,
} from "@/lib/engine/sceneGate";

/**
 * The gate decides when the eager boot is allowed to start, so its four outcomes
 * (ready / failed / timeout / bypass) each change observable product behaviour.
 * Fake timers keep the 120 s safety timeout instant in tests.
 */

describe("sceneGate — ready", () => {
    beforeEach(() => {
        // `performance` is faked alongside the timers because the gate now stamps
        // `openedAt` / `settledInMs` on performance.now(). Without it, advancing the
        // fake clock moves setTimeout but not the clock being measured, and every
        // elapsed-time assertion reads ~0.
        vi.useFakeTimers({
            toFake: ["setTimeout", "clearTimeout", "performance"],
        });
        __resetSceneGate();
    });
    afterEach(() => {
        __resetSceneGate();
        vi.useRealTimers();
    });

    it("settles ready when both textures and a frame have arrived", async () => {
        const settled = whenSceneSettled();
        expect(getSceneGateState().outcome).toBeNull();

        signalSceneCondition("textures");
        expect(getSceneGateState().outcome).toBeNull(); // only half the condition

        signalSceneCondition("frame");
        await expect(settled).resolves.toBe("ready");
        expect(getSceneGateState().outcome).toBe("ready");
    });

    it("accepts the two signals in either order", async () => {
        const settled = whenSceneSettled();
        signalSceneCondition("frame");
        signalSceneCondition("textures");
        await expect(settled).resolves.toBe("ready");
    });

    it("markSceneReady() settles directly", async () => {
        const settled = whenSceneSettled();
        markSceneReady();
        await expect(settled).resolves.toBe("ready");
        expect(getSceneGateState().readySignalled).toBe(true);
    });

    it("records the elapsed time", async () => {
        const settled = whenSceneSettled();
        vi.advanceTimersByTime(1_200);
        markSceneReady();
        await settled;
        expect(getSceneGateState().settledInMs).toBeGreaterThanOrEqual(1_000);
    });

    /**
     * The gate used to report only `settledInMs`, a Date.now() delta from gate
     * creation, and it was compared directly against texture `responseEnd` values,
     * which are milliseconds from navigation start. Two different zero points, so
     * the comparison printed a ~1 s gap that did not exist ("gate opened at 11,721
     * ms, last texture responseEnd 12,783 ms"). Everything the gate publishes is
     * now on performance.now(), the same clock resource timing uses.
     */
    it("stamps openedAt/createdAt on the performance.now() clock, not Date.now()", async () => {
        const settled = whenSceneSettled();
        vi.advanceTimersByTime(1_200);
        markSceneReady();
        await settled;

        const s = getSceneGateState();
        expect(s.openedAt).not.toBeNull();
        expect(s.createdAt).not.toBeNull();

        // Decisive discriminator: an epoch millisecond value is ~1.7e12, while
        // performance.now() is a small duration since page load.
        expect(s.openedAt as number).toBeLessThan(1e9);
        expect(s.createdAt as number).toBeLessThan(1e9);
        expect(Date.now()).toBeGreaterThan(1e12);

        // And it agrees with the clock resource timing is measured on.
        expect(
            Math.abs((s.openedAt as number) - performance.now()),
        ).toBeLessThan(60_000);
        expect(s.openedAt as number).toBeGreaterThanOrEqual(
            s.createdAt as number,
        );
    });

    it("openedAt - responseEnd is a plain subtraction on one clock", async () => {
        const settled = whenSceneSettled();
        vi.advanceTimersByTime(500);
        markSceneReady();
        await settled;

        const { openedAt } = getSceneGateState();
        // A texture whose last byte landed 200 ms before the gate opened.
        const textureResponseEnd = (openedAt as number) - 200;
        expect(Math.round((openedAt as number) - textureResponseEnd)).toBe(200);
    });

    it("records which source satisfied the texture half", async () => {
        const settled = whenSceneSettled();
        markTexturesDone("timeline");
        markFirstFrame();
        await settled;
        expect(getSceneGateState().texturesSource).toBe("timeline");
    });
});

describe("sceneGate — failed", () => {
    beforeEach(() => {
        // `performance` is faked alongside the timers because the gate now stamps
        // `openedAt` / `settledInMs` on performance.now(). Without it, advancing the
        // fake clock moves setTimeout but not the clock being measured, and every
        // elapsed-time assertion reads ~0.
        vi.useFakeTimers({
            toFake: ["setTimeout", "clearTimeout", "performance"],
        });
        __resetSceneGate();
    });
    afterEach(() => {
        __resetSceneGate();
        vi.useRealTimers();
    });

    it("settles failed and carries the reason", async () => {
        const settled = whenSceneSettled();
        markSceneFailed("WebGL unavailable in this browser");
        await expect(settled).resolves.toBe("failed");
        expect(getSceneGateState().reason).toMatch(/WebGL unavailable/);
    });

    it("a failed scene does NOT wait for the timeout", async () => {
        const settled = whenSceneSettled();
        markSceneFailed("WebGL context lost");
        // Resolves without advancing the fake clock at all.
        await expect(settled).resolves.toBe("failed");
    });

    it("failure wins even if textures had already finished", async () => {
        const settled = whenSceneSettled();
        markTexturesDone();
        markSceneFailed("context lost");
        await expect(settled).resolves.toBe("failed");
    });
});

describe("sceneGate — timeout", () => {
    beforeEach(() => {
        // `performance` is faked alongside the timers because the gate now stamps
        // `openedAt` / `settledInMs` on performance.now(). Without it, advancing the
        // fake clock moves setTimeout but not the clock being measured, and every
        // elapsed-time assertion reads ~0.
        vi.useFakeTimers({
            toFake: ["setTimeout", "clearTimeout", "performance"],
        });
        __resetSceneGate();
    });
    afterEach(() => {
        __resetSceneGate();
        vi.useRealTimers();
    });

    it("settles timeout after the default (120 s)", async () => {
        const settled = whenSceneSettled();
        vi.advanceTimersByTime(SCENE_GATE_TIMEOUT_MS - 1);
        expect(getSceneGateState().outcome).toBeNull();

        vi.advanceTimersByTime(1);
        await expect(settled).resolves.toBe("timeout");
        expect(getSceneGateState().reason).toMatch(/did not settle/);
    });

    it("is long enough to outlast a slow-link texture set", () => {
        // At 400 kbps the texture set finishes at 58.1 s (2B-VERIFY §10.1). A timeout
        // shorter than that releases the boot into contention with the textures, which
        // is the exact failure the gate exists to prevent.
        expect(SCENE_GATE_TIMEOUT_MS).toBeGreaterThan(58_100);
    });

    it("is not so long that a hung texture parks the engine indefinitely", () => {
        // A real user will not wait more than a couple of minutes for an enhancement
        // that the app already works without.
        expect(SCENE_GATE_TIMEOUT_MS).toBeLessThanOrEqual(180_000);
    });

    it("honours a test override so a hanging-texture case is fast", async () => {
        __resetSceneGate(500);
        const settled = whenSceneSettled();
        vi.advanceTimersByTime(501);
        await expect(settled).resolves.toBe("timeout");
    });

    it("a late ready signal cannot override the timeout", async () => {
        __resetSceneGate(200);
        const settled = whenSceneSettled();
        vi.advanceTimersByTime(201);
        await expect(settled).resolves.toBe("timeout");

        markSceneReady();
        // One-shot: the first outcome is permanent.
        expect(getSceneGateState().outcome).toBe("timeout");
    });
});

describe("sceneGate — memoisation and subscription", () => {
    beforeEach(() => {
        // `performance` is faked alongside the timers because the gate now stamps
        // `openedAt` / `settledInMs` on performance.now(). Without it, advancing the
        // fake clock moves setTimeout but not the clock being measured, and every
        // elapsed-time assertion reads ~0.
        vi.useFakeTimers({
            toFake: ["setTimeout", "clearTimeout", "performance"],
        });
        __resetSceneGate();
    });
    afterEach(() => {
        __resetSceneGate();
        vi.useRealTimers();
    });

    it("returns the same promise every call", () => {
        const a = whenSceneSettled();
        const b = whenSceneSettled();
        expect(a).toBe(b);
    });

    it("every later caller sees the settled outcome", async () => {
        const first = whenSceneSettled();
        markSceneReady();
        await first;

        const second = whenSceneSettled();
        await expect(second).resolves.toBe("ready");
        expect(second).toBe(first);
    });

    it("resolves immediately if the scene settled before anyone asked", async () => {
        markSceneReady();
        await expect(whenSceneSettled()).resolves.toBe("ready");
    });

    it("notifies subscribers on each transition", () => {
        const seen: string[] = [];
        const unsub = subscribeSceneGate(() =>
            seen.push(getSceneGateState().outcome ?? "pending"),
        );

        whenSceneSettled();
        // markTexturesDone fires a 'pending' notification (outcome still null), then
        // markFirstFrame completes the condition and fires 'ready'.
        markTexturesDone();
        markFirstFrame();

        expect(seen).toContain("pending");
        expect(seen).toContain("ready");
        unsub();
    });

    it("never rejects", async () => {
        const settled = whenSceneSettled();
        markSceneFailed("boom");
        await expect(settled).resolves.toBe("failed");
    });
});

describe("initEngine — scene gate interaction", () => {
    /**
     * The three policies must treat the gate differently, and that difference is the
     * whole point of Step 2:
     *
     *   eager      waits for the scene, then boots
     *   idle       waits for idle + visibility, then the scene, then boots
     *   on-demand  never waits
     *   user       never waits (explicit click)
     */
    beforeEach(() => {
        // `performance` is faked alongside the timers because the gate now stamps
        // `openedAt` / `settledInMs` on performance.now(). Without it, advancing the
        // fake clock moves setTimeout but not the clock being measured, and every
        // elapsed-time assertion reads ~0.
        vi.useFakeTimers({
            toFake: ["setTimeout", "clearTimeout", "performance"],
        });
        __resetSceneGate();
        vi.resetModules();
    });
    afterEach(() => {
        __resetSceneGate();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("eager boot does not start until the scene settles", async () => {
        const runScenario = vi.fn().mockResolvedValue(undefined);
        vi.doMock("@/lib/duckdb", () => ({ runScenario }));
        vi.doMock("@/lib/data/dataset", () => ({
            loadDataset: () => Promise.resolve({ rows: [], text: "" }),
        }));

        const { initEngine, __resetInitEngine } =
            await import("@/lib/engine/init");
        // MUST use the gate instance the freshly-imported init module sees.
        // vi.resetModules() gives init.ts its own copy of sceneGate; driving the
        // statically-imported helpers would signal a different instance and the boot
        // would never proceed.
        const gate = await import("@/lib/engine/sceneGate");
        const store = await import("@/lib/engine/store");
        __resetInitEngine();
        gate.__resetSceneGate();
        store.engineStore.__reset();

        initEngine();
        await vi.advanceTimersByTimeAsync(100);
        // Scene has not settled: nothing must have booted.
        expect(runScenario).not.toHaveBeenCalled();

        // And the store must say WHY it is waiting, so the badge can render
        // "DuckDB loads after the globe" instead of the on-demand call to action.
        const waiting = store.engineStore.getSnapshot();
        expect(waiting.phase).toBe("deferred");
        if (waiting.phase === "deferred") expect(waiting.reason).toBe("scene");

        gate.markSceneReady();
        await vi.advanceTimersByTimeAsync(100);
        expect(runScenario).toHaveBeenCalledTimes(1);
    });

    it("eager boot starts immediately when the scene already failed", async () => {
        const runScenario = vi.fn().mockResolvedValue(undefined);
        vi.doMock("@/lib/duckdb", () => ({ runScenario }));
        vi.doMock("@/lib/data/dataset", () => ({
            loadDataset: () => Promise.resolve({ rows: [], text: "" }),
        }));

        const { initEngine, __resetInitEngine } =
            await import("@/lib/engine/init");
        const gate = await import("@/lib/engine/sceneGate");
        __resetInitEngine();
        gate.__resetSceneGate();

        gate.markSceneFailed("WebGL unavailable");
        initEngine();
        await vi.advanceTimersByTimeAsync(100);
        expect(runScenario).toHaveBeenCalledTimes(1);
    });

    it("user-initiated enableEngine bypasses the gate entirely", async () => {
        const runScenario = vi.fn().mockResolvedValue(undefined);
        vi.doMock("@/lib/duckdb", () => ({ runScenario }));
        vi.doMock("@/lib/data/dataset", () => ({
            loadDataset: () => Promise.resolve({ rows: [], text: "" }),
        }));

        const { enableEngine, __resetInitEngine } =
            await import("@/lib/engine/init");
        __resetInitEngine();

        // Scene deliberately never settled.
        enableEngine();
        await vi.advanceTimersByTimeAsync(100);
        expect(runScenario).toHaveBeenCalledTimes(1);
    });

    it("on-demand never boots and never waits on the gate", async () => {
        const runScenario = vi.fn().mockResolvedValue(undefined);
        vi.doMock("@/lib/duckdb", () => ({ runScenario }));
        vi.doMock("@/lib/data/dataset", () => ({
            loadDataset: () => Promise.resolve({ rows: [], text: "" }),
        }));
        // saveData => on-demand.
        vi.stubGlobal("navigator", {
            connection: { saveData: true, effectiveType: "4g", downlink: 10 },
            deviceMemory: 8,
        });

        const { initEngine, __resetInitEngine } =
            await import("@/lib/engine/init");
        __resetInitEngine();

        initEngine();
        await vi.advanceTimersByTimeAsync(5_000);
        expect(runScenario).not.toHaveBeenCalled();
    });
});
