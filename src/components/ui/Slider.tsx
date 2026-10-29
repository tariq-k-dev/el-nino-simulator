import { useId, useMemo } from 'react';
import { fixed } from '@/lib/format';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  hint?: string;
  accent?: string;
  format?: (value: number) => string;
  onChange: (value: number) => void;
  /** Rendered under the label — e.g. a pair of endpoint captions. */
  scale?: [string, string];
  markers?: Array<{ at: number; label: string }>;
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  unit = '',
  hint,
  accent = '#38bdf8',
  format,
  onChange,
  scale,
  markers,
}: SliderProps) {
  const id = useId();
  const pct = useMemo(() => ((value - min) / (max - min)) * 100, [value, min, max]);
  const display = format ? format(value) : fixed(value, 2);

  const trackStyle = {
    background: `linear-gradient(90deg, ${accent} 0%, ${accent} ${pct}%, rgba(148,197,255,0.16) ${pct}%, rgba(148,197,255,0.16) 100%)`,
  };

  return (
    <div className="select-none">
      {label ? (
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <label htmlFor={id} className="text-[10px] font-medium uppercase tracking-[0.15em] text-slate-400/80">
            {label}
          </label>
          <span className="num flex items-baseline gap-0.5 text-[13px] font-semibold text-slate-100">
            {display}
            {unit ? <span className="text-[9px] font-medium text-slate-400">{unit}</span> : null}
          </span>
        </div>
      ) : null}

      <div className="relative">
        <input
          id={id}
          type="range"
          className="slider relative z-10"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label || 'Value'}
          aria-valuetext={`${display}${unit}`}
          style={{ ['--accent' as string]: accent }}
        />
        {/* Painted track sits under the transparent native input */}
        <div
          className="pointer-events-none absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full"
          style={trackStyle}
          aria-hidden
        />
        {markers?.map((m) => {
          const left = ((m.at - min) / (max - min)) * 100;
          return (
            <span
              key={m.label}
              className="num pointer-events-none absolute -bottom-4 -translate-x-1/2 text-[8px] uppercase tracking-wide text-slate-500"
              style={{ left: `${left}%` }}
              aria-hidden
            >
              {m.label}
            </span>
          );
        })}
      </div>

      <div className={`flex items-center justify-between ${markers ? 'mt-4' : 'mt-1'}`}>
        {scale ? (
          <>
            <span className="num text-[8.5px] uppercase tracking-[0.12em] text-slate-500">{scale[0]}</span>
            <span className="num text-[8.5px] uppercase tracking-[0.12em] text-slate-500">{scale[1]}</span>
          </>
        ) : (
          <span className="text-[10px] leading-snug text-slate-500">{hint}</span>
        )}
      </div>
    </div>
  );
}
