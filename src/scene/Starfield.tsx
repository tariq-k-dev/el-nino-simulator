import { useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { buildStarfieldData } from '@/scene/starfieldData';
import { getLookFlags, subscribeLookFlags } from '@/scene/globeLook';

interface StarfieldProps {
  count?: number;
}

/**
 * Deep-space star field.
 *
 * One BufferGeometry, one draw call, three depth shells (near / mid / far) so
 * the field has parallax instead of sitting on a single shell that reads as a
 * flat backdrop. Per-star attributes carry size, colour temperature, twinkle
 * phase and rate, so the variation is real rather than a repeated sprite.
 *
 * Twinkle is driven entirely on the GPU from a time uniform - no per-frame
 * attribute uploads.
 *
 * Every attribute comes from `buildStarfieldData(count)` in starfieldData.ts,
 * which is seeded. It used to call Math.random() per star, so the sky differed on
 * every load - harmless for a backdrop, fatal for the pixel specs, because a star
 * landing on one of the atmosphere profile's 16 rays is a luminance spike that no
 * atmosphere rule can satisfy. See that module for the determinism contract.
 */
export function Starfield({ count = 14000 }: StarfieldProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const look = useSyncExternalStore(subscribeLookFlags, getLookFlags, getLookFlags);

  const { geometry, material } = useMemo(() => {
    const data = buildStarfieldData(count);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(data.sizes, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(data.colors, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(data.phases, 1));
    geo.setAttribute('aRate', new THREE.BufferAttribute(data.rates, 1));
    geo.setAttribute('aTwinkle', new THREE.BufferAttribute(data.twinkle, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute vec3 aColor;
        attribute float aPhase;
        attribute float aRate;
        attribute float aTwinkle;

        uniform float uTime;
        uniform float uPixelRatio;

        varying vec3 vColor;
        varying float vBrightness;

        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);

          vColor = aColor;
          vBrightness = 1.0 - aTwinkle + aTwinkle * (0.5 + 0.5 * sin(uTime * aRate + aPhase));

          // Size in pixels, scaled by perspective and by device pixel ratio so
          // stars stay crisp on retina without turning into blocks.
          gl_PointSize = aSize * uPixelRatio * (90.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vBrightness;

        void main() {
          // Radial falloff with a tight core and a soft halo. The pow() profile
          // is what separates a star from a square sprite.
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv) * 2.0;
          if (d > 1.0) discard;

          float core = smoothstep(0.32, 0.0, d);
          float halo = pow(max(1.0 - d, 0.0), 2.6) * 0.42;
          float alpha = clamp(core + halo, 0.0, 1.0) * vBrightness;

          if (alpha < 0.008) discard;
          gl_FragColor = vec4(vColor * (0.85 + core * 0.5), alpha);
        }
      `,
    });

    return { geometry: geo, material: mat };
  }, [count]);

  useFrame((state, delta) => {
    /*
     * Twinkle is a function of elapsed time, so with the scene clock frozen it
     * must be pinned too - otherwise the same seed still renders a different sky
     * per load (measured: the star-field comparison failed at 0.05 meanAbsDiff
     * with only `animate:false` applied to the planet, because each load reached
     * its first screenshot at a different `elapsedTime`). t = 0 puts every star at
     * its phase offset, which is deterministic.
     */
    material.uniforms.uTime.value = look.animate ? state.clock.elapsedTime : 0;
    material.uniforms.uPixelRatio.value = state.gl.getPixelRatio();
    // Near-imperceptible drift. At 0.0035 rad/s the field swept a star-width
    // every few frames, and that motion — not the twinkle term — measured as
    // 8.85% of star pixels changing per frame. 0.0006 rad/s is ~10 minutes per
    // degree: present, but it reads as a still sky.
    if (pointsRef.current) {
      if (look.animate) pointsRef.current.rotation.y += delta * 0.0006;
      else pointsRef.current.rotation.y = 0;
    }
  });

  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />;
}
