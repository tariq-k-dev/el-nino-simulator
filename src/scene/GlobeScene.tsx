import {
  Component,
  Suspense,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { AdaptiveDpr, OrbitControls, Preload, useProgress } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { RegionId, ScenarioMetrics } from '@/types/enso';
import { Starfield } from '@/scene/Starfield';
import { EARTH_RADIUS, SUN_POSITION } from '@/scene/constants';
import { CameraRig } from '@/scene/CameraRig';
import { EarthSystem } from '@/scene/EarthSystem';
import type { SpinState } from '@/scene/EarthSystem';
import { REGIONS } from '@/lib/regions';
import { regionHeadline } from '@/lib/model';
import { registerRenderer } from '@/lib/canvasCapture';
import { createGlobeProbe } from '@/lib/globeProbe';
import { getInsets } from '@/lib/viewport/insets';
import { markSceneFailed, signalSceneCondition } from '@/lib/engine/sceneGate';
import {
  allTexturesSettled,
  setTextureProgressState,
  subscribeTextures,
  textureStatus,
  textureVersion,
} from '@/lib/engine/textureTimeline';

/**
 * Re-render on any item transition in the texture timeline.
 *
 * `useSyncExternalStore` with the version as the snapshot: the version is a
 * number, so the reference is stable between transitions and React can skip
 * rendering when nothing changed.
 */
function useTextureVersion(): number {
  return useSyncExternalStore(subscribeTextures, textureVersion, textureVersion);
}

/**
 * Feeds the gate its texture condition, from the authoritative source.
 *
 * Two conditions are watched and they are NOT equivalent:
 *
 * 1. **The per-item timeline** (`textureTimeline`) — every asset three's
 *    `DefaultLoadingManager` registered has resolved or errored. This is the
 *    condition the gate uses, because it is per-item: one texture still in
 *    flight keeps the gate shut regardless of what any aggregate says.
 *
 * 2. **drei's `useProgress` aggregate** — `active === false && progress === 100`.
 *    Kept as a fallback only. Its percentage is
 *    `(loaded - saveLastTotalLoaded) / (total - saveLastTotalLoaded) * 100 || 100`
 *    with `saveLastTotalLoaded` pinned to `total` after the first load, so a
 *    second wave of textures divides by zero → `NaN || 100` → 100% while items
 *    are still arriving. Reading only this is how a gate opens early.
 *
 * The aggregate is still mirrored into the timeline snapshot (`progressCoversAll`)
 * so a report can show whether the counter accounted for every item, which
 * distinguishes "the gate never saw the texture" from "the counter miscounted
 * it" — different bugs with the same symptom.
 */
function TextureProgressSignal() {
  const { active, progress, loaded, total } = useProgress();

  useEffect(() => {
    setTextureProgressState({ active, progress, loaded, total });
    if (active || progress !== 100) return;

    // Every item the manager registered must also be settled. If the timeline
    // has seen nothing (unit tests, a scene with no assets) the aggregate is the
    // only evidence available, so it decides.
    const settled = allTexturesSettled();
    const seen = textureStatus().started;
    if (settled || seen === 0) {
      // An item that ERRORED will never fire onLoad, so the aggregate can sit
      // below 100 forever. `pending === 0` is satisfied by an error, which is
      // what keeps a broken texture from parking the gate until its timeout.
      signalSceneCondition('textures', settled ? 'timeline' : 'progress');
    }
  }, [active, progress, loaded, total]);

  return null;
}

/**
 * Re-evaluates the texture half whenever an individual item settles.
 *
 * Needed because the aggregate can be stuck at 100% (see above): after the first
 * wave, `progress` may not change again, so nothing would re-run the effect in
 * `TextureProgressSignal` when the *last* texture of a later wave finishes. This
 * component subscribes to the timeline directly, so every itemEnd/onError is a
 * re-render and therefore a re-check.
 */
function TextureSettledSignal() {
  useTextureVersion();
  useEffect(() => {
    if (allTexturesSettled()) signalSceneCondition('textures', 'timeline');
  });
  return null;
}

/**
 * Signals the first presented frame.
 *
 * A `useFrame` callback runs before that frame is drawn, so the first invocation
 * proves the renderer is alive. Kept separate from TextureProgressSignal because
 * `active` can already be false when nothing needed loading — in that case only a
 * frame proves the scene actually works.
 */
function FirstFrameSignal() {
  const fired = useRef(false);
  useFrame(() => {
    if (fired.current) return;
    fired.current = true;
    signalSceneCondition('frame');
  });
  return null;
}

/**
 * Turns a scene crash into a gate failure instead of a blank canvas.
 *
 * Without this, a thrown error inside the R3F tree unmounts the canvas and leaves
 * the engine gate waiting for a frame that will never come — until the 30 s
 * timeout. Reporting the failure immediately lets the engine boot straight away.
 */
class SceneErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    markSceneFailed(`scene error boundary tripped: ${error.message}`);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    // Keep a dark surface rather than unmounting to white.
    return <div className="absolute inset-0 bg-void-950" />;
  }
}

interface GlobeSceneProps {
  sst: number;
  metrics: ScenarioMetrics;
  activeRegion: RegionId | null;
  onSelect: (id: RegionId | null) => void;
  focusNonce: number;
  onLoaded?: () => void;
}

/**
 * Canvas host. Everything inside <Canvas> is a separate React reconciler, so
 * state that the DOM also needs (selection, metrics) is passed down as props —
 * never bridged through context across the boundary.
 */
export function GlobeScene({
  sst,
  metrics,
  activeRegion,
  onSelect,
  focusNonce,
  onLoaded,
}: GlobeSceneProps) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const spin = useRef<SpinState>({ y: 0, paused: false });

  // WebGL can be absent entirely (headless, blocklisted GPU, disabled by policy).
  // Mark the gate failed so the engine boots without waiting for a canvas.
  useEffect(() => {
    const canvas = document.createElement('canvas');
    const hasWebGL =
      typeof WebGLRenderingContext !== 'undefined' &&
      !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
    if (!hasWebGL) markSceneFailed('WebGL unavailable in this browser');
  }, []);

  return (
    <SceneErrorBoundary>
    <Canvas
      dpr={[1, 2]}
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
        // Needed so the Snapshot export can read the framebuffer at all.
        preserveDrawingBuffer: true,
      }}
      camera={{ position: [0, 1.15, 3.15], fov: 42, near: 0.1, far: 400 }}
      onCreated={({ gl, scene, camera }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        // Slightly under 1: the key light is strong and the atmosphere is
        // additive on top, so a neutral exposure clips the day side to white.
        gl.toneMappingExposure = 1.0;
        scene.fog = null;

        // Hand the export path a way to render on demand — see lib/canvasCapture.
        registerRenderer({ render: () => gl.render(scene, camera), domElement: gl.domElement });

        // Opt-in scene handle for visual QA. E2E/dev builds only: the flag is a
        // compile-time literal, so this whole assignment is dead-code-eliminated
        // from a production bundle.
        if (import.meta.env.VITE_E2E === '1' && new URLSearchParams(window.location.search).has('debug')) {
          Object.assign(window, { __scene: scene, __camera: camera, __gl: gl });

          /*
           * `__globe` — the screen-space probe the globe specs assert against.
           *
           * `size` is read from the renderer at call time (not captured) because a
           * viewport resize changes it, and `target` is read from the live controls
           * because the region fly-to moves it. Capturing either would make
           * `project()` return stale pixel coordinates after a resize or a focus.
           */
          Object.assign(window, {
            __globe: createGlobeProbe({
              camera,
              size: {
                get width() {
                  return gl.domElement.clientWidth;
                },
                get height() {
                  return gl.domElement.clientHeight;
                },
              },
              // Read the live orbit target: the region fly-to moves it.
              getTarget: () => controlsRef.current?.target ?? new THREE.Vector3(),
              globeRadius: EARTH_RADIUS,
              readInsets: getInsets,
            }),
          });
        }
        // A lost context means the globe can never settle. Report it and let the
        // engine boot rather than parking until the timeout.
        gl.domElement.addEventListener('webglcontextlost', () => {
          markSceneFailed('WebGL context lost');
        });

        // Textures decode asynchronously; this fires once the first frame is up.
        requestAnimationFrame(() => onLoaded?.());
      }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={['#02040a']} />

      {/* Cinematic three-point key/fill/rim. The key is the sun and is the only
          strong source — a bright ambient term is what flattens a globe into a
          sticker. Fill exists solely to keep the night side from crushing to
          pure black, and the rim light separates the silhouette from space. */}
      <ambientLight intensity={0.055} color="#7aa7d9" />
      <directionalLight position={SUN_POSITION} intensity={3.6} color="#fffaf2" />
      {/* Cool fill from the anti-sun side, very low. */}
      <directionalLight position={[-5.2, -2.2, -4.6]} intensity={0.32} color="#2f6fb8" />
      {/* Warm rim from behind-left, tight enough to only catch the limb. */}
      <directionalLight position={[-3.4, 1.8, -5.0]} intensity={0.38} color="#c9d8ff" />

      <Suspense fallback={null}>
        <TextureProgressSignal />
        <TextureSettledSignal />
        <FirstFrameSignal />
        <Starfield count={14000} />
        <EarthSystem
          sst={sst}
          metrics={metrics}
          activeRegion={activeRegion}
          onSelect={onSelect}
          spin={spin}
        />
        <Preload all />
      </Suspense>

      <CameraRig activeRegion={activeRegion} spin={spin} controlsRef={controlsRef} focusNonce={focusNonce} />

      {/*
        Zoom bounds are expressed against the globe RADIUS, not as magic numbers.
        EARTH_RADIUS is 1 in scene units, so 1.25 puts the near clip just outside
        the atmosphere shell (1.028 R) and 5 is far enough to see the whole disc
        with room for the starfield.

        `enableZoom` and `enablePan` are stated explicitly rather than left to
        defaults: `enablePan` MUST stay false or a two-finger drag translates the
        globe and there is no way for the user to get it back (the camera target is
        driven by the region fly-to, not by the user).

        `touches` is set for two-finger gestures: ONE finger rotates, TWO fingers
        dolly. Without an explicit mapping OrbitControls' defaults already do this,
        but naming it documents that pinch is a supported input, which is what the
        mobile acceptance case exercises.
      */}
      <OrbitControls
        ref={controlsRef}
        enableZoom
        enablePan={false}
        enableDamping
        dampingFactor={0.06}
        rotateSpeed={0.45}
        zoomSpeed={0.7}
        minDistance={EARTH_RADIUS * 1.25}
        maxDistance={EARTH_RADIUS * 5}
        autoRotate={false}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
      />

      <EffectComposer multisampling={0}>
        <Bloom intensity={0.42} luminanceThreshold={0.62} luminanceSmoothing={0.32} mipmapBlur radius={0.55} />
        <Vignette eskil={false} offset={0.18} darkness={0.72} />
      </EffectComposer>

      <AdaptiveDpr pixelated />

      {/* MUST be last: effects run child-first, so this re-asserts touch-action
          after OrbitControls' own effect/dispose has finished with it. */}
      <CanvasTouchAction />
    </Canvas>
    </SceneErrorBoundary>
  );
}

/**
 * Re-asserts `touch-action: none` on the canvas AFTER OrbitControls has mounted.
 *
 * This is the third attempt, and the first that works, because the first two lost
 * a fight with the control library:
 *
 *  1. A stylesheet rule (`#globe-canvas canvas { touch-action: none }`) — the
 *     canvas carries an INLINE `touch-action`, and inline beats a stylesheet.
 *  2. `<Canvas style={{ touchAction: 'none' }}>` — R3F applies `style` to its
 *     wrapper div, not to the `<canvas>` it creates.
 *  3. Writing it in `onCreated` — this DOES land, but `three-stdlib`'s
 *     OrbitControls calls `scope.domElement.style.touchAction = 'auto'` in its own
 *     `dispose()`, which runs after `onCreated`.
 *
 * Verified at the end of attempt 3: `overscroll-behavior: contain` (from the same
 * assignment) was present while `touch-action` read `auto` — proof that the write
 * happened and was then undone by the controls, not that it never happened.
 *
 * React runs effects child-first, so a sibling placed AFTER <OrbitControls> has
 * its effect run last and wins. With `auto` the browser claims a two-finger
 * gesture as page zoom and cancels the pointer stream, so pinch never reached
 * OrbitControls at all.
 */
function CanvasTouchAction() {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    const el = gl.domElement;
    el.style.touchAction = 'none';
    el.style.overscrollBehavior = 'contain';

    /*
     * Then KEEP it that way.
     *
     * A single assignment is not enough: something rewrites the canvas's
     * `touch-action` back to `auto` after every effect here has run. Rather than
     * chase which writer it is (R3F re-rendering the style, a StrictMode remount,
     * OrbitControls' dispose, a `cssText` assignment that bypasses a property
     * trap — a property setter trap recorded zero canvas writes, so it is almost
     * certainly `cssText`), observe the attribute.
     *
     * A MutationObserver on `style` is the only mechanism that wins regardless of
     * WHO writes or HOW: it fires after any mutation, and re-asserting here is
     * idempotent, so it settles after one round trip and does no steady-state work.
     * Guarded against a feedback loop by only writing when the value is wrong.
     */
    const enforce = () => {
      if (el.style.touchAction !== 'none') el.style.touchAction = 'none';
      if (el.style.overscrollBehavior !== 'contain') el.style.overscrollBehavior = 'contain';
    };
    enforce();

    const observer = new MutationObserver(enforce);
    observer.observe(el, { attributes: true, attributeFilter: ['style'] });

    return () => observer.disconnect();
  }, [gl]);

  return null;
}

/** Legend chips shared with the HUD so the colour language is documented. */
export function RegionLegend({
  activeRegion,
  onSelect,
  metrics,
}: {
  activeRegion: RegionId | null;
  onSelect: (id: RegionId) => void;
  metrics: ScenarioMetrics;
}) {
  return (
    <div className="pointer-events-auto flex flex-wrap gap-1.5">
      {REGIONS.map((region) => {
        const active = activeRegion === region.id;
        return (
          <button
            key={region.id}
            type="button"
            onClick={() => onSelect(region.id)}
            className={[
              'group rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-all duration-300',
              active
                ? 'border-white/30 bg-white/12 text-white'
                : 'border-white/8 bg-black/30 text-white/50 hover:border-white/20 hover:text-white/85',
            ].join(' ')}
          >
            {region.shortName}
            <span className="ml-1.5 hidden text-white/35 group-hover:inline sm:inline">
              {regionHeadline(metrics, region.id)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
