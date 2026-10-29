import { useCallback, useState } from 'react';
import { GlobeScene } from '@/scene/GlobeScene';
import { Header } from '@/components/Header';
import { ControlDeck } from '@/components/ControlDeck';
import { RegionDrawer } from '@/components/RegionDrawer';
import { RegionCards } from '@/components/RegionCards';
import { useScenario } from '@/state/useScenario';
import { REGION_MAP } from '@/lib/regions';
import { buildReportHtml, captureCanvas, downloadPng, openReport } from '@/lib/report';
import type { RegionId } from '@/types/enso';

export default function App() {
  const { scenario, setScenario, reset, analytics, units, toggleUnits } = useScenario();

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

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const snapshot = captureCanvas();
      if (snapshot) {
        downloadPng(
          snapshot,
          `el-nino-snapshot-${scenario.sstAnomaly.toFixed(2)}C.png`,
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
    <div className="relative h-full w-full overflow-hidden bg-void-950">
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

      {/* WebGL globe */}
      <div id="globe-canvas" className="absolute inset-0 z-10">
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

      <Header
        metrics={analytics.metrics}
        units={units}
        onToggleUnits={toggleUnits}
        onExport={handleExport}
        exporting={exporting}
      />

      {/* Left column: control deck */}
      <div className="pointer-events-none absolute bottom-0 left-0 z-20 flex w-full flex-col gap-3 p-4 sm:p-6 lg:w-auto">
        <div className="pointer-events-auto flex flex-col gap-2">
          <div className="hidden items-center gap-2 pl-1 lg:flex">
            <span className="h-px w-6 bg-gradient-to-r from-sky-400/60 to-transparent" />
            <span className="text-[8px] uppercase tracking-[0.24em] text-slate-500">
              Live Scenario Controls
            </span>
          </div>
          <ControlDeck
            scenario={scenario}
            metrics={analytics.metrics}
            timeline={timeline}
            onChange={setScenario}
            onReset={reset}
          />
        </div>
      </div>

      {/* Right column: region cards (desktop only) */}
      <div className="pointer-events-none absolute right-0 top-1/2 z-20 hidden -translate-y-1/2 p-4 lg:flex lg:p-6">
        <RegionCards metrics={analytics.metrics} activeRegion={activeRegion} onSelect={selectRegion} />
      </div>

      <RegionDrawer
        region={activeRegion ? REGION_MAP[activeRegion] : null}
        metrics={analytics.metrics}
        analytics={analytics}
        units={units}
        onClose={() => selectRegion(null)}
      />

      {/* Bottom-centre hint */}
      <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 hidden -translate-x-1/2 lg:block">
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
    </div>
  );
}
