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
  /** The orbit target in world space; equals the globe centre until a fly-to moves it. */
  target(): [number, number, number];
  insets(): { top: number; right: number; bottom: number; left: number };
  pins(): Array<{ id: string; x: number; y: number; behind: boolean; facing: boolean }>;
  /** Pin core positions in WORLD space, for negative tests that inject at a pin. */
  pinAnchors(): Array<{ id: string; world: [number, number, number] }>;
  setCamera(position: [number, number, number]): Promise<void>;
  setAzimuth(deg: number): Promise<void>;
  /**
   * Freeze the planet at an absolute Y rotation (`frozen = true`), or release it.
   *
   * Present on the runtime handle since 3A (`globeProbe.ts:269`) but missing from this mirror until
   * 3B, where `camera-golden.spec.ts` needs it: a fly-to's target is
   * `regionDirection(id, spin.current.y)` (`CameraRig.tsx:54`), so without pinning the phase the end
   * pose differs between loads by up to 8.4e-3 R in `controls.target`. Type-only addition.
   */
  setSpin(frozen: boolean, angle: number): void;
  defaultOrbit(): { distance: number; elevationDeg: number };
  /** Flip internal look flags (the raw store; `__look.set` is the narrow API). */
  setLookFlags(patch: Record<string, boolean>): Record<string, boolean>;
  /** Read the current look flags. Declared here since 2B-C2B: the glint sentinel has to know
   * whether the `specular` overlay is ON before differencing two frames against it. */
  lookFlags(): Record<string, boolean>;
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


/**
 * Mirrors `FrameProbe` from src/lib/frameProbe.ts.
 *
 * Every field is a getter over the rig's latest frame, so a poll reads the live value rather than a
 * snapshot taken when the page loaded. `snapshot()` is the coherent read for assertions that must
 * not straddle two frames.
 */
export interface FrameProbeHandle {
  readonly mode: 'live' | 'locked';
  readonly insets: { top: number; right: number; bottom: number; left: number };
  readonly free: { x: number; y: number; w: number; h: number };
  readonly target: { dx: number; dy: number; d: number };
  readonly current: { dx: number; dy: number; d: number };
  readonly settled: boolean;
  readonly degenerate: boolean;
  readonly cameraViewIsNull: boolean;
  /** Step 3B: the focus machine's state, polled by `frame-director.spec.ts`. */
  readonly focus: 'idle' | 'focusing' | 'focused' | 'returning';
  /** Step 3B: whether a non-fit writer owns the distance. */
  readonly userZoomed: boolean;
  /** Step 3B: the targeted region, or null. */
  readonly regionId: string | null;
  /** Step 3B2: true when the camera is at the framed default pose. */
  readonly viewIsDefault: boolean;
  /** Step 3B2: true while the planet spins. */
  readonly spinning: boolean;
  /** Step 3B2: `locked` (aim-at-pin) or `live` (face-pin). */
  readonly focusPolicy: 'live' | 'locked';
  snapshot(): {
    mode: 'live' | 'locked';
    insets: { top: number; right: number; bottom: number; left: number };
    free: { x: number; y: number; w: number; h: number };
    target: { dx: number; dy: number; d: number };
    current: { dx: number; dy: number; d: number };
    settled: boolean;
    degenerate: boolean;
    cameraViewIsNull: boolean;
    focus: 'idle' | 'focusing' | 'focused' | 'returning';
    userZoomed: boolean;
    regionId: string | null;
    viewIsDefault: boolean;
    spinning: boolean;
    focusPolicy: 'live' | 'locked';
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
    /** E2E-only, ?debug only: the framing probe (step 3A2). Same gate as `__globe`. */
    __frame?: FrameProbeHandle;
    /** Set only when the locked branch of `FrameRig` ran; absent in a live page. */
    __frameLocked?: string;
    __scene?: unknown;
    /** E2E-only, ?debug only: the three.js namespace, so negative tests can construct
     * a real light to inject into the live scene. */
    __THREE?: typeof import('three');
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
      animate(on: boolean): void;
      /**
       * Swap the Earth's surface for flat unlit white (or restore it). Used only by
       * `fitLimb`, whose 360-ray circle fit needs an edge that is the same at every
       * angle — a lit sphere's luma edge is crisp on the day side and soft on the
       * night side, and averaging the two is not ground truth.
       */
      surfaceWhite(on: boolean): boolean;
      /** True once the Earth's surface mesh exists (the swap precondition). */
      surfaceReady(): boolean;
      /** Read (no arg) or set the surface material's specular intensity. */
      specularIntensity(v?: number): number | null;
      /**
       * Per pin: WORLD positions of the core and the surface anchor, plus the
       * outward normal. Exists so the negative suite can place an injected light
       * at the pin instead of at a screen pixel pair — the earlier N1 attempt used
       * (291, 482), which is `project()` output and 291 world units off the globe.
       */
      pinsWorld(): Array<{
        name: string;
        core: [number, number, number];
        surface: [number, number, number];
        normal: [number, number, number];
      }>;
    };
  }
}

export {};
