import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { hierarchy, interpolateLab, treemap, treemapSquarify } from 'd3';
import { useDesk } from '../../state/DeskContext';
import { freshness, PERIOD_MS, useCrossMarket } from '../../state/useCrossMarket';
import { MarketRow, topWithOther } from '../../utils/hlMarkets';
import { Badge, EmptyState, Panel, Segmented, SPRING, fmtCompact, fmtPct, fmtPrice, DASH } from '../../ui';
import { tr } from '../../i18n';

type Metric = 'oi' | 'vol';
const TOP_N = 40;
/** Obcięcie skali koloru zmiany 24h (±8%) — wartości poza zakresem mają kolor bieguna. */
const CLIP_PCT = 8;

/** Szerokość elementu z ResizeObserver (0 przed pierwszym pomiarem). */
export function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver((entries) => setW(Math.round(entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Kolory z tokenów `@theme` (src/index.css); wartości awaryjne = te same tokeny. */
function readTokens() {
  const css = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null;
  const get = (name: string, fallback: string) => css?.getPropertyValue(name).trim() || fallback;
  return {
    buy: get('--color-buy', '#19a88e'),
    sell: get('--color-sell', '#d9582e'),
    mid: get('--color-line-strong', '#283447'),
    inkLight: get('--color-ink-1', '#eef2f7'),
    inkDark: get('--color-page', '#070a11'),
  };
}

/** Względna luminancja WCAG koloru w formacie rgb(...) lub #hex. */
function luminance(color: string): number {
  let r = 0, g = 0, b = 0;
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (m) [r, g, b] = m[1].split(',').map((x) => parseFloat(x) / 255);
  else if (/^#[0-9a-f]{6}$/i.test(color)) [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** Pomiar tekstu przed umieszczeniem etykiety w kaflu (etykieta tylko, gdy się mieści). */
function textWidth(text: string, font: string): number {
  if (measureCtx === undefined) measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if (!measureCtx) return text.length * 7.5;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}
const FONT_COIN = '600 12px "Plus Jakarta Sans", sans-serif';
const FONT_CHG = '400 11px "IBM Plex Mono", monospace';

interface Tile {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  row: MarketRow | null;
  other: { count: number; total: number } | null;
  fill: string;
  ink: string;
}

interface Node {
  id: string;
  value: number;
  row: MarketRow | null;
  other: { count: number; total: number } | null;
  children?: Node[];
}

const signedPct = (v: number | null) => (v === null ? DASH : fmtPct(v, 2));
const arrow = (v: number | null) => (v === null ? '' : v >= 0 ? '▲ ' : '▼ ');

/** Mapa rynku perpów HL: treemap (squarified), rozmiar = OI lub wolumen 24h, kolor = zmiana 24h. */
export const MarketMap: React.FC = () => {
  const { feed } = useDesk();
  const cm = useCrossMarket(['map']);
  const reduce = useReducedMotion();
  const [metric, setMetric] = useState<Metric>('oi');
  const [active, setActive] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef<(HTMLDivElement | null)[]>([]);
  const width = useElementWidth(boxRef);
  const height = width < 640 ? Math.round(Math.max(300, width * 0.95)) : Math.round(Math.min(460, Math.max(320, width * 0.5)));
  const tokens = useMemo(readTokens, []);

  const colorFor = useMemo(() => {
    const toBuy = interpolateLab(tokens.mid, tokens.buy);
    const toSell = interpolateLab(tokens.mid, tokens.sell);
    return (chg: number | null) => {
      if (chg === null) return tokens.mid;
      const t = Math.max(-1, Math.min(1, chg / CLIP_PCT));
      return t >= 0 ? toBuy(t) : toSell(-t);
    };
  }, [tokens]);

  const tiles: Tile[] = useMemo(() => {
    if (!cm.markets || width <= 0) return [];
    const value = (r: MarketRow) => (metric === 'oi' ? r.oiUsd : r.volume24hUsd);
    const { top, other } = topWithOther(cm.markets, value, TOP_N);
    const children: Node[] = top.map((r) => ({ id: r.coin, value: value(r), row: r, other: null }));
    if (other) children.push({ id: '__other', value: other.total, row: null, other });
    const root = hierarchy<Node>({ id: 'root', value: 0, row: null, other: null, children })
      .sum((d) => (d.children ? 0 : d.value))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    treemap<Node>().tile(treemapSquarify).size([width, height]).paddingInner(2).round(true)(root);
    return root.leaves().map((l) => {
      const n = l as typeof l & { x0: number; y0: number; x1: number; y1: number };
      const fill = colorFor(n.data.row?.change24hPct ?? null);
      // Tekst w kaflu: jasny albo ciemny wg luminancji wypełnienia (kontrast ≥ 4.5:1)
      const lf = luminance(fill);
      const ink = (lf + 0.05) / (luminance(tokens.inkDark) + 0.05) > (luminance(tokens.inkLight) + 0.05) / (lf + 0.05) ? tokens.inkDark : tokens.inkLight;
      return { id: n.data.id, x: n.x0, y: n.y0, w: n.x1 - n.x0, h: n.y1 - n.y0, row: n.data.row, other: n.data.other, fill, ink };
    });
  }, [cm.markets, metric, width, height, colorFor, tokens]);

  const fr = freshness(cm.marketsAt, PERIOD_MS.map, feed.nowTick);
  const activeIdx = Math.min(active, Math.max(0, tiles.length - 1));
  const shown = tiles.find((t) => t.id === hover) ?? null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    const map: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let next = activeIdx;
    if (e.key in map) next = Math.max(0, Math.min(tiles.length - 1, activeIdx + map[e.key]));
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tiles.length - 1;
    else return;
    e.preventDefault();
    setActive(next);
    tileRefs.current[next]?.focus();
  };

  const label = (t: Tile) =>
    t.row
      ? tr(
          `${t.row.coin}: cena ${fmtPrice(t.row.markPx, priceDigits(t.row.markPx))}, 24h ${signedPct(t.row.change24hPct)}, OI ${fmtCompact(t.row.oiUsd, '$')}, wolumen 24h ${fmtCompact(t.row.volume24hUsd, '$')}, funding ${signedPct(t.row.fundingAprPct)} APR`,
          `${t.row.coin}: price ${fmtPrice(t.row.markPx, priceDigits(t.row.markPx))}, 24h ${signedPct(t.row.change24hPct)}, OI ${fmtCompact(t.row.oiUsd, '$')}, 24h volume ${fmtCompact(t.row.volume24hUsd, '$')}, funding ${signedPct(t.row.fundingAprPct)} APR`
        )
      : tr(`Inne: ${t.other?.count ?? 0} rynków, łącznie ${fmtCompact(t.other?.total ?? null, '$')}`, `Other: ${t.other?.count ?? 0} markets, total ${fmtCompact(t.other?.total ?? null, '$')}`);

  return (
    <Panel
      title={tr('Mapa rynku', 'Market map')}
      eyebrow={tr(`Perpy Hyperliquid · top ${TOP_N} + inne`, `Hyperliquid perps · top ${TOP_N} + other`)}
      actions={
        <>
          <Segmented<Metric>
            ariaLabel={tr('Rozmiar kafla', 'Tile size')}
            value={metric}
            onChange={setMetric}
            options={[
              { value: 'oi', label: 'OI' },
              { value: 'vol', label: tr('Wolumen 24h', '24h volume') },
            ]}
          />
          <Badge tone={fr === 'live' ? 'live' : 'stale'} title={tr('metaAndAssetCtxs z publicznego API Hyperliquid, odświeżane co 60 s', 'metaAndAssetCtxs from the public Hyperliquid API, refreshed every 60 s')}>
            {fr === 'live' ? 'LIVE' : fr === 'stale' ? 'STALE' : tr('BRAK', 'NONE')}
          </Badge>
        </>
      }
      bodyClassName="p-4 flex flex-col gap-3"
    >
      <div ref={boxRef} className="relative w-full" style={{ height: cm.markets ? height : undefined }}>
        {!cm.markets ? (
          <EmptyState
            title={tr('Czekam na dane rynków', 'Waiting for market data')}
            detail={tr('metaAndAssetCtxs z publicznego API Hyperliquid — mapa pojawi się po pierwszej odpowiedzi.', 'metaAndAssetCtxs from the public Hyperliquid API; the map appears after the first response.')}
          />
        ) : (
          <div role="list" aria-label={tr('Mapa rynku: kafle wg rozmiaru, kolor = zmiana 24h. Strzałki zmieniają kafel.', 'Market map: tiles by size, colour = 24h change. Arrow keys move between tiles.')} onKeyDown={onKeyDown}>
            {tiles.map((t, i) => {
              const coin = t.row ? t.row.coin : `${tr('Inne', 'Other')} (${t.other?.count ?? 0})`;
              const chg = t.row ? signedPct(t.row.change24hPct) : '';
              const showCoin = t.w >= textWidth(coin, FONT_COIN) + 10 && t.h >= 20;
              const showChg = showCoin && chg !== '' && t.h >= 36 && t.w >= textWidth(chg, FONT_CHG) + 10;
              const isBtc = t.row?.coin === 'BTC';
              return (
                <motion.div
                  key={t.id}
                  ref={(el) => {
                    tileRefs.current[i] = el;
                  }}
                  role="listitem"
                  tabIndex={i === activeIdx ? 0 : -1}
                  aria-label={label(t)}
                  initial={false}
                  animate={{ x: t.x, y: t.y, width: t.w, height: t.h }}
                  transition={reduce ? { duration: 0 } : SPRING}
                  onPointerEnter={() => setHover(t.id)}
                  onPointerLeave={() => setHover((h) => (h === t.id ? null : h))}
                  onFocus={() => {
                    setActive(i);
                    setHover(t.id);
                  }}
                  onBlur={() => setHover((h) => (h === t.id ? null : h))}
                  className="absolute left-0 top-0 rounded-[3px] overflow-hidden cursor-default focus-visible:z-10"
                  style={{
                    backgroundColor: t.fill,
                    color: t.ink,
                    boxShadow: isBtc ? `inset 0 0 0 2px ${tokens.inkLight}` : hover === t.id ? 'inset 0 0 0 1px rgba(238,242,247,0.55)' : undefined,
                  }}
                >
                  {/* Padding tylko na etykiecie — inaczej najmniejsze kafle nie mogłyby być węższe niż 12 px */}
                  {showCoin && (
                    <div className="px-1.5 py-1">
                      <div className="text-[12px] font-semibold leading-tight whitespace-nowrap">{coin}</div>
                      {showChg && <div className="text-[11px] font-mono tabular-nums leading-tight whitespace-nowrap">{chg}</div>}
                    </div>
                  )}
                </motion.div>
              );
            })}
            {shown && <MapTooltip tile={shown} boxW={width} boxH={height} />}
          </div>
        )}
      </div>

      {cm.markets && (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-[11px] text-ink-3">
          <ColorLegend colorFor={colorFor} />
          <span>
            {tr('Rozmiar', 'Size')} = {metric === 'oi' ? 'OI (USD)' : tr('wolumen 24h (USD)', '24h volume (USD)')} ·{' '}
            {tr('BTC — obrys 2 px · dane: publiczne API Hyperliquid', 'BTC: 2 px outline · data: public Hyperliquid API')}
          </span>
        </div>
      )}

      {cm.markets && <MapTable tiles={tiles} />}
    </Panel>
  );
};

function priceDigits(p: number): number {
  return p >= 1000 ? 1 : p >= 10 ? 2 : p >= 1 ? 4 : 6;
}

const MapTooltip: React.FC<{ tile: Tile; boxW: number; boxH: number }> = ({ tile, boxW, boxH }) => {
  const W = 200;
  const left = Math.max(0, Math.min(boxW - W, tile.x + tile.w / 2 - W / 2));
  // Nad kaflem, a gdy brak miejsca — pod jego górną krawędzią
  const above = tile.y > 120;
  const top = above ? tile.y - 8 : Math.min(boxH - 8, tile.y + Math.min(tile.h, 40) + 8);
  const r = tile.row;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-xs shadow-lg"
      style={{ left, top, width: W, transform: above ? 'translateY(-100%)' : undefined }}
    >
      {r ? (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-ink-1">{fmtPrice(r.markPx, priceDigits(r.markPx))}</span>
            <span className="text-ink-2 font-medium">{r.coin}</span>
          </div>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono tabular-nums">
            <dt className="text-ink-3 font-sans">24h</dt>
            <dd className="text-right text-ink-1">
              {arrow(r.change24hPct)}
              {signedPct(r.change24hPct)}
            </dd>
            <dt className="text-ink-3 font-sans">OI</dt>
            <dd className="text-right text-ink-1">{fmtCompact(r.oiUsd, '$')}</dd>
            <dt className="text-ink-3 font-sans">{tr('Wolumen 24h', '24h volume')}</dt>
            <dd className="text-right text-ink-1">{fmtCompact(r.volume24hUsd, '$')}</dd>
            <dt className="text-ink-3 font-sans">Funding APR</dt>
            <dd className="text-right text-ink-1">{signedPct(r.fundingAprPct)}</dd>
          </dl>
        </>
      ) : (
        <>
          <div className="text-sm font-semibold text-ink-1">{fmtCompact(tile.other?.total ?? null, '$')}</div>
          <div className="text-ink-2">{tr(`Inne — ${tile.other?.count ?? 0} mniejszych rynków`, `Other: ${tile.other?.count ?? 0} smaller markets`)}</div>
        </>
      )}
    </div>
  );
};

/** Legenda skali rozbieżnej: sprzedaż ↔ szary ↔ kupno, obcięta do ±8%. */
const ColorLegend: React.FC<{ colorFor: (v: number | null) => string }> = ({ colorFor }) => {
  const stops = [-8, -4, 0, 4, 8].map((v, i) => `${colorFor(v)} ${i * 25}%`).join(', ');
  return (
    <div className="flex items-center gap-2" aria-label={tr('Skala koloru: zmiana 24h od −8% do +8%, wartości poza zakresem obcięte', 'Colour scale: 24h change from −8% to +8%, values outside the range clipped')}>
      <span>{tr('Zmiana 24h', '24h change')}</span>
      <div className="flex flex-col gap-0.5">
        <div className="h-2 w-40 rounded-sm" style={{ background: `linear-gradient(to right, ${stops})` }} />
        <div className="flex justify-between w-40 font-mono tabular-nums text-[10px]">
          <span>≤ −8%</span>
          <span>0</span>
          <span>≥ +8%</span>
        </div>
      </div>
    </div>
  );
};

/** Tabelaryczny odpowiednik mapy (dostępność: wartości bez najeżdżania). */
const MapTable: React.FC<{ tiles: Tile[] }> = ({ tiles }) => (
  <details className="text-xs">
    <summary className="cursor-pointer text-ink-3 hover:text-ink-1 select-none py-1">{tr('Tabela rynków (jak na mapie)', 'Market table (as on the map)')}</summary>
    <div className="mt-2 max-h-72 overflow-auto border border-line rounded-lg">
      <table className="w-full font-mono tabular-nums">
        <thead className="sticky top-0 bg-surface-2 text-ink-3 font-sans">
          <tr>
            <th className="text-left font-medium px-2 py-1.5">{tr('Rynek', 'Market')}</th>
            <th className="text-right font-medium px-2 py-1.5">{tr('Cena', 'Price')}</th>
            <th className="text-right font-medium px-2 py-1.5">24h</th>
            <th className="text-right font-medium px-2 py-1.5">OI</th>
            <th className="text-right font-medium px-2 py-1.5">{tr('Wolumen 24h', '24h volume')}</th>
            <th className="text-right font-medium px-2 py-1.5">Funding APR</th>
          </tr>
        </thead>
        <tbody>
          {tiles.map((t) =>
            t.row ? (
              <tr key={t.id} className="border-t border-line text-ink-1">
                <td className="text-left px-2 py-1 font-sans font-medium">{t.row.coin}</td>
                <td className="text-right px-2 py-1">{fmtPrice(t.row.markPx, priceDigits(t.row.markPx))}</td>
                <td className={`text-right px-2 py-1 ${t.row.change24hPct === null ? '' : t.row.change24hPct >= 0 ? 'text-buy-ink' : 'text-sell-ink'}`}>
                  {arrow(t.row.change24hPct)}
                  {signedPct(t.row.change24hPct)}
                </td>
                <td className="text-right px-2 py-1">{fmtCompact(t.row.oiUsd, '$')}</td>
                <td className="text-right px-2 py-1">{fmtCompact(t.row.volume24hUsd, '$')}</td>
                <td className="text-right px-2 py-1">{signedPct(t.row.fundingAprPct)}</td>
              </tr>
            ) : (
              <tr key={t.id} className="border-t border-line text-ink-2">
                <td className="text-left px-2 py-1 font-sans" colSpan={6}>
                  {tr(`Inne: ${t.other?.count ?? 0} rynków, łącznie ${fmtCompact(t.other?.total ?? null, '$')}`, `Other: ${t.other?.count ?? 0} markets, total ${fmtCompact(t.other?.total ?? null, '$')}`)}
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  </details>
);

export default MarketMap;
