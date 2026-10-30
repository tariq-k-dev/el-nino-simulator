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
import type { GlobeLookFlags } from '@/scene/globeLook';

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
  /**
   * Where each pin's CORE lands on screen, plus whether it is on the near
   * hemisphere. The glare rule excludes a circle around every projected pin
   * (pins are allowed to be bright), so the spec needs this even for pins it
   * then discards — a pin on the far side still occludes nothing.
   */
  pins(): Array<{ id: string; x: number; y: number; behind: boolean; facing: boolean }>;
  /**
   * Each pin's CORE position in WORLD space.
   *
   * `pins()` deliberately reports screen space, which is what the pixel checks need.
   * The negative suite needs the opposite: to place a light ON a pin it has to know where
   * that pin is in the scene, and reconstructing a world point from a screen coordinate is
   * not possible without inverting the projection (and it silently succeeds with a wrong
   * answer, which cost a debugging round: a light placed from a guessed world point
   * projected 580 px from the pin it was meant to sit on).
   */
  pinAnchors(): Array<{ id: string; world: [number, number, number] }>;
  /** Current layer switches. */
  lookFlags(): GlobeLookFlags;
  /** Flip layer switches. Returns the new set. */
  setLookFlags(patch: Partial<GlobeLookFlags>): GlobeLookFlags;
  /** The tuning constants, for printing in a failure message. */
  look(): unknown;
  /**
   * Park the camera at a fixed world position looking at the origin, with
   * rotation paused. Returns when the next frame has been drawn.
   *
   * Specs need three reproducible angles, and the scene auto-rotates — so
   * "screenshot the upper-left lit area" is otherwise a race against the spin.
   */
  setCamera(position: [number, number, number]): Promise<void>;
  /**
   * Orbit the camera to `deg` around the globe at the DEFAULT elevation and
   * distance. 0 = the default view.
   *
   * Exists because a spec that wants twelve azimuths should not re-derive the
   * spherical maths (and get the elevation convention wrong) in every file. The
   * convention is fixed here: `az` increases as `sin(az)` on world +X and
   * `cos(az)` on world +Z, which is what the LOOK2 sweep used and therefore what
   * the recorded baselines were measured with.
   */
  setAzimuth(deg: number): Promise<void>;
  /** The default camera distance and elevation the azimuth orbit preserves. */
  defaultOrbit(): { distance: number; elevationDeg: number };
  /**
   * Freeze the planet at an absolute Y rotation, or release it.
   *
   * A pixel baseline is only reproducible if the texture is at the same longitude
   * on every load. Pausing alone is not enough: `spin.y` accumulates from frame
   * deltas, so two loads that reach the first screenshot at different times show
   * different hemispheres (measured: 17.4 mean absolute luma inside the disc,
   * versus 0.02 in the sky the spin does not touch).
   */
  setSpin(frozen: boolean, angle: number): void;
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
  /** Read / write the layer switches and read the tuning object. */
  readLookFlags: () => GlobeLookFlags;
  writeLookFlags: (patch: Partial<GlobeLookFlags>) => GlobeLookFlags;
  look: unknown;
  /**
   * Pin anchors in WORLD space, with the planet's current spin already applied.
   * Optional so unit tests can build a probe without a scene.
   */
  pins?: () => Array<{ id: string; world: [number, number, number] }>;
  /** Pause the planet's spin so a fixed camera shows a fixed hemisphere. */
  setSpinPaused?: (paused: boolean) => void;
  /** Freeze the planet at an absolute Y rotation, or release it. */
  setSpin?: (frozen: boolean, angle: number) => void;
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

  /**
   * Pin anchors. `facing` is the pin normal against the eye direction, which is
   * what decides whether the core is on the visible hemisphere — the same test
   * Hotspot.tsx uses to fade its DOM label.
   */
  const pins = (): Array<{ id: string; x: number; y: number; behind: boolean; facing: boolean }> => {
    const anchors = input.pins?.() ?? [];
    const eye = input.camera.position;
    const eyeLen = eye.length() || 1;
    return anchors.map(({ id, world }) => {
      const p = project(world);
      const len = Math.hypot(world[0], world[1], world[2]) || 1;
      const dot =
        ((world[0] / len) * eye.x + (world[1] / len) * eye.y + (world[2] / len) * eye.z) / eyeLen;
      return { id, x: p.x, y: p.y, behind: p.behind, facing: dot > 0.06 };
    });
  };

  /**
   * Park the camera and pause the spin.
   *
   * Resolves on the next animation frame rather than immediately: the renderer
   * draws on rAF, so a screenshot taken in the same task would capture the
   * previous pose. `setSpinPaused` is what makes the pose stable — the planet
   * advances 0.045 rad/s, which is ~2.6 px/s of drift at the default distance
   * and enough to move a pin out of a sampled ring between two screenshots.
   */
  const setCamera = (position: [number, number, number]): Promise<void> => {
    input.setSpinPaused?.(true);
    input.camera.position.set(position[0], position[1], position[2]);
    input.camera.lookAt(0, 0, 0);
    input.camera.updateMatrixWorld(true);
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  };

  /*
   * Default orbit, derived from the scene's own initial camera position rather
   * than hard-coded here: if the composition moves the camera, the azimuth
   * sweep moves with it instead of silently measuring a different framing.
   */
  const defaultOrbit = () => {
    const cam = input.camera as THREE.PerspectiveCamera;
    const distance = cam.position.length();
    const elevationDeg = (Math.asin(cam.position.y / Math.max(distance, 1e-9)) * 180) / Math.PI;
    return { distance, elevationDeg };
  };

  const setAzimuth = (deg: number): Promise<void> => {
    const { distance, elevationDeg } = defaultOrbit();
    const a = (deg * Math.PI) / 180;
    const el = (elevationDeg * Math.PI) / 180;
    const r = distance * Math.cos(el);
    const y = distance * Math.sin(el);
    return setCamera([r * Math.sin(a), y, r * Math.cos(a)]);
  };

  return {
    project,
    discRadiusPx,
    pinAnchors: () => input.pins?.() ?? [],
    distance,
    insets: () => input.readInsets(),
    pins,
    lookFlags: () => input.readLookFlags(),
    setLookFlags: (patch) => input.writeLookFlags(patch),
    look: () => input.look,
    setCamera,
    setAzimuth,
    defaultOrbit,
    setSpin: (frozen, angle) => input.setSpin?.(frozen, angle),
  };
}

/**
 * `Vector3.project(camera)` without allocating a Vector3 per call.
 */
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
