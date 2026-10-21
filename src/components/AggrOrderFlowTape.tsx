import React, { useState } from 'react';
import { Flame, Layers, ShieldAlert, Zap } from 'lucide-react';
import { Badge } from '../ui';
import { useDesk } from '../state/DeskContext';
import { tickTradeCount } from '../utils/cexAdapters';
import {
  AggrTradeTick,
  ExchangeId,
  OFIMomentumSummary,
  OHLCVBar,
  OrderFlowImbalanceTick,
} from '../types/trading';

interface AggrOrderFlowTapeProps {
  trades: AggrTradeTick[];
  latestBar: OHLCVBar;
  ofiSummary: OFIMomentumSummary;
  currentPrice: number;
  onTriggerExhaustionSignal?: (
    dir: 'LONG' | 'SHORT',
    title: string,
    reason: string
  ) => void;
}

const EXCHANGE_BADGE: Record<
  ExchangeId,
  { short: string; type: 'PERP' | 'SPOT' }
> = {
  HYPERLIQUID: { short: 'HL-PERP', type: 'PERP' },
  BINANCE_FUTURES: { short: 'BIN-FUT', type: 'PERP' },
  BYBIT: { short: 'BYB-PERP', type: 'PERP' },
  OKEX: { short: 'OKX-SWAP', type: 'PERP' },
  DERIBIT: { short: 'DRB-PERP', type: 'PERP' },
  BITMEX: { short: 'BMX-PERP', type: 'PERP' },
  BINANCE: { short: 'BIN-SPOT', type: 'SPOT' },
  COINBASE: { short: 'CB-SPOT', type: 'SPOT' },
  BITFINEX: { short: 'BFX-SPOT', type: 'SPOT' },
  KRAKEN: { short: 'KRK-SPOT', type: 'SPOT' },
  BITSTAMP: { short: 'BST-SPOT', type: 'SPOT' },
};

/** Giełdy z realnym źródłem danych w aplikacji: Hyperliquid + CEX opt-in (perpy, potem spot). */
const VENUE_ROWS: ExchangeId[] = ['HYPERLIQUID', 'BINANCE_FUTURES', 'BYBIT', 'OKEX', 'BINANCE', 'COINBASE'];

// Kolory tokenów (src/index.css) dla stylów inline: kupno/sprzedaż, poziom (likwidacje/wyczerpanie), ink
const TOKEN = {
  buy: '25, 168, 142', // --color-buy
  sell: '217, 88, 46', // --color-sell
  level: '224, 160, 69', // --color-level
  line: '27, 37, 51', // --color-line
  ink1: '#EEF2F7',
  ink2: '#A9B4C4',
} as const;

// Krycie tła wg wielkości transakcji (progi tierów bez zmian — tylko wygląd)
const TIER_ALPHA: Record<AggrTradeTick['tier'], number> = {
  normal: 0.1,
  threshold: 0.1,
  significant: 0.24,
  huge: 0.4,
  rare: 0.6,
};

/** Tło wiersza taśmy: strona = barwa kupno/sprzedaż, wielkość = krycie, likwidacja = barwa poziomu. Tekst zawsze w ink (kierunek niesie znak ±). */
function getAggrRowStyle(tick: AggrTradeTick): {
  bg: string;
  text: string;
} {
  const rgb = tick.isLiquidation ? TOKEN.level : tick.side === 'buy' ? TOKEN.buy : TOKEN.sell;
  const alpha = tick.isLiquidation ? (tick.tier === 'rare' ? 0.6 : 0.35) : TIER_ALPHA[tick.tier];
  return { bg: `rgba(${rgb}, ${alpha})`, text: alpha >= 0.24 ? TOKEN.ink1 : TOKEN.ink2 };
}

/** Bardzo duże ilorazy (prawie zerowa sprzedaż) nie rozpychają kolumny. */
const fmtRatio = (r: number) => (Number.isFinite(r) ? (r >= 100 ? '>99x' : `${r.toFixed(2)}x`) : '—');

/**
 * Thermal heatmap background color for the Order Flow Imbalance (OFI) Side-Bar cell
 * based on aggressive Buy/Sell ratio, normalized OFI [-1, +1], and Momentum Exhaustion state.
 */
function getOfiHeatmapCellStyle(tick: OrderFlowImbalanceTick): {
  bg: string;
  border: string;
  ratioColor: string;
  tag: string | null;
} {
  // Wyczerpanie/absorpcja: barwa poziomu, rodzaj w etykiecie (nie w samym kolorze)
  if (
    tick.exhaustionState === 'ASK_WALL_ABSORPTION' ||
    tick.exhaustionState === 'BUY_EXHAUSTION'
  ) {
    return {
      bg: `rgba(${TOKEN.level}, 0.16)`,
      border: `rgba(${TOKEN.level}, 0.7)`,
      ratioColor: TOKEN.ink1,
      tag: tick.exhaustionState === 'ASK_WALL_ABSORPTION' ? 'ABS-ASK' : 'EXH-BUY',
    };
  }

  if (
    tick.exhaustionState === 'BID_WALL_ABSORPTION' ||
    tick.exhaustionState === 'SELL_EXHAUSTION'
  ) {
    return {
      bg: `rgba(${TOKEN.level}, 0.16)`,
      border: `rgba(${TOKEN.level}, 0.7)`,
      ratioColor: TOKEN.ink1,
      tag: tick.exhaustionState === 'BID_WALL_ABSORPTION' ? 'ABS-BID' : 'EXH-SELL',
    };
  }

  // Przewaga kupna/sprzedaży: barwa strony, siła = krycie (progi bez zmian); tekst w ink
  const alpha = Math.min(0.62, Math.max(0.12, Math.abs(tick.ofiNormalized) * 0.75)) * 0.6;
  if (tick.ofiNormalized >= 0.08) {
    return {
      bg: `rgba(${TOKEN.buy}, ${alpha.toFixed(2)})`,
      border: `rgba(${TOKEN.buy}, 0.3)`,
      ratioColor: TOKEN.ink1,
      tag: null,
    };
  }
  if (tick.ofiNormalized <= -0.08) {
    return {
      bg: `rgba(${TOKEN.sell}, ${alpha.toFixed(2)})`,
      border: `rgba(${TOKEN.sell}, 0.3)`,
      ratioColor: TOKEN.ink1,
      tag: null,
    };
  }

  return {
    bg: `rgba(${TOKEN.line}, 0.6)`,
    border: `rgba(${TOKEN.line}, 1)`,
    ratioColor: TOKEN.ink2,
    tag: null,
  };
}

/**
 * Wiersz drabiny DOM + OFI. Wartości w ink; strona niesie kolor znacznika (pasek przy cenie, tło głębokości)
 * i pozycja (ask nad ceną, bid pod). Na wąskich telefonach (< 400 px) chowamy liczbę zleceń.
 */
const DomRow: React.FC<{
  tick: OrderFlowImbalanceTick;
  maxRestingUsd: number;
  onHover: (t: OrderFlowImbalanceTick | null) => void;
}> = ({ tick, maxRestingUsd, onHover }) => {
  const isAsk = tick.side === 'ASK';
  const depthPct = Math.min(100, (tick.restingSizeUsd / maxRestingUsd) * 100);
  const ofiCell = getOfiHeatmapCellStyle(tick);
  const buyBarPct = Math.round(((tick.ofiNormalized + 1) / 2) * 100);

  return (
    <div
      onMouseEnter={() => onHover(tick)}
      onMouseLeave={() => onHover(null)}
      className="grid grid-cols-2 items-center px-2.5 py-1 hover:bg-surface-2 transition-colors duration-150"
    >
      <div className="relative flex items-center justify-between gap-1 pr-2 border-r border-line overflow-hidden">
        <div
          className={`absolute right-2 top-0 bottom-0 rounded-sm pointer-events-none ${isAsk ? 'bg-sell/15' : 'bg-buy/15'}`}
          style={{ width: `${depthPct.toFixed(0)}%` }}
        />
        <span className={`relative pl-1.5 border-l-2 font-medium text-ink-1 ${isAsk ? 'border-sell' : 'border-buy'}`}>
          {tick.price.toFixed(1)}
        </span>
        <span className="relative text-ink-2">
          {tick.restingSizeBtc.toFixed(2)}
          <span className="text-[10px] text-ink-3 max-[400px]:hidden"> ({tick.orderCount})</span>
        </span>
      </div>

      <div
        className="ml-1.5 px-1.5 py-0.5 rounded-sm flex items-center justify-between gap-1.5 border min-w-0"
        style={{ backgroundColor: ofiCell.bg, borderColor: ofiCell.border }}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="font-semibold text-[10px] w-9 shrink-0" style={{ color: ofiCell.ratioColor }}>
            {fmtRatio(tick.buySellRatio)}
          </span>
          {/* Udział agresywnego kupna (lewa część) vs sprzedaży */}
          <div className="flex-1 h-1.5 bg-page rounded-full overflow-hidden flex" aria-hidden="true">
            <div className="bg-buy h-full" style={{ width: `${buyBarPct}%` }} />
            <div className="bg-sell h-full" style={{ width: `${100 - buyBarPct}%` }} />
          </div>
        </div>
        {ofiCell.tag ? (
          <span className="text-[9px] font-semibold text-ink-1 tracking-tight shrink-0">{ofiCell.tag}</span>
        ) : (
          <span className="text-[10px] text-ink-2 shrink-0">
            {tick.deltaUsd >= 0 ? '+' : '−'}
            {Math.abs(tick.deltaUsd / 1000).toFixed(0)}K
          </span>
        )}
      </div>
    </div>
  );
};

export const AggrOrderFlowTape: React.FC<AggrOrderFlowTapeProps> = ({
  trades,
  latestBar,
  ofiSummary,
  currentPrice,
  onTriggerExhaustionSignal,
}) => {
  const [viewMode, setViewMode] = useState<'dom_ofi' | 'tape' | 'venues'>(
    'dom_ofi'
  );
  const [tapeFilter, setTapeFilter] = useState<'all' | 'perp' | 'spot' | 'liq'>(
    'all'
  );
  const [hoveredTick, setHoveredTick] =
    useState<OrderFlowImbalanceTick | null>(null);

  const filteredTrades = trades.filter((t) => {
    if (tapeFilter === 'perp') return t.isPerp && !t.isLiquidation;
    if (tapeFilter === 'spot') return !t.isPerp && !t.isLiquidation;
    if (tapeFilter === 'liq') return t.isLiquidation;
    return true;
  });

  const askTicks = ofiSummary.ticks.filter((t) => t.side === 'ASK').slice(-8);
  const bidTicks = ofiSummary.ticks.filter((t) => t.side === 'BID').slice(0, 8);
  const maxRestingUsd = Math.max(
    1,
    ...askTicks.map((t) => t.restingSizeUsd),
    ...bidTicks.map((t) => t.restingSizeUsd)
  );

  // Delta per giełda w bieżącej świecy (jak chart8 w aggrBTCv5) — tylko giełdy z realnym źródłem:
  // Hyperliquid zawsze, CEX po opt-in. Liczność = transakcje danej giełdy w buforze taśmy.
  const { cexEnabled, setView } = useDesk();
  const tradeCounts = new Map<ExchangeId, number>();
  for (const t of trades) tradeCounts.set(t.exchange, (tradeCounts.get(t.exchange) ?? 0) + tickTradeCount(t));
  const exchangeRows = VENUE_ROWS.map((exId) => {
    const vol = latestBar.exchanges[exId] ?? { vbuy: 0, vsell: 0 };
    const total = vol.vbuy + vol.vsell;
    return {
      id: exId,
      label: EXCHANGE_BADGE[exId].short,
      type: EXCHANGE_BADGE[exId].type,
      delta: vol.vbuy - vol.vsell,
      buyPct: total > 0 ? (vol.vbuy / total) * 100 : null,
      count: tradeCounts.get(exId) ?? 0,
    };
  });

  // Kierunek wynika wyłącznie z biasu wyczerpania; kontynuacja/równowaga nie daje sygnału odwrócenia
  const exhaustionDir: 'LONG' | 'SHORT' | null =
    ofiSummary.exhaustionBias === 'BULLISH_EXHAUSTION_TOP_RISK'
      ? 'SHORT'
      : ofiSummary.exhaustionBias === 'BEARISH_EXHAUSTION_BOTTOM_REVERSAL'
      ? 'LONG'
      : null;

  const handleFireExhaustionTrade = () => {
    if (!onTriggerExhaustionSignal || !exhaustionDir) return;
    const dir = exhaustionDir;
    const px = ofiSummary.dominantExhaustionTick ?? currentPrice;
    onTriggerExhaustionSignal(
      dir,
      dir === 'SHORT'
        ? `HYPERLIQUID OFI EXHAUSTION SHORT // ASK ABSORPTION @ $${px.toFixed(1)}`
        : `HYPERLIQUID OFI EXHAUSTION LONG // BID ABSORPTION @ $${px.toFixed(1)}`,
      ofiSummary.exhaustionNote
    );
  };

  return (
    <div className="flex flex-col h-full bg-surface-1 border border-line rounded-xl overflow-hidden">
      {/* Nagłówek: tytuł + podsumowanie OFI, pod spodem zakładki na całą szerokość (cel ≥ 44 px na telefonie) */}
      <div className="px-3 pt-2.5 pb-2 border-b border-line space-y-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-ink-3 shrink-0" aria-hidden="true" />
            <h2 className="font-display text-sm font-semibold text-ink-1 tracking-tight truncate">
              Arkusz L2 i przepływ (OFI)
            </h2>
          </div>
          <p className="mt-0.5 text-[11px] text-ink-3 font-mono tabular-nums truncate">
            B/S <span className="text-ink-1">{fmtRatio(ofiSummary.overallBuySellRatio)}</span> · OFI{' '}
            <span className="text-ink-1">
              {ofiSummary.overallOfiPct > 0 ? '+' : ''}
              {ofiSummary.overallOfiPct}%
            </span>{' '}
            · wyczerpanie <span className="text-ink-1">{ofiSummary.exhaustionIndex}/100</span>
          </p>
        </div>

        <div role="tablist" aria-label="Widok arkusza" className="grid grid-cols-3 gap-0.5 bg-page p-0.5 rounded-lg border border-line">
          {(
            [
              { id: 'dom_ofi', label: 'DOM + OFI' },
              { id: 'tape', label: 'Taśma' },
              { id: 'venues', label: 'Venues' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={viewMode === tab.id}
              onClick={() => setViewMode(tab.id)}
              className={`min-h-11 lg:min-h-8 px-2 text-xs font-medium rounded-md transition-colors duration-150 whitespace-nowrap ${
                viewMode === tab.id
                  ? 'bg-surface-3 text-ink-1 shadow-[inset_0_0_0_1px_var(--color-line-strong)]'
                  : 'text-ink-3 hover:text-ink-1'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {viewMode === 'dom_ofi' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Nagłówki kolumn: lewa = arkusz L2, prawa = OFI (agresywne kupno/sprzedaż na poziomie) */}
          <div className="grid grid-cols-2 border-b border-line px-2.5 py-1.5 text-[10px] uppercase tracking-[0.06em] text-ink-3">
            <div className="flex items-center justify-between pr-2 border-r border-line">
              <span>Cena</span>
              <span>
                BTC<span className="max-[400px]:hidden normal-case"> (zlecenia)</span>
              </span>
            </div>
            <div className="flex items-center justify-between pl-2">
              <span>OFI kup/sprz</span>
              <span>Δ $</span>
            </div>
          </div>

          {/* Drabina: aski nad ceną, bidy pod ceną (pozycja = drugi kanał obok koloru) */}
          <div className="flex-1 overflow-y-auto divide-y divide-line/60 font-mono tabular-nums text-[11px]">
            {askTicks.map((tick) => (
              <DomRow key={`ask-${tick.price}`} tick={tick} maxRestingUsd={maxRestingUsd} onHover={setHoveredTick} />
            ))}

            {/* Cena środkowa i podsumowanie OFI */}
            <div className="px-2.5 py-1.5 bg-page border-y border-line flex items-center justify-between gap-2 text-xs font-mono tabular-nums">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="font-semibold text-ink-1">{currentPrice.toFixed(1)}</span>
                <span className="text-[10px] text-ink-3 truncate">
                  mid · B/S {fmtRatio(ofiSummary.overallBuySellRatio)}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5 text-[10px] shrink-0">
                <span className="text-ink-3">wyczerpanie</span>
                <span className={ofiSummary.exhaustionIndex >= 70 ? 'text-ink-1 font-semibold' : 'text-ink-2'}>
                  {ofiSummary.exhaustionIndex >= 70 && (
                    <span className="text-level" aria-hidden="true">
                      ●{' '}
                    </span>
                  )}
                  {ofiSummary.exhaustionIndex}/100
                </span>
              </div>
            </div>

            {bidTicks.map((tick) => (
              <DomRow key={`bid-${tick.price}`} tick={tick} maxRestingUsd={maxRestingUsd} onHover={setHoveredTick} />
            ))}
          </div>

          {/* Momentum Exhaustion Diagnostic & Live Mini-Tape Footer */}
          <div className="border-t border-line p-2.5 space-y-2">
            {hoveredTick ? (
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums bg-surface-2 border border-line rounded-lg px-2.5 py-1.5">
                <div className="min-w-0">
                  <span className="text-ink-1 font-semibold">
                    {hoveredTick.price.toFixed(1)}{' '}
                    <span className="text-ink-3 font-normal">({hoveredTick.side === 'ASK' ? 'ask ▲' : 'bid ▼'})</span>
                  </span>
                  <div className="text-[10px] text-ink-3">
                    mkt kupno <span className="text-ink-2">${(hoveredTick.aggressiveBuyUsd / 1000).toFixed(0)}K</span> · mkt sprz.{' '}
                    <span className="text-ink-2">${(hoveredTick.aggressiveSellUsd / 1000).toFixed(0)}K</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-ink-1 font-semibold">B/S {fmtRatio(hoveredTick.buySellRatio)}</div>
                  <div className="text-[10px] text-ink-3">
                    wyczerpanie <span className="text-ink-2">{hoveredTick.exhaustionScore}/100</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-2 bg-surface-2 border border-line rounded-lg px-2.5 py-1.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-1">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-level" aria-hidden="true" />
                    <span className="truncate">Detektor wyczerpania momentum</span>
                  </div>
                  <p className="text-[11px] text-ink-2 leading-snug mt-0.5 line-clamp-2">{ofiSummary.exhaustionNote}</p>
                </div>
                {onTriggerExhaustionSignal && (
                  <button
                    type="button"
                    onClick={handleFireExhaustionTrade}
                    disabled={!exhaustionDir}
                    aria-label={exhaustionDir ? `Przekaż scenariusz ${exhaustionDir} do Analizatora planu` : 'Brak wyczerpania — brak scenariusza do oceny'}
                    title={exhaustionDir ? `Ręczny scenariusz ${exhaustionDir} → Analizator planu` : 'Brak wyczerpania — brak kierunku odwrócenia'}
                    className="min-h-11 lg:min-h-8 px-2.5 text-[11px] font-medium text-ink-1 bg-surface-3 hover:bg-line-strong border border-line-strong rounded-lg flex items-center gap-1 shrink-0 transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Zap className="w-3 h-3 text-level" aria-hidden="true" />
                    <span>Do planu</span>
                  </button>
                )}
              </div>
            )}

            {/* Trzy ostatnie transakcje: znak ± niesie kierunek, kolor tła — stronę i wielkość */}
            <div className="space-y-0.5">
              {trades.slice(0, 3).map((t) => {
                const style = getAggrRowStyle(t);
                const badge = EXCHANGE_BADGE[t.exchange];
                return (
                  <div
                    key={t.id}
                    style={{ backgroundColor: style.bg, color: style.text }}
                    className="px-2 py-0.5 rounded-sm flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums"
                  >
                    <span className="truncate">
                      {badge?.short ?? t.exchange} {t.price.toFixed(1)}
                    </span>
                    <span className="font-semibold shrink-0">
                      {t.isLiquidation ? 'LIQ ' : ''}
                      {t.side === 'buy' ? 'kupno +' : 'sprz. −'}${(t.sizeUsd / 1000).toFixed(1)}K
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {viewMode === 'tape' && (
        <div className="flex-1 flex flex-col min-h-0">
          <div role="radiogroup" aria-label="Filtr taśmy" className="px-2.5 py-1.5 border-b border-line grid grid-cols-4 gap-1">
            {(
              [
                { id: 'all', label: 'Wszystko' },
                { id: 'perp', label: 'Perp' },
                { id: 'spot', label: 'Spot' },
                { id: 'liq', label: 'Likwidacje' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={tapeFilter === f.id}
                onClick={() => setTapeFilter(f.id)}
                className={`min-h-11 lg:min-h-7 px-1 text-[11px] rounded-md transition-colors duration-150 ${
                  tapeFilter === f.id ? 'bg-surface-3 text-ink-1 font-medium' : 'text-ink-3 hover:text-ink-1'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-line/60">
            {filteredTrades.length === 0 && (
              <p className="px-3 py-6 text-xs text-ink-3">Brak transakcji dla tego filtra.</p>
            )}
            {filteredTrades.slice(0, 45).map((t) => {
              const style = getAggrRowStyle(t);
              const badge = EXCHANGE_BADGE[t.exchange];
              const ageSec = Math.max(
                0,
                Math.floor((Date.now() - t.timestamp) / 1000)
              );
              return (
                <div
                  key={t.id}
                  style={{ backgroundColor: style.bg, color: style.text }}
                  className="px-3 py-1 min-h-7 flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium w-16 truncate max-[400px]:w-14">
                      {badge?.short ?? t.exchange}
                    </span>
                    <span>{t.price.toFixed(1)}</span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {tickTradeCount(t) > 1 && (
                      <span className="text-[10px] text-ink-3" title={`Suma ${tickTradeCount(t)} drobnych transakcji tej giełdy z jednej paczki (≤ 1 s)`}>
                        Σ{tickTradeCount(t)}
                      </span>
                    )}
                    {t.isSynthetic && (
                      <Badge tone="sim" title="Tick symulowany (tryb modelu) — nie jest realną transakcją">
                        SIM
                      </Badge>
                    )}
                    {t.isLiquidation && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider">
                        LIQ {t.side === 'buy' ? 'SHORT' : 'LONG'}
                      </span>
                    )}
                    <span className="font-semibold">
                      {t.side === 'buy' ? '+' : '−'}$
                      {t.sizeUsd >= 1000000
                        ? `${(t.sizeUsd / 1000000).toFixed(2)}M`
                        : `${(t.sizeUsd / 1000).toFixed(1)}K`}
                    </span>
                    <span className="text-[10px] opacity-70 w-7 text-right max-[400px]:hidden">
                      {ageSec}s
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {viewMode === 'venues' && (
        <div className="flex-1 p-3 overflow-y-auto">
          <div className="flex items-center justify-between gap-2 text-[11px] text-ink-3 mb-1.5">
            <span className="font-medium text-ink-2 flex items-center gap-1.5 min-w-0">
              <Layers className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">Delta per giełda · bieżąca świeca</span>
            </span>
            <span className="shrink-0">kupno / sprzedaż</span>
          </div>

          <ul className="divide-y divide-line/60">
            {exchangeRows.map((row) => {
              const isCex = row.id !== 'HYPERLIQUID';
              const off = isCex && !cexEnabled;
              return (
                <li
                  key={row.id}
                  title={
                    off
                      ? 'Giełda CEX — dane tylko po włączeniu w Źródłach (opt-in)'
                      : `${row.count} transakcji w buforze taśmy (ostatnie 120 wpisów)`
                  }
                  className={`flex items-center gap-2 py-1.5 text-[11px] font-mono tabular-nums ${off ? 'opacity-60' : ''}`}
                >
                  <span className="w-[72px] shrink-0 truncate font-medium text-ink-1">{row.label}</span>
                  <span className="w-9 shrink-0 text-[10px] text-ink-3">{row.type.toLowerCase()}</span>
                  {/* Udział kupna (lewa część) vs sprzedaży; brak wolumenu = pusta szyna */}
                  <span className="flex-1 h-2 bg-page rounded-full overflow-hidden flex" aria-hidden="true">
                    {row.buyPct !== null && (
                      <>
                        <span className="bg-buy h-full" style={{ width: `${row.buyPct.toFixed(1)}%` }} />
                        <span className="bg-sell h-full" style={{ width: `${(100 - row.buyPct).toFixed(1)}%` }} />
                      </>
                    )}
                  </span>
                  <span className="w-14 shrink-0 text-right text-ink-1 font-semibold">
                    {row.buyPct === null ? '—' : `${row.delta >= 0 ? '+' : '−'}${Math.abs(row.delta / 1000).toFixed(0)}K`}
                  </span>
                  <span className="w-10 shrink-0 text-right text-[10px] text-ink-3 max-[400px]:hidden">
                    {off ? 'off' : row.count > 0 ? `${row.count} tr.` : '—'}
                  </span>
                </li>
              );
            })}
          </ul>

          {!cexEnabled && (
            <p className="mt-2 text-[11px] text-ink-3 leading-snug">
              Giełdy CEX są opcjonalne i łączone z Twojej przeglądarki.{' '}
              <button
                type="button"
                onClick={() => setView('sources')}
                className="min-h-11 lg:min-h-0 text-accent underline-offset-2 hover:underline"
              >
                Włącz w Źródłach
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  );
};
