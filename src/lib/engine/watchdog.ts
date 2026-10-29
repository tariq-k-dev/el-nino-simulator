/**
 * Boot watchdog.
 *
 * Replaces the single fixed 15 s timeout, which was wrong in both directions:
 * it aborted a legitimately slow 1.6 Mbps boot that would have finished in 34 s,
 * and it could not distinguish "the connection is too slow to ever finish" from
 * "the host is dead" — so it always tried the next CDN even when the bottleneck
 * was the network rather than the host.
 *
 * Four independent budgets, because they measure different failures:
 *
 *   CONNECT_MS  — no progress event at all yet. Covers DNS + TLS + first byte.
 *                 The spike measured the first event up to 4.9 s late, so this
 *                 needs real headroom.
 *   STALL_MS    — gap between consecutive events. The worst measured gap was
 *                 0.42 s, so 15 s is generous; a trip here means the transfer
 *                 died, not that it is slow.
 *   AUTO_CAP_MS — ceiling on a projected total, auto mode only. This is the
 *                 "too slow to be worth it" judgement.
 *   EARLY_ABORT_* — projects the finish time and gives up well before the cap
 *                 is reached, so a user on 400 kbps is not left waiting 137 s.
 *
 * The watchdog REJECTS a racing promise rather than only terminating the worker:
 * `worker.terminate()` leaves the pending `instantiate()` promise unsettled
 * forever, which would leak a hang. Both happen, but the rejection is what the
 * caller can actually observe.
 */

/** No progress event at all within this window => the host never connected. */
export const CONNECT_MS = 12_000;

/** Gap between consecutive progress events that means the transfer died. */
export const STALL_MS = 15_000;

/** Projected total boot ceiling, auto mode only. */
export const AUTO_CAP_MS = 90_000;

/** Earliest point (since first progress event) at which early abort may trip. */
export const EARLY_EVAL_START_MS = 8_000;

/**
 * Trip when the projection exceeds AUTO_CAP_MS * this factor.
 *
 * 1.25 was too lenient: §9 showed a stubbed 400 kbps run whose projection hovered
 * just under `AUTO_CAP_MS * 1.25` for ~25 s, oscillating across the line and
 * resetting the consecutive counter each time it dipped. The abort fired at 62.8 s
 * instead of ~10 s. At 1.0 the rule aborts as soon as the evidence says the
 * transfer cannot finish inside the cap, which is the whole point of an early
 * abort. The 3-consecutive requirement is what keeps it from firing on a single
 * noisy sample.
 */
export const EARLY_ABORT_FACTOR = 1.0;

/** Consecutive projections over the threshold before tripping. */
const EARLY_ABORT_CONSECUTIVE = 3;

/**
 * Width of the window used to compute the transfer rate.
 *
 * The rate used to be `loaded / elapsedSinceFirst` — a CUMULATIVE average that
 * never forgets the slow start. §9's trace shows why that fails: Chrome's
 * throttled transport delivers in small early chunks, so the first second projects
 * a multi-hour finish (300 s at the first sample) and the cumulative average keeps
 * dragging the projection upward for tens of seconds afterwards.
 *
 * A 6 s sliding window measures the CURRENT rate, which is what "will this finish
 * in time?" actually depends on. It is long enough to span several progress events
 * (the worst observed gap is 0.42 s) and short enough to forget the ramp-up.
 */
export const EARLY_RATE_WINDOW_MS = 6_000;

/** How often the early-abort projection is evaluated once it is armed. */
const EARLY_EVAL_INTERVAL_MS = 1_000;

export type TripReason = 'connect' | 'stall' | 'cap';

export interface WatchdogOptions {
  /** 'auto' applies the cap and early abort; 'user' applies only connect + stall. */
  mode: 'auto' | 'user';
  /** Decoded size of the bundle, or null when unknown (disables projection). */
  decoded: number | null;
  /** Called on every progress event with decoded bytes loaded. */
  onProgress?: (loaded: number, decoded: number | null) => void;
  /** Injected for tests. */
  now?: () => number;
}

/**
 * A watchdog bound to one boot attempt.
 *
 * Usage: create it, hand `onProgress` to instantiate, and `Promise.race` the
 * instantiate promise against `watchdog.rejected`.
 */
export interface Watchdog {
  /** Resolves never; rejects with a TripReason when a budget is exceeded. */
  readonly rejected: Promise<never>;
  /** Record a progress event. Idempotent and monotonic. */
  progress(loaded: number): void;
  /** Call when the boot settles (success OR failure) to clear all timers. */
  dispose(): void;
  /** The reason this watchdog tripped, if it did. */
  readonly tripReason: TripReason | null;
  /** Exposed for assertions in tests. */
  readonly stats: WatchdogStats;
}

export interface WatchdogStats {
  firstEventAt: number | null;
  lastEventAt: number | null;
  lastLoaded: number;
  maxGapMs: number;
  evalCount: number;
  consecutiveOver: number;
  projectedTotalMs: number | null;
  /** Rate used by the last evaluation, bytes per ms, from the sliding window. */
  lastRateBpsPerMs: number | null;
  /** Elapsed ms covered by the sliding window at the last evaluation. */
  lastWindowMs: number | null;
}

/** One (timestamp, cumulative-loaded) sample, kept for the sliding window. */
interface ProgressSample {
  at: number;
  loaded: number;
}

class BootTimeoutError extends Error {
  constructor(
    public readonly reason: TripReason,
    message: string,
  ) {
    super(message);
    this.name = 'BootTimeoutError';
  }
}

export { BootTimeoutError };

/**
 * Create a watchdog for a single boot attempt.
 *
 * All four budgets run concurrently; whichever trips first rejects `rejected`.
 */
export function createWatchdog(opts: WatchdogOptions): Watchdog {
  const now = opts.now ?? (() => Date.now());

  let settled = false;
  let reason: TripReason | null = null;

  const stats: WatchdogStats = {
    firstEventAt: null,
    lastEventAt: null,
    lastLoaded: 0,
    maxGapMs: 0,
    evalCount: 0,
    consecutiveOver: 0,
    projectedTotalMs: null,
    lastRateBpsPerMs: null,
    lastWindowMs: null,
  };

  /**
   * Rolling history of progress samples. Pruned to slightly more than the window
   * so the boundary sample needed for interpolation is always present.
   */
  const samples: ProgressSample[] = [];

  let rejectFn: (err: Error) => void = () => {};
  const rejected = new Promise<never>((_, reject) => {
    rejectFn = reject;
  });
  // A rejection nobody awaits must not surface as an unhandled rejection: the
  // caller races it, and if the boot wins, this promise is simply abandoned.
  rejected.catch(() => {});

  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  let evalTimer: ReturnType<typeof setInterval> | null = null;

  const clear = () => {
    if (connectTimer !== null) clearTimeout(connectTimer);
    if (stallTimer !== null) clearTimeout(stallTimer);
    if (evalTimer !== null) clearInterval(evalTimer);
    connectTimer = null;
    stallTimer = null;
    evalTimer = null;
  };

  const trip = (r: TripReason, message: string) => {
    if (settled) return;
    settled = true;
    reason = r;
    clear();
    rejectFn(new BootTimeoutError(r, message));
  };

  // --- CONNECT: fires if no progress event ever arrives ----------------------
  connectTimer = setTimeout(() => {
    trip(
      'connect',
      `No DuckDB progress event within ${CONNECT_MS} ms — host unreachable or blocked.`,
    );
  }, CONNECT_MS);

  // --- early-abort projection (auto mode only) ------------------------------
  /**
   * Record a sample and return the rate over the sliding window.
   *
   * Returns null when the window does not yet span enough time to be meaningful
   * (fewer than two samples, or less than one event interval of coverage).
   */
  const slidingRate = (nowMs: number): { rate: number; windowMs: number } | null => {
    samples.push({ at: nowMs, loaded: stats.lastLoaded });

    // Keep everything newer than the window, plus one sample before it so the
    // window edge can be interpolated rather than snapping to a stale point.
    const cutoff = nowMs - EARLY_RATE_WINDOW_MS;
    let firstIdx = samples.findIndex((s) => s.at >= cutoff);
    if (firstIdx > 0) firstIdx -= 1;
    if (firstIdx > 0) samples.splice(0, firstIdx);

    if (samples.length < 2) return null;

    const newest = samples[samples.length - 1];
    const oldest = samples[0];
    const windowMs = newest.at - oldest.at;
    if (windowMs <= 0) return null;

    const deltaBytes = newest.loaded - oldest.loaded;
    if (deltaBytes <= 0) return null;

    return { rate: deltaBytes / windowMs, windowMs };
  };

  const evaluateProjection = () => {
    if (settled) return;
    const { firstEventAt, lastEventAt, lastLoaded } = stats;

    // Skip entirely when the payload size is unknown: projecting against a
    // null denominator would divide by zero or invent a number.
    if (opts.decoded === null || opts.decoded <= 0) return;
    if (firstEventAt === null || lastEventAt === null) return;

    const elapsedSinceFirst = lastEventAt - firstEventAt;
    if (elapsedSinceFirst < EARLY_EVAL_START_MS) return;

    // CURRENT rate over the last 6 s, not the cumulative average since the first
    // event. A cumulative average is permanently biased by the slow start and
    // produced the 62.8 s abort in §9.
    const win = slidingRate(now());
    if (win === null) return;

    stats.lastRateBpsPerMs = win.rate;
    stats.lastWindowMs = win.windowMs;

    const remaining = opts.decoded - lastLoaded;
    if (remaining <= 0) {
      // Everything has arrived; nothing to project and nothing to abort.
      stats.consecutiveOver = 0;
      stats.projectedTotalMs = elapsedSinceFirst;
      return;
    }

    const projected = elapsedSinceFirst + remaining / win.rate;
    stats.projectedTotalMs = projected;
    stats.evalCount += 1;

    const threshold = AUTO_CAP_MS * EARLY_ABORT_FACTOR;
    if (projected > threshold) {
      stats.consecutiveOver += 1;
      if (stats.consecutiveOver >= EARLY_ABORT_CONSECUTIVE) {
        trip(
          'cap',
          `Projected boot ${Math.round(projected)} ms exceeds ${Math.round(threshold)} ms ` +
            `(rate ${Math.round(win.rate * 1000)} B/s over ${Math.round(win.windowMs)} ms) — connection too slow.`,
        );
      }
    } else if (stats.consecutiveOver > 0) {
      // Hysteresis: a single sub-threshold sample decrements rather than zeroing,
      // so noise cannot restart the count from scratch. Two consecutive good
      // samples are needed to clear it.
      stats.consecutiveOver = Math.max(0, stats.consecutiveOver - 1);
    }
  };

  const armStall = () => {
    if (settled) return;
    if (stallTimer !== null) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      trip('stall', `No DuckDB progress event for ${STALL_MS} ms — transfer stalled.`);
    }, STALL_MS);
  };

  return {
    rejected,

    progress(loaded: number) {
      if (settled) return;
      const t = now();

      // Monotonic: never let a late-arriving smaller value move the bar back.
      const monotonic = Math.max(stats.lastLoaded, loaded);
      stats.lastLoaded = monotonic;

      if (stats.firstEventAt === null) {
        stats.firstEventAt = t;
        // The connect budget is satisfied by the first event; from here on,
        // silence is measured by the stall timer instead.
        if (connectTimer !== null) {
          clearTimeout(connectTimer);
          connectTimer = null;
        }

        // Arm the projection only in auto mode, and only with a known size.
        if (opts.mode === 'auto' && opts.decoded !== null) {
          evalTimer = setInterval(evaluateProjection, EARLY_EVAL_INTERVAL_MS);
        }
      } else {
        const gap = t - (stats.lastEventAt ?? t);
        if (gap > stats.maxGapMs) stats.maxGapMs = gap;
      }

      stats.lastEventAt = t;
      armStall();
      opts.onProgress?.(monotonic, opts.decoded);
    },

    dispose() {
      settled = true;
      clear();
    },

    get tripReason() {
      return reason;
    },

    get stats() {
      return stats;
    },
  };
}
