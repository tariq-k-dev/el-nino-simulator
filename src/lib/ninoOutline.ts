/**
 * GitHub-flavoured outline geometry for the Niño boxes, as pure data.
 *
 * Pure on purpose: every vertex is a plain `[x, y, z]` triple and every function is total, so the
 * whole module is unit-testable in the node environment that `vitest.config.ts:11` sets up — no
 * three.js, no DOM, no scene.
 *
 * ## Why 0..360 space and not a dateline split
 *
 * `boxLon360Ranges` (`src/lib/regions.ts:252`) already returns the box's coverage as ranges in
 * 0..360 with adjacent segments MERGED, so Niño 4 — written as `lonWest: 160, lonEast: -150` —
 * comes back as ONE range `[160, 210]` rather than two. Building vertices in `lat × lon360` and
 * only then converting to cartesian therefore produces a single closed loop with no seam at all:
 * consecutive longitudes 180 and 181 are the same physical meridian, and `latLonToVector3` maps
 * them to adjacent points 1.0 degrees apart at 1-degree steps (measured).
 *
 * The alternative — splitting at the dateline into two loops — is worse in two ways. It needs the
 * box's two vertical edges drawn twice at lon 180, and any error in the split shows up as a
 * segment that jumps the whole circumference. In 360 space that failure mode cannot arise: every
 * consecutive vertex is separated by exactly the step size, which the tests assert directly
 * (`maxStepDegrees`), so "no segment jumps across the globe" is proved rather than argued.
 */

import { type NinoBox, boxLon360Ranges, latLonToVector3 } from '@/lib/regions';

/**
 * Radius of the outline, in Earth radii.
 *
 * Above the surface (1.0) and above the ocean glint overlay shell (`SHELLS.overlay`, 1.0012) so the
 * line is never z-fought by the glint pass; below the cloud deck (`SHELLS.clouds`, 1.004) so that
 * clouds still occlude a far-side edge correctly via `depthTest`, which is the point of the depth
 * rules in the recon.
 */
export const NINO_OUTLINE_RADIUS = 1.0025;

/** Degrees between consecutive vertices along an edge. */
export const NINO_OUTLINE_STEP_DEG = 1;

/**
 * renderOrder for the outlines.
 *
 * The scene's ladder (`src/scene/Globe.tsx`): surface 0, atmosphere 1, clouds 2, glint overlay 3,
 * pins 6-8. The recon's rule is "above the clouds, below the pins", so 4 — one past the overlay and
 * well short of the lowest pin.
 */
export const NINO_OUTLINE_RENDER_ORDER = 4;

export type Vec3 = readonly [number, number, number];

/**
 * Vertices of one closed loop per `boxLon360Ranges` range, at `radius`.
 *
 * The loop walks the box boundary as four edges: south, east, north, west. The FIRST point is
 * repeated as the LAST so `THREE.LineLoop` and a plain `Line` agree on closure, and so a caller can
 * consume it either way without a second builder.
 *
 * ## One loop PER RANGE, never concatenated
 *
 * `boxLon360Ranges` merges adjacent segments, so every current box yields exactly ONE range —
 * Niño 4 (160E to 150W) comes back as `[160, 210]` and needs no dateline split at all. But the
 * general contract permits two ranges (a box written across the prime meridian gives
 * `[0, b]` and `[a, 360]`), and concatenating two walks into one array would close the LAST point
 * of range two back to the FIRST point of range one — a single segment spanning the globe. That is
 * exactly the failure the caller asked to have proved absent, so the split is structural here: each
 * range is its own loop and there is no code path that can join them.
 *
 * Longitude is sampled in 0..360 and passed to `latLonToVector3` unchanged: that function's
 * `cos`/`sin` pair is periodic, so 181 and -179 produce the same vertex. No normalisation step is
 * needed, and adding one would only create a place for a sign error.
 */
export function ninoOutlineLoops(
  box: NinoBox,
  radius: number = NINO_OUTLINE_RADIUS,
  stepDeg: number = NINO_OUTLINE_STEP_DEG,
): Vec3[][] {
  if (!(stepDeg > 0) || stepDeg > 45) {
    throw new RangeError(`ninoOutlineLoops: stepDeg must be in (0, 45], got ${stepDeg}`);
  }
  if (!(radius > 0)) {
    throw new RangeError(`ninoOutlineLoops: radius must be positive, got ${radius}`);
  }

  return boxLon360Ranges(box).map(([lonMin, lonMax]) => {
    const loop: Vec3[] = [];
    const push = (lat: number, lon360: number) => {
      loop.push(latLonToVector3(lat, lon360, radius));
    };

    const span = lonMax - lonMin;
    /**
     * Steps along the longitude edges, and the vertices along them.
     *
     * `Math.max(1, ...)` keeps a degenerate zero-span range (a box one longitude wide) from
     * producing a loop with no interior vertices, which would still be valid but would make the
     * step assertions vacuous.
     */
    const n = Math.max(1, Math.ceil(span / stepDeg));
    const lons: number[] = [];
    for (let i = 0; i <= n; i += 1) lons.push(lonMin + (span * i) / n);

    // South edge: lon increases at latMin.
    for (const lon of lons) push(box.latMin, lon);
    // North edge: lon decreases at latMax, so the loop returns without retracing.
    for (let i = lons.length - 1; i >= 0; i -= 1) push(box.latMax, lons[i]);

    // Close THIS loop explicitly, and only to its own first point.
    if (loop.length > 0) loop.push(loop[0]);
    return loop;
  });
}

/**
 * Every loop's vertices flattened into one array.
 *
 * Convenience for callers that do not need the per-range split (and for the tests that assert
 * global properties). Prefer `ninoOutlineLoops` when building geometry, so a two-range box becomes
 * two separate lines rather than one line that joins them.
 */
export function ninoOutlineVertices(
  box: NinoBox,
  radius: number = NINO_OUTLINE_RADIUS,
  stepDeg: number = NINO_OUTLINE_STEP_DEG,
): Vec3[] {
  return ninoOutlineLoops(box, radius, stepDeg).flat();
}

/**
 * The largest great-circle angle between consecutive vertices, in degrees.
 *
 * This is the "no segment jumps across the globe" proof. For a well-formed outline it is bounded by
 * `stepDeg` (plus a small latitude correction for the diagonal corners), so anything approaching a
 * half-turn means the builder emitted a jumped segment.
 */
export function maxStepDegrees(vertices: readonly Vec3[]): number {
  if (vertices.length < 2) return 0;
  let worst = 0;
  for (let i = 1; i < vertices.length; i += 1) {
    const a = vertices[i - 1];
    const b = vertices[i];
    const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const la = Math.hypot(a[0], a[1], a[2]);
    const lb = Math.hypot(b[0], b[1], b[2]);
    const cos = Math.min(1, Math.max(-1, dot / (la * lb || 1)));
    worst = Math.max(worst, (Math.acos(cos) * 180) / Math.PI);
  }
  return worst;
}

/** Every vertex lies on the same sphere, within floating-point tolerance. */
export function radiusSpread(vertices: readonly Vec3[]): { min: number; max: number } {
  if (vertices.length === 0) return { min: 0, max: 0 };
  let min = Infinity;
  let max = -Infinity;
  for (const v of vertices) {
    const r = Math.hypot(v[0], v[1], v[2]);
    if (r < min) min = r;
    if (r > max) max = r;
  }
  return { min, max };
}

/** Centroid direction of a box, as a unit vector — the camera target for a box fly-to. */
export function boxCentreDirection(box: NinoBox): Vec3 {
  const [lat, lon] = boxAnchor(box);
  const v = latLonToVector3(lat, lon, 1);
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * The box's anchor as `[lat, lon]` in the -180..180 convention.
 *
 * `NINO_BOXES` already carries `anchorLat`/`anchorLon` (schema, `regions.ts:163`), so this reads
 * them rather than recomputing a centre — the registry value is the one the recon measured and the
 * one a reviewer can check against the schema in the diff.
 */
export function boxAnchor(box: NinoBox): [number, number] {
  return [box.anchorLat, box.anchorLon];
}
