/**
 * Scene-ready gate.
 *
 * Why gate the engine on the scene at all
 * ---------------------------------------
 * §7 of 2B-VERIFY.md measured 2.08 MB of globe texture overlapping the boot and
 * costing ~10 s of boot time at 1.6 Mbps — 100% of non-boot traffic during boot.
 * The R3F tree mounts and starts pulling textures immediately, so the wasm and the
 * textures fight for the same link. Making the eager boot wait until those
 * transfers are done removes the contention: the engine gets the pipe to itself.
 *
 * What "settled" means
 * --------------------
 *   READY  = every texture drei has tracked finished (`active === false`,
 *            `progress === 100`) AND at least one WebGL frame has been rendered.
 *            The frame condition matters because `active` can be false before the
 *            first paint when nothing needed loading.
 *   FAILED = WebGL is unavailable, the context was lost, or the scene's error
 *            boundary tripped. A failed scene must NEVER block the engine — booting
 *            DuckDB is still useful when the globe cannot render.
 *   TIMEOUT = `SCENE_GATE_TIMEOUT_MS` (120 s default, overridable for tests). A
 *            hanging texture request must not park the engine forever — but the
 *            engine is an enhancement, so waiting longer is the cheaper mistake.
 *
 * The gate is one-shot and memoised: whatever the first outcome is, every later
 * caller sees the same settled promise. `whenSceneSettled()` never rejects.
 *
 * One clock
 * ---------
 * Every timestamp this module publishes (`createdAt`, `openedAt`, and therefore
 * `settledInMs`) is on `performance.now()`. That is the same time origin as
 * `PerformanceResourceTiming.responseEnd`, so "did the gate open before the last
 * texture finished?" is a subtraction rather than a guess.
 *
 * It did not used to be. `settledInMs` was a `Date.now()` delta from gate
 * creation while texture timings came from resource timing (navigation-relative),
 * and the two were subtracted anyway. The gate is created when the app calls
 * `initEngine()`, so its zero is late in the load: at 1.6 Mbps that produced
 * "gate opened at 11,721 ms, last texture ended at 12,783 ms" — a ~1 s gap that
 * was entirely the missing offset. See docs/2B-VERIFY.md §12.
 */

import {
  describeTextureTimeline,
  snapshotTextures,
  textureStatus,
} from '@/lib/engine/textureTimeline';

/**
 * How long the scene gets before the gate gives up and lets the engine boot.
 *
 * 120 s, not 30 s. The asymmetry is deliberate:
 *
 *  - **A long wait is harmless.** DuckDB is an enhancement now: the scenario
 *    metrics come from model.ts and history/analogs come from the parsed CSV, so
 *    every number on screen is already correct and interactive before the engine
 *    starts. Nothing the user can see is blocked while the gate is closed.
 *
 *  - **A short wait is actively harmful.** If the gate times out mid-texture, the
 *    wasm and the remaining textures then compete for the same pipe. Measured at
 *    400 kbps: textures finish at 58.1 s alone, but the 30 s timeout released the
 *    boot at 30 s and the two transfers interleaved, finishing at ~42 s with
 *    1.43 MB of texture overlapping the boot (2B-VERIFY §10.1).
 *
 *  The break-even link is ~0.6 Mbps: below that, textures outlast any sane
 *  timeout; above it, a 120 s timeout is never reached because the textures land
 *  in 12–22 s. 120 s covers the slow-but-finite case without becoming an
 *  unbounded wait.
 *
 * The test override (`__SCENE_GATE_TIMEOUT_OVERRIDE__`, E2E builds only) still
 * shortens this so the hanging-texture spec finishes quickly.
 */
export const SCENE_GATE_TIMEOUT_MS = 120_000;

export type SceneOutcome = 'ready' | 'failed' | 'timeout';

export interface SceneGateState {
  /** Resolved outcome, or null while the scene is still settling. */
  outcome: SceneOutcome | null;
  /** Ms from gate creation to settling, measured on `performance.now()`. */
  settledInMs: number | null;
  /**
   * `performance.now()` at settling — the SAME clock as
   * `PerformanceResourceTiming.responseEnd`.
   *
   * This is the field to compare against a texture's `responseEnd`. The gate used
   * to report only `settledInMs` (a `Date.now()` delta from gate creation), and
   * comparing that against responseEnd values measured from navigation start
   * produced a phantom ~1 s gap — the gate is created when `initEngine()` runs,
   * well after navigation start, so the two numbers do not share an origin.
   */
  openedAt: number | null;
  /** `performance.now()` at gate creation, for the same reconciliation. */
  createdAt: number | null;
  /** Human-readable reason, for the badge tooltip and diagnostics. */
  reason: string | null;
  /** True once `markSceneReady()` has been called. */
  readySignalled: boolean;
  /** True once a texture/frame condition was satisfied. */
  texturesDone: boolean;
  frameRendered: boolean;
  /**
   * How the texture half of the condition was satisfied. `timeline` is the
   * real one (the loading manager saw every item settle); `progress` is the
   * drei aggregate used when the timeline has nothing to say, which is only the
   * case in unit tests that drive the gate directly.
   */
  texturesSource: 'timeline' | 'progress' | null;
  /** Number of asset items the loading manager had registered at gate-open. */
  assetsStarted: number | null;
}

type Listener = () => void;

let state: SceneGateState = {
  outcome: null,
  settledInMs: null,
  openedAt: null,
  createdAt: null,
  reason: null,
  readySignalled: false,
  texturesDone: false,
  frameRendered: false,
  texturesSource: null,
  assetsStarted: null,
};

let listeners = new Set<Listener>();
let settledPromise: Promise<SceneOutcome> | null = null;
let resolveSettled: ((o: SceneOutcome) => void) | null = null;
let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * performance.now() when the gate was created.
 *
 * Paired with an explicit `hasCreatedAt` flag rather than a `0` sentinel:
 * `performance.now()` legitimately returns 0 at navigation start, and under
 * fake timers it always starts there, so `createdAt === 0` cannot distinguish
 * "not yet created" from "created at time zero".
 */
let createdAt = 0;
let hasCreatedAt = false;
let timeoutOverride: number | null = null;

/**
 * The one clock this module reports in.
 *
 * `performance.now()` shares its time origin with `PerformanceResourceTiming`,
 * so a gate-open timestamp and a texture `responseEnd` are directly comparable.
 * `Date.now()` does not, and neither does a duration measured from an arbitrary
 * later moment — see `openedAt`.
 */
const clock = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const emit = () => {
  for (const l of listeners) l();
};

const settle = (outcome: SceneOutcome, reason: string) => {
  // One-shot: the first outcome wins and is permanent.
  if (state.outcome !== null) return;

  const openedAt = clock();
  state = {
    ...state,
    outcome,
    openedAt,
    createdAt: hasCreatedAt ? createdAt : null,
    settledInMs: hasCreatedAt ? openedAt - createdAt : 0,
    reason,
    assetsStarted: assetsStartedAtOpen(),
  };

  if (timeoutTimer !== null) {
    clearTimeout(timeoutTimer);
    timeoutTimer = null;
  }
  resolveSettled?.(outcome);
  emit();
};

/** Mark the scene as fully settled (textures complete AND a frame drawn). */
export function markSceneReady(reason = 'textures loaded and first frame rendered'): void {
  if (state.outcome !== null) return;
  state = { ...state, readySignalled: true, reason };
  settle('ready', reason);
}

/** Mark the scene as unable to render. Never blocks the engine. */
export function markSceneFailed(reason: string): void {
  settle('failed', reason);
}

/** How many asset items the loading manager had registered when the gate settled. */
const assetsStartedAtOpen = (): number => textureStatus().started;

/**
 * Record that every tracked texture finished.
 *
 * Two sources feed this, and the completeness of the answer is the whole point:
 *
 *  - `'timeline'` — `textureTimeline.allTexturesSettled()`. Every item three's
 *    `DefaultLoadingManager` registered has resolved or errored. This is the
 *    authoritative condition because it is per-item: an in-flight item keeps
 *    the gate closed no matter what the aggregate says.
 *
 *  - `'progress'` — drei's `useProgress` aggregate
 *    (`active === false && progress === 100`). Kept as a fallback for callers
 *    that drive the gate directly (unit tests) and for the case where the
 *    timeline has seen nothing at all.
 *
 * The aggregate alone was NOT sufficient. Its `progress` computation is
 * `(loaded - saveLastTotalLoaded) / (total - saveLastTotalLoaded) * 100 || 100`,
 * and `saveLastTotalLoaded` is pinned to `total` on the first `onLoad`. A new
 * item started afterwards gives a zero denominator, so the expression is `NaN`,
 * the `|| 100` turns it into 100, and `active` is momentarily false between
 * waves — i.e. the aggregate reports "done" while a texture is still in flight.
 * That is precisely how the gate could open ahead of the last texture.
 *
 * Completes the gate if the first frame has also been drawn. Making each half
 * self-checking means callers cannot get it wrong by signalling one part and
 * forgetting to re-evaluate the pair — an earlier version only settled through
 * `signalSceneCondition`, so a direct `markFirstFrame()` silently never resolved.
 */
export function markTexturesDone(source: 'timeline' | 'progress' = 'progress'): void {
  if (state.outcome !== null) return;
  state = { ...state, texturesDone: true, texturesSource: source };
  if (state.frameRendered) {
    markSceneReady();
    return;
  }
  emit();
}

/** Record that the first WebGL frame has been presented. */
export function markFirstFrame(): void {
  if (state.outcome !== null) return;
  state = { ...state, frameRendered: true };
  if (state.texturesDone) {
    markSceneReady();
    return;
  }
  emit();
}

/**
 * Call both halves of the ready condition and settle when both hold.
 *
 * Split from `markSceneReady` so the two signals can arrive in either order
 * (textures can finish before the first frame, or vice versa when nothing loads).
 */
export function signalSceneCondition(
  part: 'textures' | 'frame',
  source: 'timeline' | 'progress' = 'progress',
): void {
  if (state.outcome !== null) return;
  if (part === 'textures') markTexturesDone(source);
  else markFirstFrame();

  if (state.texturesDone && state.frameRendered) {
    markSceneReady();
  }
}

/**
 * A promise that resolves once the scene is ready, failed, or timed out.
 *
 * Memoised: created on first call and reused forever. Resolves, never rejects —
 * a failed or timed-out scene is a normal outcome the caller proceeds from.
 */
export function whenSceneSettled(): Promise<SceneOutcome> {
  if (settledPromise) return settledPromise;

  // performance.now(), not Date.now(): see "One clock" in the module header.
  createdAt = clock();
  hasCreatedAt = true;
  settledPromise = new Promise<SceneOutcome>((resolve) => {
    resolveSettled = resolve;
  });

  // If the scene already settled before anyone asked, resolve immediately.
  if (state.outcome !== null) {
    resolveSettled?.(state.outcome);
    return settledPromise;
  }

  // E2E override: a hanging-texture test must not wait the full 30 s. Read from
  // the page rather than plumbing a prop through React — the gate lives outside
  // the component tree.
  //
  // E2E-only by construction: VITE_E2E is a compile-time literal, so in a
  // production build this branch folds to `undefined` and the property name is
  // removed. scripts/check-assets.mjs asserts that.
  const pageOverride =
    import.meta.env.VITE_E2E === '1' && typeof window !== 'undefined'
      ? (window as { __SCENE_GATE_TIMEOUT_OVERRIDE__?: number }).__SCENE_GATE_TIMEOUT_OVERRIDE__
      : undefined;
  const ms = timeoutOverride ?? pageOverride ?? SCENE_GATE_TIMEOUT_MS;
  timeoutTimer = setTimeout(() => {
    settle('timeout', `scene did not settle within ${ms} ms — booting anyway`);
  }, ms);

  return settledPromise;
}

/**
 * Current gate state, for the badge/diagnostics.
 *
 * `createdAt` is derived from the live module variable rather than read off
 * `state`, because `state` is only rebuilt when something TRANSITIONS. Reading
 * `state.createdAt` while the gate is still open returns null — which made "was
 * the dataset requested before the gate was even created?" unanswerable from
 * outside, the one question that proves the dataset load is not on the boot path.
 */
export function getSceneGateState(): SceneGateState {
  return {
    ...state,
    createdAt: hasCreatedAt ? createdAt : null,
    // Once settled, `settledInMs` and `openedAt` are the frozen pair; while open,
    // report the elapsed time so a diagnostic can see how long it has been waiting.
    settledInMs:
      state.settledInMs !== null
        ? state.settledInMs
        : hasCreatedAt
          ? Math.round(clock() - createdAt)
          : null,
  };
}

/**
 * E2E-only: publish the gate state so a trace can read the exact gate-open time.
 *
 * Guarded by the compile-time VITE_E2E literal, so the assignment (and the hook
 * name) are removed from a production bundle. check-assets.mjs asserts that.
 */
if (import.meta.env.VITE_E2E === '1' && typeof window !== 'undefined') {
  Object.assign(window, {
    __sceneGate: { getState: getSceneGateState },
    // The per-texture timeline, so a trace can reconcile gate-open against each
    // texture's requestStart / responseEnd / onLoad on ONE clock.
    __textures: { getState: snapshotTextures, describe: describeTextureTimeline },
  });
}

/** Subscribe to gate state changes (for `useSyncExternalStore`). */
export function subscribeSceneGate(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Test seam: reset the gate.
 *
 * `timeoutMs` shortens the safety timeout so a hanging-texture test does not have
 * to wait the full 30 s. Passing null restores the default.
 */
export function __resetSceneGate(timeoutMs: number | null = null): void {
  if (timeoutTimer !== null) clearTimeout(timeoutTimer);
  timeoutTimer = null;
  timeoutOverride = timeoutMs;
  settledPromise = null;
  resolveSettled = null;
  createdAt = 0;
  hasCreatedAt = false;
  listeners = new Set();
  state = {
    outcome: null,
    settledInMs: null,
    openedAt: null,
    createdAt: null,
    reason: null,
    readySignalled: false,
    texturesDone: false,
    frameRendered: false,
    texturesSource: null,
    assetsStarted: null,
  };
}
