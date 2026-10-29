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

import { decideBootPolicy, type DeviceSignals } from '@/lib/engine/policy';
import { engineStore } from '@/lib/engine/store';
import { runScenario, type BootMode } from '@/lib/duckdb';
import { loadDataset } from '@/lib/data/dataset';
import { AGRI_DEFAULT, JET_DEFAULT, SST_DEFAULT } from '@/lib/model';

/** `requestIdleCallback` timeout: boot even if the page never goes idle. */
const IDLE_TIMEOUT_MS = 4_000;

/** Fallback delay when requestIdleCallback is unavailable (Safari). */
const SET_TIMEOUT_FALLBACK_MS = 1_500;

/** True once a boot has been kicked off (or is being waited on). */
let started = false;

/** Held so the idle path can be cancelled if a user-initiated boot pre-empts it. */
let idleHandle: number | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let cancelIdle: (() => void) | null = null;

/** Read the device signals this module needs from the real browser. */
function readSignals(): DeviceSignals {
  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string; downlink?: number };
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
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(pointer: coarse)').matches
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
  }
}

/** Cancel a pending idle start, if any. */
function cancelPendingIdle(): void {
  if (cancelIdle) cancelIdle();
  if (idleTimer !== null) clearTimeout(idleTimer);
  if (idleHandle !== null && typeof cancelIdle !== 'function' && 'cancelIdleCallback' in window) {
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
    if (typeof window.requestIdleCallback === 'function') {
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
    if (document.visibilityState === 'visible') {
      scheduleIdle();
      return;
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        document.removeEventListener('visibilitychange', onVisible);
        scheduleIdle();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
  };

  if (document.readyState === 'complete') {
    whenVisible();
  } else {
    window.addEventListener('load', whenVisible, { once: true });
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

  if (policy === 'on-demand') {
    // Leave the badge in `deferred` with the policy reason; enableEngine() will
    // pick it up when the user clicks.
    started = false;
    engineStore.markDeferred('policy');
    return;
  }

  if (policy === 'idle') {
    started = true;
    whenIdleAndVisible(() => {
      void start('auto');
    });
    return;
  }

  void start('auto');
}

/**
 * User-initiated boot ("Load anyway" / "Retry").
 *
 * Legal from `deferred` and from `failed`. Idempotent while a boot is already in
 * flight so a double-click cannot start two workers.
 */
export function enableEngine(): void {
  const status = engineStore.getSnapshot();
  if (status.phase === 'booting' || status.phase === 'ready') return;

  // A user click pre-empts any pending idle start.
  cancelPendingIdle();
  started = true;
  void start('user');
}

/** Test seam: reset module-level state between cases. */
export function __resetInitEngine(): void {
  cancelPendingIdle();
  started = false;
}
