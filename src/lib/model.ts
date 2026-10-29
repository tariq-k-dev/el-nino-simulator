/**
 * Scenario math model — the single source of truth for every number the UI shows.
 *
 * Base equations come from the brief:
 *   Equatorial Pacific: SST Dev  = sst * 1.15 ; Convection Shift = min(100, sst * 35)
 *   Western US:         Precip   = +15 + sst * 18 (%)      ; Temp Dev = -0.5 - sst * 0.8 (°F)
 *   SE Asia:            Precip   = -10 - sst * 22 (%)      ; Drought  = sst * 3.2
 *   Horn of Africa:     Precip   = +20 + sst * 25 (%)      ; Flood    = sst * 2.8
 *
 * Two secondary levers modulate those bases:
 *   jetStreamShift  (-1 .. +1)  — displacement of the subtropical jet. A poleward
 *                                 shift (+1) dries the US west coast and deepens the
 *                                 SE Asia drought; an equatorward shift (-1) does the opposite.
 *   agricultureWeight (0 .. 1) — how much of the regional precip anomaly actually
 *                                 lands on cropland. Scales exposure, never the climate signal.
 *
 * Everything here is pure so it can be mirrored exactly in DuckDB SQL (see duckdb.ts)
 * and asserted in model.test.ts.
 */

import type { RegionId, ScenarioMetrics, ScenarioState } from '@/types/enso';
import { fixed, signed } from '@/lib/format';

export const SST_MIN = 0;
export const SST_MAX = 3;
export const SST_DEFAULT = 1.5;

export const JET_MIN = -1;
export const JET_MAX = 1;
export const JET_DEFAULT = 0.35;

export const AGRI_MIN = 0;
export const AGRI_MAX = 1;
export const AGRI_DEFAULT = 0.6;

/** Jet-stream coupling constants. Tuned so ±1 shifts the US precip by ±12 pts. */
const JET_US_COUPLING = 12;
const JET_ASIA_COUPLING = 9;
const JET_AFRICA_COUPLING = -4;
const JET_TEMP_COUPLING = 0.6;

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Round half away from zero, matching DuckDB's `round(double, n)`.
 *
 * JS `Math.round` rounds halves toward +Infinity, so on an exact tie the two
 * disagree for negative values: round(-46.15, 1) is -46.2 in DuckDB but -46.1
 * with Math.round. That is not hypothetical — `asia_precip` at sst=1.5, jet=0.35
 * evaluates to exactly -46.15, and the golden fixture (generated from DuckDB)
 * caught the mismatch.
 *
 * Halves away from zero is the standard `round()` behaviour in SQL engines and
 * matches the fixture, so the two engines now agree on ties as well as on
 * everything else.
 */
export const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  const scaled = value * factor;
  // `Math.round(-0.5)` is -0, so use abs + sign to force halves away from zero.
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled));
  // `|| 0` normalises -0 to 0 so deep equality and JSON stay clean.
  return (rounded / factor) || 0;
};

/** Thermal colour ramp: cool cyan (0°C) → amber → searing red (3°C). */
export function thermalColor(sst: number, alpha = 1): string {
  const t = clamp(sst / SST_MAX, 0, 1);
  // three-stop ramp: #22d3ee → #fbbf24 → #ef4444
  const stops = [
    { at: 0, rgb: [34, 211, 238] },
    { at: 0.5, rgb: [251, 191, 36] },
    { at: 1, rgb: [239, 68, 68] },
  ];
  const upper = stops.find((s) => t <= s.at) ?? stops[stops.length - 1];
  const lower = stops[Math.max(0, stops.indexOf(upper) - 1)];
  const span = upper.at - lower.at || 1;
  const k = (t - lower.at) / span;
  const rgb = lower.rgb.map((c, i) => Math.round(c + (upper.rgb[i] - c) * k));
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/** Numeric thermal ramp for WebGL uniforms (0..1 = cyan..red via amber). */
export function thermalVector(sst: number): [number, number, number] {
  const t = clamp(sst / SST_MAX, 0, 1);
  const stops: Array<[number, [number, number, number]]> = [
    [0, [0.133, 0.827, 0.933]],
    [0.5, [0.984, 0.749, 0.141]],
    [1, [0.937, 0.267, 0.267]],
  ];
  const upperIdx = stops.findIndex(([at]) => t <= at);
  const uIdx = upperIdx === -1 ? stops.length - 1 : upperIdx;
  const [ua, uc] = stops[uIdx];
  const [la, lc] = stops[Math.max(0, uIdx - 1)];
  const span = ua - la || 1;
  const k = (t - la) / span;
  return [
    lc[0] + (uc[0] - lc[0]) * k,
    lc[1] + (uc[1] - lc[1]) * k,
    lc[2] + (uc[2] - lc[2]) * k,
  ];
}

export function riskTier(sst: number): string {
  if (sst < 0.5) return 'Neutral / La Niña Watch';
  if (sst < 1.0) return 'Weak Warm Phase';
  if (sst < 1.5) return 'Moderate El Niño';
  if (sst < 2.0) return 'Strong El Niño';
  if (sst < 2.6) return 'Super El Niño';
  return 'Extreme Mega-El Niño';
}

export function computeMetrics(state: ScenarioState): ScenarioMetrics {
  const sst = clamp(state.sstAnomaly, SST_MIN, SST_MAX);
  const jet = clamp(state.jetStreamShift, JET_MIN, JET_MAX);
  const agri = clamp(state.agricultureWeight, AGRI_MIN, AGRI_MAX);

  // --- Equatorial Pacific (Niño 3.4) ---
  const pacificSstDev = sst * 1.15;
  const pacificConvection = Math.min(100, sst * 35);

  // --- Western US / California ---
  const usPrecipBase = 15 + sst * 18;
  const usPrecip = usPrecipBase + jet * JET_US_COUPLING;
  const usTempDevF = -0.5 - sst * 0.8 - jet * JET_TEMP_COUPLING;

  // --- Southeast Asia & Indonesia ---
  const asiaPrecip = -10 - sst * 22 - jet * JET_ASIA_COUPLING;
  const asiaDrought = clamp(sst * 3.2 * (1 + jet * 0.15), 0, 10);

  // --- Horn of Africa ---
  const africaPrecip = 20 + sst * 25 + jet * JET_AFRICA_COUPLING;
  const africaFlood = clamp(sst * 2.8, 0, 10);

  // --- Composite indices ---
  // Mean absolute regional precipitation anomaly, normalised against a 60% swing.
  const globalImpactIndex = round(
    clamp(
      ((Math.abs(usPrecip) + Math.abs(asiaPrecip) + Math.abs(africaPrecip)) / 3 / 60) * 100,
      0,
      100,
    ),
    1,
  );

  // Agriculture exposure blends the drought and flood extremes with the cropland weight.
  const agricultureExposure = round(
    clamp((asiaDrought / 10) * 0.5 + (africaFlood / 10) * 0.3 + (pacificConvection / 100) * 0.2, 0, 1) *
      (0.55 + agri * 0.45) *
      100,
    1,
  );

  return {
    sst: round(sst, 2),
    jet: round(jet, 2),
    agri: round(agri, 2),
    pacificSstDev: round(pacificSstDev, 2),
    pacificConvection: round(pacificConvection, 1),
    usPrecip: round(usPrecip, 1),
    usPrecipBase: round(usPrecipBase, 1),
    usTempDevF: round(usTempDevF, 2),
    asiaPrecip: round(asiaPrecip, 1),
    asiaDrought: round(asiaDrought, 2),
    africaPrecip: round(africaPrecip, 1),
    africaFlood: round(africaFlood, 2),
    globalImpactIndex,
    agricultureExposure,
    riskTier: riskTier(sst),
  };
}

/** The headline metric per region, in display order, for cards and the HUD. */
export function regionHeadline(metrics: ScenarioMetrics, region: RegionId): string {
  // `signed` prints "+x" / "-x" / "0" — never "+0.00" and never "-0.00".
  // A hardcoded "+" prefix printed "+0.00" at strength 0, and once the value
  // became -0 it printed "+-0.00".
  switch (region) {
    case 'pacific':
      return `${signed(metrics.pacificSstDev, 2)}°C SST dev`;
    case 'us-west':
      return `${signed(metrics.usPrecip, 1)}% precip`;
    case 'se-asia':
      return `${fixed(metrics.asiaPrecip, 1)}% precip`;
    case 'horn-africa':
      return `${signed(metrics.africaPrecip, 1)}% precip`;
  }
}
