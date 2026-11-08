/**
 * The pure maths for the Niño "Show on globe" fly-to (step 2.3c-1, C2.2).
 *
 * Nothing here touches three.js, React or the DOM: it takes a `NinoBox` plus the camera's fov and
 * aspect and returns a (lat, lon) aim point and a camera distance. That keeps the part with the
 * interesting arithmetic testable without a renderer, which is the point of the split — the camera
 * director should only have to carry out the answer.
 *
 * ## The distance formula
 *
 * A point on the unit sphere at angular offset `a` from the sub-camera point, seen by a camera at
 * distance `d` on the view axis, projects at normalised screen radius
 *
 *     x = sin(a) / ((d - cos(a)) * tan(half))
 *
 * Setting `x = 1` (the point exactly at the frame edge) and solving for `d` gives the EXACT fit
 *
 *     d = cos(a) + sin(a) / tan(half)
 *
 * For small `a` this reduces to `1 + tan(a)/tan(half)`, which is the small-angle form the 2.3a memo
 * carried. The exact form is used because a Niño box is up to ~25° wide and the small-angle version
 * under-estimates the needed distance there — the box would sit against the frame edge with its
 * outline clipped.
 *
 * Vertically `half` is fov/2; horizontally it is `atan(tan(fov/2) * aspect)`, which is what makes the
 * portrait case width-limited and therefore FURTHER away, not nearer.
 */

import type { NinoBox } from "@/lib/regions";

/** Slack on the fitted distance, per the step: `max(needed * 1.1, 1.25)`. */
export const NINO_FLYTO_MARGIN = 1.1;

/** The controls' own floor (`GlobeScene.tsx:726-727`). This file may not change it, only respect it. */
export const NINO_MIN_DISTANCE = 1.25;

/** The controls' ceiling. A fitted distance is clamped into the range the user may then zoom within. */
export const NINO_MAX_DISTANCE = 5;

/** The scene camera's vertical fov, in degrees (`GlobeScene` `<Canvas camera>`). */
export const NINO_FLYTO_FOV_DEG = 42;

const DEG = Math.PI / 180;
const INV_DEG = 180 / Math.PI;

/** Longitude wrapped into [0, 360). */
export function wrapLon360(lon: number): number {
    const wrapped = lon % 360;
    return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Longitude wrapped into (-180, 180]. */
export function wrapLon180(lon: number): number {
    const wrapped = wrapLon360(lon);
    return wrapped > 180 ? wrapped - 360 : wrapped;
}

/**
 * The signed shortest angular difference `to - from`, in degrees, in (-180, 180].
 *
 * This is the whole dateline requirement in one function: a naive `to - from` would send a flight
 * from lon -150 to Niño 4 at lon 185 the long way round (+335°), and the tween would spin the globe
 * more than three quarters of a turn in the wrong direction. Wrapping the delta makes every flight
 * take the short arc.
 */
export function shortestLonDelta(fromLon: number, toLon: number): number {
    return wrapLon180(toLon - fromLon);
}

/** True when the shortest path from `fromLon` to `toLon` crosses the antimeridian. */
export function crossesAntimeridian(fromLon: number, toLon: number): boolean {
    /*
     * Crosses when the SHORTEST arc is shorter than the difference measured straight between the
     * wrapped longitudes — i.e. the naive subtraction went the wrong way round the globe.
     *
     * 175 -> 185: wrapped longitudes are 175 and -175, so the naive difference is -350, while the
     * shortest arc is +10. |−350| > |10|, so the path crosses.
     * -150 -> -120: naive difference 30, shortest 30, so it does not.
     *
     * The first version of this had the comparison inverted and reported false for the 175 -> 185
     * case, which its own test caught.
     */
    const naive = wrapLon180(toLon) - wrapLon180(fromLon);
    return Math.abs(naive) > Math.abs(shortestLonDelta(fromLon, toLon)) + 1e-9;
}

/**
 * The box centre in 360 space, then wrapped.
 *
 * The centre is the registry anchor (`anchorLat`/`anchorLon`), which for Niño 4 is lat 0, lon -175
 * and wraps to 185. Anchor rule from C1.1: the CENTRE is used, because it is front-facing at every
 * shipped viewport (dot +0.0819 > the 0.06 facing threshold) and the western alternative at 170E is
 * back-facing there (-0.1631).
 */
export function boxCentreLon360(box: NinoBox): number {
    return wrapLon360(box.anchorLon);
}

/** Great-circle angular separation in degrees. */
export function angularOffsetDeg(
    fromLat: number,
    fromLon: number,
    toLat: number,
    toLon: number,
): number {
    const p1 = fromLat * DEG;
    const p2 = toLat * DEG;
    const dl = (toLon - fromLon) * DEG;
    const cos =
        Math.sin(p1) * Math.sin(p2) +
        Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
    return Math.acos(cos > 1 ? 1 : cos < -1 ? -1 : cos) * INV_DEG;
}

/**
 * The box's half-extent from its anchor, split into vertical and horizontal angular degrees.
 *
 * Vertical is the larger of |latMin - anchorLat| and |latMax - anchorLat|. Horizontal is the larger
 * longitude offset scaled by cos(lat) — a degree of longitude is `cos(lat)` great-circle degrees —
 * so a box near the pole is not credited with more width than it visually has. Both are measured
 * from the ANCHOR, not from the box's geometric middle, because the camera aims at the anchor.
 */
export function boxHalfExtents(box: NinoBox): {
    verticalDeg: number;
    horizontalDeg: number;
} {
    const verticalDeg = Math.max(
        Math.abs(box.latMin - box.anchorLat),
        Math.abs(box.latMax - box.anchorLat),
    );
    const anchorLon360 = wrapLon360(box.anchorLon);
    const westDelta = Math.abs(
        shortestLonDelta(anchorLon360, wrapLon360(box.lonWest)),
    );
    const eastDelta = Math.abs(
        shortestLonDelta(anchorLon360, wrapLon360(box.lonEast)),
    );
    const cosLat = Math.cos(box.anchorLat * DEG);
    const horizontalDeg = Math.max(westDelta, eastDelta) * cosLat;
    return { verticalDeg, horizontalDeg };
}

/**
 * The exact camera distance at which a point `halfAngleDeg` off-axis sits exactly on the frame edge.
 *
 * `d = cos(a) + sin(a)/tan(half)`.
 *
 * Degenerate cases. At `a = 0` the distance is 1: the point is on the axis, so any distance frames it.
 * At `a >= half` the old version returned `Infinity`, on the theory that a point beyond the frame edge
 * cannot be framed. That is wrong, and it silently broke the free-rect fit: `d` is the distance at
 * which the point lands exactly ON the edge, so for a WIDE point it is a finite, LARGER distance — the
 * frame does not get narrower as you back away, so pulling back far enough always works. Returning
 * `Infinity` there clamped every wide box to the 5.0 ceiling and skipped the fit entirely. Measured:
 * Nino 4 at 1280x720 with the free rect came back 4.997 (the ceiling) instead of ~2.44.
 *
 * The genuine degenerate case is `d <= 1`, which happens only as `a` approaches 180 degrees and the
 * point sits behind the camera; `Infinity` is still the honest answer there.
 */
export function requiredDistanceForHalfAngle(
    halfAngleDeg: number,
    halfFovDeg: number,
): number {
    if (halfAngleDeg <= 0) return 1;
    if (halfFovDeg <= 0) return Infinity;
    const a = halfAngleDeg * DEG;
    const half = halfFovDeg * DEG;
    const d = Math.cos(a) + Math.sin(a) / Math.tan(half);
    /* A point at or behind the camera plane (d <= 1) has no framing distance; wide-but-in-front does. */
    return Number.isFinite(d) && d > 1 ? d : Infinity;
}

/** The horizontal half-fov implied by a vertical half-fov and an aspect ratio. */
export function horizontalHalfFovDeg(
    verticalHalfFovDeg: number,
    aspect: number,
): number {
    return Math.atan(Math.tan(verticalHalfFovDeg * DEG) * aspect) * INV_DEG;
}

/**
 * The free rectangle as a fraction of the viewport, measured from the free rect's CENTRE.
 *
 * The camera is aimed at the box centre and the frame rig's view offset parks that centre at the
 * MIDDLE OF THE FREE RECT (`CameraDirector`'s offset block), so the free rect is exactly what the box
 * has to fit inside — the viewport edges are irrelevant. Expressed as fractions so the same numbers
 * work at every pixel size: `halfWidthFrac = free.w / (2 * viewportW)`.
 *
 * Both fields are the free extent as a fraction of the FULL viewport extent, so 1 means "the free
 * rect spans the whole viewport" and 0.471 means "it spans 47.1% of it". They are a FRACTION OF THE
 * EXTENT, not of the half-extent — getting that wrong halves the fov and pushes every box twice as
 * far away, which is exactly what the first version did.
 */
export interface FreeRectFrac {
    /** Free width as a fraction of the viewport width, in (0, 1]. */
    widthFrac: number;
    /** Free height as a fraction of the viewport height, in (0, 1]. */
    heightFrac: number;
}

/** Full-viewport framing: the free rect IS the viewport, so both fractions are 1. */
export const FULL_VIEWPORT_FRAC: FreeRectFrac = { widthFrac: 1, heightFrac: 1 };

/**
 * Convert a measured free rect into the margins the fit should respect.
 *
 * `viewportW`/`viewportH` must be the same CSS pixels the canvas uses; a zero or negative viewport
 * falls back to full-viewport framing rather than producing NaN.
 */
export function freeRectFraction(
    free: { x: number; y: number; w: number; h: number },
    viewportW: number,
    viewportH: number,
): FreeRectFrac {
    if (!(viewportW > 0) || !(viewportH > 0)) return FULL_VIEWPORT_FRAC;
    if (!(free.w > 0) || !(free.h > 0)) return FULL_VIEWPORT_FRAC;
    return {
        widthFrac: Math.min(free.w / viewportW, 1),
        heightFrac: Math.min(free.h / viewportH, 1),
    };
}

/**
 * The horizontal half-fov that corresponds to a margin FRACTION of the viewport half-width.
 *
 * `tan(halfH_eff) = frac * tan(halfH)`. This is the whole free-rect adjustment in one line: the fit
 * solves for the distance at which the box edge lands on the FREE rect's edge instead of the
 * viewport's, which is a narrower window and therefore a larger distance.
 */
export function scaledHalfFovDeg(halfFovDeg: number, frac: number): number {
    if (!(frac > 0)) return 0;
    if (frac >= 1) return halfFovDeg;
    return Math.atan(frac * Math.tan(halfFovDeg * DEG)) * INV_DEG;
}

/**
 * The camera distance that frames `box` with the required margin, clamped into the controls' range.
 *
 * Both axes are fitted and the FURTHER requirement wins, which is what makes the portrait case
 * width-limited: at aspect 0.45 the horizontal half-fov is ~9.7° against 21° vertical, so a 25°-wide
 * box needs far more distance than its 10° height does.
 *
 * `freeRect` (optional) narrows the fit from the viewport to the free rectangle. Without it the box
 * is fitted to the whole viewport, which at 1280x720 lets a wide box slide under the 316 px right
 * panel: measured, the Niño 4 outline spanned x 153..1173 against a free rect ending at 964, so
 * ~209 px of the outline sat beneath the UI. With it, the same box is fitted to the panel's edge.
 */
export function ninoFlyToDistance(
    box: NinoBox,
    opts: { fovDeg?: number; aspect?: number; freeRect?: FreeRectFrac } = {},
): number {
    const fovDeg = opts.fovDeg ?? NINO_FLYTO_FOV_DEG;
    const aspect = opts.aspect ?? 16 / 9;
    const halfV = fovDeg / 2;
    const halfH = horizontalHalfFovDeg(halfV, aspect);
    const frac = opts.freeRect ?? FULL_VIEWPORT_FRAC;

    const { verticalDeg, horizontalDeg } = boxHalfExtents(box);
    const dV = requiredDistanceForHalfAngle(
        verticalDeg,
        scaledHalfFovDeg(halfV, frac.heightFrac),
    );
    const dH = requiredDistanceForHalfAngle(
        horizontalDeg,
        scaledHalfFovDeg(halfH, frac.widthFrac),
    );

    const needed = Math.max(dV, dH);
    /* An unreachable extent is a bug in the box, not a framing choice; the ceiling is the honest answer. */
    const fitted = Number.isFinite(needed)
        ? needed * NINO_FLYTO_MARGIN
        : NINO_MAX_DISTANCE;
    return Math.min(Math.max(fitted, NINO_MIN_DISTANCE), NINO_MAX_DISTANCE);
}

/**
 * The zoom-scalar conversion, as an explicit identity.
 *
 * The existing fly-to does NOT take a zoom scalar: `runLockedFlyTo` assigns
 * `desiredDistance.current = want.zoom` and `want.zoom` comes straight from the region registry
 * (`regions.ts`: 2.9 / 2.6 / 2.7), i.e. those are already camera DISTANCES in scene units, fed
 * through `THREE.MathUtils.clamp(wanted, controls.minDistance, controls.maxDistance)`. There is
 * therefore no mapping to invert, and this function exists to say so in a form a test can pin: it
 * round-trips, which is the assertion the step asks for.
 */
export function zoomToDistance(zoom: number): number {
    return zoom;
}

/** The inverse of `zoomToDistance`, likewise the identity. */
export function distanceToZoom(distance: number): number {
    return distance;
}
