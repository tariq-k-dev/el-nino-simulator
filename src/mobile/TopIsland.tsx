/**
 * The floating HUD island: a capsule at the top centre that expands into the global anomaly scrubber.
 *
 * ## What it is for
 *
 * On a phone the desktop header's badge and the left control deck are both gone (the header collapses, the deck
 * is replaced by the sheet). The scrubber is the page's PRIMARY lever — the whole simulator is "move one
 * climate lever, watch the planet respond" — so it cannot live only two tiers down inside a sheet the reader has
 * to drag open first. The island keeps the live ENSO state visible at every tier and puts the lever one tap away.
 *
 * ## Why the text comes from `formatIsland` and never from a literal
 *
 * The prompt forbids a literal, and the reason is measurable: the e2e M9 case compares the DOM's text against
 * `formatIsland(store value)` computed IN THE PAGE. A hardcoded string, or a second formatting path, fails that
 * comparison the moment the slider moves — which is exactly the drift the rule exists to catch.
 *
 * ## The expanded scrubber is the SAME store action, not a second lever
 *
 * `onSstChange` is `setScenario({ sstAnomaly })` — the identical callback the desktop `ControlDeck`'s slider and
 * the sheet's own slider call. One action, three surfaces; the globe, the metrics and the sheet all move together
 * because there is nothing to keep in sync.
 */

import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { formatIsland } from '@/mobile/ensoHud';
import { SST_MAX, SST_MIN, thermalColor } from '@/lib/model';
import { fixed } from '@/lib/format';

interface TopIslandProps {
  /** The live global anomaly, from the store. */
  anomalyC: number;
  /** The SAME action the desktop deck and the sheet call. */
  onSstChange: (value: number) => void;
}

export function TopIsland({ anomalyC, onSstChange }: TopIslandProps) {
  const [expanded, setExpanded] = useState(false);
  const scrubberId = useId();
  const accent = thermalColor(anomalyC, 0.95);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center"
      /*
       * `env(safe-area-inset-top)` clears the notch/status bar. The capsule is the only thing in the top centre
       * on a phone, so a fixed 8 px gap below the inset is enough and does not need a second breakpoint.
       */
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)' }}
    >
      <div className="pointer-events-auto flex flex-col items-center">
        <div
          className={[
            'flex items-center gap-2 rounded-full border px-3 py-1.5 transition-colors duration-200',
            'border-white/12 bg-slate-950/80 backdrop-blur-md',
          ].join(' ')}
          style={{ minHeight: '44px' }}
        >
          {/*
            The capsule is a BUTTON, not a div with an onClick: it must be focusable and announce its expanded
            state. `aria-expanded` is what the M9 case reads.
          */}
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={scrubberId}
            onClick={() => setExpanded((v) => !v)}
            data-testid="mobile-island"
            className="flex min-h-[36px] items-center gap-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: accent }} />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-200">
              {formatIsland(anomalyC)}
            </span>
            <ChevronDown
              size={12}
              className={['text-slate-400 transition-transform duration-200', expanded ? 'rotate-180' : ''].join(' ')}
              aria-hidden
            />
          </button>
        </div>

        {/*
          The scrubber. Rendered only when expanded — it is the one thing in the island that costs a layout pass,
          and at rest the capsule is all a reader needs.

          `touch-action: pan-y` on the CONTAINER lets a vertical drag scroll the page rather than being eaten,
          while `touch-action: none` on the TRACK hands horizontal drags to the thumb — which is what makes a
          native range input feel like a slider and not like a scroll.
        */}
        <div
          id={scrubberId}
          hidden={!expanded}
          className="mt-2 w-[min(320px,86vw)] rounded-2xl border border-white/12 bg-slate-950/85 p-3 backdrop-blur-md"
          style={{ touchAction: 'pan-y' }}
        >
          <div className="mb-1.5 flex items-baseline justify-between">
            <label htmlFor={`${scrubberId}-range`} className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-slate-500">
              Global SST anomaly
            </label>
            <span className="num text-[13px] font-semibold" style={{ color: accent }}>
              {fixed(anomalyC, 2)} <span className="text-[9px] text-slate-400">°C</span>
            </span>
          </div>
          <input
            id={`${scrubberId}-range`}
            type="range"
            min={SST_MIN}
            max={SST_MAX}
            step={0.01}
            value={anomalyC}
            onChange={(e) => onSstChange(Number(e.target.value))}
            aria-label="Global SST anomaly"
            className="slider w-full"
            style={{ touchAction: 'none', minHeight: '44px' }}
          />
          <div className="mt-1 flex items-center justify-between font-mono text-[8px] uppercase tracking-[0.12em] text-slate-500">
            <span>Neutral</span>
            <span>Mega El Niño</span>
          </div>
        </div>
      </div>
    </div>
  );
}
