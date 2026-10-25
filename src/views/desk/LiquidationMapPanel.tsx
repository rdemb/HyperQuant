import React, { useMemo, useRef, useState } from 'react';
import { scaleLinear } from 'd3';
import { useDesk } from '../../state/DeskContext';
import { useLiqMap } from '../../state/useLiqMap';
import { Badge, EmptyState, Panel, Stat, DASH, fmtCompact, fmtPrice, fmtSigned, fmtFixed } from '../../ui';
import { LiqMap } from '../../utils/liqMap';
import { CascadeResult, cascadeCurve } from '../../utils/cascade';
import { CascadeSimSection } from './CascadeSimSection';
import { nearestClusters, rebin } from '../../utils/liqMapView';
import { horizonStepSigmas } from '../../utils/volatility';
import { parkinsonSigma } from '../../utils/marketDataFeed';
import { useElementWidth } from '../market/MarketMap';
import { LiquidationTape } from './LiquidationTape';
import { locale, tr } from '../../i18n';

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
const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
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
      <Badge tone="live" title={tr('Pozycje i ceny likwidacji z publicznego API Hyperliquid (clearinghouseState), agregat bez adresów', 'Positions and liquidation prices from the public Hyperliquid API (clearinghouseState), aggregated without addresses')}>
        LIVE
      </Badge>
    ) : status === 'delayed' ? (
      <Badge tone="warn" title={tr('Publikacja aktualna, ale połowa nominału pochodzi z odczytów pozycji starszych niż 15 min', 'Publication is current, but half of the notional comes from position reads older than 15 min')}>
        {tr('OPÓŹNIONE', 'DELAYED')}
      </Badge>
    ) : status === 'stale' || status === 'expired' ? (
      <Badge tone="stale" title={tr('Skaner nie publikuje aktualnych danych — liczby ukryte', 'The scanner is not publishing current data, numbers hidden')}>
        STALE
      </Badge>
    ) : null;

  return (
    <Panel eyebrow={tr('Pozycje on-chain · Hyperliquid', 'On-chain positions · Hyperliquid')} title={tr('Mapa likwidacji i kaskada', 'Liquidation map and cascade')} actions={badge}>
      {status === 'unconfigured' || status === 'loading' || status === 'error' || status === 'stale' || status === 'expired' || !map ? (
        <EmptyState
          title={
            status === 'unconfigured'
              ? tr('Skaner pozycji nie jest jeszcze podłączony', 'The position scanner is not connected yet')
              : status === 'loading'
              ? tr('Pobieram mapę likwidacji…', 'Loading the liquidation map…')
              : (status === 'stale' || status === 'expired') && map
              ? tr(
                  `Mapa nieaktualna — ostatnia publikacja ${timeFmt.format(map.asOf)}; liczby ukryte, dopóki skaner nie opublikuje świeżych danych`,
                  `Map is out of date, last published ${timeFmt.format(map.asOf)}; numbers stay hidden until the scanner publishes fresh data`
                )
              : tr('Mapa likwidacji chwilowo niedostępna', 'Liquidation map temporarily unavailable')
          }
          detail={tr(
            'Mapa powstaje ze zmierzonych pozycji portfeli na Hyperliquid (ceny likwidacji z publicznego API), a nie z założonych dźwigni. Do tego czasu heatmapa likwidacji na wykresie świec pozostaje oznaczonym szacunkiem.',
            'The map is built from measured wallet positions on Hyperliquid (liquidation prices from the public API), not from assumed leverage. Until then the liquidation heatmap on the candle chart remains a labelled estimate.'
          )}
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
          {tr(
            `Połowa nominału na mapie pochodzi z odczytów pozycji starszych niż ${Math.round(map.ageMin.ntlP50)} min (np. po restarcie skanera albo przy przeciążeniu API) — klastry mogły się przesunąć.`,
            `Half of the notional on the map comes from position reads older than ${Math.round(map.ageMin.ntlP50)} min (e.g. after a scanner restart or API overload), so clusters may have moved.`
          )}
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-3">
        <Stat
          label={tr('Pokrycie open interest', 'Open interest coverage')}
          value={<span className="font-mono tabular-nums">{fmtFixed(map.coverage.share * 100, 1)}%</span>}
          hint={`${map.coverage.positions.toLocaleString(locale)} ${tr('pozycji', 'positions')} · ${map.coverage.addresses.toLocaleString(locale)} ${tr('adresów', 'addresses')} · ${timeFmt.format(map.asOf)}`}
        />
        <Stat
          label={tr('Wiek odczytów', 'Read age')}
          value={<span className="font-mono tabular-nums">{Math.round(map.ageMin.ntlP50)} min</span>}
          hint={tr(
            `mediana ważona nominałem · zwykła ${Math.round(map.ageMin.p50)} min, p90 ${Math.round(map.ageMin.p90)} min`,
            `notional-weighted median · plain ${Math.round(map.ageMin.p50)} min, p90 ${Math.round(map.ageMin.p90)} min`
          )}
        />
        <Stat
          label={tr('Najbliżej pod ceną', 'Nearest below price')}
          value={<span className="font-mono tabular-nums">{near.below ? fmtPrice(near.below.px, 0) : DASH}</span>}
          hint={
            near.below
              ? `▼ ${pct(near.below.distPct)} · ${tr('longi', 'longs')} ${fmtCompact(near.below.ntlUsd, '$')}`
              : `${tr('brak klastra', 'no cluster')} ≥ ${fmtCompact(MIN_CLUSTER_USD, '$')}`
          }
        />
        <Stat
          label={tr('Najbliżej nad ceną', 'Nearest above price')}
          value={<span className="font-mono tabular-nums">{near.above ? fmtPrice(near.above.px, 0) : DASH}</span>}
          hint={
            near.above
              ? `▲ ${pct(near.above.distPct)} · ${tr('shorty', 'shorts')} ${fmtCompact(near.above.ntlUsd, '$')}`
              : `${tr('brak klastra', 'no cluster')} ≥ ${fmtCompact(MIN_CLUSTER_USD, '$')}`
          }
        />
      </div>

      <LiqHistogram map={map} />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">{tr('Kaskada: szok → ruch końcowy', 'Cascade: shock → final move')}</div>
          <Badge
            tone="model"
            title={tr(
              'Punkt stały: szok → likwidacje z mapy → wpływ ceny z prawa pierwiastka (Y = 1, pasmo 0,5–1,5) → kolejne likwidacje',
              'Fixed point: shock → liquidations from the map → price impact from the square-root law (Y = 1, band 0.5–1.5) → further liquidations'
            )}
          >
            MODEL
          </Badge>
        </div>
        {curves && peak ? (
          <>
            <div className="text-xs text-ink-2">
              {tr('Najsilniejsze wzmocnienie: szok', 'Strongest amplification: shock')} <span className="font-mono tabular-nums text-ink-1">{pct(peak.shockPct)}</span> →{' '}
              {tr('ruch', 'move')} <span className="font-mono tabular-nums text-ink-1">{pct(peak.finalPct)}</span> (×{fmtFixed(peak.amplification, 2)},{' '}
              {tr('likwidacje', 'liquidations')} {fmtCompact(peak.liquidatedUsd, '$')})
              <span className="text-ink-3">
                {' '}
                {tr(
                  `— górna granica (wpływ szczytowy, pełne trafienie w arkusz, Y = 1 założone) na zmierzonych ${fmtFixed(map.coverage.share * 100, 1)}% open interest; niezmierzone pozycje nie są wliczone.`,
                  `— an upper bound (peak impact, full hit on the book, Y = 1 assumed) on the measured ${fmtFixed(map.coverage.share * 100, 1)}% of open interest; unmeasured positions are not included.`
                )}
              </span>
            </div>
            <CascadeChart main={curves.main} lo={curves.lo} hi={curves.hi} />
          </>
        ) : (
          <div className="text-xs text-ink-3">{tr('Brak dziennej zmienności lub obrotu z API — kaskada niepoliczona.', 'No daily volatility or volume from the API, cascade not computed.')}</div>
        )}
      </div>

      <CascadeSimSection map={map} />

      <details className="rounded-md border border-line bg-surface-2/50 px-3 py-2 text-xs text-ink-2">
        <summary className="cursor-pointer select-none text-ink-1 font-medium py-1">{tr('Metoda, ograniczenia i tabela klastrów', 'Method, limitations and cluster table')}</summary>
        <ul className="list-disc pl-4 mt-2 space-y-1.5 leading-relaxed">
          <li>
            {tr(
              <>
                Adresy portfeli z publicznego strumienia transakcji BTC i z publicznego rankingu kont Hyperliquid, ich pozycje i ceny likwidacji z
                publicznego <code>clearinghouseState</code>. Publikowane są tylko agregaty — bez adresów. Pokrycie = zeskanowany rozmiar / (2 × open
                interest).
              </>,
              <>
                Wallet addresses come from the public BTC trade stream and the public Hyperliquid account leaderboard, their positions and liquidation
                prices from the public <code>clearinghouseState</code>. Only aggregates are published, never addresses. Coverage = scanned size / (2 ×
                open interest).
              </>
            )}
          </li>
          <li>
            {tr(
              `Portfele spoza rankingu, które nie handlowały od startu skanera, nie są na mapie. Odczyty po złej stronie ceny (nieaktualne) są pomijane (${map.coverage.wrongSide}). Cena likwidacji pozycji cross zmienia się z całym kontem. Samokontrola: longi ${fmtFixed(map.coverage.longBtc, 1)} BTC, shorty ${fmtFixed(map.coverage.shortBtc, 1)} BTC (przy pełnym pokryciu obie ≈ OI ${fmtFixed(map.coverage.oiBtc, 0)} BTC).`,
              `Wallets outside the leaderboard that have not traded since the scanner started are not on the map. Reads on the wrong side of price (stale) are skipped (${map.coverage.wrongSide}). The liquidation price of a cross position moves with the whole account. Self-check: longs ${fmtFixed(map.coverage.longBtc, 1)} BTC, shorts ${fmtFixed(map.coverage.shortBtc, 1)} BTC (at full coverage both ≈ OI ${fmtFixed(map.coverage.oiBtc, 0)} BTC).`
            )}
          </li>
          <li>
            {tr(
              `Kaskada: Δp/p = Y·σ·√(Q/V) (Tóth i in. 2011; Bouchaud i in. 2018), σ = dzienna zmienność (${fmtFixed(sigmaDaily * 100, 2)}%), V = obrót 24 h (${fmtCompact(dayVolumeUsd, '$')}). Wpływ szczytowy i pełne trafienie w arkusz — górna granica; na Hyperliquid duże likwidacje idą po 20% na blok, a część przejmuje Liquidator Vault.`,
              `Cascade: Δp/p = Y·σ·√(Q/V) (Tóth et al. 2011; Bouchaud et al. 2018), σ = daily volatility (${fmtFixed(sigmaDaily * 100, 2)}%), V = 24 h volume (${fmtCompact(dayVolumeUsd, '$')}). Peak impact and a full hit on the book make this an upper bound; on Hyperliquid large liquidations go through 20% per block and part is taken over by the Liquidator Vault.`
            )}
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
          <span className="w-2.5 h-2.5 rounded-sm bg-sell" aria-hidden="true" />
          {tr('▼ likwidacje longów (sprzedaż)', '▼ long liquidations (selling)')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-buy" aria-hidden="true" />
          {tr('▲ likwidacje shortów (kupno)', '▲ short liquidations (buying)')}
        </span>
        <span className="text-ink-3">
          {tr('przedział', 'bin')} {fmtPrice((map.markPx * 2 * RANGE) / BINS, 0)} $ · ±{RANGE * 100}% {tr('od ceny', 'from price')}
        </span>
      </div>
      <div ref={ref} className="relative w-full" style={{ height: H }}>
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-label={tr('Histogram nominału likwidacji według ceny', 'Histogram of liquidation notional by price')}>
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
                {t === 0 ? tr('cena', 'price') : pct(t, 0)}
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
                onTouchStart={() => setHover((h) => (h === i ? null : i))}
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
            <div>
              ▼ {tr('longi', 'longs')}: {hv.l.ntlUsd > 0 ? `${fmtCompact(hv.l.ntlUsd, '$')} · ${hv.l.n} ${tr('poz.', 'pos.')}` : DASH}
            </div>
            <div>
              ▲ {tr('shorty', 'shorts')}: {hv.s.ntlUsd > 0 ? `${fmtCompact(hv.s.ntlUsd, '$')} · ${hv.s.n} ${tr('poz.', 'pos.')}` : DASH}
            </div>
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
          aria-label={tr('Krzywa wzmocnienia kaskady likwidacji', 'Liquidation cascade amplification curve')}
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
              {t === 0 ? tr('szok 0', 'shock 0') : pct(t, 1)}
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
            {tr('szok', 'shock')} <span className="font-mono tabular-nums">{pct(h.shockPct)}</span> → {tr('ruch', 'move')}{' '}
            <span className="font-mono tabular-nums">{pct(h.finalPct)}</span>
          </div>
          <div>
            ×{fmtFixed(h.amplification, 2)} ({tr('pasmo', 'band')} ×{fmtFixed(lo[hover].amplification, 2)}–×{fmtFixed(hi[hover].amplification, 2)})
          </div>
          <div>
            {tr('likwidacje', 'liquidations')} {fmtCompact(h.liquidatedUsd, '$')}
          </div>
        </div>
      )}
      <div className="sr-only">
        {tr(
          'Przekątna to ruch bez kaskady; linia nad nią w wartości bezwzględnej oznacza wzmocnienie przez likwidacje.',
          'The diagonal is the move without a cascade; a line above it in absolute value means amplification by liquidations.'
        )}
      </div>
    </div>
  );
};

/** Tabela największych klastrów — dostęp do liczb bez wykresu. */
const ClusterTable: React.FC<{ map: LiqMap }> = ({ map }) => {
  const rows = [
    ...map.longs.map((b) => ({ side: tr('▼ longi', '▼ longs'), ...b })),
    ...map.shorts.map((b) => ({ side: tr('▲ shorty', '▲ shorts'), ...b })),
  ]
    .sort((a, b) => b.ntlUsd - a.ntlUsd)
    .slice(0, 10);
  if (rows.length === 0) return <div className="mt-2 text-ink-3">{tr('Brak pozycji z ceną likwidacji w zakresie ±15%.', 'No positions with a liquidation price within ±15%.')}</div>;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left font-mono tabular-nums text-[11px]">
        <thead className="text-ink-3">
          <tr>
            <th className="py-1 pr-3 font-medium">{tr('Strona', 'Side')}</th>
            <th className="py-1 pr-3 font-medium">{tr('Cena likwidacji', 'Liquidation price')}</th>
            <th className="py-1 pr-3 font-medium">{tr('Od ceny', 'From price')}</th>
            <th className="py-1 pr-3 font-medium">{tr('Nominał', 'Notional')}</th>
            <th className="py-1 font-medium">{tr('Pozycje', 'Positions')}</th>
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
