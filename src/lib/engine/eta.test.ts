import { describe, expect, it } from 'vitest';

/**
 * Pins the ETA arithmetic against the bug observed on a 400 kbps link:
 * "Loading DuckDB 0% · ~46346 s left".
 *
 * Cause: rate was computed from `startedAt`, which includes acquiring the 755 KB
 * worker script. During that window zero wasm bytes move, so a small `loaded`
 * divided by a large elapsed time gave a near-zero rate and a projected finish
 * ~13 hours away. The fix measures from the first progress event and suppresses
 * estimates that are absurd or premature.
 *
 * The function is duplicated here rather than exported from the component so the
 * arithmetic can be tested without mounting React; the component imports the
 * same shape. If the two drift, this test stops protecting the component, so the
 * component's copy stays intentionally identical.
 */
const ETA_AFTER_MS = 5_000;

function estimateRemainingSeconds(
  loaded: number,
  decoded: number | null,
  firstEventAt: number | null,
  now: number,
): number | null {
  if (decoded === null || decoded <= 0) return null;
  if (firstEventAt === null) return null;
  if (loaded <= 0) return null;

  const elapsed = now - firstEventAt;
  if (elapsed < ETA_AFTER_MS) return null;

  const bytesPerMs = loaded / elapsed;
  if (!Number.isFinite(bytesPerMs) || bytesPerMs <= 0) return null;

  const remainingMs = (decoded - loaded) / bytesPerMs;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;

  const seconds = Math.round(remainingMs / 1000);
  if (seconds > 3600) return null;
  return Math.max(1, seconds);
}

const DECODED = 34_242_586;

describe('estimateRemainingSeconds', () => {
  it('regression: does NOT produce a multi-hour estimate from worker-load dwell', () => {
    // The exact shape of the bug: 30 s of elapsed time (mostly worker download)
    // with almost no wasm bytes, measured against boot start.
    const startedAt = 0;
    const now = 34_000;
    const loaded = 12_000; // ~12 KB of wasm had arrived

    // The old, buggy computation — kept to document what was wrong.
    const buggyBytesPerMs = loaded / (now - startedAt);
    const buggySeconds = Math.round((DECODED - loaded) / buggyBytesPerMs / 1000);
    expect(buggySeconds).toBeGreaterThan(3_600); // e.g. ~46346 s

    // The fixed computation, measured from the first progress event instead.
    const firstEventAt = 33_000;
    const fixed = estimateRemainingSeconds(loaded, DECODED, firstEventAt, now);
    // Only 1 s of data time has elapsed, so the estimate is suppressed.
    expect(fixed).toBeNull();
  });

  it('is null before any progress event has occurred', () => {
    expect(estimateRemainingSeconds(1_000, DECODED, null, 100_000)).toBeNull();
  });

  it('is null before ETA_AFTER_MS of data time', () => {
    expect(estimateRemainingSeconds(500_000, DECODED, 0, 4_999)).toBeNull();
    expect(estimateRemainingSeconds(500_000, DECODED, 0, 5_000)).not.toBeNull();
  });

  it('is null when decoded is unknown (indeterminate)', () => {
    expect(estimateRemainingSeconds(500_000, null, 0, 10_000)).toBeNull();
    expect(estimateRemainingSeconds(500_000, 0, 0, 10_000)).toBeNull();
  });

  it('projects a plausible value at a steady 400 kbps rate', () => {
    // 50 KB/s => 50_000 B/s. After 20 s, 1 MB loaded.
    const loaded = 1_000_000;
    const elapsedMs = 20_000;
    const secs = estimateRemainingSeconds(loaded, DECODED, 0, elapsedMs);
    expect(secs).not.toBeNull();
    const expected = Math.round((DECODED - loaded) / (loaded / elapsedMs) / 1000);
    expect(secs).toBe(expected);
  });

  it('suppresses absurd multi-hour estimates rather than showing them', () => {
    // Rate so low the projection exceeds an hour.
    const secs = estimateRemainingSeconds(1_000, DECODED, 0, 60_000);
    expect(secs).toBeNull();
  });

  it('is null once loaded meets or exceeds decoded', () => {
    expect(estimateRemainingSeconds(DECODED, DECODED, 0, 60_000)).toBeNull();
    expect(estimateRemainingSeconds(DECODED + 10, DECODED, 0, 60_000)).toBeNull();
  });

  it('never returns zero or a negative figure', () => {
    const secs = estimateRemainingSeconds(DECODED - 100, DECODED, 0, 10_000);
    if (secs !== null) expect(secs).toBeGreaterThanOrEqual(1);
  });
});
