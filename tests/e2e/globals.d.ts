/**
 * Page-side globals installed by addInitScript and read back via page.evaluate.
 * Declared here so the specs typecheck without `any` casts.
 */
/** Mirrors `SceneGateState` from src/lib/engine/sceneGate.ts (E2E builds only). */
export interface SceneGateStateProbe {
  outcome: 'ready' | 'failed' | 'timeout' | null;
  /** performance.now() at settling — the same clock as responseEnd. */
  openedAt: number | null;
  /** performance.now() at gate creation. */
  createdAt: number | null;
  settledInMs: number | null;
  reason: string | null;
  texturesDone: boolean;
  frameRendered: boolean;
  texturesSource: 'timeline' | 'progress' | null;
  assetsStarted: number | null;
}

/** Mirrors `describeTextureTimeline()` from src/lib/engine/textureTimeline.ts. */
export interface TextureTimelineProbe {
  gateOpenedAt: number | null;
  lastResponseEnd: number | null;
  lastLoadedAt: number | null;
  gateMinusLastResponseEnd: number | null;
  gateMinusLastLoad: number | null;
  decodeTailMs: number | null;
  progressCoversAll: boolean | null;
  rows: Array<{
    file: string;
    requestStart: number | null;
    responseEnd: number | null;
    threeOnLoad: number | null;
    decodeMs: number | null;
    trackedByProgress: boolean;
    status: 'pending' | 'loaded' | 'error';
  }>;
}

/** The engine store snapshot, narrowed to what a spec reads. */
export interface EngineStoreProbe {
  getSnapshot(): {
    phase: 'deferred' | 'booting' | 'ready' | 'failed';
    startedAt?: number;
    firstEventAt?: number | null;
    loaded?: number;
    decoded?: number | null;
    mode?: 'auto' | 'user';
    reason?: string;
  };
}

declare global {
  interface Window {
    /** Long-task durations collected by the PerformanceObserver in case b. */
    __LT: number[];
    /** Body MutationObserver counter used by case h. */
    __MUT: number;
    /** Shortens the 120 s scene-gate timeout. Must be set before app code runs. */
    __SCENE_GATE_TIMEOUT_OVERRIDE__?: number;
    /** E2E-only: gate state, including `openedAt` on the performance clock. */
    __sceneGate?: { getState(): SceneGateStateProbe };
    /** E2E-only: per-texture {requestStart, responseEnd, onLoad} timeline. */
    __textures?: {
      getState(): unknown;
      describe(gateOpenedAt?: number | null): TextureTimelineProbe;
    };
    /** E2E-only: live engine store. */
    __engineStore?: EngineStoreProbe;
    /** E2E-only: errors captured before React mounted. */
    __bootErrors?: Array<{ kind: string; message: string; stack: string }>;
    /** E2E-only, ?debug only: three.js handles for visual QA. */
    __scene?: unknown;
    __camera?: unknown;
    __gl?: unknown;
  }
}

export {};
