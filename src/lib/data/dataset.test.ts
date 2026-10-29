import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { __resetDataset, DatasetUnavailableError, loadDataset, DATASET_URL } from '@/lib/data/dataset';

/**
 * The memoisation here is a correctness requirement, not an optimisation: two
 * fetches could let the TS and DuckDB engines observe different bytes, and it
 * would double the only large request on the boot path. So the central assertion
 * is "exactly one fetch per page load, no matter how many callers".
 */

const CSV_TEXT = readFileSync(path.resolve(__dirname, '../../../public/data/enso.csv'), 'utf8');

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl);
  vi.stubGlobal('fetch', spy);
  return spy;
}

const okResponse = (body: string) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/csv' } });

describe('loadDataset', () => {
  beforeEach(() => {
    __resetDataset();
  });

  afterEach(() => {
    __resetDataset();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('fetches once and returns parsed rows plus the raw text', async () => {
    const spy = mockFetch(async () => okResponse(CSV_TEXT));

    const dataset = await loadDataset();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(DATASET_URL);
    expect(dataset.rows).toHaveLength(918);
    // The text is returned so DuckDB can registerFileText it — one fetch, two engines.
    expect(dataset.text).toBe(CSV_TEXT);
  });

  it('memoises: concurrent callers share ONE request', async () => {
    const spy = mockFetch(async () => okResponse(CSV_TEXT));

    const [a, b, c] = await Promise.all([loadDataset(), loadDataset(), loadDataset()]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('memoises sequentially: later calls do not refetch', async () => {
    const spy = mockFetch(async () => okResponse(CSV_TEXT));

    await loadDataset();
    await loadDataset();
    await loadDataset();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('retries exactly once on a transient failure, then succeeds', async () => {
    let call = 0;
    const spy = mockFetch(async () => {
      call += 1;
      if (call === 1) throw new TypeError('network died');
      return okResponse(CSV_TEXT);
    });

    const dataset = await loadDataset();

    expect(spy).toHaveBeenCalledTimes(2);
    expect(dataset.rows).toHaveLength(918);
  });

  it('gives up after two attempts and throws DatasetUnavailableError', async () => {
    const spy = mockFetch(async () => {
      throw new TypeError('offline');
    });

    await expect(loadDataset()).rejects.toBeInstanceOf(DatasetUnavailableError);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('treats a non-2xx response as a failure (and retries)', async () => {
    const spy = mockFetch(async () => new Response('nope', { status: 503 }));

    // The HTTP detail is preserved on `cause`; the caller-facing error is the
    // stable DatasetUnavailableError so UI code does not parse messages.
    const error = await loadDataset().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DatasetUnavailableError);
    expect(String((error as DatasetUnavailableError).cause)).toMatch(/HTTP 503/);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('clears the memo after failure so an explicit retry can succeed', async () => {
    let call = 0;
    const spy = mockFetch(async () => {
      call += 1;
      // First two attempts fail, third succeeds (after the memo was cleared).
      if (call <= 2) throw new TypeError('offline');
      return okResponse(CSV_TEXT);
    });

    await expect(loadDataset()).rejects.toBeInstanceOf(DatasetUnavailableError);
    const dataset = await loadDataset();

    expect(dataset.rows).toHaveLength(918);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('aborts a hanging request at the timeout instead of pinning the promise', async () => {
    vi.useFakeTimers();
    // Never resolves on its own; only the abort signal ends it.
    const spy = mockFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );

    const promise = loadDataset().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10_001 * 2 + 100);
    const result = await promise;

    expect(result).toBeInstanceOf(DatasetUnavailableError);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('surfaces a parse failure as DatasetUnavailableError (not a raw throw)', async () => {
    mockFetch(async () => okResponse('date,year\n2020-01-01,2020\n'));

    await expect(loadDataset()).rejects.toBeInstanceOf(DatasetUnavailableError);
  });

  it('the failure carries the underlying cause for diagnostics', async () => {
    mockFetch(async () => {
      throw new TypeError('dns fail');
    });

    try {
      await loadDataset();
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(DatasetUnavailableError);
      expect((error as DatasetUnavailableError).cause).toBeInstanceOf(TypeError);
    }
  });
});
