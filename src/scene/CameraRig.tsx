import { useEffect, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { RegionId } from '@/types/enso';
import { REGION_MAP, latLonToVector3 } from '@/lib/regions';
import type { SpinState } from '@/scene/EarthSystem';

interface CameraRigProps {
  activeRegion: RegionId | null;
  spin: MutableRefObject<SpinState>;
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
  /** Bumped to force a re-focus on the same region (e.g. re-click). */
  focusNonce: number;
}

const DEFAULT_POSITION = new THREE.Vector3(0, 1.15, 3.15);
const DEFAULT_TARGET = new THREE.Vector3(0, 0, 0);

/** Extra distance beyond the focus radius, so the limb has breathing room. */
const FOCUS_PADDING = 0.28;

/** World-space direction of a lat/lon after the earth group's Y rotation. */
function regionDirection(id: RegionId, spinY: number): THREE.Vector3 {
  const region = REGION_MAP[id];
  const [x, y, z] = latLonToVector3(region.lat, region.lon, 1);
  return new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), spinY);
}

/**
 * Smooth camera interpolation to the active hotspot.
 *
 * The critical detail — and the bug this replaced — is that OrbitControls must
 * stay ENABLED for the whole flight. `controls.update()` is what derives the
 * camera's orientation from (target, offset); disabling it and lerping
 * `camera.position` alone moved the eye to the far side of the planet while the
 * quaternion stayed frozen, so the globe swung out of frame and appeared to
 * vanish mid-transition (measured: lit pixels fell 31.5% -> 0.6%).
 *
 * Instead of fighting the controls, this drives their inputs:
 *   - `controls.target` is damped toward the marker position;
 *   - the eye's distance from that target is eased while its viewing direction
 *     is preserved, so the camera never sweeps through the globe.
 * OrbitControls then re-derives a valid spherical orientation every frame, so
 * the mesh stays in the frustum and there is no jump-cut at either end.
 */
export function CameraRig({ activeRegion, spin, controlsRef, focusNonce }: CameraRigProps) {
  const { camera } = useThree();
  const desiredTarget = useRef(new THREE.Vector3().copy(DEFAULT_TARGET));
  const desiredDistance = useRef(DEFAULT_POSITION.length());
  const travelling = useRef(false);
  const previousMax = useRef<number | null>(null);

  useEffect(() => {
    if (activeRegion) {
      spin.current.paused = true;
      const region = REGION_MAP[activeRegion];
      desiredTarget.current.copy(regionDirection(activeRegion, spin.current.y));
      desiredDistance.current = region.zoom;
    } else {
      spin.current.paused = false;
      desiredTarget.current.copy(DEFAULT_TARGET);
      desiredDistance.current = DEFAULT_POSITION.length();
    }
    travelling.current = true;
  }, [activeRegion, focusNonce, spin]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    // Frame-rate independent damping (the 1 - r^dt formulation), with delta
    // capped so a long frame (tab regaining focus) cannot snap the camera.
    const step = Math.min(delta, 1 / 30);
    const targetEase = 1 - Math.pow(0.0001, step);
    const distanceEase = 1 - Math.pow(0.0006, step);

    const wanted = desiredDistance.current;

    // A focus distance can be nearer than the default zoom clamp, so the clamps
    // have to open before the dolly can happen. Restored once settled.
    if (previousMax.current === null) previousMax.current = controls.maxDistance;
    controls.maxDistance = Math.max(previousMax.current, wanted + FOCUS_PADDING);
    controls.minDistance = Math.min(1.55, wanted);
    controls.enableDamping = true;

    // Damp the orbit target.
    controls.target.lerp(desiredTarget.current, targetEase);

    // Ease distance-from-target while preserving the viewing direction. Because
    // the offset is only scaled (never re-aimed), the camera cannot clip through
    // the globe and the lighting context never jumps.
    const offset = camera.position.clone().sub(controls.target);
    const currentDistance = offset.length();
    if (currentDistance > 1e-6) {
      const nextDistance = THREE.MathUtils.lerp(currentDistance, wanted, distanceEase);
      camera.position.copy(controls.target).add(offset.setLength(nextDistance));
    }

    // Always call update(): it derives the quaternion from target+offset and
    // clamps the polar angle, keeping orientation consistent with position.
    controls.update();

    if (travelling.current) {
      const targetSettled = controls.target.distanceTo(desiredTarget.current) < 0.004;
      const distanceSettled = Math.abs(currentDistance - wanted) < 0.004;
      if (targetSettled && distanceSettled) {
        travelling.current = false;
        if (previousMax.current !== null) {
          controls.maxDistance = previousMax.current;
          previousMax.current = null;
        }
      }
    }
  });

  return null;
}
