import { afterEach, describe, expect, it, vi } from "vitest";
import {
    acquireWorker,
    WORKER_LOAD_MS,
    WorkerLoadError,
} from "@/lib/engine/workerBoot";

/**
 * Pins the ordering contract that acceptance case d exposed.
 *
 * The bug: CONNECT_MS (12 s) was being spent before the 755 KB worker script had
 * even downloaded, so on a 400 kbps link (≈15 s for the worker alone) `connect`
 * always tripped and the wasm was never requested (`wasmFetchCount: 0`).
 * `acquireWorker` now owns that wait separately, and only resolves once the
 * worker has executed.
 */

/** Minimal Worker stand-in that mimics the message/error lifecycle. */
class FakeWorker {
    static instances: FakeWorker[] = [];
    listeners: Record<string, Array<(e: unknown) => void>> = {};
    terminated = false;
    posted: unknown[] = [];

    constructor(public url: string) {
        FakeWorker.instances.push(this);
    }

    addEventListener(type: string, fn: (e: unknown) => void) {
        (this.listeners[type] ??= []).push(fn);
    }

    removeEventListener(type: string, fn: (e: unknown) => void) {
        this.listeners[type] = (this.listeners[type] ?? []).filter(
            (f) => f !== fn,
        );
    }

    postMessage(msg: unknown) {
        this.posted.push(msg);
    }

    terminate() {
        this.terminated = true;
    }

    /** Simulate the script loading and emitting its first message. */
    emitMessage(data: unknown = { type: "LOG" }) {
        for (const fn of this.listeners.message ?? []) fn({ data });
    }

    emitError(message = "boom") {
        for (const fn of this.listeners.error ?? []) fn({ message });
    }
}

describe("acquireWorker", () => {
    const realWorker = globalThis.Worker;

    afterEach(() => {
        vi.useRealTimers();
        FakeWorker.instances = [];
        globalThis.Worker = realWorker;
    });

    function install() {
        vi.useFakeTimers();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        globalThis.Worker = FakeWorker as any;
    }

    it("resolves only after the worker posts its first message", async () => {
        install();
        const promise = acquireWorker("/duckdb/duckdb-browser-eh.worker.js");
        const worker = FakeWorker.instances[0];

        // Still pending: constructing a Worker does NOT mean it has loaded.
        let resolved = false;
        void promise.then(() => {
            resolved = true;
        });
        await vi.advanceTimersByTimeAsync(100);
        expect(resolved).toBe(false);

        worker.emitMessage();
        await expect(promise).resolves.toBe(worker);
    });

    it("rejects with WorkerLoadError when the script never starts", async () => {
        install();
        // Attach the expectation BEFORE advancing time: the rejection fires inside
        // the timer tick, and a handler attached afterwards would surface as an
        // unhandled rejection.
        const assertion = expect(
            acquireWorker("/slow.worker.js", 5_000),
        ).rejects.toBeInstanceOf(WorkerLoadError);
        await vi.advanceTimersByTimeAsync(5_001);
        await assertion;
    });

    it("terminates the worker on timeout so a dead attempt cannot leak", async () => {
        install();
        const assertion = expect(
            acquireWorker("/slow.worker.js", 1_000),
        ).rejects.toBeInstanceOf(WorkerLoadError);
        const worker = FakeWorker.instances[0];
        await vi.advanceTimersByTimeAsync(1_001);
        await assertion;
        expect(worker.terminated).toBe(true);
    });

    it("rejects with WorkerLoadError on a script error event", async () => {
        install();
        const assertion = expect(
            acquireWorker("/bad.worker.js"),
        ).rejects.toBeInstanceOf(WorkerLoadError);
        FakeWorker.instances[0].emitError("SyntaxError");
        await assertion;
    });

    it("carries a worker-load kind so boot() retries the next host", async () => {
        install();
        const assertion = acquireWorker("/bad.worker.js", 100).catch(
            (e: WorkerLoadError) => {
                expect(e.kind).toBe("worker-load");
                expect(e.name).toBe("WorkerLoadError");
            },
        );
        await vi.advanceTimersByTimeAsync(101);
        await assertion;
    });

    it("sends a PING so the worker has a reason to emit a first message", async () => {
        install();
        const p = acquireWorker("/w.js");
        // Never resolves in this test; keep the promise handled then settle it.
        p.catch(() => {});
        expect(FakeWorker.instances[0].posted).toContainEqual(
            expect.objectContaining({ type: "PING" }),
        );
        FakeWorker.instances[0].emitMessage();
        await p;
    });

    it("has a budget large enough for the real 755 KB worker on 400 kbps", () => {
        // 755 KB / (400 kbps / 8) = ~15.1 s of pure transfer; the budget must leave
        // meaningful headroom or case d regresses straight back to a connect trip.
        const workerKB = 755;
        const kbps400BytesPerSec = (400 * 1024) / 8;
        const transferSec = (workerKB * 1024) / kbps400BytesPerSec;
        expect(transferSec).toBeLessThan(WORKER_LOAD_MS / 1000);
    });

    it("is longer than CONNECT_MS, since the worker must load before any event", () => {
        // If CONNECT_MS >= WORKER_LOAD_MS the ordering fix is pointless: the connect
        // budget would still expire while the script is downloading.
        expect(WORKER_LOAD_MS).toBeGreaterThan(12_000);
    });
});
