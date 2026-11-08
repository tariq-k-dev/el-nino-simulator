import type { RegionDefinition, RegionId } from "@/types/enso";

/**
 * Hotspot coordinates are hand-placed on the national/regional centroid so the
 * pin readout matches where a viewer's eye expects it. `zoom` is a camera
 * distance in scene units (Earth radius = 1).
 */
export const REGIONS: RegionDefinition[] = [
    {
        id: "pacific",
        name: "Equatorial Pacific",
        shortName: "Niño 3.4",
        lat: -2,
        lon: -150,
        zoom: 2.9,
        accent: "#38bdf8",
        summary:
            "The engine room. Weakened trade winds pile warm water eastward along the equator.",
        mechanism:
            "SST deviation drives deep convection east of the dateline, displacing the Walker circulation and teleconnecting the entire global pattern.",
    },
    {
        id: "us-west",
        name: "Western US & California",
        shortName: "California",
        lat: 37,
        lon: -120,
        zoom: 2.6,
        accent: "#a78bfa",
        summary:
            "A southward-shifted subtropical jet funnels atmospheric rivers into the coast.",
        mechanism:
            "Extended Pacific jet stream carries tropical moisture north-east, raising precipitation and muting winter temperature extremes.",
    },
    {
        id: "se-asia",
        name: "Southeast Asia & Indonesia",
        shortName: "Indonesia",
        lat: -3,
        lon: 112,
        zoom: 2.7,
        accent: "#fb923c",
        summary:
            "Convection migrates away from the Maritime Continent — drought and fire risk climb.",
        mechanism:
            "Sinking motion replaces the usual rising branch of the Walker cell, suppressing monsoon rainfall and dropping groundwater recharge.",
    },
    {
        id: "horn-africa",
        name: "Horn of Africa",
        shortName: "Horn of Africa",
        lat: 8,
        lon: 42,
        zoom: 2.7,
        accent: "#34d399",
        summary:
            "A warmer western Indian Ocean feeds short rains, pushing flood risk sharply higher.",
        mechanism:
            "Cross-equatorial moisture flux intensifies during the October–December short-rains season, overwhelming normally arid catchments.",
    },
    {
        id: "amazon-basin",
        name: "Amazon Basin",
        shortName: "Amazon",
        lat: -3.46,
        lon: -62.21,
        zoom: 2.7,
        accent: "#22c55e",
        summary:
            "Focuses on the central Amazon rainforest canopy, monitoring severe drought conditions typically induced by El Niño.",
        mechanism:
            "El Niño reduces rainfall across the Amazon basin, increasing drought stress on the rainforest ecosystem.",
    },
    {
        id: "gulf-coast",
        name: "Gulf Coast",
        shortName: "Gulf Coast",
        lat: 28.5,
        lon: -90,
        zoom: 2.6,
        accent: "#0ea5e9",
        summary:
            "Captures the Gulf of Mexico where El Niño historically increases winter precipitation and alters hurricane shear patterns.",
        mechanism:
            "El Niño strengthens the subtropical jet stream, bringing increased winter rainfall and reducing hurricane activity in the Gulf region.",
    },
];

export const REGION_MAP: Record<RegionId, RegionDefinition> = REGIONS.reduce(
    (acc, region) => {
        acc[region.id] = region;
        return acc;
    },
    {} as Record<RegionId, RegionDefinition>,
);

/** Spherical → Cartesian on a unit sphere (three.js Y-up). */
export function latLonToVector3(
    lat: number,
    lon: number,
    radius = 1,
): [number, number, number] {
    const phi = ((90 - lat) * Math.PI) / 180;
    const theta = ((lon + 180) * Math.PI) / 180;
    return [
        -radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta),
    ];
}

export function formatDelta(value: number, unit: string, digits = 1): string {
    const sign = value > 0 ? "+" : value < 0 ? "−" : "";
    return `${sign}${Math.abs(value).toFixed(digits)}${unit}`;
}

export const celsiusToFahrenheit = (c: number): number => c * 1.8 + 32;

/**
 * Temperature *deviations* are not absolute temperatures — a delta scales by
 * 5/9 with no +32 offset. Using celsiusToFahrenheit() here turns a -1.91 °F
 * anomaly into -18.8 °C, which is a nonsense number on a dashboard.
 */
export const fahrenheitDeltaToCelsius = (f: number): number => f * (5 / 9);
export const celsiusDeltaToFahrenheit = (c: number): number => c * (9 / 5);

/** Imperial mode converts the temperature-family metrics only. */
export function tempDisplay(
    celsius: number,
    units: "metric" | "imperial",
): { value: number; unit: string } {
    return units === "imperial"
        ? { value: celsiusToFahrenheit(celsius), unit: "°F" }
        : { value: celsius, unit: "°C" };
}

/** Same, but for an anomaly/deviation rather than an absolute reading. */
export function deltaDisplay(
    celsiusDelta: number,
    units: "metric" | "imperial",
): { value: number; unit: string } {
    return units === "imperial"
        ? { value: celsiusDeltaToFahrenheit(celsiusDelta), unit: "°F" }
        : { value: celsiusDelta, unit: "°C" };
}

/* ------------------------------------------------------------------ Niño boxes ---
 *
 * NOAA CPC reference boxes for the equatorial Niño regions, held as SCHEMA ONLY.
 *
 * Three rules make this block inert by construction, and each is load-bearing:
 *
 *  1. `NINO_BOXES` is a SEPARATE export. It is never spread into, pushed into, or
 *     derived from `REGIONS`, and `REGIONS` never reads it. A box is not a
 *     selectable region: it has no `zoom`, no `accent` and no card copy, so it
 *     cannot satisfy `RegionDefinition` and cannot leak into the card stack, the
 *     pins, the fly-to, the snapshot or the drawer chips.
 *  2. Everything here is pure. No module-level mutable state, no I/O, so importing
 *     the module costs nothing observable.
 *  3. Coordinates are stored in the -180..180 convention, the same one the
 *     registry uses for pin anchors, with `lonWest > lonEast` encoding a box that
 *     crosses the antimeridian (Niño 4 does: 160E to 150W).
 *
 * Niño 3.4 is deliberately NOT in `NINO_BOXES`. The existing Niño 3.4 definition
 * (`REGIONS[0]`, id `pacific`) is a single point at (-2, -150) plus a `zoom`, not a
 * box — so there is no existing box for the values to agree with, and inventing one
 * here would be a new definition rather than a schema restatement. The CPC box is
 * exported separately as `NINO34_REFERENCE_BOX`, anchored on the existing pin, and
 * exists only as a regression reference.
 */

/** The three equatorial Niño boxes, NOAA CPC convention. */
export type NinoBoxId = "nino12" | "nino34" | "nino4";

/**
 * A latitude/longitude box on a sphere.
 *
 * `lonWest` and `lonEast` are in -180..180. When `lonWest > lonEast` the box runs
 * eastward across the antimeridian, so its span is `360 - (lonWest - lonEast)`
 * rather than a negative difference. Every helper below reads the same rule.
 */
export interface NinoBox {
    id: NinoBoxId;
    /** Display label, uppercase with the Spanish eñe (see the Ñ note in the recon). */
    label: string;
    latMin: number;
    latMax: number;
    lonWest: number;
    lonEast: number;
    /** Pin anchor = box centre, so a future card can reuse `latLonToVector3` unchanged. */
    anchorLat: number;
    anchorLon: number;
}

/**
 * The boxes defined by this step. **Not a region list** — see the block comment.
 *
 * Niño 1+2: 0 to 10 S, 90 W to 80 W. Niño 4: 5 N to 5 S, 160 E to 150 W.
 */
export const NINO_BOXES: readonly NinoBox[] = [
    {
        id: "nino12",
        label: "NIÑO 1+2",
        latMin: -10,
        latMax: 0,
        lonWest: -90,
        lonEast: -80,
        anchorLat: -5,
        anchorLon: -85,
    },
    {
        id: "nino4",
        label: "NIÑO 4",
        latMin: -5,
        latMax: 5,
        // 160 E to 150 W: west edge is numerically greater, which is how the dateline
        // crossing is encoded. `boxLonSpan` reads it as 50 degrees, not -310.
        lonWest: 160,
        lonEast: -150,
        anchorLat: 0,
        // -175, not 185: the 0..360 form is only for the filter helpers.
        anchorLon: -175,
    },
];

/**
 * The CPC Niño 3.4 box, as a regression reference only.
 *
 * NOT part of `NINO_BOXES` and not consumed by anything: the shipped Niño 3.4 entry
 * is the point (-2, -150) in `REGIONS`, and this box is here so a later step can
 * compare the two rather than rediscover the CPC values.
 */
export const NINO34_REFERENCE_BOX: NinoBox = {
    id: "nino34",
    label: "NIÑO 3.4",
    latMin: -5,
    latMax: 5,
    lonWest: -170,
    lonEast: -120,
    anchorLat: -2,
    anchorLon: -150,
};

/**
 * Fold a longitude into -180..180.
 *
 * The chosen rule is a **closed** interval: inputs already inside -180..180 are
 * returned unchanged, including both endpoints. Only out-of-range inputs wrap, and
 * a positive input that lands exactly on the antimeridian reports `+180` (not
 * `-180`), so `180` and `540` agree with each other while `-180` keeps its sign.
 * The alternative — the half-open `[-180, 180)` that `%` gives for free — would
 * silently turn `180` into `-180`, which is fine for arithmetic and wrong for a
 * schema someone will read in a diff.
 */
export function normalizeLon180(lon: number): number {
    if (!Number.isFinite(lon)) {
        throw new RangeError(
            `normalizeLon180 expects a finite longitude, got ${lon}`,
        );
    }
    const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
    // `wrapped` is in [-180, 180). Only the exact antimeridian needs the sign fixed.
    return wrapped === -180 && lon > 0 ? 180 : wrapped;
}

/**
 * Fold a longitude into 0..360 — the convention gridded SST products use, and the
 * one a DuckDB `BETWEEN` or a numpy boolean mask needs to be free of wraparound.
 */
export function toLon360(lon: number): number {
    const wrapped180 = normalizeLon180(lon);
    return wrapped180 === 180
        ? 180
        : wrapped180 < 0
          ? wrapped180 + 360
          : wrapped180;
}

/** Longitude extent of a box in degrees, always 0..360 (never negative). */
export function boxLonSpan(box: NinoBox): number {
    if (box.lonWest > box.lonEast) return 360 - (box.lonWest - box.lonEast);
    return box.lonEast - box.lonWest;
}

/**
 * The box's longitude coverage as one or two `[min, max]` ranges in 0..360, sorted
 * ascending by `min` and with adjacent segments merged.
 *
 * Two ranges appear only when the box straddles the 0/360 seam — the antimeridian
 * for a normal box, or the prime meridian for a box written across 0. A caller
 * filters with `ranges.some(([a, b]) => lon360 >= a && lon360 <= b)`; a single
 * `BETWEEN west AND east` would silently match the complement of a crossing box.
 * Ranges are closed on both ends and can touch (e.g. `[160, 210]`), never overlap.
 */
export function boxLon360Ranges(box: NinoBox): Array<[number, number]> {
    // Segment the box in 180-space first, where a crossing is two contiguous pieces.
    const segments: Array<[number, number]> =
        box.lonWest > box.lonEast
            ? [
                  [box.lonWest, 180],
                  [-180, box.lonEast],
              ]
            : [[box.lonWest, box.lonEast]];

    const ranges: Array<[number, number]> = [];
    for (const [west, east] of segments) {
        const a = toLon360(west);
        const b = toLon360(east);
        if (a <= b) {
            ranges.push([a, b]);
        } else {
            // The segment itself crosses the seam in 0..360 (e.g. -10..10 -> 350..10).
            ranges.push([a, 360], [0, b]);
        }
    }

    ranges.sort((left, right) => left[0] - right[0]);

    // Merge segments that touch or overlap, so a dateline box reads as ONE range.
    const merged: Array<[number, number]> = [];
    for (const range of ranges) {
        const previous = merged[merged.length - 1];
        if (previous && range[0] <= previous[1]) {
            previous[1] = Math.max(previous[1], range[1]);
        } else {
            merged.push([range[0], range[1]]);
        }
    }
    return merged;
}

/**
 * Whether a point lies inside a box. Latitude and longitude bounds are both
 * **inclusive**, so `(0, 160)` is in Niño 4 and `(0, 159.9)` is not.
 */
export function boxContainsPoint(
    box: NinoBox,
    lat: number,
    lon: number,
): boolean {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    if (lat < box.latMin || lat > box.latMax) return false;
    const lon360 = toLon360(lon);
    return boxLon360Ranges(box).some(
        ([min, max]) => lon360 >= min && lon360 <= max,
    );
}
