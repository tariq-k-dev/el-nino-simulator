import { Globe2, Loader2, Radar } from 'lucide-react';
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

/** Visually hidden but screen-reader visible. */
const SR_ONLY = 'sr-only';

/**
 * One sentence of meaning per phase, for assistive tech.
 *
 * Why this exists: the badge's visual spans concatenate with no separators, so
 * `textContent` read "DuckDB-WASMjsdelivr2820 ms". A screen reader announced that
 * string, and the e2e assertions had to parse it. Each phase now emits a complete
 * sentence here and marks its visual spans aria-hidden, so the announced text is
 * the sentence and nothing else.
 */
function ScreenReaderOnly({ children }: { children: string }) {
  return (
    <span className={SR_ONLY} aria-live="polite">
      {children}
    </span>
  );
}

/**
 * The engine status badge.
 *
 * `aria-live="polite"` lives on the sr-only sentence rather than the wrapper, so
 * the announcement is the sentence and not the concatenated chrome. The store
 * throttles progress writes to <=10/s, which also bounds the announcement rate.
 */
export function EngineBadge({ now = Date.now() }: { now?: number }) {
  const status = useEngineStatus();

  if (status.phase === 'deferred') {
    /**
     * Waiting for the globe, with an automatic boot already queued.
     *
     * `reason === 'scene'` means an eager or idle boot is scheduled and is being
     * held back deliberately so the wasm does not compete with 2.08 MB of globe
     * texture for the same link (measured as ~10 s of extra boot time at 1.6
     * Mbps). It says so in the same shape as the deferred badge, because from the
     * user's point of view it IS deferred — the numbers on screen are already
     * correct from the client-side model.
     *
     * Two failure modes this avoids:
     *  - reading "unavailable" — the engine is about to load on its own, so
     *    claiming it is unavailable is simply false;
     *  - a stalled progress bar — no bytes are moving yet, so a percentage would
     *    be invented. There is no `aria-busy` and no bar here at all.
     *
     * The Load button is present and does something useful: a click bypasses the
     * gate entirely (`enableEngine()` never waits on the scene), so a user who
     * wants the engine NOW does not have to wait for the globe.
     */
    if (status.reason === 'scene') {
      return (
        <button type="button" onClick={enableEngine} className={ACTION_BUTTON}>
          <Globe2 size={11} className="text-slate-400" aria-hidden />
          <span aria-hidden>
            Client-side model · DuckDB loads after the globe · Load now ({WASM_WIRE_SIZE_LABEL})
          </span>
          <ScreenReaderOnly>
            Using the built-in model. The DuckDB analytics engine is queued and will load
            automatically once the globe has finished loading. Activate to load it now instead,
            about 7 megabytes.
          </ScreenReaderOnly>
        </button>
      );
    }

    return (
      <button type="button" onClick={enableEngine} className={ACTION_BUTTON}>
        <Radar size={11} className="text-slate-400" aria-hidden />
        <span aria-hidden>
          Client-side model · Load DuckDB ({WASM_WIRE_SIZE_LABEL})
        </span>
        <ScreenReaderOnly>
          Using the built-in model. DuckDB analytics engine is not loaded. Activate to load it,
          about 7 megabytes.
        </ScreenReaderOnly>
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
          aria-busy="true"
        >
          <Loader2 size={11} className="animate-spin text-sky-400" aria-hidden />
          <span className="num text-[9.5px] tracking-tight text-slate-300" aria-hidden>
            Starting DuckDB…
          </span>
          <span
            className="relative block h-[3px] w-14 overflow-hidden rounded-full bg-white/10"
            aria-hidden
          >
            <span className="block h-full w-1/3 animate-pulse rounded-full bg-sky-400" />
          </span>
          <ScreenReaderOnly>
            Loading the DuckDB analytics engine. Preparing to download.
          </ScreenReaderOnly>
        </div>
      );
    }

    return (
      <div
        className="pointer-events-auto flex min-h-[44px] items-center gap-2 rounded-full border border-white/[0.08] bg-black/40 px-2.5 backdrop-blur-md"
        aria-busy="true"
      >
        <Loader2 size={11} className="animate-spin text-sky-400" aria-hidden />
        <span className="num text-[9.5px] tracking-tight text-slate-300" aria-hidden>
          Loading DuckDB
          {indeterminate ? '' : ` ${pct}%`}
          {remaining !== null ? ` · ~${remaining} s left` : ''}
        </span>
        {/* Slim bar. Indeterminate has no width animation: a fake progress
            indication is worse than none. */}
        <span
          className="relative block h-[3px] w-14 overflow-hidden rounded-full bg-white/10"
          aria-hidden
        >
          <span
            className={[
              'block h-full rounded-full bg-sky-400 transition-[width] duration-200 ease-out',
              indeterminate ? 'w-1/3 animate-pulse' : '',
            ].join(' ')}
            style={indeterminate ? undefined : { width: `${pct}%` }}
          />
        </span>
        <ScreenReaderOnly>
          {indeterminate
            ? 'Loading the DuckDB analytics engine. Progress unknown.'
            : `Loading the DuckDB analytics engine, ${pct} percent complete${
                remaining !== null ? `, about ${remaining} seconds remaining` : ''
              }.`}
        </ScreenReaderOnly>
      </div>
    );
  }

  if (status.phase === 'ready') {
    return (
      <div
        className="pointer-events-auto flex min-h-[44px] items-center gap-1.5 rounded-full border border-white/[0.08] bg-black/40 px-2.5 backdrop-blur-md"
      >
        <Radar size={11} className="text-emerald-400" aria-hidden />
        <span className="num text-[9.5px] tracking-tight text-emerald-300" aria-hidden>
          DuckDB-WASM
        </span>
        <span className="h-2.5 w-px bg-white/15" aria-hidden />
        <span className="num text-[9.5px] tracking-tight text-slate-400" aria-hidden>
          {status.host}
        </span>
        <span className="num text-[9.5px] tracking-tight text-slate-500" aria-hidden>
          {status.bootMs} ms
        </span>
        <ScreenReaderOnly>
          {`DuckDB engine ready, served from ${status.host}, ${status.bootMs} milliseconds.`}
        </ScreenReaderOnly>
      </div>
    );
  }

  // failed
  if (status.reason === 'too-slow') {
    return (
      <button type="button" onClick={enableEngine} className={ACTION_BUTTON}>
        <Radar size={11} className="text-amber-400" aria-hidden />
        <span aria-hidden>
          Client-side model · Needs a faster connection · Load anyway ({WASM_WIRE_SIZE_LABEL})
        </span>
        <ScreenReaderOnly>
          Using the built-in model. The connection is too slow for the DuckDB analytics engine,
          about 7 megabytes. Activate to load it anyway.
        </ScreenReaderOnly>
      </button>
    );
  }

  // 'unreachable' and 'error' both mean "the engine could not start"; retry is
  // the only sensible action, and the label distinguishes the cause.
  const cause = status.reason === 'unreachable' ? 'DuckDB unavailable' : 'DuckDB error';
  return (
    <button type="button" onClick={enableEngine} className={ACTION_BUTTON}>
      <Radar size={11} className="text-rose-400" aria-hidden />
      <span aria-hidden>
        Client-side model · {cause} · Retry
      </span>
      <ScreenReaderOnly>
        Using the built-in model. The DuckDB analytics engine could not be reached. Activate to
        retry.
      </ScreenReaderOnly>
    </button>
  );
}
