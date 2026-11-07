import React from 'react';
import { DASH, Stat, fmtCompact, fmtFixed } from '../../ui';
import type { BookDepth } from '../../utils/bookDepth';
import { tr } from '../../i18n';

/**
 * Kafel „Głębokość L2” pasa kontekstu: bidy / aski 12 poziomów arkusza Hyperliquid z paskiem udziału. Bez migawki arkusza
 * „—” z powodem i stanem BRAK (nie $0); z migawką pusta strona to prawdziwe $0.
 */
export const DepthStat: React.FC<{ depth: BookDepth | null }> = ({ depth }) => (
  <Stat
    label={tr('Głębokość L2', 'L2 depth')}
    source={
      depth
        ? { tone: 'live', label: 'LIVE', title: tr('Suma płynności 12 poziomów arkusza Hyperliquid', 'Total liquidity of 12 Hyperliquid book levels') }
        : { tone: 'stale', label: tr('BRAK', 'NONE'), title: tr('Brak migawki arkusza L2 Hyperliquid', 'No Hyperliquid L2 book snapshot') }
    }
    value={
      depth ? (
        <span className="text-base">
          {fmtCompact(depth.bid, '$')} <span className="text-ink-3">/</span> {fmtCompact(depth.ask, '$')}
        </span>
      ) : (
        DASH
      )
    }
    hint={
      !depth ? (
        tr('Czekam na arkusz', 'Waiting for the book')
      ) : depth.bidShare !== null ? (
        <span className="flex items-center gap-1.5">
          <span className="relative h-1.5 w-20 rounded-full bg-sell/70 overflow-hidden" aria-hidden="true">
            <span className="absolute inset-y-0 left-0 bg-buy" style={{ width: `${(depth.bidShare * 100).toFixed(0)}%` }} />
          </span>
          BID {fmtFixed(depth.bidShare * 100, 0)}%
        </span>
      ) : (
        tr('Arkusz pusty w 12 poziomach po obu stronach', 'The book is empty within 12 levels on both sides')
      )
    }
  />
);
