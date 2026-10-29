/**
 * Shared scene constants.
 *
 * Kept out of the component files so React Fast Refresh keeps working (a module
 * that exports both a component and a value disables HMR for that component).
 */

/**
 * World-space direction of the key light, normalised.
 *
 * Single source of truth: the <directionalLight> in GlobeScene and every shader
 * uniform (atmosphere rim, ocean glint, terminator warmth) read from here, so
 * the glint, the terminator and the atmosphere can never disagree about where
 * the sun is — which reads as a rendering bug the moment they drift.
 */
export const SUN_DIRECTION: [number, number, number] = [0.72, 0.36, 0.59];

/** Key light position: the sun direction pushed out far enough to be parallel. */
export const SUN_POSITION: [number, number, number] = [
  SUN_DIRECTION[0] * 8,
  SUN_DIRECTION[1] * 8,
  SUN_DIRECTION[2] * 8,
];

/** Earth radius in scene units. Every shell scale is expressed relative to it. */
export const EARTH_RADIUS = 1;

/** Shell scales, outermost first. */
export const SHELLS = {
  atmosphere: 1.028,
  clouds: 1.004,
  surface: 1.0,
  overlay: 1.0012,
} as const;
