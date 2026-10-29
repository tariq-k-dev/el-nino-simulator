import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnalyticsPayload, ScenarioState, UnitSystem } from '@/types/enso';
import { runScenario, type AnalyticsCache } from '@/lib/duckdb';
import { useEngineStatus, type EngineStatus as StoreStatus } from '@/lib/engine/store';
import { computeMetrics, AGRI_DEFAULT, JET_DEFAULT, SST_DEFAULT } from '@/lib/model';

/**
 * Derive the legacy status vocabulary from the engine store.
 *
 * The Header's status dot was written against a four-value union while the store
 * has a richer phase model. Mapping here keeps one source of truth — the store.
 * `deferred` and `failed` share the fallback colour because, from the user's
 * point of view, both mean "the numbers are coming from the TS model".
 */
export type EngineStatus = 'booting' | 'ready' | 'fallback' | 'running';

export interface ScenarioHandle {
  scenario: ScenarioState;
  setScenario: (patch: Partial<ScenarioState>) => void;
  reset: () => void;
  analytics: AnalyticsPayload;
  status: EngineStatus;
  units: UnitSystem;
  toggleUnits: () => void;
}

const INITIAL: ScenarioState = {
  sstAnomaly: SST_DEFAULT,
  jetStreamShift: JET_DEFAULT,
  agricultureWeight: AGRI_DEFAULT,
};

/** Map the engine store's phase onto the UI's status vocabulary. */
function toLegacyStatus(engine: StoreStatus, querying: boolean): EngineStatus {
  switch (engine.phase) {
    case 'ready':
      return querying ? 'running' : 'ready';
    case 'booting':
      return 'booting';
    case 'failed':
    case 'deferred':
      return 'fallback';
  }
}

/**
 * Immediate, zero-latency payload from the TS model.
 *
 * This is what renders until the engine is `ready`. model.ts and the scenario
 * SQL are asserted to agree by model.test.ts, so switching between them produces
 * identical metrics — the DuckDB path adds history and analogs, not different
 * arithmetic.
 */
function modelPayload(state: ScenarioState, previous?: AnalyticsPayload): AnalyticsPayload {
  return {
    metrics: computeMetrics(state),
    // History/analogs are 2C scope. Preserve whatever the engine last returned
    // rather than blanking the sparkline on every slider move.
    analogs: previous?.analogs ?? [],
    summary:
      previous?.summary ?? {
        rowCount: 0,
        firstDate: '—',
        lastDate: '—',
        meanAnomaly: 0,
        maxAnomaly: 0,
        maxAnomalyDate: '—',
        analogCount: 0,
        extremeMonths: 0,
        laninaMonths: 0,
        source: '—',
      },
    timeline: previous?.timeline ?? [],
    queryMs: previous?.queryMs ?? 0,
  };
}

export function useScenario(): ScenarioHandle {
  const engine = useEngineStatus();
  const [scenario, setScenarioState] = useState<ScenarioState>(INITIAL);
  const [analytics, setAnalytics] = useState<AnalyticsPayload>(() => modelPayload(INITIAL));
  const [units, setUnits] = useState<UnitSystem>('metric');
  const [querying, setQuerying] = useState(false);

  const cacheRef = useRef<AnalyticsCache>({});
  /**
   * Monotonic request id. A DuckDB round-trip can outlive a faster slider move,
   * so a stale result must never overwrite a newer one. Every dispatch
   * increments this; a response is applied only if its id is still current.
   */
  const requestId = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Bumped once when the engine becomes `ready`, so the current scenario is
   * recomputed exactly once against the real engine rather than once per state
   * change while booting.
   */
  const [epoch, setEpoch] = useState(0);
  const readySeen = useRef(false);

  const setScenario = useCallback((patch: Partial<ScenarioState>) => {
    setScenarioState((prev) => {
      const next = { ...prev, ...patch };
      // Paint from the TS model synchronously: the slider must feel weightless
      // even when the engine is booting or a query is in flight.
      setAnalytics((old) => modelPayload(next, old));
      return next;
    });
  }, []);

  const reset = useCallback(() => setScenarioState(INITIAL), []);

  // On the transition into `ready`, recompute once. Keyed on the phase so it
  // fires once per boot rather than on every render.
  useEffect(() => {
    if (engine.phase === 'ready' && !readySeen.current) {
      readySeen.current = true;
      setEpoch((e) => e + 1);
    }
    if (engine.phase === 'booting') {
      // A retry re-arms the one-shot recompute.
      readySeen.current = false;
    }
  }, [engine.phase]);

  // Run the scenario through DuckDB only when the engine is ready.
  useEffect(() => {
    if (engine.phase !== 'ready') {
      // Nothing to query; the TS model already painted the metrics.
      setQuerying(false);
      return;
    }

    let cancelled = false;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    setQuerying(true);
    debounceRef.current = setTimeout(async () => {
      const id = ++requestId.current;
      try {
        const payload = await runScenario(scenario, cacheRef.current);
        // Stale guard: a newer request (or an unmount) wins.
        if (cancelled || id !== requestId.current) return;
        setAnalytics(payload);
      } catch (error) {
        if (cancelled || id !== requestId.current) return;
        console.warn('[duckdb] scenario query failed; keeping model values:', error);
        setAnalytics((old) => modelPayload(scenario, old));
      } finally {
        if (!cancelled && id === requestId.current) setQuerying(false);
      }
    }, 40);

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // `epoch` is a dependency so the one-shot recompute on `ready` triggers this
    // effect even though `scenario` itself did not change.
  }, [scenario, epoch, engine.phase]);

  const status = useMemo(() => toLegacyStatus(engine, querying), [engine, querying]);

  return {
    scenario,
    setScenario,
    reset,
    analytics,
    status,
    units,
    toggleUnits: () => setUnits((u) => (u === 'metric' ? 'imperial' : 'metric')),
  };
}
