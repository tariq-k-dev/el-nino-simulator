import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadDataset, type Dataset } from '@/lib/data/dataset';
import { useEngineStatus } from '@/lib/engine/store';
import { createTsEngine } from '@/lib/engine/tsEngine';
import { createDuckEngine } from '@/lib/engine/duckEngine';
import { ensureHistoryTable } from '@/lib/duckdb';
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
        // If DuckDB already booted WITHOUT a history table (the CSV was blocked at
        // boot time), add the table now instead of forcing a wasm reboot. The
        // retry therefore recovers history without a page reload.
        void ensureHistoryTable();
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
  //
  // When the dataset is unavailable but DuckDB is ready, still hand over to the
  // DuckDB engine: its scenario and risk-tier queries do not touch the history
  // table, so the slider keeps working. Summary/analogs/timeline reject and
  // useScenario keeps the TS/model values for those. Boot must not be wasted
  // just because history is missing.
  const engine = useMemo<DataEngine | null>(() => {
    if (duckReady) {
      // datasetText may be null; the DuckDB engine falls back to a URL fetch only
      // if it needs the table, and by then it already knows hasHistory.
      return createDuckEngine({ datasetText: dataset?.text ?? null });
    }
    // No dataset and no DuckDB: nothing can answer anything yet.
    if (!dataset) return null;
    return createTsEngine({ rows: dataset.rows });
  }, [dataset, duckReady]);

  return { engine, history, retryDataset };
}
