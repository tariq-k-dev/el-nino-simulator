import { useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { RegionId } from '@/types/enso';
import type { ScenarioMetrics } from '@/types/enso';
import { REGIONS } from '@/lib/regions';
import { regionHeadline } from '@/lib/model';
import { Globe } from '@/scene/Globe';
import { SUN_DIRECTION } from '@/scene/constants';
import { Hotspot } from '@/scene/Hotspot';

export interface SpinState {
  /** Current Y rotation of the earth group, in radians. */
  y: number;
  /** Continuous spin is paused while a region is focused. */
  paused: boolean;
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

  useFrame((_, delta) => {
    if (!spin.current.paused) {
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
        />
      ))}
    </group>
  );
}
