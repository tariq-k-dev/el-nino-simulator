/**
 * `window.__globe` — the screen-space probe the globe e2e specs need.
 *
 * Everything here answers a question a spec cannot answer from the DOM, because
 * the globe lives inside WebGL and its pins are either three.js meshes or drei
 * `<Html>` nodes whose CSS position is derived from the projection matrix:
 *
 *   project()      — where a world point lands in CSS pixels, using the SAME
 *                    projection the renderer and the raycast use, so a pin's
 *                    label and a hit test can be compared to it.
 *   discRadiusPx() — the globe's apparent radius, so "is the disc centred in the
 *                    free area" and "what fraction of the disc is blown out" are
 *                    measurable rather than guessed.
 *   distance()     — camera distance from the orbit target, i.e. what zoom moves.
 *   insets()       — the occluder insets the framing offset is derived from.
 *
 * Compile-time gated on VITE_E2E. `scripts/check-assets.mjs` asserts `__globe`
 * never appears in a production bundle.
 */

import type * as THREE from 'three';
import type { Insets } from '@/lib/viewport/insets';

export interface GlobeProjection {
  /** CSS pixels from the viewport's left/top edge. */
  x: number;
  y: number;
  /** True when the point is behind the camera. */
  behind: boolean;
}

export interface GlobeProbe {
  /** Project a world-space point (default: the globe centre) into CSS pixels. */
  project(point?: [number, number, number]): GlobeProjection;
  /** The globe's apparent radius in CSS pixels. */
  discRadiusPx(): number;
  /** Camera distance from the orbit target, in scene units. */
  distance(): number;
  /** Current occluder insets, in CSS pixels. */
  insets(): Insets;
}

export interface GlobeProbeInput {
  camera: THREE.Camera;
  /** Canvas size in CSS pixels (not the drawing buffer). */
  size: { width: number; height: number };
  /**
   * Where the orbit target is, in world space — a GETTER, not a value.
   *
   * The region fly-to moves the target, so a captured Vector3 would make
   * `distance()` report the distance to the globe centre after a focus, which is
   * not what zoom moves.
   */
  getTarget: () => THREE.Vector3;
  /** Globe radius in scene units. */
  globeRadius: number;
  /** Read the live occluder insets. */
  readInsets: () => Insets;
}

/**
 * Build the probe.
 *
 * `project()` deliberately goes through `camera.project()` rather than doing the
 * matrix maths here: that is the exact transform the renderer uses, so it stays
 * correct once `<FrameOffset>` installs a view offset (which changes the
 * projection matrix without moving the camera).
 */
export function createGlobeProbe(input: GlobeProbeInput): GlobeProbe {
  const vec = { x: 0, y: 0, z: 0 };

  const project = (point?: [number, number, number]): GlobeProjection => {
    const p = point ?? [0, 0, 0];
    vec.x = p[0];
    vec.y = p[1];
    vec.z = p[2];
    // NDC: -1..1, with Y up. Behind the camera gives |z| > 1 after projection.
    const ndc = projectVector(input.camera, vec);
    return {
      x: ((ndc.x + 1) / 2) * input.size.width,
      y: ((1 - ndc.y) / 2) * input.size.height,
      behind: ndc.z > 1 || ndc.z < -1,
    };
  };

  const distance = () => input.camera.position.distanceTo(input.getTarget());

  /**
   * Apparent disc radius.
   *
   * The exact silhouette of a sphere seen from distance `d`:
   *
   *     sin(theta) = R / d          (theta = half-angle of the disc)
   *
   * and the pixel radius is `tan(theta) * focalPx`, where `focalPx` is derived
   * from the vertical FOV and the canvas height. Using `tan(theta)` rather than
   * `theta` matters: at R/d near 1 (camera close to the surface) the small-angle
   * approximation understates the disc by tens of percent, and the blow-out test
   * would then measure the wrong pixel area.
   *
   * PerspectiveCamera is the only camera in this app; an orthographic one would
   * need R * focalPx / d instead, hence the explicit guard.
   */
  const discRadiusPx = (): number => {
    const cam = input.camera as THREE.PerspectiveCamera;
    if (typeof cam.fov !== 'number') return 0;
    const d = Math.max(distance(), 1e-6);
    const ratio = input.globeRadius / d;
    if (ratio >= 1) return input.size.height; // camera inside/at the surface
    const theta = Math.asin(ratio);
    const focalPx = input.size.height / 2 / Math.tan((cam.fov * Math.PI) / 180 / 2);
    return Math.tan(theta) * focalPx;
  };

  return { project, discRadiusPx, distance, insets: () => input.readInsets() };
}

/** `Vector3.project(camera)` without allocating a Vector3 per call. */
function projectVector(
  camera: THREE.Camera,
  v: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  // Camera-space transform, then the projection matrix, then the perspective
  // divide — i.e. exactly `Vector3.project`, written out so a per-frame call in a
  // spec does not allocate.
  const e = camera.matrixWorldInverse.elements;
  const cx = e[0] * v.x + e[4] * v.y + e[8] * v.z + e[12];
  const cy = e[1] * v.x + e[5] * v.y + e[9] * v.z + e[13];
  const cz = e[2] * v.x + e[6] * v.y + e[10] * v.z + e[14];

  const p = camera.projectionMatrix.elements;
  const px = p[0] * cx + p[4] * cy + p[8] * cz + p[12];
  const py = p[1] * cx + p[5] * cy + p[9] * cz + p[13];
  const pz = p[2] * cx + p[6] * cy + p[10] * cz + p[14];
  const pw = p[3] * cx + p[7] * cy + p[11] * cz + p[15];

  if (pw === 0) return { x: 0, y: 0, z: Infinity };

  /*
   * `behind` is decided by the NDC z, not by camera-space z.
   *
   * After the perspective divide, NDC z runs -1 (near plane) to +1 (far plane),
   * so `z > 1` means the point is beyond the far plane and `z < -1` means it is
   * in front of the near plane. The previous version tested a camera-space value
   * and reported the globe CENTRE as `behind: true` at the default camera — the
   * point furthest from the near plane is exactly what should be inside the
   * frustum, so that was backwards. Callers use `behind` to skip points that
   * cannot be visible; getting it inverted blanked the whole disc.
   */
  const ndcZ = pz / pw;
  return { x: px / pw, y: py / pw, z: ndcZ };
}
