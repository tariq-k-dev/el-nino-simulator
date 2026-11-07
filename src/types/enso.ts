/** Shared domain types for the simulation. */

export type RegionId =
  | "pacific"
  | "us-west"
  | "se-asia"
  | "horn-africa"
  | "amazon-basin"
  | "gulf-coast"

export interface RegionDefinition {
  id: RegionId
  name: string
  shortName: string
  lat: number
  lon: number
  /** Camera distance multiplier used when focusing this region. */
  zoom: number
  accent: string
  summary: string
  mechanism: string
}

/** Raw output of the scenario SQL (base model + modifiers applied). */
export interface ScenarioMetrics {
  sst: number
  jet: number
  agri: number

  pacificSstDev: number
  pacificConvection: number

  usPrecip: number
  usPrecipBase: number
  usTempDevF: number

  asiaPrecip: number
  asiaDrought: number

  africaPrecip: number
  africaFlood: number

  amazonPrecip: number
  amazonDrought: number

  gulfPrecip: number

  globalImpactIndex: number
  agricultureExposure: number
  riskTier: string
}

/** A historical month from the parquet that most closely matches the scenario. */
export interface AnalogMonth {
  date: string
  label: string
  anomaly: number
  /** Observed absolute SST for the month (°C) from the CPC ERSSTv5 record. */
  absoluteSst: number
  delta: number
  sstDeviation: number
  precipPacific: number
  precipUs: number
  precipSeAsia: number
  precipAfrica: number
  /**
   * Amazon and Gulf Coast anomalies. Optional because the columns were added to
   * the dataset after the first fixtures were written; the drawer does not read
   * them, but the analog query returns them so a future panel can.
   */
  precipAmazon?: number
  precipGulf?: number
  droughtIndex: number
  riskTier: string
}

export interface HistoricalSummary {
  rowCount: number
  firstDate: string
  lastDate: string
  meanAnomaly: number
  maxAnomaly: number
  maxAnomalyDate: string
  analogCount: number
  extremeMonths: number
  laninaMonths: number
  /** Provenance string from the parquet, e.g. "NOAA CPC ERSSTv5 (1991-2020 base)". */
  source: string
}

export interface TimelinePoint {
  date: string
  label: string
  anomaly: number
}

export interface AnalyticsPayload {
  metrics: ScenarioMetrics
  analogs: AnalogMonth[]
  summary: HistoricalSummary
  timeline: TimelinePoint[]
  queryMs: number
}

export type UnitSystem = "metric" | "imperial"

export interface ScenarioState {
  sstAnomaly: number
  jetStreamShift: number
  agricultureWeight: number
}

export interface LiveTaoReading {
  timestamp: string
  nino34_sst: number
  anomaly: number
  status: "active" | "estimated" | "fallback"
}

export interface LiveRegionPrecip {
  precipDevPct: number
  precipMm: number
  status: "active" | "estimated" | "fallback"
}

export interface LivePrecipReading {
  timestamp: string
  regions: Record<string, LiveRegionPrecip>
  status: "active" | "estimated" | "fallback"
}

export interface LiveAtmosphericRiverReading {
  timestamp: string
  category: 1 | 2 | 3 | 4 | 5
  categoryName: "Weak" | "Moderate" | "Strong" | "Extreme" | "Exceptional"
  maxIvt: number
  coastalRiskTier: "Low" | "Guarded" | "Elevated" | "Severe" | "Extreme"
  status: "active" | "estimated" | "fallback"
}

export interface TelemetryBundle {
  timestamp: string
  tao: LiveTaoReading
  precip: LivePrecipReading
  ar: LiveAtmosphericRiverReading
}
