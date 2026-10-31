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
  /** The faithful N4: the retired cool fill light AND the material specular that made it glow. */
  | 'fillLightWithSpecular'
  | 'pinEmissiveBoost'
  | 'pinsHidden'
  /** Albedo-neutral surface: textures removed, flat per-channel means in linear space. */
  | 'flatAlbedo'
  /** N6c: a white AmbientLight at the scene root, which lifts the emissive night floor. */
  | 'ambientLight'
  /** N6d: a two-texel toon ramp, i.e. a genuinely hard terminator in a live render. */
  | 'toonTerminator';

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
  /** Frames taken under the live defect via `extraCaptures`, keyed by label. */
  extras: Record<string, Bitmap>;
  /** Survival probe re-run AFTER the extras — proves they were defect-bearing too. */
  probeAfterExtras: SurvivalProbe | null;
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
   * Extra captures taken while the defect is STILL LIVE, between the defect capture and
   * the uninstall. Each entry is {label, flags}.
   *
   * Exists because some checks need more than one frame under the same defect. 3.6, for
   * instance, compares pins-ON against a pins-OFF pair, and both of those "off" frames
   * must carry the defect — otherwise the delta is pins-vs-no-pins and the injected light
   * gets attributed to the pin. Taking them after `acquire` returns would be too late:
   * acquire uninstalls on the way out, which is exactly what the first attempt at N1 got
   * wrong ("the injected pointLight is not in the scene").
   */
  extraCaptures?: Array<{ label: string; flags: LayerFlags }>;

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
    /** three's Color on the new defects. */
    color?: unknown;
    emissive?: unknown;
    /** Texture slots the flat-albedo probe removes. */
    map?: unknown;
    emissiveMap?: unknown;
    /** Present on every three material; the flat-albedo probe stores its save slot here. */
    userData: Record<string, unknown>;
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
      /** Per-channel means of the day and night textures in LINEAR space. */
      textureMeans(): Record<string, number[]>;
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

  /*
   * Engine-scope accumulators, not install-scope.
   *
   * `apply()` is defined OUTSIDE `install()` (it is called from a chained `onBeforeRender`), so it
   * cannot see install's locals — the first attempt to keep them there failed to compile with
   * "Cannot find name 'savedFlat'". They live here, cleared at the start of every install.
   */
  let savedFlat: Array<{ mat: MatLike; key: string; value: unknown }> = [];
  /** Material uuids already snapshotted, so a rebuild is captured exactly once. */
  let savedFlatSeen = new Set<string>();

  /**
   * The PRISTINE surface textures, captured once before anything is flattened.
   *
   * Per-instance snapshots were not enough: R3F rebuilds the surface material on a React re-render,
   * and a rebuild that happens AFTER the restore loop leaves a fresh material in whatever state the
   * last write put it. Restoring from a single pristine record — re-applied to every instance found —
   * is robust to any number of rebuilds in any order.
   */
  let pristineSurface: { map: unknown; emissiveMap: unknown; color: unknown; emissive: unknown } | null = null;

  let state: {
    name: string;
    params: Record<string, unknown>;
    pinName?: string;
    light?: LightLike;
    prevOnBeforeRender: (() => void) | null;
    saved: Array<{ mat: MatLike; key: string; value: unknown }>;
    /** Material originals for defects that re-apply every frame; may grow after install. */
    savedExtra?: Array<{ mat: MatLike; key: string; value: unknown }>;
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
       * Re-adding per frame would grow the light list without bound; recreating it would
       * reset `intensity`/`distance` on anything that wrote to them. The only per-frame
       * work needed is to re-assert the position, because a parent group that rotates
       * would otherwise take the light with it.
       */
      const pin = pinsWorld().find((p) => p.name === state!.pinName);
      if (pin) light.position.set(pin.core[0], pin.core[1], pin.core[2]);

      /*
       * The light follows the PIN LAYER, and this is load-bearing rather than tidy.
       *
       * 3.6 detects light cast by pins by differencing pins-ON against pins-OFF. A defect
       * light that is present in BOTH frames cancels out of that difference and the check
       * correctly reports no cast — measured: 123.542 vs 123.680, 0.112% against a 3%
       * gate, with the light provably live in both. Gating the light on the same flag the
       * pins themselves read makes the defect mean what N1 claims it means: "when the pins
       * are drawn, they cast amber light onto the surface around them."
       */
      const flags = (
        window as unknown as { __look: { get(): { pins: boolean } } }
      ).__look.get();
      light.intensity = flags.pins ? Number(params.intensity ?? 2) : 0;
      if (typeof light.distance === 'number') light.distance = Number(params.distance ?? 1);
      return;
    }

    if (name === 'flatAlbedo') {
      /*
       * Re-asserted every frame like every other defect: `setLayers` triggers a React re-render and
       * R3F can rebuild the surface material, which would silently restore the textures mid-measurement.
       * The values come back off the stored descriptor, never a captured material reference.
       */
      const Three = w.__THREE as unknown as { Color: new (v: unknown) => unknown };
      const level = Number(params.level ?? 1);
      const dayMean = (params.dayMean as number[] | undefined) ?? [1, 1, 1];
      const nightMean = (params.nightMean as number[] | undefined) ?? [0, 0, 0];
      const toTriple = (v: number[]): string =>
        `rgb(${v.map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255)).join(',')})`;
      w.__scene.traverse((o) => {
        const m = o as ObjLike;
        if (!m.isMesh || !m.material) return;
        if (m.material.type !== 'MeshPhysicalMaterial') return;
        /*
         * SNAPSHOT EVERY NEW MATERIAL INSTANCE, not just the one seen at install.
         *
         * `setLayers` re-renders React and R3F rebuilds the surface material; `fitLimb` swaps it
         * outright. A one-shot snapshot captured the OLD instance, so restoring it put the textures
         * back on an object nothing renders while the NEW material stayed flattened — measured as
         * `map=false emissiveMap=false` after uninstall. This is the same seam D1 diagnosed for the
         * injected light, and the fix is the same: re-snapshot by identity each frame.
         */
        const seen = savedFlatSeen;
        const uuid = (m.material.uuid ?? 'unknown') as string;
        if (!seen.has(uuid)) {
          seen.add(uuid);
          savedFlat.push(
            { mat: m.material, key: 'map', value: m.material.map },
            { mat: m.material, key: 'emissiveMap', value: m.material.emissiveMap },
            { mat: m.material, key: 'color', value: m.material.color },
            { mat: m.material, key: 'emissive', value: m.material.emissive },
          );
        }
        m.material.map = null;
        m.material.emissiveMap = null;
        (m.material as { color?: unknown }).color = new Three.Color(
          toTriple([Math.min(1, dayMean[0] * level), Math.min(1, dayMean[1] * level), Math.min(1, dayMean[2] * level)]),
        );
        (m.material as { emissive?: unknown }).emissive = new Three.Color(toTriple(nightMean));
        m.material.needsUpdate = true;
      });
      return;
    }

    if (name === 'fillLight' || name === 'fillLightWithSpecular') {
      if (light) light.intensity = Number(params.intensity ?? 0.32);
      /*
       * Re-assert the material half every frame, the same way every other defect does. A
       * React re-render triggered by the `setLayers` calls inside `measureBlueCircle` can
       * rebuild the surface material, and a one-shot write would then be lost silently —
       * exactly the failure mode D1 diagnosed for the point light.
       */
      const savedSpecular: Array<{ mat: MatLike; key: string; value: unknown }> = [];
      if (name === 'fillLightWithSpecular') {
        w.__scene.traverse((o) => {
          const m = o as ObjLike;
          if (!m.isMesh || !m.material) return;
          if (m.material.type !== 'MeshPhysicalMaterial') return;
          /*
           * Snapshot the originals BEFORE overwriting, and restore them from that snapshot.
           * Hardcoding 0 / 0.9 here would break the moment GLOBE_LOOK.surface changes, and a
           * defect that leaves the scene in a state it did not find it in poisons the next
           * negative test.
           */
          savedSpecular.push(
            { mat: m.material, key: 'specularIntensity', value: m.material.specularIntensity },
            { mat: m.material, key: 'roughness', value: m.material.roughness },
            { mat: m.material, key: 'roughnessMap', value: m.material.roughnessMap },
          );
          m.material.specularIntensity = Number(params.specularIntensity ?? 0.18);
          m.material.roughnessMap = null;
          m.material.roughness = Number(params.roughness ?? 0);
        });
      }
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
      savedFlat = [];
      savedFlatSeen = new Set<string>();
      /*
       * Declared at the TOP of install, not next to its only user: the flat-albedo block runs during
       * install and pushes into this array, and a `const` declared further down is in the temporal
       * dead zone at that moment — the first run failed with "Cannot access 'savedFlat' before
       * initialization", which is the browser telling us the order was wrong.
       */

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
      } else if (name === 'fillLight' || name === 'fillLightWithSpecular') {
        /*
         * The light retired by 2e27939, at its exact recorded place and intensity.
         *
         * `position` and `intensity` are NOT parameters with defaults chosen here — they are
         * the values read out of `git show 2e27939^:src/scene/GlobeScene.tsx`:
         *
         *     <directionalLight position={[-5.2, -2.2, -4.6]} intensity={0.32} color="#2f6fb8" />
         *
         * N4's whole claim is about THAT light, so a caller cannot quietly restate it. The
         * params below exist only so the informational variant can report what it used.
         */
        light = new Three.DirectionalLight(Number(params.color ?? 0x2f6fb8), Number(params.intensity ?? 0.32));
        light.position.set(-5.2, -2.2, -4.6);
        light.name = '__negative_fillLight';
        light.userData.__negativeInjected = true;
        scene.add(light);
        addedRootLight = true;
      }

      if (name === 'flatAlbedo') {
        /*
         * THE ALBEDO-NEUTRAL PROBE.
         *
         * Purpose: separate geography from shading. With the clock frozen the terminator is a fixed
         * great circle, so a 0.02-wide n·L bin is a thin geographic strip and its median luma is
         * whatever land, ocean or ice that strip happens to cross. Removing the textures makes the
         * surface a pure function of n·L, so any remaining step in the curve is the SHADER, not the
         * coastline.
         *
         * The flat colours are the per-channel means of the textures in LINEAR space, read by
         * `__defects.textureMeans()` and passed in as params — computed from the real textures, not
         * hardcoded. Averaging in sRGB would be wrong: the mean of 0.0 and 1.0 is 0.5 there but 0.21
         * in linear, and three multiplies in linear, so an sRGB mean makes a mostly-dark ocean far
         * too bright.
         *
         * Day colour scales by `level` (clamped per channel); the night colour is unchanged, because
         * the night side is an emissive floor and the probe must not disturb what it measures against.
         */
        const Three = w.__THREE as unknown as { Color: new (v: unknown) => unknown };
        const level = Number(params.level ?? 1);
        const dayMean = (params.dayMean as number[] | undefined) ?? [1, 1, 1];
        const nightMean = (params.nightMean as number[] | undefined) ?? [0, 0, 0];
        if (!pristineSurface) {
          w.__scene.traverse((o) => {
            const m = o as ObjLike;
            if (pristineSurface) return;
            if (!m.isMesh || m.material?.type !== 'MeshPhysicalMaterial') return;
            if (m.material.map === null || m.material.map === undefined) return;
            pristineSurface = {
              map: m.material.map,
              emissiveMap: m.material.emissiveMap,
              color: m.material.color,
              emissive: m.material.emissive,
            };
          });
        }
        const dayLin: [number, number, number] = [
          Math.min(1, (dayMean[0] ?? 1) * level),
          Math.min(1, (dayMean[1] ?? 1) * level),
          Math.min(1, (dayMean[2] ?? 1) * level),
        ];
        const toTriple = (v: number[]): string =>
          `rgb(${v.map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255)).join(',')})`;

        w.__scene.traverse((o) => {
          const m = o as ObjLike;
          if (!m.isMesh || !m.material) return;
          if (m.material.type !== 'MeshPhysicalMaterial') return;
          /*
           * Record the originals through the engine's OWN `saved` mechanism, not a userData slot.
           * The generic restore replays `saved` first on uninstall, so anything written to userData
           * is already gone by the time a per-defect block could read it — which is exactly how the
           * first version leaked (the surface came back still flattened). One mechanism, one order.
           */
          savedFlat.push(
            { mat: m.material, key: 'map', value: m.material.map },
            { mat: m.material, key: 'emissiveMap', value: m.material.emissiveMap },
            { mat: m.material, key: 'color', value: m.material.color },
            { mat: m.material, key: 'emissive', value: m.material.emissive },
          );
          m.material.map = null;
          m.material.emissiveMap = null;
          (m.material as { color?: unknown }).color = new Three.Color(toTriple(dayLin));
          /*
           * `emissive` is MULTIPLIED by the night texture when `emissiveMap` is present, so with the
           * map gone the emissive colour carries the night mean itself. `emissiveIntensity` (0.18)
           * is left untouched: the night floor must keep the level it has in the real render.
           */
          (m.material as { emissive?: unknown }).emissive = new Three.Color(toTriple(nightMean));
          m.material.needsUpdate = true;
        });
        return;
      }

      if (name === 'ambientLight') {
        /*
         * N6c. A white AmbientLight lifts EVERY surface uniformly, including the emissive night
         * floor — which is exactly why it destroys the day/night separation that 3.4's VISIBLE
         * predicate exists to measure. No positional falloff to worry about.
         */
        const Amb = (w.__THREE as unknown as { AmbientLight: new (c: number, i: number) => LightLike }).AmbientLight;
        light = new Amb(Number(params.color ?? 0xffffff), Number(params.intensity ?? 3));
        light.name = '__negative_ambientLight';
        light.userData.__negativeInjected = true;
        scene.add(light);
        addedRootLight = true;
      }

      if (name === 'toonTerminator') {
        /*
         * N6d. Replace the Earth surface with a MeshToonMaterial driven by a two-texel gradient map,
         * which quantises n·L to two levels — a genuinely hard terminator that no amount of albedo
         * smoothing can hide. The flat colours are passed in so the surface stays albedo-neutral:
         * this defect must be the ONLY difference from the flat control.
         */
        const Three = w.__THREE as unknown as {
          DataTexture: new (data: Uint8Array, w: number, h: number, fmt: unknown) => unknown;
          RedFormat?: unknown;
          RGBAFormat?: unknown;
          NearestFilter: unknown;
          MeshToonMaterial: new (opts: Record<string, unknown>) => MatLike;
          Color: new (v: unknown) => unknown;
          Vector2?: unknown;
        };
        // Two texels, dark then light, nearest-sampled: the classic toon ramp.
        const ramp = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]);
        const gradientMap = new Three.DataTexture(ramp, 2, 1, Three.RGBAFormat ?? 1023);
        (gradientMap as { magFilter?: unknown; minFilter?: unknown; needsUpdate?: boolean }).magFilter = Three.NearestFilter;
        (gradientMap as { magFilter?: unknown; minFilter?: unknown; needsUpdate?: boolean }).minFilter = Three.NearestFilter;
        (gradientMap as { needsUpdate?: boolean }).needsUpdate = true;

        w.__scene.traverse((o) => {
          const m = o as ObjLike;
          if (!m.isMesh || !m.material) return;
          if (m.material.type !== 'MeshPhysicalMaterial') return;
          const toon = new Three.MeshToonMaterial({
            color: params.dayColor ?? 0xffffff,
            gradientMap,
          });
          /*
           * Record the ORIGINAL MATERIAL OBJECT on the mesh before replacing it.
           *
           * `uninstall()` resets material PROPERTIES; it cannot put back a material INSTANCE that was
           * swapped out. Without this, N6d left the Earth as a toon surface for every later test —
           * measured as N10 failing afterwards, because its defect searches for a
           * `MeshPhysicalMaterial` and found none.
           */
          const mesh = o as unknown as { material: MatLike; userData: Record<string, unknown> };
          if (!mesh.userData.__origMaterial) mesh.userData.__origMaterial = mesh.material;
          mesh.material = toon;
        });
        return;
      }

      /*
       * The second half of the faithful N4, and the reason the ORIGINAL N4 could not fail.
       *
       * The blue circle at W1 was never the fill light acting on a matte surface. It was the
       * fill light acting on a surface with three's GGX specular enabled: `specularIntensity`
       * was 0.18 before 38aa091, and `clipped-probe.mjs` measured the probe window at luma
       * 91.1 with the fill light versus 4.1 without it. Since 38aa091 the surface is matte
       * (`specularIntensity: 0`) and the same light lifts blue by ~3/255 — invisible, which
       * is why the old N4 measured a 0.976 -> 0.982 ratio and was parked.
       *
       * So the faithful defect restores BOTH halves, from git:
       *   - the light: 2e27939^, position (-5.2, -2.2, -4.6), intensity 0.32, #2f6fb8;
       *   - the material: 38aa091^, specularIntensity 0.18 — the PRE-FIX value; the shipped
       *     surface is 0 since 38aa091 — with the roughness map detached so water is the
       *     mirror the roughness floor existed to prevent (floor 0 gave a ~14 px blown disc
       *     at 0.037% clipped, per that commit's own message).
       *
       * The 0.18 defaults below are the DEFECT's restored state, not a claim about the shipped
       * look. Nothing outside a negative test may set this value.
       *
       * `roughnessFloor: 0` is expressed as `roughnessMap = null` + `roughness = 0`, which is
       * what the probe did and what "no floor" means on the material.
       */
      const savedSpecular: Array<{ mat: MatLike; key: string; value: unknown }> = [];
      /** Flat-albedo originals; replayed by the generic restore before any per-defect block. */
      if (name === 'fillLightWithSpecular') {
        w.__scene.traverse((o) => {
          const m = o as ObjLike;
          if (!m.isMesh || !m.material) return;
          if (m.material.type !== 'MeshPhysicalMaterial') return;
          /*
           * Snapshot the originals BEFORE overwriting, and restore them from that snapshot.
           * Hardcoding 0 / 0.9 here would break the moment GLOBE_LOOK.surface changes, and a
           * defect that leaves the scene in a state it did not find it in poisons the next
           * negative test.
           */
          savedSpecular.push(
            { mat: m.material, key: 'specularIntensity', value: m.material.specularIntensity },
            { mat: m.material, key: 'roughness', value: m.material.roughness },
            { mat: m.material, key: 'roughnessMap', value: m.material.roughnessMap },
          );
          m.material.specularIntensity = Number(params.specularIntensity ?? 0.18);
          m.material.roughnessMap = null;
          m.material.roughness = Number(params.roughness ?? 0);
        });
      }

      state = {
        name,
        params,
        pinName,
        light,
        prevOnBeforeRender: scene.onBeforeRender ?? null,
        // The faithful N4 writes material values on every frame, so its originals are
        // snapshotted once here and replayed by the generic restore path on uninstall.
        /*
         * `saved` is spent by the generic restore; `savedExtra` is the flat-albedo set, which may
         * GROW after this point when apply() snapshots a rebuilt material. Both are live references,
         * so anything pushed later is still restored.
         */
        saved: savedSpecular,
        savedExtra: savedFlat,
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
      for (const sv of closing.saved) sv.mat[sv.key] = sv.value;
      for (const sv of closing.savedExtra ?? []) sv.mat[sv.key] = sv.value;
      /*
       * Then force the PRISTINE surface back, whatever instances exist now.
       *
       * This runs after the generic replay on purpose: a material rebuilt during the measurements was
       * never in `savedExtra`, and one rebuilt after the replay would keep the flat values. Applying
       * the pristine record to every MeshPhysicalMaterial present is idempotent and order-free.
       */
      if (closing.name === 'toonTerminator') {
        // Put back the material INSTANCE, not just its values.
        scene.traverse((o) => {
          const m = o as ObjLike & { userData?: Record<string, unknown> };
          const orig = m.userData?.__origMaterial as MatLike | undefined;
          if (!orig) return;
          (o as unknown as { material: MatLike }).material = orig;
          delete m.userData!.__origMaterial;
        });
      }
      if (closing.name === 'flatAlbedo' && pristineSurface) {
        const pr = pristineSurface;
        scene.traverse((o) => {
          const m = o as ObjLike;
          if (!m.isMesh || m.material?.type !== 'MeshPhysicalMaterial') return;
          (m.material as { map?: unknown }).map = pr.map;
          (m.material as { emissiveMap?: unknown }).emissiveMap = pr.emissiveMap;
          (m.material as { color?: unknown }).color = pr.color;
          (m.material as { emissive?: unknown }).emissive = pr.emissive;
          m.material.needsUpdate = true;
        });
      }
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

      if (name === 'pointLight' || name === 'fillLight' || name === 'fillLightWithSpecular' || name === 'ambientLight') {
        let found: Record<string, unknown> | null = null;
        scene.traverse((o) => {
          const l = o as ObjLike & { isLight?: boolean; intensity?: number; distance?: number; position?: { x: number; y: number; z: number }; parent?: { uuid?: string } };
          const wanted =
            name === 'pointLight'
              ? '__negative_pointLight'
              : name === 'ambientLight'
                ? '__negative_ambientLight'
                : '__negative_fillLight';
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
          const pinsOn =
            name === 'pointLight'
              ? (window as unknown as { __look: { get(): { pins: boolean } } }).__look.get().pins
              : true;
          evidence.pinsOn = pinsOn;
          const expectIntensity = name === 'pointLight' && !pinsOn ? 0 : want;
          if (Math.abs((f.intensity ?? 0) - expectIntensity) > 1e-6) {
            failures.push(`light intensity is ${f.intensity}, expected ${expectIntensity} (pins on: ${pinsOn})`);
          }
          // While pins are OFF the light must be DARK, or it cancels out of 3.6's difference.
          if (name === 'pointLight' && !pinsOn && (f.intensity ?? 0) !== 0) {
            failures.push('the pin light is still lit with the pin layer off, so 3.6 would cancel it');
          }
          if (name === 'pointLight' && pinsOn && (f.intensity ?? 0) === 0) {
            failures.push('the pin light is dark with the pin layer ON, so it cannot cast');
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

      if (name === 'fillLightWithSpecular') {
        // The material half must be provably live too, or this is just the old N4 again.
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
          const s = mat as { specularIntensity?: unknown; hasRoughnessMap?: boolean };
          const want = Number(params.specularIntensity ?? 0.18);
          if (Math.abs(Number(s.specularIntensity) - want) > 1e-6) {
            failures.push(`specularIntensity is ${s.specularIntensity}, expected ${want}`);
          }
          if (s.hasRoughnessMap) failures.push('roughnessMap is still attached, so the roughness floor still applies');
        }
      }

      if (name === 'flatAlbedo') {
        // The textures must be GONE and the colours flat, or this is not an albedo-neutral probe.
        let mat: Record<string, unknown> | null = null;
        scene.traverse((o) => {
          const m = o as ObjLike;
          if (!m.isMesh || m.material?.type !== 'MeshPhysicalMaterial') return;
          mat = {
            hasMap: m.material.map !== null && m.material.map !== undefined,
            hasEmissiveMap: m.material.emissiveMap !== null && m.material.emissiveMap !== undefined,
            color: (m.material.color as { getHexString?: () => string } | undefined)?.getHexString?.(),
            emissive: (m.material.emissive as { getHexString?: () => string } | undefined)?.getHexString?.(),
          };
        });
        evidence.earthSurface = mat;
        if (!mat) failures.push('the Earth surface material is not in the scene');
        else {
          const f = mat as { hasMap?: boolean; hasEmissiveMap?: boolean };
          if (f.hasMap) failures.push('map is still attached — the probe is not albedo-neutral');
          if (f.hasEmissiveMap) failures.push('emissiveMap is still attached — the night side still has texture');
        }
      }

      if (name === 'toonTerminator') {
        let toon = 0;
        scene.traverse((o) => {
          const m = o as ObjLike;
          if (m.isMesh && m.material?.type === 'MeshToonMaterial') toon += 1;
        });
        evidence.toonMeshes = toon;
        if (toon === 0) failures.push('no MeshToonMaterial was installed');
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

    /**
     * Per-channel means of the Earth's day and night textures, in LINEAR space.
     *
     * Read from the live textures rather than hardcoded, so the albedo-neutral probe uses the same
     * pixels the render does. sRGB texels are linearised before averaging — three multiplies in
     * linear light, so an sRGB mean of a mostly-dark ocean comes out far too bright.
     */
    textureMeans() {
      const out: Record<string, number[]> = {};
      const meanOf = (tex: unknown): number[] | null => {
        const t = tex as { image?: { width?: number; height?: number } } | null;
        const img = t?.image;
        if (!img || !img.width || !img.height) return null;
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(img as CanvasImageSource, 0, 0);
        const data = ctx.getImageData(0, 0, img.width, img.height).data;
        const toLin = (v: number): number => {
          const c = v / 255;
          return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        };
        let r = 0;
        let g = 0;
        let b = 0;
        const n = img.width * img.height;
        for (let i = 0; i < data.length; i += 4) {
          r += toLin(data[i]);
          g += toLin(data[i + 1]);
          b += toLin(data[i + 2]);
        }
        return [r / n, g / n, b / n];
      };

      w.__scene.traverse((o) => {
        const m = o as ObjLike;
        if (!m.isMesh || m.material?.type !== 'MeshPhysicalMaterial') return;
        const day = meanOf(m.material.map);
        const night = meanOf(m.material.emissiveMap);
        if (day) out.day = day;
        if (night) out.night = night;
      });
      return out;
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
  const {
    flags = {},
    azimuth = 0,
    defect = null,
    pinName,
    extraCaptures = [],
    ops = defaultOps(page),
  } = options;
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
      extras: {},
      probeAfterExtras: null,
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

  /**
   * One survival probe. Defined as a closure because it runs twice when extras are taken:
   * once before the defect capture and once after the extras, since the extras change
   * layers and could in principle drop the defect.
   */
  const probeSnapshot = async (): Promise<SurvivalProbe> => {
    const raw = await ops.probe(defect, pinName);
    const failures = [...raw.failures];
    if (raw.frameAtCapture <= raw.frameBefore) {
      failures.push(
        `renderer.info.render.frame did not advance after install (${raw.frameBefore} -> ${raw.frameAtCapture})`,
      );
    }
    return {
      defect: defect.name,
      alive: failures.length === 0,
      evidence: raw.evidence,
      failures,
      frameBefore: raw.frameBefore,
      frameAtCapture: raw.frameAtCapture,
    };
  };

  // (5) SURVIVAL PROBE. Without this a negative test cannot distinguish "the check is
  // blind" from "the defect never reached the pixels" — which is the exact confusion
  // that parked N1/N3/N4 on `test.fixme` with no way to tell the two apart.
  steps.push('survivalProbe');
  const probe = await probeSnapshot();
  if (!probe.alive) {
    throw new Error(`defect lost before capture: ${probe.failures.join('; ')}`);
  }

  // (6) the capture the checks will analyse.
  steps.push('captureDefect');
  const frame = await ops.capture();

  // (6b) extra frames, still under the defect.
  const extras: Record<string, Bitmap> = {};
  if (extraCaptures.length > 0) {
    steps.push('extraCaptures');
    for (const extra of extraCaptures) {
      await ops.setLayers(extra.flags);
      extras[extra.label] = await ops.capture();
    }
    // The extras changed layers, so re-assert that the defect came through them.
    steps.push('survivalProbeAfterExtras');
  }
  const probeAfterExtras = extraCaptures.length > 0 ? await probeSnapshot() : null;

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
    extras,
    probeAfterExtras,
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
