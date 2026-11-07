import { useRef, useSyncExternalStore, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { RegionId } from "@/types/enso";
import type { ScenarioMetrics } from "@/types/enso";
import { REGIONS } from "@/lib/regions";
import { isNinoUiEnabled } from "@/lib/ninoFlag";
import { regionHeadline } from "@/lib/model";
import { Globe } from "@/scene/Globe";
import { SUN_DIRECTION } from "@/scene/constants";
import { Hotspot } from "@/scene/Hotspot";
import { NinoOverlay } from "@/scene/NinoOverlay";
import { getLookFlags, subscribeLookFlags } from "@/scene/globeLook";
import { AtmosphericRiver } from "@/scene/AtmosphericRiver";

/**
 * `?nino=1`, read ONCE at module load.
 *
 * Same mechanism and the same reasoning as `App.tsx:26`: a module const keeps this component's hook
 * list byte-identical whether the flag is on or off, so toggling it cannot reorder hooks. Read here
 * rather than threaded from `GlobeScene` because `NinoOverlay` is the only consumer and threading a
 * prop would touch two more files for a boolean that never changes at runtime.
 */
const NINO_UI = isNinoUiEnabled(
  typeof location === "undefined" ? "" : location.search,
);

export interface SpinState {
  /** Current Y rotation of the earth group, in radians. */
  y: number;
  /** Continuous spin is paused while a region is focused. */
  paused: boolean;
  /**
   * Set the rotation to an absolute angle and stop accumulating.
   *
   * A spec that only paused the spin would freeze the planet at whatever
   * longitude the first frame happened to reach, which still differs between
   * loads. This pins it, so a pixel baseline is the same scene every time.
   */
  frozen: boolean;
  /** Absolute angle applied when `frozen` is set. */
  frozenAt: number;
  /** Cloud drift offset, frozen alongside the planet. */
  cloudAngle: number;
}

interface EarthSystemProps {
  sst: number;
  metrics: ScenarioMetrics;
  activeRegion: RegionId | null;
  onSelect: (id: RegionId) => void;
  spin: MutableRefObject<SpinState>;
  /**
   * The Niño box currently selected by a card's "Show on globe" (C2.4), or null.
   *
   * Optional so the existing tests that mount `EarthSystem` without it keep working; when it is
   * undefined the overlay draws every outline at the base brightness, which is the pre-C2 look.
   */
  activeNinoBox?: string | null;
}

/**
 * Owns the Earth's rotation so the globe and every hotspot share one transform.
 * The camera rig reads `spin.y` to compute where a marker actually is — that is
 * what keeps focus accurate while the planet is turning.
 */
export function EarthSystem({
  sst,
  metrics,
  activeRegion,
  onSelect,
  spin,
  activeNinoBox = null,
}: EarthSystemProps) {
  const groupRef = useRef<THREE.Group>(null);
  const look = useSyncExternalStore(
    subscribeLookFlags,
    getLookFlags,
    getLookFlags,
  );

  useFrame((_, delta) => {
    if (spin.current.frozen) {
      spin.current.y = spin.current.frozenAt;
    } else if (!spin.current.paused && look.animate) {
      spin.current.y += delta * 0.045;
      if (spin.current.y > Math.PI * 2) spin.current.y -= Math.PI * 2;
    }
    if (groupRef.current) groupRef.current.rotation.y = spin.current.y;
  });

  return (
    <group ref={groupRef}>
      <Globe sst={sst} sunDirection={SUN_DIRECTION} />
      {REGIONS.map((region) => (
        <Hotspot
          key={region.id}
          region={region}
          sst={sst}
          active={activeRegion === region.id}
          headline={regionHeadline(metrics, region.id)}
          onSelect={onSelect}
          earthRef={groupRef}
        />
      ))}
      {/*
        Niño box pins and outlines — `?nino=1` only.

        This is the ONLY change to this file: one conditional mount. Everything the flag adds lives
        in `NinoOverlay.tsx`, so with the flag off nothing here is constructed at all — no pins, no
        geometry, no material — and the flag-off scene is the same object graph as before.
      */}
      {NINO_UI ? (
        <NinoOverlay
          earthRef={groupRef}
          sst={sst}
          selectedBoxId={activeNinoBox}
        />
      ) : null}
      <AtmosphericRiver sst={sst} jetShiftDegrees={metrics.jet} />
    </group>
  );
}
