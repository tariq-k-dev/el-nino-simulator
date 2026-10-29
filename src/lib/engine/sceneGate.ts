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
 *   TIMEOUT = `SCENE_GATE_TIMEOUT_MS` (30 s default, overridable for tests). A
 *            hanging texture request must not park the engine forever.
 *
 * The gate is one-shot and memoised: whatever the first outcome is, every later
 * caller sees the same settled promise. `whenSceneSettled()` never rejects.
 */

/** How long the scene gets before the gate gives up and lets the engine boot. */
export const SCENE_GATE_TIMEOUT_MS = 30_000;

export type SceneOutcome = 'ready' | 'failed' | 'timeout';

export interface SceneGateState {
  /** Resolved outcome, or null while the scene is still settling. */
  outcome: SceneOutcome | null;
  /** Wall-clock ms from gate creation to settling. */
  settledInMs: number | null;
  /** Human-readable reason, for the badge tooltip and diagnostics. */
  reason: string | null;
  /** True once `markSceneReady()` has been called. */
  readySignalled: boolean;
  /** True once a texture/frame condition was satisfied. */
  texturesDone: boolean;
  frameRendered: boolean;
}

type Listener = () => void;

let state: SceneGateState = {
  outcome: null,
  settledInMs: null,
  reason: null,
  readySignalled: false,
  texturesDone: false,
  frameRendered: false,
};

let listeners = new Set<Listener>();
let settledPromise: Promise<SceneOutcome> | null = null;
let resolveSettled: ((o: SceneOutcome) => void) | null = null;
let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
let createdAt = 0;
let timeoutOverride: number | null = null;

const emit = () => {
  for (const l of listeners) l();
};

const settle = (outcome: SceneOutcome, reason: string) => {
  // One-shot: the first outcome wins and is permanent.
  if (state.outcome !== null) return;

  state = {
    ...state,
    outcome,
    settledInMs: createdAt === 0 ? 0 : Date.now() - createdAt,
    reason,
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

/**
 * Record that every tracked texture finished (drei progress reached 100).
 *
 * Completes the gate if the first frame has also been drawn. Making each half
 * self-checking means callers cannot get it wrong by signalling one part and
 * forgetting to re-evaluate the pair — an earlier version only settled through
 * `signalSceneCondition`, so a direct `markFirstFrame()` silently never resolved.
 */
export function markTexturesDone(): void {
  if (state.outcome !== null) return;
  state = { ...state, texturesDone: true };
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
export function signalSceneCondition(part: 'textures' | 'frame'): void {
  if (state.outcome !== null) return;
  if (part === 'textures') markTexturesDone();
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

  createdAt = Date.now();
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
  const pageOverride =
    typeof window !== 'undefined'
      ? (window as { __SCENE_GATE_TIMEOUT_OVERRIDE__?: number }).__SCENE_GATE_TIMEOUT_OVERRIDE__
      : undefined;
  const ms = timeoutOverride ?? pageOverride ?? SCENE_GATE_TIMEOUT_MS;
  timeoutTimer = setTimeout(() => {
    settle('timeout', `scene did not settle within ${ms} ms — booting anyway`);
  }, ms);

  return settledPromise;
}

/** Current gate state, for the badge/diagnostics. */
export function getSceneGateState(): SceneGateState {
  return state;
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
  listeners = new Set();
  state = {
    outcome: null,
    settledInMs: null,
    reason: null,
    readySignalled: false,
    texturesDone: false,
    frameRendered: false,
  };
}
