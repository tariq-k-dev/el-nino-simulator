import { useId, useMemo } from 'react';

interface SparklineProps {
  data: number[];
  height?: number;
  accent?: string;
  fill?: boolean;
  /** Highlight this value on the line (e.g. the current scenario). */
  markerValue?: number;
  className?: string;
  ariaLabel?: string;
}

/**
 * Hand-rolled SVG sparkline — no chart library. For a 120-point series an SVG
 * path is a few hundred bytes and rerenders in well under a millisecond, which
 * is exactly why pulling in Recharts/D3 here would be the wrong trade.
 */
export function Sparkline({
  data,
  height = 40,
  accent = '#38bdf8',
  fill = true,
  markerValue,
  className = '',
  ariaLabel,
}: SparklineProps) {
  const gradientId = useId().replace(/:/g, '');

  const { line, area, markerY } = useMemo(() => {
    if (data.length === 0) return { line: '', area: '', markerY: null as number | null };

    const W = 100;
    const H = 100;
    const pad = 4;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    const stepX = (W - pad * 2) / Math.max(1, data.length - 1);

    const pts = data.map((v, i) => {
      const x = pad + i * stepX;
      const y = H - pad - ((v - min) / span) * (H - pad * 2);
      return [x, y] as const;
    });

    const linePath = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    const areaPath = `${linePath} L${pts[pts.length - 1][0].toFixed(2)},${H} L${pts[0][0].toFixed(2)},${H} Z`;

    const my =
      markerValue === undefined
        ? null
        : H - pad - ((Math.min(Math.max(markerValue, min), max) - min) / span) * (H - pad * 2);

    return { line: linePath, area: areaPath, markerY: my };
  }, [data, markerValue]);

  if (data.length === 0) {
    return <div className={`h-[40px] w-full rounded bg-white/[0.03] ${className}`} aria-hidden />;
  }

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={`w-full ${className}`}
      style={{ height }}
      role="img"
      aria-label={ariaLabel ?? 'Time series sparkline'}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.32" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill ? <path d={area} fill={`url(#${gradientId})`} /> : null}
      <path d={line} fill="none" stroke={accent} strokeWidth="1.4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {markerY !== null ? (
        <line
          x1="0"
          x2="100"
          y1={markerY}
          y2={markerY}
          stroke="#fbbf24"
          strokeWidth="1"
          strokeDasharray="3 3"
          opacity="0.75"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  );
}
