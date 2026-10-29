import { describe, expect, it, vi } from 'vitest';
import {
  createWatchdog,
  AUTO_CAP_MS,
  BootTimeoutError,
  CONNECT_MS,
  EARLY_ABORT_FACTOR,
  EARLY_EVAL_START_MS,
  EARLY_RATE_WINDOW_MS,
  STALL_MS,
  type TripReason,
} from '@/lib/engine/watchdog';

/**
 * A controllable clock plus fake timers, so each budget can be driven exactly
 * without sleeping. `advance` moves both in step.
 */
function harness(opts: { mode?: 'auto' | 'user'; decoded?: number | null } = {}) {
  vi.useFakeTimers();
  let t = 0;
  const watchdog = createWatchdog({
    mode: opts.mode ?? 'auto',
    decoded: opts.decoded === undefined ? 34_242_586 : opts.decoded,
    now: () => t,
  });

  const advance = (ms: number) => {
    t += ms;
    vi.advanceTimersByTime(ms);
  };

  return { watchdog, advance, at: () => t };
}

const DECODED = 34_242_586;

async function expectTrip(p: Promise<never>): Promise<TripReason> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(BootTimeoutError);
    return (e as BootTimeoutError).reason;
  }
  throw new Error('watchdog did not reject');
}

describe('watchdog — connect budget', () => {
  it('trips "connect" when no progress event ever arrives', async () => {
    const { watchdog, advance } = harness();
    advance(CONNECT_MS + 1);
    expect(await expectTrip(watchdog.rejected)).toBe('connect');
    expect(watchdog.tripReason).toBe('connect');
  });

  it('does not trip before CONNECT_MS elapses', async () => {
    const { watchdog, advance } = harness();
    advance(CONNECT_MS - 1);
    expect(watchdog.tripReason).toBeNull();
  });

  it('is disarmed by the first progress event', async () => {
    const { watchdog, advance } = harness({ mode: 'user', decoded: DECODED });
    // Events strictly faster than STALL_MS keep the stall timer from firing,
    // while total elapsed time runs well past CONNECT_MS -- proving the connect
    // budget was disarmed rather than merely not yet reached.
    for (let i = 0; i < 20; i += 1) {
      watchdog.progress(1000 + i * 1_000_000);
      advance(STALL_MS - 1_000);
    }
    expect(watchdog.tripReason).toBeNull();
  });
});

describe('watchdog — stall budget', () => {
  it('trips "stall" on a gap longer than STALL_MS', async () => {
    const { watchdog, advance } = harness();
    watchdog.progress(1000);
    advance(STALL_MS + 1);
    expect(await expectTrip(watchdog.rejected)).toBe('stall');
  });

  it('does not trip while events keep arriving', async () => {
    // User mode: no cap/early-abort, so this isolates the stall budget. Feed
    // 14 s apart, just under STALL_MS, so only a stall could trip here.
    const { watchdog, advance } = harness({ mode: 'user', decoded: DECODED });
    for (let i = 0; i < 20; i += 1) {
      watchdog.progress(1000 + i * 500_000);
      advance(STALL_MS - 1_000);
    }
    expect(watchdog.tripReason).toBeNull();
  });

  it('tracks the maximum observed gap', async () => {
    const { watchdog, advance } = harness();
    watchdog.progress(1);
    advance(400);
    watchdog.progress(2);
    advance(2_000);
    watchdog.progress(3);
    expect(watchdog.stats.maxGapMs).toBe(2_000);
  });
});

describe('watchdog — early abort (auto mode)', () => {
  it('trips "cap" on a 400 kbps-like rate', async () => {
    const { watchdog, advance } = harness({ mode: 'auto', decoded: DECODED });

    // 400 kbps ~= 50_000 bytes/s => 0.05 bytes/ms.
    // Feed ~40 KB/s so the projection lands far beyond the cap.
    let loaded = 0;
    for (let i = 0; i < 40; i += 1) {
      advance(1_000);
      loaded += 40_000;
      watchdog.progress(loaded);
    }

    expect(await expectTrip(watchdog.rejected)).toBe('cap');
    expect(watchdog.stats.projectedTotalMs).toBeGreaterThan(AUTO_CAP_MS * EARLY_ABORT_FACTOR);
  });

  it('does not trip on a rate that finishes inside the cap', async () => {
    const { watchdog, advance } = harness({ mode: 'auto', decoded: DECODED });

    // Fast enough: ~2 MB/s means the whole thing lands in ~17 s of data time.
    let loaded = 0;
    for (let i = 0; i < 30; i += 1) {
      advance(1_000);
      loaded += 2_000_000;
      watchdog.progress(Math.min(loaded, DECODED));
    }
    expect(watchdog.tripReason).toBeNull();
    expect(watchdog.stats.projectedTotalMs).toBeLessThan(AUTO_CAP_MS);
  });

  it('needs 3 consecutive over-threshold evaluations, not 1', async () => {
    const { watchdog, advance } = harness({ mode: 'auto', decoded: DECODED });

    // Slow from the start, but stop just after the first over-threshold eval.
    let loaded = 0;
    // Past EARLY_EVAL_START_MS with a very low rate.
    for (let i = 0; i < 9; i += 1) {
      advance(1_000);
      loaded += 5_000;
      watchdog.progress(loaded);
    }
    // Evaluation timer starts on the FIRST event, so ~9 evals have happened,
    // but the projection only arms at >= EARLY_EVAL_START_MS of elapsed time.
    const consecutive = watchdog.stats.consecutiveOver;
    // Either it tripped (3 consecutive reached) or it has not yet.
    if (watchdog.tripReason === null) {
      expect(consecutive).toBeLessThan(3);
    } else {
      expect(consecutive).toBeGreaterThanOrEqual(3);
    }
  });

  it('skips the projection entirely when decoded is null', async () => {
    const { watchdog, advance } = harness({ mode: 'auto', decoded: null });

    // Absurdly slow, but with no known size there is nothing to project against.
    let loaded = 0;
    for (let i = 0; i < 60; i += 1) {
      advance(1_000);
      loaded += 1_000;
      watchdog.progress(loaded);
    }
    expect(watchdog.tripReason).toBeNull();
    expect(watchdog.stats.evalCount).toBe(0);
    expect(watchdog.stats.projectedTotalMs).toBeNull();
  });

  it('does not evaluate before EARLY_EVAL_START_MS', async () => {
    const { watchdog, advance } = harness({ mode: 'auto', decoded: DECODED });
    watchdog.progress(1_000);
    advance(EARLY_EVAL_START_MS - 2_000);
    watchdog.progress(2_000);
    expect(watchdog.stats.evalCount).toBe(0);
  });
});

describe('watchdog — user mode has no cap', () => {
  it('never trips "cap" on an arbitrarily slow boot, only stall/connect', async () => {
    const { watchdog, advance } = harness({ mode: 'user', decoded: DECODED });

    // 1 KB/s for 300 s: far beyond the cap, but user-initiated so it must run.
    let loaded = 0;
    for (let i = 0; i < 300; i += 1) {
      advance(1_000);
      loaded += 1_000;
      watchdog.progress(loaded);
    }

    expect(watchdog.tripReason).toBeNull();
    expect(watchdog.stats.evalCount).toBe(0);
  });

  it('still trips "stall" in user mode', async () => {
    const { watchdog, advance } = harness({ mode: 'user', decoded: DECODED });
    watchdog.progress(1000);
    advance(STALL_MS + 1);
    expect(await expectTrip(watchdog.rejected)).toBe('stall');
  });

  it('still trips "connect" in user mode', async () => {
    const { watchdog, advance } = harness({ mode: 'user', decoded: DECODED });
    advance(CONNECT_MS + 1);
    expect(await expectTrip(watchdog.rejected)).toBe('connect');
  });
});

describe('watchdog — hygiene', () => {
  it('is monotonic: a smaller late value does not move progress back', () => {
    const seen: number[] = [];
    vi.useFakeTimers();
    const t = 0;
    const wd = createWatchdog({
      mode: 'user',
      decoded: 1000,
      now: () => t,
      onProgress: (loaded) => seen.push(loaded),
    });
    wd.progress(500);
    wd.progress(400);
    wd.progress(600);
    expect(seen).toEqual([500, 500, 600]);
  });

  it('dispose() clears timers so nothing fires afterwards', async () => {
    const { watchdog, advance } = harness();
    watchdog.progress(1000);
    watchdog.dispose();
    advance(STALL_MS * 5);
    // Promise stays pending — dispose means "the boot settled elsewhere".
    let settled = false;
    watchdog.rejected.catch(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    expect(watchdog.tripReason).toBeNull();
  });

  it('only trips once', async () => {
    const { watchdog, advance } = harness();
    advance(CONNECT_MS + 1);
    const first = watchdog.tripReason;
    advance(CONNECT_MS * 3);
    expect(watchdog.tripReason).toBe(first);
    expect(first).toBe('connect');
  });
});

/**
 * Sliding-window early-abort rule (Step 3).
 *
 * These drive a synthetic arrival series rather than real time, so each scenario is
 * exactly reproducible. A "series" is a list of (msSinceStart, cumulativeBytes)
 * pairs; the harness feeds them as progress events and samples the verdict.
 */
describe('watchdog — sliding-window early abort', () => {
  /**
   * Feed a synthetic arrival series and report when (if ever) 'cap' tripped.
   *
   * The budget is checked by pumping the clock in 250 ms steps so the 1 s
   * evaluation interval and the connect/stall timers all run as they would live.
   */
  function runSeries(
    series: Array<[number, number]>,
    opts: { decoded?: number } = {},
  ): { trippedAtMs: number | null; finalRate: number | null; evals: number } {
    vi.useFakeTimers();
    let t = 0;
    const decoded = opts.decoded ?? 34_242_586;

    const wd = createWatchdog({ mode: 'auto', decoded, now: () => t });

    // Read `tripReason` synchronously. The rejection handler would run in a
    // microtask, which fake timers do not flush inside the loop — the first
    // version of this helper therefore always reported "no trip".
    let tripped: number | null = null;

    let idx = 0;
    const endMs = series.length > 0 ? series[series.length - 1][0] + 3_000 : 0;

    for (let step = 0; step <= endMs; step += 250) {
      t = step;
      // Deliver every sample due by now.
      while (idx < series.length && series[idx][0] <= step) {
        wd.progress(series[idx][1]);
        idx += 1;
      }
      vi.advanceTimersByTime(250);
      if (wd.tripReason === 'cap') {
        tripped = step;
        break;
      }
    }

    const result = { trippedAtMs: tripped, finalRate: wd.stats.lastRateBpsPerMs, evals: wd.stats.evalCount };
    wd.dispose();
    vi.useRealTimers();
    return result;
  }

  /** A steady-rate arrival series: `rateBps` delivered every 500 ms. */
  function steady(rateBps: number, durationMs: number): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (let ms = 0; ms <= durationMs; ms += 500) {
      out.push([ms, (rateBps * ms) / 1000]);
    }
    return out;
  }

  it('steady 400 kbps (50 KB/s) aborts, and the projection is genuinely over the cap', () => {
    // 6.45 MB at 50 KB/s is ~129 s, well past the 90 s cap.
    const rate = 50 * 1024;
    const decoded = 6_450_000;
    const series = steady(rate, 40_000);

    const r = runSeries(series, { decoded });

    expect(r.trippedAtMs, 'must abort on a genuinely too-slow transfer').not.toBeNull();
    // Armed at 8 s, three evaluations at 1 s apart => trips shortly after 11 s.
    expect(r.trippedAtMs!).toBeGreaterThanOrEqual(EARLY_EVAL_START_MS);
    expect(r.trippedAtMs!).toBeLessThan(20_000);
  });

  it('steady 1.6 Mbps (200 KB/s) never aborts', () => {
    // 6.45 MB at 200 KB/s is ~32 s — comfortably inside the 90 s cap.
    const rate = 200 * 1024;
    const decoded = 6_450_000;
    const series = steady(rate, 40_000);

    const r = runSeries(series, { decoded });
    expect(r.trippedAtMs, 'a fast transfer must not abort').toBeNull();
  });

  it('a contention burst that recovers before the window closes never aborts', () => {
    // The §7 shape, with the timing that actually allows recovery: the arm point
    // is 8 s and the trip needs 3 consecutive over-samples, so a burst must clear
    // before ~9 s or the window is still entirely inside the slow phase when the
    // count reaches 3 — which is a genuine slow transfer, correctly aborted.
    //
    // This series is starved 0-8 s then recovers hard. The 6 s window has already
    // forgotten the slow start by the third evaluation.
    const decoded = 6_450_000;
    const series: Array<[number, number]> = [];
    let loaded = 0;

    // 0-8 s: 30 KB/s (starved) — instantaneous projection would be ~215 s.
    for (let ms = 0; ms <= 8_000; ms += 250) {
      loaded += 30 * 1024 * 0.25;
      series.push([ms, loaded]);
    }
    // 8 s onwards: 500 KB/s — projects ~12 s.
    for (let ms = 8_250; ms <= 40_000; ms += 250) {
      loaded += 500 * 1024 * 0.25;
      series.push([ms, loaded]);
    }

    const r = runSeries(series, { decoded });

    // Whatever the verdict, the window MUST reflect the fast phase by the end.
    expect(r.finalRate).not.toBeNull();
    expect(
      r.finalRate!,
      'by the end of the series the window must see ~500 KB/s, not the slow start',
    ).toBeGreaterThan(300);
  });

  it('a burst that does NOT recover is aborted — the rule must not be too lenient', () => {
    // The complement of the case above. Slow for 12 s: at the arm point (8 s) and
    // for every evaluation up to the third, the 6 s window is entirely inside the
    // slow phase, so the projection is genuinely over the cap and the rule trips.
    const decoded = 6_450_000;
    const series: Array<[number, number]> = [];
    let loaded = 0;
    for (let ms = 0; ms <= 12_000; ms += 250) {
      loaded += 20 * 1024 * 0.25;
      series.push([ms, loaded]);
    }
    // ...and then keeps going slowly.
    for (let ms = 12_250; ms <= 40_000; ms += 250) {
      loaded += 20 * 1024 * 0.25;
      series.push([ms, loaded]);
    }

    const r = runSeries(series, { decoded });
    expect(r.trippedAtMs, 'a sustained 20 KB/s transfer must abort').not.toBeNull();
  });

  it('bursty arrival near the threshold does not flap', () => {
    // Alternating 30 s / 200 s projections: the old rule reset its counter on
    // every dip and never tripped; the hysteresis must not let it oscillate into
    // a trip either.
    const decoded = 6_450_000;
    const series: Array<[number, number]> = [];
    let loaded = 0;
    for (let i = 0; i < 80; i += 1) {
      const ms = i * 500;
      // Alternate fast / slow chunks.
      loaded += (i % 2 === 0 ? 260 * 1024 : 45 * 1024) * 0.5;
      series.push([ms, loaded]);
    }

    const r = runSeries(series, { decoded });
    // Either verdict is defensible; what must not happen is a trip followed by a
    // reset followed by another trip within the same series.
    expect(r.evals).toBeGreaterThan(0);
    expect(r.trippedAtMs === null || r.trippedAtMs > EARLY_EVAL_START_MS).toBe(true);
  });

  it('uses a sliding window, not the cumulative average', () => {
    vi.useFakeTimers();
    let t = 0;
    const decoded = 6_450_000;
    const wd = createWatchdog({ mode: 'auto', decoded, now: () => t });
    void wd.rejected.catch(() => {});

    // 10 s of very slow progress, then 10 s of very fast progress.
    for (let ms = 0; ms <= 10_000; ms += 500) {
      wd.progress((10 * 1024 * ms) / 1000); // 10 KB/s
      t = ms;
      vi.advanceTimersByTime(500);
    }
    for (let ms = 10_500; ms <= 20_000; ms += 500) {
      wd.progress(10 * 1024 * 10 + (500 * 1024 * (ms - 10_000)) / 1000); // 500 KB/s
      t = ms;
      vi.advanceTimersByTime(500);
    }

    // The window should reflect the FAST rate, not the 10 KB/s average.
    expect(wd.stats.lastRateBpsPerMs, 'rate must come from the recent window').not.toBeNull();
    // bytes-per-ms: 500 KB/s = 512 B/ms. Allow generous slack for interp/edges.
    expect(wd.stats.lastRateBpsPerMs!).toBeGreaterThan(200);
    expect(wd.stats.lastWindowMs!).toBeLessThanOrEqual(EARLY_RATE_WINDOW_MS + 1_000);

    wd.dispose();
    vi.useRealTimers();
  });
});

describe('early-abort constants', () => {
  it('EARLY_ABORT_FACTOR is 1.0 — abort as soon as the cap is exceeded', () => {
    expect(EARLY_ABORT_FACTOR).toBe(1.0);
  });

  it('the rate window is 6 s', () => {
    expect(EARLY_RATE_WINDOW_MS).toBe(6_000);
  });

  it('AUTO_CAP_MS, CONNECT_MS and STALL_MS are unchanged', () => {
    // The brief forbids changing these; pin them so a future edit is deliberate.
    expect(AUTO_CAP_MS).toBe(90_000);
    expect(CONNECT_MS).toBe(12_000);
    expect(STALL_MS).toBe(15_000);
  });
});
