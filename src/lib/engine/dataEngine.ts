/**
 * The one analytics contract both engines implement.
 *
 * History (timeline / analogs / summary) used to be unreachable unless DuckDB
 * had booted, which made the deferred and failed states dishonest: the app *had*
 * the 918 rows in the CSV it fetched, but showed nothing. This interface lets a
 * pure-TypeScript engine answer the same five questions, so every engine state
 * is truthful about what it can deliver.
 *
 * Result shapes are frozen to what duckdb.ts already returned (AnalyticsPayload,
 * ScenarioMetrics, AnalogMonth, HistoricalSummary, TimelinePoint). Nothing is
 * reshaped here — a caller cannot tell which engine answered.
 */

import type {
  AnalogMonth,
  AnalyticsPayload,
  HistoricalSummary,
  ScenarioMetrics,
  ScenarioState,
  TimelinePoint,
} from '@/types/enso';

/**
 * The five queries the HUD depends on.
 *
 * Each is a discrete question rather than one blob, because the golden-parity
 * harness compares them individually — a single `run()` would make a mismatch in
 * the analog ordering indistinguishable from one in the summary.
 */
export interface DataEngine {
  /** Identifier for diagnostics: 'duckdb' | 'ts'. */
  readonly kind: 'duckdb' | 'ts';

  /** Scenario metrics: metrics SQL + risk tier. */
  scenario(state: ScenarioState): Promise<ScenarioMetrics>;

  /** Nearest historical months by |anomaly - sst|. */
  analogs(sstAnomaly: number): Promise<AnalogMonth[]>;

  /** Aggregate history statistics. */
  summary(sstAnomaly: number): Promise<HistoricalSummary>;

  /** Full dataset timeline, ascending by date. */
  timeline(): Promise<TimelinePoint[]>;

  /** Risk tier string for an SST anomaly. */
  riskTier(sstAnomaly: number): Promise<string>;

  /** Convenience: everything the HUD needs in one call. */
  run(state: ScenarioState): Promise<AnalyticsPayload>;
}

/**
 * `delta` tolerance for analog matching.
 *
 * Mirrors `SUMMARY_SQL`'s `abs(nino_34_anomaly - ?) <= 0.35` window so the
 * "N months within ±0.35°C" figure agrees between engines. Exported because the
 * golden harness and the summary implementation must share exactly one value.
 */
export const ANALOG_WINDOW = 0.35;

/** Number of analog rows returned. Mirrors `ANALOG_SQL`'s LIMIT. */
export const ANALOG_LIMIT = 6;

/**
 * Formats an ISO date (`YYYY-MM-DD`) as the `%Y-%m` month key DuckDB's
 * `strftime(date, '%Y-%m')` produces.
 *
 * Deliberately string slicing, not `new Date(...)`: constructing a Date from a
 * date-only string parses as UTC midnight, and formatting it back in a negative
 * timezone can shift the month. Slicing cannot.
 */
export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** `TimelinePoint.label` is the period with a space, e.g. "2015 11". */
export function periodLabel(period: string): string {
  return period.replace('-', ' ');
}

/**
 * Deterministic analog ordering.
 *
 * SQL: `ORDER BY delta ASC, date DESC LIMIT 6`.
 *
 * The `date` tie-break is mandatory for parity: several months share the same
 * rounded |delta| (many are exactly 0.01 apart), and without a secondary key the
 * two engines could return different months in a different order from identical
 * data. DESC on date, matching the SQL.
 */
export function sortAnalogs<
  T extends { date: string; delta: number },
>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.delta !== b.delta) return a.delta - b.delta;
    // Descending date: later month first, matching ORDER BY date DESC.
    return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  });
}

/**
 * `avg()` in DuckDB is a plain mean over doubles. Kept as a named helper so the
 * summary implementation documents the correspondence rather than inlining it.
 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * `arg_max(date, nino_34_anomaly)`: the date at which the anomaly is largest.
 *
 * Ties resolve to the FIRST occurrence, matching DuckDB's arg_max behaviour for
 * equal maxima (it keeps the first). Rows arrive in ascending date order, so a
 * strict `>` comparison preserves that.
 */
export function argMaxDate(rows: Array<{ date: string; value: number }>): string {
  if (rows.length === 0) return '';
  let best = rows[0];
  for (const row of rows) {
    if (row.value > best.value) best = row;
  }
  return best.date;
}
