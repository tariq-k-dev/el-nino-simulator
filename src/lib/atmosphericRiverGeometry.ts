/**
 * Mathematical curve generation and ribbon geometry for the 3D Atmospheric River.
 *
 * Pure data architecture: returns typed arrays (positions, UVs, indices) so the
 * geometry can be unit-tested in node/vitest without a WebGL context or DOM.
 *
 * ## Layering and Radius
 *
 * Radius is set to 1.007 Earth radii:
 * - Above surface (1.000) and SST overlay (1.0012)
 * - Above the cloud deck (1.0040) and Niño box outlines (1.0025)
 * - Below the Rayleigh/Mie atmosphere shell (1.1000) and hotspot pins (1.0050+)
 *
 * ## Spherical Projection
 *
 * Spline interpolation occurs through control points in 3D space, and every
 * generated centerline and ribbon vertex is re-normalized onto the target
 * spherical radius R so the ribbon conforms to planetary curvature without
 * clipping through the surface or floating into space.
 */

import { latLonToVector3 } from "@/lib/regions";

/** Radius of the atmospheric river ribbon in Earth radii. */
export const ATMOSPHERIC_RIVER_RADIUS = 1.007;

/** Scene render order: sits directly above Niño outlines (4) and below pins (6-8). */
export const ATMOSPHERIC_RIVER_RENDER_ORDER = 5;

/** Default number of segments along the length of the ribbon. */
export const DEFAULT_SEGMENTS = 64;

/** Base ribbon width in scene units (at R = 1.007). */
export const DEFAULT_RIBBON_WIDTH = 0.045;

export interface AtmosphericRiverOptions {
    /**
     * Jet stream latitudinal displacement in degrees (typically -5 to +5).
     * Positive values shift the subtropical jet northward; negative values shift it southward.
     */
    jetShiftDegrees?: number;
    /** Sphere radius for the ribbon. Defaults to ATMOSPHERIC_RIVER_RADIUS (1.007). */
    radius?: number;
    /** Number of subdivisions along the trajectory curve. Defaults to 64. */
    segments?: number;
    /** Width of the ribbon at peak moisture width. Defaults to 0.045. */
    width?: number;
}

export interface RibbonGeometryData {
    positions: Float32Array;
    uvs: Float32Array;
    indices: Uint16Array;
    centerline: Float32Array;
}

type Vec3 = [number, number, number];

function add(a: Vec3, b: Vec3): Vec3 {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(v: Vec3, s: number): Vec3 {
    return [v[0] * s, v[1] * s, v[2] * s];
}

function dot(a: Vec3, b: Vec3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
}

function length(v: Vec3): number {
    return Math.sqrt(dot(v, v));
}

function normalize(v: Vec3): Vec3 {
    const len = length(v);
    if (len < 1e-9) return [0, 1, 0];
    return [v[0] / len, v[1] / len, v[2] / len];
}

/** Standard uniform Catmull-Rom spline interpolation between p1 and p2 using p0, p3 tangents. */
function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
    const t2 = t * t;
    const t3 = t2 * t;

    return [
        0.5 *
            (2 * p1[0] +
                (-p0[0] + p2[0]) * t +
                (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
                (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 *
            (2 * p1[1] +
                (-p0[1] + p2[1]) * t +
                (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
                (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
        0.5 *
            (2 * p1[2] +
                (-p0[2] + p2[2]) * t +
                (2 * p0[2] - 5 * p1[2] + 4 * p2[2] - p3[2]) * t2 +
                (-p0[2] + 3 * p1[2] - 3 * p2[2] + p3[2]) * t3),
    ];
}

/**
 * Returns waypoint control points [lat, lon] defining the moisture conveyor belt
 * from the Central Tropical Pacific to California landfall.
 */
export function getAtmosphericRiverWaypoints(
    jetShiftDegrees = 0,
): Array<{ lat: number; lon: number }> {
    return [
        // 0: Extended precursor anchor in the western tropical Pacific
        { lat: 8.0, lon: -178.0 },
        // 1: Primary tropical moisture source (Central Pacific warm pool)
        { lat: 14.0, lon: -164.0 },
        // 2: Subtropical jet entrainment (south of Hawaii)
        { lat: 19.5 + jetShiftDegrees * 0.4, lon: -152.0 },
        // 3: Mid-ocean jet inflection (Pineapple Express corridor)
        { lat: 26.0 + jetShiftDegrees * 0.8, lon: -140.0 },
        // 4: Northeast approach vector
        { lat: 32.5 + jetShiftDegrees * 0.4, lon: -129.0 },
        // 5: California Landfall (Central Coast / Bay Area / Sierra Nevada storm track)
        { lat: 37.2, lon: -122.4 },
        // 6: Inland dissipation anchor
        { lat: 39.5, lon: -118.5 },
    ];
}

/**
 * Builds ribbon vertex attributes (positions, UVs, indices) conforming to the sphere.
 */
export function buildAtmosphericRiverGeometry(
    options: AtmosphericRiverOptions = {},
): RibbonGeometryData {
    const {
        jetShiftDegrees = 0,
        radius = ATMOSPHERIC_RIVER_RADIUS,
        segments = DEFAULT_SEGMENTS,
        width = DEFAULT_RIBBON_WIDTH,
    } = options;

    const waypoints = getAtmosphericRiverWaypoints(jetShiftDegrees);
    const controlPoints: Vec3[] = waypoints.map((wp) =>
        latLonToVector3(wp.lat, wp.lon, radius),
    );

    const numSplineSegments = controlPoints.length - 3;
    const numVertsAlongCurve = segments + 1;
    const totalVerts = numVertsAlongCurve * 2;

    const positions = new Float32Array(totalVerts * 3);
    const uvs = new Float32Array(totalVerts * 2);
    const centerline = new Float32Array(numVertsAlongCurve * 3);
    const indices = new Uint16Array(segments * 6);

    // Generate centerline samples along the Catmull-Rom spline
    const curvePoints: Vec3[] = [];
    for (let i = 0; i < numVertsAlongCurve; i++) {
        const globalT = i / segments; // 0.0 to 1.0
        const scaledT = globalT * numSplineSegments;
        const segIndex = Math.min(Math.floor(scaledT), numSplineSegments - 1);
        const localT = scaledT - segIndex;

        const p0 = controlPoints[segIndex];
        const p1 = controlPoints[segIndex + 1];
        const p2 = controlPoints[segIndex + 2];
        const p3 = controlPoints[segIndex + 3];

        const rawPos = catmullRom(p0, p1, p2, p3, localT);
        // Project strictly onto the spherical shell radius
        const spherePos = scale(normalize(rawPos), radius);
        curvePoints.push(spherePos);

        centerline[i * 3 + 0] = spherePos[0];
        centerline[i * 3 + 1] = spherePos[1];
        centerline[i * 3 + 2] = spherePos[2];
    }

    // Generate ribbon vertices and UV coordinates
    for (let i = 0; i < numVertsAlongCurve; i++) {
        const curr = curvePoints[i];
        const prev = curvePoints[Math.max(0, i - 1)];
        const next = curvePoints[Math.min(numVertsAlongCurve - 1, i + 1)];

        // Tangent vector along curve
        const tangent = normalize(sub(next, prev));
        // Up normal (radially outward from globe center)
        const normal = normalize(curr);
        // Binormal (transverse vector across ribbon width)
        const binormal = normalize(cross(tangent, normal));

        // Dynamic width profile: narrow at origin, widest in mid-ocean, tapering at landfall
        const u = i / segments;
        const widthFactor = 0.5 + 0.5 * Math.sin(u * Math.PI);
        const halfWidth = (width * widthFactor) / 2;

        const left = scale(
            normalize(sub(curr, scale(binormal, halfWidth))),
            radius,
        );
        const right = scale(
            normalize(add(curr, scale(binormal, halfWidth))),
            radius,
        );

        const vIdx = i * 2;

        // Left vertex
        positions[vIdx * 3 + 0] = left[0];
        positions[vIdx * 3 + 1] = left[1];
        positions[vIdx * 3 + 2] = left[2];
        uvs[vIdx * 2 + 0] = u;
        uvs[vIdx * 2 + 1] = 0.0;

        // Right vertex
        positions[(vIdx + 1) * 3 + 0] = right[0];
        positions[(vIdx + 1) * 3 + 1] = right[1];
        positions[(vIdx + 1) * 3 + 2] = right[2];
        uvs[(vIdx + 1) * 2 + 0] = u;
        uvs[(vIdx + 1) * 2 + 1] = 1.0;
    }

    // Construct index buffer for quad strip
    let idxOffset = 0;
    for (let i = 0; i < segments; i++) {
        const v0 = i * 2;
        const v1 = i * 2 + 1;
        const v2 = (i + 1) * 2;
        const v3 = (i + 1) * 2 + 1;

        indices[idxOffset + 0] = v0;
        indices[idxOffset + 1] = v1;
        indices[idxOffset + 2] = v2;

        indices[idxOffset + 3] = v1;
        indices[idxOffset + 4] = v3;
        indices[idxOffset + 5] = v2;

        idxOffset += 6;
    }

    return { positions, uvs, indices, centerline };
}
