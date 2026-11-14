import React, { useEffect, useRef, useState } from 'react';
import { tr } from '../../i18n';
import { Badge } from '../../ui';
import type { MarketRowModel } from '../../utils/marketsTable';
import type { MarketClass } from '../../utils/marketRegistry';
import { WallStreetLabel } from './WallStreetLabel';

/**
 * Lista rynków (setki wierszy) rysowana oknem: w dokumencie są tylko wiersze w pobliżu ekranu (przewijanie strony),
 * reszta to wysokość kontenera. Komputer i tablet (od 768 px): tabela; telefon: karty. Same teksty z modelu wiersza.
 */

export const CLASS_LABEL: Record<MarketClass, string> = {
  crypto: tr('Krypto', 'Crypto'),
  equity: tr('Akcje', 'Stocks'),
  index: tr('Indeksy', 'Indices'),
  commodity: tr('Surowce', 'Commodities'),
  fx: 'FX',
  other: tr('Inne', 'Other'),
};

const ROW_H = { table: 56, card: 76 } as const;
const WALL_STREET = 'Wall Street';
const OVERSCAN = 8;

/** Zakres widocznych wierszy listy o stałej wysokości wiersza przy przewijaniu strony (okno). */
function useWindowRange(count: number, rowH: number, ref: React.RefObject<HTMLElement | null>): [number, number] {
  const [range, setRange] = useState<[number, number]>([0, Math.min(count, 24)]);
  useEffect(() => {
    const calc = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const start = Math.max(0, Math.floor(-top / rowH) - OVERSCAN);
      const end = Math.min(count, Math.ceil((window.innerHeight - top) / rowH) + OVERSCAN);
      setRange((r) => (r[0] === start && r[1] === end ? r : [start, end]));
    };
    calc();
    window.addEventListener('scroll', calc, { passive: true });
    window.addEventListener('resize', calc);
    return () => {
      window.removeEventListener('scroll', calc);
      window.removeEventListener('resize', calc);
    };
  }, [count, rowH, ref]);
  return range;
}

const Live: React.FC<{ row: MarketRowModel; align?: 'end' | 'start' }> = ({ row, align = 'end' }) => (
  <span className={`flex items-center gap-1 font-sans text-[10.5px] text-ink-3 ${align === 'end' ? 'justify-end' : ''}`}>
    {row.readAt !== null ? (
      <>
        <Badge tone="live" size="sm" title={tr('Realne dane Hyperliquid; godzina odczytu w czasie lokalnym', 'Real Hyperliquid data; reading time in local time')}>
          LIVE
        </Badge>
        <span>{row.readAt}</span>
      </>
    ) : (
      <span className="truncate" title={row.why ?? undefined}>
        {row.why}
      </span>
    )}
  </span>
);

const Name: React.FC<{ row: MarketRowModel }> = ({ row }) => (
  <span className="flex min-w-0 items-center gap-1.5">
    <span className="truncate font-semibold text-ink-1">{row.name}</span>
    <span className="shrink-0 rounded border border-line px-1 text-[10px] leading-4 text-ink-3" title={row.exchangeTitle}>
      {row.exchange}
    </span>
    {row.cls !== null && row.cls !== 'crypto' && <span className="hidden sm:inline shrink-0 text-[10px] text-ink-3">{CLASS_LABEL[row.cls]}</span>}
  </span>
);

const Chart: React.FC<{ row: MarketRowModel }> = ({ row }) =>
  row.chartHref !== null ? (
    <a href={row.chartHref} className="inline-flex h-9 items-center rounded-md px-2 text-xs text-ink-2 underline decoration-line-strong underline-offset-2 hover:bg-surface-2 hover:text-ink-1">
      {tr('Wykres', 'Chart')}
    </a>
  ) : (
    <span className="text-ink-3" title={row.chartWhy ?? undefined}>
      —
    </span>
  );

const GRID = 'grid grid-cols-[minmax(150px,1.6fr)_minmax(96px,1fr)_minmax(84px,0.9fr)_minmax(84px,0.9fr)_minmax(92px,1fr)_72px] xl:grid-cols-[minmax(170px,1.6fr)_minmax(100px,1fr)_minmax(88px,0.9fr)_minmax(88px,0.9fr)_minmax(110px,1fr)_minmax(110px,0.9fr)_72px] items-center gap-x-3 px-4';
const NUM = 'text-right font-mono tabular-nums text-ink-1';

const TableRow: React.FC<{ row: MarketRowModel; index: number }> = ({ row, index }) => (
  <div role="row" aria-rowindex={index + 2} data-market-row={row.coin} className={`${GRID} absolute inset-x-0 border-t border-line hover:bg-surface-2/50`} style={{ top: index * ROW_H.table, height: ROW_H.table }}>
    <div role="rowheader" className="min-w-0">
      <Name row={row} />
      <span className="xl:hidden block text-[10.5px] text-ink-3">{row.wallStreet.why === null && row.cls !== 'crypto' ? <WallStreetLabel cell={row.wallStreet} /> : null}</span>
    </div>
    <div role="cell" className={NUM}>
      <span className={row.why === null ? undefined : 'text-ink-3'}>{row.price}</span>
      <Live row={row} />
    </div>
    <div role="cell" className={NUM}>{row.volume}</div>
    <div role="cell" className={NUM}>{row.openInterest}</div>
    <div role="cell" className={NUM}>
      {row.fundingHour}
      {row.fundingYear !== null && <span className="block font-sans text-[10.5px] text-ink-3">{tr(`${row.fundingYear} rocznie`, `${row.fundingYear} per year`)}</span>}
    </div>
    <div role="cell" className="hidden xl:block text-xs text-ink-2">
      <WallStreetLabel cell={row.wallStreet} />
    </div>
    <div role="cell" className="text-right">
      <Chart row={row} />
    </div>
  </div>
);

const CardRow: React.FC<{ row: MarketRowModel; index: number }> = ({ row, index }) => (
  <div role="row" aria-rowindex={index + 2} data-market-row={row.coin} className="absolute inset-x-0 flex flex-col justify-center gap-1 border-t border-line px-4" style={{ top: index * ROW_H.card, height: ROW_H.card }}>
    <div className="flex items-center justify-between gap-3">
      <div role="rowheader" className="min-w-0">
        <Name row={row} />
      </div>
      <div role="cell" className={`${NUM} shrink-0 text-base`}>
        {row.price}
      </div>
    </div>
    <div className="flex items-center justify-between gap-3 text-xs">
      <div className="flex min-w-0 items-center gap-3 text-ink-2">
        <span role="cell" className="font-mono tabular-nums">
          <span className="font-sans text-ink-3">{tr('Obrót', 'Vol')} </span>
          {row.volume}
        </span>
        <span role="cell" className="font-mono tabular-nums">
          <span className="font-sans text-ink-3">F </span>
          {row.fundingHour}
        </span>
        {(row.cls === 'equity' || row.cls === 'index') && (
          <span role="cell" className="truncate">
            <span className="text-ink-3">WS </span>
            <WallStreetLabel cell={row.wallStreet} />
          </span>
        )}
      </div>
      <Live row={row} />
    </div>
  </div>
);

export const MarketList: React.FC<{ rows: MarketRowModel[]; cards: boolean }> = ({ rows, cards }) => {
  const ref = useRef<HTMLDivElement>(null);
  const rowH = cards ? ROW_H.card : ROW_H.table;
  const [start, end] = useWindowRange(rows.length, rowH, ref);
  const Row = cards ? CardRow : TableRow;
  return (
    <div role="table" aria-rowcount={rows.length + 1} aria-label={tr('Rynki Hyperliquid', 'Hyperliquid markets')}>
      {!cards && (
        <div role="row" aria-rowindex={1} className={`${GRID} py-2 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3`}>
          <span role="columnheader">{tr('Rynek', 'Market')}</span>
          <span role="columnheader" className="text-right">
            {tr('Cena', 'Price')}
          </span>
          <span role="columnheader" className="text-right">
            {tr('Obrót 24 h', '24h volume')}
          </span>
          <span role="columnheader" className="text-right">
            {tr('Otwarte poz.', 'Open int.')}
          </span>
          <span role="columnheader" className="text-right">
            {tr('Funding 1 h', 'Funding 1h')}
          </span>
          <span role="columnheader" className="hidden xl:block">
            {WALL_STREET}
          </span>
          <span role="columnheader" className="text-right">
            {tr('Wykres', 'Chart')}
          </span>
        </div>
      )}
      <div ref={ref} role="rowgroup" className="relative" style={{ height: rows.length * rowH }}>
        {rows.slice(start, end).map((r, i) => (
          <Row key={r.coin} row={r} index={start + i} />
        ))}
      </div>
    </div>
  );
};
