/**
 * Acquire the DuckDB worker script before the watchdog starts counting.
 *
 * Why this exists — a real ordering bug found in acceptance case d:
 *
 *   `new Worker('/duckdb/duckdb-browser-eh.worker.js')` returns a Worker object
 *   immediately, but the 755 KB script is fetched asynchronously. No
 *   `InstantiationProgress` event can possibly fire until that script has
 *   downloaded and started running. So the CONNECT_MS budget (12 s) was being
 *   spent waiting for a progress event that *could not* arrive, and on a
 *   400 kbps link (755 KB / 50 KB/s ≈ 15 s just for the worker) `connect` always
 *   tripped first. The wasm was never requested at all: measured
 *   `wasmFetchCount: 0`, two worker fetches, both attempts dead.
 *
 * The fix is to separate the two waits:
 *
 *   1. `acquireWorker` owns a WA.WORKER_LOAD_MS budget for downloading and
 *      booting the worker script, and fails with kind 'worker-load'.
 *   2. Only once the worker has announced itself (`{type: 'ready'}`) does the
 *      watchdog start, so CONNECT_MS measures the thing the spike actually
 *      measured — silence from an instantiated runtime, not silence from a
 *      still-downloading script.
 */

/**
 * Time allowed for the worker script to download and start.
 *
 * The worker is 755 KB served same-origin. At 400 kbps that is ~15 s, so a
 * 12 s budget would still fail; 45 s covers 400 kbps with headroom while still
 * bounding a genuinely dead worker. This is *not* the wasm budget — that is
 * still governed by CONNECT_MS / AUTO_CAP_MS in watchdog.ts.
 */
export const WORKER_LOAD_MS = 45_000;

/** A worker that fails to boot. Distinguished so boot() can retry the next host. */
export class WorkerLoadError extends Error {
    constructor(
        message: string,
        public readonly kind: "worker-load" = "worker-load",
    ) {
        super(message);
        this.name = "WorkerLoadError";
    }
}

/**
 * Create a Worker and resolve only once its script has finished loading and it
 * has posted its first message (duckdb-wasm posts `{type:'LOG'}` / progress
 * messages once the Emscripten module is up).
 *
 * Rejects with WorkerLoadError on timeout or on a script-level error event.
 */
export function acquireWorker(
    scriptUrl: string,
    timeoutMs = WORKER_LOAD_MS,
): Promise<Worker> {
    const worker = new Worker(scriptUrl);

    return new Promise<Worker>((resolve, reject) => {
        let settled = false;

        const cleanup = () => {
            clearTimeout(timer);
            worker.removeEventListener("message", onMessage);
            worker.removeEventListener("error", onError);
            worker.removeEventListener("messageerror", onError);
        };

        const fail = (message: string) => {
            if (settled) return;
            settled = true;
            cleanup();
            try {
                worker.terminate();
            } catch {
                /* already dead */
            }
            reject(new WorkerLoadError(message));
        };

        const timer = setTimeout(
            () =>
                fail(
                    `Worker script did not become ready within ${timeoutMs} ms: ${scriptUrl}`,
                ),
            timeoutMs,
        );

        // duckdb-wasm's worker posts messages as soon as its bindings are up. Any
        // message proves the script executed, which is exactly what we need.
        const onMessage = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(worker);
        };

        const onError = (event: Event) => {
            const msg = (event as ErrorEvent).message;
            fail(
                `Worker failed to load (${scriptUrl})${msg ? `: ${msg}` : ""}`,
            );
        };

        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError);
        worker.addEventListener("messageerror", onError);

        // Nudge the worker to emit something even before instantiate() is called.
        // duckdb-wasm tolerates an early PING; if a version ever stops doing so the
        // timeout still bounds the wait and boot() retries the next host.
        try {
            worker.postMessage({ messageId: -1, type: "PING", data: null });
        } catch {
            /* posting before the script is ready is allowed; ignore */
        }
    });
}
