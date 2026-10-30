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
import {
  DEFAULT_LOOK_FLAGS,
  GLOBE_LOOK,
  getLookFlags,
  setLookFlags,
  subscribeLookFlags,
  type GlobeLookFlags,
} from '@/scene/globeLook';
import { REGIONS, latLonToVector3 } from '@/lib/regions';
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
  const spin = useRef<SpinState>({
    y: 0,
    paused: false,
    frozen: false,
    frozenAt: 0,
    cloudAngle: 0,
  });

  /*
   * Layer switches, and the seam the acceptance specs write to.
   *
   * The store itself lives in scene/globeLook.ts (module scope, no React), so
   * the probe can call `setLookFlags` directly from a `page.evaluate` without
   * needing a component to exist. This component only subscribes, so a flip
   * re-renders exactly the layers that read it.
   */
  const look = useSyncExternalStore(subscribeLookFlags, getLookFlags, getLookFlags);

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
              // Layer toggles + the tuning constants, so a spec can hold one
              // contribution still and can print the whole look in a failure.
              readLookFlags: getLookFlags,
              writeLookFlags: setLookFlags,
              look: GLOBE_LOOK,
              /*
               * Pin anchors, rotated by the planet's CURRENT spin.
               *
               * `spin.y` is the authoritative rotation (EarthSystem writes it
               * into the group every frame), so applying it here reproduces the
               * transform the renderer uses rather than sampling a matrix that
               * is one frame stale — a spec reads this, screenshots, then reads
               * it again, and the two must agree about where the pin is.
               */
              pins: () =>
                REGIONS.map((region) => {
                  /*
                   * The CORE's position, not the surface anchor.
                   *
                   * Hotspot builds the pin at `anchorRadius`, lifts the whole
                   * group by `idleLift`, then offsets the core `coreOffset` along
                   * the normal. Reporting the bare anchor instead put the probe
                   * ~0.09 R inside the core — at the default camera that is ~26 px,
                   * far enough away that the pin report sampled plain ocean and
                   * reported a core luminance of 7 for a pin that is actually
                   * there and bright. All three values come from GLOBE_LOOK so the
                   * probe and the component cannot drift apart again.
                   */
                  const radius =
                    GLOBE_LOOK.pins.anchorRadius * GLOBE_LOOK.pins.idleLift +
                    GLOBE_LOOK.pins.coreOffset;
                  const [x, y, z] = latLonToVector3(region.lat, region.lon, radius);
                  const cos = Math.cos(spin.current.y);
                  const sin = Math.sin(spin.current.y);
                  return {
                    id: region.id,
                    world: [x * cos + z * sin, y, -x * sin + z * cos] as [number, number, number],
                  };
                }),
              setSpinPaused: (paused: boolean) => {
                spin.current.paused = paused;
              },
              /*
               * Freeze the planet at an absolute longitude, or release it.
               *
               * `frozen` is what makes a baseline reproducible: pausing alone
               * stops the spin wherever the first frame landed, which differs
               * between loads because `spin.y` accumulates from frame deltas.
               * Measured before this: two loads of the same view differed by 17.4
               * mean absolute luma inside the disc while the sky (unaffected by
               * the spin) matched to 0.02.
               */
              setSpin: (frozen: boolean, angle: number) => {
                spin.current.frozen = frozen;
                if (frozen) {
                  spin.current.frozenAt = angle;
                  spin.current.y = angle;
                }
              },
            }),
            /*
             * `__lookToggles` — named, single-purpose toggles for ablation.
             *
             * Step 1 of LOOK2 is explicitly an ablation: switch each non-sun
             * light off IN TURN and name the one that draws the blue circle.
             * `setLookFlags` already accepts partial patches, so this is a thin
             * alias with a name that says what it is for. Same compile-time
             * VITE_E2E gate as `__globe`; check-assets fails the production
             * build if it leaks.
             */
            __lookToggles: {
              set: (patch: Partial<GlobeLookFlags>) => setLookFlags(patch),
              get: () => getLookFlags(),
              reset: () => setLookFlags(DEFAULT_LOOK_FLAGS),
              /** The values an ablation has to attribute a change to. */
              look: () => GLOBE_LOOK,
            },
            /*
             * `window.__look` — the STABLE look API the committed specs use.
             *
             * `__lookToggles` above is the raw flag store and its keys are the
             * internal ones (`hotspotRings`, plus light flags a spec has no
             * business touching). This is the narrow, documented surface:
             * exactly the six layer booleans the specs are allowed to set, and
             * the azimuth helper. Renaming or narrowing the internal flags must
             * not break a spec, so the mapping lives here.
             *
             * Nothing here remounts the Canvas. `set` only writes the external
             * store the scene already subscribes to, so a toggle is a re-render
             * of the layers that read it, never a new WebGL context.
             */
            __look: {
              /** Six booleans, default all true. */
              set: (patch: {
                stars?: boolean;
                rings?: boolean;
                atmosphere?: boolean;
                clouds?: boolean;
                pins?: boolean;
                bloom?: boolean;
              }) => {
                const mapped: Partial<GlobeLookFlags> = {};
                if (patch.stars !== undefined) mapped.stars = patch.stars;
                if (patch.rings !== undefined) {
                  mapped.hotspotRings = patch.rings;
                  // The ring is also the click target's visible affordance; when
                  // a spec says "rings off" it means the additive quad, not the
                  // pin core.
                }
                if (patch.atmosphere !== undefined) mapped.atmosphere = patch.atmosphere;
                if (patch.clouds !== undefined) mapped.clouds = patch.clouds;
                if (patch.pins !== undefined) mapped.pins = patch.pins;
                if (patch.bloom !== undefined) mapped.bloom = patch.bloom;
                setLookFlags(mapped);
                const f = getLookFlags();
                return {
                  stars: f.stars,
                  rings: f.hotspotRings,
                  atmosphere: f.atmosphere,
                  clouds: f.clouds,
                  pins: f.pins,
                  bloom: f.bloom,
                };
              },
              get: () => {
                const f = getLookFlags();
                return {
                  stars: f.stars,
                  rings: f.hotspotRings,
                  atmosphere: f.atmosphere,
                  clouds: f.clouds,
                  pins: f.pins,
                  bloom: f.bloom,
                };
              },
              /**
               * Camera azimuth in degrees around the globe; 0 = default view.
               *
               * Also pins the planet at longitude 0 and stops the scene clock, so
               * a capture at a given azimuth is the same scene on every load
               * rather than wherever the spin had got to. Reproducibility is the
               * whole point of a pixel baseline; making it opt-in would leave the
               * easy path flaky.
               */
              setAzimuth: (deg: number) => {
                const probe = (
                  window as unknown as {
                    __globe: {
                      setAzimuth(d: number): Promise<void>;
                      setSpin(frozen: boolean, angle: number): void;
                    };
                  }
                ).__globe;
                probe.setSpin(true, 0);
                setLookFlags({ animate: false });
                return probe.setAzimuth(deg);
              },
              /** Release the scene clock and the spin (restores the live look). */
              animate: (on: boolean) => setLookFlags({ animate: on }),
              /**
               * Swap the Earth's surface material for flat unlit white, or restore it.
               *
               * Exists for `fitLimb`: a lit sphere has a terminator and a specular
               * gradient, so its luma edge is only crisp on the day side and a
               * 360-ray circle fit would measure two different edges. An unlit white
               * material is uniformly bright right up to the geometric silhouette at
               * every angle, which is what makes the fitted radius ground truth.
               *
               * Idempotent and restorable: the original material is held in
               * `userData` so `false` always puts it back. Lives here (rather than in
               * the spec) because `THREE` is already imported in this module and the
               * spec has no bundle access to a second copy of the library.
               */
              surfaceWhite: (on: boolean) => {
                /*
                 * Find the surface by EITHER its physical material or its saved
                 * original. Matching only the material type looks right and breaks
                 * twice: after a swap the mesh is MeshBasicMaterial, so a second
                 * `true` cannot re-find it, and `false` cannot restore it either —
                 * the restore search has nothing to match and the scene stays white
                 * for every later spec. The saved material IS the identity.
                 */
                let mesh: THREE.Mesh | null = null;
                scene.traverse((o) => {
                  if (mesh) return;
                  const m = o as THREE.Mesh;
                  if (!m.isMesh) return;
                  const type = (m.material as THREE.Material)?.type;
                  if (type === 'MeshPhysicalMaterial' || m.userData.__savedMaterial) mesh = m;
                });
                if (!mesh) return false;
                const target = mesh as THREE.Mesh;
                if (on) {
                  // Idempotent: a caller may poll this, and creating a fresh material
                  // per call would leak one GPU material per poll.
                  if (target.userData.__savedMaterial) return true;
                  target.userData.__savedMaterial = target.material;
                  const flat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
                  (flat as THREE.Material).toneMapped = false;
                  target.material = flat;
                } else if (target.userData.__savedMaterial) {
                  target.material = target.userData.__savedMaterial as THREE.Material;
                  delete target.userData.__savedMaterial;
                }
                return true;
              },
              /**
               * True once the Earth's surface mesh exists.
               *
               * `__look` is installed in `onCreated`, before the textured <Globe>
               * finishes suspending, so at that moment `scene.traverse` finds zero
               * meshes. Specs that must swap the surface poll THIS (an observation)
               * rather than re-calling `surfaceWhite(true)` — that call is not a
               * predicate: once it has swapped, there is no MeshPhysicalMaterial
               * left to find and it correctly reports false forever after.
               */
              surfaceReady: () => {
                let found = false;
                scene.traverse((o) => {
                  const m = o as THREE.Mesh;
                  if (!found && m.isMesh) {
                    const t = (m.material as THREE.Material)?.type;
                    found = t === 'MeshPhysicalMaterial' || !!m.userData.__savedMaterial;
                  }
                });
                return found;
              },
            },
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

      {/* Lighting rig.

          The sun is the ONLY source allowed to produce specular. That is not a
          style preference — it is the fix for the blue circle:

          A `directionalLight` is a parallel source at infinity. On a glossy
          sphere it always puts a specular lobe somewhere, and the ocean here is
          glossy by design (the whole point of the glint). The cool fill at
          #2f6fb8 / 0.32 therefore drew a soft light-blue circle on the left
          limb above the equator — measured at (344, 392), peak RGB (53, 123, 204),
          luminance 114 vs a surrounding ocean of ~18. Ablation was unambiguous:
          switching the fill off dropped that patch to 4.1/255 while the
          atmosphere, bloom, clouds, the glint overlay and even the sun left it
          bit-identical.

          A `HemisphereLight` is irradiance-only: three.js computes no specular
          term for it at all. So it can tint the shadow side cool without being
          able to draw a highlight anywhere, which is exactly the behaviour
          wanted. `ambientLight` (also specular-free) stays as a flat floor.

          Keeping the cool tint on the shadow side was a hard requirement, so the
          hemisphere's sky colour is the fill's own #2f6fb8. */}
      {look.lightAmbient && (
        <ambientLight
          intensity={GLOBE_LOOK.lights.ambient.intensity}
          color={GLOBE_LOOK.lights.ambient.color}
        />
      )}
      {look.lightHemisphere && (
        <hemisphereLight
          args={[GLOBE_LOOK.lights.hemisphere.skyColor, GLOBE_LOOK.lights.hemisphere.groundColor]}
          intensity={GLOBE_LOOK.lights.hemisphere.intensity}
        />
      )}
      {look.lightSun && (
        <directionalLight
          position={SUN_POSITION}
          intensity={GLOBE_LOOK.lights.sun.intensity}
          color={GLOBE_LOOK.lights.sun.color}
        />
      )}

      <Suspense fallback={null}>
        <TextureProgressSignal />
        <TextureSettledSignal />
        <FirstFrameSignal />
        {/* Stars are a whole-sky additive layer, so "hide them" is a render
            gate rather than a star-by-star dimming. The atmosphere profile
            spec walks 16 rays outward through this region and any star crossing
            a ray is a luminance spike no atmosphere rule can satisfy. */}
        {look.stars && <Starfield count={14000} />}
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

      {/*
        Bloom is a legitimate contributor to glare, so it is behind a flag as
        well as behind GLOBE_LOOK. `luminanceThreshold` is the seam that decides
        whether an already-bright surface gets smeared into a floodlight or stays
        a highlight: at 0.62 a sunlit cloud top passes and blooms, which is a
        second way to produce clipped pixels that no surface-level cap can fix.
      */}
      {look.bloom ? (
        <EffectComposer multisampling={0}>
          <Bloom
            intensity={GLOBE_LOOK.bloom.intensity}
            luminanceThreshold={GLOBE_LOOK.bloom.luminanceThreshold}
            luminanceSmoothing={GLOBE_LOOK.bloom.luminanceSmoothing}
            mipmapBlur
            radius={GLOBE_LOOK.bloom.radius}
          />
          <Vignette eskil={false} offset={0.18} darkness={0.72} />
        </EffectComposer>
      ) : (
        <EffectComposer multisampling={0}>
          <Vignette eskil={false} offset={0.18} darkness={0.72} />
        </EffectComposer>
      )}

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
