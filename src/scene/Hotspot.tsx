import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MutableRefObject,
} from "react"
import { useFrame } from "@react-three/fiber"
import { Html } from "@react-three/drei"
import * as THREE from "three"
import type { RegionDefinition } from "@/types/enso"
import { thermalColor, thermalVector } from "@/lib/model"
import { latLonToVector3 } from "@/lib/regions"
import { hotspotFragment, hotspotVertex } from "@/scene/shaders"
import {
  GLOBE_LOOK,
  getLookFlags,
  subscribeLookFlags,
} from "@/scene/globeLook"
import { lookTime } from "@/scene/lookTime"
import {
  HIT_PX,
  HIT_PX_COARSE,
  PIN_HIT_CLAMP_R,
  PIN_HIT_GATE,
  pinFacesCamera,
} from "@/scene/pinVisibilityBands"

interface HotspotProps {
  region: RegionDefinition
  sst: number
  active: boolean
  headline: string
  onSelect: (id: RegionDefinition["id"]) => void
  /**
   * The group that carries the planet's spin — i.e. the globe's WORLD centre holder.
   *
   * The hit proxy's gate is `dot(nWorld, normalize(cameraWorld - globeCenterWorld))`, and
   * `globeCenterWorld` must be this group's world position rather than the world origin. In this scene
   * the group sits at the origin so the two agree today, but writing the origin in would make the gate
   * silently wrong the moment anything translates the earth, and the unit tests cover that case
   * explicitly. `matrixWorld` is read at raycast time, so a spin (or a future offset) is honoured.
   */
  earthRef: MutableRefObject<THREE.Group | null>
}

/*
 * Scratch vectors for the raycast override.
 *
 * A pointer move raycasts every interaction object on every move event, so allocating two `Vector3`s per
 * call would churn the heap for the whole life of the page. Hoisted to module scope: the override is
 * synchronous and never re-entrant, so one pair is enough.
 */
const SCRATCH_NORMAL = new THREE.Vector3()
const SCRATCH_CENTRE = new THREE.Vector3()
const SCRATCH_PROXY = new THREE.Vector3()

/**
 * Does this browser report a coarse primary pointer (a thumb rather than a cursor tip)?
 *
 * Read once per component mount rather than per frame: the media query cannot change mid-session in a
 * way this product supports, and a per-frame `matchMedia` call is a layout-dirty read in the middle of
 * the render loop. `22 px` vs `14 px` is the whole difference.
 */
function coarsePointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return false
  return window.matchMedia("(pointer: coarse)").matches
}

/**
 * A hotspot = pulsing shader ring lying tangent to the surface + a pin stem +
 * a clickable label. Colour is driven by the global SST anomaly so the whole
 * constellation shifts from cyan to red as the slider moves.
 */
export function Hotspot({
  region,
  sst,
  active,
  headline,
  onSelect,
  earthRef,
}: HotspotProps) {
  const [hovered, setHovered] = useState(false)
  const ringRef = useRef<THREE.Mesh>(null)
  const pinRef = useRef<THREE.Group>(null)
  const proxyRef = useRef<THREE.Mesh>(null)
  const labelWrapRef = useRef<HTMLDivElement>(null)
  const facingRef = useRef(1)
  /* Read once per mount: see `coarsePointer`. */
  const hitPx = useMemo(() => (coarsePointer() ? HIT_PX_COARSE : HIT_PX), [])

  const position = useMemo(
    () =>
      latLonToVector3(region.lat, region.lon, GLOBE_LOOK.pins.anchorRadius),
    [region],
  )
  /*
   * The gate reads the pin's BASE normal: the core is offset along the same radial, so the direction is
   * identical and `position` (the anchor at `anchorRadius`) is the cheap source for it. Un-normalised —
   * the pure function normalises.
   */
  const baseNormal = useMemo(() => new THREE.Vector3(...position), [position])
  const quaternion = useMemo(() => {
    // Orient the ring's +Z along the surface normal at this lat/lon.
    const normal = new THREE.Vector3(...position).normalize()
    return new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      normal,
    )
  }, [position])

  // Stem geometry: a short dark collar from the surface up to the core, oriented
  // along the surface normal. It exists for CONTRAST, not decoration — an amber
  // core measured only ~1.2:1 luminance against a sunlit cloud deck, so the pin
  // needs something dark to sit on. A dark stem gets that without emitting light
  // onto the surface, which is exactly what the old <pointLight> got wrong.
  const look = useSyncExternalStore(
    subscribeLookFlags,
    getLookFlags,
    getLookFlags,
  )

  const uniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(region.accent) },
      uTime: { value: 0 },
      uPhase: { value: Math.random() },
    }),
    [region.accent],
  )

  useFrame((state, delta) => {
    /*
     * Same rule as the atmosphere: a pulsing shader ring is a function of this uniform, and a
     * frozen scene is only frozen if every time-driven term stops. `animate:true` (the live
     * product) leaves the value identical to the raw clock.
     */
    uniforms.uTime.value = lookTime(look.animate, state.clock.elapsedTime)
    const [r, g, b] = thermalVector(sst)
    ;(uniforms.uColor.value as THREE.Color).setRGB(r, g, b)

    if (ringRef.current) {
      const targetScale = active ? 1.55 : hovered ? 1.25 : 1
      ringRef.current.scale.lerp(
        new THREE.Vector3(targetScale, targetScale, targetScale),
        Math.min(1, delta * 6),
      )
    }
    if (pinRef.current) {
      const lift =
        active || hovered
          ? GLOBE_LOOK.pins.activeLift
          : GLOBE_LOOK.pins.idleLift
      pinRef.current.position.set(
        position[0] * lift,
        position[1] * lift,
        position[2] * lift,
      )
    }

    /*
     * Keep the hit proxy's PROJECTED radius at `hitPx`, whatever the camera distance is.
     *
     * A sphere of world radius `r` at distance `d` from the camera subtends `r * focalPx / d` CSS px, so
     * `r = hitPx * d / focalPx` is the world radius that measures exactly `hitPx` on screen. Recomputed
     * every frame (never React state): a wheel zoom changes `d` continuously and a radius kept in state
     * would lag the camera by a render.
     *
     * The proxy's POSITION is deliberately static — it sits on the idle head, the point `__globe.pins()`
     * reports and the specs project. If it followed the hover/active lift, hovering would move the proxy
     * out from under the cursor and the pointer-out it caused would move it back: a feedback loop that
     * flickers the cursor. The active lift is 0.025 R (7.6 px at d_fit), well inside the 14 px radius, so
     * a click aimed at the projected head still lands after a selection.
     */
    const proxy = proxyRef.current
    if (proxy) {
      const cam = state.camera as THREE.PerspectiveCamera
      proxy.getWorldPosition(SCRATCH_PROXY)
      const focalPx =
        state.size.height / 2 / Math.tan(((cam.fov ?? 42) * Math.PI) / 360)
      const dist = cam.position.distanceTo(SCRATCH_PROXY)
      const worldR = focalPx > 0 ? (hitPx * dist) / focalPx : PIN_HIT_CLAMP_R
      proxy.scale.setScalar(Math.min(worldR, PIN_HIT_CLAMP_R))
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
      const normal = new THREE.Vector3(
        position[0],
        position[1],
        position[2],
      ).normalize()
      const parent = pinRef.current?.parent
      if (parent) {
        parent.updateWorldMatrix(true, false)
        normal.transformDirection(parent.matrixWorld)
      }
      const facing = normal.dot(state.camera.position.clone().normalize())
      // Smooth 0..1 across the limb rather than a hard pop. The active region is
      // always 1 so the label you just clicked never fades out.
      const target = active
        ? 1
        : THREE.MathUtils.smoothstep(facing, 0.02, 0.22)
      facingRef.current +=
        (target - facingRef.current) * Math.min(1, delta * 8)

      const el = labelWrapRef.current
      el.style.opacity = facingRef.current.toFixed(3)
      el.style.pointerEvents = facingRef.current > 0.35 ? "auto" : "none"
      el.style.visibility = facingRef.current < 0.03 ? "hidden" : "visible"
    }
  })

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
    const el = labelWrapRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      const canvas = document.querySelector("#globe-canvas canvas")
      if (!canvas) return
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: e.deltaY,
          deltaMode: e.deltaMode,
          clientX: e.clientX,
          clientY: e.clientY,
          bubbles: false,
          cancelable: true,
        }),
      )
    }

    const btn = el.querySelector("button")
    const onClick = (e: MouseEvent) => {
      e.stopPropagation()
      onSelect(region.id)
    }
    const onEnter = () => setHovered(true)
    const onLeave = () => setHovered(false)

    el.addEventListener("wheel", onWheel, { passive: true })
    if (btn) {
      btn.addEventListener("click", onClick)
      btn.addEventListener("pointerenter", onEnter)
      btn.addEventListener("pointerleave", onLeave)
    }

    return () => {
      el.removeEventListener("wheel", onWheel)
      if (btn) {
        btn.removeEventListener("click", onClick)
        btn.removeEventListener("pointerenter", onEnter)
        btn.removeEventListener("pointerleave", onLeave)
      }
    }
  }, [region.id, onSelect])

  // Two forms of the same ramp: a THREE.Color for materials/lights (three would
  // ignore an rgba alpha and warn), and a CSS rgba for the DOM label.
  const glowColor = useMemo(() => {
    const [r, g, b] = thermalVector(sst)
    return new THREE.Color(r, g, b)
  }, [sst])
  const glowCss = thermalColor(sst, active ? 0.95 : 0.75)

  const headPosition = useMemo<[number, number, number]>(() => {
    /* The same point `__globe.pins()` reports and the specs project: anchor x idleLift + coreOffset. */
    const r =
      GLOBE_LOOK.pins.anchorRadius * GLOBE_LOOK.pins.idleLift +
      GLOBE_LOOK.pins.coreOffset
    return latLonToVector3(region.lat, region.lon, r)
  }, [region])

  /**
   * The proxy's raycast: the facing gate, then the ordinary sphere test.
   *
   * Why an override rather than a filter after the fact: A3 requires a back pin to produce NO hit, so
   * the intersection list has to be empty before R3F decides hover, cursor and click. A veto applied in
   * `onClick` would still hover, still set the pointer cursor over a pin the user cannot see, and would
   * still count as a hit for `onPointerMissed`'s bookkeeping.
   *
   * `nWorld` is recomputed here, at raycast time, from the pin's base direction through the earth
   * group's current world matrix — that is what keeps the answer right while the planet spins. The
   * camera side is `raycaster.ray.origin` (the ray's own origin, not `camera.position`, which differ by
   * the near plane) and the globe centre is the earth group's world position.
   */
  const proxyRaycast = useMemo(
    () => (raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) => {
      const proxy = proxyRef.current
      if (!proxy) return
      const earth = earthRef.current
      /* Fresh world matrices: a raycast can land between two renders, after the spin moved the group. */
      if (earth) earth.updateWorldMatrix(true, false)

      SCRATCH_NORMAL.copy(baseNormal)
      const carrier = earth ?? proxy.parent
      if (carrier) SCRATCH_NORMAL.transformDirection(carrier.matrixWorld)
      else SCRATCH_NORMAL.normalize()

      if (earth) earth.getWorldPosition(SCRATCH_CENTRE)
      else proxy.getWorldPosition(SCRATCH_CENTRE)

      if (
        !pinFacesCamera(
          SCRATCH_NORMAL,
          raycaster.ray.origin,
          SCRATCH_CENTRE,
          PIN_HIT_GATE,
        )
      )
        return
      THREE.Mesh.prototype.raycast.call(proxy, raycaster, intersects)
    },
    [baseNormal, earthRef],
  )

  return (
    <group>
      {/* Pulsing ring anchored to the surface. It is NOT the click target any more (step 3B2-FIX2):
          its 0.22-unit quad is tangent to the sphere, so it turns edge-on and its screen footprint
          collapses exactly where the limb is — which is why clicking a pin was hit-or-miss. The ring is
          drawn only; the hit proxy below is the target. */}
      {look.hotspotRings && (
        <mesh ref={ringRef} position={position} quaternion={quaternion}>
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

      {/*
        The HIT PROXY — the only click/hover/cursor target for this pin.

        A non-rendering sphere centred on the pin HEAD and scaled every frame so its projected radius is
        `HIT_PX` (14 px, 22 px on a coarse pointer): a sphere's silhouette is a circle from every
        direction, so a constant screen footprint costs one scalar and no billboarding, and it never
        collapses edge-on the way the tangent ring does.

        `visible={false}` is the non-drawing route, and it is safe here because three's raycaster never
        reads `visible`: `Raycaster.intersect()` tests `layers` and calls `object.raycast()`
        unconditionally (three.module.js:52030-52050), and R3F reaches it through
        `state.raycaster.intersectObject(obj, true)` (events-*.esm.js:919). R3F also only pushes an object
        onto the interaction list when it has BOTH `raycast` and handlers (events-*.esm.js:308-311), which
        this one does.

        No `stopPropagation` on the globe: a pointer-miss still has to close the drawer, so nothing here
        may swallow the "clicked empty globe" case. A back-facing pin returns no intersection at all and
        therefore already IS the empty-globe case.
      */}
      <mesh
        ref={proxyRef}
        name={`pin-hit-${region.id}`}
        position={headPosition}
        raycast={proxyRaycast}
        visible={false}
        onClick={(e) => {
          e.stopPropagation()
          onSelect(region.id)
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
          document.body.style.cursor = "pointer"
        }}
        onPointerOut={() => {
          setHovered(false)
          document.body.style.cursor = "auto"
        }}
      >
        <sphereGeometry args={[1, 12, 8]} />
        <meshBasicMaterial />
      </mesh>

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
          <mesh
            position={[0, 0, 0.025]}
            rotation={[Math.PI / 2, 0, 0]}
            renderOrder={6}
          >
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
          <mesh
            position={[0, 0, GLOBE_LOOK.pins.coreOffset - 0.006]}
            renderOrder={7}
          >
            <circleGeometry
              args={[
                (active ? 0.016 : 0.011) * GLOBE_LOOK.pins.housingScale,
                24,
              ]}
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
        position={[
          position[0] * 1.1,
          position[1] * 1.1 + 0.045,
          position[2] * 1.1,
        ]}
        center
        distanceFactor={1.55}
        zIndexRange={[40, 30]}
        style={{ pointerEvents: "auto" }}
      >
        <div ref={labelWrapRef} style={{ transition: "opacity 120ms linear" }}>
          <button
            type="button"
            onClick={() => onSelect(region.id)}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            className={[
              "group flex -translate-y-1 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-[3px]",
              "font-mono text-[9px] font-medium uppercase tracking-[0.14em] transition-all duration-200",
              active
                ? "border-[rgba(255,255,255,0.38)] text-white"
                : "border-[rgba(255,255,255,0.15)] text-[rgba(226,238,255,0.92)] hover:border-[rgba(255,255,255,0.34)] hover:text-white",
            ].join(" ")}
            style={{
              // Solid enough to guarantee contrast over white cloud or sun glint.
              background: "rgba(10, 15, 25, 0.85)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              // Two-layer shadow: a dark halo for contrast, a warm bloom when active.
              boxShadow: active
                ? `0 1px 2px rgba(0,0,0,0.9), 0 4px 14px rgba(0,0,0,0.55), 0 0 18px -4px ${glowCss}`
                : "0 1px 2px rgba(0,0,0,0.9), 0 4px 12px rgba(0,0,0,0.45)",
              textShadow: "0 1px 2px rgba(0,0,0,0.95)",
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
  )
}
