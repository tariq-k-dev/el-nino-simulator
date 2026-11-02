import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { GlobeScene } from '@/scene/GlobeScene';
import { MobileShell } from '@/mobile/MobileShell';
import { getLayoutSignal, startLayoutObserver, subscribeLayout } from '@/scene/viewStore';
import { isMobileMode } from '@/mobile/layoutMath';
import { Header } from '@/components/Header';
import { ControlDeck } from '@/components/ControlDeck';
import { RegionDrawer } from '@/components/RegionDrawer';
import { RegionCards } from '@/components/RegionCards';
import { useScenario } from '@/state/useScenario';
import { REGION_MAP } from '@/lib/regions';
import { buildReportHtml, captureCanvas, downloadPng, openReport } from '@/lib/report';
import type { RegionId } from '@/types/enso';
import { fixed } from '@/lib/format';

export default function App() {
  const {
    scenario,
    setScenario,
    reset,
    analytics,
    history,
    retryHistory,
    units,
    toggleUnits,
  } = useScenario();

  /**
   * Which layout to render, and the two numbers the mobile free rectangle starts from.
   *
   * `useSyncExternalStore` on the same module-scope lane `CameraDirector` reads non-reactively inside its frame
   * loop. One listener, one value, three readers (this shell, the director, the probe): the camera and the DOM
   * can therefore never disagree about which layout is mounted, which is the property the M1 case checks at 767,
   * 768 and 1024.
   *
   * The observer is started HERE rather than only by the director because `data-layout-mode` has to be right on
   * the first paint, and `startLayoutObserver` reads synchronously. `App` mounts before the scene does, so this
   * is the first component that can start it. It is ref-counted, so the director's own call joins this one.
   */
  useEffect(() => startLayoutObserver(), []);
  const layout = useSyncExternalStore(subscribeLayout, getLayoutSignal, getLayoutSignal);
  const isMobile = isMobileMode(layout.mode);

  const [activeRegion, setActiveRegion] = useState<RegionId | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [booted, setBooted] = useState(false);

  const selectRegion = useCallback((id: RegionId | null) => {
    setActiveRegion((prev) => {
      // Re-clicking the active region re-centres the camera on it.
      if (prev === id && id !== null) setFocusNonce((n) => n + 1);
      return id;
    });
  }, []);

  /**
   * The selection clearer on its own, for Reset (step 3B2-FIX1 B).
   *
   * Deliberately the SAME `selectRegion(null)` the drawer's X and the Escape key call — the prompt's
   * requirement is that Reset take the existing close path rather than a parallel one, so there is one
   * piece of code that knows how the app deselects. Its signature takes no arguments, so a caller cannot
   * accidentally select a region through it.
   */
  const clearSelection = useCallback(() => selectRegion(null), [selectRegion]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const snapshot = captureCanvas();
      if (snapshot) {
        downloadPng(
          snapshot,
          `el-nino-snapshot-${fixed(scenario.sstAnomaly, 2)}C.png`,
        );
      }
      const html = buildReportHtml({
        scenario,
        metrics: analytics.metrics,
        analytics,
        activeRegion,
        snapshot,
      });
      openReport(html);
    } finally {
      setExporting(false);
    }
  }, [scenario, analytics, activeRegion]);

  const timeline = analytics.timeline.map((p) => p.anomaly);

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-void-950"
      /* The mode as an attribute, so a spec (and a reader of the DOM) can see what the camera sees. */
      data-layout-mode={layout.mode}
    >
      {/* Ambient depth: two fixed radial washes behind the canvas */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <div
          className="absolute left-1/2 top-1/2 h-[140vh] w-[140vh] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60"
          style={{
            background:
              'radial-gradient(circle, rgba(14,42,74,0.55) 0%, rgba(6,12,24,0.2) 42%, transparent 68%)',
          }}
        />
        <div
          className="absolute -bottom-1/3 left-1/2 h-[80vh] w-[120vw] -translate-x-1/2 opacity-40"
          style={{
            background:
              'radial-gradient(ellipse at center, rgba(251,146,60,0.10) 0%, transparent 62%)',
          }}
        />
      </div>

      {/* WebGL globe.
          `touch-action: none` is what lets OrbitControls receive a two-finger
          pinch: with the default `auto` the browser claims the gesture for
          page zoom/scroll and cancels the pointer stream, so pinch did nothing
          even once the camera was no longer being overwritten every frame.
          `overscroll-behavior: contain` stops a drag at the viewport edge from
          triggering pull-to-refresh / rubber-band over the canvas. */}
      <div
        id="globe-canvas"
        className="absolute inset-0 z-10"
        style={{ touchAction: 'none', overscrollBehavior: 'contain' }}
      >
        <GlobeScene
          sst={scenario.sstAnomaly}
          metrics={analytics.metrics}
          activeRegion={activeRegion}
          onSelect={selectRegion}
          focusNonce={focusNonce}
          onLoaded={() => setBooted(true)}
        />
      </div>

      {/* Boot veil — fades the moment the first WebGL frame lands */}
      <div
        className={[
          'pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-void-950 transition-opacity duration-700',
          booted ? 'opacity-0' : 'opacity-100',
        ].join(' ')}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="relative h-10 w-10">
            <span className="absolute inset-0 animate-ping rounded-full border border-sky-400/40" />
            <span className="absolute inset-2 rounded-full bg-sky-400/20 blur-sm" />
            <span className="absolute inset-[15px] rounded-full bg-sky-300" />
          </div>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.28em] text-slate-500">
            Initialising globe
          </span>
        </div>
      </div>

      {/*
        The desktop header renders only in desktop mode (step 3-MOBILE1 D). On a phone the island carries the live
        ENSO state and the scrubber, and the `MobileShell` renders an `sr-only` h1 in its place — so the document
        has exactly one level-one heading either way and never two.
      */}
      {!isMobile ? (
        <Header
          metrics={analytics.metrics}
          units={units}
          onToggleUnits={toggleUnits}
          onExport={handleExport}
          exporting={exporting}
          onClearSelection={clearSelection}
        />
      ) : null}

      {/*
        Left column: control deck.

        `data-occluder` is a MEASUREMENT MARKER for the framing work (step C): the insets registry
        reads it to know which side of the canvas this element covers. It carries no styling and
        changes no layout — the attribute is the whole change.
      */}
      <div
        data-occluder="left-panel"
        className={[
          /*
           * The `lg:` width utility is gone from this element, and the width is chosen by the JS mode instead.
           *
           * Why: `lg:` is Tailwind's 1024 and `DESKTOP_MIN_W` was 1024 too, so the two agreed by coincidence, not
           * by construction. TABLET-PORTRAIT makes the mode aspect-aware, so agreement has to be enforced rather
           * than assumed — a `lg:` utility keeps asserting "1024 and up" no matter what the law says.
           *
           * This element is the benign case: its only `lg:` utility was `lg:w-auto`, a WIDTH utility that does
           * not touch display, so it was the one of the five sites where `hidden` still won (measured). The other
           * four carried `lg:flex` / `lg:block`, and there a responsive display utility beat the unconditional
           * `hidden` outright — which is the mechanism this rule exists to remove. Folding the width into the
           * mode keeps this element consistent with that fix rather than half-converted.
           *
           * `sm:p-6` stays: it is inside-component spacing and does not choose the shell.
           */
          'pointer-events-none absolute bottom-0 left-0 z-20 flex flex-col gap-3 p-4 sm:p-6',
          /* Desktop sizes to its content; mobile is hidden, so the width never renders. */
          isMobile ? 'hidden w-full' : 'w-auto',
        ].join(' ')}
      >
        <div className="pointer-events-auto flex flex-col gap-2">
          {/* `lg:flex` removed: this row's whole existence is desktop-only, and the parent already gates on isMobile. */}
          <div className="flex items-center gap-2 pl-1">
            <span className="h-px w-6 bg-gradient-to-r from-sky-400/60 to-transparent" />
            <span className="text-[8px] uppercase tracking-[0.24em] text-slate-500">
              Live Scenario Controls
            </span>
          </div>
          <ControlDeck
            scenario={scenario}
            metrics={analytics.metrics}
            timeline={timeline}
            history={history}
            onRetryHistory={retryHistory}
            onChange={setScenario}
            onReset={reset}
          />
        </div>
      </div>

      {/* Right column: region cards (desktop only) — marked for the insets registry, see above. */}
      {/*
        Impact Zones cards — DESKTOP ONLY, and by CONDITIONAL RENDER rather than a CSS class. The prompt asks that
        the desktop cards be absent on mobile, and `hidden` would leave them in the DOM for a screen reader and for
        the insets registry, which reads `[data-occluder]` rects: a `display:none` panel reports a zero-area rect
        and is ignored (`layout/insets.ts:117-123`), so it would be harmless — but "absent" is a stronger and
        simpler claim than "harmless", and it is the one the spec checks.
      */}
      {!isMobile ? (
        <div
          data-occluder="right-panel"
          /* `lg:flex` removed — `{!isMobile ? …}` above already decides existence, so the class only added a
             second, disagreeable copy of the same decision. `p-6` is now unconditional where `lg:p-6` was: in
             mobile mode this element does not render at all, and the baseline this must reproduce was measured
             at >= 1024, where `lg:p-6` was the padding in force. */
          className="pointer-events-none absolute right-0 top-1/2 z-20 flex -translate-y-1/2 p-6"
        >
          <RegionCards metrics={analytics.metrics} activeRegion={activeRegion} onSelect={selectRegion} />
        </div>
      ) : null}

      {/*
        The drawer is DESKTOP ONLY. Its `data-occluder="right-drawer"` marker feeds the insets registry, and that
        measurement is what sets the desktop right inset — so on a phone it must not be mounted at all, or the
        registry would report an inset from a panel the mobile framing ignores.
      */}
      {!isMobile ? (
      <RegionDrawer
        region={activeRegion ? REGION_MAP[activeRegion] : null}
        metrics={analytics.metrics}
        analytics={analytics}
        units={units}
        onClose={() => selectRegion(null)}
        /*
         * The switcher retargets through the SAME path the cards use, so the drawer stays open (its
         * open/closed state is a function of `activeRegion`) and the camera flies the same arc it would
         * have flown from a card click. Deliberately NOT `clearSelection` + select: that would close and
         * reopen the drawer, moving focus off the chip the user just pressed.
         */
        onSelect={selectRegion}
      />
      ) : null}

      {/*
        THE MOBILE SHELL. A sibling of `#globe-canvas`, never a descendant: R3F connects its DOM listeners to the
        Canvas WRAPPER div and fires `onPointerMissed` on any click that hits nothing in the scene, so a sheet
        inside that wrapper would clear the selection on every tap. See `MOBILE-AUDIT.md` section 5.
      */}
      {isMobile ? (
        <MobileShell
          mode={layout.mode}
          viewportW={layout.width}
          headerBottom={layout.headerBottom}
          scenario={scenario}
          metrics={analytics.metrics}
          analytics={analytics}
          region={activeRegion ? REGION_MAP[activeRegion] : null}
          activeRegion={activeRegion}
          units={units}
          onSelect={selectRegion}
          onClearSelection={clearSelection}
          onScenarioChange={setScenario}
          exporting={exporting}
          onToggleUnits={toggleUnits}
          onExport={handleExport}
        />
      ) : null}

      {/*
        Bottom-centre hint — desktop only, because it names a mouse. The condition is `!isMobile`, the same one
        the desktop header and panels use: the old `hidden lg:block` pair let Tailwind's 1024 decide, which is
        the breakpoint TABLET-PORTRAIT deliberately decoupled from the mode law.
      */}
      {!isMobile ? (
      <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 block">
        <div className="flex items-center gap-3 rounded-full border border-white/[0.06] bg-black/30 px-3 py-1 backdrop-blur-sm">
          {[
            ['Drag', 'orbit'],
            ['Scroll', 'zoom'],
            ['Click pin', 'inspect'],
          ].map(([k, v]) => (
            <span key={k} className="flex items-center gap-1 text-[8.5px] uppercase tracking-[0.12em] text-slate-500">
              <kbd className="rounded border border-white/12 bg-white/[0.06] px-1 py-[1px] font-mono text-[8px] text-slate-300">
                {k}
              </kbd>
              {v}
            </span>
          ))}
        </div>
      </div>
      ) : null}
    </div>
  );
}
