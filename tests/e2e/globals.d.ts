/**
 * Page-side globals installed by addInitScript and read back via page.evaluate.
 * Declared here so the specs typecheck without `any` casts.
 */
/** The six layer switches `window.__look` exposes. Mirrors src/scene/globeLook.ts. */
export interface LookLayerFlags {
  stars: boolean;
  rings: boolean;
  atmosphere: boolean;
  clouds: boolean;
  pins: boolean;
  bloom: boolean;
}

/**
 * Mirrors the `__globe` probe from src/lib/globeProbe.ts, narrowed to what a
 * spec reads. `setAzimuth` orbits at the default elevation and distance, so a
 * spec never has to re-derive the spherical maths.
 */
export interface GlobeProbeHandle {
  project(point?: [number, number, number]): { x: number; y: number; behind: boolean };
  discRadiusPx(): number;
  distance(): number;
  insets(): { top: number; right: number; bottom: number; left: number };
  pins(): Array<{ id: string; x: number; y: number; behind: boolean; facing: boolean }>;
  setCamera(position: [number, number, number]): Promise<void>;
  setAzimuth(deg: number): Promise<void>;
  defaultOrbit(): { distance: number; elevationDeg: number };
}

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
    __globe?: GlobeProbeHandle;
    __scene?: unknown;
    __camera?: unknown;
    __gl?: unknown;
    /** E2E-only: single-purpose ablation seam for the globe look flags. */
    __lookToggles?: {
      set(patch: Record<string, boolean>): Record<string, boolean>;
      get(): Record<string, boolean>;
      reset(): Record<string, boolean>;
      look(): unknown;
    };
    /** E2E-only: the stable look API the committed specs use. */
    __look?: {
      set(patch: Partial<LookLayerFlags>): LookLayerFlags;
      get(): LookLayerFlags;
      setAzimuth(deg: number): Promise<void>;
    };
  }
}

export {};
