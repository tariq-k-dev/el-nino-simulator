import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnalyticsPayload, ScenarioState, UnitSystem } from '@/types/enso';
import {
  getActiveWasmHost,
  runScenario,
  runScenarioFallback,
  type AnalyticsCache,
} from '@/lib/duckdb';
import { computeMetrics, AGRI_DEFAULT, JET_DEFAULT, SST_DEFAULT } from '@/lib/model';

export type EngineStatus = 'booting' | 'ready' | 'fallback' | 'running';

export interface ScenarioHandle {
  scenario: ScenarioState;
  setScenario: (patch: Partial<ScenarioState>) => void;
  reset: () => void;
  analytics: AnalyticsPayload;
  status: EngineStatus;
  engineLabel: string;
  units: UnitSystem;
  toggleUnits: () => void;
}

const INITIAL: ScenarioState = {
  sstAnomaly: SST_DEFAULT,
  jetStreamShift: JET_DEFAULT,
  agricultureWeight: AGRI_DEFAULT,
};

/** Immediate, zero-latency metrics so the UI never waits on the engine. */
function optimistic(state: ScenarioState): AnalyticsPayload {
  return {
    metrics: computeMetrics(state),
    analogs: [],
    summary: {
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
    timeline: [],
    queryMs: 0,
  };
}

export function useScenario(): ScenarioHandle {
  const [scenario, setScenarioState] = useState<ScenarioState>(INITIAL);
  const [analytics, setAnalytics] = useState<AnalyticsPayload>(() => optimistic(INITIAL));
  const [status, setStatus] = useState<EngineStatus>('booting');
  const [units, setUnits] = useState<UnitSystem>('metric');
  const [engineVersion, setEngineVersion] = useState<string>('');

  const cacheRef = useRef<AnalyticsCache>({});
  const requestId = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard against React 18 StrictMode double-invocation racing the boot.
  const bootedRef = useRef(false);

  const setScenario = useCallback((patch: Partial<ScenarioState>) => {
    setScenarioState((prev) => {
      const next = { ...prev, ...patch };
      // Paint the numbers synchronously — this is what makes the sliders feel
      // weightless even while DuckDB is still working.
      setAnalytics((old) => ({
        ...old,
        metrics: computeMetrics(next),
      }));
      return next;
    });
  }, []);

  const reset = useCallback(() => setScenarioState(INITIAL), []);

  useEffect(() => {
    let cancelled = false;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    setStatus((prev) => (prev === 'booting' ? prev : 'running'));

    debounceRef.current = setTimeout(async () => {
      const id = ++requestId.current;
      try {
        const payload = await runScenario(scenario, cacheRef.current);
        if (cancelled || id !== requestId.current) return;
        setAnalytics(payload);
        setStatus('ready');
        // Surface which CDN actually served the wasm, so a fallback to unpkg is
        // visible in the UI instead of only in the console.
        setEngineVersion(() => {
          const host = getActiveWasmHost();
          return host ? `DuckDB-WASM · ${host}` : 'DuckDB-WASM';
        });
      } catch (error) {
        if (cancelled || id !== requestId.current) return;
        console.error('[duckdb] scenario query failed:', error);
        if (!bootedRef.current) {
          // First boot failed — degrade to the pure-TS path rather than dying.
          setAnalytics(runScenarioFallback(scenario, analytics.timeline));
          setStatus('fallback');
          setEngineVersion('client-side model');
        } else {
          setStatus('ready');
        }
      }
      bootedRef.current = true;
    }, 40);

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario]);

  const engineLabel = useMemo(() => {
    switch (status) {
      case 'booting':
        return 'Booting engine…';
      case 'running':
        return 'Querying…';
      case 'fallback':
        // Name the cause: the app still works, but the user should know the
        // analytics engine is degraded and why.
        return 'Client-side model (CDN unreachable)';
      default:
        return `${engineVersion || 'DuckDB-WASM'} · ${analytics.queryMs.toFixed(1)} ms`;
    }
  }, [status, engineVersion, analytics.queryMs]);

  return {
    scenario,
    setScenario,
    reset,
    analytics,
    status,
    engineLabel,
    units,
    toggleUnits: () => setUnits((u) => (u === 'metric' ? 'imperial' : 'metric')),
  };
}
