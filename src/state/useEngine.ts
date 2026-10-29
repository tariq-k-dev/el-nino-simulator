import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadDataset, type Dataset } from '@/lib/data/dataset';
import { useEngineStatus } from '@/lib/engine/store';
import { createTsEngine } from '@/lib/engine/tsEngine';
import { createDuckEngine } from '@/lib/engine/duckEngine';
import type { DataEngine } from '@/lib/engine/dataEngine';

/**
 * History availability.
 *
 * Distinct from the engine state on purpose: history is a property of the DATA,
 * not of DuckDB. Once the CSV is parsed, history works in every engine state —
 * deferred, failed, saveData, or mid-boot. Only a dataset fetch failure makes it
 * unavailable.
 */
export type HistoryState =
  | { status: 'loading' }
  | { status: 'ready'; dataset: Dataset }
  | { status: 'unavailable'; error: string };

export interface EngineHandle {
  /** Which engine is answering right now: 'ts' until DuckDB is ready. */
  engine: DataEngine | null;
  history: HistoryState;
  /** Re-attempt the dataset fetch after a failure. */
  retryDataset: () => void;
}

/**
 * Owns the single dataset fetch and the DataEngine that should answer queries.
 *
 * The dataset is loaded immediately on mount, independent of DuckDB, so the
 * sparkline, the "N mo" counter and the analog table populate within the fetch
 * time on every profile — including saveData and a 400 kbps early abort, where
 * DuckDB may never boot at all.
 *
 * Engine selection: the TS engine answers until the store says `ready`, then the
 * DuckDB engine takes over. Both read from the same parsed rows / CSV text.
 */
export function useEngine(): EngineHandle {
  const engineStatus = useEngineStatus();
  const [history, setHistory] = useState<HistoryState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  // Tracks whether the component is still mounted, so a slow fetch cannot set
  // state after unmount.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    loadDataset()
      .then((dataset) => {
        if (cancelled || !alive.current) return;
        // The TS engine works from parsed rows alone — no wasm, no worker.
        setHistory({ status: 'ready', dataset });
      })
      .catch((error: unknown) => {
        if (cancelled || !alive.current) return;
        console.warn('[dataset] history unavailable:', error);
        setHistory({
          status: 'unavailable',
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retryDataset = useCallback(() => {
    // loadDataset() memoises, and clears its memo on failure, so a plain re-call
    // is enough; the attempt bump re-runs the effect that consumes it.
    setHistory({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  const dataset = history.status === 'ready' ? history.dataset : null;
  const duckReady = engineStatus.phase === 'ready';

  // One engine instance per (dataset, mode). Derived, never mutated during render,
  // so StrictMode's double-render cannot produce two different engines.
  const engine = useMemo<DataEngine | null>(() => {
    if (!dataset) return null;
    if (duckReady) {
      // DuckDB reads the already-fetched CSV text, so there is no second request.
      return createDuckEngine({ datasetText: dataset.text });
    }
    return createTsEngine({ rows: dataset.rows });
  }, [dataset, duckReady]);

  return { engine, history, retryDataset };
}
