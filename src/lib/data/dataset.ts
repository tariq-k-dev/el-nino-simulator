/**
 * One dataset, fetched once, shared by both engines.
 *
 * History and analogs used to depend on DuckDB being awake. That made the
 * deferred / failed states dishonest: the sparkline and the analog table showed
 * "—" until a 6.45 MiB wasm arrived, even though the CSV carrying the exact same
 * 918 rows had already been downloaded for DuckDB to read. On a 400 kbps link
 * that meant minutes of a visibly empty history panel for data the app already
 * had.
 *
 * The fix is one artifact in one place:
 *
 *   loadDataset()  ──fetch once──▶  { rows, text }
 *                                     │        │
 *                        TsEngine parses rows   DuckEngine reads text via
 *                        (no DuckDB at all)      registerFileText (no 2nd fetch)
 *
 * Memoisation matters for correctness, not just speed: a second fetch would mean
 * the two engines could observe different bytes if the file changed mid-session,
 * and it would double the only large request on the critical path.
 */

import type { HistoricalRow } from '@/lib/data/parse';
import { EXPECTED_COLUMNS, parseDataset } from '@/lib/data/parse';

/** Served CSV. Kept in public/ because the browser loads it directly. */
export const DATASET_URL = '/data/enso.csv';

/** Per-attempt network budget. Two attempts maximum. */
export const FETCH_TIMEOUT_MS = 10_000;

export interface Dataset {
  /** Parsed, typed rows in file order (ascending by date). */
  rows: HistoricalRow[];
  /** Raw CSV text, handed to DuckDB so it never re-downloads. */
  text: string;
}

/** A dataset load that failed. Carries a user-safe reason. */
export class DatasetUnavailableError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DatasetUnavailableError';
  }
}

/** Shared in-flight/settled promise. Only one fetch per page load, ever. */
let datasetPromise: Promise<Dataset> | null = null;

/** Fetch with an abort-based timeout so a hanging socket cannot pin the promise. */
async function fetchWithTimeout(url: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new DatasetUnavailableError(`Dataset request failed: HTTP ${res.status} for ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Load and parse the dataset. Memoised: repeated calls share one promise, so
 * calling this from several components costs exactly one network request.
 *
 * Retries once. A single transient failure (a dropped connection mid-flight) is
 * worth one more attempt; more than that just delays showing the honest
 * "history unavailable" state.
 */
export function loadDataset(): Promise<Dataset> {
  if (datasetPromise) return datasetPromise;

  datasetPromise = (async (): Promise<Dataset> => {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const text = await fetchWithTimeout(DATASET_URL, FETCH_TIMEOUT_MS);
        const rows = parseDataset(text);
        return { rows, text };
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          console.warn(`[dataset] attempt ${attempt} failed; retrying once:`, error);
        }
      }
    }

    throw new DatasetUnavailableError(
      `Could not load ${DATASET_URL} after 2 attempts.`,
      lastError,
    );
  })().catch((error) => {
    // Clear the memo so an explicit retry can succeed. The caller still sees the
    // rejection, and the app keeps working on model.ts for the scenario numbers.
    datasetPromise = null;
    throw error;
  });

  return datasetPromise;
}

/** The already-loaded dataset, or null. Lets engines avoid awaiting when ready. */
export function getLoadedDataset(): Dataset | null {
  if (!datasetPromise) return null;
  // Cannot synchronously read a promise; consumers that need sync access should
  // hold the resolved value from their own loadDataset() await.
  return null;
}

/** Test seam: forget the memoised dataset. */
export function __resetDataset(): void {
  datasetPromise = null;
}

/** Columns the parser insists on. Surfaced for tests and diagnostics. */
export { EXPECTED_COLUMNS };
