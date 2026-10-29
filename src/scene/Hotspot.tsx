import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { RegionDefinition } from '@/types/enso';
import { thermalColor, thermalVector } from '@/lib/model';
import { latLonToVector3 } from '@/lib/regions';
import { hotspotFragment, hotspotVertex } from '@/scene/shaders';

interface HotspotProps {
  region: RegionDefinition;
  sst: number;
  active: boolean;
  headline: string;
  onSelect: (id: RegionDefinition['id']) => void;
}

/**
 * A hotspot = pulsing shader ring lying tangent to the surface + a pin stem +
 * a clickable label. Colour is driven by the global SST anomaly so the whole
 * constellation shifts from cyan to red as the slider moves.
 */
export function Hotspot({ region, sst, active, headline, onSelect }: HotspotProps) {
  const [hovered, setHovered] = useState(false);
  const ringRef = useRef<THREE.Mesh>(null);
  const pinRef = useRef<THREE.Group>(null);
  const labelWrapRef = useRef<HTMLDivElement>(null);
  const facingRef = useRef(1);

  const position = useMemo(() => latLonToVector3(region.lat, region.lon, 1.012), [region]);
  const quaternion = useMemo(() => {
    // Orient the ring's +Z along the surface normal at this lat/lon.
    const normal = new THREE.Vector3(...position).normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  }, [position]);

  const uniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(region.accent) },
      uTime: { value: 0 },
      uPhase: { value: Math.random() },
    }),
    [region.accent],
  );

  useFrame((state, delta) => {
    uniforms.uTime.value = state.clock.elapsedTime;
    const [r, g, b] = thermalVector(sst);
    (uniforms.uColor.value as THREE.Color).setRGB(r, g, b);

    if (ringRef.current) {
      const targetScale = active ? 1.55 : hovered ? 1.25 : 1;
      ringRef.current.scale.lerp(
        new THREE.Vector3(targetScale, targetScale, targetScale),
        Math.min(1, delta * 6),
      );
    }
    if (pinRef.current) {
      const lift = active || hovered ? 1.06 : 1.035;
      pinRef.current.position.set(position[0] * lift, position[1] * lift, position[2] * lift);
    }

    // Fade labels that face away from the camera.
    //
    // drei <Html> draws in screen space with no depth test against the globe, so
    // a marker on the far side rendered its label on top of the near side — the
    // visible result was two labels colliding over the same patch of ocean.
    // Test the marker's world normal against the camera direction and hide the
    // back hemisphere; the active region is always kept visible so the thing the
    // user just clicked never disappears.
    if (labelWrapRef.current) {
      // Marker normal in world space — the parent group carries the planet's spin.
      const normal = new THREE.Vector3(position[0], position[1], position[2]).normalize();
      const parent = pinRef.current?.parent;
      if (parent) {
        parent.updateWorldMatrix(true, false);
        normal.transformDirection(parent.matrixWorld);
      }
      const facing = normal.dot(state.camera.position.clone().normalize());
      // Smooth 0..1 across the limb rather than a hard pop. The active region is
      // always 1 so the label you just clicked never fades out.
      const target = active ? 1 : THREE.MathUtils.smoothstep(facing, 0.02, 0.22);
      facingRef.current += (target - facingRef.current) * Math.min(1, delta * 8);

      const el = labelWrapRef.current;
      el.style.opacity = facingRef.current.toFixed(3);
      el.style.pointerEvents = facingRef.current > 0.35 ? 'auto' : 'none';
      el.style.visibility = facingRef.current < 0.03 ? 'hidden' : 'visible';
    }
  });

  // Two forms of the same ramp: a THREE.Color for materials/lights (three would
  // ignore an rgba alpha and warn), and a CSS rgba for the DOM label.
  const glowColor = useMemo(() => {
    const [r, g, b] = thermalVector(sst);
    return new THREE.Color(r, g, b);
  }, [sst]);
  const glowCss = thermalColor(sst, active ? 0.95 : 0.75);

  return (
    <group>
      {/* Pulsing ring anchored to the surface */}
      <mesh
        ref={ringRef}
        position={position}
        quaternion={quaternion}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(region.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = 'auto';
        }}
      >
        <planeGeometry args={[0.22, 0.22]} />
        <shaderMaterial
          vertexShader={hotspotVertex}
          fragmentShader={hotspotFragment}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* Pin stem + head */}
      <group ref={pinRef} position={position}>
        <mesh>
          <sphereGeometry args={[active ? 0.016 : 0.011, 16, 16]} />
          <meshBasicMaterial color={glowColor} toneMapped={false} />
        </mesh>
        <pointLight color={glowColor} intensity={active ? 0.9 : 0.35} distance={0.5} decay={2} />
      </group>

      {/* Label.
          drei <Html> renders real DOM outside the WebGL canvas, so it inherits
          none of the scene's colour management. Over a bright atmosphere the
          old translucent-white pill (bg-white/15) had roughly 1.2:1 contrast
          and vanished. Solid dark fill + a light border + a real text shadow
          keeps it legible against any backdrop, including the sun glint. */}
      <Html
        position={[position[0] * 1.1, position[1] * 1.1 + 0.045, position[2] * 1.1]}
        center
        distanceFactor={1.55}
        zIndexRange={[40, 30]}
        style={{ pointerEvents: 'auto' }}
      >
        <div ref={labelWrapRef} style={{ transition: 'opacity 120ms linear' }}>
        <button
          type="button"
          onClick={() => onSelect(region.id)}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          className={[
            'group flex -translate-y-1 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-[3px]',
            'font-mono text-[9px] font-medium uppercase tracking-[0.14em] transition-all duration-200',
            active
              ? 'border-[rgba(255,255,255,0.38)] text-white'
              : 'border-[rgba(255,255,255,0.15)] text-[rgba(226,238,255,0.92)] hover:border-[rgba(255,255,255,0.34)] hover:text-white',
          ].join(' ')}
          style={{
            // Solid enough to guarantee contrast over white cloud or sun glint.
            background: 'rgba(10, 15, 25, 0.85)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            // Two-layer shadow: a dark halo for contrast, a warm bloom when active.
            boxShadow: active
              ? `0 1px 2px rgba(0,0,0,0.9), 0 4px 14px rgba(0,0,0,0.55), 0 0 18px -4px ${glowCss}`
              : '0 1px 2px rgba(0,0,0,0.9), 0 4px 12px rgba(0,0,0,0.45)',
            textShadow: '0 1px 2px rgba(0,0,0,0.95)',
          }}
          title={`${region.name} — ${headline}`}
        >
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full transition-colors"
            style={{ background: glowCss, boxShadow: `0 0 8px ${glowCss}` }}
          />
          {region.shortName}
        </button>
        </div>
      </Html>
    </group>
  );
}
