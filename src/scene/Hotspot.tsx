import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { RegionDefinition } from '@/types/enso';
import { thermalColor, thermalVector } from '@/lib/model';
import { latLonToVector3 } from '@/lib/regions';
import { hotspotFragment, hotspotVertex } from '@/scene/shaders';
import { GLOBE_LOOK, getLookFlags, subscribeLookFlags } from '@/scene/globeLook';
import { lookTime } from '@/scene/lookTime';

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

  const position = useMemo(
    () => latLonToVector3(region.lat, region.lon, GLOBE_LOOK.pins.anchorRadius),
    [region],
  );
  const quaternion = useMemo(() => {
    // Orient the ring's +Z along the surface normal at this lat/lon.
    const normal = new THREE.Vector3(...position).normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  }, [position]);

  // Stem geometry: a short dark collar from the surface up to the core, oriented
  // along the surface normal. It exists for CONTRAST, not decoration — an amber
  // core measured only ~1.2:1 luminance against a sunlit cloud deck, so the pin
  // needs something dark to sit on. A dark stem gets that without emitting light
  // onto the surface, which is exactly what the old <pointLight> got wrong.
  const look = useSyncExternalStore(subscribeLookFlags, getLookFlags, getLookFlags);

  const uniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(region.accent) },
      uTime: { value: 0 },
      uPhase: { value: Math.random() },
    }),
    [region.accent],
  );

  useFrame((state, delta) => {
    /*
     * Same rule as the atmosphere: a pulsing shader ring is a function of this uniform, and a
     * frozen scene is only frozen if every time-driven term stops. `animate:true` (the live
     * product) leaves the value identical to the raw clock.
     */
    uniforms.uTime.value = lookTime(look.animate, state.clock.elapsedTime);
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
      const lift =
        active || hovered ? GLOBE_LOOK.pins.activeLift : GLOBE_LOOK.pins.idleLift;
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

  /**
   * Forward wheel over the label to the canvas.
   *
   * OrbitControls attaches its `wheel` listener to the renderer's `domElement`.
   * The drei `<Html>` label is a SIBLING of the canvas, not a descendant, and it
   * is `pointer-events: auto`, so a wheel aimed at a pin reaches neither the
   * canvas listener nor open space. Pointing straight at a hotspot and scrolling
   * therefore did nothing — the most likely place a user tries to zoom.
   *
   * A NATIVE listener, not React's `onWheel`: drei renders `<Html>` into a DOM
   * portal outside the React root that owns this component, so React's synthetic
   * delegation never sees the event and an `onWheel` prop here is silently dead.
   * Verified — the canvas received no re-dispatched event.
   *
   * Re-dispatching carries the real `deltaY`, so OrbitControls' zoomSpeed and
   * damping apply exactly as over open space. `bubbles: false` keeps the
   * re-dispatched event from looping back into this handler.
   */
  useEffect(() => {
    const el = labelWrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const canvas = document.querySelector('#globe-canvas canvas');
      if (!canvas) return;
      canvas.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: e.deltaY,
          deltaMode: e.deltaMode,
          clientX: e.clientX,
          clientY: e.clientY,
          bubbles: false,
          cancelable: true,
        }),
      );
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Two forms of the same ramp: a THREE.Color for materials/lights (three would
  // ignore an rgba alpha and warn), and a CSS rgba for the DOM label.
  const glowColor = useMemo(() => {
    const [r, g, b] = thermalVector(sst);
    return new THREE.Color(r, g, b);
  }, [sst]);
  const glowCss = thermalColor(sst, active ? 0.95 : 0.75);

  return (
    <group>
      {/* Pulsing ring anchored to the surface. Also the click target — an
          additive quad 0.22 world units across, so it is a far bigger tap area
          than the 0.011-radius core (MOBILE_AUDIT #2 measured the core at 6-12
          CSS px). */}
      {look.hotspotRings && (
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
      )}

      {/* Pin stem + head.
          There is deliberately NO light in here. The old <pointLight>
          (intensity 0.9 active / 0.35 idle, distance 0.5) sat on the surface at
          1.012 R and lit the cloud and surface shells from ~0.1 unit away, which
          is the broad amber flood over the western US in
          docs/globe-look/shot-b-upperleft.png — not the specular term. A light of
          its own also made the pin's brightness depend on what it happened to be
          standing on, so the same pin was invisible over the night side and blew
          out over the day side. Emissive geometry fixes both: it is a fixed
          brightness regardless of the surface, and it lights nothing.

          The core is MeshStandardMaterial, not MeshBasicMaterial, because
          `emissive` is ignored by MeshBasicMaterial — the material used here
          before this change, which is why the pin had no self-illumination at
          all and relied on the light. `toneMapped={false}` keeps the amber from
          being dimmed by ACES so the intended colour reaches the screen. */}
      {look.pins && (
        <group ref={pinRef} position={position} quaternion={quaternion}>
          {/* Dark collar: gives the core something to contrast against.
              The cylinder is Y-up by default; rotate it so its axis is the
              group's +Z (the surface normal) and push it out by half its height
              so it stands on the surface. */}
          <mesh position={[0, 0, 0.025]} rotation={[Math.PI / 2, 0, 0]} renderOrder={6}>
            <cylinderGeometry args={[0.0055, 0.0075, 0.05, 10, 1, true]} />
            <meshBasicMaterial
              color={GLOBE_LOOK.pins.housingColor}
              toneMapped={false}
              transparent
              opacity={0.92}
            />
          </mesh>
          {/* Housing: a flat dark DISC behind the core, so the core never sits on
              a bright surface without a dark boundary around it.
              
              It has to be a disc at a smaller radius-in-z, not a concentric
              sphere: at `housingScale` 1.45 a sphere of radius 0.016 around the
              same centre completely ENCLOSES the 0.011 core, so the pin rendered
              as a black blob and every pixel measurement read ~10/255 where the
              amber should be. A circle facing outward, pushed back along the
              normal, leaves the core showing through the middle with a dark ring
              around it — which is the contrast this exists for. */}
          <mesh position={[0, 0, GLOBE_LOOK.pins.coreOffset - 0.006]} renderOrder={7}>
            <circleGeometry
              args={[(active ? 0.016 : 0.011) * GLOBE_LOOK.pins.housingScale, 24]}
            />
            <meshBasicMaterial
              color={GLOBE_LOOK.pins.housingColor}
              toneMapped={false}
              side={THREE.DoubleSide}
            />
          </mesh>
          {/* The core itself. Colour comes from the SST ramp so the whole
              constellation shifts cyan -> amber -> red with the slider; the
              emissive intensity is what makes it readable on both limbs. */}
          <mesh position={[0, 0, GLOBE_LOOK.pins.coreOffset]} renderOrder={8}>
            <sphereGeometry args={[active ? 0.016 : 0.011, 16, 16]} />
            <meshStandardMaterial
              color={glowColor}
              emissive={glowColor}
              emissiveIntensity={
                active
                  ? GLOBE_LOOK.pins.activeEmissiveIntensity
                  : GLOBE_LOOK.pins.emissiveIntensity
              }
              roughness={0.45}
              metalness={0}
              toneMapped={false}
            />
          </mesh>
        </group>
      )}

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
