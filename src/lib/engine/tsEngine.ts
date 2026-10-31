/**
 * Pure-TypeScript DataEngine.
 *
 * Answers all five queries from rows already in memory, so history and analogs
 * work in the deferred / failed / saveData states where DuckDB has not booted.
 *
 * Every query here is a deliberate one-for-one mirror of the SQL in duckdb.ts,
 * because tests/fixtures/engine-golden.json (generated from DuckDB) is asserted
 * against this engine within 1e-9 relative tolerance. The comments name the SQL
 * clause being reproduced; if a query changes, both sides change together.
 */

import type {
  AnalogMonth,
  AnalyticsPayload,
  HistoricalSummary,
  ScenarioMetrics,
  ScenarioState,
  TimelinePoint,
} from '@/types/enso';
import { computeMetrics } from '@/lib/model';
import { maxOf } from '@/lib/look/helpers';
import type { HistoricalRow } from '@/lib/data/parse';
import {
  ANALOG_LIMIT,
  ANALOG_WINDOW,
  argMaxDate,
  mean,
  monthKey,
  periodLabel,
  sortAnalogs,
  type DataEngine,
} from '@/lib/engine/dataEngine';
import { round } from '@/lib/model';

/**
 * Rounding for summary statistics.
 *
 * Uses model.ts's `round`, which now implements halves-away-from-zero to match
 * DuckDB's `round(double, n)`. That matters concretely: JS `Math.round` ties
 * toward +Infinity, so -46.15 rounds to -46.1 instead of DuckDB's -46.2 — a
 * discrepancy the golden fixture caught in `asia_precip` before this was fixed.
 * Sharing one helper means the scenario and summary paths cannot drift apart.
 */
const r3 = (v: number): number => round(v, 3);

export interface TsEngineOptions {
  /** Parsed rows, ascending by date. */
  rows: HistoricalRow[];
}

export function createTsEngine({ rows }: TsEngineOptions): DataEngine {
  // Defensive copy sorted by date. The loader already yields ascending order, but
  // several queries below depend on it (argMax tie-break, timeline order), so it
  // is asserted rather than assumed.
  const ordered: HistoricalRow[] = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const anomalies = ordered.map((row) => row.nino_34_anomaly);
  const source = ordered.length > 0 ? ordered[0].source : '';

  const summaryFor = (sstAnomaly: number): HistoricalSummary => ({
    // count(*)
    rowCount: ordered.length,
    // strftime(min(date), '%Y-%m') / max(...)
    firstDate: ordered.length > 0 ? monthKey(ordered[0].date) : '',
    lastDate: ordered.length > 0 ? monthKey(ordered[ordered.length - 1].date) : '',
    // round(avg(nino_34_anomaly), 3)
    meanAnomaly: r3(mean(anomalies)),
    // round(max(nino_34_anomaly), 3)
    maxAnomaly: r3(maxOf(anomalies)),
    // strftime(arg_max(date, nino_34_anomaly), '%Y-%m')
    maxAnomalyDate: monthKey(
      argMaxDate(ordered.map((row) => ({ date: row.date, value: row.nino_34_anomaly }))),
    ),
    // count(*) FILTER (WHERE abs(nino_34_anomaly - ?) <= 0.35)
    analogCount: anomalies.filter((a) => Math.abs(a - sstAnomaly) <= ANALOG_WINDOW).length,
    // count(*) FILTER (WHERE nino_34_anomaly >= 2.0)
    extremeMonths: anomalies.filter((a) => a >= 2.0).length,
    // count(*) FILTER (WHERE nino_34_anomaly <= -0.5)
    laninaMonths: anomalies.filter((a) => a <= -0.5).length,
    // any_value(source)
    source,
  });

  const timelineFor = (): TimelinePoint[] =>
    ordered.map((row) => ({
      date: monthKey(row.date),
      label: periodLabel(monthKey(row.date)),
      anomaly: row.nino_34_anomaly,
    }));

  const analogsFor = (sstAnomaly: number): AnalogMonth[] => {
    // SELECT ..., abs(nino_34_anomaly - ?) AS delta
    const candidates = ordered.map((row) => ({
      row,
      // The sort key is the row's own ISO date, so the tie-break is available to
      // sortAnalogs without reshaping the row.
      date: row.date,
      // Unrounded delta: ORDER BY operates on the raw expression, not the
      // displayed value. Rounding before sorting would change which months win.
      delta: Math.abs(row.nino_34_anomaly - sstAnomaly),
    }));

    // ORDER BY delta ASC, date DESC LIMIT 6
    return sortAnalogs(candidates)
      .slice(0, ANALOG_LIMIT)
      .map(({ row }) => {
        const period = monthKey(row.date);
        return {
          date: period,
          label: periodLabel(period),
          anomaly: row.nino_34_anomaly,
          absoluteSst: row.nino34_sst,
          delta: Math.abs(row.nino_34_anomaly - sstAnomaly),
          sstDeviation: row.sst_deviation,
          precipPacific: row.precip_anomaly_pacific,
          precipUs: row.precip_anomaly_us,
          precipSeAsia: row.precip_anomaly_se_asia,
          precipAfrica: row.precip_anomaly_africa,
          droughtIndex: row.drought_index_se_asia,
          riskTier: row.risk_tier_pacific,
        };
      });
  };

  return {
    kind: 'ts',

    async scenario(state: ScenarioState): Promise<ScenarioMetrics> {
      // model.ts IS the scenario query: computeMetrics mirrors SCENARIO_SQL and
      // RISK_TIER_SQL, including rounding and clamping.
      return computeMetrics(state);
    },

    async analogs(sstAnomaly: number): Promise<AnalogMonth[]> {
      return analogsFor(sstAnomaly);
    },

    async summary(sstAnomaly: number): Promise<HistoricalSummary> {
      return summaryFor(sstAnomaly);
    },

    async timeline(): Promise<TimelinePoint[]> {
      return timelineFor();
    },

    async riskTier(sstAnomaly: number): Promise<string> {
      // RISK_TIER_SQL is a pure CASE ladder; computeMetrics already applies it.
      return computeMetrics({
        sstAnomaly,
        jetStreamShift: 0,
        agricultureWeight: 0,
      }).riskTier;
    },

    async run(state: ScenarioState): Promise<AnalyticsPayload> {
      const started = performance.now();
      // Computed synchronously; the async signature keeps it interchangeable
      // with the DuckDB engine at every call site.
      const metrics = computeMetrics(state);

      return {
        metrics,
        analogs: analogsFor(state.sstAnomaly),
        summary: summaryFor(state.sstAnomaly),
        timeline: timelineFor(),
        queryMs: Math.round((performance.now() - started) * 10) / 10,
      };
    },
  };
}
