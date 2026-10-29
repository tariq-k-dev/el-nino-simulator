/**
 * Engine status store.
 *
 * A tiny external store rather than React state, because the boot lifecycle is
 * driven by a one-shot async operation that outlives any single component and
 * must be observable from several places (badge, scenario hook, tests) without
 * prop-drilling.
 *
 * Two deliberate behaviours:
 *
 * 1. **Progress writes are throttled to <=10/s with a trailing write.** The
 *    spike measured 66..4,469 progress events per boot (ENGINE_BOOT_SPIKE.md).
 *    Calling setState per event would re-render the badge thousands of times on
 *    a slow connection. The throttle collapses them; the trailing write
 *    guarantees the final value is never dropped.
 *
 * 2. **Phase transitions are immediate.** Booting -> ready/failed must not be
 *    delayed behind a throttle window, or the UI would hold a stale "loading"
 *    frame after the work is done.
 *
 * `useSyncExternalStore` needs a stable snapshot reference, so the snapshot
 * object is only replaced when something actually changes.
 */

import { useSyncExternalStore } from 'react';

export type FailedReason = 'too-slow' | 'unreachable' | 'error';

/**
 * Why the engine is not booting yet. Surfaced so the UI can explain itself.
 *
 *  - `'policy'` — device policy chose on-demand (saveData, 2G/3G, low RAM). Boot
 *    only happens if the user asks. This is a durable state, not a wait.
 *
 *  - `'scene'`  — an AUTOMATIC boot (eager or idle) is queued and is deliberately
 *    waiting for the globe to finish loading its textures first. It will start on
 *    its own; the user does not have to do anything. Distinct from `'policy'`
 *    because telling someone on a fast connection to press "Load DuckDB" when the
 *    engine is about to start itself is a lie, and a stalled progress bar is a
 *    worse one. A click here skips the wait — see `enableEngine()`.
 *
 *  - `'user'`   — reserved for a caller that explicitly parked the engine.
 */
export type DeferredReason = 'policy' | 'scene' | 'user';

export type EngineStatus =
  | { phase: 'deferred'; reason: DeferredReason }
  | {
      phase: 'booting';
      host: string;
      /** Decoded bytes loaded so far. */
      loaded: number;
      /** Decoded total for this bundle, or null when unknown (indeterminate). */
      decoded: number | null;
      mode: 'auto' | 'user';
      startedAt: number;
      /**
       * Timestamp of the FIRST progress event, or null before any bytes land.
       *
       * ETA and rate must be measured from here, not from `startedAt`: the boot
       * also includes acquiring the 755 KB worker script, during which no
       * progress can occur. Using `startedAt` divides a tiny byte count by a
       * large elapsed time and produces an absurd estimate (measured:
       * "~46346 s left" on a 400 kbps link).
       */
      firstEventAt: number | null;
    }
  | { phase: 'ready'; host: string; bootMs: number }
  | { phase: 'failed'; reason: FailedReason };

/** Progress updates at most this often (ms). 100 ms = 10 writes/s. */
export const PROGRESS_THROTTLE_MS = 100;

type Listener = () => void;

export interface EngineStore {
  subscribe(listener: Listener): () => void;
  getSnapshot(): EngineStatus;
}

/** The initial state: nothing has asked the engine to boot yet. */
const INITIAL: EngineStatus = { phase: 'deferred', reason: 'policy' };

function createStore() {
  let snapshot: EngineStatus = INITIAL;
  const listeners = new Set<Listener>();

  /** Timer for the trailing progress write, if one is pending. */
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingProgress: Extract<EngineStatus, { phase: 'booting' }> | null = null;
  let lastProgressAt = 0;

  const emit = () => {
    for (const listener of listeners) listener();
  };

  /** Replace the snapshot and notify. Used for immediate phase transitions. */
  const setImmediately = (next: EngineStatus) => {
    // Drop any queued progress write: it belongs to a phase that is now over.
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    pendingProgress = null;
    lastProgressAt = 0;

    snapshot = next;
    emit();
  };

  const flushPending = () => {
    pendingTimer = null;
    if (!pendingProgress) return;
    // Only apply if we are still in the booting phase it belongs to.
    if (snapshot.phase !== 'booting') {
      pendingProgress = null;
      return;
    }
    snapshot = pendingProgress;
    pendingProgress = null;
    lastProgressAt = Date.now();
    emit();
  };

  return {
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot() {
      return snapshot;
    },

    /** Start (or restart) a boot. Immediate. */
    startBooting(opts: { host: string; decoded: number | null; mode: 'auto' | 'user' }): void {
      setImmediately({
        phase: 'booting',
        host: opts.host,
        loaded: 0,
        decoded: opts.decoded,
        mode: opts.mode,
        startedAt: Date.now(),
        firstEventAt: null,
      });
    },

    /**
     * Report decoded bytes loaded. Throttled with a trailing write, so the last
     * value always lands. Never emits more than ~10 times per second.
     */
    reportProgress(loaded: number): void {
      if (snapshot.phase !== 'booting') return;

      const next: Extract<EngineStatus, { phase: 'booting' }> = {
        ...snapshot,
        loaded,
        // Stamp the first event so the badge can measure rate from real data
        // rather than from process start (which includes worker acquisition).
        firstEventAt: snapshot.firstEventAt ?? Date.now(),
      };
      const now = Date.now();
      const sinceLast = now - lastProgressAt;

      if (sinceLast >= PROGRESS_THROTTLE_MS) {
        // Leading edge: write immediately so the bar starts moving at once.
        snapshot = next;
        lastProgressAt = now;
        emit();
        return;
      }

      // Inside the window: queue a trailing write.
      pendingProgress = next;
      if (pendingTimer === null) {
        pendingTimer = setTimeout(flushPending, PROGRESS_THROTTLE_MS - sinceLast);
      }
    },

    /** Boot succeeded. Immediate. */
    markReady(host: string, bootMs: number): void {
      setImmediately({ phase: 'ready', host, bootMs });
    },

    /** Boot failed. Immediate. */
    markFailed(reason: FailedReason): void {
      setImmediately({ phase: 'failed', reason });
    },

    /** Return to the deferred state (e.g. policy said wait for the user). */
    markDeferred(reason: DeferredReason): void {
      setImmediately({ phase: 'deferred', reason });
    },

    /** Test seam: reset to the initial state and drop timers. */
    __reset(): void {
      if (pendingTimer !== null) clearTimeout(pendingTimer);
      pendingTimer = null;
      pendingProgress = null;
      lastProgressAt = 0;
      snapshot = INITIAL;
      listeners.clear();
    },
  };
}

export type EngineStoreInternal = ReturnType<typeof createStore>;

/**
 * The single store instance. The boot promise itself lives in boot.ts, so this
 * module stays free of network side effects and is trivially testable.
 */
export const engineStore: EngineStoreInternal = createStore();

/** Subscribe to engine status from React. */
export function useEngineStatus(): EngineStatus {
  return useSyncExternalStore(engineStore.subscribe, engineStore.getSnapshot, engineStore.getSnapshot);
}

/** Whole-percent progress, clamped to 99 until the engine is actually ready. */
export function progressPercent(status: EngineStatus): number | null {
  if (status.phase !== 'booting') return null;
  if (status.decoded === null || status.decoded <= 0) return null;

  const raw = Math.floor((status.loaded / status.decoded) * 100);
  // Never show 100% before the engine is ready: completion == instantiate()
  // resolving, and there is a silent ~0.3 s compile tail after the last event.
  if (status.loaded >= status.decoded) return 99;
  return Math.max(0, Math.min(99, raw));
}
