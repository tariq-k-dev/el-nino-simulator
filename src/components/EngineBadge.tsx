import { Loader2, Radar } from 'lucide-react';
import { enableEngine } from '@/lib/engine/init';
import { progressPercent, useEngineStatus } from '@/lib/engine/store';

/**
 * Approximate wire size of the DuckDB wasm, shown on the opt-in button so the
 * user knows what clicking costs.
 *
 * Measured: duckdb-eh.wasm at v1.32.0 is 6,764,975 bytes brotli-encoded
 * (ENGINE_BOOT_SPIKE.md §2.6). The 34 MB figure is the *decoded* size and is
 * never what crosses the network. Rounded to "~7 MB" for display.
 */
export const WASM_WIRE_SIZE_LABEL = '~7 MB';

/** Seconds of data-time after which an ETA estimate is worth showing. */
const ETA_AFTER_MS = 5_000;

/**
 * Estimated seconds remaining, or null when it cannot be estimated.
 *
 * Measured from the FIRST progress event, never from boot start. Boot start
 * includes acquiring the 755 KB worker script, during which zero bytes of wasm
 * move — dividing a small byte count by that larger elapsed time yielded
 * "~46346 s left" on a 400 kbps link. `firstEventAt` is the only honest origin
 * for a transfer rate.
 *
 * Also suppressed until ETA_AFTER_MS of *data* time has passed, because a single
 * early sample is a poor predictor.
 */
function estimateRemainingSeconds(
  loaded: number,
  decoded: number | null,
  firstEventAt: number | null,
  now: number,
): number | null {
  if (decoded === null || decoded <= 0) return null;
  if (firstEventAt === null) return null;
  // Before the first byte there is no rate to project from.
  if (loaded <= 0) return null;

  const elapsed = now - firstEventAt;
  if (elapsed < ETA_AFTER_MS) return null;

  const bytesPerMs = loaded / elapsed;
  if (!Number.isFinite(bytesPerMs) || bytesPerMs <= 0) return null;

  const remainingMs = (decoded - loaded) / bytesPerMs;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;

  const seconds = Math.round(remainingMs / 1000);
  // Past an hour the estimate is not useful to a user and usually means the
  // connection cannot finish anyway; the watchdog owns that decision.
  if (seconds > 3600) return null;
  return Math.max(1, seconds);
}

/** Shared button styling: 44px minimum touch target. */
const ACTION_BUTTON =
  'pointer-events-auto flex min-h-[44px] items-center gap-1.5 rounded-full border border-sky-300/30 bg-sky-400/10 px-3 text-[10px] font-medium uppercase tracking-[0.1em] text-sky-100 transition-colors hover:border-sky-300/50 hover:bg-sky-400/20';

/**
 * The engine status badge.
 *
 * `aria-live="polite"` so a screen reader announces phase changes (boot started,
 * engine ready, boot failed) without interrupting whatever it is currently
 * saying. Progress percentages are inside the same live region, but because the
 * store throttles writes to <=10/s the announcement rate stays reasonable.
 */
export function EngineBadge({ now = Date.now() }: { now?: number }) {
  const status = useEngineStatus();

  if (status.phase === 'deferred') {
    return (
      <button type="button" onClick={enableEngine} className={ACTION_BUTTON} aria-live="polite">
        <Radar size={11} className="text-slate-400" />
        Client-side model · Load DuckDB ({WASM_WIRE_SIZE_LABEL})
      </button>
    );
  }

  if (status.phase === 'booting') {
    const pct = progressPercent(status);
    const remaining = estimateRemainingSeconds(
      status.loaded,
      status.decoded,
      status.firstEventAt,
      now,
    );

    /**
     * Zero progress events yet.
     *
     * This is a genuinely distinct phase, not just "unknown percentage": the
     * 755 KB worker script is still downloading, and no `InstantiationProgress`
     * event can exist until it has executed (measured in 2B: the first event
     * lands 1.5–4.9 s after boot starts). Showing "Loading DuckDB" with a
     * pulsing bar implies data is arriving when nothing is being reported at all,
     * so this says what is actually happening.
     *
     * `firstEventAt === null` is the precise signal: the store stamps it on the
     * first progress report, so null means zero events.
     */
    const awaitingFirstEvent = status.firstEventAt === null;
    const indeterminate = pct === null;

    if (awaitingFirstEvent) {
      return (
        <div
          className="pointer-events-auto flex min-h-[44px] items-center gap-2 rounded-full border border-white/[0.08] bg-black/40 px-2.5 backdrop-blur-md"
          aria-live="polite"
          aria-busy="true"
        >
          <Loader2 size={11} className="animate-spin text-sky-400" />
          <span className="num text-[9.5px] tracking-tight text-slate-300">Starting DuckDB…</span>
          <span className="relative block h-[3px] w-14 overflow-hidden rounded-full bg-white/10">
            <span className="block h-full w-1/3 animate-pulse rounded-full bg-sky-400" />
          </span>
        </div>
      );
    }

    return (
      <div
        className="pointer-events-auto flex min-h-[44px] items-center gap-2 rounded-full border border-white/[0.08] bg-black/40 px-2.5 backdrop-blur-md"
        aria-live="polite"
        aria-busy="true"
      >
        <Loader2 size={11} className="animate-spin text-sky-400" />
        <span className="num text-[9.5px] tracking-tight text-slate-300">
          Loading DuckDB
          {indeterminate ? '' : ` ${pct}%`}
          {remaining !== null ? ` · ~${remaining} s left` : ''}
        </span>
        {/* Slim bar. Indeterminate has no width animation: a fake progress
            indication is worse than none. */}
        <span className="relative block h-[3px] w-14 overflow-hidden rounded-full bg-white/10">
          <span
            className={[
              'block h-full rounded-full bg-sky-400 transition-[width] duration-200 ease-out',
              indeterminate ? 'w-1/3 animate-pulse' : '',
            ].join(' ')}
            style={indeterminate ? undefined : { width: `${pct}%` }}
          />
        </span>
      </div>
    );
  }

  if (status.phase === 'ready') {
    return (
      <div
        className="pointer-events-auto flex min-h-[44px] items-center gap-1.5 rounded-full border border-white/[0.08] bg-black/40 px-2.5 backdrop-blur-md"
        aria-live="polite"
      >
        <Radar size={11} className="text-emerald-400" />
        <span className="num text-[9.5px] tracking-tight text-emerald-300">DuckDB-WASM</span>
        <span className="h-2.5 w-px bg-white/15" />
        <span className="num text-[9.5px] tracking-tight text-slate-400">{status.host}</span>
        <span className="num text-[9.5px] tracking-tight text-slate-500">{status.bootMs} ms</span>
      </div>
    );
  }

  // failed
  if (status.reason === 'too-slow') {
    return (
      <button type="button" onClick={enableEngine} className={ACTION_BUTTON} aria-live="polite">
        <Radar size={11} className="text-amber-400" />
        Client-side model · Needs a faster connection · Load anyway ({WASM_WIRE_SIZE_LABEL})
      </button>
    );
  }

  // 'unreachable' and 'error' both mean "the engine could not start"; retry is
  // the only sensible action, and the label distinguishes the cause.
  const cause = status.reason === 'unreachable' ? 'DuckDB unavailable' : 'DuckDB error';
  return (
    <button type="button" onClick={enableEngine} className={ACTION_BUTTON} aria-live="polite">
      <Radar size={11} className="text-rose-400" />
      Client-side model · {cause} · Retry
    </button>
  );
}
