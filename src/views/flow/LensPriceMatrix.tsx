import { useMemo } from 'react';
import { locale, tr } from '../../i18n';
import { DASH } from '../../ui/format';
import { NOMINAL_BANDS, amountsAt, type ExecutionAmounts, type LensPin, type LensTrade, type PriceRead, type readMomentWindow } from './momentLensModel';

const grouped = new Intl.NumberFormat(locale);
const ungrouped = new Intl.NumberFormat(locale, { useGrouping: false });

export function formatAtoms(atoms: bigint, decimals: number, group = true) {
  const scale = 10n ** BigInt(decimals);
  const whole = (group ? grouped : ungrouped).format(atoms / scale);
  const fraction = (atoms % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}${tr(',', '.')}${fraction}` : whole;
}

export function nominalUsd(micros: bigint) {
  const cents = (micros + 5_000n) / 10_000n;
  if (cents === 0n && micros > 0n) return tr('<0,01', '<0.01');
  if (cents >= 100_000_000_000n) return `${formatAtoms((cents + 500_000_000n) / 1_000_000_000n, 2, false)}B`;
  if (cents >= 100_000_000n) return `${formatAtoms((cents + 500_000n) / 1_000_000n, 2, false)}M`;
  if (cents >= 1_000_000n) return `${formatAtoms((cents + 500n) / 1_000n, 2, false)}k`;
  return formatAtoms(cents, 2, false);
}

const spokenSide = (side: 'buy' | 'sell') =>
  side === 'buy' ? tr('Kupno', 'Buy') : tr('Sprzedaż', 'Sell');

function CellMeasure({ side, value, max }: {
  side: 'buy' | 'sell'; value: ExecutionAmounts | null; max: number;
}) {
  const length = value && max > 0 ? Number(value.usd) / max * 100 : 0;
  return (
    <span className={`ml-cell-measure ${side === 'buy' ? 'ml-bid' : 'ml-ask'}`} data-count={value?.count} data-micros={value?.usd.toString()}>
      {length > 0 && <i className="ml-cell-bar" style={{ width: `${length}%` }} aria-hidden="true" />}
      <span>{value ? grouped.format(value.count) : DASH}</span>
      <strong>{value ? nominalUsd(value.usd) : DASH}</strong>
    </span>
  );
}

type ContextWindow = ReturnType<typeof readMomentWindow>;

function groupContext(context: ContextWindow) {
  const lanes = context.lanes.map(lane => {
    const grouped = new Float64Array(48);
    lane.forEach((value, bin) => { grouped[2 * Math.floor(bin / 10) + bin % 2] += value; });
    return grouped;
  });
  const maximum = Math.log1p(Math.max(...lanes.map(lane => Math.max(...lane))));
  return { lanes, maximum };
}

function BandTrace({ context, bins, max, cursor, count, countWidth }: {
  context: ContextWindow; bins: Float64Array; max: number; cursor: number; count: number; countWidth: number;
}) {
  const x = (t: number) => (t - context.from) / 1000;
  return (
    <div className="ml-band-context" style={{ gridTemplateColumns: `minmax(0, 1fr) ${countWidth}ch` }}>
      <svg viewBox="0 0 120 22" preserveAspectRatio="none" aria-hidden="true" className="ml-band-trace">
        {context.gaps.map(({ start, end }) => <rect key={start} className="ml-gap" x={x(start)} y={0} width={x(end) - x(start)} height={22} />)}
        <line className="ml-tick" x1={0} y1={11} x2={120} y2={11} />
        {Array.from(bins, (value, bin) => {
          if (value === 0) return null;
          const buy = bin % 2 === 0;
          const height = Math.max(1, 10 * Math.log1p(value) / max);
          return <rect key={bin} className={buy ? 'ml-buy-mark' : 'ml-sell-mark'} x={5 * Math.floor(bin / 2)} y={buy ? 11 - height : 11} width={4.25} height={height} />;
        })}
        {cursor < context.to - 1 && <rect className="ml-after-cursor" x={x(cursor)} y={0} width={120 - x(cursor)} height={22} />}
        <line className="ml-cursor" x1={x(cursor)} y1={0} x2={x(cursor)} y2={22} />
      </svg>
      <span data-ml-context-count={context.coveredMs > 0 ? count : undefined}>
        {context.coveredMs > 0 ? grouped.format(count) : DASH}
      </span>
    </div>
  );
}

export function LensPriceMatrix({ row, covered, pin, onSelect, context, cursor }: {
  row: PriceRead | undefined; covered: boolean; pin: LensPin | null;
  onSelect: (band: number, side?: LensTrade['side']) => void;
  context: ContextWindow; cursor: number;
}) {
  const bands = NOMINAL_BANDS.map((label, band) => ({
    label, buy: amountsAt(row, band, 'buy', covered), sell: amountsAt(row, band, 'sell', covered),
  }));
  const max = Math.max(0, ...bands.flatMap(({ buy, sell }) => [Number(buy?.usd ?? 0n), Number(sell?.usd ?? 0n)]));
  const traces = useMemo(() => groupContext(context), [context]);
  const countWidth = grouped.format(Math.max(...context.totals)).length;
  return (
    <table className="ml-matrix" aria-label={tr('Wykonania danej ceny według nominału', 'Executions at this price by notional')}>
      <thead><tr>
        <th scope="col">{tr('Nominał', 'Notional')}</th>
        <th scope="col" className="ml-band-context-head">
          {tr('Rynek · 2 min', 'Market · 2 min')}
          <small>{tr('wykonania z pokrycia', 'fills in covered time')}</small>
        </th>
        <th scope="col" className="ml-bid">↑ {spokenSide('buy')} <span className="ml-measure-key"><small>n</small><small>USD</small></span></th>
        <th scope="col" className="ml-ask">↓ {spokenSide('sell')} <span className="ml-measure-key"><small>n</small><small>USD</small></span></th>
      </tr></thead>
      <tbody>{bands.map(({ label, buy, sell }, band) => {
        const pressed = pin?.band === band;
        return (
          <tr key={label} data-ml-band={band} className={pressed ? 'ml-selected-band' : undefined}>
            <th scope="row"><button type="button" disabled={!row} aria-pressed={pressed && pin?.side === undefined} onClick={() => onSelect(band)}>{label}</button></th>
            <td className="ml-band-context-cell"><BandTrace context={context} bins={traces.lanes[band]} max={traces.maximum} cursor={cursor} count={context.totals[band]} countWidth={countWidth} /></td>
            {(['buy', 'sell'] as const).map(side => {
              const value = side === 'buy' ? buy : sell;
              const direction = side === 'buy' ? 1 : -1;
              return <td key={side}>
                <button type="button" className="ml-measure-button" disabled={!row} aria-pressed={pressed && pin?.side === direction} onClick={() => onSelect(band, direction)}
                  aria-label={`${label} · ${spokenSide(side)} · ${value ? `${value.count} / ${formatAtoms(value.usd, 6)} USD` : DASH}`}>
                  <CellMeasure side={side} value={value} max={max} />
                </button>
              </td>;
            })}
          </tr>
        );
      })}</tbody>
    </table>
  );
}

export function LensPriceTotals({ row, covered }: { row: PriceRead | undefined; covered: boolean }) {
  return <div className="ml-price-totals">{(['buy', 'sell'] as const).map(side => {
    const value = amountsAt(row, null, side, covered);
    return <div key={side} className={side === 'buy' ? 'ml-bid' : 'ml-ask'} data-ml-total={side} data-count={value?.count} data-micros={value?.usd.toString()}>
      <small>{side === 'buy' ? '↑' : '↓'} {spokenSide(side)} · {value ? grouped.format(value.count) : DASH} {tr('wyk.', 'fills')}</small>
      <strong>{value ? nominalUsd(value.usd) : DASH} <small>USD</small></strong>
    </div>;
  })}</div>;
}

export function LensCellDetail({ selection, row, covered, fmtPx, decimals, unit }: {
  selection: LensPin; row: PriceRead | undefined; covered: boolean;
  fmtPx: (price: number) => string; decimals: number; unit: string;
}) {
  return (
    <section className="ml-detail" aria-label={tr('Dokładny odczyt filtra', 'Exact filter readout')}>
      <strong>{fmtPx(selection.px)} USD · {selection.band === null ? tr('Wszystkie klasy', 'All bands') : `${NOMINAL_BANDS[selection.band]} USD`}</strong>
      {(['buy', 'sell'] as const).filter(side => selection.side === undefined || selection.side === (side === 'buy' ? 1 : -1)).map(side => {
        const value = amountsAt(row, selection.band, side, covered);
        return <span key={side} className={side === 'buy' ? 'ml-bid' : 'ml-ask'} data-ml-detail-side={side}>
          {spokenSide(side)} {value ? `${grouped.format(value.count)} ${tr('wyk.', value.count === 1 ? 'fill' : 'fills')} · ${formatAtoms(value.units, decimals)} ${unit} · ${formatAtoms(value.usd, 6)} USD` : DASH}
        </span>;
      })}
    </section>
  );
}
