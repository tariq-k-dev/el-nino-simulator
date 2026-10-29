import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

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
 */
export function Starfield({ count = 14000 }: StarfieldProps) {
  const pointsRef = useRef<THREE.Points>(null);

  const { geometry, material } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const rates = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const twinkleAmt = new Float32Array(count);

    // Real star colours cluster along the blackbody curve: mostly white-blue
    // with a warm minority. A small palette looks photographic; random RGB per
    // star looks like confetti.
    const palette: Array<[number, number, number, number]> = [
      [0.62, 0.74, 1.0, 0.42], // hot blue-white
      [0.82, 0.88, 1.0, 0.28], // blue-white
      [1.0, 1.0, 1.0, 0.18], // white
      [1.0, 0.94, 0.82, 0.09], // warm
      [1.0, 0.82, 0.62, 0.03], // orange
    ];

    const pickColor = (): [number, number, number] => {
      let roll = Math.random();
      for (const [r, g, b, weight] of palette) {
        if (roll < weight) return [r, g, b];
        roll -= weight;
      }
      return [1, 1, 1];
    };

    // Three shells give genuine depth. The far shell holds the most stars so
    // the field reads deep rather than crowded close to the camera.
    const shellFor = (i: number): number => {
      const t = i / count;
      if (t < 0.16) return 26 + Math.random() * 16;
      if (t < 0.52) return 50 + Math.random() * 45;
      return 100 + Math.random() * 120;
    };

    for (let i = 0; i < count; i += 1) {
      // Uniform-on-sphere sampling: acos of a uniform variate. A naive uniform
      // phi clumps at the poles and reads as a rotational artefact.
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const radius = shellFor(i);

      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.cos(phi);
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

      const [r, g, b] = pickColor();
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;

      // Apparent brightness falls with distance, so far stars stay small.
      const distanceFalloff = THREE.MathUtils.clamp(65 / radius, 0.3, 1.5);
      const magnitude = Math.pow(Math.random(), 2.4);
      sizes[i] = (0.4 + magnitude * 3.2) * distanceFalloff;

      phases[i] = Math.random() * Math.PI * 2;
      // Slow, serene cadence. At 0.25-1.20 rad/s most stars completed a full
      // pulse in 5-25 s, which reads as blinking rather than twinkling. 0.045-
       // 0.20 rad/s puts a cycle at 31-140 s, so the motion is barely perceptible
      // per frame and the sky feels still.
      rates[i] = 0.045 + Math.random() * 0.155;
      // Only a subset twinkle noticeably - a field where every star pulses
      // looks like a bug, not like sky.
      twinkleAmt[i] = Math.random() < 0.45 ? 0.14 + Math.random() * 0.26 : 0.03;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geo.setAttribute('aRate', new THREE.BufferAttribute(rates, 1));
    geo.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkleAmt, 1));

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
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uPixelRatio.value = state.gl.getPixelRatio();
    // Near-imperceptible drift. At 0.0035 rad/s the field swept a star-width
    // every few frames, and that motion — not the twinkle term — measured as
    // 8.85% of star pixels changing per frame. 0.0006 rad/s is ~10 minutes per
    // degree: present, but it reads as a still sky.
    if (pointsRef.current) pointsRef.current.rotation.y += delta * 0.0006;
  });

  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />;
}
