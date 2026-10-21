import React, { useState } from 'react';
import {
  Bell,
  BellRing,
  Calculator,
  Cpu,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';
import {
  QuantMathMetrics,
  ShaakuniState,
  TradingSignal,
} from '../types/trading';

interface QuantSignalDeskProps {
  quant: QuantMathMetrics;
  shaakuni: ShaakuniState;
  currentPrice: number;
  signals: TradingSignal[];
  pushEnabled: boolean;
  onTogglePush: () => void;
  onTriggerTestSignal: (dir: 'LONG' | 'SHORT') => void;
}

export const QuantSignalDesk: React.FC<QuantSignalDeskProps> = ({
  quant,
  shaakuni,
  currentPrice,
  signals,
  pushEnabled,
  onTogglePush,
  onTriggerTestSignal,
}) => {
  const [accountEquityUsd, setAccountEquityUsd] = useState<number>(25000);
  const [riskPctPerTrade, setRiskPctPerTrade] = useState<number>(1.0);

  const latestSignal = signals[0] ?? null;

  // Calculate exact Hyperliquid position size based on active signal Stop Loss distance
  const slDistance = latestSignal
    ? Math.max(15, Math.abs(latestSignal.entryPrice - latestSignal.stopLoss))
    : Math.max(50, shaakuni.atr14 * 1.2);
  const dollarRisk = accountEquityUsd * (riskPctPerTrade / 100);
  const positionSizeBtc = dollarRisk / slDistance;
  const notionalUsd = positionSizeBtc * currentPrice;
  const effectiveLeverage = notionalUsd / Math.max(1, accountEquityUsd);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* Column 1 (5 cols): Real-Time Neural Time-Series Signal Generator & Push Alert Console */}
      <div className="lg:col-span-5 bg-[#0B101B] border border-slate-800/80 rounded-lg p-4 flex flex-col justify-between gap-4">
        <div>
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800">
            <div>
              <h2 className="text-sm font-semibold text-white">
                Neural Time-Series Signal Engine
              </h2>
              <p className="text-xs text-slate-400">
                Automated Quant + Shaakuni OB Signals with Push Alerts
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onTogglePush}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium border flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                  pushEnabled
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                    : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
                }`}
              >
                {pushEnabled ? (
                  <>
                    <BellRing className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Push Active</span>
                  </>
                ) : (
                  <>
                    <Bell className="w-3.5 h-3.5 text-slate-400" />
                    <span>Enable Push</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Active High-Conviction Signal Card */}
          {latestSignal ? (
            <div className="mt-3 bg-[#090D16] border border-slate-800 rounded-lg p-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {latestSignal.direction === 'LONG' ? (
                    <TrendingUp className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-rose-400 shrink-0" />
                  )}
                  <span
                    className={`text-xs font-bold tracking-tight ${
                      latestSignal.direction === 'LONG'
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                    }`}
                  >
                    {latestSignal.title}
                  </span>
                </div>
                <span className="text-xs font-mono text-cyan-300">
                  {latestSignal.confidence}% Conf · {latestSignal.riskRewardRatio}R
                </span>
              </div>

              <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
                {latestSignal.triggerReason}
              </p>

              {/* Entry / Stop Loss / TP1 / TP2 Numeric Grid */}
              <div className="grid grid-cols-4 gap-2 mt-3 pt-2.5 border-t border-slate-800/80 text-xs font-mono tabular-nums">
                <div>
                  <div className="text-[10px] text-slate-400">Entry (HL)</div>
                  <div className="text-white font-semibold">
                    ${latestSignal.entryPrice.toFixed(1)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Stop Loss</div>
                  <div className="text-rose-400 font-semibold">
                    ${latestSignal.stopLoss.toFixed(1)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">TP1 (D-EQ)</div>
                  <div className="text-emerald-400 font-semibold">
                    ${latestSignal.takeProfit1.toFixed(1)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">TP2 (Range)</div>
                  <div className="text-cyan-300 font-semibold">
                    ${latestSignal.takeProfit2.toFixed(1)}
                  </div>
                </div>
              </div>

              {/* Confluence List */}
              <div className="mt-2.5 pt-2 border-t border-slate-800/60 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400">
                {latestSignal.quantConfluence.map((c, idx) => (
                  <React.Fragment key={idx}>
                    {idx > 0 && <span aria-hidden="true">·</span>}
                    <span>{c}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-3 bg-[#090D16] border border-slate-800 rounded-lg p-4 text-xs text-slate-400">
              Scanning live Hyperliquid & Aggr orderflow for Shaakuni OB + CVD
              confluence...
            </div>
          )}
        </div>

        {/* Manual Signal Simulation / Test Trigger Bar */}
        <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2 text-xs">
          <span className="text-slate-400">Simulate Push Alert:</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onTriggerTestSignal('LONG')}
              className="px-2.5 py-1 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0"
            >
              Test Long Sweep Signal
            </button>
            <button
              type="button"
              onClick={() => onTriggerTestSignal('SHORT')}
              className="px-2.5 py-1 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0"
            >
              Test Short OB Signal
            </button>
          </div>
        </div>
      </div>

      {/* Column 2 (4 cols): Stochastic, Combinatorial & Neural Attention Telemetry */}
      <div className="lg:col-span-4 bg-[#0B101B] border border-slate-800/80 rounded-lg p-4 flex flex-col justify-between gap-3">
        <div>
          <div className="flex items-center justify-between pb-2.5 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-semibold text-white">
                Mathematical & Neural Models
              </h2>
            </div>
            <span className="text-xs font-mono text-cyan-400">
              {quant.regimeClassification}
            </span>
          </div>

          {/* Multi-Horizon Time-Series Forecast Table */}
          <div className="mt-2.5">
            <div className="text-[11px] font-medium text-slate-400 mb-1.5">
              Time-Series Prediction Trajectory (Kalman + GRU Attention)
            </div>
            <div className="grid grid-cols-4 gap-1.5 bg-[#090D16] p-2 rounded-md border border-slate-800/80 font-mono tabular-nums text-xs">
              {quant.forecastHorizon.map((fh) => {
                const diff = fh.predictedPrice - currentPrice;
                return (
                  <div key={fh.label} className="text-center">
                    <div className="text-[10px] text-slate-400">{fh.label}</div>
                    <div
                      className={`font-semibold ${
                        diff >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      ${fh.predictedPrice.toFixed(0)}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      ±${Math.round(fh.upper1Sigma - fh.predictedPrice)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quantitative Math Equations & Live Parameters */}
          <div className="mt-3 space-y-2 text-xs font-mono tabular-nums">
            <div className="flex items-center justify-between py-1 border-b border-slate-800/60">
              <span className="text-slate-400 font-sans">
                Ornstein-Uhlenbeck (Half-Life / Z)
              </span>
              <span className="text-slate-200">
                t½={quant.ouHalfLifeBars}b · Z={quant.ouZScore > 0 ? '+' : ''}
                {quant.ouZScore}σ (EQ ${quant.ouEquilibriumPrice})
              </span>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-slate-800/60">
              <span className="text-slate-400 font-sans">
                Hawkes Self-Exciting Intensity λ(t)
              </span>
              <span className="text-slate-200">
                λB={quant.hawkesBuyIntensity} / λS={quant.hawkesSellIntensity} (η=
                {quant.hawkesBranchingRatio})
              </span>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-slate-800/60">
              <span className="text-slate-400 font-sans">
                Combinatorial Hitting Prob (PDH / PDL)
              </span>
              <span className="text-cyan-300">
                P(PDH)={(quant.combinatorialPathProbPDH * 100).toFixed(1)}% · P(PDL)=
                {(quant.combinatorialPathProbPDL * 100).toFixed(1)}%
              </span>
            </div>

            <div className="flex items-center justify-between py-1">
              <span className="text-slate-400 font-sans">
                Shannon Entropy H(X) & Hurst H
              </span>
              <span className="text-slate-200">
                H(X)={quant.shannonEntropyBits} bits · Hurst={quant.hurstExponent}
              </span>
            </div>
          </div>
        </div>

        {/* Neural Layer Attention Weights Bar */}
        <div className="pt-2 border-t border-slate-800">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>Neural Feature Attention Allocation</span>
            <span className="font-mono text-slate-300">
              OB {(quant.neuralAttentionWeights.shaakuniOBProximity * 100).toFixed(0)}% ·
              CVD {(quant.neuralAttentionWeights.spotCvdDelta * 100).toFixed(0)}% · Liq{' '}
              {(quant.neuralAttentionWeights.perpFundingAndLiq * 100).toFixed(0)}%
            </span>
          </div>
          <div className="w-full h-2 bg-slate-900 rounded-xs overflow-hidden flex">
            <div
              className="bg-blue-500 h-full"
              style={{
                width: `${quant.neuralAttentionWeights.shaakuniOBProximity * 100}%`,
              }}
              title="Shaakuni OB Proximity"
            />
            <div
              className="bg-cyan-400 h-full"
              style={{
                width: `${quant.neuralAttentionWeights.spotCvdDelta * 100}%`,
              }}
              title="Spot CVD Delta"
            />
            <div
              className="bg-amber-400 h-full"
              style={{
                width: `${quant.neuralAttentionWeights.perpFundingAndLiq * 100}%`,
              }}
              title="Liquidation Magnet"
            />
            <div
              className="bg-emerald-400 h-full"
              style={{
                width: `${
                  (quant.neuralAttentionWeights.l2BookImbalance +
                    quant.neuralAttentionWeights.hawkesCascadeVelocity) *
                  100
                }%`,
              }}
              title="L2 Imbalance & Hawkes Velocity"
            />
          </div>
        </div>
      </div>

      {/* Column 3 (3 cols): Hyperliquid Execution & Kelly Criterion Position Desk */}
      <div className="lg:col-span-3 bg-[#0B101B] border border-slate-800/80 rounded-lg p-4 flex flex-col justify-between gap-3">
        <div>
          <div className="flex items-center justify-between pb-2.5 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Calculator className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-semibold text-white">
                Hyperliquid Kelly Sizing
              </h2>
            </div>
            <span className="text-xs font-mono text-emerald-400">
              Optimal {latestSignal?.kellyOptimalLeverage ?? 8}x
            </span>
          </div>

          <div className="mt-3 space-y-2.5 text-xs">
            <label className="flex items-center justify-between text-slate-300">
              <span>HL Account Equity ($)</span>
              <input
                type="number"
                min={500}
                step={500}
                value={accountEquityUsd}
                onChange={(e) =>
                  setAccountEquityUsd(Math.max(100, Number(e.target.value)))
                }
                className="w-28 bg-[#090D16] border border-slate-700 rounded px-2 py-1 text-right font-mono text-white"
              />
            </label>

            <label className="flex items-center justify-between text-slate-300">
              <span>Risk per Trade (%)</span>
              <input
                type="number"
                min={0.1}
                max={10}
                step={0.25}
                value={riskPctPerTrade}
                onChange={(e) =>
                  setRiskPctPerTrade(
                    Math.max(0.1, Math.min(10, Number(e.target.value)))
                  )
                }
                className="w-28 bg-[#090D16] border border-slate-700 rounded px-2 py-1 text-right font-mono text-cyan-300"
              />
            </label>

            <div className="bg-[#090D16] border border-slate-800 rounded-md p-2.5 space-y-1.5 font-mono tabular-nums">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-sans">1R Risk Capital</span>
                <span className="text-rose-400 font-semibold">
                  ${dollarRisk.toFixed(0)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-sans">Stop Distance</span>
                <span className="text-slate-200">${slDistance.toFixed(1)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-sans">Recommended Size</span>
                <span className="text-cyan-300 font-semibold">
                  {positionSizeBtc.toFixed(3)} BTC
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-sans">Notional Exposure</span>
                <span className="text-white font-semibold">
                  ${Math.round(notionalUsd).toLocaleString()} (
                  {effectiveLeverage.toFixed(1)}x)
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
          <span className="flex items-center gap-1">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
            <span>SL anchored to Shaakuni OB</span>
          </span>
          <span className="font-mono text-slate-300">ATR(14): ${shaakuni.atr14.toFixed(0)}</span>
        </div>
      </div>
    </div>
  );
};
