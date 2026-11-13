import React from 'react';
import { tr } from '../../i18n';
import type { MarketRowModel } from '../../utils/marketsTable';
import { LiveCell } from './LiveCell';
import { WallStreetLabel } from './WallStreetLabel';

/** Klasy komórek tabeli „Rynki” (wspólne dla nagłówka i wierszy). */
export const CELL = {
  th: 'px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3 whitespace-nowrap',
  td: 'px-3 py-2.5 align-top whitespace-nowrap',
  num: 'px-3 py-2.5 align-top whitespace-nowrap text-right font-mono tabular-nums text-ink-1',
  sticky: 'sticky left-0 bg-surface-1 z-10',
  link: 'underline decoration-line-strong underline-offset-2 hover:text-ink-1',
  sub: 'block font-sans text-[10.5px] text-ink-3',
};

/** Wiersz tabeli „Rynki”: same teksty z modelu wiersza (`utils/marketsTable.rowModel`). */
export const MarketRow: React.FC<{ row: MarketRowModel }> = ({ row }) => (
  <tr className="border-t border-line" data-market-row={row.coin}>
    <th scope="row" className={`${CELL.td} ${CELL.sticky} text-left font-normal`}>
      <span className="flex items-baseline gap-1.5">
        <span className="font-medium text-ink-1">{row.name}</span>
        <span className="rounded border border-line px-1 text-[10px] text-ink-3" title={row.exchangeTitle}>
          {row.exchange}
        </span>
      </span>
    </th>
    <td className={CELL.num}>
      <LiveCell value={row.price} readAt={row.readAt} why={row.why} />
    </td>
    <td className={CELL.num}>{row.volume}</td>
    <td className={CELL.num}>{row.openInterest}</td>
    <td className={CELL.num}>
      {row.fundingHour}
      {row.fundingYear !== null && (
        <span className={CELL.sub}>
          {tr('rocznie', 'per year')} {row.fundingYear} {tr('(przeliczone)', '(annualised)')}
        </span>
      )}
    </td>
    <td className={`${CELL.td} text-ink-2`}>
      <WallStreetLabel cell={row.wallStreet} />
    </td>
    <td className={CELL.td}>
      <a href={row.chartHref} className={CELL.link}>
        {tr('Wykres', 'Chart')}
      </a>
    </td>
    <td className={`${CELL.td} text-ink-2`}>{row.scanner.why === null ? row.scanner.text : <span title={row.scanner.why}>{row.scanner.text}</span>}</td>
  </tr>
);
