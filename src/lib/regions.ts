import type { RegionDefinition, RegionId } from '@/types/enso';

/**
 * Hotspot coordinates are hand-placed on the national/regional centroid so the
 * pin readout matches where a viewer's eye expects it. `zoom` is a camera
 * distance in scene units (Earth radius = 1).
 */
export const REGIONS: RegionDefinition[] = [
  {
    id: 'pacific',
    name: 'Equatorial Pacific',
    shortName: 'Niño 3.4',
    lat: -2,
    lon: -150,
    zoom: 2.9,
    accent: '#38bdf8',
    summary: 'The engine room. Weakened trade winds pile warm water eastward along the equator.',
    mechanism:
      'SST deviation drives deep convection east of the dateline, displacing the Walker circulation and teleconnecting the entire global pattern.',
  },
  {
    id: 'us-west',
    name: 'Western US & California',
    shortName: 'California',
    lat: 37,
    lon: -120,
    zoom: 2.6,
    accent: '#a78bfa',
    summary: 'A southward-shifted subtropical jet funnels atmospheric rivers into the coast.',
    mechanism:
      'Extended Pacific jet stream carries tropical moisture north-east, raising precipitation and muting winter temperature extremes.',
  },
  {
    id: 'se-asia',
    name: 'Southeast Asia & Indonesia',
    shortName: 'Indonesia',
    lat: -3,
    lon: 112,
    zoom: 2.7,
    accent: '#fb923c',
    summary: 'Convection migrates away from the Maritime Continent — drought and fire risk climb.',
    mechanism:
      'Sinking motion replaces the usual rising branch of the Walker cell, suppressing monsoon rainfall and dropping groundwater recharge.',
  },
  {
    id: 'horn-africa',
    name: 'Horn of Africa',
    shortName: 'Horn of Africa',
    lat: 8,
    lon: 42,
    zoom: 2.7,
    accent: '#34d399',
    summary: 'A warmer western Indian Ocean feeds short rains, pushing flood risk sharply higher.',
    mechanism:
      'Cross-equatorial moisture flux intensifies during the October–December short-rains season, overwhelming normally arid catchments.',
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
export function latLonToVector3(lat: number, lon: number, radius = 1): [number, number, number] {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return [
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  ];
}

export function formatDelta(value: number, unit: string, digits = 1): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
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
export function tempDisplay(celsius: number, units: 'metric' | 'imperial'): { value: number; unit: string } {
  return units === 'imperial'
    ? { value: celsiusToFahrenheit(celsius), unit: '°F' }
    : { value: celsius, unit: '°C' };
}

/** Same, but for an anomaly/deviation rather than an absolute reading. */
export function deltaDisplay(
  celsiusDelta: number,
  units: 'metric' | 'imperial',
): { value: number; unit: string } {
  return units === 'imperial'
    ? { value: celsiusDeltaToFahrenheit(celsiusDelta), unit: '°F' }
    : { value: celsiusDelta, unit: '°C' };
}
