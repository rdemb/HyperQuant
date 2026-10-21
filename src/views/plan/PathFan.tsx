import React, { useEffect, useMemo, useRef, useState } from 'react';
import { scaleLinear } from 'd3';
import { McResult, PathOutcome } from '../../utils/planAnalyzer';
import { fmtPrice } from '../../ui';
import { fmtMinutes } from './hooks';

interface PathFanProps {
  mc: McResult;
  entry: number;
  stop: number;
  target: number;
  height?: number;
}

const OUTCOME_STROKE: Record<PathOutcome, string> = {
  target: 'var(--color-buy)',
  stop: 'var(--color-sell)',
  none: 'var(--color-ink-3)',
};

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const fmtAxisMin = (m: number) => (m === 0 ? '0' : m < 60 ? `${m}m` : m % 60 === 0 ? `${m / 60}h` : `${(m / 60).toFixed(1)}h`);

/**
 * Wachlarz ścieżek Monte Carlo: ~18 próbek (cienkie linie wg wyniku), pasmo P10–P90 i mediana,
 * poziomy wejście/stop/cel. Jedna oś Y (cena). Hover/dotyk: crosshair + podpowiedź z kwantylami.
 */
export const PathFan: React.FC<PathFanProps> = ({ mc, entry, stop, target, height = 240 }) => {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 52, r: 12, t: 12, b: 24 };
  const W = Math.max(0, width);
  const { times, band, paths, hitByTime } = mc.samples;
  const horizon = times[times.length - 1] || 1;

  const geo = useMemo(() => {
    let lo = Math.min(entry, stop, target);
    let hi = Math.max(entry, stop, target);
    for (const b of band) {
      lo = Math.min(lo, b.p10);
      hi = Math.max(hi, b.p90);
    }
    for (const p of paths) for (const pt of p.points) {
      lo = Math.min(lo, pt.price);
      hi = Math.max(hi, pt.price);
    }
    const span = hi - lo || entry * 0.001;
    const y = scaleLinear().domain([lo - span * 0.05, hi + span * 0.05]).range([height - pad.b, pad.t]);
    const x = scaleLinear().domain([0, horizon]).range([pad.l, Math.max(pad.l + 1, W - pad.r)]);
    const line = (pts: { t: number; price: number }[]) =>
      pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.price).toFixed(1)}`).join('');
    const area =
      band.map((b, i) => `${i ? 'L' : 'M'}${x(times[i]).toFixed(1)},${y(b.p90).toFixed(1)}`).join('') +
      [...band]
        .reverse()
        .map((b, i) => `L${x(times[band.length - 1 - i]).toFixed(1)},${y(b.p10).toFixed(1)}`)
        .join('') +
      'Z';
    const median = line(band.map((b, i) => ({ t: times[i], price: b.p50 })));
    const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(horizon * f));
    return { x, y, line, area, median, yTicks: y.ticks(4), xTicks };
  }, [band, paths, times, entry, stop, target, horizon, W, height, pad.b, pad.t, pad.l, pad.r]);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = geo.x.invert(pad.l + (e.clientX - rect.left));
    let best = 0;
    for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i;
    setHover(best);
  };

  // Etykiety poziomów rozsuwane, gdy linie leżą bliżej niż 14 px
  const levels = [
    { key: 'target', price: target, label: 'Cel', stroke: 'var(--color-buy)' },
    { key: 'entry', price: entry, label: 'Wejście', stroke: 'var(--color-ink-2)' },
    { key: 'stop', price: stop, label: 'Stop', stroke: 'var(--color-sell)' },
  ]
    .map((l) => ({
      ...l,
      y: geo.y(l.price),
      labelY: geo.y(l.price) - 5,
      // Szerokość tła etykiety: znacznik + tekst mono 10 px (~6.2 px/znak)
      lw: 16 + (l.label.length + 1 + fmtPrice(l.price, 0).length) * 6.2,
    }))
    .sort((a, b) => a.labelY - b.labelY);
  for (let i = 1; i < levels.length; i++) {
    if (levels[i].labelY - levels[i - 1].labelY < 14) levels[i].labelY = levels[i - 1].labelY + 14;
  }
  const hb = hover !== null ? band[hover] : null;
  const hx = hover !== null ? geo.x(times[hover]) : 0;

  return (
    <div className="min-w-0">
      <div ref={ref} className="relative w-full" style={{ height }}>
        {W > 0 && (
          <svg width={W} height={height} role="img" aria-label={`Wachlarz ${paths.length} przykładowych ścieżek Monte Carlo z pasmem P10–P90 w horyzoncie ${fmtMinutes(horizon)}`}>
            {/* Siatka hairline i oś Y (cena) */}
            {geo.yTicks.map((v) => (
              <g key={v}>
                <line x1={pad.l} x2={W - pad.r} y1={geo.y(v)} y2={geo.y(v)} stroke="var(--color-line)" strokeWidth={1} />
                <text x={pad.l - 6} y={geo.y(v)} dy="0.32em" textAnchor="end" className="fill-ink-3 font-mono" fontSize={10}>
                  {fmtPrice(v, 0)}
                </text>
              </g>
            ))}
            {geo.xTicks.map((t) => (
              <text key={t} x={geo.x(t)} y={height - 6} textAnchor="middle" className="fill-ink-3 font-mono" fontSize={10}>
                {fmtAxisMin(t)}
              </text>
            ))}
            {/* Pasmo P10–P90 (~10% krycia) i mediana */}
            <path d={geo.area} fill="var(--color-accent)" opacity={0.1} />
            {paths.map((p, i) => (
              <path
                key={i}
                d={geo.line(p.points)}
                fill="none"
                stroke={OUTCOME_STROKE[p.outcome]}
                strokeWidth={1.25}
                strokeOpacity={0.75}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            <path d={geo.median} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" />
            {/* Poziomy planu */}
            {levels.map((l) => (
              <g key={l.key}>
                <line x1={pad.l} x2={W - pad.r} y1={l.y} y2={l.y} stroke={l.stroke} strokeWidth={1} />
                <rect x={W - pad.r - l.lw} y={l.labelY - 10} width={l.lw} height={13} rx={2} fill="var(--color-surface-1)" opacity={0.85} />
                <rect x={W - pad.r - l.lw + 3} y={l.labelY - 6} width={6} height={6} rx={1} fill={l.stroke} />
                <text x={W - pad.r - 2} y={l.labelY} textAnchor="end" className="fill-ink-2 font-mono" fontSize={10}>
                  {l.label} {fmtPrice(l.price, 0)}
                </text>
              </g>
            ))}
            {hb && (
              <g pointerEvents="none">
                <line x1={hx} x2={hx} y1={pad.t} y2={height - pad.b} stroke="var(--color-ink-3)" strokeWidth={1} />
                <circle cx={hx} cy={geo.y(hb.p50)} r={4} fill="var(--color-accent)" stroke="var(--color-surface-1)" strokeWidth={2} />
              </g>
            )}
            <rect
              x={pad.l}
              y={pad.t}
              width={Math.max(0, W - pad.l - pad.r)}
              height={height - pad.t - pad.b}
              fill="transparent"
              onPointerMove={onMove}
              onPointerDown={onMove}
              onPointerLeave={() => setHover(null)}
              style={{ touchAction: 'pan-y' }}
            />
          </svg>
        )}
        {hb && hover !== null && (
          <div
            className="absolute top-2 pointer-events-none bg-surface-2 border border-line-strong rounded-md px-2.5 py-1.5 text-[11px] font-mono tabular-nums text-ink-2 shadow-lg"
            style={hx > W / 2 ? { right: W - hx + 8 } : { left: hx + 8 }}
          >
            <div className="text-ink-1">t = {fmtMinutes(times[hover])}</div>
            <div>P90 {fmtPrice(hb.p90, 0)}</div>
            <div>Mediana {fmtPrice(hb.p50, 0)}</div>
            <div>P10 {fmtPrice(hb.p10, 0)}</div>
            <div className="mt-0.5 text-ink-3">
              do t: + cel {(hitByTime[hover].target * 100).toFixed(0)}% · − stop {(hitByTime[hover].stop * 100).toFixed(0)}%
            </div>
          </div>
        )}
      </div>
      {/* Legenda (≥ 2 serie) */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-ink-3">
        <LegendLine color="var(--color-buy)" label="+ ścieżka: cel najpierw" />
        <LegendLine color="var(--color-sell)" label="− ścieżka: stop najpierw" />
        <LegendLine color="var(--color-ink-3)" label="○ bez rozstrzygnięcia" />
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-4 h-2.5 rounded-sm bg-accent/20 border-t-2 border-accent" aria-hidden="true" />
          pasmo P10–P90 i mediana ({mc.paths} ścieżek)
        </span>
      </div>
    </div>
  );
};

const LegendLine: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <span className="inline-flex items-center gap-1.5">
    <svg width={16} height={6} aria-hidden="true">
      <line x1={0} x2={16} y1={3} y2={3} stroke={color} strokeWidth={1.5} />
    </svg>
    {label}
  </span>
);
