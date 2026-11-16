import React, { useMemo, useRef, useState } from 'react';
import { scaleLinear } from 'd3';
import { useEntryMap } from '../../state/useEntryMap';
import { Badge, DASH, EmptyState, Panel, Stat, fmtCompact, fmtFixed, fmtPrice } from '../../ui';
import type { EntryMap, SideStats } from '../../utils/entryMap';
import { rebin } from '../../utils/liqMapView';
import { useElementWidth } from '../market/MarketMap';
import { locale, tr } from '../../i18n';

/**
 * Uwięzieni: gdzie weszły otwarte pozycje BTC na Hyperliquid (skaner, te same odczyty co mapa likwidacji). Rozkład cen
 * wejścia wokół ceny, część każdej strony „pod wodą” i odległość do likwidacji. Fakty o pozycjach w zmierzonej części
 * open interest; bez kierunku i bez twierdzenia, jak cena zareaguje przy tych poziomach.
 */

const RANGE = 0.08;
const BINS = 48;
const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });

function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(3, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export const EntryMapPanel: React.FC = () => {
  const { status, map } = useEntryMap();
  const ok = (status === 'ready' || status === 'delayed') && map;
  const badge = ok ? (
    <Badge tone="model" card="uwiezieni" title={tr(`Agregat pozycji ze zmierzonych ${fmtFixed(map.coverage.share * 100, 0)}% open interest; opis, bez prognozy`, `Aggregate of positions from the measured ${fmtFixed(map.coverage.share * 100, 0)}% of open interest; a description, not a forecast`)}>
      MODEL
    </Badge>
  ) : status === 'stale' || status === 'expired' ? (
    <Badge tone="stale" title={tr('Skaner nie publikuje aktualnych danych — liczby ukryte', 'The scanner is not publishing current data, numbers hidden')}>
      STALE
    </Badge>
  ) : null;

  return (
    <Panel eyebrow={tr('Ceny wejścia pozycji · BTC · Hyperliquid', 'Position entry prices · BTC · Hyperliquid')} title={tr('Uwięzieni', 'Trapped positions')} actions={badge}>
      {!ok ? (
        <EmptyState
          title={
            status === 'loading'
              ? tr('Pobieram mapę wejść…', 'Loading the entry map…')
              : status === 'stale' || status === 'expired'
                ? tr('Mapa wejść nieaktualna; liczby ukryte, dopóki skaner nie opublikuje świeżych danych', 'The entry map is out of date; numbers stay hidden until the scanner publishes fresh data')
                : tr('Mapy wejść jeszcze nie ma', 'No entry map yet')
          }
          detail={tr(
            'Mapa powstaje w skanerze z tych samych odczytów pozycji co mapa likwidacji (ceny wejścia z publicznego API Hyperliquid) i pojawi się po wdrożeniu nowej wersji skanera.',
            'The map is built by the scanner from the same position reads as the liquidation map (entry prices from the public Hyperliquid API) and appears once the new scanner version is deployed.'
          )}
        />
      ) : (
        <EntryBody map={map} delayed={status === 'delayed'} />
      )}
    </Panel>
  );
};

const pctTxt = (v: number) => `${fmtFixed(v * 100, 0)}%`;
const distTxt = (s: SideStats) => (s.liqDistPct ? `${fmtFixed(s.liqDistPct.p50, 1)}%` : DASH);

const EntryBody: React.FC<{ map: EntryMap; delayed: boolean }> = ({ map, delayed }) => (
  <div className="flex flex-col gap-4 p-4">
    {delayed && (
      <div className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-ink-2">
        {tr(`Połowa wartości pochodzi z odczytów pozycji starszych niż ${Math.round(map.ageMin.ntlP50)} min.`, `Half of the value comes from position reads older than ${Math.round(map.ageMin.ntlP50)} min.`)}
      </div>
    )}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-3">
      <Stat
        label={tr('Longi pod wodą', 'Longs under water')}
        value={<span className="font-mono tabular-nums">{pctTxt(map.long.underwaterShare)}</span>}
        hint={tr(`wejście nad ceną · ${fmtCompact(map.long.underwaterUsd, '$')} z ${fmtCompact(map.long.ntlUsd, '$')}`, `entry above price · ${fmtCompact(map.long.underwaterUsd, '$')} of ${fmtCompact(map.long.ntlUsd, '$')}`)}
      />
      <Stat
        label={tr('Shorty pod wodą', 'Shorts under water')}
        value={<span className="font-mono tabular-nums">{pctTxt(map.short.underwaterShare)}</span>}
        hint={tr(`wejście pod ceną · ${fmtCompact(map.short.underwaterUsd, '$')} z ${fmtCompact(map.short.ntlUsd, '$')}`, `entry below price · ${fmtCompact(map.short.underwaterUsd, '$')} of ${fmtCompact(map.short.ntlUsd, '$')}`)}
      />
      <Stat
        label={tr('Do likwidacji (mediana)', 'To liquidation (median)')}
        value={
          <span className="font-mono tabular-nums">
            {distTxt(map.long)} / {distTxt(map.short)}
          </span>
        }
        hint={tr('longi / shorty, % ceny, ważone wartością', 'longs / shorts, % of price, value-weighted')}
      />
      <Stat
        label={tr('Pokrycie open interest', 'Open interest coverage')}
        value={<span className="font-mono tabular-nums">{fmtFixed(map.coverage.share * 100, 1)}%</span>}
        hint={`${map.coverage.positions.toLocaleString(locale)} ${tr('pozycji', 'positions')} · ${timeFmt.format(map.asOf)}`}
      />
    </div>
    <EntryHistogram map={map} />
    <p className="text-xs leading-relaxed text-ink-3">
      {tr(
        `Opis pozycji w zmierzonej części rynku (${fmtFixed(map.coverage.share * 100, 1)}% open interest), nie prognoza: z tej mapy nie wynika, jak cena zachowa się przy tych poziomach. Wejścia dalej niż ±${map.rangePct * 100}% od ceny liczą się do udziałów, ale nie do słupków.`,
        `A description of positions in the measured part of the market (${fmtFixed(map.coverage.share * 100, 1)}% of open interest), not a forecast: the map does not say how price will behave at these levels. Entries further than ±${map.rangePct * 100}% from price count towards the shares but not the bars.`
      )}
    </p>
  </div>
);

/** Rozkład cen wejścia wokół ceny: longi i shorty (kolor strony pozycji), linia ceny; strefy „pod wodą” podpisane. */
const EntryHistogram: React.FC<{ map: EntryMap }> = ({ map }) => {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const [hover, setHover] = useState<number | null>(null);
  const H = 170;
  const longs = useMemo(() => rebin(map.longs, map.markPx, RANGE, BINS, map.stepUsd), [map]);
  const shorts = useMemo(() => rebin(map.shorts, map.markPx, RANGE, BINS, map.stepUsd), [map]);
  const maxY = Math.max(1, ...longs.map((b, i) => b.ntlUsd + shorts[i].ntlUsd));
  const padTB = { t: 18, b: 24 };
  const y = scaleLinear().domain([0, maxY]).range([H - padTB.b, padTB.t]);
  const ticks = y.ticks(3);
  // Lewy margines z najdłuższego podpisu osi („$300,0 mln”): pismo stałej szerokości 10 px, ok. 6,2 px na znak
  const pad = { l: Math.max(48, Math.ceil(Math.max(...ticks.map((t) => fmtCompact(t, '$').length)) * 6.2) + 10), r: 10, ...padTB };
  const x = scaleLinear().domain([map.markPx * (1 - RANGE), map.markPx * (1 + RANGE)]).range([pad.l, Math.max(pad.l + 1, width - pad.r)]);
  const bw = Math.max(1, (x.range()[1] - x.range()[0]) / BINS - 2);
  const hv = hover !== null ? { l: longs[hover], s: shorts[hover] } : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-2">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-buy" aria-hidden="true" />
          {tr('wejścia longów', 'long entries')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-sell" aria-hidden="true" />
          {tr('wejścia shortów', 'short entries')}
        </span>
        <span className="text-ink-3">±{RANGE * 100}% {tr('od ceny', 'from price')}</span>
      </div>
      <div ref={ref} className="relative w-full" style={{ height: H }}>
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-label={tr('Rozkład cen wejścia pozycji według ceny', 'Distribution of position entry prices by price')}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
                <text x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-ink-3 font-mono" fontSize={10}>
                  {fmtCompact(t, '$')}
                </text>
              </g>
            ))}
            <text x={x(map.markPx) - 6} y={11} textAnchor="end" className="fill-ink-3" fontSize={10}>
              {tr('← shorty pod wodą', '← shorts under water')}
            </text>
            <text x={x(map.markPx) + 6} y={11} className="fill-ink-3" fontSize={10}>
              {tr('longi pod wodą →', 'longs under water →')}
            </text>
            {longs.map((b, i) => {
              const s = shorts[i];
              const x0 = x(b.from) + 1;
              const yl = y(b.ntlUsd);
              const ys = y(b.ntlUsd + s.ntlUsd);
              return (
                <g key={i} opacity={hover === null || hover === i ? 1 : 0.55} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                  <rect x={x0} y={pad.t} width={bw} height={H - pad.b - pad.t} fill="transparent" />
                  {b.ntlUsd > 0 && <path d={barPath(x0, yl, bw, H - pad.b - yl)} fill="var(--color-buy)" />}
                  {s.ntlUsd > 0 && <path d={barPath(x0, ys, bw, Math.max(0, yl - ys - (b.ntlUsd > 0 ? 2 : 0)))} fill="var(--color-sell)" />}
                </g>
              );
            })}
            <line x1={x(map.markPx)} x2={x(map.markPx)} y1={pad.t} y2={H - pad.b} stroke="var(--color-accent)" strokeWidth={1.5} />
            {[-RANGE, -RANGE / 2, 0, RANGE / 2, RANGE].map((t) => (
              <text key={t} x={x(map.markPx * (1 + t))} y={H - 8} textAnchor="middle" className="fill-ink-3 font-mono" fontSize={10}>
                {t === 0 ? fmtPrice(map.markPx, 0) : `${t > 0 ? '+' : '−'}${Math.abs(t * 100)}%`}
              </text>
            ))}
          </svg>
        )}
        {hv && (
          <div className="pointer-events-none absolute right-2 top-1 rounded-md border border-line bg-surface-2/95 px-2 py-1 text-[11px] text-ink-2">
            <span className="font-mono text-ink-1">
              {fmtPrice(hv.l.from, 0)}–{fmtPrice(hv.l.to, 0)}
            </span>{' '}
            · {tr('longi', 'longs')} {fmtCompact(hv.l.ntlUsd, '$')} · {tr('shorty', 'shorts')} {fmtCompact(hv.s.ntlUsd, '$')}
          </div>
        )}
      </div>
    </div>
  );
};
