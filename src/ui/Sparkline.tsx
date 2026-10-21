import React, { useMemo } from 'react';

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  /** Klasa koloru linii (np. 'text-accent'); linia używa currentColor */
  className?: string;
  ariaLabel: string;
  /** Wypełnienie obszaru ~10% krycia */
  area?: boolean;
}

/** Mała linia trendu (2 px, zaokrąglone złącza, kropka na końcu). Bez osi — opis w aria-label. */
export const Sparkline: React.FC<SparklineProps> = ({ values, width = 96, height = 28, className = 'text-accent', ariaLabel, area = true }) => {
  const { d, fill, last } = useMemo(() => {
    const v = values.filter(Number.isFinite);
    if (v.length < 2) return { d: '', fill: '', last: null as null | { x: number; y: number } };
    const min = Math.min(...v);
    const max = Math.max(...v);
    const span = max - min || 1;
    const pad = 3;
    const pts = v.map((y, i) => ({
      x: pad + (i / (v.length - 1)) * (width - pad * 2),
      y: pad + (1 - (y - min) / span) * (height - pad * 2),
    }));
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
    const areaPath = `${line}L${pts[pts.length - 1].x.toFixed(1)},${height}L${pts[0].x.toFixed(1)},${height}Z`;
    return { d: line, fill: areaPath, last: pts[pts.length - 1] };
  }, [values, width, height]);

  if (!d) return <span className="inline-block text-ink-3 text-[11px]" style={{ width, height }} aria-label={ariaLabel}>—</span>;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} className={className}>
      {area && <path d={fill} fill="currentColor" opacity={0.1} />}
      <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {last && <circle cx={last.x} cy={last.y} r={3} fill="currentColor" stroke="var(--color-surface-1)" strokeWidth={2} />}
    </svg>
  );
};
