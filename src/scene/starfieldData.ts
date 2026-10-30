/**
 * Deterministic starfield geometry.
 *
 * The star field used `Math.random()` for every attribute, which made the sky
 * different on every page load. That is fine for a background and fatal for a
 * pixel spec: the atmosphere profile walks 16 rays outward through open sky, and
 * a star landing on one of those rays is a luminance spike no atmosphere rule can
 * satisfy. It also meant "the blue dot at (345,391)" could never be reproduced or
 * ruled out — it was a star that existed in one build and not the next.
 *
 * So the generator is a pure function of (count, seed) and lives here rather than
 * inside the component, which is what lets a unit test assert byte-identical
 * output across two independent calls without a browser or a THREE context.
 *
 * `STAR_SEED` is the single source of truth. Changing it re-rolls the sky; it must
 * not be changed casually, because the committed pixel baselines were measured
 * against this sky.
 */

/** Fixed seed for the whole star field. One place, deliberately. */
export const STAR_SEED = 0x5eed1e;

/**
 * mulberry32 — 32-bit, one multiply-shift per value, good enough for scattering
 * stars and trivially reproducible.
 *
 * Returns a function producing floats in [0, 1). Same seed, same sequence, on
 * every engine: the algorithm uses only Math.imul and integer ops, so there is no
 * floating-point drift between platforms.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface StarfieldData {
  positions: Float32Array;
  sizes: Float32Array;
  colors: Float32Array;
  phases: Float32Array;
  rates: Float32Array;
  twinkle: Float32Array;
}

/**
 * Build every per-star attribute from a seed.
 *
 * Order of `rand()` calls is part of the contract: the test compares raw buffers,
 * so inserting a draw in the middle re-rolls everything after it. Keep additions
 * at the end of the loop body, or bump STAR_SEED and re-baseline deliberately.
 */
export function buildStarfieldData(count: number, seed: number = STAR_SEED): StarfieldData {
  const rand = mulberry32(seed);

  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const rates = new Float32Array(count);
  const twinkle = new Float32Array(count);

  // Real star colours cluster along the blackbody curve: mostly white-blue with a
  // warm minority. A small palette looks photographic; random RGB per star looks
  // like confetti.
  const palette: Array<[number, number, number, number]> = [
    [0.62, 0.74, 1.0, 0.42], // hot blue-white
    [0.82, 0.88, 1.0, 0.28], // blue-white
    [1.0, 1.0, 1.0, 0.18], // white
    [1.0, 0.94, 0.82, 0.09], // warm
    [1.0, 0.82, 0.62, 0.03], // orange
  ];

  const pickColor = (): [number, number, number] => {
    let roll = rand();
    for (const [r, g, b, weight] of palette) {
      if (roll < weight) return [r, g, b];
      roll -= weight;
    }
    return [1, 1, 1];
  };

  // Three shells give genuine depth. The far shell holds the most stars so the
  // field reads deep rather than crowded close to the camera.
  const shellFor = (i: number): number => {
    const t = i / count;
    if (t < 0.16) return 26 + rand() * 16;
    if (t < 0.52) return 50 + rand() * 45;
    return 100 + rand() * 120;
  };

  for (let i = 0; i < count; i += 1) {
    // Uniform-on-sphere sampling: acos of a uniform variate. A naive uniform phi
    // clumps at the poles and reads as a rotational artefact.
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    const radius = shellFor(i);

    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi);
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

    const [r, g, b] = pickColor();
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;

    // Apparent brightness falls with distance, so far stars stay small.
    const distanceFalloff = clamp(65 / radius, 0.3, 1.5);
    const magnitude = Math.pow(rand(), 2.4);
    sizes[i] = (0.4 + magnitude * 3.2) * distanceFalloff;

    phases[i] = rand() * Math.PI * 2;
    // Slow, serene cadence: 0.045-0.20 rad/s puts a twinkle cycle at 31-140 s, so
    // the motion is barely perceptible per frame and the sky feels still.
    rates[i] = 0.045 + rand() * 0.155;
    // Only a subset twinkle noticeably - a field where every star pulses looks
    // like a bug, not like sky.
    twinkle[i] = rand() < 0.45 ? 0.14 + rand() * 0.26 : 0.03;
  }

  return { positions, sizes, colors, phases, rates, twinkle };
}

/** Local clamp; avoids pulling THREE into a module the unit tests import. */
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
