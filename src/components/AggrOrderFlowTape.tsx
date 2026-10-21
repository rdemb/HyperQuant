import React, { useState } from 'react';
import { Flame, Layers, ShieldAlert, Zap } from 'lucide-react';
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

function getAggrRowStyle(tick: AggrTradeTick): {
  bg: string;
  text: string;
} {
  if (tick.isLiquidation) {
    if (tick.tier === 'rare') {
      return {
        bg: tick.side === 'buy' ? 'rgb(156, 39, 176)' : 'rgb(255, 235, 59)',
        text: tick.side === 'buy' ? '#FFFFFF' : '#090D16',
      };
    }
    return {
      bg:
        tick.side === 'buy'
          ? 'rgba(236, 64, 122, 0.45)'
          : 'rgba(255, 152, 0, 0.5)',
      text: '#FFFFFF',
    };
  }

  if (tick.side === 'buy') {
    switch (tick.tier) {
      case 'rare':
        return { bg: 'rgb(100, 181, 246)', text: '#090D16' };
      case 'huge':
        return { bg: 'rgb(16, 133, 222)', text: '#FFFFFF' };
      case 'significant':
        return { bg: 'rgb(10, 85, 142)', text: '#FFFFFF' };
      default:
        return { bg: 'rgba(14, 116, 144, 0.16)', text: '#BAE6FD' };
    }
  } else {
    switch (tick.tier) {
      case 'rare':
        return { bg: 'rgb(236, 64, 122)', text: '#FFFFFF' };
      case 'huge':
        return { bg: 'rgb(127, 0, 63)', text: '#FFFFFF' };
      case 'significant':
        return { bg: 'rgb(65, 0, 33)', text: '#FDA4AF' };
      default:
        return { bg: 'rgba(159, 18, 57, 0.16)', text: '#FECDD3' };
    }
  }
}

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
  if (
    tick.exhaustionState === 'ASK_WALL_ABSORPTION' ||
    tick.exhaustionState === 'BUY_EXHAUSTION'
  ) {
    return {
      bg: 'rgba(245, 158, 11, 0.24)',
      border: 'rgba(251, 191, 36, 0.75)',
      ratioColor: '#FDE68A',
      tag: tick.exhaustionState === 'ASK_WALL_ABSORPTION' ? 'ABS-ASK' : 'EXH-BUY',
    };
  }

  if (
    tick.exhaustionState === 'BID_WALL_ABSORPTION' ||
    tick.exhaustionState === 'SELL_EXHAUSTION'
  ) {
    return {
      bg: 'rgba(16, 185, 129, 0.24)',
      border: 'rgba(52, 211, 153, 0.75)',
      ratioColor: '#A7F3D0',
      tag: tick.exhaustionState === 'BID_WALL_ABSORPTION' ? 'ABS-BID' : 'EXH-SELL',
    };
  }

  const alpha = Math.min(0.62, Math.max(0.12, Math.abs(tick.ofiNormalized) * 0.75));
  if (tick.ofiNormalized >= 0.08) {
    return {
      bg: `rgba(6, 182, 212, ${alpha.toFixed(2)})`,
      border: 'rgba(34, 211, 238, 0.25)',
      ratioColor: '#67E8F9',
      tag: null,
    };
  }
  if (tick.ofiNormalized <= -0.08) {
    return {
      bg: `rgba(244, 63, 94, ${alpha.toFixed(2)})`,
      border: 'rgba(251, 113, 133, 0.25)',
      ratioColor: '#FDA4AF',
      tag: null,
    };
  }

  return {
    bg: 'rgba(30, 41, 59, 0.45)',
    border: 'rgba(51, 65, 85, 0.4)',
    ratioColor: '#CBD5E1',
    tag: null,
  };
}

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

  // Compute exchange-by-exchange Delta from latestBar (replicating chart8 from aggrBTCv5)
  const exchangeRows = (Object.keys(EXCHANGE_BADGE) as ExchangeId[]).map(
    (exId) => {
      const vol = latestBar.exchanges[exId] ?? { vbuy: 0, vsell: 0 };
      const delta = vol.vbuy - vol.vsell;
      const total = Math.max(1, vol.vbuy + vol.vsell);
      const buyPct = (vol.vbuy / total) * 100;
      return {
        id: exId,
        label: EXCHANGE_BADGE[exId].short,
        type: EXCHANGE_BADGE[exId].type,
        delta,
        buyPct,
      };
    }
  );

  const handleFireExhaustionTrade = () => {
    if (!onTriggerExhaustionSignal) return;
    const isBearReversal =
      ofiSummary.exhaustionBias === 'BULLISH_EXHAUSTION_TOP_RISK' ||
      ofiSummary.overallBuySellRatio > 1.3;
    const dir = isBearReversal ? 'SHORT' : 'LONG';
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
    <div className="flex flex-col h-full bg-[#0B101B] border border-slate-800/80 rounded-lg overflow-hidden">
      {/* Header & Mode Switcher */}
      <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between gap-2 bg-[#090D16]">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <h2 className="text-xs font-semibold text-white tracking-tight truncate">
              L2 Order Book & OFI Heatmap Side-Bar
            </h2>
          </div>
          <p className="text-[10px] text-slate-400 font-mono tabular-nums truncate">
            Buy/Sell Ratio: {ofiSummary.overallBuySellRatio.toFixed(2)}x · OFI:{' '}
            {ofiSummary.overallOfiPct >= 0 ? '+' : ''}
            {ofiSummary.overallOfiPct}% · Exh: {ofiSummary.exhaustionIndex}%
          </p>
        </div>

        <div className="flex items-center gap-0.5 bg-[#070A12] p-0.5 rounded-md border border-slate-800 shrink-0">
          {(
            [
              { id: 'dom_ofi', label: 'DOM + OFI' },
              { id: 'tape', label: 'Aggr Tape' },
              { id: 'venues', label: 'Venues' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setViewMode(tab.id)}
              className={`px-2 py-1 text-[10px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                viewMode === tab.id
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {viewMode === 'dom_ofi' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Column Sub-Headers: Left = L2 Order Book | Right = OFI Heatmap Side-Bar */}
          <div className="grid grid-cols-12 border-b border-slate-800/90 bg-[#070A12] px-2.5 py-1.5 text-[10px] font-mono text-slate-400">
            <div className="col-span-6 flex items-center justify-between pr-2 border-r border-slate-800/80">
              <span>PRICE (USD)</span>
              <span>L2 DEPTH (BTC)</span>
            </div>
            <div className="col-span-6 flex items-center justify-between pl-2">
              <span className="text-cyan-300 font-semibold">
                OFI HEATMAP (BUY/SELL)
              </span>
              <span>EXHAUSTION</span>
            </div>
          </div>

          {/* Side-by-Side L2 Order Book + Real-Time OFI Heatmap Ladder */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-900/50 font-mono tabular-nums text-[11px]">
            {/* ASK TICKS (Above Price) */}
            {askTicks.map((tick) => {
              const depthPct = Math.min(
                100,
                (tick.restingSizeUsd / maxRestingUsd) * 100
              );
              const ofiCell = getOfiHeatmapCellStyle(tick);
              const buyBarPct = Math.round(
                ((tick.ofiNormalized + 1) / 2) * 100
              );

              return (
                <div
                  key={`ask-${tick.price}`}
                  onMouseEnter={() => setHoveredTick(tick)}
                  onMouseLeave={() => setHoveredTick(null)}
                  className="grid grid-cols-12 items-center px-2.5 py-1 hover:bg-slate-900/70 transition-colors"
                >
                  {/* Left Half: L2 Order Book Resting Ask */}
                  <div className="col-span-6 relative flex items-center justify-between pr-2 border-r border-slate-800/80 overflow-hidden">
                    <div
                      className="absolute right-0 top-0 bottom-0 bg-rose-500/15 pointer-events-none"
                      style={{ width: `${depthPct.toFixed(0)}%` }}
                    />
                    <span className="relative z-10 text-rose-400 font-medium">
                      ${tick.price.toFixed(1)}
                    </span>
                    <span className="relative z-10 text-slate-200">
                      {tick.restingSizeBtc.toFixed(2)}{' '}
                      <span className="text-[9px] text-slate-500">
                        ({tick.orderCount})
                      </span>
                    </span>
                  </div>

                  {/* Right Side-Bar: Real-Time Order Flow Imbalance (OFI) Heatmap */}
                  <div
                    className="col-span-6 ml-1.5 px-1.5 py-0.5 rounded-xs flex items-center justify-between gap-1.5 border"
                    style={{
                      backgroundColor: ofiCell.bg,
                      borderColor: ofiCell.border,
                    }}
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span
                        className="font-bold text-[10px] w-9 shrink-0"
                        style={{ color: ofiCell.ratioColor }}
                      >
                        {tick.buySellRatio.toFixed(2)}x
                      </span>

                      {/* Micro aggressive Buy vs Sell ratio bar */}
                      <div className="flex-1 h-1.5 bg-slate-950/80 rounded-xs overflow-hidden flex">
                        <div
                          className="bg-cyan-400 h-full"
                          style={{ width: `${buyBarPct}%` }}
                        />
                        <div
                          className="bg-rose-500 h-full"
                          style={{ width: `${100 - buyBarPct}%` }}
                        />
                      </div>
                    </div>

                    {ofiCell.tag ? (
                      <span className="text-[9px] font-bold text-amber-300 tracking-tighter shrink-0">
                        {ofiCell.tag}
                      </span>
                    ) : (
                      <span
                        className={`text-[10px] shrink-0 ${
                          tick.deltaUsd >= 0 ? 'text-cyan-300' : 'text-rose-300'
                        }`}
                      >
                        {tick.deltaUsd >= 0 ? '+' : ''}
                        {(tick.deltaUsd / 1000).toFixed(0)}K
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {/* SPREAD / MID-PRICE & REAL-TIME OFI PULSE BAR */}
            <div className="px-2.5 py-1.5 bg-[#070A12] border-y border-slate-800 flex items-center justify-between text-xs font-mono tabular-nums">
              <div className="flex items-center gap-2">
                <span className="font-bold text-white">
                  ${currentPrice.toFixed(1)}
                </span>
                <span className="text-[10px] text-slate-400">
                  MID · B/S {ofiSummary.overallBuySellRatio.toFixed(2)}x
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="text-slate-400">Exhaustion:</span>
                <span
                  className={
                    ofiSummary.exhaustionIndex >= 70
                      ? 'text-amber-300 font-bold'
                      : 'text-cyan-300 font-semibold'
                  }
                >
                  {ofiSummary.exhaustionIndex}%
                </span>
              </div>
            </div>

            {/* BID TICKS (Below Price) */}
            {bidTicks.map((tick) => {
              const depthPct = Math.min(
                100,
                (tick.restingSizeUsd / maxRestingUsd) * 100
              );
              const ofiCell = getOfiHeatmapCellStyle(tick);
              const buyBarPct = Math.round(
                ((tick.ofiNormalized + 1) / 2) * 100
              );

              return (
                <div
                  key={`bid-${tick.price}`}
                  onMouseEnter={() => setHoveredTick(tick)}
                  onMouseLeave={() => setHoveredTick(null)}
                  className="grid grid-cols-12 items-center px-2.5 py-1 hover:bg-slate-900/70 transition-colors"
                >
                  {/* Left Half: L2 Order Book Resting Bid */}
                  <div className="col-span-6 relative flex items-center justify-between pr-2 border-r border-slate-800/80 overflow-hidden">
                    <div
                      className="absolute right-0 top-0 bottom-0 bg-emerald-500/15 pointer-events-none"
                      style={{ width: `${depthPct.toFixed(0)}%` }}
                    />
                    <span className="relative z-10 text-emerald-400 font-medium">
                      ${tick.price.toFixed(1)}
                    </span>
                    <span className="relative z-10 text-slate-200">
                      {tick.restingSizeBtc.toFixed(2)}{' '}
                      <span className="text-[9px] text-slate-500">
                        ({tick.orderCount})
                      </span>
                    </span>
                  </div>

                  {/* Right Side-Bar: Real-Time Order Flow Imbalance (OFI) Heatmap */}
                  <div
                    className="col-span-6 ml-1.5 px-1.5 py-0.5 rounded-xs flex items-center justify-between gap-1.5 border"
                    style={{
                      backgroundColor: ofiCell.bg,
                      borderColor: ofiCell.border,
                    }}
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span
                        className="font-bold text-[10px] w-9 shrink-0"
                        style={{ color: ofiCell.ratioColor }}
                      >
                        {tick.buySellRatio.toFixed(2)}x
                      </span>

                      <div className="flex-1 h-1.5 bg-slate-950/80 rounded-xs overflow-hidden flex">
                        <div
                          className="bg-cyan-400 h-full"
                          style={{ width: `${buyBarPct}%` }}
                        />
                        <div
                          className="bg-rose-500 h-full"
                          style={{ width: `${100 - buyBarPct}%` }}
                        />
                      </div>
                    </div>

                    {ofiCell.tag ? (
                      <span className="text-[9px] font-bold text-emerald-300 tracking-tighter shrink-0">
                        {ofiCell.tag}
                      </span>
                    ) : (
                      <span
                        className={`text-[10px] shrink-0 ${
                          tick.deltaUsd >= 0 ? 'text-cyan-300' : 'text-rose-300'
                        }`}
                      >
                        {tick.deltaUsd >= 0 ? '+' : ''}
                        {(tick.deltaUsd / 1000).toFixed(0)}K
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Momentum Exhaustion Diagnostic & Live Mini-Tape Footer */}
          <div className="border-t border-slate-800 bg-[#090D16] p-2.5 space-y-2">
            {hoveredTick ? (
              <div className="flex items-center justify-between text-[11px] font-mono tabular-nums bg-[#0B101B] border border-slate-800 rounded px-2.5 py-1.5">
                <div>
                  <span className="text-white font-semibold">
                    Tick ${hoveredTick.price.toFixed(1)} ({hoveredTick.side})
                  </span>
                  <div className="text-[10px] text-slate-400">
                    Mkt Buy: ${(hoveredTick.aggressiveBuyUsd / 1000).toFixed(0)}K ·
                    Mkt Sell: ${(hoveredTick.aggressiveSellUsd / 1000).toFixed(0)}K
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-cyan-300 font-bold">
                    Ratio: {hoveredTick.buySellRatio.toFixed(2)}x
                  </div>
                  <div className="text-[10px] text-amber-300">
                    Exhaustion: {hoveredTick.exhaustionScore}%
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-2 bg-[#0B101B] border border-slate-800/90 rounded px-2.5 py-1.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-300">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">
                      Momentum Exhaustion Detector
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-300 leading-snug mt-0.5 line-clamp-2">
                    {ofiSummary.exhaustionNote}
                  </p>
                </div>
                {onTriggerExhaustionSignal && (
                  <button
                    type="button"
                    onClick={handleFireExhaustionTrade}
                    className="px-2 py-1 text-[10px] font-medium bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 rounded flex items-center gap-1 shrink-0 transition-colors"
                  >
                    <Zap className="w-3 h-3" />
                    <span>Signal</span>
                  </button>
                )}
              </div>
            )}

            {/* Ultra-low-latency 3-row Live Tick Strip */}
            <div className="space-y-0.5">
              {trades.slice(0, 3).map((t) => {
                const style = getAggrRowStyle(t);
                const badge = EXCHANGE_BADGE[t.exchange];
                return (
                  <div
                    key={t.id}
                    style={{ backgroundColor: style.bg, color: style.text }}
                    className="px-2 py-0.5 rounded-xs flex items-center justify-between text-[10px] font-mono tabular-nums"
                  >
                    <span>
                      {badge?.short ?? t.exchange} ${t.price.toFixed(1)}
                    </span>
                    <span className="font-semibold">
                      {t.side === 'buy' ? 'MKT BUY +' : 'MKT SELL -'}$
                      {(t.sizeUsd / 1000).toFixed(1)}K
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
          <div className="px-3 py-1.5 bg-[#070A12] border-b border-slate-800 flex items-center justify-between">
            <span className="text-[10px] text-slate-400">
              Filter Aggr Stream:
            </span>
            <div className="flex items-center gap-1">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'perp', label: 'Perps' },
                  { id: 'spot', label: 'Spot' },
                  { id: 'liq', label: 'Liquidations' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setTapeFilter(f.id)}
                  className={`px-2 py-0.5 text-[10px] rounded ${
                    tapeFilter === f.id
                      ? 'bg-slate-800 text-cyan-300 font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-900/60">
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
                  className="px-3 py-1 flex items-center justify-between text-[11px] font-mono tabular-nums"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold w-16 truncate">
                      {badge?.short ?? t.exchange}
                    </span>
                    <span className="opacity-85">${t.price.toFixed(1)}</span>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    {t.isLiquidation && (
                      <span className="text-[10px] font-bold uppercase tracking-wider">
                        LIQ {t.side === 'buy' ? 'SHORT' : 'LONG'}
                      </span>
                    )}
                    <span className="font-semibold">
                      {t.side === 'buy' ? '+' : '-'}$
                      {t.sizeUsd >= 1000000
                        ? `${(t.sizeUsd / 1000000).toFixed(2)}M`
                        : `${(t.sizeUsd / 1000).toFixed(1)}K`}
                    </span>
                    <span className="text-[10px] opacity-70 w-7 text-right">
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
        <div className="flex-1 p-3 overflow-y-auto space-y-2 bg-[#090D16]">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2">
            <span className="font-semibold text-slate-200 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>Venue Orderflow Delta (Pane: chart8)</span>
            </span>
            <span className="font-mono">Buy / Sell Imbalance</span>
          </div>

          {exchangeRows.map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums py-1 border-b border-slate-800/50"
            >
              <div className="flex items-center gap-1.5 w-24 shrink-0">
                <span className="text-slate-300 font-medium">{row.label}</span>
              </div>

              <div className="flex-1 h-2 bg-slate-900 rounded-xs overflow-hidden flex">
                <div
                  className="bg-sky-400/80 h-full transition-all duration-150"
                  style={{ width: `${row.buyPct.toFixed(1)}%` }}
                />
                <div
                  className="bg-rose-500/80 h-full transition-all duration-150"
                  style={{ width: `${(100 - row.buyPct).toFixed(1)}%` }}
                />
              </div>

              <div
                className={`w-18 text-right font-semibold ${
                  row.delta >= 0 ? 'text-sky-400' : 'text-rose-400'
                }`}
              >
                {row.delta >= 0 ? '+' : ''}
                {(row.delta / 1000).toFixed(0)}K
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
