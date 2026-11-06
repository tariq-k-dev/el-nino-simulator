import { ChevronRight, CloudRain, Droplets, Flame, TreePine, Waves, Wind } from 'lucide-react';
import type { RegionId, ScenarioMetrics } from '@/types/enso';
import { REGION_MAP } from '@/lib/regions';
import { regionHeadline } from '@/lib/model';

const ICONS: Record<RegionId, typeof Waves> = {
  pacific: Waves,
  'us-west': CloudRain,
  'se-asia': Flame,
  'horn-africa': Droplets,
  'amazon-basin': TreePine,
  'gulf-coast': Wind,
};

const ORDER: RegionId[] = [
  'pacific',
  'us-west',
  'se-asia',
  'horn-africa',
  'amazon-basin',
  'gulf-coast',
];

interface RegionCardsProps {
  metrics: ScenarioMetrics;
  activeRegion: RegionId | null;
  onSelect: (id: RegionId) => void;
}

/**
 * Right-hand region stack. Rendered only in desktop mode — `App` mounts it inside `{!isMobile ? …}` — so the
 * column's own display no longer needs a breakpoint. The old `hidden … lg:flex` pair was a second, independent
 * copy of the mode decision, keyed on Tailwind's 1024; TABLET-PORTRAIT decoupled the mode law from that number,
 * and a responsive display utility beats an unconditional `hidden`, so keeping both would let a stylesheet
 * outvote the JS gate. The globe keeps its screen budget by the mount condition, which is the honest place for
 * the decision: an unmounted panel cannot be measured by the insets registry either.
 */
export function RegionCards({ metrics, activeRegion, onSelect }: RegionCardsProps) {
  return (
    <div className="pointer-events-auto flex w-[268px] flex-col gap-2">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-[9px] uppercase tracking-[0.2em] text-slate-500">Impact Zones</span>
        <span className="num text-[9px] text-slate-600">{ORDER.length} active</span>
      </div>

      {ORDER.map((id) => {
        const region = REGION_MAP[id];
        const Icon = ICONS[id];
        const active = activeRegion === id;
        const headline = regionHeadline(metrics, id);

        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            className={[
              // Solid dark fill, not bg-black/35: these cards float over the
              // brightest part of the day side, and a translucent panel there
              // drops the body copy below a readable contrast ratio.
              'group relative flex w-full items-center gap-3.5 overflow-hidden rounded-xl border px-4 py-3 text-left backdrop-blur-md transition-all duration-300',
              active
                ? 'border-[rgba(255,255,255,0.22)] bg-[rgba(10,15,25,0.88)] shadow-[0_10px_30px_-12px_rgba(0,0,0,0.95)]'
                : 'border-[rgba(255,255,255,0.12)] bg-[rgba(10,15,25,0.82)] hover:border-[rgba(255,255,255,0.24)] hover:bg-[rgba(14,20,32,0.9)]',
            ].join(' ')}
            style={{ textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}
          >
            <span
              className="absolute inset-y-0 left-0 w-[2px] transition-opacity duration-300"
              style={{
                background: `linear-gradient(180deg, transparent, ${region.accent}, transparent)`,
                opacity: active ? 1 : 0.35,
              }}
            />

            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors"
              style={{
                background: active ? `${region.accent}22` : 'rgba(255,255,255,0.04)',
                color: active ? region.accent : 'rgba(148,163,184,0.85)',
              }}
            >
              <Icon size={12} />
            </span>

            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium leading-tight text-slate-100">
                {region.name}
              </div>
              <div className="num mt-0.5 text-[10px] font-medium" style={{ color: region.accent }}>
                {headline}
              </div>
              <p
                className={[
                  'overflow-hidden text-[9.5px] leading-snug text-slate-500 transition-all duration-300',
                  active ? 'mt-1 max-h-16 opacity-100' : 'max-h-0 opacity-0 group-hover:mt-1 group-hover:max-h-16 group-hover:opacity-100',
                ].join(' ')}
              >
                {region.summary}
              </p>
            </div>

            <ChevronRight
              size={11}
              className={`shrink-0 transition-all duration-300 ${
                active ? 'translate-x-0 text-slate-300' : '-translate-x-1 text-slate-600 group-hover:translate-x-0 group-hover:text-slate-400'
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}
