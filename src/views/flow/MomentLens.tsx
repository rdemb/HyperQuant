import { type MouseEvent, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight, Crosshair, X } from 'lucide-react';
import type { BookFrame } from '../../charts/pro/core/book';
import type { ProStore } from '../../charts/pro/store/proStore';
import { deskMarketOf } from '../../config/deskMarkets';
import { locale, tr } from '../../i18n';
import { DASH } from '../../ui/format';
import {
  LENS_MS, LensDeltaIndex, bookAtMoment, lensTapePage, lensTapeRange, momentAt, readMomentWindow, timeIndex, type LensPin, type LensTrade,
} from './momentLensModel';
import { LensCellDetail, LensPriceMatrix, LensPriceTotals, formatAtoms, nominalUsd } from './LensPriceMatrix';
import { ORDER_FLOW_MARKETS } from './orderFlowDesk';
import './momentLens.css';

const tradesPerPage = 4;
const roomyQuery = '(min-width: 951px) and (min-height: 780px)';
const roomy = () => window.matchMedia(roomyQuery).matches;
function subscribeRoomy(notify: () => void) {
  const media = window.matchMedia(roomyQuery);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
}
const whole = new Intl.NumberFormat(locale);
const preciseUsd = new Intl.NumberFormat(locale, { maximumFractionDigits: 6 });
const bookUnits = new Intl.NumberFormat(locale, { maximumFractionDigits: 6, useGrouping: false });
const compactUsd = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, useGrouping: false });
const clock = new Intl.DateTimeFormat(locale, {
  hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit',
  fractionalSecondDigits: 3, timeZone: 'UTC',
});
const bookUsd = (value: number) => {
  if (value >= 1_000_000_000) return `${compactUsd.format(value / 1_000_000_000)}B`;
  if (value >= 1_000_000) return `${compactUsd.format(value / 1_000_000)}M`;
  if (value >= 1_000) return `${compactUsd.format(value / 1_000)}k`;
  if (value > 0 && value < 0.1) return `<${compactUsd.format(0.1)}`;
  return compactUsd.format(value);
};

function Pager({ count, size, page, setPage, label }: {
  count: number; size: number; page: number; setPage: (page: number) => void; label: string;
}) {
  const start = page * size;
  return (
    <nav className="ml-pager" aria-label={label}>
      <span>{whole.format(start + 1)}–{whole.format(Math.min(count, start + size))} / {whole.format(count)}</span>
      <button type="button" aria-label={tr('Poprzednia strona', 'Previous page')} disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /></button>
      <button type="button" aria-label={tr('Następna strona', 'Next page')} disabled={start + size >= count} onClick={() => setPage(page + 1)}><ChevronRight size={16} /></button>
    </nav>
  );
}

function BookSide({ frame, store, start, length, page, size, side, units }: {
  frame: BookFrame; store: ProStore; start: number; length: number; page: number; size: number; side: 'bid' | 'ask'; units: boolean;
}) {
  const offset = page * size;
  return (
    <table className={`ml-${side}`} data-ml-native={units || undefined} aria-label={side === 'bid' ? 'BID' : 'ASK'}>
      <thead><tr><th scope="col">{side === 'bid' ? 'BID' : 'ASK'}</th><th scope="col" aria-label={tr('Liczba zleceń', 'Order count')}>n</th><th scope="col">{units ? tr('Ilość', 'Size') : 'USD'}</th></tr></thead>
      <tbody>{Array.from({ length: Math.max(0, Math.min(size, length - offset)) }, (_, row) => {
        const i = start + offset + row;
        const price = frame.px[i];
        return (
          <tr key={price} data-ml-book-price={price} data-ml-book-count={Number.isFinite(frame.n[i]) ? frame.n[i] : undefined}>
            <th scope="row">{store.fmtPx(price)}</th>
            <td>{Number.isFinite(frame.n[i]) ? whole.format(frame.n[i]) : DASH}</td>
            <td data-ml-book-usd={price * frame.sz[i]} data-ml-book-size={frame.sz[i]}>{units ? bookUnits.format(frame.sz[i]) : bookUsd(price * frame.sz[i])}</td>
          </tr>
        );
      })}</tbody>
    </table>
  );
}

function BookPane({ store, frame, cursor, page, size, setPage }: {
  store: ProStore; frame: BookFrame | null; cursor: number; page: number; size: number; setPage: (page: number) => void;
}) {
  const [units, setUnits] = useState(false);
  const asks = frame ? frame.px.length - frame.nBids : 0;
  const count = frame ? Math.max(frame.nBids, asks) : 0;
  const shown = Math.min(page, Math.max(0, Math.ceil(count / size) - 1));
  return (
    <section className="ml-book" aria-label={tr('Arkusz przy kursorze', 'Book at cursor')}>
      <div className="ml-panel-head">
        <h3>{tr('Arkusz L2', 'L2 book')}</h3>
        {frame && <button type="button" aria-pressed={units} onClick={() => setUnits(value => !value)}>{tr('Ilość natywna', 'Native size')}</button>}
      </div>
      <div className="ml-book-stamp">{frame
        ? <><time data-ml-book-time={frame.t}>{clock.format(frame.t)} UTC</time><span>{tr('Wiek', 'Age')} {preciseUsd.format((cursor - frame.t) / 1000)} s</span></>
        : tr('Brak migawki przy kursorze', 'No snapshot at cursor')}</div>
      {frame && <>
        <div className="ml-book-sides">
          <BookSide frame={frame} store={store} start={0} length={frame.nBids} page={shown} size={size} side="bid" units={units} />
          <BookSide frame={frame} store={store} start={frame.nBids} length={asks} page={shown} size={size} side="ask" units={units} />
        </div>
        {count > size && <Pager count={count} size={size} page={shown} setPage={setPage} label={tr('Poziomy arkusza', 'Book levels')} />}
        <p className="ml-book-note">{frame.nBids} BID · {asks} ASK · {tr('n = liczba zleceń', 'n = order count')}</p>
      </>}
    </section>
  );
}

function Timeline({ data, cursor, go }: {
  data: ReturnType<typeof readMomentWindow>; cursor: number; go: (t: number) => void;
}) {
  const x = (time: number) => (time - data.from) / 1000;
  const select = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const t = data.from + Math.min(LENS_MS - 1, Math.max(0, Math.floor((event.clientX - rect.left) / rect.width * LENS_MS)));
    const i = timeIndex(data.times, t);
    const prior = data.times[i - 1];
    const next = data.times[i];
    const nearest = prior === undefined || (next !== undefined && t - prior > next - t) ? next : prior;
    go(nearest !== undefined && Math.abs(t - nearest) <= 1_000 ? nearest : t);
  };
  const bins = new Float64Array(240);
  for (const lane of data.lanes) lane.forEach((value, bin) => { bins[bin] += value; });
  const max = Math.log1p(Math.max(...bins));
  return (
    <svg className="ml-timeline" viewBox="0 0 120 36" preserveAspectRatio="none" aria-hidden="true" onClick={select}>
      {data.gaps.map(({ start, end }) => <rect key={start} className="ml-gap" x={x(start)} y={0} width={x(end) - x(start)} height={36} />)}
      {[0, 30, 60, 90, 120].map(tick => <line key={tick} className="ml-tick" x1={tick} y1={0} x2={tick} y2={36} />)}
      <line className="ml-tick" x1={0} y1={18} x2={120} y2={18} />
      {Array.from(bins, (value, bin) => {
        if (value === 0) return null;
        const height = Math.max(1, 17 * Math.log1p(value) / max);
        const buy = bin % 2 === 0;
        return <rect key={bin} className={buy ? 'ml-buy-mark' : 'ml-sell-mark'} x={Math.floor(bin / 2)} y={buy ? 18 - height : 18} width={0.84} height={height} />;
      })}
      {cursor < data.to - 1 && <rect className="ml-after-cursor" x={x(cursor)} y={0} width={120 - x(cursor)} height={36} />}
      <line className="ml-cursor" x1={x(cursor)} y1={0} x2={x(cursor)} y2={36} />
    </svg>
  );
}

function coverageLabel(coveredMs: number, durationMs: number, milliseconds = false) {
  if (durationMs === 0) return DASH;
  const amount = milliseconds
    ? `${coveredMs}/${durationMs} ms`
    : `${preciseUsd.format(coveredMs / 1000)}/${preciseUsd.format(durationMs / 1000)} s`;
  return coveredMs < durationMs ? `${amount} · ${tr('luki', 'gaps')}` : amount;
}

type TapePage = ReturnType<typeof lensTapePage>;
type TapeScope = 'moment' | 'window';

function TapePane({ inspected, store, scope, from, to, setScope, setPage, pick, selected, unit }: {
  inspected: TapePage; store: ProStore; scope: TapeScope; from: number; to: number;
  setScope: (scope: TapeScope) => void; setPage: (page: number) => void;
  pick: (trade: LensTrade) => void; selected: LensTrade | null; unit: string;
}) {
  return (
    <section className="ml-tape" aria-label={tr('Taśma przy kursorze', 'Tape at cursor')}>
      <header className="ml-panel-head">
        <h3>{tr('Taśma', 'Tape')}</h3>
        <div className="ml-views" role="group" aria-label={tr('Zakres taśmy', 'Tape range')}>
          <button type="button" aria-pressed={scope === 'moment'} onClick={() => setScope('moment')}>1 ms</button>
          <button type="button" aria-pressed={scope === 'window'} onClick={() => setScope('window')}>{tr('Do 2 min', 'Up to 2 min')}</button>
        </div>
      </header>
      <div className="ml-tape-stamp">
        <span data-ml-tape-coverage={inspected.coveredMs} data-ml-tape-duration={inspected.durationMs}>
          {tr('Pokrycie', 'Coverage')} {coverageLabel(inspected.coveredMs, inspected.durationMs, scope === 'moment')}
        </span>
        {scope === 'window' && to > from && <small>{clock.format(from)}–{clock.format(to - 1)} UTC</small>}
      </div>
      {inspected.rows.length === 0 ? <p className="ml-state">{inspected.coveredMs === 0
        ? tr('Brak pokrycia w zakresie', 'No coverage in range')
        : tr('0 odebranych wykonań dla filtra', '0 received executions for filter')}</p> :
        <table className="ml-executions">
          <thead><tr>
            <th scope="col">UTC</th>
            <th scope="col" aria-label={tr('Strona', 'Side')}>↑↓</th>
            <th scope="col">{tr('Cena', 'Price')}</th>
            <th scope="col">USD</th>
          </tr></thead>
          <tbody>{inspected.rows.map(trade => <tr key={`${trade.t}:${trade.tid}`} data-ml-tid={trade.tid} data-ml-trade-time={trade.t}>
            <th scope="row"><button type="button" onClick={() => pick(trade)}>{clock.format(trade.t)}</button></th>
            <td className={trade.side === 1 ? 'ml-bid' : 'ml-ask'}>
              <span aria-label={trade.side === 1 ? tr('Kupno', 'Buy') : tr('Sprzedaż', 'Sell')}>{trade.side === 1 ? '↑' : '↓'}</span>
            </td>
            <td>{store.fmtPx(trade.px)}</td><td>{trade.usd === null ? DASH : nominalUsd(trade.usd)}</td>
          </tr>)}</tbody>
        </table>}
      {inspected.total > tradesPerPage && <Pager count={inspected.total} size={tradesPerPage} page={inspected.page} setPage={setPage} label={tr('Strony taśmy', 'Tape pages')} />}
      {selected && <div className="ml-print-detail" data-ml-selected-print={selected.tid}>
        <time>{clock.format(selected.t)} UTC</time>
        <span className={selected.side === 1 ? 'ml-bid' : 'ml-ask'}>{selected.side === 1 ? tr('↑ Kupno', '↑ Buy') : tr('↓ Sprzedaż', '↓ Sell')}</span>
        <span>{store.fmtPx(selected.px)} USD · {preciseUsd.format(selected.sz)} {unit} · {selected.usd === null ? DASH : formatAtoms(selected.usd, 6)} USD</span>
      </div>}
    </section>
  );
}

export function MomentLens({ store, close }: { store: ProStore; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const label = useId();
  const seekId = useId();
  const big = useSyncExternalStore(subscribeRoomy, roomy, () => false);
  const [paused, setPaused] = useState<{ end: number; t: number } | null>(null);
  const [pin, setPin] = useState<LensPin | null>(null);
  const [print, setPrint] = useState<LensTrade | null>(null);
  const [tapeScope, setTapeScope] = useState<TapeScope>('window');
  const [bookPage, setBookPage] = useState(0);
  const [tapePage, setTapePage] = useState(0);
  const end = paused?.end ?? Math.floor(store.serverNow() / 1000) * 1000;
  const sizeDecimals = store.szDecimals ?? deskMarketOf(store.coin)?.szDecimals ?? 0;
  const unit = store.coin.split(':').at(-1) ?? store.coin;
  const signature = store.tape.signature(end - LENS_MS, end);
  const coverageKey = store.coverage.list().map(([a, b]) => `${a}-${b}`).join(',');
  const data = useMemo(() => readMomentWindow(store.tape, store.coverage, end, sizeDecimals), [store, end, sizeDecimals, signature, coverageKey]);
  const trace = useMemo(() => pin
    ? readMomentWindow(store.tape, store.coverage, end, sizeDecimals, pin)
    : data, [store, end, sizeDecimals, pin, data]);
  const t = paused?.t ?? data.times.at(-1) ?? end - 1;
  const point = useMemo(() => momentAt(store.tape, store.coverage, t, sizeDecimals), [store, t, sizeDecimals, signature, coverageKey]);
  const currentRow = point.prices.find(row => row.px === (pin?.px ?? point.lastPrice));
  const deltaIndex = useMemo(() => new LensDeltaIndex(store.tape, sizeDecimals), [store, sizeDecimals]);
  const deltaSignature = store.tape.signature(t + 1 - LENS_MS, t + 1);
  const marketDelta = useMemo(() => deltaIndex.read(store.coverage, t), [deltaIndex, store, t, deltaSignature, coverageKey]);
  const frame = bookAtMoment(store.exactBook(), store.bookCoverage, t);
  const before = data.times[timeIndex(data.times, t) - 1];
  const after = data.times[timeIndex(data.times, t + 1)];
  const coveredFrom = store.coverage.first();
  const availableFrom = Math.min(store.tape.firstTime, Number.isFinite(coveredFrom) ? coveredFrom : Number.POSITIVE_INFINITY);
  const range = tapeScope === 'moment' ? { from: t, to: t + 1 } : lensTapeRange(availableFrom, t);
  const tapeSignature = store.tape.signature(range.from, range.to);
  const inspected = useMemo(() => lensTapePage(store.tape, store.coverage, range, sizeDecimals, pin ?? { px: null, band: null }, tapePage, tradesPerPage),
    [store, range.from, range.to, tapeSignature, coverageKey, sizeDecimals, pin, tapePage]);

  const seek = (value: number, selection: LensPin | null = null) => {
    setPaused({ end: value < data.from ? value + 1 : end, t: value });
    setPin(selection);
    setPrint(null);
    setBookPage(0);
    setTapePage(0);
  };
  const pickPrice = (px: number) => {
    seek(t, { px, band: null });
    setTapeScope('moment');
  };
  const pickBand = (band: number, side?: LensTrade['side']) => {
    if (!currentRow) return;
    seek(t, { px: currentRow.px, band, side });
    setTapeScope('moment');
  };
  const pickPrint = (trade: LensTrade) => {
    seek(trade.t, { px: trade.px, band: trade.band, side: trade.side });
    setPrint(trade);
    setTapeScope('moment');
  };
  const clear = () => {
    setPin(null);
    setPrint(null);
    setTapePage(0);
  };
  const goLive = () => {
    clear();
    setPaused(null);
    setBookPage(0);
    setTapeScope('window');
  };
  useEffect(() => { dialog.current?.showModal(); }, []);
  return (
    <dialog ref={dialog} className="ml-dialog" aria-labelledby={label} onClose={close}>
      <div className="ml-workspace">
        <header className="ml-top">
          <h2 id={label}>{tr('Przekrój chwili', 'Moment lens')}</h2>
          <nav aria-label={tr('Rynki order flow', 'Order flow markets')}>
            {ORDER_FLOW_MARKETS.map(market => <a key={market.coin} href={`#orderflow?m=${encodeURIComponent(market.coin)}`} aria-current={market.coin === store.coin ? 'page' : undefined}>{market.label}</a>)}
          </nav>
          <button className="ml-close" type="button" autoFocus onClick={() => dialog.current?.close()} aria-label={tr('Zamknij', 'Close')}><X size={18} aria-hidden="true" /><span>{tr('Zamknij', 'Close')}</span></button>
        </header>
        <div className="ml-main">
          <section className="ml-transport" aria-label={tr('Kursor chwili', 'Moment cursor')}>
            <div className="ml-clock">
              <label htmlFor={seekId}><time data-ml-cursor={t}>{clock.format(t)} UTC</time></label>
              <span className={paused ? 'ml-paused' : 'ml-live'}>{paused ? tr('Zamrożone', 'Frozen') : store.coverage.isOpen ? 'LIVE' : tr('Ostatni zapis', 'Last received')}</span>
              <small>{tr('Kontekst 2 min (log.)', '2 min context (log)')} · {coverageLabel(data.coveredMs, LENS_MS)}
                {data.unclassified > 0 && ` · ${whole.format(data.unclassified)} ${tr('bez nominału', 'unclassified')}`}
              </small>
            </div>
            <Timeline data={trace} cursor={t} go={seek} />
            <div className="ml-range">
              <span>{clock.format(data.from)}</span>
              <input id={seekId} type="range" min={0} max={LENS_MS - 1} value={t - data.from} step={1} aria-label={tr('Czas UTC w oknie dwuminutowym', 'UTC time in the two-minute window')} aria-valuetext={`${clock.format(t)} UTC`} onChange={e => seek(data.from + e.currentTarget.valueAsNumber)} />
              <span>{clock.format(data.to - 1)}</span>
            </div>
            <div className="ml-steps">
              <span className="ml-timeline-key"><span className="ml-bid">↑ {tr('Kupno', 'Buy')}</span><span className="ml-ask">↓ {tr('Sprzedaż', 'Sell')}</span></span>
              <button type="button" aria-label={tr('Poprzednia chwila z wykonaniem', 'Previous execution moment')} disabled={before === undefined} onClick={() => { if (before !== undefined) seek(before); }}><ChevronLeft size={17} /></button>
              <button type="button" disabled={data.peak === null} onClick={() => { if (data.peak !== null) seek(data.peak); }}><Crosshair size={15} aria-hidden="true" />{tr('Najwięcej wyk.', 'Most executions')}</button>
              <button type="button" aria-label={tr('Następna chwila z wykonaniem', 'Next execution moment')} disabled={after === undefined} onClick={() => { if (after !== undefined) seek(after); }}><ChevronRight size={17} /></button>
              <button type="button" aria-pressed={!paused} onClick={goLive}>{tr('Na żywo', 'Live')}</button>
            </div>
          </section>
          <section className="ml-scope" aria-label={tr('Wykonania przy aktywnej cenie', 'Executions at active price')}>
            <header className="ml-price-hero">
              <div>
                <small>{tr('Cena wykonania', 'Execution price')} · 1 ms</small>
                {currentRow
                  ? <button className="ml-active-price" type="button" aria-label={`${tr('Filtruj cenę', 'Filter price')} ${store.fmtPx(currentRow.px)} USD`} aria-pressed={pin !== null} data-ml-active-price={currentRow.px} onClick={() => pickPrice(currentRow.px)}>{store.fmtPx(currentRow.px)} <small>USD</small></button>
                  : <strong className="ml-active-price">{DASH}</strong>}
              </div>
              {point.prices.length > 1 && currentRow && <label className="ml-price-picker">
                <span>{tr('Ceny w tej chwili', 'Prices at this moment')} · {whole.format(point.prices.length)}</span>
                <select value={currentRow.px} onChange={event => pickPrice(Number(event.currentTarget.value))}>
                  {point.prices.map(row => <option key={row.px} value={row.px}>{store.fmtPx(row.px)} USD</option>)}
                </select>
              </label>}
            </header>
            {!point.covered && <p className="ml-state">{tr('1 ms · brak potwierdzonego pokrycia', '1 ms · no confirmed coverage')}</p>}
            {point.covered && !currentRow && <p className="ml-state">{tr('1 ms · 0 wykonań', '1 ms · 0 executions')}</p>}
            <LensPriceTotals row={currentRow} covered={point.covered} marketDelta={marketDelta} />
            <LensPriceMatrix row={currentRow} covered={point.covered} pin={pin} onSelect={pickBand} context={data} cursor={t} />
            {pin && <div className="ml-filter">
              <LensCellDetail selection={pin} row={currentRow} covered={point.covered} fmtPx={price => store.fmtPx(price)} unit={unit} decimals={sizeDecimals} />
              <button type="button" onClick={clear}>{tr('Wyczyść filtr', 'Clear filter')}</button>
            </div>}
          </section>
          <div className="ml-side-panels">
            <BookPane store={store} frame={frame} cursor={t} page={bookPage} size={big ? 6 : 3} setPage={setBookPage} />
            <TapePane inspected={inspected} store={store} scope={tapeScope} from={range.from} to={range.to}
              setScope={scope => { setTapeScope(scope); setTapePage(0); }} setPage={setTapePage} pick={pickPrint} selected={print} unit={unit} />
          </div>
        </div>
      </div>
    </dialog>
  );
}
