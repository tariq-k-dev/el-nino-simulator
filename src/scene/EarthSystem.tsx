import { useRef, useSyncExternalStore, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { RegionId } from '@/types/enso';
import type { ScenarioMetrics } from '@/types/enso';
import { REGIONS } from '@/lib/regions';
import { regionHeadline } from '@/lib/model';
import { Globe } from '@/scene/Globe';
import { SUN_DIRECTION } from '@/scene/constants';
import { Hotspot } from '@/scene/Hotspot';
import { getLookFlags, subscribeLookFlags } from '@/scene/globeLook';

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
}

/**
 * Owns the Earth's rotation so the globe and every hotspot share one transform.
 * The camera rig reads `spin.y` to compute where a marker actually is — that is
 * what keeps focus accurate while the planet is turning.
 */
export function EarthSystem({ sst, metrics, activeRegion, onSelect, spin }: EarthSystemProps) {
  const groupRef = useRef<THREE.Group>(null);
  const look = useSyncExternalStore(subscribeLookFlags, getLookFlags, getLookFlags);

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
    </group>
  );
}
