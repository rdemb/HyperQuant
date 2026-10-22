import React, { useMemo, useRef, useState } from 'react';
import { scaleLinear } from 'd3';
import { useDesk } from '../../state/DeskContext';
import { useLiqMap } from '../../state/useLiqMap';
import { Badge, EmptyState, Panel, Stat, DASH, fmtCompact, fmtPrice, fmtSigned } from '../../ui';
import { LiqMap } from '../../utils/liqMap';
import { CascadeResult, cascadeCurve } from '../../utils/cascade';
import { nearestClusters, rebin } from '../../utils/liqMapView';
import { horizonStepSigmas } from '../../utils/volatility';
import { parkinsonSigma } from '../../utils/marketDataFeed';
import { useElementWidth } from '../market/MarketMap';
import { LiquidationTape } from './LiquidationTape';

const RANGE = 0.06;
const BINS = 60;
const SHOCKS = [
  ...Array.from({ length: 20 }, (_, i) => -0.05 + i * 0.0025),
  ...Array.from({ length: 20 }, (_, i) => 0.0025 + i * 0.0025),
];
/** Stała prawa pierwiastka: Y = 1 (rząd wielkości z literatury) z pasmem 0.5–1.5 — założenie, nie estymata */
const Y_MAIN = 1;
const Y_BAND: [number, number] = [0.5, 1.5];
const MIN_CLUSTER_USD = 1e6;
const timeFmt = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' });
const pct = (v: number, d = 2) => fmtSigned(v * 100, d, '%');

/** Ścieżka słupka z zaokrąglonym końcem danych (4 px), zakotwiczonego w linii bazowej. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Mapa likwidacji z pozycji on-chain Hyperliquid + krzywa wzmocnienia kaskady. */
export const LiquidationMapPanel: React.FC = () => {
  const { status, map } = useLiqMap();
  const { feed } = useDesk();

  const sigmaDaily = useMemo(() => {
    const m = feed.vol.model;
    if (m) return Math.sqrt(horizonStepSigmas(m, Date.now(), 1440).reduce((a, s) => a + s * s, 0));
    return parkinsonSigma(feed.bars, 86_400, feed.timeframeSec);
  }, [feed.vol.model, feed.bars, feed.timeframeSec]);
  const dayVolumeUsd = feed.backendTelemetry?.dayVolumeUsd ?? 0;

  const badge =
    status === 'ready' ? (
      <Badge tone="live" title="Pozycje i ceny likwidacji z publicznego API Hyperliquid (clearinghouseState), agregat bez adresów">
        LIVE
      </Badge>
    ) : status === 'delayed' ? (
      <Badge tone="warn" title="Publikacja aktualna, ale połowa nominału pochodzi z odczytów pozycji starszych niż 15 min">
        OPÓŹNIONE
      </Badge>
    ) : status === 'stale' || status === 'expired' ? (
      <Badge tone="stale" title="Skaner nie publikuje aktualnych danych — liczby ukryte">
        STALE
      </Badge>
    ) : null;

  return (
    <Panel eyebrow="Pozycje on-chain · Hyperliquid" title="Mapa likwidacji i kaskada" actions={badge}>
      {status === 'unconfigured' || status === 'loading' || status === 'error' || status === 'stale' || status === 'expired' || !map ? (
        <EmptyState
          title={
            status === 'unconfigured'
              ? 'Skaner pozycji nie jest jeszcze podłączony'
              : status === 'loading'
              ? 'Pobieram mapę likwidacji…'
              : (status === 'stale' || status === 'expired') && map
              ? `Mapa nieaktualna — ostatnia publikacja ${timeFmt.format(map.asOf)}; liczby ukryte, dopóki skaner nie opublikuje świeżych danych`
              : 'Mapa likwidacji chwilowo niedostępna'
          }
          detail="Mapa powstaje ze zmierzonych pozycji portfeli na Hyperliquid (ceny likwidacji z publicznego API), a nie z założonych dźwigni. Do tego czasu heatmapa likwidacji na wykresie świec pozostaje oznaczonym szacunkiem."
        />
      ) : (
        <LiqMapBody map={map} delayed={status === 'delayed'} sigmaDaily={sigmaDaily} dayVolumeUsd={dayVolumeUsd} />
      )}
      <div className="px-4 pb-4">
        <LiquidationTape coverage={map && (status === 'ready' || status === 'delayed') ? map.coverage.share : null} />
      </div>
    </Panel>
  );
};

const LiqMapBody: React.FC<{ map: LiqMap; delayed: boolean; sigmaDaily: number; dayVolumeUsd: number }> = ({ map, delayed, sigmaDaily, dayVolumeUsd }) => {
  const near = useMemo(() => nearestClusters(map, MIN_CLUSTER_USD), [map]);
  const canCascade = sigmaDaily > 0 && dayVolumeUsd > 0;
  const curves = useMemo(() => {
    if (!canCascade) return null;
    const p = { sigmaDaily, dayVolumeUsd };
    return {
      main: cascadeCurve(map, SHOCKS, { ...p, y: Y_MAIN }),
      lo: cascadeCurve(map, SHOCKS, { ...p, y: Y_BAND[0] }),
      hi: cascadeCurve(map, SHOCKS, { ...p, y: Y_BAND[1] }),
    };
  }, [map, sigmaDaily, dayVolumeUsd, canCascade]);
  const peak = useMemo(() => (curves ? curves.main.reduce((b, c) => (c.amplification > b.amplification ? c : b)) : null), [curves]);

  return (
    <div className="flex flex-col gap-4 p-4">
      {delayed && (
        <div className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-ink-2">
          Połowa nominału na mapie pochodzi z odczytów pozycji starszych niż {Math.round(map.ageMin.ntlP50)} min (np. po restarcie skanera
          albo przy przeciążeniu API) — klastry mogły się przesunąć.
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-3">
        <Stat
          label="Pokrycie open interest"
          value={<span className="font-mono tabular-nums">{(map.coverage.share * 100).toFixed(1)}%</span>}
          hint={`${map.coverage.positions.toLocaleString('pl-PL')} pozycji · ${map.coverage.addresses.toLocaleString('pl-PL')} adresów · ${timeFmt.format(map.asOf)}`}
        />
        <Stat
          label="Wiek odczytów"
          value={<span className="font-mono tabular-nums">{Math.round(map.ageMin.ntlP50)} min</span>}
          hint={`mediana ważona nominałem · zwykła ${Math.round(map.ageMin.p50)} min, p90 ${Math.round(map.ageMin.p90)} min`}
        />
        <Stat
          label="Najbliżej pod ceną"
          value={<span className="font-mono tabular-nums">{near.below ? fmtPrice(near.below.px, 0) : DASH}</span>}
          hint={near.below ? `▼ ${pct(near.below.distPct)} · longi ${fmtCompact(near.below.ntlUsd, '$')}` : `brak klastra ≥ ${fmtCompact(MIN_CLUSTER_USD, '$')}`}
        />
        <Stat
          label="Najbliżej nad ceną"
          value={<span className="font-mono tabular-nums">{near.above ? fmtPrice(near.above.px, 0) : DASH}</span>}
          hint={near.above ? `▲ ${pct(near.above.distPct)} · shorty ${fmtCompact(near.above.ntlUsd, '$')}` : `brak klastra ≥ ${fmtCompact(MIN_CLUSTER_USD, '$')}`}
        />
      </div>

      <LiqHistogram map={map} />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">Kaskada: szok → ruch końcowy</div>
          <Badge tone="model" title="Punkt stały: szok → likwidacje z mapy → wpływ ceny z prawa pierwiastka (Y = 1, pasmo 0.5–1.5) → kolejne likwidacje">
            MODEL
          </Badge>
        </div>
        {curves && peak ? (
          <>
            <div className="text-xs text-ink-2">
              Najsilniejsze wzmocnienie: szok <span className="font-mono tabular-nums text-ink-1">{pct(peak.shockPct)}</span> → ruch{' '}
              <span className="font-mono tabular-nums text-ink-1">{pct(peak.finalPct)}</span> (×{peak.amplification.toFixed(2)}, likwidacje{' '}
              {fmtCompact(peak.liquidatedUsd, '$')})
              <span className="text-ink-3">
                {' '}
                — górna granica (wpływ szczytowy, pełne trafienie w arkusz, Y = 1 założone) na zmierzonych {(map.coverage.share * 100).toFixed(1)}% open
                interest; niezmierzone pozycje nie są wliczone.
              </span>
            </div>
            <CascadeChart main={curves.main} lo={curves.lo} hi={curves.hi} />
          </>
        ) : (
          <div className="text-xs text-ink-3">Brak dziennej zmienności lub obrotu z API — kaskada niepoliczona.</div>
        )}
      </div>

      <details className="rounded-md border border-line bg-surface-2/50 px-3 py-2 text-xs text-ink-2">
        <summary className="cursor-pointer select-none text-ink-1 font-medium py-1">Metoda, ograniczenia i tabela klastrów</summary>
        <ul className="list-disc pl-4 mt-2 space-y-1.5 leading-relaxed">
          <li>
            Adresy portfeli z publicznego strumienia transakcji BTC i z publicznego rankingu kont Hyperliquid, ich pozycje i ceny likwidacji z
            publicznego <code>clearinghouseState</code>.
            Publikowane są tylko agregaty — bez adresów. Pokrycie = zeskanowany rozmiar / (2 × open interest).
          </li>
          <li>
            Portfele spoza rankingu, które nie handlowały od startu skanera, nie są na mapie. Odczyty po złej stronie ceny (nieaktualne) są
            pomijane ({map.coverage.wrongSide}). Cena likwidacji pozycji cross zmienia się z całym kontem. Samokontrola: longi{' '}
            {map.coverage.longBtc.toFixed(1)} BTC, shorty {map.coverage.shortBtc.toFixed(1)} BTC (przy pełnym pokryciu obie ≈ OI {map.coverage.oiBtc.toFixed(0)} BTC).
          </li>
          <li>
            Kaskada: Δp/p = Y·σ·√(Q/V) (Tóth i in. 2011; Bouchaud i in. 2018), σ = dzienna zmienność ({(sigmaDaily * 100).toFixed(2)}%),
            V = obrót 24 h ({fmtCompact(dayVolumeUsd, '$')}). Wpływ szczytowy i pełne trafienie w arkusz — górna granica; na Hyperliquid duże
            likwidacje idą po 20% na blok, a część przejmuje Liquidator Vault.
          </li>
        </ul>
        <ClusterTable map={map} />
      </details>
    </div>
  );
};

/** Histogram nominału likwidacji wokół ceny: longi (sprzedaż) i shorty (kupno), wspólna oś Y. */
const LiqHistogram: React.FC<{ map: LiqMap }> = ({ map }) => {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const [hover, setHover] = useState<number | null>(null);
  const H = 190;
  const pad = { l: 48, r: 10, t: 10, b: 26 };
  const longs = useMemo(() => rebin(map.longs, map.markPx, RANGE, BINS, map.stepUsd), [map]);
  const shorts = useMemo(() => rebin(map.shorts, map.markPx, RANGE, BINS, map.stepUsd), [map]);
  const maxY = Math.max(1, ...longs.map((b, i) => b.ntlUsd + shorts[i].ntlUsd));
  const x = scaleLinear().domain([map.markPx * (1 - RANGE), map.markPx * (1 + RANGE)]).range([pad.l, Math.max(pad.l + 1, width - pad.r)]);
  const y = scaleLinear().domain([0, maxY]).range([H - pad.b, pad.t]);
  const bw = Math.max(1, (x.range()[1] - x.range()[0]) / BINS - 2);
  const ticks = [-0.06, -0.03, 0, 0.03, 0.06];
  const hv = hover !== null ? { l: longs[hover], s: shorts[hover] } : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-2">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-sell" aria-hidden="true" />▼ likwidacje longów (sprzedaż)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-buy" aria-hidden="true" />▲ likwidacje shortów (kupno)
        </span>
        <span className="text-ink-3">przedział {fmtPrice((map.markPx * 2 * RANGE) / BINS, 0)} $ · ±{RANGE * 100}% od ceny</span>
      </div>
      <div ref={ref} className="relative w-full" style={{ height: H }}>
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-label="Histogram nominału likwidacji według ceny">
            {y.ticks(3).map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
                <text x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-ink-3 font-mono" fontSize={10}>
                  {fmtCompact(t, '$')}
                </text>
              </g>
            ))}
            {longs.map((b, i) => {
              const s = shorts[i];
              const x0 = x(b.from) + 1;
              const yl = y(b.ntlUsd);
              const ys = y(b.ntlUsd + s.ntlUsd);
              return (
                <g key={i} opacity={hover === null || hover === i ? 1 : 0.55}>
                  {b.ntlUsd > 0 && <path d={barPath(x0, yl, bw, H - pad.b - yl)} fill="var(--color-sell)" />}
                  {s.ntlUsd > 0 && <path d={barPath(x0, ys, bw, Math.max(0, yl - ys - (b.ntlUsd > 0 ? 2 : 0)))} fill="var(--color-buy)" />}
                </g>
              );
            })}
            <line x1={x(map.markPx)} x2={x(map.markPx)} y1={pad.t} y2={H - pad.b} stroke="var(--color-accent)" strokeWidth={1.5} />
            <text x={x(map.markPx) + 4} y={pad.t + 8} className="fill-ink-1 font-mono" fontSize={10}>
              {fmtPrice(map.markPx, 0)}
            </text>
            <line x1={pad.l} x2={width - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--color-line-strong)" strokeWidth={1} />
            {ticks.map((t) => (
              <text key={t} x={x(map.markPx * (1 + t))} y={H - 8} textAnchor="middle" className="fill-ink-3 font-mono" fontSize={10}>
                {t === 0 ? 'cena' : pct(t, 0)}
              </text>
            ))}
            {longs.map((b, i) => (
              <rect
                key={`hit-${i}`}
                x={x(b.from)}
                y={pad.t}
                width={Math.max(1, x(b.to) - x(b.from))}
                height={H - pad.b - pad.t}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onTouchStart={() => setHover(i)}
              />
            ))}
          </svg>
        )}
        {hv && hover !== null && (
          <div
            className="pointer-events-none absolute top-1 z-10 rounded-md border border-line-strong bg-surface-2 px-2.5 py-1.5 text-[11px] text-ink-2 shadow-lg"
            style={{ left: Math.min(Math.max(0, x(hv.l.from) - 70), Math.max(0, width - 180)) }}
          >
            <div className="font-mono tabular-nums text-ink-1">
              {fmtPrice(hv.l.from, 0)}–{fmtPrice(hv.l.to, 0)} ({pct(((hv.l.from + hv.l.to) / 2) / map.markPx - 1, 1)})
            </div>
            <div>▼ longi: {hv.l.ntlUsd > 0 ? `${fmtCompact(hv.l.ntlUsd, '$')} · ${hv.l.n} poz.` : DASH}</div>
            <div>▲ shorty: {hv.s.ntlUsd > 0 ? `${fmtCompact(hv.s.ntlUsd, '$')} · ${hv.s.n} poz.` : DASH}</div>
          </div>
        )}
      </div>
    </div>
  );
};

/** Krzywa szok → ruch końcowy (jedna oś), przekątna = brak kaskady, pasmo dla Y 0.5–1.5. */
const CascadeChart: React.FC<{ main: CascadeResult[]; lo: CascadeResult[]; hi: CascadeResult[] }> = ({ main, lo, hi }) => {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const [hover, setHover] = useState<number | null>(null);
  const H = 170;
  const pad = { l: 48, r: 10, t: 10, b: 26 };
  const maxAbs = Math.max(0.05, ...hi.map((c) => Math.abs(c.finalPct)));
  const x = scaleLinear().domain([-0.05, 0.05]).range([pad.l, Math.max(pad.l + 1, width - pad.r)]);
  const y = scaleLinear().domain([-maxAbs, maxAbs]).range([H - pad.b, pad.t]);
  const side = (arr: CascadeResult[], down: boolean) => arr.filter((c) => (down ? c.shockPct < 0 : c.shockPct > 0));
  const line = (arr: CascadeResult[]) => arr.map((c, i) => `${i ? 'L' : 'M'}${x(c.shockPct).toFixed(1)},${y(c.finalPct).toFixed(1)}`).join('');
  const band = (a: CascadeResult[], b: CascadeResult[]) => `${line(a)}${b.slice().reverse().map((c) => `L${x(c.shockPct).toFixed(1)},${y(c.finalPct).toFixed(1)}`).join('')}Z`;
  const h = hover !== null ? main[hover] : null;

  return (
    <div ref={ref} className="relative w-full" style={{ height: H }}>
      {width > 0 && (
        <svg
          width={width}
          height={H}
          role="img"
          aria-label="Krzywa wzmocnienia kaskady likwidacji"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const s = x.invert(e.clientX - r.left);
            let best = 0;
            main.forEach((c, i) => (Math.abs(c.shockPct - s) < Math.abs(main[best].shockPct - s) ? (best = i) : null));
            setHover(best);
          }}
        >
          {[-maxAbs, 0, maxAbs].map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--color-line-strong)' : 'var(--color-line)'} strokeWidth={1} />
              <text x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-ink-3 font-mono" fontSize={10}>
                {pct(t, 1)}
              </text>
            </g>
          ))}
          <line x1={x(-0.05)} y1={y(-0.05)} x2={x(0.05)} y2={y(0.05)} stroke="var(--color-ink-3)" strokeWidth={1} />
          {[true, false].map((down) => (
            <g key={String(down)}>
              <path d={band(side(lo, down), side(hi, down))} fill="var(--color-accent)" opacity={0.12} />
              <path d={line(side(main, down))} fill="none" stroke="var(--color-accent)" strokeWidth={2} />
            </g>
          ))}
          {[-0.05, -0.025, 0, 0.025, 0.05].map((t) => (
            <text key={t} x={x(t)} y={H - 8} textAnchor="middle" className="fill-ink-3 font-mono" fontSize={10}>
              {t === 0 ? 'szok 0' : pct(t, 1)}
            </text>
          ))}
          {h && (
            <g>
              <line x1={x(h.shockPct)} x2={x(h.shockPct)} y1={pad.t} y2={H - pad.b} stroke="var(--color-ink-3)" strokeWidth={1} />
              <circle cx={x(h.shockPct)} cy={y(h.finalPct)} r={4} fill="var(--color-accent)" stroke="var(--color-surface-1)" strokeWidth={2} />
            </g>
          )}
        </svg>
      )}
      {h && hover !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-md border border-line-strong bg-surface-2 px-2.5 py-1.5 text-[11px] text-ink-2 shadow-lg"
          style={{ left: Math.min(Math.max(0, x(h.shockPct) - 80), Math.max(0, width - 200)) }}
        >
          <div className="text-ink-1">
            szok <span className="font-mono tabular-nums">{pct(h.shockPct)}</span> → ruch <span className="font-mono tabular-nums">{pct(h.finalPct)}</span>
          </div>
          <div>
            ×{h.amplification.toFixed(2)} (pasmo ×{lo[hover].amplification.toFixed(2)}–×{hi[hover].amplification.toFixed(2)})
          </div>
          <div>likwidacje {fmtCompact(h.liquidatedUsd, '$')}</div>
        </div>
      )}
      <div className="sr-only">Przekątna to ruch bez kaskady; linia nad nią w wartości bezwzględnej oznacza wzmocnienie przez likwidacje.</div>
    </div>
  );
};

/** Tabela największych klastrów — dostęp do liczb bez wykresu. */
const ClusterTable: React.FC<{ map: LiqMap }> = ({ map }) => {
  const rows = [
    ...map.longs.map((b) => ({ side: '▼ longi', ...b })),
    ...map.shorts.map((b) => ({ side: '▲ shorty', ...b })),
  ]
    .sort((a, b) => b.ntlUsd - a.ntlUsd)
    .slice(0, 10);
  if (rows.length === 0) return <div className="mt-2 text-ink-3">Brak pozycji z ceną likwidacji w zakresie ±15%.</div>;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left font-mono tabular-nums text-[11px]">
        <thead className="text-ink-3">
          <tr>
            <th className="py-1 pr-3 font-medium">Strona</th>
            <th className="py-1 pr-3 font-medium">Cena likwidacji</th>
            <th className="py-1 pr-3 font-medium">Od ceny</th>
            <th className="py-1 pr-3 font-medium">Nominał</th>
            <th className="py-1 font-medium">Pozycje</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.side}-${r.px}`} className="border-t border-line">
              <td className="py-1 pr-3 font-sans">{r.side}</td>
              <td className="py-1 pr-3">
                {fmtPrice(r.px, 0)}–{fmtPrice(r.px + map.stepUsd, 0)}
              </td>
              <td className="py-1 pr-3">{pct((r.px + map.stepUsd / 2) / map.markPx - 1)}</td>
              <td className="py-1 pr-3">{fmtCompact(r.ntlUsd, '$')}</td>
              <td className="py-1">{r.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
