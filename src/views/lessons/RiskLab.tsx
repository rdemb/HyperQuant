import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, RotateCcw } from 'lucide-react';
import type { LessonsContent } from '../../lessons/content/types';
import { RISK_DEFAULTS, simulateRisk, type RiskParams, type RiskResult } from '../../lessons/risk';
import { useDesk } from '../../state/DeskContext';
import { Badge } from '../../ui';
import { BTN_LINK, BTN_SECONDARY, fmtNum, fmtPct } from './format';

interface SliderDef {
  key: keyof RiskParams;
  min: number;
  max: number;
  step: number;
  fmt: (v: number, locale: string) => string;
}

const SLIDERS: SliderDef[] = [
  { key: 'winRate', min: 0.3, max: 0.7, step: 0.01, fmt: (v, l) => fmtPct(v, l) },
  { key: 'payoff', min: 0.5, max: 3, step: 0.1, fmt: (v, l) => `${fmtNum(v, l, 1)} R` },
  { key: 'riskPct', min: 0.0025, max: 0.1, step: 0.0025, fmt: (v, l) => fmtPct(v, l, v < 0.01 ? 2 : 1) },
  { key: 'trades', min: 50, max: 500, step: 50, fmt: (v) => String(v) },
  { key: 'cost', min: 0, max: 0.5, step: 0.05, fmt: (v, l) => `${fmtNum(v, l, 2)} R` },
];

/** Laboratorium ryzyka: ta sama skuteczność przy różnym ryzyku na transakcję i z kosztami (symulacja, zawsze oznaczona). */
export const RiskLab: React.FC<{ c: LessonsContent }> = ({ c }) => {
  const { setView } = useDesk();
  const [p, setP] = useState<RiskParams>(RISK_DEFAULTS);
  const r = useMemo(() => simulateRisk(p), [p]);
  const k = c.risk;
  const go = (v: 'micro' | 'plan') => {
    setView(v);
    window.scrollTo({ top: 0 });
  };
  const tiles: { label: string; value: string; tone?: string }[] = [
    { label: k.out.expectancy, value: `${fmtNum(r.expectancy, c.locale, 2)} R`, tone: r.expectancy > 0 ? 'text-buy-ink' : r.expectancy < 0 ? 'text-sell-ink' : undefined },
    { label: k.out.median, value: fmtNum(r.median, c.locale, 0) },
    { label: k.out.band, value: `${fmtNum(r.p5, c.locale, 0)}–${fmtNum(r.p95, c.locale, 0)}` },
    { label: k.out.dd20, value: fmtPct(r.dd20, c.locale), tone: r.dd20 >= 0.5 ? 'text-warn' : undefined },
    { label: k.out.dd50, value: fmtPct(r.dd50, c.locale), tone: r.dd50 >= 0.1 ? 'text-sell-ink' : undefined },
    { label: k.out.streak, value: String(Math.round(r.streak)) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-2 max-w-prose leading-relaxed">{k.intro}</p>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <section className="xl:col-span-4 flex flex-col gap-4 p-4 rounded-xl border border-line-strong bg-surface-1">
          <div className="flex items-center justify-between gap-2">
            <Badge tone="sim">{k.badge}</Badge>
            <button type="button" onClick={() => setP(RISK_DEFAULTS)} className={`${BTN_SECONDARY} !min-h-8 !px-2.5 text-xs`}>
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              {k.labels.reset}
            </button>
          </div>
          {SLIDERS.map((s) => (
            <label key={s.key} className="flex flex-col gap-1.5">
              <span className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="text-ink-2">{k.labels[s.key]}</span>
                <span className="font-mono tabular-nums text-ink-1">{s.fmt(p[s.key], c.locale)}</span>
              </span>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={p[s.key]}
                onChange={(e) => setP((x) => ({ ...x, [s.key]: Number(e.target.value) }))}
                className="w-full h-6 accent-accent"
              />
            </label>
          ))}
        </section>
        <section className="xl:col-span-8 flex flex-col gap-3 p-4 rounded-xl border border-line bg-surface-1 min-w-0">
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {tiles.map((t) => (
              <div key={t.label} className="flex flex-col gap-1 p-3 rounded-lg border border-line bg-page/40">
                <dt className="text-[11px] text-ink-3 leading-snug">{t.label}</dt>
                <dd className={`font-mono tabular-nums text-lg font-semibold ${t.tone ?? 'text-ink-1'}`}>{t.value}</dd>
              </div>
            ))}
          </dl>
          <div className="text-xs text-ink-3">{k.out.paths}</div>
          <Fan r={r} trades={p.trades} locale={c.locale} label={k.out.paths} />
        </section>
      </div>
      <ul className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {k.lessons.map((l) => (
          <li key={l.title} className="flex flex-col gap-1.5 p-4 rounded-xl border border-line bg-surface-1">
            <h3 className="text-sm font-semibold text-ink-1">{l.title}</h3>
            <p className="text-[13px] text-ink-2 leading-relaxed">{l.text}</p>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <button type="button" onClick={() => go('micro')} className={BTN_LINK}>
          {k.sizeLink}
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => go('plan')} className={BTN_LINK}>
          {k.planLink}
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

const TICK_BASE = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8];

/** Wachlarz kapitału (skala logarytmiczna: ten sam procent to ta sama wysokość): zakres 5–95%, mediana i przykładowe ścieżki. */
const Fan: React.FC<{ r: RiskResult; trades: number; locale: string; label: string }> = ({ r, trades, locale, label }) => {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.round(el.clientWidth)));
    ro.observe(el);
    setW(Math.round(el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const H = W < 560 ? 220 : 280;
  const AX = 44;
  const plotW = Math.max(10, W - AX - 4);
  const top = 8;
  const plotH = H - 30;
  let lo = Infinity;
  let hi = -Infinity;
  for (const [, a, , b] of r.fan) {
    lo = Math.min(lo, a);
    hi = Math.max(hi, b);
  }
  for (const path of r.paths)
    for (const v of path) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  lo = Math.max(0.5, Math.min(lo, 90));
  hi = Math.max(hi, 110);
  const L0 = Math.log(lo);
  const L1 = Math.log(hi);
  const x = (t: number) => (t / trades) * plotW;
  const y = (v: number) => top + ((L1 - Math.log(Math.max(v, lo))) / (L1 - L0)) * plotH;
  const line = (pts: [number, number][]) => pts.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const ts = r.fan.map((f) => f[0]);
  const band = `${line(r.fan.map((f) => [f[0], f[3]]))}${r.fan
    .slice()
    .reverse()
    .map((f) => `L${x(f[0]).toFixed(1)},${y(f[1]).toFixed(1)}`)
    .join('')}Z`;

  // Podziałka: „okrągłe” wartości w skali log, nie gęściej niż co 26 px
  const ticks: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++)
    for (const b of TICK_BASE) {
      const v = b * 10 ** e;
      if (v < lo || v > hi) continue;
      if (!ticks.length || y(ticks[ticks.length - 1]) - y(v) >= 26) ticks.push(v);
    }
  if (!ticks.includes(100)) ticks.push(100);

  return (
    <div ref={box} className="w-full">
      {W > 0 && (
        <svg width={W} height={H} role="img" aria-label={label} className="block font-mono">
          <rect x={0} y={0} width={W} height={H} rx={6} fill="var(--color-of-bg)" />
          {ticks.map((v) => (
            <g key={v}>
              <line x1={0} x2={plotW} y1={y(v)} y2={y(v)} stroke={v === 100 ? 'var(--color-line-strong)' : '#141c29'} strokeDasharray={v === 100 ? '4 3' : undefined} />
              <text x={plotW + 6} y={y(v) + 3.5} fontSize={10} fill="var(--color-ink-3)">
                {v >= 10 ? Math.round(v).toLocaleString(locale) : v.toLocaleString(locale)}
              </text>
            </g>
          ))}
          <path d={band} fill="var(--color-accent)" fillOpacity={0.12} />
          {r.paths.map((path, i) => (
            <path key={i} d={line(path.map((v, j) => [ts[j], v]))} fill="none" stroke="var(--color-ink-3)" strokeOpacity={0.35} strokeWidth={1} />
          ))}
          <path d={line(r.fan.map((f) => [f[0], f[2]]))} fill="none" stroke="var(--color-accent)" strokeWidth={2} />
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <text key={f} x={Math.min(plotW - 4, Math.max(4, x(f * trades)))} y={H - 8} fontSize={10} fill="var(--color-ink-3)" textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>
              {Math.round(f * trades)}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
};
