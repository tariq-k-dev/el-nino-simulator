/**
 * The mobile snap-sheet: one fixed element, three tiers, a scrollable body.
 *
 * ## DOM placement is a correctness requirement, not a style choice
 *
 * R3F connects its DOM listeners to the `<Canvas>` WRAPPER DIV (`react-three-fiber.esm.js:86`), and
 * `onPointerMissed` fires on a click that hits nothing in the scene (`events-*.esm.js:1157-1162`) — which the
 * app wires to `onSelect(null)` (`GlobeScene.tsx:622`). A sheet placed INSIDE that wrapper would therefore
 * clear the region selection on every tap on the sheet, because a tap on the sheet raycasts through to empty
 * space. `App.tsx` renders this component as a SIBLING of `#globe-canvas` for that reason, and the overlay
 * wrapper is `pointer-events: none` so the top of the screen still reaches OrbitControls at the peek tier.
 *
 * ## Why the tier state lives here and not in the store
 *
 * It is UI-local, it changes at most a few times per gesture, and nothing outside the sheet reads it except the
 * probe. The store is for values a SECOND, non-React reader needs every frame; a tier is not one.
 *
 * ## Why the body scrolls natively
 *
 * `touch-action: pan-y` plus `overscroll-behavior: contain` on the body means the browser owns the scroll, with
 * momentum and its own bounce contained to the sheet. Dragging is bound to the HANDLE only, so the two gesture
 * surfaces cannot compete: a touch that starts on the body scrolls, and a touch that starts on the handle drags.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnalyticsPayload, RegionDefinition, RegionId, ScenarioMetrics, UnitSystem } from '@/types/enso';
import { Stat } from '@/components/ui/Stat';
import { MetricBar } from '@/components/ui/MetricBar';
import { Sparkline } from '@/components/ui/Sparkline';
import { REGIONS, formatDelta } from '@/lib/regions';
import { thermalColor } from '@/lib/model';
import { fixed } from '@/lib/format';
import { ensoCategory, ensoLabel, formatAnomaly } from '@/mobile/ensoHud';
import { useSheetDrag, useSheetKeys } from '@/mobile/useSheetDrag';
import { sheetHeight, tierIndex, type Tier } from '@/mobile/snapMath';

/**
 * The marker the e2e build proves is ABSENT from production.
 *
 * Same convention as `LOCKED_BRANCH_MARKER` (`layout/framing.ts:45`): a literal that exists only inside a
 * `VITE_E2E`-gated block, so `check-assets.mjs` can grep `dist/assets/*.js` and find zero, while
 * `dist-e2e/assets/*.js` contains one. Assigned to `window.__mobileSheet.marker` below.
 */
export const MOBILE_SNAP_MARKER = 'mobile-snap-probe-3m1';

/** The probe shape the e2e build installs on `window`. */
export interface MobileSheetProbe {
  marker: string;
  tier: Tier;
  tierIndex: number;
  /** The sheet's own translate in px, read off the inline style, not off a rect. */
  translateY: number;
  /** Renders of this component since load. The M5 case asserts it does NOT move during a drag. */
  renders: number;
  /** Drags started so far — proof the gesture reached the engine at all, beside the render count. */
  drags: number;
  viewportH: number;
  sheetHeight: number;
  points: { peek: number; half: number; full: number };
  read: () => MobileSheetProbeState;
}

export interface MobileSheetProbeState {
  marker: string;
  tier: Tier;
  tierIndex: number;
  translateY: number;
  renders: number;
  drags: number;
  viewportH: number;
  sheetHeight: number;
  points: { peek: number; half: number; full: number };
}

interface SnapSheetProps {
  metrics: ScenarioMetrics;
  analytics: AnalyticsPayload;
  scenarioSst: number;
  region: RegionDefinition | null;
  units: UnitSystem;
  activeRegion: RegionId | null;
  onSelect: (id: RegionId) => void;
  onClearSelection: () => void;
  /** The desktop scrubber's own action, so the sheet's copy writes the same state. */
  onSstChange: (value: number) => void;
  /** Jets and cropland weight — the teleconnection sliders, reused rather than duplicated. */
  onChangeScenario: (patch: { jetStreamShift?: number; agricultureWeight?: number }) => void;
}

/**
 * The viewport height the sheet is sized against.
 *
 * `visualViewport.height` when it exists, because on a phone the LAYOUT viewport (`innerHeight`) includes the
 * area under a collapsing browser toolbar: sizing against it makes the sheet taller than the screen and pushes
 * its handle under the address bar. `innerHeight` is the fallback for engines without `visualViewport`.
 */
function readViewportHeight(): number {
  if (typeof window === 'undefined') return 0;
  const vv = window.visualViewport;
  if (vv && Number.isFinite(vv.height) && vv.height > 0) return vv.height;
  return window.innerHeight;
}

export function SnapSheet({
  metrics,
  analytics,
  scenarioSst,
  region,
  units,
  activeRegion,
  onSelect,
  onClearSelection,
  onSstChange,
  onChangeScenario,
}: SnapSheetProps) {
  const [tier, setTier] = useState<Tier>('peek');
  const [viewportH, setViewportH] = useState<number>(() => readViewportHeight());

  /**
   * Has the FULL tier ever been reached?
   *
   * The heavy sections mount on first arrival and stay mounted afterwards, so a reader who collapses the sheet
   * and opens it again does not pay for a re-mount (and a re-parse of the analogs table) on every snap. This is
   * the prompt's "lazily on first arrival, keep them mounted afterwards" and it is a one-way latch on purpose:
   * `||` rather than an assignment, so it can never go back to false.
   */
  const [fullMounted, setFullMounted] = useState(false);
  if (tier === 'full' && !fullMounted) setFullMounted(true);

  const onTierChange = useCallback((next: Tier) => setTier(next), []);
  const { sheetRef, handleRef, points, dragCount } = useSheetDrag({ tier, onTierChange, viewportH });
  const onKeyDown = useSheetKeys(tier, onTierChange);

  /* --------------------------------------------------------------- geometry plumbing */

  /**
   * Re-measure on resize, orientation change and visualViewport resize, coalesced to one per frame.
   *
   * Three sources because they are three different events on a phone: `resize` fires for a window drag,
   * `orientationchange` fires before the new metrics are settled (hence the rAF), and `visualViewport.resize`
   * is the ONLY one that fires when the address bar collapses. Throttling to a rAF is what keeps a rotation from
   * producing twenty measurements.
   */
  useEffect(() => {
    let frame: number | null = null;
    const measure = (): void => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        setViewportH(readViewportHeight());
      });
    };
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    window.visualViewport?.addEventListener('resize', measure);
    measure();
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, []);

  /* --------------------------------------------------------------------- the probe */

  const renderCount = useRef(0);
  renderCount.current += 1;

  /**
   * `window.__mobileSheet`, installed only in an instrumented build.
   *
   * A ref-held object with a `read()` rather than a snapshot: the M5 case polls it, and a getter-per-field
   * object would let six reads straddle two renders — the same reasoning `lib/frameProbe.ts` documents.
   */
  useEffect(() => {
    if (import.meta.env.VITE_E2E !== '1') return undefined;
    const probe: MobileSheetProbe = {
      marker: MOBILE_SNAP_MARKER,
      tier,
      tierIndex: tierIndex(tier),
      translateY: points[tier],
      renders: renderCount.current,
      drags: dragCount(),
      viewportH,
      sheetHeight: sheetHeight(viewportH),
      points,
      read: () => ({
        marker: MOBILE_SNAP_MARKER,
        tier,
        tierIndex: tierIndex(tier),
        translateY: points[tier],
        renders: renderCount.current,
        drags: dragCount(),
        viewportH,
        sheetHeight: sheetHeight(viewportH),
        points,
      }),
    };
    (window as unknown as { __mobileSheet?: MobileSheetProbe }).__mobileSheet = probe;
    return () => {
      delete (window as unknown as { __mobileSheet?: MobileSheetProbe }).__mobileSheet;
    };
  }, [tier, points, viewportH, dragCount]);

  /* ------------------------------------------------------------------------- render */

  const accent = thermalColor(metrics.sst, 0.95);
  const h = sheetHeight(viewportH);
  const isFull = tier === 'full';
  const isPeek = tier === 'peek';
  const analogSpark = analytics.timeline.map((p) => p.anomaly);
  const category = ensoCategory(scenarioSst);

  return (
    <div
      ref={sheetRef as React.RefObject<HTMLDivElement>}
      data-tier={tier}
      data-mobile-sheet=""
      role="region"
      aria-label="Impact analysis sheet"
      className={[
        'fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl border-t',
        /*
         * Backdrop rules per the prompt: blur at FULL only, flat at peek/half to protect WebGL frame time.
         * `backdrop-blur-xl` runs a second compositor pass over the whole sheet, which on a phone costs more
         * than the tier's extra content is worth while the globe is being dragged.
         */
        isFull
          ? 'border-white/12 bg-slate-950/80 backdrop-blur-xl'
          : 'border-white/[0.08] bg-slate-950/85',
        'shadow-[0_-8px_40px_-12px_rgba(0,0,0,0.9)]',
        /* `env(safe-area-inset-bottom)` keeps the last row clear of the home indicator. */
        'pb-[env(safe-area-inset-bottom)]',
      ].join(' ')}
      style={{
        height: `${h}px`,
        transform: `translate3d(0, ${points[tier]}px, 0)`,
        /*
         * Set once on mount so the FIRST paint is already at peek; the hook writes the style directly during
         * drags and on snap. Without this the element would paint at translateY(0) (full) for one frame.
         */
        transition: 'none',
      }}
    >
      {/* ------------------------------------------------------------- the handle zone */}
      {/*
        The handle plus the header row. `touch-action: none` here is what lets the browser hand the gesture to
        this element instead of claiming it for a page scroll, and it is scoped to this zone only so the body
        below keeps its native pan.
      */}
      <div
        ref={handleRef as React.RefObject<HTMLDivElement>}
        role="slider"
        tabIndex={0}
        aria-valuemin={0}
        aria-valuemax={2}
        aria-valuenow={tierIndex(tier)}
        aria-valuetext={tier === 'peek' ? 'Peek' : tier === 'half' ? 'Half' : 'Full'}
        aria-label="Sheet position"
        onKeyDown={onKeyDown}
        className="shrink-0 select-none px-4 pb-2 pt-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
        style={{ touchAction: 'none', minHeight: '44px' }}
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-white/25" aria-hidden />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-mono text-[10px] uppercase tracking-[0.16em] text-slate-400">
              {region ? region.name : 'Global ENSO state'}
            </div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="num text-[20px] font-semibold leading-none" style={{ color: accent }}>
                {formatAnomaly(scenarioSst)}
              </span>
              <span
                className="rounded-full px-1.5 py-[1px] font-mono text-[8.5px] uppercase tracking-[0.12em]"
                style={{ background: `${accent}22`, color: accent }}
              >
                {ensoLabel(category)}
              </span>
            </div>
          </div>
          <Sparkline data={analogSpark} height={26} accent={accent} ariaLabel="Dataset anomaly timeline" />
        </div>
      </div>

      {/* ------------------------------------------------------------------- the body */}
      <div
        className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 pb-4"
        style={{ touchAction: 'pan-y', overscrollBehavior: 'contain' }}
      >
        {/* ---------------- PEEK: the region pill, the anomaly badge and the mini sparkline live above. */}
        {!region ? (
          <p className="text-[11px] leading-relaxed text-slate-400">
            No impact zone selected. Tap a pin or pick a region below. The global signal is{' '}
            <span style={{ color: accent }}>{ensoLabel(category)}</span> at {formatAnomaly(scenarioSst)}.
          </p>
        ) : null}

        {/* ---------------- HALF: teleconnection sliders, core metrics, region switcher --------------- */}
        <div className={isPeek ? 'hidden' : 'contents'} aria-hidden={isPeek}>
          <div className={isPeek ? 'hidden' : 'mt-3 space-y-3'}>
            {/* The global anomaly scrubber, bound to the SAME action the desktop deck uses. */}
            <label className="block">
              <span className="mb-1 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">
                <span>Global SST anomaly</span>
                <span className="text-slate-300">{fixed(scenarioSst, 2)} °C</span>
              </span>
              <input
                type="range"
                min={0}
                max={3}
                step={0.01}
                value={scenarioSst}
                onChange={(e) => onSstChange(Number(e.target.value))}
                aria-label="Global SST anomaly"
                className="slider w-full"
                style={{ touchAction: 'pan-y', minHeight: '44px' }}
              />
            </label>
            <label className="block">
              <span className="mb-1 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">
                <span>Jet stream shift</span>
                <span className="text-slate-300">{fixed(metrics.jet, 2)}</span>
              </span>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.01}
                value={metrics.jet}
                onChange={(e) => onChangeScenario({ jetStreamShift: Number(e.target.value) })}
                aria-label="Jet stream shift"
                className="slider w-full"
                style={{ touchAction: 'pan-y', minHeight: '44px' }}
              />
            </label>
            <label className="block">
              <span className="mb-1 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">
                <span>Agriculture exposure weight</span>
                <span className="text-slate-300">{fixed(metrics.agri, 2)}</span>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={metrics.agri}
                onChange={(e) => onChangeScenario({ agricultureWeight: Number(e.target.value) })}
                aria-label="Agriculture exposure weight"
                className="slider w-full"
                style={{ touchAction: 'pan-y', minHeight: '44px' }}
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <Stat label="Global impact" value={fixed(metrics.globalImpactIndex, 1)} unit="/100" accent={accent} size="sm" />
              <Stat label="Agri exposure" value={fixed(metrics.agricultureExposure, 1)} unit="%" accent="#34d399" size="sm" />
            </div>

            {/*
              The FIX2 region switcher, in the sheet. Same REGIONS source, same `onSelect` path, same no-op on
              the active chip — the row a reader inside the drawer already knows.
            */}
            <div role="group" aria-label="Switch impact region" className="flex flex-wrap gap-1.5">
              {REGIONS.map((r) => {
                const active = activeRegion === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    data-region-id={r.id}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => {
                      if (active) return;
                      onSelect(r.id);
                    }}
                    className={[
                      'rounded-full border px-2.5 py-2 font-mono text-[9px] uppercase tracking-[0.12em] transition-colors',
                      'min-h-[44px] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50',
                      active
                        ? 'border-white/35 bg-white/12 text-white'
                        : 'border-white/[0.1] bg-black/25 text-slate-400',
                    ].join(' ')}
                    style={active ? { boxShadow: `0 0 12px -4px ${r.accent}` } : undefined}
                  >
                    {r.shortName}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ---------------- FULL: narrative, the DuckDB-backed sections, the impact breakdown -------- */}
        <div className={isFull ? 'mt-3 space-y-3' : 'hidden'} aria-hidden={!isFull}>
          {fullMounted ? (
            <FullTier
              region={region}
              metrics={metrics}
              analytics={analytics}
              units={units}
              accent={accent}
              onClearSelection={onClearSelection}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The full tier's own content.
 *
 * Split out so the lazy mount is a real boundary: this component's body does not run until the reader has
 * reached full, so the analogs table and the dataset footer cost nothing at peek. It also keeps `SnapSheet`'s
 * own render cheap, which is what the M5 render counter measures.
 */
function FullTier({
  region,
  metrics,
  analytics,
  units,
  accent,
  onClearSelection,
}: {
  region: RegionDefinition | null;
  metrics: ScenarioMetrics;
  analytics: AnalyticsPayload;
  units: UnitSystem;
  accent: string;
  onClearSelection: () => void;
}) {
  const bars = useMemo(
    () => [
      { label: 'US precip anomaly', value: metrics.usPrecip, accent: '#a78bfa', divergent: true },
      { label: 'SE Asia precip anomaly', value: metrics.asiaPrecip, accent: '#fb923c', divergent: true },
      { label: 'Horn precip anomaly', value: metrics.africaPrecip, accent: '#34d399', divergent: true },
      { label: 'Pacific convection', value: metrics.pacificConvection, accent: '#38bdf8' },
    ],
    [metrics],
  );

  return (
    <div className="space-y-3">
      {region ? (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.018] p-3">
          <p className="text-[10.5px] leading-relaxed text-slate-400">{region.mechanism}</p>
          <p className="mt-2 border-t border-white/[0.05] pt-2 text-[10.5px] leading-relaxed text-slate-300/85">
            {region.summary}
          </p>
        </div>
      ) : null}

      <div className="space-y-2.5">
        <div className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-slate-500">
          Impact breakdown
        </div>
        {bars.map((b) => (
          <MetricBar key={b.label} label={b.label} value={b.value} accent={b.accent} divergent={b.divergent} />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="US precip"
          value={formatDelta(metrics.usPrecip, '%')}
          unit=""
          accent="#a78bfa"
          size="sm"
        />
        <Stat
          label="Temp dev"
          value={formatDelta(units === 'imperial' ? metrics.usTempDevF : metrics.usTempDevF * (5 / 9), '°')}
          unit={units === 'imperial' ? 'F' : 'C'}
          accent="#a78bfa"
          size="sm"
        />
        <Stat label="Asia drought" value={fixed(metrics.asiaDrought, 2)} unit="/10" accent="#fb923c" size="sm" />
        <Stat label="Africa flood" value={fixed(metrics.africaFlood, 2)} unit="/10" accent="#34d399" size="sm" />
      </div>

      {/* The DuckDB-backed analog table. */}
      <div>
        <div className="mb-2 flex items-center justify-between font-mono text-[8.5px] uppercase tracking-[0.2em] text-slate-500">
          <span>Historical analogs</span>
          <span>{analytics.summary.analogCount} within ±0.35°C</span>
        </div>
        {analytics.analogs.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-white/[0.06]">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-white/[0.06] bg-white/[0.025]">
                  {['Month', 'N3.4', 'SST', 'Tier'].map((col) => (
                    <th
                      key={col}
                      className="px-2 py-1.5 font-mono text-[8px] font-medium uppercase tracking-[0.12em] text-slate-500"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {analytics.analogs.slice(0, 5).map((a) => (
                  <tr key={a.date} className="border-b border-white/[0.035] last:border-0">
                    <td className="num px-2 py-1.5 text-[10px] text-slate-300">{a.label}</td>
                    <td className="num px-2 py-1.5 text-[10px] text-slate-100">{fixed(a.anomaly, 2)}</td>
                    <td className="num px-2 py-1.5 text-[9.5px] text-slate-400">
                      {a.absoluteSst > 0 ? fixed(a.absoluteSst, 1) : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-[8px] text-slate-400">{a.riskTier}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-[10px] text-slate-500">
            Analog matching unavailable — DuckDB engine is not running.
          </div>
        )}
      </div>

      <div className="rounded-xl border border-white/[0.05] bg-black/25 p-2.5">
        <div className="mb-1 flex items-center justify-between font-mono text-[8px] uppercase tracking-[0.14em] text-slate-500">
          <span>Dataset window</span>
          <span className="text-slate-400">
            {analytics.summary.firstDate} → {analytics.summary.lastDate}
          </span>
        </div>
        <Sparkline data={analytics.timeline.map((p) => p.anomaly)} height={30} accent={accent} ariaLabel="Dataset anomaly timeline" />
        <div className="mt-1 flex items-center justify-between font-mono text-[8px] uppercase tracking-[0.1em] text-slate-500">
          <span>{analytics.summary.rowCount} monthly obs</span>
          <span>{analytics.queryMs > 0 ? `query ${fixed(analytics.queryMs, 1)} ms` : 'engine warming up'}</span>
        </div>
      </div>

      {region ? (
        <button
          type="button"
          onClick={onClearSelection}
          className="min-h-[44px] w-full rounded-xl border border-white/[0.08] bg-white/[0.03] font-mono text-[9px] uppercase tracking-[0.14em] text-slate-300"
        >
          Clear selection
        </button>
      ) : null}
    </div>
  );
}

/**
 * The render counter the M5 case reads, exposed through the probe as `renders`.
 *
 * Re-exported so a reader of this file can see the contract in one place; the value is `renderCount` inside the
 * component and the probe publishes it.
 */
export const RENDER_COUNTER_SOURCE = 'SnapSheet renderCount ref, published as __mobileSheet.renders';
