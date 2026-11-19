import { useState } from 'react';
import { X } from 'lucide-react';
import type { ProStore } from '../../charts/pro/store/proStore';
import { locale, tr } from '../../i18n';
import type { DeltaMoment } from './deltaMoment';
import { FLOW_WINDOW_MS } from './orderFlowDesk';

const whole = new Intl.NumberFormat(locale);
const mint = (n: bigint) => n > 0n ? 'of-buy' : n < 0n ? 'of-sell' : '';
const utc = (t: number) => new Date(t).toISOString().replace('T', ' ').replace('Z', ' UTC');
const PAGE_SIZE = 16;

function usd(n: bigint, signed = false): string {
  const abs = n < 0n ? -n : n;
  const sign = n < 0n ? '−' : signed && n > 0n ? '+' : '';
  const decimals = String(abs % 1_000_000n).padStart(6, '0').replace(/(\d{2}\d*?)0+$/, '$1');
  return `${sign}${whole.format(abs / 1_000_000n)}${tr(',', '.')}${decimals} USD`;
}

function verdict(readout: DeltaMoment): string {
  switch (readout.kind) {
    case 'gap': return tr('Niepełne pokrycie taśmy', 'Incomplete tape coverage');
    case 'changed': return tr('Taśma zmieniła się podczas odczytu. Odśwież porównanie.', 'Tape changed during capture. Refresh the comparison.');
    case 'precision': return tr('Nie można dokładnie przeliczyć nominału z odebranej taśmy', 'The received tape cannot be converted to exact notionals');
    case 'quiet': return tr('Pełna cisza w oknie', 'No trades in the full window');
    case 'neutral': return tr('Delta okna jest dokładnie zerowa', 'Window delta is exactly zero');
    case 'single': return tr('Tylko jedna aktywna milisekunda', 'Only one active millisecond');
    case 'comparison': {
      if (readout.verdict === 'reversed') return tr('Znak się odwraca', 'Sign reverses');
      if (readout.verdict === 'zero') return tr('Delta spada do zera', 'Delta becomes zero');
      return tr('Znak się utrzymuje', 'Sign holds');
    }
  }
}

function Executions({ readout, store }: { readout: Extract<DeltaMoment, { kind: 'single' | 'comparison' }>; store: ProStore }) {
  const [page, setPage] = useState(1);
  const pages = Math.ceil(readout.rows.length / PAGE_SIZE);
  const start = (page - 1) * PAGE_SIZE;
  return <details className="of-moment-trades">
    <summary>{tr('Pokaż wykonania', 'Show trades')} · {whole.format(readout.rows.length)}</summary>
    <div className="of-moment-scroll">
      <table>
        <thead><tr>{[tr('Agresor', 'Taker'), tr('Cena USD', 'Price USD'), tr('Ilość', 'Size'), 'ID'].map(label =>
          <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{readout.rows.slice(start, start + PAGE_SIZE).map(row =>
          <tr key={row.tid}>
            <td className={row.side === 1 ? 'of-buy' : 'of-sell'}>{row.side === 1 ? tr('Kupno', 'Buy') : tr('Sprzedaż', 'Sell')}</td>
            <td>{store.fmtPx(row.px)}</td><td>{String(row.sz)}</td><td>{String(row.tid)}</td>
          </tr>)}</tbody>
      </table>
    </div>
    {pages > 1 && <nav aria-label={tr('Strony wykonań', 'Trade pages')} className="of-moment-pages">
      <button type="button" onClick={() => setPage(page - 1)} disabled={page === 1} aria-label={tr('Poprzednia strona', 'Previous page')}>←</button>
      <span>{page} / {pages}</span>
      <button type="button" onClick={() => setPage(page + 1)} disabled={page === pages} aria-label={tr('Następna strona', 'Next page')}>→</button>
    </nav>}
  </details>;
}

export function DeltaMomentCard({ to, readout, store, refresh, close }: {
  to: number; readout: DeltaMoment | null; store: ProStore; refresh: () => void; close: () => void;
}) {
  const selected = readout?.kind === 'single' || readout?.kind === 'comparison' ? readout : null;
  const delta = selected?.delta ?? (readout?.kind === 'quiet' || readout?.kind === 'neutral' ? 0n : null);
  const from = new Date(to - FLOW_WINDOW_MS).toISOString();
  const end = new Date(to).toISOString();
  return <section className="of-card of-moment" id="of-delta-moment" aria-labelledby="of-delta-title" data-of-delta-moment>
    <header className="of-card-header">
      <div><h2 id="of-delta-title">{tr('Delta bez jednej chwili', 'Delta without one moment')}</h2>
        <p>{tr('Przypięte 30 s · Hyperliquid', 'Pinned 30 s · Hyperliquid')}</p>
      </div>
      <div className="of-moment-actions">
        <button type="button" onClick={refresh}>{tr('Odśwież', 'Refresh')}</button>
        <button type="button" aria-label={tr('Zamknij porównanie delty', 'Close delta comparison')} onClick={close}><X size={17} /></button>
      </div>
    </header>
    <div className="of-moment-body">
      <p className="of-moment-time"><time dateTime={from}>{from.slice(0, 23).replace('T', ' ')}</time>
        {' – '}<time dateTime={end}>{from.slice(0, 10) === end.slice(0, 10) ? end.slice(11, 23) + ' UTC' : utc(to)}</time></p>
      <div aria-live="polite">
        <dl className="of-moment-deltas">
          <div><dt>{tr('Wszystkie wykonania', 'All trades')}</dt><dd data-of-moment-delta className={delta === null ? '' : mint(delta)}>{delta === null ? '—' : usd(delta, true)}</dd></div>
          <div><dt>{tr('Bez wskazanej chwili', 'Without the selected moment')}</dt><dd data-of-moment-remaining className={selected ? mint(selected.remaining) : ''}>{selected ? usd(selected.remaining, true) : '—'}</dd></div>
        </dl>
        <p className="of-moment-verdict" data-of-moment-verdict>{readout ? verdict(readout) : tr('Odczytuję taśmę…', 'Reading the tape…')}</p>
        {readout?.kind === 'gap' && <p>{tr('Pokrycie taśmy', 'Tape coverage')} · {whole.format(readout.coveredMs)} / 30 000 ms</p>}
        {readout?.kind === 'neutral' && <p>{tr('Wykonania', 'Trades')} {whole.format(readout.count)} · {tr('Aktywne milisekundy', 'Active milliseconds')} {whole.format(readout.moments)}</p>}
      </div>
      {selected && <>
        <div className="of-moment-group">
          <p><strong><time dateTime={new Date(selected.moment.t).toISOString()}>{utc(selected.moment.t)}</time></strong></p>
          <p>{tr('Wykonania', 'Trades')} {whole.format(selected.moment.count)}
            {selected.ties > 1 && ` · ${tr('Równe wyniki', 'Tied moments')} ${whole.format(selected.ties)}`}</p>
          <p><span className="of-buy">{tr('Kupno', 'Buy')} {usd(selected.moment.buy)}</span>{' · '}
            <span className="of-sell">{tr('Sprzedaż', 'Sell')} {usd(selected.moment.sell)}</span></p>
        </div>
        <Executions key={to} readout={selected} store={store} />
      </>}
    </div>
  </section>;
}
