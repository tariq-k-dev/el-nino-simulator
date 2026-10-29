interface MetricBarProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  accent?: string;
  unit?: string;
  /** Zero-centred bars diverge left/right — right for precipitation anomalies. */
  divergent?: boolean;
  format?: (v: number) => string;
}

export function MetricBar({
  label,
  value,
  min = -60,
  max = 60,
  accent = '#38bdf8',
  unit = '%',
  divergent = false,
  format,
}: MetricBarProps) {
  const clamped = Math.min(max, Math.max(min, value));
  const display = format ? format(value) : `${value > 0 ? '+' : ''}${value.toFixed(1)}`;

  const pct = ((clamped - min) / (max - min)) * 100;
  const zeroPct = ((0 - min) / (max - min)) * 100;

  const barStyle = divergent
    ? value >= 0
      ? { left: `${zeroPct}%`, width: `${Math.max(0.6, pct - zeroPct)}%` }
      : { left: `${pct}%`, width: `${Math.max(0.6, zeroPct - pct)}%` }
    : { left: '0%', width: `${Math.max(0.6, pct)}%` };

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[9.5px] uppercase tracking-[0.13em] text-slate-400/75">{label}</span>
        <span className="num text-[11px] font-medium text-slate-200">
          {display}
          <span className="ml-0.5 text-[8.5px] text-slate-500">{unit}</span>
        </span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/[0.055]">
        {divergent ? (
          <div
            className="absolute top-0 h-full w-px bg-white/25"
            style={{ left: `${zeroPct}%` }}
            aria-hidden
          />
        ) : null}
        <div
          className="absolute top-0 h-full rounded-full transition-all duration-300 ease-out"
          style={{
            ...barStyle,
            background: `linear-gradient(90deg, ${accent}55, ${accent})`,
            boxShadow: `0 0 12px -2px ${accent}aa`,
          }}
        />
      </div>
    </div>
  );
}
