import { X } from 'lucide-react';
import { locale, tr } from '../../i18n';
import { DASH } from '../../ui/format';
import { NOMINAL_BANDS, amountsAt, type ExecutionAmounts, type PriceRead } from './momentLensModel';

export type LensPin = { px: number; band: number | null };
const grouped = new Intl.NumberFormat(locale);
const ungrouped = new Intl.NumberFormat(locale, { useGrouping: false });

export function formatAtoms(atoms: bigint, decimals: number, group = true) {
  const scale = 10n ** BigInt(decimals);
  const whole = (group ? grouped : ungrouped).format(atoms / scale);
  const fraction = (atoms % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}${tr(',', '.')}${fraction}` : whole;
}

function cellUsd(micros: bigint) {
  const cents = (micros + 5_000n) / 10_000n;
  if (cents === 0n && micros > 0n) return tr('<0,01', '<0.01');
  if (cents >= 10_000_000_000n) return `${formatAtoms((cents + 50_000n) / 100_000n, 3, false)}M`;
  return formatAtoms(cents, 2, false);
}

const spokenSide = (side: 'buy' | 'sell') =>
  side === 'buy' ? tr('Kupno', 'Buy') : tr('Sprzedaż', 'Sell');

function CellMeasure({ side, value, scale }: {
  side: 'buy' | 'sell'; value: ExecutionAmounts | null; scale: number;
}) {
  const length = value && scale > 0 ? Math.log1p(Number(value.usd)) / scale * 100 : 0;
  return (
    <span className={`ml-cell-measure ${side === 'buy' ? 'ml-bid' : 'ml-ask'}`} data-count={value?.count} data-micros={value?.usd.toString()}>
      {length > 0 && <i className="ml-cell-bar" style={{ width: `${length}%` }} aria-hidden="true" />}
      <span>{value !== null ? ungrouped.format(value.count) : DASH}</span>
      <span aria-hidden="true">·</span>
      <span>{value !== null ? cellUsd(value.usd) : DASH}</span>
    </span>
  );
}

export function LensPriceMatrix({ rows, covered, selected, onSelect, fmtPx, graphical }: {
  rows: readonly PriceRead[]; covered: boolean; selected: LensPin | null;
  onSelect: (pin: LensPin) => void; fmtPx: (price: number) => string; graphical: boolean;
}) {
  let scale = 0;
  if (graphical && covered) {
    for (const row of rows) {
      for (const cell of row.bands) {
        if (cell) scale = Math.max(scale, Math.log1p(Number(cell.buy.usd)), Math.log1p(Number(cell.sell.usd)));
      }
    }
  }
  return (
    <table className="ml-matrix" aria-label={tr('Liczba i USD wykonań według ceny i nominału', 'Count and USD by price and trade notional')}>
      <thead><tr><th scope="col">{tr('Cena', 'Price')}</th>{NOMINAL_BANDS.map(band => <th key={band} scope="col">{band}</th>)}</tr></thead>
      <tbody>{rows.map(row => (
        <tr key={row.px} data-ml-price={row.px} className={selected?.px === row.px ? 'ml-selected-price' : undefined}>
          <th scope="row"><button type="button" aria-pressed={selected?.px === row.px && selected.band === null} onClick={() => onSelect({ px: row.px, band: null })}>{fmtPx(row.px)}</button></th>
          {NOMINAL_BANDS.map((label, band) => {
            const buy = amountsAt(row, band, 'buy', covered);
            const sell = amountsAt(row, band, 'sell', covered);
            const describe = (value: ExecutionAmounts | null) => value ? `${value.count} / ${formatAtoms(value.usd, 6)} USD` : DASH;
            return <td key={label} data-ml-band={band}>
              <button type="button" className="ml-matrix-cell" aria-pressed={selected?.px === row.px && selected.band === band}
                aria-label={`${fmtPx(row.px)} USD · ${label} · ${spokenSide('buy')} ${describe(buy)} · ${spokenSide('sell')} ${describe(sell)}`}
                onClick={() => onSelect({ px: row.px, band })}>
                <span className="ml-small-band" aria-hidden="true">{label}</span>
                <CellMeasure side="buy" value={buy} scale={scale} />
                <CellMeasure side="sell" value={sell} scale={scale} />
              </button>
            </td>;
          })}
        </tr>
      ))}</tbody>
    </table>
  );
}

export function LensCellDetail({ selection, row, covered, fmtPx, decimals, unit, clear, executions }: {
  selection: LensPin; row: PriceRead | undefined; covered: boolean;
  fmtPx: (price: number) => string; decimals: number; unit: string; clear: () => void; executions: () => void;
}) {
  return (
    <section className="ml-detail" aria-label={tr('Przypięty odczyt', 'Pinned readout')}>
      <strong>{fmtPx(selection.px)} USD · {selection.band === null ? tr('Wszystkie klasy', 'All bands') : `${NOMINAL_BANDS[selection.band]} USD`}</strong>
      <button className="ml-detail-clear" type="button" onClick={clear} aria-label={tr('Odepnij odczyt', 'Unpin readout')}><X size={14} aria-hidden="true" /></button>
      <div className="ml-detail-sides">
        {(['buy', 'sell'] as const).map(side => {
          const value = amountsAt(row, selection.band, side, covered);
          return <span key={side} className={side === 'buy' ? 'ml-bid' : 'ml-ask'} data-ml-detail-side={side}>
            {spokenSide(side)} {value ? `${grouped.format(value.count)} ${tr('wyk.', value.count === 1 ? 'fill' : 'fills')} · ${formatAtoms(value.units, decimals)} ${unit} · ${formatAtoms(value.usd, 6)} USD` : DASH}
          </span>;
        })}
      </div>
      <button type="button" onClick={executions}>{tr('Wykonania', 'Executions')}</button>
    </section>
  );
}
