import { Component, Suspense, useEffect, useRef, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { AdaptiveDpr, OrbitControls, Preload, useProgress } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { RegionId, ScenarioMetrics } from '@/types/enso';
import { Starfield } from '@/scene/Starfield';
import { SUN_POSITION } from '@/scene/constants';
import { CameraRig } from '@/scene/CameraRig';
import { EarthSystem } from '@/scene/EarthSystem';
import type { SpinState } from '@/scene/EarthSystem';
import { REGIONS } from '@/lib/regions';
import { regionHeadline } from '@/lib/model';
import { registerRenderer } from '@/lib/canvasCapture';
import { markSceneFailed, signalSceneCondition } from '@/lib/engine/sceneGate';

/**
 * Bridges drei's texture-progress store into the scene gate.
 *
 * `useProgress` is a zustand store, so it can be read outside React too — but a
 * component is the simplest way to subscribe. `active === false && progress === 100`
 * means every texture drei tracked has finished decoding.
 */
function TextureProgressSignal() {
  const { active, progress } = useProgress();

  useEffect(() => {
    if (!active && progress === 100) signalSceneCondition('textures');
  }, [active, progress]);

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

      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        enableDamping
        dampingFactor={0.06}
        rotateSpeed={0.45}
        zoomSpeed={0.7}
        minDistance={1.55}
        maxDistance={6.5}
        autoRotate={false}
      />

      <EffectComposer multisampling={0}>
        <Bloom intensity={0.42} luminanceThreshold={0.62} luminanceSmoothing={0.32} mipmapBlur radius={0.55} />
        <Vignette eskil={false} offset={0.18} darkness={0.72} />
      </EffectComposer>

      <AdaptiveDpr pixelated />
    </Canvas>
    </SceneErrorBoundary>
  );
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
