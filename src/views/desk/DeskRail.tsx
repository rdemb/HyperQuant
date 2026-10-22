import React from 'react';
import { useDesk } from '../../state/DeskContext';
import { Stat, fmtCompact, fmtPct, DASH } from '../../ui';
import { FundingStrip } from '../market/FundingStrip';
import { NextEventStat } from '../market/NextEventStat';

/** Pas kontekstu pod wykresem: zasięg MC, głębokość arkusza, mikrostruktura, funding, najbliższe makro. */
export const DeskRail: React.FC = () => {
  const { feed, quant, shaakuni } = useDesk();
  const mc = feed.backendTelemetry?.monteCarlo ?? null;
  const depthAsk = quant.bookDepthAskUsd;
  const depthBid = quant.bookDepthBidUsd;
  const depthTotal = depthAsk + depthBid;
  const bidShare = depthTotal > 0 ? depthBid / depthTotal : null;
  const mins = (v: number | null | undefined) => (typeof v === 'number' ? `~${v} min` : 'n/a');

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      <div className="bg-surface-1 border border-line rounded-xl p-3.5 col-span-2 md:col-span-1">
        <Stat
          label="Zasięg 2h · MC"
          source={{
            tone: 'model',
            label: 'MODEL',
            title:
              mc?.method === 'fhs-har'
                ? 'Sezonowy log-HAR + innowacje FHS, 2000 ścieżek, krok 5 min z korektą mostu'
                : 'Zapas: Merton jump-diffusion (skoki 20% wariancji — założenie), σ z Parkinsona, 2000 ścieżek, krok 1 min',
          }}
          value={
            <div className="grid grid-cols-3 gap-2 text-sm font-mono tabular-nums">
              <div>
                <div className="text-[10px] text-ink-3 font-sans">PDH</div>
                <div>{mc ? `${mc.probTouchPDH2h}%` : DASH}</div>
                <div className="text-[10px] text-ink-3">{mins(mc?.expectedMinsToPDH)}</div>
              </div>
              <div>
                <div className="text-[10px] text-ink-3 font-sans">D-EQ</div>
                <div>{mc ? `${mc.probTouchDEQ2h}%` : DASH}</div>
                <div className="text-[10px] text-ink-3">{mins(mc?.expectedMinsToDEQ)}</div>
              </div>
              <div>
                <div className="text-[10px] text-ink-3 font-sans">PDL</div>
                <div>{mc ? `${mc.probTouchPDL2h}%` : DASH}</div>
                <div className="text-[10px] text-ink-3">{mins(mc?.expectedMinsToPDL)}</div>
              </div>
            </div>
          }
        />
      </div>

      <div className="bg-surface-1 border border-line rounded-xl p-3.5">
        <Stat
          label="Głębokość L2"
          source={{ tone: depthTotal > 0 ? 'live' : 'stale', label: depthTotal > 0 ? 'LIVE' : 'BRAK', title: 'Suma płynności 12 poziomów arkusza Hyperliquid' }}
          value={<span className="text-base">{fmtCompact(depthBid, '$')} <span className="text-ink-3">/</span> {fmtCompact(depthAsk, '$')}</span>}
          hint={
            bidShare !== null ? (
              <span className="flex items-center gap-1.5">
                <span className="relative h-1.5 w-20 rounded-full bg-sell/70 overflow-hidden" aria-hidden="true">
                  <span className="absolute inset-y-0 left-0 bg-buy" style={{ width: `${(bidShare * 100).toFixed(0)}%` }} />
                </span>
                BID {(bidShare * 100).toFixed(0)}%
              </span>
            ) : (
              'Czekam na arkusz'
            )
          }
        />
      </div>

      <div className="bg-surface-1 border border-line rounded-xl p-3.5">
        <Stat
          label="VPIN · λ"
          source={{ tone: 'model', label: 'MODEL', title: 'VPIN na kubełkach wolumenowych; λ z OLS na realnym przepływie WS' }}
          value={<span className="text-base">{fmtPct(quant.vpinToxicity * 100, 1, false)}</span>}
          hint={`λ = ${quant.kyleLambdaPer1M !== null ? `$${quant.kyleLambdaPer1M.toFixed(2)} / $1M` : 'n/a'}`}
        />
      </div>

      <div className="bg-surface-1 border border-line rounded-xl p-3.5">
        <Stat
          label="Powrót do D-EQ"
          source={{ tone: 'model', label: 'MODEL', title: 'Regresja OU wokół 0.65·D-EQ + 0.35·W-EQ' }}
          value={<span className="text-base">Z {quant.ouZScore > 0 ? '+' : ''}{quant.ouZScore}σ</span>}
          hint={`t½ ${Number.isFinite(quant.ouHalfLifeBars) ? `${quant.ouHalfLifeBars} świec` : '∞ (brak powrotu)'} · ${shaakuni.nySession}`}
        />
      </div>

      <FundingStrip />
      <NextEventStat />
    </div>
  );
};
