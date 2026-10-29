import type { ReactNode } from 'react';

interface StatProps {
  label: string;
  value: string;
  unit?: string;
  delta?: { value: string; positive: boolean } | null;
  icon?: ReactNode;
  accent?: string;
  hint?: string;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * The one metric cell used everywhere (cards, drawer, report). Tabular figures +
 * fixed baselines keep numbers from dancing as they change.
 */
export function Stat({ label, value, unit, delta, icon, accent = '#38bdf8', hint, size = 'md' }: StatProps) {
  const valueClass =
    size === 'lg' ? 'text-[26px] leading-none' : size === 'sm' ? 'text-[15px] leading-none' : 'text-[19px] leading-none';

  return (
    <div className="group/stat relative">
      <div className="mb-1.5 flex items-center gap-1.5">
        {icon ? <span style={{ color: accent }} className="opacity-80">{icon}</span> : null}
        <span className="text-[9.5px] font-medium uppercase tracking-[0.16em] text-slate-400/70">
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`num font-semibold text-slate-50 ${valueClass}`}>{value}</span>
        {unit ? <span className="num text-[10px] font-medium text-slate-400/80">{unit}</span> : null}
      </div>
      {delta ? (
        <div
          className={`num mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-[1px] text-[9.5px] font-medium ${
            delta.positive
              ? 'bg-emerald-400/10 text-emerald-300'
              : 'bg-rose-400/10 text-rose-300'
          }`}
        >
          {delta.positive ? '▲' : '▼'} {delta.value}
        </div>
      ) : null}
      {hint ? (
        <p className="mt-1 text-[10px] leading-snug text-slate-500">{hint}</p>
      ) : null}
      <div
        className="pointer-events-none absolute -bottom-2 left-0 h-px w-0 transition-all duration-500 group-hover/stat:w-full"
        style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }}
      />
    </div>
  );
}
