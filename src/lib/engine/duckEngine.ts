/**
 * DuckEngine — the existing DuckDB implementation behind the DataEngine contract.
 *
 * This is a thin adapter, not a reimplementation: it delegates to runScenario and
 * the query helpers already in src/lib/duckdb.ts, so there is exactly one copy of
 * each SQL statement in the codebase. Result shapes are unchanged.
 *
 * The one behavioural change is data delivery: instead of registering the CSV by
 * URL (which made DuckDB download it a second time), the engine accepts the text
 * the loader already fetched and registers that with registerFileText. Same
 * bytes, one request.
 */

import type {
  AnalogMonth,
  AnalyticsPayload,
  HistoricalSummary,
  ScenarioMetrics,
  ScenarioState,
  TimelinePoint,
} from '@/types/enso';
import type { DataEngine } from '@/lib/engine/dataEngine';
import { runScenario, type AnalyticsCache, type BootMode } from '@/lib/duckdb';

export interface DuckEngineOptions {
  /**
   * CSV text already fetched by loadDataset(). Avoids a second network request.
   * Null when the dataset was unavailable — the scenario queries still work, and
   * the history queries will reject because `hasHistory` is false.
   */
  datasetText: string | null;
  mode?: BootMode;
  cache?: AnalyticsCache;
}

export function createDuckEngine(opts: DuckEngineOptions): DataEngine {
  return {
    kind: 'duckdb',

    async scenario(state: ScenarioState): Promise<ScenarioMetrics> {
      // runScenario already computes metrics + risk tier in two parallel queries.
      const payload = await runScenario(state, opts.cache, opts.mode, opts.datasetText);
      return payload.metrics;
    },

    async analogs(sstAnomaly: number): Promise<AnalogMonth[]> {
      const payload = await runScenario(
        { sstAnomaly, jetStreamShift: 0, agricultureWeight: 0 },
        opts.cache,
        opts.mode,
        opts.datasetText,
      );
      return payload.analogs;
    },

    async summary(sstAnomaly: number): Promise<HistoricalSummary> {
      const payload = await runScenario(
        { sstAnomaly, jetStreamShift: 0, agricultureWeight: 0 },
        opts.cache,
        opts.mode,
        opts.datasetText,
      );
      return payload.summary;
    },

    async timeline(): Promise<TimelinePoint[]> {
      const payload = await runScenario(
        { sstAnomaly: 0, jetStreamShift: 0, agricultureWeight: 0 },
        opts.cache,
        opts.mode,
        opts.datasetText,
      );
      return payload.timeline;
    },

    async riskTier(sstAnomaly: number): Promise<string> {
      const payload = await runScenario(
        { sstAnomaly, jetStreamShift: 0, agricultureWeight: 0 },
        opts.cache,
        opts.mode,
        opts.datasetText,
      );
      return payload.metrics.riskTier;
    },

    async run(state: ScenarioState): Promise<AnalyticsPayload> {
      return runScenario(state, opts.cache, opts.mode, opts.datasetText);
    },
  };
}
