import { describe, expect, it, vi } from 'vitest';
import {
  createWatchdog,
  AUTO_CAP_MS,
  BootTimeoutError,
  CONNECT_MS,
  EARLY_ABORT_FACTOR,
  EARLY_EVAL_START_MS,
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
