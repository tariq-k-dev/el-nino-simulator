import { useEffect, useMemo, useRef } from 'react';
import { Activity, Gauge, Waves, X } from 'lucide-react';
import type { AnalyticsPayload, RegionDefinition, RegionId, ScenarioMetrics } from '@/types/enso';
import { Stat } from '@/components/ui/Stat';
import { MetricBar } from '@/components/ui/MetricBar';
import { Sparkline } from '@/components/ui/Sparkline';
import { deltaDisplay, formatDelta } from '@/lib/regions';
import { thermalColor } from '@/lib/model';

interface RegionDrawerProps {
  region: RegionDefinition | null;
  metrics: ScenarioMetrics;
  analytics: AnalyticsPayload;
  units: 'metric' | 'imperial';
  onClose: () => void;
}

interface RegionHud {
  headline: { label: string; value: string; unit: string };
  stats: Array<{ label: string; value: string; unit: string; hint?: string; accent: string }>;
  bars: Array<{ label: string; value: number; accent: string; divergent?: boolean }>;
  narrative: string;
  footprint: number;
}

function buildHud(id: RegionId, m: ScenarioMetrics, units: 'metric' | 'imperial'): RegionHud {
  switch (id) {
    case 'pacific': {
      const dev = deltaDisplay(m.pacificSstDev, units);
      return {
        headline: {
          label: 'SST Deviation',
          value: `${dev.value >= 0 ? '+' : ''}${dev.value.toFixed(2)}`,
          unit: dev.unit,
        },
        stats: [
          { label: 'Convection Shift', value: m.pacificConvection.toFixed(0), unit: '/100', accent: '#38bdf8' },
          { label: 'Walker Displacement', value: m.pacificConvection > 60 ? 'Severe' : m.pacificConvection > 35 ? 'Moderate' : 'Weak', unit: '', accent: '#38bdf8' },
          { label: 'Basin Anomaly', value: m.sst.toFixed(2), unit: '°C', accent: '#38bdf8' },
        ],
        bars: [
          { label: 'Convection displacement', value: m.pacificConvection, accent: '#38bdf8' },
          { label: 'SST stress vs. 1.0°C threshold', value: Math.min(100, (m.pacificSstDev / 3.45) * 100), accent: '#22d3ee' },
        ],
        narrative:
          m.sst >= 2
            ? 'Deep convection has migrated fully east of the dateline. The Walker circulation is inverted — expect record basin-wide warming and a strongly coupled atmosphere-ocean state.'
            : 'Warm water is pooling eastward but the coupling is still partial. Trade winds have weakened without fully reversing.',
        footprint: m.pacificConvection,
      };
    }
    case 'us-west':
      return {
        headline: {
          label: 'Precip Change',
          value: formatDelta(m.usPrecip, '%'),
          unit: '',
        },
        stats: [
          {
            // A deviation, not an absolute reading — see deltaDisplay().
            label: 'Temp Deviation',
            value: (() => {
              const d = deltaDisplay(m.usTempDevF * (5 / 9), units);
              return `${d.value >= 0 ? '+' : ''}${d.value.toFixed(1)}`;
            })(),
            unit: units === 'imperial' ? '°F' : '°C',
            accent: '#a78bfa',
          },
          { label: 'Base Precip Model', value: formatDelta(m.usPrecipBase, '%'), unit: '', accent: '#a78bfa' },
          { label: 'Jet Contribution', value: formatDelta(m.usPrecip - m.usPrecipBase, '%'), unit: '', accent: '#c4b5fd' },
        ],
        bars: [
          { label: 'Precipitation anomaly', value: m.usPrecip, accent: '#a78bfa', divergent: true },
          { label: 'Snowpack / reservoir recharge proxy', value: Math.min(100, Math.max(0, m.usPrecip * 1.1)), accent: '#8b5cf6' },
        ],
        narrative:
          m.usPrecip > 45
            ? 'An atmospheric-river pattern is locked in. Flood control and reservoir operations become the binding constraint, not water supply.'
            : m.usPrecip > 15
              ? 'A wet signal dominates, concentrated in a handful of high-intensity events rather than steady seasonal rainfall.'
              : 'The jet has not displaced far enough south to deliver a clear wet signal to California.',
        footprint: Math.abs(m.usPrecip),
      };
    case 'se-asia':
      return {
        headline: { label: 'Precip Change', value: formatDelta(m.asiaPrecip, '%'), unit: '' },
        stats: [
          { label: 'Drought Index', value: m.asiaDrought.toFixed(2), unit: '/10', accent: '#fb923c' },
          { label: 'Monsoon Deficit', value: `${Math.min(100, Math.abs(m.asiaPrecip)).toFixed(0)}`, unit: '%', accent: '#fb923c' },
          { label: 'Fire Weather', value: m.asiaDrought > 6 ? 'Extreme' : m.asiaDrought > 3 ? 'Elevated' : 'Normal', unit: '', accent: '#f97316' },
        ],
        bars: [
          { label: 'Precipitation anomaly', value: m.asiaPrecip, accent: '#fb923c', divergent: true },
          { label: 'Drought severity', value: (m.asiaDrought / 10) * 100, accent: '#f97316' },
        ],
        narrative:
          m.asiaDrought > 6
            ? 'The Maritime Continent is drying hard. Peatland fire risk and transboundary haze become the dominant regional hazards.'
            : 'Rainfall is suppressed but groundwater buffers are still absorbing the deficit.',
        footprint: Math.abs(m.asiaPrecip),
      };
    case 'horn-africa':
      return {
        headline: { label: 'Precip Change', value: formatDelta(m.africaPrecip, '%'), unit: '' },
        stats: [
          { label: 'Flood Index', value: m.africaFlood.toFixed(2), unit: '/10', accent: '#34d399' },
          { label: 'Short-Rains Surplus', value: `+${Math.max(0, m.africaPrecip).toFixed(0)}`, unit: '%', accent: '#34d399' },
          { label: 'Displacement Risk', value: m.africaFlood > 5 ? 'High' : m.africaFlood > 2.5 ? 'Moderate' : 'Low', unit: '', accent: '#10b981' },
        ],
        bars: [
          { label: 'Precipitation anomaly', value: m.africaPrecip, accent: '#34d399', divergent: true },
          { label: 'Flood severity', value: (m.africaFlood / 10) * 100, accent: '#10b981' },
        ],
        narrative:
          m.africaFlood > 5
            ? 'Short-rains totals are overwhelming arid catchments. Riverine flooding and vector-borne disease risk both spike.'
            : 'Moisture flux is above normal but within the range dryland infrastructure can usually absorb.',
        footprint: m.africaFlood * 10,
      };
  }
}

export function RegionDrawer({ region, metrics, analytics, units, onClose }: RegionDrawerProps) {
  const panelRef = useRef<HTMLElement>(null);
  const open = region !== null;
  const hud = useMemo(
    () => (region ? buildHud(region.id, metrics, units) : null),
    [region, metrics, units],
  );

  // Esc to close — the drawer covers a lot of the viewport, so a keyboard exit
  // is not optional.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const accent = region?.accent ?? '#38bdf8';
  const intensityColor = thermalColor(metrics.sst, 0.95);

  const analogSpark = analytics.timeline.map((p) => p.anomaly);

  return (
    <aside
      ref={panelRef}
      aria-hidden={!open}
      aria-label={region ? `${region.name} impact analysis` : 'Region impact analysis'}
      className={[
        'pointer-events-none absolute bottom-0 right-0 top-0 z-30 flex w-full max-w-[418px] flex-col',
        // Top padding clears the header's control row so neither overlaps.
        'p-3 sm:px-4 sm:pb-4 sm:pt-[76px]',
        'transition-transform duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]',
        open ? 'translate-x-0' : 'translate-x-[110%]',
      ].join(' ')}
    >
      <div className="glass pointer-events-auto flex h-full flex-col overflow-hidden rounded-2xl">
        {/* Header */}
        <div className="relative shrink-0 overflow-hidden border-b border-white/[0.08] px-4 pb-3.5 pt-4">
          <div
            className="absolute inset-x-0 top-0 h-[2px]"
            style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
          />
          <div
            className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full opacity-[0.14] blur-2xl"
            style={{ background: accent }}
          />

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: accent, boxShadow: `0 0 8px ${accent}` }}
                />
                <span className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-slate-400">
                  Impact Zone · {region?.lat.toFixed(0)}°{region && region.lat >= 0 ? 'N' : 'S'}{' '}
                  {Math.abs(region?.lon ?? 0).toFixed(0)}°{region && region.lon >= 0 ? 'E' : 'W'}
                </span>
              </div>
              <h2 className="truncate text-[17px] font-semibold leading-tight tracking-[-0.015em] text-slate-50">
                {region?.name ?? '—'}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-full border border-white/[0.08] p-1.5 text-slate-400 transition-colors hover:border-white/20 hover:text-slate-100"
              aria-label="Close region panel"
            >
              <X size={13} />
            </button>
          </div>

          {/* Headline metric */}
          {hud ? (
            <div className="relative mt-3 overflow-hidden rounded-xl border border-white/[0.08] bg-black/30 px-3 py-2.5">
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-[8.5px] uppercase tracking-[0.18em] text-slate-500">
                    {hud.headline.label}
                  </div>
                  <div className="mt-0.5 flex items-baseline gap-1">
                    <span className="num text-[30px] font-semibold leading-none tracking-[-0.045em]" style={{ color: accent }}>
                      {hud.headline.value}
                    </span>
                    <span className="num text-[11px] text-slate-400">{hud.headline.unit}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[8.5px] uppercase tracking-[0.18em] text-slate-500">Signal</div>
                  <div className="num mt-0.5 text-[10px] font-medium" style={{ color: intensityColor }}>
                    {metrics.riskTier}
                  </div>
                </div>
              </div>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/[0.07]">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, hud.footprint)}%`,
                    background: `linear-gradient(90deg, ${accent}66, ${accent})`,
                    boxShadow: `0 0 14px -2px ${accent}`,
                  }}
                />
              </div>
            </div>
          ) : null}
        </div>

        {/* Scrollable body */}
        <div className="scroll-thin flex-1 overflow-y-auto overscroll-contain px-4 py-3.5">
          {hud && region ? (
            <div className="space-y-4">
              <p className="text-[11.5px] leading-relaxed text-slate-300/90">{region.summary}</p>

              {/* Stat trio */}
              <div className="grid grid-cols-3 gap-2.5">
                {hud.stats.map((s) => (
                  <Stat key={s.label} label={s.label} value={s.value} unit={s.unit} accent={s.accent} size="sm" />
                ))}
              </div>

              <div className="hairline h-px w-full" />

              {/* Anomaly bars */}
              <div>
                <div className="mb-2 flex items-center gap-1.5">
                  <Gauge size={10} className="text-slate-500" />
                  <span className="text-[8.5px] uppercase tracking-[0.2em] text-slate-500">
                    Model Output
                  </span>
                </div>
                <div className="space-y-2.5">
                  {hud.bars.map((b) => (
                    <MetricBar
                      key={b.label}
                      label={b.label}
                      value={b.value}
                      accent={b.accent}
                      divergent={b.divergent}
                    />
                  ))}
                </div>
              </div>

              {/* Mechanism */}
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.018] p-3">
                <div className="mb-1.5 flex items-center gap-1.5">
                  <Activity size={10} style={{ color: accent }} />
                  <span className="text-[8.5px] uppercase tracking-[0.18em] text-slate-500">
                    Mechanism
                  </span>
                </div>
                <p className="text-[10.5px] leading-relaxed text-slate-400">{region.mechanism}</p>
                <p className="mt-2 border-t border-white/[0.05] pt-2 text-[10.5px] leading-relaxed text-slate-300/85">
                  {hud.narrative}
                </p>
              </div>

              {/* Historical analogs */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Waves size={10} className="text-slate-500" />
                    <span className="text-[8.5px] uppercase tracking-[0.2em] text-slate-500">
                      Historical Analogs
                    </span>
                  </div>
                  <span className="num text-[8.5px] text-slate-500">
                    {analytics.summary.analogCount} months within ±0.35°C
                  </span>
                </div>

                {analytics.analogs.length > 0 ? (
                  <div className="overflow-hidden rounded-xl border border-white/[0.06]">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="border-b border-white/[0.06] bg-white/[0.025]">
                          {['Month', 'N3.4 anom', 'SST', 'Δ', 'Tier'].map((h) => (
                            <th
                              key={h}
                              className="px-2 py-1.5 text-[8px] font-medium uppercase tracking-[0.12em] text-slate-500"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.analogs.slice(0, 5).map((a) => (
                          <tr
                            key={a.date}
                            className="border-b border-white/[0.035] last:border-0 hover:bg-white/[0.03]"
                          >
                            <td className="num px-2 py-1.5 text-[10px] text-slate-300">{a.label}</td>
                            <td className="num px-2 py-1.5 text-[10px] text-slate-100">
                              {a.anomaly.toFixed(2)}
                            </td>
                            <td className="num px-2 py-1.5 text-[9.5px] text-slate-400">
                              {a.absoluteSst > 0 ? a.absoluteSst.toFixed(1) : '—'}
                            </td>
                            <td className="num px-2 py-1.5 text-[9.5px] text-slate-500">
                              ±{a.delta.toFixed(2)}
                            </td>
                            <td className="px-2 py-1.5">
                              <span
                                className="rounded-full px-1.5 py-[1px] text-[8px] font-medium"
                                style={{
                                  background: `${thermalColor(a.anomaly, 0.14)}`,
                                  color: thermalColor(a.anomaly, 0.95),
                                }}
                              >
                                {a.riskTier}
                              </span>
                            </td>
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

              {/* Dataset footer */}
              <div className="rounded-xl border border-white/[0.05] bg-black/25 p-2.5">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[8px] uppercase tracking-[0.14em] text-slate-500">
                    Dataset window
                  </span>
                  <span className="num text-[8.5px] text-slate-400">
                    {analytics.summary.firstDate} → {analytics.summary.lastDate}
                  </span>
                </div>
                <Sparkline data={analogSpark} height={30} accent={accent} ariaLabel="Dataset anomaly timeline" />
                <div className="mt-1 flex items-center justify-between text-[8px] uppercase tracking-[0.1em] text-slate-500">
                  <span>{analytics.summary.rowCount} monthly obs</span>
                  <span>
                    peak {analytics.summary.maxAnomaly.toFixed(2)}°C · {analytics.summary.maxAnomalyDate}
                  </span>
                </div>
                {/* Provenance: a reader must be able to tell observed from modelled. */}
                <div className="mt-1.5 flex items-start gap-1 border-t border-white/[0.05] pt-1.5">
                  <span className="mt-[2px] h-1 w-1 shrink-0 rounded-full bg-emerald-400" />
                  <span className="text-[8px] leading-snug text-slate-500">
                    <span className="text-slate-400">{analytics.summary.source}</span> — SST observed ·
                    regional impact modelled
                  </span>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer CTA */}
        <div className="shrink-0 border-t border-white/[0.07] px-4 py-2.5">
          <div className="flex items-center justify-between">
            <span className="num text-[8.5px] uppercase tracking-[0.12em] text-slate-500">
              {analytics.queryMs > 0 ? `query ${analytics.queryMs.toFixed(1)} ms` : 'engine warming up'}
            </span>
            <span className="flex items-center gap-1 text-[8.5px] uppercase tracking-[0.12em] text-slate-500">
              <span className="h-1 w-1 rounded-full bg-emerald-400" />
              local · no server
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
