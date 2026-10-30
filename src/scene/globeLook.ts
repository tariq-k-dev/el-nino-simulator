/**
 * GLOBE_LOOK — every constant that decides how the Earth *looks*.
 *
 * Why one object: the look is the product of six independent contributions
 * (pin emissive, atmosphere shell, sun glint, cloud shell, bloom, tone mapping).
 * Tuning any of them from a literal buried in a component makes "which one
 * changed?" unanswerable, and the 3B-1 glare diagnosis had to toggle **one
 * contributor at a time** to find the culprit. Values that live here are
 * greppable, diffable, and testable from a spec through `__globe.lookFlags()`.
 *
 * Exported as a plain frozen object rather than individual consts so a spec can
 * print the whole tuning set in a failure message.
 *
 * NOT here: geometry segment counts, texture paths, shell *ordering*, the sun
 * direction. Those are scene structure (see `constants.ts`), not look tuning.
 */
export const GLOBE_LOOK = {
  /**
   * Pin cores. `emissive` is ignored by MeshBasicMaterial, so the core is a
   * MeshStandardMaterial and its brightness is emissive-only — that is what
   * keeps a pin equally readable on the day side and the night side without a
   * light of its own.
   */
  pins: {
    /** Core self-illumination. Range 1.5–2.0; below ~1.4 the night side loses it. */
    emissiveIntensity: 1.75,
    /** The selected pin is allowed to read brighter than its neighbours. */
    activeEmissiveIntensity: 1.95,
    /**
     * Radial lift applied to the pin group, in Earth radii on top of the 1.012 R
     * anchor. The selected/hovered pin lifts further so it visually detaches.
     */
    idleLift: 1.035,
    activeLift: 1.06,
    /**
     * Distance from the pin group's origin out to the CORE centre, along the
     * surface normal. The stem is 0.05 long and the core sits just past its tip.
     */
    coreOffset: 0.055,
    /** Anchor radius on the surface — shared by Hotspot and the __globe probe. */
    anchorRadius: 1.012,
    /**
     * Dark housing drawn just behind the core. The core alone measured ~227
     * luminance against a ~230 cloud deck — the same 1.2:1 problem the DOM pill
     * had before it got a solid dark fill. The housing buys a guaranteed dark
     * ring so the core separates from cloud and from sun glint.
     */
    housingColor: '#080c14',
    housingScale: 1.45,
  },

  /**
   * Atmosphere shell.
   *
   * The shell is drawn BackSide, so only the annulus between the planet's limb
   * and the shell's silhouette is visible (the rest is depth-rejected by the
   * planet). A fresnel term `1 - |dot(n, v)|` on that annulus RISES outward and
   * is maximal exactly at the geometry silhouette — that is the hard ring. The
   * profile is therefore driven by the ray's impact parameter instead; see
   * `atmosphereFragment` in shaders.ts.
   */
  atmosphere: {
    /** Shell radius in Earth radii. Annulus width = (shellScale - 1) * limb px. */
    shellScale: 1.1,
    /** Falloff exponent for the broad body. Lower = wider, softer glow. */
    rayleighPower: 1.6,
    /** Falloff exponent for the tight band hugging the limb. */
    horizonPower: 3.8,
    /** Optical thickness, animated by the SST anomaly in Globe.tsx. */
    intensity: 0.62,
    breatheAmplitude: 0.015,
    /** Hard ceiling on the shell's alpha: an opaque shell reads as plastic. */
    alphaCap: 0.55,
    /** Weights of the two terms at the limb, before uIntensity. */
    bodyWeight: 0.1,
    horizonWeight: 0.45,
  },

  /**
   * The opaque surface — `meshPhysicalMaterial`, i.e. three's own lighting model.
   *
   * This material, not the glint overlay, is where the residual clipped pixels
   * came from. Measured with every optional layer switched OFF (surface only):
   * 0.037% of the disc still clipped at the initial settings, as one blown disc
   * on the ocean. Two independent causes, both fixed here:
   *
   *  1. earth_specular.jpg is white on water and `roughness` MULTIPLIES the map,
   *     so inverting the mask to "water = smooth" and multiplying by 0.72 gave
   *     water roughness **0** — a perfect mirror. `roughnessFloor` compresses the
   *     inverted mask into [floor, 1] so water is glossy, not mirrored.
   *  2. Even at a sane roughness the GGX sun highlight under a 3.6-intensity key
   *     is over 1.0 pre-tonemap, so it clips. `specularIntensity` scales the
   *     dielectric specular down without touching diffuse albedo, the terminator
   *     or the texture colours.
   */
  surface: {
    /**
     * Roughness floor for the inverted gloss mask. Water in the mask is pure
     * white, so the naive inversion gave water roughness 0 — a perfect mirror,
     * and `roughness` MULTIPLIES the map, so no material-level value could
     * rescue it (0.72 x 0 is still 0).
     */
    roughnessFloor: 0.55,
    roughness: 0.9,
    metalness: 0,
    /**
     * The lever that actually removes the blowout.
     *
     * Roughness alone could only choose between two bad extremes, measured at a
     * fixed camera: a floor of 0 gave one ~14 px blown disc (0.037% clipped) and
     * a floor of 0.34 spread the lobe into a ~165 px patch (0.062% clipped).
     * Neither is a look, because the material's GGX sun highlight under a 3.6
     * intensity key light is simply over 1.0 before tone mapping. Scaling the
     * dielectric specular down is what a specular *intensity* is for, and it
     * leaves diffuse albedo, the terminator and the texture colours untouched —
     * the surface stays matte with only the overlay's glint on top.
     */
    specularIntensity: 0.18,
    /** Clearcoat on top of an already-mirror-ish lobe is a second blowout path. */
    clearcoat: 0,
    clearcoatRoughness: 0.5,
    normalScale: 0.35,
  },

  /**
   * Ocean glint overlay (additive shell one pixel above the surface).
   *
   * `power` is a much tighter lobe than the brief's suggested `shininess ~48` and
   * `strength` is above its suggested 0.12 — deliberately, and both were measured.
   * Ablating this layer moved the clipped share by 0.0006% (0.1008 -> 0.1002),
   * i.e. it contributes ~2 pixels and is not a glare source; raising its strength
   * back up would risk the "matte surface with a subtle glint" look the brief
   * asks for. `emitCap` holds the layer's own contribution below 0.92.
   */
  specular: {
    strength: 0.5,
    power: 160,
    /** Broad low-order sheen so seas read as wet rather than glowing. */
    sheen: 0.045,
    alphaCap: 0.72,
    emitCap: 0.92,
  },

  /**
   * Bloom is the DOMINANT contributor to the clipped share and the reason the
   * surface read as a floodlight rather than a highlight. Measured by ablation
   * at a fixed camera: 0.1008% with bloom on, 0.0372% with it off — a 63%
   * reduction from one toggle, versus ~0.001% from every other layer combined.
   *
   * At `luminanceThreshold` 0.62 a sunlit cloud top and the ocean glint both
   * passed the threshold, and a mipmap-blurred bloom then smeared them into a
   * patch far larger than the highlight itself. The brief's floor is 0.95; that
   * is what is used, so only genuinely near-white pixels bloom.
   */
  bloom: {
    intensity: 0.42,
    luminanceThreshold: 0.95,
    luminanceSmoothing: 0.22,
    radius: 0.55,
  },
} as const;

/**
 * Per-layer switches used by the acceptance specs (and by nothing else).
 *
 * Every one of these defaults to `true`, so a production visitor sees the scene
 * exactly as built. They exist because several 3B-1 requirements are *relative*
 * — "the haze guard compares the disc interior against the atmosphere disabled",
 * "the pin must not brighten the surface, measured against the pin hidden" —
 * and a relative measurement needs a way to hold one layer still.
 *
 * `stars` is a flag rather than a toggle in the UI: the atmosphere profile test
 * walks 16 rays outward through the sky beyond the limb, and a star crossing a
 * ray is a luminance spike that no atmosphere rule can satisfy.
 */
export interface GlobeLookFlags {
  atmosphere: boolean;
  specular: boolean;
  clouds: boolean;
  bloom: boolean;
  /** Pin cores, stems and housings — the markers themselves. */
  pins: boolean;
  /**
   * The pulsing shader ring under each pin. Separate from `pins` because the
   * cast-light rule compares surface luminance around a pin against the same ring
   * with the pin hidden, and this ring is an additive quad 0.22 world units wide
   * (~36 px at the default camera) that covers that whole comparison area. Left
   * in, the measurement reports the ring's own animation as "light cast on the
   * surface" — 99-144% deltas that no light source is producing.
   */
  hotspotRings: boolean;
  stars: boolean;
}

export const DEFAULT_LOOK_FLAGS: GlobeLookFlags = {
  atmosphere: true,
  specular: true,
  clouds: true,
  bloom: true,
  pins: true,
  hotspotRings: true,
  stars: true,
};

let current: GlobeLookFlags = DEFAULT_LOOK_FLAGS;
const listeners = new Set<() => void>();

/** Stable reference between changes, which `useSyncExternalStore` requires. */
export function getLookFlags(): GlobeLookFlags {
  return current;
}

export function subscribeLookFlags(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Patch one or more layers. Returns the resulting flags. */
export function setLookFlags(patch: Partial<GlobeLookFlags>): GlobeLookFlags {
  const next = { ...current, ...patch };
  // Compare by key rather than by an enumerated list: adding a flag and
  // forgetting to extend the comparison silently made that flag a no-op, which
  // is a bug that looks like "the toggle does nothing".
  const changed = (Object.keys(next) as Array<keyof GlobeLookFlags>).some(
    (key) => next[key] !== current[key],
  );
  if (!changed) return current;
  current = next;
  for (const listener of listeners) listener();
  return current;
}

export function __resetLookFlags(): GlobeLookFlags {
  current = DEFAULT_LOOK_FLAGS;
  for (const listener of listeners) listener();
  return current;
}
