import React from 'react';
import { tr } from '../../i18n';
import type { MarketGroupModel, SortKey } from '../../utils/marketsTable';
import { CELL, MarketRow } from './MarketRow';

/** Kolumny tabeli „Rynki” w kolejności (liczba kolumn — `colSpan` wiersza grupy). */
const COLUMNS: { key: string; label: string; num?: boolean; sort?: SortKey; title?: string }[] = [
  { key: 'market', label: tr('Rynek', 'Market') },
  { key: 'price', label: tr('Cena', 'Price'), num: true },
  { key: 'volume', label: tr('Obrót 24 h', '24h volume'), num: true, sort: 'volume' },
  { key: 'oi', label: tr('Otwarte pozycje', 'Open interest'), num: true, sort: 'oi' },
  { key: 'funding', label: tr('Funding 1 h', 'Funding 1h'), num: true },
  { key: 'chart', label: tr('Wykres', 'Chart') },
  { key: 'scanner', label: tr('Skaner', 'Scanner') },
];

/**
 * Tabela rynków w grupach (krypto, rynki HIP-3): przewija się w bok we własnym pudełku, kolumna rynku przypięta.
 * Tylko prezentacja: grupy i wiersze dostaje gotowe z `useMarketsPage`.
 */
export const MarketsTable: React.FC<{ groups: MarketGroupModel[]; sort: SortKey }> = ({ groups, sort }) => (
  <div className="overflow-x-auto hq-scroll-cue [--cue-bg:var(--color-surface-1)]">
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr>
          {COLUMNS.map((c, i) => (
            <th
              key={c.key}
              scope="col"
              title={c.title}
              aria-sort={c.sort === sort ? 'descending' : undefined}
              className={`${CELL.th} ${c.num ? 'text-right' : ''} ${i === 0 ? CELL.sticky : ''}`}
            >
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      {groups.map((g) => (
        <tbody key={g.id}>
          <tr>
            <th scope="colgroup" colSpan={COLUMNS.length} className={`px-3 pt-4 pb-1.5 text-left text-xs font-semibold text-ink-2 ${CELL.sticky}`}>
              {g.title}
            </th>
          </tr>
          {g.rows.map((row) => (
            <MarketRow key={row.coin} row={row} />
          ))}
        </tbody>
      ))}
    </table>
  </div>
);
