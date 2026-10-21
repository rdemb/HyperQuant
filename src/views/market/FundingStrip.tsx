import React from 'react';
import { useDesk } from '../../state/DeskContext';
import { freshness, PERIOD_MS, useCrossMarket } from '../../state/useCrossMarket';
import { Stat, fmtPct, fmtSigned } from '../../ui';

const pp = (v: number | null) => (v === null ? 'n/a' : `${fmtSigned(v, 1)} pp`);

/** Kafel pasa Desku: funding HL (APR) i spread względem Binance/Bybit (pośrednio przez API Hyperliquid). */
export const FundingStrip: React.FC = () => {
  const { feed } = useDesk();
  const cm = useCrossMarket(['funding']);
  const f = cm.funding;
  const hl = f?.byVenue.HlPerp ?? null;
  const fr = freshness(cm.fundingAt, PERIOD_MS.funding, feed.nowTick);

  return (
    <div className="bg-surface-1 border border-line rounded-xl p-3.5">
      <Stat
        label="Funding HL · APR"
        source={{
          tone: fr === 'live' ? 'live' : 'stale',
          label: fr === 'live' ? 'LIVE' : fr === 'stale' ? 'STALE' : 'BRAK',
          title: 'predictedFundings z API Hyperliquid (co 60 s); Binance/Bybit pośrednio przez API Hyperliquid. Dodatni = longi płacą.',
        }}
        value={<span className="text-base">{hl ? fmtPct(hl.aprPct, 2) : 'n/a'}</span>}
        hint={f ? `vs Binance ${pp(f.spreadHlBinancePp)} · Bybit ${pp(f.spreadHlBybitPp)}` : 'Czekam na API Hyperliquid'}
      />
    </div>
  );
};
