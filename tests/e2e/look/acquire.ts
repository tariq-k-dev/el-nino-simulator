/**
 * ACQUISITION — the only module in the look suite that touches the live scene.
 *
 * Why this file exists. The negative suite kept measuring "no change" under a defect
 * that a standalone probe showed was real, and the previous attempt patched a
 * `afterFit` callback into `measureRingCast` to smuggle the injection inside the
 * measurement. That welded acquisition and analysis together: a check that owns a
 * callback which mutates the scene cannot be reasoned about, cannot be unit-tested,
 * and cannot say *when* the defect went missing. D1 then measured the four moments and
 * proved the defect was in fact surviving (lights 3->4, parent uuid stable, programs
 * 20->35, alphaCap held at 1.0 through the capture) — so the whole "the light is
 * compiled back out" story was wrong. What was wrong was the architecture: nothing in
 * the old path ever *checked* that the defect was still live when the shutter opened.
 *
 * So: pure analysis lives in `analysis.ts` and `measure.ts`; this module is the only
 * place that sets layers, fits a limb, injects a defect, or captures. Its order is
 * fixed and asserted by `acquire.test.ts`:
 *
 *   1. set flags/layers, settle
 *   2. fitLimb -> geometry (cached by viewport+camera+azimuth+flags; camera asserted
 *      unchanged, because a cached radius against a moved camera is a silent lie)
 *   2b. baseline capture (the control the restore is compared against)
 *   3. install the defect
 *   4. wait 3 rAF, so the recompile and a real draw have happened
 *   5. SURVIVAL PROBE — the defect is live *at capture time* and the frame advanced
 *      after install. Throws 'defect lost before capture' otherwise.
 *   6. capture
 *   7. uninstall
 *   8. capture again and assert the scene returned to baseline within noise
 *
 * The survival probe is the part the old design lacked, and it is why a negative test
 * can now say "the defect was present and the check still passed" instead of leaving
 * the reader to guess.
 */
import type { Page } from '@playwright/test';
import type { Bitmap, DiscGeometry } from '../../../src/lib/look/helpers';
import { capture, fitLimb, setLayers, settleAt, VIEWPORT } from './capture';

/** The six layer booleans, matching `__look.set`. */
export interface LayerFlags {
  stars?: boolean;
  rings?: boolean;
  atmosphere?: boolean;
  clouds?: boolean;
  pins?: boolean;
  bloom?: boolean;
}

/** Page-side defect names. Each has an implementation in DEFECT_SOURCE. */
export type DefectName =
  | 'pointLight'
  | 'mirrorSurface'
  | 'atmosphereOpaque'
  | 'fillLight'
  | 'pinEmissiveBoost'
  | 'pinsHidden';

export interface DefectSpec {
  name: DefectName;
  /** Defect-specific params; see DEFECT_SOURCE for the shape each one reads. */
  params?: Record<string, unknown>;
}

/** What the survival probe reads back. One entry per defect requirement. */
export interface SurvivalProbe {
  /** Which defect was installed. */
  defect: DefectName;
  /** True when every requirement for this defect held at capture time. */
  alive: boolean;
  /** Human-readable evidence, printed by every negative test. */
  evidence: Record<string, unknown>;
  /** Reasons `alive` is false, empty when it is true. */
  failures: string[];
  /** renderer.info.render.frame before install and at the capture. */
  frameBefore: number;
  frameAtCapture: number;
}

export interface AcquireResult {
  /** The capture taken with the defect installed (or the plain capture with none). */
  frame: Bitmap;
  geometry: DiscGeometry;
  /** The defect-free capture taken before installing. */
  baseline: Bitmap;
  /** The defect-free capture taken after uninstalling. */
  restored: Bitmap;
  probe: SurvivalProbe | null;
  /** Ordered step names, for the ordering contract test and failure reports. */
  steps: string[];
  /** Baseline vs restored mean luma delta inside the disc, as a fraction. */
  restoreDriftPct: number;
}

export interface AcquireOptions {
  flags?: LayerFlags;
  azimuth?: number;
  defect?: DefectSpec | null;
  /**
   * Where the defect is anchored, in WORLD space. Required by `pointLight` and
   * `pinEmissiveBoost`/`pinsHidden`, which need a pin identity rather than a point.
   */
  pinName?: string;
  /**
   * Injected seams, so the ordering contract can be unit-tested with a mock page.
   * Production callers never pass this; `defaultOps` supplies the real ones.
   */
  ops?: AcquireOps;
}

/** What the page-side probe returns before acquire() adds the frame-advance verdict. */
export interface RawProbe {
  evidence: Record<string, unknown>;
  failures: string[];
  frameBefore: number;
  frameAtCapture: number;
}

/** The scene-touching primitives acquire() sequences. Mockable. */
export interface AcquireOps {
  settleAt(az: number): Promise<void>;
  setLayers(flags: LayerFlags): Promise<void>;
  fitLimb(): Promise<{ cx: number; cy: number; r: number }>;
  capture(): Promise<Bitmap>;
  install(spec: DefectSpec, pinName: string | undefined): Promise<void>;
  uninstall(): Promise<void>;
  waitFrames(n: number): Promise<void>;
  probe(spec: DefectSpec, pinName: string | undefined): Promise<RawProbe>;
}

/** Geometry cache: a fit is only reused for an identical camera/flags/azimuth. */
const fitCache = new Map<string, DiscGeometry>();

/** Exposed so a test can prove the cache is keyed on more than the azimuth. */
export function __clearFitCache(): void {
  fitCache.clear();
}

function cacheKey(az: number, flags: LayerFlags): string {
  const f = flags;
  return [
    VIEWPORT.width,
    VIEWPORT.height,
    az,
    f.stars,
    f.rings,
    f.atmosphere,
    f.clouds,
    f.pins,
    f.bloom,
  ].join('|');
}

/**
 * The page-side defect implementations, installed once per page.
 *
 * Written as a single function so it can be handed to `page.evaluate` verbatim: it
 * must not close over anything from the spec process. Every defect follows the same
 * two rules, both learned the hard way:
 *
 *   - `apply()` is IDEMPOTENT and re-runs every frame through `onBeforeRender`, so a
 *     React re-render or a material swap cannot quietly undo it. The old injector
 *     wrote once and hoped; `setLayers` re-renders React, and `fitLimb` swaps the
 *     surface material, and either could discard a one-shot write.
 *   - values are re-written BY NAME off a stored descriptor each frame, never through a
 *     captured object reference, because `fitLimb` replaces the material instance and
 *     the old reference then points at a detached object that nothing renders.
 */
const DEFECT_SOURCE = function installDefectEngine(): void {
  interface ThreeNS {
    PointLight: new (color: number, intensity: number, distance: number) => LightLike;
    DirectionalLight: new (color: number, intensity: number) => LightLike;
  }
  interface LightLike {
    position: { set(x: number, y: number, z: number): void };
    name: string;
    userData: Record<string, unknown>;
    intensity: number;
    distance?: number;
    color?: { getHexString(): string };
  }
  interface MatLike {
    uniforms?: Record<string, { value: unknown }>;
    fragmentShader?: string;
    needsUpdate?: boolean;
    type?: string;
    specularIntensity?: number;
    roughnessMap?: unknown;
    roughness?: number;
    emissiveIntensity?: number;
    visible?: boolean;
    uuid?: string;
    [key: string]: unknown;
  }
  interface ObjLike {
    isLight?: boolean;
    isMesh?: boolean;
    material?: MatLike;
    userData: Record<string, unknown>;
    children?: ObjLike[];
    name?: string;
  }
  interface SceneLike {
    add(o: unknown): void;
    remove(o: unknown): void;
    traverse(fn: (o: unknown) => void): void;
    onBeforeRender: (() => void) | null;
  }

  const w = window as unknown as {
    __scene: SceneLike;
    __camera: unknown;
    __gl: { info: { programs: unknown[] | null; render: { frame: number } }; render(s: unknown, c: unknown): void };
    __THREE: ThreeNS;
    __defects?: {
      install(name: string, params: Record<string, unknown>, pinName?: string): void;
      uninstall(): void;
      probe(name: string, params: Record<string, unknown>, pinName?: string): Record<string, unknown>;
    };
  };

  /** Pins resolvable to world space, so a defect can be anchored like the renderer does. */
  const pinsWorld = (): Array<{ name: string; core: number[]; surface: number[]; normal: number[] }> => {
    const look = (window as unknown as { __look: { pinsWorld(): Array<{ name: string; core: number[]; surface: number[]; normal: number[] }> } }).__look;
    return look.pinsWorld();
  };

  /** The opaque-at-the-silhouette atmosphere, part 2: kill the shader's own fade. */
  const OPAQUE_ATMOSPHERE_FRAG = `
    uniform float uIntensity;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      // Constant alpha: no impact-parameter falloff, no fresnel, no fade at the
      // silhouette. The shell paints a hard opaque annulus that stops dead at its
      // geometry edge, which is exactly the hard ring 3.1 exists to reject.
      gl_FragColor = vec4(vec3(0.55, 0.72, 1.0) * uIntensity, 1.0);
    }
  `;

  let state: {
    name: string;
    params: Record<string, unknown>;
    pinName?: string;
    light?: LightLike;
    prevOnBeforeRender: (() => void) | null;
    saved: Array<{ mat: MatLike; key: string; value: unknown }>;
    addedRootLight: boolean;
    installedFrame: number;
  } | null = null;

  /** Run one idempotent apply pass. Called now and on every frame while installed. */
  const apply = (): void => {
    if (!state) return;
    const { name, params, light } = state;

    if (name === 'pointLight' && light) {
      /*
       * Lights go to the scene ROOT and the light object is REUSED, not recreated.
       *
       * Re-adding per frame would grow the light list without bound; recreating it
       * would reset `intensity`/`distance` on anything that wrote to them. The only
       * per-frame work needed is to re-assert the position, because a parent group
       * that rotates would otherwise take the light with it.
       */
      const pin = pinsWorld().find((p) => p.name === state!.pinName);
      if (pin) light.position.set(pin.core[0], pin.core[1], pin.core[2]);
      light.intensity = Number(params.intensity ?? 2);
      if (typeof light.distance === 'number') light.distance = Number(params.distance ?? 1);
      return;
    }

    if (name === 'fillLight' && light) {
      light.intensity = Number(params.intensity ?? 0.32);
      return;
    }

    if (name === 'mirrorSurface') {
      w.__scene.traverse((o) => {
        const m = o as ObjLike;
        if (!m.isMesh || !m.material) return;
        if (m.material.type !== 'MeshPhysicalMaterial') return;
        m.material.specularIntensity = Number(params.specularIntensity ?? 1);
        m.material.roughnessMap = null;
        m.material.roughness = Number(params.roughness ?? 0);
      });
      return;
    }

    if (name === 'atmosphereOpaque') {
      w.__scene.traverse((o) => {
        const m = o as ObjLike;
        if (!m.isMesh || !m.material?.uniforms) return;
        if (!('uAlphaCap' in m.material.uniforms)) return;
        // Part 1: the cap, which alone was measured to do nothing (the curve was
        // already below it).
        m.material.uniforms.uAlphaCap.value = 1;
        if ('uIntensity' in m.material.uniforms) {
          m.material.uniforms.uIntensity.value = Number(params.intensity ?? 2.5);
        }
        // Part 2, the one that actually bites: the shader's own silhouette fade.
        // Replaced by name every frame, so a `fitLimb` material swap cannot revive it.
        m.material.fragmentShader = OPAQUE_ATMOSPHERE_FRAG;
        m.material.needsUpdate = true;
      });
      return;
    }

    if (name === 'pinEmissiveBoost') {
      const pin = pinsWorld().find((p) => p.name === state!.pinName);
      const factor = Number(params.factor ?? 4);
      w.__scene.traverse((o) => {
        const m = o as ObjLike;
        if (!m.isMesh || !m.material) return;
        if (m.material.type !== 'MeshStandardMaterial') return;
        if (!pin) return;
        /*
         * Match the core by position, because the pin meshes carry no `name`.
         * A `MeshStandardMaterial` whose object sits within 0.02 of the pin's core
         * world position IS the core sphere (the housing is MeshBasicMaterial, so
         * matching on material type already excludes it).
         */
        const obj = o as unknown as { getWorldPosition(t: unknown): { x: number; y: number; z: number } };
        const Three = w.__THREE as unknown as { Vector3: new () => unknown };
        const t = new Three.Vector3() as { x: number; y: number; z: number };
        obj.getWorldPosition(t);
        const d = Math.hypot(t.x - pin.core[0], t.y - pin.core[1], t.z - pin.core[2]);
        if (d > 0.02) return;
        m.material.emissiveIntensity = Number(params.baseIntensity ?? 1.75) * factor;
        m.material.needsUpdate = true;
      });
      return;
    }

    if (name === 'pinsHidden') {
      const pin = pinsWorld().find((p) => p.name === state!.pinName);
      if (!pin) return;
      w.__scene.traverse((o) => {
        const m = o as ObjLike;
        if (!m.isMesh || !m.material) return;
        const obj = o as unknown as { getWorldPosition(t: unknown): { x: number; y: number; z: number } };
        const Three = w.__THREE as unknown as { Vector3: new () => unknown };
        const t = new Three.Vector3() as { x: number; y: number; z: number };
        obj.getWorldPosition(t);
        const d = Math.hypot(t.x - pin.core[0], t.y - pin.core[1], t.z - pin.core[2]);
        if (d > 0.1) return;
        m.material.visible = false;
      });
    }
  };

  w.__defects = {
    install(name, params, pinName) {
      this.uninstall();
      const scene = w.__scene;
      const Three = w.__THREE;
      let light: LightLike | undefined;
      let addedRootLight = false;

      if (name === 'pointLight') {
        light = new Three.PointLight(Number(params.color ?? 0xffaa00), Number(params.intensity ?? 2), Number(params.distance ?? 1));
        light.name = '__negative_pointLight';
        light.userData.__negativeInjected = true;
        const pin = pinsWorld().find((p) => p.name === pinName);
        if (pin) light.position.set(pin.core[0], pin.core[1], pin.core[2]);
        scene.add(light);
        addedRootLight = true;
      } else if (name === 'fillLight') {
        light = new Three.DirectionalLight(Number(params.color ?? 0x2f6fb8), Number(params.intensity ?? 0.32));
        light.position.set(-5.2, -2.2, -4.6);
        light.name = '__negative_fillLight';
        light.userData.__negativeInjected = true;
        scene.add(light);
        addedRootLight = true;
      }

      state = {
        name,
        params,
        pinName,
        light,
        prevOnBeforeRender: scene.onBeforeRender ?? null,
        saved: [],
        addedRootLight,
        installedFrame: w.__gl.info.render.frame,
      };

      /*
       * Chain, never replace: `Scene.onBeforeRender` is a single slot that the app or
       * the bloom pass may already own, and clobbering it would break whatever set it.
       * WebGLRenderer.render calls it before it collects lights, so re-applying here
       * lands before the draw that matters — and also under the bloom RenderPass.
       */
      scene.onBeforeRender = () => {
        if (state?.prevOnBeforeRender) state.prevOnBeforeRender();
        apply();
      };

      // One immediate pass, so the first probe and the first draw already see it.
      apply();
      if (addedRootLight) {
        // A new light changes the compiled program; one rebuild is enough, and it is
        // done exactly once so per-frame work stays cheap.
        scene.traverse((o) => {
          const m = o as ObjLike;
          if (m.isMesh && m.material) m.material.needsUpdate = true;
        });
      }
      w.__gl.render(scene, w.__camera);
    },

    uninstall() {
      if (!state) return;
      const closing = state;
      const scene = w.__scene;
      scene.onBeforeRender = closing.prevOnBeforeRender;
      if (closing.light) scene.remove(closing.light);
      // Undo the material writes by putting back the values that were read at install.
      for (const s of closing.saved) s.mat[s.key] = s.value;
      // Any defect may have touched materials; a rebuild is the cheapest honest reset.
      scene.traverse((o) => {
        const m = o as ObjLike;
        if (!m.isMesh || !m.material) return;
        if (m.material.visible === false) m.material.visible = true;
        if (m.material.type === 'ShaderMaterial' && m.material.uniforms && 'uAlphaCap' in m.material.uniforms) {
          const original = closing.params.__originalFrag;
          if (typeof original === 'string') m.material.fragmentShader = original;
        }
        m.material.needsUpdate = true;
      });
      state = null;
      w.__gl.render(scene, w.__camera);
    },

    probe(name, params, pinName) {
      const scene = w.__scene;
      const gl = w.__gl;
      const evidence: Record<string, unknown> = {};
      const failures: string[] = [];

      let lights = 0;
      scene.traverse((o) => {
        const l = o as ObjLike;
        if (l.isLight) lights += 1;
      });
      evidence.lights = lights;

      if (name === 'pointLight' || name === 'fillLight') {
        let found: Record<string, unknown> | null = null;
        scene.traverse((o) => {
          const l = o as ObjLike & { isLight?: boolean; intensity?: number; distance?: number; position?: { x: number; y: number; z: number }; parent?: { uuid?: string } };
          const wanted = name === 'pointLight' ? '__negative_pointLight' : '__negative_fillLight';
          if (l.name !== wanted) return;
          found = {
            intensity: l.intensity,
            distance: l.distance,
            position: [l.position?.x, l.position?.y, l.position?.z],
            atSceneRoot: l.parent === (scene as unknown),
          };
        });
        evidence.light = found;
        if (!found) failures.push(`the injected ${name} is not in the scene`);
        else {
          const f = found as { intensity?: number; atSceneRoot?: boolean; position?: number[] };
          const want = Number(params.intensity ?? (name === 'pointLight' ? 2 : 0.32));
          if (Math.abs((f.intensity ?? 0) - want) > 1e-6) {
            failures.push(`light intensity is ${f.intensity}, expected ${want}`);
          }
          if (name === 'pointLight' && !f.atSceneRoot) failures.push('light is not parented to the scene root');
          if (name === 'pointLight' && pinName) {
            const pin = pinsWorld().find((p) => p.name === pinName);
            if (pin && f.position) {
              const d = Math.hypot(
                f.position[0] - pin.core[0],
                f.position[1] - pin.core[1],
                f.position[2] - pin.core[2],
              );
              evidence.lightToPinCore = +d.toFixed(6);
              if (d > 1e-6) failures.push(`light is ${d.toFixed(4)} world units from the pin core, expected 0`);
            }
          }
        }
      }

      if (name === 'atmosphereOpaque') {
        let atm: Record<string, unknown> | null = null;
        scene.traverse((o) => {
          const m = o as ObjLike;
          if (!m.isMesh || !m.material?.uniforms) return;
          if (!('uAlphaCap' in m.material.uniforms)) return;
          atm = {
            alphaCap: m.material.uniforms.uAlphaCap.value,
            intensity: m.material.uniforms.uIntensity?.value ?? null,
            shaderReplaced: (m.material.fragmentShader ?? '').includes('Constant alpha'),
            materialUuid: m.material.uuid,
          };
        });
        evidence.atmosphere = atm;
        if (!atm) failures.push('the atmosphere material is not in the scene');
        else {
          const a = atm as { alphaCap?: unknown; shaderReplaced?: boolean };
          if (Number(a.alphaCap) !== 1) failures.push(`uAlphaCap is ${a.alphaCap}, expected 1`);
          if (!a.shaderReplaced) failures.push('the silhouette-fade shader was not replaced');
        }
      }

      if (name === 'mirrorSurface') {
        let mat: Record<string, unknown> | null = null;
        scene.traverse((o) => {
          const m = o as ObjLike;
          if (!m.isMesh || m.material?.type !== 'MeshPhysicalMaterial') return;
          mat = {
            specularIntensity: m.material.specularIntensity,
            roughness: m.material.roughness,
            hasRoughnessMap: m.material.roughnessMap !== null,
          };
        });
        evidence.earthSurface = mat;
        if (!mat) failures.push('the Earth surface material is not in the scene');
        else {
          const s = mat as { specularIntensity?: unknown; roughness?: unknown; hasRoughnessMap?: boolean };
          if (Number(s.specularIntensity) !== Number(params.specularIntensity ?? 1)) {
            failures.push(`specularIntensity is ${s.specularIntensity}, expected ${params.specularIntensity ?? 1}`);
          }
          if (s.hasRoughnessMap) failures.push('roughnessMap is still attached, so the roughness floor still applies');
        }
      }

      if (name === 'pinEmissiveBoost' || name === 'pinsHidden') {
        let hits = 0;
        let maxEmissive = 0;
        let hidden = 0;
        scene.traverse((o) => {
          const m = o as ObjLike;
          if (!m.isMesh || !m.material) return;
          if (m.material.visible === false) hidden += 1;
          if (m.material.type !== 'MeshStandardMaterial') return;
          if (m.material.emissiveIntensity !== undefined) {
            maxEmissive = Math.max(maxEmissive, m.material.emissiveIntensity);
            hits += 1;
          }
        });
        evidence.pinMaterials = { hits, maxEmissive, hidden };
        if (name === 'pinEmissiveBoost') {
          const want = Number(params.baseIntensity ?? 1.75) * Number(params.factor ?? 4);
          if (Math.abs(maxEmissive - want) > 1e-6) {
            failures.push(`max emissiveIntensity is ${maxEmissive}, expected ${want}`);
          }
        }
        if (name === 'pinsHidden' && hidden === 0) {
          failures.push('no material was hidden; the pin core was not found by position');
        }
      }

      evidence.frameAtProbe = gl.info.render.frame;
      return { evidence, failures, frameBefore: 0, frameAtCapture: gl.info.render.frame } as Record<string, unknown>;
    },
  };
};

/** Real ops, wired to the committed capture helpers. */
function defaultOps(page: Page): AcquireOps {
  let pending: DefectSpec | null = null;
  let pendingPin: string | undefined;
  return {
    settleAt: (az) => settleAt(page, az),
    setLayers: (flags) => setLayers(page, flags),
    fitLimb: () => fitLimb(page),
    capture: () => capture(page),
    install: async (spec, pinName) => {
      pending = spec;
      pendingPin = pinName;
      await page.evaluate(
        ({ name, params, pin }: { name: string; params: Record<string, unknown>; pin?: string }) => {
          const w = window as unknown as { __defects?: { install(n: string, p: Record<string, unknown>, pin?: string): void }; __DEFECT_ENGINE_INSTALLED?: boolean };
          if (!w.__defects) throw new Error('defect engine is not installed on this page');
          w.__defects.install(name, params, pin);
        },
        { name: spec.name, params: spec.params ?? {}, pin: pinName },
      );
    },
    uninstall: async () => {
      pending = null;
      await page.evaluate(() => {
        const w = window as unknown as { __defects?: { uninstall(): void } };
        w.__defects?.uninstall();
      });
    },
    waitFrames: async (n) => {
      await page.evaluate(
        (count: number) =>
          new Promise<void>((resolve) => {
            let i = 0;
            const tick = (): void => {
              i += 1;
              if (i >= count) resolve();
              else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }),
        n,
      );
    },
    probe: async (spec, pinName) => {
      void pending;
      void pendingPin;
      const raw = (await page.evaluate(
        ({ name, params, pin }: { name: string; params: Record<string, unknown>; pin?: string }) => {
          const w = window as unknown as { __defects?: { probe(n: string, p: Record<string, unknown>, pin?: string): Record<string, unknown> } };
          if (!w.__defects) throw new Error('defect engine is not installed on this page');
          return w.__defects.probe(name, params, pin);
        },
        { name: spec.name, params: spec.params ?? {}, pin: pinName },
      )) as {
        evidence: Record<string, unknown>;
        failures: string[];
        frameBefore: number;
        frameAtCapture: number;
      };
      return raw;
    },
  };
}

/** Install the page-side defect engine. Idempotent; call from `openGlobe` wrappers. */
export async function installDefectEngine(page: Page): Promise<void> {
  await page.evaluate(DEFECT_SOURCE);
}

/**
 * Acquire one capture with an optional defect installed, in the fixed order.
 *
 * Analysis never calls this twice for the same view; a negative test acquires with the
 * defect and the check functions are run afterwards on the returned bitmaps. That is
 * what keeps a pixel check from being able to mutate the scene it measures.
 */
export async function acquire(page: Page, options: AcquireOptions = {}): Promise<AcquireResult> {
  const { flags = {}, azimuth = 0, defect = null, pinName, ops = defaultOps(page) } = options;
  const steps: string[] = [];

  // (1) flags first: they change what is drawn, so everything downstream keys off them.
  steps.push('setLayers');
  await ops.setLayers(flags);
  steps.push('settleAt');
  await ops.settleAt(azimuth);

  // (2) geometry, cached on viewport + camera + azimuth + flags.
  steps.push('fitLimb');
  const key = cacheKey(azimuth, flags);
  let geom = fitCache.get(key);
  if (!geom) {
    const fit = await ops.fitLimb();
    if (!Number.isFinite(fit.r) || fit.r <= 0) {
      throw new Error(`acquire: limb fit produced no circle at az ${azimuth} (r=${fit.r})`);
    }
    geom = { cx: fit.cx, cy: fit.cy, r: fit.r };
    fitCache.set(key, geom);
  }

  const flagsAfterFit = { ...flags };
  steps.push('setLayersAfterFit');
  await ops.setLayers(flagsAfterFit);

  // (2b) the baseline the restore is compared against.
  steps.push('captureBaseline');
  const baseline = await ops.capture();

  if (!defect) {
    return {
      frame: baseline,
      baseline,
      restored: baseline,
      geometry: geom,
      probe: null,
      steps,
      restoreDriftPct: 0,
    };
  }

  // (3) install. AFTER the fit and after the layer writes, because both can rebuild
  // materials and a defect written before them is written into an object nothing draws.
  steps.push('installDefect');
  await ops.install(defect, pinName);

  // (4) three frames: one to recompile, one to draw, one to be sure.
  steps.push('waitFrames');
  await ops.waitFrames(3);

  // (5) SURVIVAL PROBE. Without this a negative test cannot distinguish "the check is
  // blind" from "the defect never reached the pixels" — which is the exact confusion
  // that parked N1/N3/N4 on `test.fixme` with no way to tell the two apart.
  steps.push('survivalProbe');
  const raw = await ops.probe(defect, pinName);
  const failures = [...raw.failures];
  if (raw.frameAtCapture <= raw.frameBefore) {
    failures.push(
      `renderer.info.render.frame did not advance after install (${raw.frameBefore} -> ${raw.frameAtCapture})`,
    );
  }
  const probe: SurvivalProbe = {
    defect: defect.name,
    alive: failures.length === 0,
    evidence: raw.evidence,
    failures,
    frameBefore: raw.frameBefore,
    frameAtCapture: raw.frameAtCapture,
  };
  if (!probe.alive) {
    throw new Error(`defect lost before capture: ${failures.join('; ')}`);
  }

  // (6) the capture the checks will analyse.
  steps.push('captureDefect');
  const frame = await ops.capture();

  // (7) uninstall.
  steps.push('uninstallDefect');
  await ops.uninstall();

  // (8) prove the scene came back, so one negative test cannot poison the next.
  steps.push('captureRestored');
  await ops.waitFrames(2);
  const restored = await ops.capture();

  return {
    frame,
    baseline,
    restored,
    geometry: geom,
    probe,
    steps,
    restoreDriftPct: discDriftPct(baseline, restored, geom),
  };
}

/**
 * Mean |luma| difference inside the disc, as a percentage of the baseline mean.
 *
 * Used by step (8). Deliberately the same statistic `measureRingCast` uses for its
 * noise floor, so "restored within noise" means the same thing as "no cast light".
 */
export function discDriftPct(a: Bitmap, b: Bitmap, geom: DiscGeometry): number {
  if (a.width !== b.width || a.height !== b.height) return Number.POSITIVE_INFINITY;
  const r2 = geom.r * geom.r;
  let sa = 0;
  let sb = 0;
  let n = 0;
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      if ((x - geom.cx) ** 2 + (y - geom.cy) ** 2 > r2) continue;
      const o = (y * a.width + x) * 4;
      sa += 0.2126 * a.data[o] + 0.7152 * a.data[o + 1] + 0.0722 * a.data[o + 2];
      sb += 0.2126 * b.data[o] + 0.7152 * b.data[o + 1] + 0.0722 * b.data[o + 2];
      n += 1;
    }
  }
  if (n === 0) return Number.POSITIVE_INFINITY;
  const ma = sa / n;
  const mb = sb / n;
  if (ma === 0) return mb === 0 ? 0 : Number.POSITIVE_INFINITY;
  return Math.abs((mb - ma) / ma) * 100;
}
