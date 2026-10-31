import { useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { thermalVector } from '@/lib/model';
import {
  atmosphereFragment,
  atmosphereVertex,
  surfaceOverlayFragment,
  surfaceOverlayVertex,
} from '@/scene/shaders';
import { SHELLS } from '@/scene/constants';
import { GLOBE_LOOK, getLookFlags, subscribeLookFlags } from '@/scene/globeLook';
import { lookTime } from '@/scene/lookTime';
import { installTextureTracking } from '@/lib/engine/textureTimeline';

// Instrument three's DefaultLoadingManager BEFORE any texture is requested.
//
// Module scope, not an effect: `useTexture` suspends on its first render, and the
// loader calls `itemStart` inside that render — an effect would run after the
// first item had already been registered and it would never be tracked.
//
// This is what the scene gate's texture condition reads (see
// lib/engine/textureTimeline.ts). It also gives the E2E trace a per-texture
// {requestStart, responseEnd, onLoad} record on the page's performance.now()
// clock, so the gate's open time can be reconciled against it by subtraction
// rather than by comparing two different time origins.
installTextureTracking();

interface GlobeProps {
  /** 0..3 degC - drives the emissive heat and the atmosphere colour. */
  sst: number;
  /** World-space direction the key light comes from. Shared by every layer. */
  sunDirection: [number, number, number];
}

/**
 * The Earth.
 *
 * Layers, outside in:
 *   1. atmosphere shell (1.028R) - single analytic Rayleigh/Mie pass
 *   2. cloud shell (1.004R)      - real alpha, not additive
 *   3. surface (1.000R)          - day map, gloss-masked water
 *   4. overlay shell (1.0012R)   - ocean sun glint + anomaly heat
 *
 * Every per-frame write is a uniform or a material scalar. No geometry rebuilds
 * and no texture uploads, so dragging the anomaly slider never touches the
 * CPU-side scene graph.
 */
export function Globe({ sst, sunDirection }: GlobeProps) {
  const cloudRef = useRef<THREE.Mesh>(null);
  const surfaceMat = useRef<THREE.MeshPhysicalMaterial>(null);
  const cloudMat = useRef<THREE.MeshStandardMaterial>(null);
  const atmosphereMat = useRef<THREE.ShaderMaterial>(null);
  const overlayMat = useRef<THREE.ShaderMaterial>(null);

  const [dayMap, nightMap, glossMap, normalMap, cloudsMap] = useTexture([
    '/textures/earth_day.jpg',
    '/textures/earth_night.jpg',
    '/textures/earth_specular.jpg',
    '/textures/earth_normal.jpg',
    '/textures/earth_clouds.jpg',
  ]);

  // Layer switches, read from the same external store the specs write to. The
  // default is all-true, so a visitor's scene is unchanged; this exists so an
  // acceptance test can hold one contribution still (see scene/globeLook.ts).
  const look = useSyncExternalStore(subscribeLookFlags, getLookFlags, getLookFlags);

  useMemo(() => {
    // Colour *albedo* must be sRGB or everything renders desaturated and dark.
    // The gloss mask and normal map are data, not colour, and must stay linear.
    //
    // cloudsMap is the one that is easy to get wrong: it is grayscale, but it is
    // still diffuse albedo painted through `map`, so it needs sRGB. Treated as
    // linear, a mid-gray of 0.4 decodes to an sRGB value of ~0.66 and the cloud
    // deck becomes a bright gray curtain over the planet — measured as mean
    // saturation collapsing 0.54 -> 0.27 the moment the cloud shell was enabled.
    const dataTextures = new Set([glossMap, normalMap]);
    for (const tex of [dayMap, nightMap, glossMap, normalMap, cloudsMap]) {
      tex.colorSpace = dataTextures.has(tex) ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
    }
  }, [dayMap, nightMap, glossMap, normalMap, cloudsMap]);

  // Roughness map is INVERTED: earth_specular.jpg is white on water (a gloss
  // mask), but three's roughnessMap reads white as rough. Binding it raw made
  // the oceans matte and the continents mirror-like - exactly backwards.
  //
  // Doing the inversion once on a canvas at load time costs ~20 ms; inverting in
  // the fragment shader would put a texture read plus arithmetic on every pixel
  // of the globe for every frame.
  //
  // The inverted value is then COMPRESSED into [floor, 1] rather than used
  // directly. Water in the gloss mask is pure white, so the naive inversion gave
  // water roughness 0.0 — and `roughness` on the material MULTIPLIES this map, so
  // no material-level value could rescue it (0.72 x 0 is still 0). A roughness of
  // exactly 0 is a perfect mirror: the sun's highlight focused into a hard clipped
  // disc roughly 14 px across, which is what survived with every optional layer
  // switched off (measured 0.037% of the disc clipped, surface only). Compressing
  // to the floor keeps water glossy and the highlight a highlight.
  const roughnessMap = useMemo(() => {
    const image = glossMap.image as CanvasImageSource & { width?: number; height?: number };
    if (!image || !image.width || !image.height) return glossMap;

    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) return glossMap;

    const floor = GLOBE_LOOK.surface.roughnessFloor;
    const span = 1 - floor;

    ctx.drawImage(image, 0, 0, image.width, image.height);
    const pixels = ctx.getImageData(0, 0, image.width, image.height);
    const data = pixels.data;
    for (let i = 0; i < data.length; i += 4) {
      // 255 - value inverts the mask, then map 0..255 -> floor..1
      const inverted = (255 - data[i]) * span + floor * 255;
      data[i] = inverted;
      data[i + 1] = inverted;
      data[i + 2] = inverted;
    }
    ctx.putImageData(pixels, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = 8;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }, [glossMap]);

  const sunVector = useMemo(
    () => new THREE.Vector3(...sunDirection).normalize(),
    [sunDirection],
  );

  const atmosphereUniforms = useMemo(
    () => ({
      uSunDirection: { value: sunVector.clone() },
      uRayleighColor: { value: new THREE.Color('#1d63d8') },
      uMieColor: { value: new THREE.Color('#ffd9a3') },
      uHorizonColor: { value: new THREE.Color('#9fe8ff') },
      uIntensity: { value: GLOBE_LOOK.atmosphere.intensity },
      uRayleighPower: { value: GLOBE_LOOK.atmosphere.rayleighPower },
      uHorizonPower: { value: GLOBE_LOOK.atmosphere.horizonPower },
      uSunGlow: { value: 0.85 },
      uTime: { value: 0 },
      // The shader needs its own geometry to place the impact parameter, so the
      // radii are uniforms rather than baked literals: the plan shell scale and
      // the fit-distance maths read the same numbers.
      uShellRadius: { value: SHELLS.atmosphere },
      uPlanetRadius: { value: 1 },
      uBodyWeight: { value: GLOBE_LOOK.atmosphere.bodyWeight },
      uHorizonWeight: { value: GLOBE_LOOK.atmosphere.horizonWeight },
      uAlphaCap: { value: GLOBE_LOOK.atmosphere.alphaCap },
      uBreatheAmp: { value: GLOBE_LOOK.atmosphere.breatheAmplitude },
    }),
    [sunVector],
  );

  const overlayUniforms = useMemo(
    () => ({
      uOceanMask: { value: glossMap },
      uSunDirection: { value: sunVector.clone() },
      uHeatColor: { value: new THREE.Color('#fb923c') },
      uHeat: { value: 0.5 },
      uSpecularPower: { value: GLOBE_LOOK.specular.power },
      uSpecularStrength: { value: GLOBE_LOOK.specular.strength },
      uSheen: { value: GLOBE_LOOK.specular.sheen },
      uAlphaCap: { value: GLOBE_LOOK.specular.alphaCap },
      uEmitCap: { value: GLOBE_LOOK.specular.emitCap },
      uSunGlow: { value: 0.85 },
    }),
    [glossMap, sunVector],
  );

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const step = Math.min(1, delta * 2.5);

    // Planet spin lives on the parent <EarthSystem> group so hotspot markers share
    // the transform. Clouds drift a touch faster - parallax for free. Both stop
    // when `animate` is off, so a spec's baseline is the same scene on every load.
    if (cloudRef.current) {
      // Clouds own their drift so it can be reset independently of the planet: a
      // freeze applied to the parent group alone still leaves this offset wherever
      // the frames before the freeze accumulated to, which measured as 0.1-0.9 mean
      // absolute luma drift inside the disc between loads (versus 0.000 in the sky,
      // which the drift does not touch). Pinning it to 0 makes a baseline the same
      // scene on every load.
      if (look.animate) cloudRef.current.rotation.y += delta * 0.012;
      else cloudRef.current.rotation.y = 0;
    }

    const [r, g, b] = thermalVector(sst);
    const heat = Math.min(1, sst / 3);

    if (atmosphereMat.current) {
      const u = atmosphereMat.current.uniforms;
      // The atmosphere stays blue. Rayleigh scattering is a property of the
      // gas column, not of the ocean temperature — recolouring the whole rim
      // red at high SST read as a lava planet, not as a warm Pacific. The
      // anomaly drives intensity and a faint gold bias on the sun-facing Mie
      // lobe only; the horizon fringe keeps its cyan.
      const atmosphereHeat = heat * 0.18;
      (u.uMieColor.value as THREE.Color).setRGB(
        1.0,
        0.85 - atmosphereHeat * 0.22,
        0.64 - atmosphereHeat * 0.3,
      );
      (u.uHorizonColor.value as THREE.Color).setRGB(
        0.62 - atmosphereHeat * 0.1,
        0.91,
        1.0 - atmosphereHeat * 0.08,
      );
      const targetIntensity = 0.6 + heat * 0.1;
      u.uIntensity.value += (targetIntensity - u.uIntensity.value) * step;
      u.uSunGlow.value += (0.75 + heat * 0.2 - u.uSunGlow.value) * step;
      /*
       * `lookTime`, not `t`.
       *
       * The breathe term (`shaders.ts:114`) is a function of this uniform, so writing the raw
       * clock kept the halo breathing while every other effect was frozen - the reference frame
       * captured two frames of the same pose and found up to 3.0 luma of difference in 13608 px.
       * With `animate:true` (the live product) this is `t` unchanged.
       */
      u.uTime.value = lookTime(look.animate, t);
    }

    if (overlayMat.current) {
      const u = overlayMat.current.uniforms;
      (u.uHeatColor.value as THREE.Color).setRGB(r, g, b);
      u.uHeat.value += (0.35 + heat * 0.65 - u.uHeat.value) * step;
    }

    // City lights bloom a little harder as the ocean warms.
    if (surfaceMat.current) {
      const target = 0.18 + heat * 0.1;
      surfaceMat.current.emissiveIntensity +=
        (target - surfaceMat.current.emissiveIntensity) * Math.min(1, delta * 2);
    }

    // Real clouds brighten slightly with the anomaly instead of fading away,
    // which is the opposite of what the old additive shell did.
    if (cloudMat.current) {
      const target = 0.9 + heat * 0.06;
      cloudMat.current.opacity += (target - cloudMat.current.opacity) * Math.min(1, delta * 2);
    }
  });

  return (
    <group>
      {/* Atmosphere, drawn first in the transparent pass so it never occludes
          the surface or the glint. BackSide: we see the far inner surface, so
          only the annulus outside the planet's limb survives the depth test —
          which is what makes the impact-parameter profile in the fragment
          shader land exactly on zero at the shell's silhouette. */}
      {look.atmosphere && (
        <mesh scale={SHELLS.atmosphere} renderOrder={1}>
          <sphereGeometry args={[1, 96, 96]} />
          <shaderMaterial
            ref={atmosphereMat}
            vertexShader={atmosphereVertex}
            fragmentShader={atmosphereFragment}
            uniforms={atmosphereUniforms}
            transparent
            side={THREE.BackSide}
            blending={THREE.NormalBlending}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* Cloud shell.
          earth_clouds.jpg is a single-channel coverage map with NO alpha: dark
          means clear sky, bright means dense cloud. Binding it as `map` with a
          uniform opacity paints 40% gray over *every* pixel — including the clear
          ones — which measured as mean saturation dropping 0.65 -> 0.39 and was
          the main source of the "muddy wash". The luminance belongs in `alphaMap`,
          with flat white as the cloud colour, so clear sky is genuinely transparent. */}
      {look.clouds && (
        <mesh ref={cloudRef} scale={SHELLS.clouds} renderOrder={2}>
          <sphereGeometry args={[1, 96, 96]} />
          <meshStandardMaterial
            ref={cloudMat}
            color="#ffffff"
            alphaMap={cloudsMap}
            transparent
            opacity={0.92}
            depthWrite={false}
            roughness={1}
            metalness={0}
            emissive="#ffffff"
            emissiveIntensity={0.04}
          />
        </mesh>
      )}

      <mesh renderOrder={0}>
        <sphereGeometry args={[1, 128, 128]} />
        <meshPhysicalMaterial
          ref={surfaceMat}
          map={dayMap}
          // The supplied normal map is flat (R/G std ~1.4 on a 0-255 scale) so
          // it carries almost no relief; the scale is dialled back rather than
          // pretending it encodes mountain ranges that are not there.
          normalMap={normalMap}
          normalScale={
            new THREE.Vector2(GLOBE_LOOK.surface.normalScale, GLOBE_LOOK.surface.normalScale)
          }
          roughnessMap={roughnessMap}
          roughness={GLOBE_LOOK.surface.roughness}
          metalness={GLOBE_LOOK.surface.metalness}
          specularIntensity={GLOBE_LOOK.surface.specularIntensity}
          clearcoat={GLOBE_LOOK.surface.clearcoat}
          clearcoatRoughness={GLOBE_LOOK.surface.clearcoatRoughness}
          emissiveMap={nightMap}
          emissive={new THREE.Color('#6fb8ff')}
          emissiveIntensity={0.18}
        />
      </mesh>

      {/* Ocean glint + anomaly heat, one pixel above the surface. */}
      {look.specular && (
        <mesh scale={SHELLS.overlay} renderOrder={3}>
          <sphereGeometry args={[1, 128, 128]} />
          <shaderMaterial
            ref={overlayMat}
            vertexShader={surfaceOverlayVertex}
            fragmentShader={surfaceOverlayFragment}
            uniforms={overlayUniforms}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      )}
    </group>
  );
}
