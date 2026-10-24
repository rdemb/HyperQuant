import React from 'react';
import { useDesk } from '../../state/DeskContext';
import { freshness, PERIOD_MS, useCrossMarket } from '../../state/useCrossMarket';
import { Stat, fmtPct, fmtSigned } from '../../ui';
import { tr } from '../../i18n';

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
          label: fr === 'live' ? 'LIVE' : fr === 'stale' ? 'STALE' : tr('BRAK', 'NONE'),
          title: tr(
            'predictedFundings z API Hyperliquid (co 60 s); Binance/Bybit pośrednio przez API Hyperliquid. Dodatni = longi płacą.',
            'predictedFundings from the Hyperliquid API (every 60 s); Binance/Bybit indirectly via the Hyperliquid API. Positive = longs pay.'
          ),
        }}
        value={<span className="text-base">{hl ? fmtPct(hl.aprPct, 2) : 'n/a'}</span>}
        hint={f ? `vs Binance ${pp(f.spreadHlBinancePp)} · Bybit ${pp(f.spreadHlBybitPp)}` : tr('Czekam na API Hyperliquid', 'Waiting for the Hyperliquid API')}
      />
    </div>
  );
};
