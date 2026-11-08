/**
 * Engine bootstrap orchestration.
 *
 * Translates a boot policy into an actual start, and owns the idempotency
 * guarantees:
 *
 *   - `initEngine()` is called once at app bootstrap and must be safe to call
 *     again (React StrictMode double-invokes effects in development).
 *   - `enableEngine()` is the user-initiated path, used by the "Load anyway"
 *     button, and must be legal from `deferred` *and* from `failed`.
 *
 * Why `idle` waits for both `load` and visibility: a hidden tab that boots a
 * 6.45 MiB wasm competes with whatever the user is actually looking at, and
 * `requestIdleCallback` does not fire in a background tab. Waiting for
 * `visibilityState === 'visible'` avoids a boot that would only be wasted if the
 * user never returns.
 */

import { decideBootPolicy, type DeviceSignals } from "@/lib/engine/policy";
import { engineStore } from "@/lib/engine/store";
import { runScenario, type BootMode } from "@/lib/duckdb";
import { loadDataset } from "@/lib/data/dataset";
import { whenSceneSettled } from "@/lib/engine/sceneGate";
import { AGRI_DEFAULT, JET_DEFAULT, SST_DEFAULT } from "@/lib/model";

/** `requestIdleCallback` timeout: boot even if the page never goes idle. */
const IDLE_TIMEOUT_MS = 4_000;

/** Fallback delay when requestIdleCallback is unavailable (Safari). */
const SET_TIMEOUT_FALLBACK_MS = 1_500;

/** True once a boot has been kicked off (or is being waited on). */
let started = false;

/**
 * The boot currently in flight, if any.
 *
 * Two paths can now race to call `start()`: the queued automatic boot resolving
 * off `whenSceneSettled()`, and a user click on the badge while the gate is still
 * holding the automatic boot (`enableEngine()` deliberately bypasses the gate).
 * Without this guard the loser restarts the store at 0 bytes and re-issues the
 * worker request — visible as a progress bar that jumps back to the start.
 *
 * `runScenario()` is already idempotent through `getClient()`'s singleton promise
 * so the network cost is paid once either way; this keeps the STORE honest, which
 * is what the badge renders.
 */
let bootInFlight: Promise<void> | null = null;

/** Held so the idle path can be cancelled if a user-initiated boot pre-empts it. */
let idleHandle: number | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let cancelIdle: (() => void) | null = null;

/** Read the device signals this module needs from the real browser. */
function readSignals(): DeviceSignals {
    const nav = navigator as Navigator & {
        connection?: {
            saveData?: boolean;
            effectiveType?: string;
            downlink?: number;
        };
        deviceMemory?: number;
    };

    return {
        connection: nav.connection
            ? {
                  saveData: nav.connection.saveData,
                  effectiveType: nav.connection.effectiveType,
                  downlink: nav.connection.downlink,
              }
            : undefined,
        deviceMemory: nav.deviceMemory,
        // A coarse primary pointer means touch-only (phones, most tablets).
        coarse:
            typeof window.matchMedia === "function"
                ? window.matchMedia("(pointer: coarse)").matches
                : undefined,
    };
}

/** The default scenario, used to warm the engine with a real query. */
const WARMUP_STATE = {
    sstAnomaly: SST_DEFAULT,
    jetStreamShift: JET_DEFAULT,
    agricultureWeight: AGRI_DEFAULT,
};

/**
 * Start the engine and resolve once it is ready or has failed.
 *
 * Resolves rather than rejects on failure: a failed boot is an expected outcome
 * (slow network, blocked CDN) that the store records, not an exception callers
 * must handle. Errors are surfaced through `engineStore` and the console.
 */
async function start(mode: BootMode): Promise<void> {
    started = true;

    // A user click can pre-empt an automatic boot that is still waiting on the gate.
    // Once the automatic path resolves it must not restart the store underneath the
    // boot the user already started. See `bootInFlight`.
    if (bootInFlight) return bootInFlight;

    // Nor may it re-enter after that boot FINISHED: `start()` reaches
    // `bootFromHost()`, which calls `engineStore.startBooting()` and resets the
    // progress bar to 0. A gate that resolves a beat after a user-initiated boot
    // completed would therefore flash "Loading DuckDB 0%" over a ready engine.
    const phase = engineStore.getSnapshot().phase;
    if (phase === "ready" || phase === "booting") return;

    bootInFlight = (async () => {
        try {
            // Hand DuckDB a PROMISE of the CSV text, not the text itself.
            //
            // Awaiting here would serialise the two large transfers: the worker script
            // and wasm could not start downloading until enso.csv had finished, adding
            // the CSV's latency to the boot on every link. Passing the promise lets the
            // wasm download overlap the CSV fetch, and duckdb.ts awaits it only at
            // table-registration time (after instantiate() resolves).
            //
            // The promise also guarantees a single request: DuckDB parses these exact
            // bytes via registerFileText instead of fetching the file again.
            const datasetText = loadDataset()
                .then((d) => d.text)
                .catch(() => null);

            // A cheap query is enough to force instantiation, register the CSV and
            // materialise the table. Its result is discarded: `useScenario` will run the
            // real scenario and bump the epoch when the store flips to `ready`.
            await runScenario(WARMUP_STATE, undefined, mode, datasetText);
        } catch (error) {
            // `getClient` already marked the store failed; this is only for visibility.
            console.warn(`[engine] boot did not complete (${mode}):`, error);
        } finally {
            // Cleared so the "Load anyway" / "Retry" affordance works after a failure:
            // a stuck promise here would swallow every later attempt.
            bootInFlight = null;
        }
    })();

    return bootInFlight;
}

/** Cancel a pending idle start, if any. */
function cancelPendingIdle(): void {
    if (cancelIdle) cancelIdle();
    if (idleTimer !== null) clearTimeout(idleTimer);
    if (
        idleHandle !== null &&
        typeof cancelIdle !== "function" &&
        "cancelIdleCallback" in window
    ) {
        window.cancelIdleCallback(idleHandle);
    }
    cancelIdle = null;
    idleTimer = null;
    idleHandle = null;
}

/** Run `cb` once the page is idle and visible. */
function whenIdleAndVisible(cb: () => void): void {
    let invoked = false;
    const once = () => {
        if (invoked) return;
        invoked = true;
        cancelPendingIdle();
        cb();
    };

    const scheduleIdle = () => {
        if (typeof window.requestIdleCallback === "function") {
            idleHandle = window.requestIdleCallback(
                () => {
                    idleHandle = null;
                    once();
                },
                { timeout: IDLE_TIMEOUT_MS },
            );
            cancelIdle = () => {
                if (idleHandle !== null) window.cancelIdleCallback(idleHandle);
                idleHandle = null;
            };
        } else {
            // Safari has no requestIdleCallback. A short timeout is the pragmatic
            // equivalent; it starts after the first paint either way.
            idleTimer = setTimeout(once, SET_TIMEOUT_FALLBACK_MS);
        }
    };

    const whenVisible = () => {
        if (document.visibilityState === "visible") {
            scheduleIdle();
            return;
        }
        const onVisible = () => {
            if (document.visibilityState === "visible") {
                document.removeEventListener("visibilitychange", onVisible);
                scheduleIdle();
            }
        };
        document.addEventListener("visibilitychange", onVisible);
    };

    if (document.readyState === "complete") {
        whenVisible();
    } else {
        window.addEventListener("load", whenVisible, { once: true });
    }
}

/**
 * Bootstrap the engine according to device policy.
 *
 * Call once at app startup. Idempotent: a second call is a no-op.
 */
export function initEngine(): void {
    if (started) return;

    const policy = decideBootPolicy(readSignals());

    if (policy === "on-demand") {
        // Leave the badge in `deferred` with the policy reason; enableEngine() will
        // pick it up when the user clicks. On-demand NEVER waits for the scene: the
        // user asked for the engine, so waiting on a texture would be a mystery delay.
        started = false;
        engineStore.markDeferred("policy");
        return;
    }

    if (policy === "idle") {
        started = true;
        // The engine is queued but will not touch the network for a while, so the UI
        // must not claim it failed or show a progress bar for a transfer that has not
        // begun. `'scene'` says "waiting for the globe", which is true.
        engineStore.markDeferred("scene");
        // Gate order for idle: scene settled, THEN idle, THEN visible. The scene gate
        // first because it is the long pole; idling before it would just re-serialise.
        whenIdleAndVisible(() => {
            void whenSceneSettled().then(() => {
                void start("auto");
            });
        });
        return;
    }

    // Eager: wait for the globe to settle before touching the wasm.
    //
    // §7 measured 2.08 MB of texture overlapping the boot and costing ~10 s of boot
    // time at 1.6 Mbps — 100% of non-boot traffic during boot. Letting the textures
    // finish first gives the engine the pipe to itself.
    //
    // `whenSceneSettled()` always resolves (ready / failed / timeout) and never
    // rejects, so a broken or slow scene can delay this by at most the gate's 120 s
    // safety timeout, and a failed scene boots immediately.
    //
    // The store is put in `deferred` with reason `'scene'` first, so the badge can
    // say what is actually happening: the engine is queued and waiting for the
    // globe. Without this the badge would show the pre-boot default (`'policy'`),
    // which tells the user to click "Load DuckDB" for a boot that is already on its
    // way, and a moment later flips to a progress bar for a transfer that had not
    // started. `start()` overwrites this with `booting` the instant it runs.
    engineStore.markDeferred("scene");
    void whenSceneSettled().then(() => {
        void start("auto");
    });
}

/**
 * User-initiated boot ("Load anyway" / "Retry").
 *
 * Legal from `deferred` and from `failed`. Idempotent while a boot is already in
 * flight so a double-click cannot start two workers.
 */
export function enableEngine(): void {
    const status = engineStore.getSnapshot();
    if (status.phase === "booting" || status.phase === "ready") return;

    // A user click pre-empts any pending idle start, and NEVER waits for the scene
    // gate: the user asked for the engine explicitly, so a texture still loading
    // must not delay it.
    cancelPendingIdle();
    started = true;
    void start("user");
}

/** Test seam: reset module-level state between cases. */
export function __resetInitEngine(): void {
    cancelPendingIdle();
    started = false;
    bootInFlight = null;
}
