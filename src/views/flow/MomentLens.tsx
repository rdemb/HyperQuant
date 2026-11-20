import { type MouseEvent, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight, Crosshair, X } from 'lucide-react';
import type { BookFrame } from '../../charts/pro/core/book';
import type { ProStore } from '../../charts/pro/store/proStore';
import { deskMarketOf } from '../../config/deskMarkets';
import { locale, tr } from '../../i18n';
import { DASH } from '../../ui/format';
import {
  LENS_MS, NOMINAL_BANDS, bookAtMoment, lensTapePage, lensTapeRange, momentAt, readMomentWindow, timeIndex,
} from './momentLensModel';
import { LensCellDetail, LensPriceMatrix, formatAtoms, type LensPin } from './LensPriceMatrix';
import { ORDER_FLOW_MARKETS } from './orderFlowDesk';
import './momentLens.css';

const tradesPerPage = 8;
const roomyQuery = '(min-width: 951px) and (min-height: 630px)';
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

function Pager({ count, size, page, setPage, label, range }: {
  count: number; size: number; page: number; setPage: (page: number) => void; label: string; range?: string;
}) {
  const start = page * size;
  return (
    <nav className="ml-pager" aria-label={label}>
      <span>{count ? `${whole.format(start + 1)}–${whole.format(Math.min(count, start + size))} / ${whole.format(count)}` : '0'}{count > start + size && <small> · {tr('dalej', 'remaining')} {whole.format(count - start - size)}</small>}{range && <small> · {range}</small>}</span>
      <button type="button" aria-label={tr('Poprzednia strona', 'Previous page')} disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /></button>
      <button type="button" aria-label={tr('Następna strona', 'Next page')} disabled={start + size >= count} onClick={() => setPage(page + 1)}><ChevronRight size={16} /></button>
    </nav>
  );
}

function BookSide({ frame, store, start, length, page, size, side, px, units, onPrice }: {
  frame: BookFrame; store: ProStore; start: number; length: number; page: number; size: number; side: 'bid' | 'ask'; units: boolean;
  px: number | null; onPrice: (price: number) => void;
}) {
  const offset = page * size;
  return (
    <table className={`ml-${side}`} aria-label={side === 'bid' ? 'BID' : 'ASK'}>
      <thead><tr><th scope="col">{side === 'bid' ? 'BID' : 'ASK'}</th><th scope="col" aria-label={tr('Liczba zleceń', 'Order count')}>n</th><th scope="col">{units ? tr('Ilość', 'Size') : 'USD'}</th></tr></thead>
      <tbody>{Array.from({ length: Math.max(0, Math.min(size, length - offset)) }, (_, row) => {
        const i = start + offset + row;
        const price = frame.px[i];
        return (
          <tr key={price} data-ml-book-price={price} data-ml-book-count={Number.isFinite(frame.n[i]) ? frame.n[i] : undefined}>
            <th scope="row"><button type="button" aria-pressed={px === price} onClick={() => onPrice(price)}>{store.fmtPx(price)}</button></th>
            <td>{Number.isFinite(frame.n[i]) ? whole.format(frame.n[i]) : DASH}</td>
            <td data-ml-book-usd={price * frame.sz[i]} data-ml-book-size={frame.sz[i]}>{units ? bookUnits.format(frame.sz[i]) : bookUsd(price * frame.sz[i])}</td>
          </tr>
        );
      })}</tbody>
    </table>
  );
}

function BookPane({ store, frame, cursor, page, size, setPage, px, onPrice }: {
  store: ProStore; frame: BookFrame | null; cursor: number; page: number; size: number; setPage: (page: number) => void;
  px: number | null; onPrice: (price: number) => void;
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
          <BookSide frame={frame} store={store} start={0} length={frame.nBids} page={shown} size={size} side="bid" px={px} units={units} onPrice={onPrice} />
          <BookSide frame={frame} store={store} start={frame.nBids} length={asks} page={shown} size={size} side="ask" px={px} units={units} onPrice={onPrice} />
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
  const selected = (cursor - data.from) / 1000;
  const select = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const y = Math.min(119_999, Math.max(0, Math.floor((event.clientY - rect.top) / rect.height * LENS_MS)));
    const t = data.from + y;
    const i = timeIndex(data.times, t);
    const prior = data.times[i - 1];
    const next = data.times[i];
    const nearest = prior === undefined || (next !== undefined && t - prior > next - t) ? next : prior;
    go(nearest !== undefined && Math.abs(t - nearest) <= 1_000 ? nearest : t);
  };
  const gaps: { y: number; height: number }[] = [];
  let end = data.from;
  for (const [a, b] of [...data.spans, [data.to, data.to]]) {
    if (a > end) gaps.push({ y: (end - data.from) / 1000, height: (a - end) / 1000 });
    end = b;
  }
  return (
    <svg className="ml-timeline" viewBox="0 0 700 120" preserveAspectRatio="none" aria-hidden="true" onClick={select}>
      {[0, 30, 60, 90, 120].map(y => <line key={y} className="ml-tick" x1={0} y1={y} x2={700} y2={y} />)}
      {gaps.map(({ y, height }) => <rect key={y} className="ml-gap" x={0} y={y} width={700} height={height} />)}
      {data.lanes.map((bins, band) => (
        <g key={band} transform={`translate(${band * 100},0)`}>
          <line className="ml-lane-line" x1={0} x2={0} y1={0} y2={120} />
          <line className="ml-lane-center" x1={50} x2={50} y1={0} y2={120} />
          {Array.from(bins, (value, bin) => {
            if (value === 0) return null;
            const width = Math.min(46, Math.max(1, Math.log10(1 + value) * 6));
            const buy = bin % 2 === 0;
            return <rect key={bin} className={buy ? 'ml-buy-mark' : 'ml-sell-mark'} x={buy ? 50 - width : 50} y={Math.floor(bin / 2)} width={width} height={0.83} />;
          })}
        </g>
      ))}
      <line className="ml-cursor" x1={0} y1={selected} x2={700} y2={selected} />
    </svg>
  );
}

export function MomentLens({ store, close }: { store: ProStore; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const label = useId();
  const seekId = useId();
  const big = useSyncExternalStore(subscribeRoomy, roomy, () => false);
  const [paused, setPaused] = useState<{ end: number; t: number } | null>(null);
  const [selection, setSelection] = useState<LensPin | null>(null);
  const [view, setView] = useState<'numbers' | 'graph' | 'tapes'>('numbers');
  const [tapeScope, setTapeScope] = useState<'moment' | 'window'>('window');
  const [tapeBand, setTapeBand] = useState<number | null>(null);
  const [pricePosition, setPricePosition] = useState(0);
  const [bookPage, setBookPage] = useState(0);
  const [tapePage, setTapePage] = useState(0);
  const end = paused?.end ?? Math.floor(store.serverNow() / 1000) * 1000;
  const market = deskMarketOf(store.coin);
  const sizeDecimals = store.szDecimals ?? market?.szDecimals ?? 0;
  const unit = store.coin.split(':').at(-1) ?? store.coin;
  const px = selection?.px ?? null;
  const band = selection?.band ?? tapeBand;
  const pricesPerPage = big ? (view === 'graph' ? 4 : 8) : 2;
  const signature = store.tape.signature(end - LENS_MS, end);
  const coverageKey = store.coverage.list().map(([a, b]) => `${a}-${b}`).join(',');
  const data = useMemo(() => readMomentWindow(store.tape, store.coverage, end, sizeDecimals), [store, end, sizeDecimals, signature, coverageKey]);
  const t = paused?.t ?? data.times.at(-1) ?? end - 1;
  const point = useMemo(() => momentAt(store.tape, store.coverage, t, sizeDecimals), [store, t, sizeDecimals, signature, coverageKey]);
  const history = store.exactBook();
  const frame = bookAtMoment(history, store.bookCoverage, t);
  const before = data.times[timeIndex(data.times, t) - 1];
  const after = data.times[timeIndex(data.times, t + 1)];
  const pickTime = (value: number) => {
    setPaused({ end: value < data.from ? value + 1 : end, t: value });
    setPricePosition(0);
    setTapePage(0);
  };
  const selectCell = (cell: LensPin) => {
    setPaused({ end, t });
    setSelection(selection?.px === cell.px && selection.band === cell.band ? null : cell);
    setTapeBand(null);
    setTapePage(0);
    const index = point.prices.findIndex(row => row.px === cell.px);
    if (index >= 0) setPricePosition(index);
  };
  const changeView = (value: typeof view) => {
    if (value === 'tapes') setPaused({ end, t });
    setTapePage(0);
    setView(value);
  };
  const inspectCell = () => {
    setTapeScope('moment');
    changeView('tapes');
  };
  const selectedPrices = point.prices;
  const priceIndex = Math.min(Math.floor(pricePosition / pricesPerPage), Math.max(0, Math.ceil(selectedPrices.length / pricesPerPage) - 1));
  const visiblePrices = selectedPrices.slice(priceIndex * pricesPerPage, (priceIndex + 1) * pricesPerPage);
  const highPrice = visiblePrices[0]?.px;
  const lowPrice = visiblePrices.at(-1)?.px;
  const priceRange = lowPrice !== undefined && highPrice !== undefined && lowPrice !== highPrice
    ? `${store.fmtPx(lowPrice)}–${store.fmtPx(highPrice)} USD` : undefined;
  const coveredFrom = store.coverage.first();
  const availableFrom = Math.min(store.tape.firstTime, Number.isFinite(coveredFrom) ? coveredFrom : Number.POSITIVE_INFINITY);
  const { from: tapeFrom, to: tapeTo } = tapeScope === 'moment' ? { from: t, to: t + 1 } : lensTapeRange(availableFrom, t);
  const tapeSignature = view === 'tapes' ? store.tape.signature(tapeFrom, tapeTo) : '';
  const inspected = useMemo(() => view === 'tapes'
    ? lensTapePage(store.tape, store.coverage, { from: tapeFrom, to: tapeTo }, sizeDecimals, { px, band }, tapePage, tradesPerPage) : null,
    [view, store, tapeFrom, tapeTo, tapeSignature, coverageKey, sizeDecimals, px, band, tapePage]);
  const tapeCount = inspected?.total ?? 0;
  const tradeIndex = inspected?.page ?? 0;
  const tapeRows = inspected?.rows ?? [];
  const coveredMs = inspected?.coveredMs ?? data.coveredMs;
  const durationMs = inspected?.durationMs ?? LENS_MS;
  const coverageText = durationMs === 0 ? DASH : inspected && tapeScope === 'moment'
    ? `${coveredMs}/${durationMs} ms` : `${preciseUsd.format(coveredMs / 1000)}/${preciseUsd.format(durationMs / 1000)} s`;
  const selectedRow = selection ? selectedPrices.find(row => row.px === selection.px) : undefined;
  useEffect(() => { dialog.current?.showModal(); }, []);
  const closeDialog = () => dialog.current?.close();
  return (
    <dialog ref={dialog} className="ml-dialog" aria-labelledby={label} onClose={close}>
      <div className="ml-workspace">
        <header className="ml-top">
          <h2 id={label}>{tr('Przekrój chwili', 'Moment lens')}</h2>
          <nav aria-label={tr('Rynki order flow', 'Order flow markets')}>
            {ORDER_FLOW_MARKETS.map(market => <a key={market.coin} href={`#orderflow?m=${encodeURIComponent(market.coin)}`} aria-current={market.coin === store.coin ? 'page' : undefined}>{market.label}</a>)}
          </nav>
          <button className="ml-close" type="button" autoFocus onClick={closeDialog}><X size={17} aria-hidden="true" />{tr('Zamknij', 'Close')}</button>
        </header>
        <div className="ml-main">
          <BookPane store={store} frame={frame} cursor={t} page={bookPage} size={big ? 20 : 10} setPage={setBookPage} px={px}
            onPrice={price => selectCell({ px: price, band: null })} />
          <section className="ml-scope" aria-label={tr('Wykonania według nominału', 'Executions by notional')}>
            <header className="ml-panel-head ml-scope-head">
              <h3>{tr('Wykonania według ceny', 'Executions by price')}</h3>
              <div className="ml-views" role="group" aria-label={tr('Widok wykonań', 'Execution view')}>
                <button type="button" aria-pressed={view === 'numbers'} onClick={() => changeView('numbers')}>{tr('Liczby', 'Numbers')}</button>
                <button type="button" aria-pressed={view === 'graph'} onClick={() => changeView('graph')}>{tr('Przekrój', 'Chart')}</button>
                <button type="button" aria-pressed={view === 'tapes'} onClick={() => changeView('tapes')}>{tr('Taśmy', 'Tapes')}</button>
              </div>
            </header>
            {view !== 'tapes' ? <>
              <div className="ml-legend">
                <span className="ml-bid">↑ {tr('Kupno', 'Buy')}</span>
                <span className="ml-ask">↓ {tr('Sprzedaż', 'Sell')}</span>
                <span>{tr('Liczba wykonań · USD', 'Execution count · USD')}</span>
              </div>
              {view === 'graph' && <>
                <div className="ml-context-label">{tr('Kontekst 2 min · lewo kupno, prawo sprzedaż · skala log.', '2 min context · buys left, sells right · log scale')}</div>
                <div className="ml-bands" aria-label={tr('Klasy nominału', 'Notional bands')}>
                  {NOMINAL_BANDS.map((value, index) => <span key={value}><strong>{value}</strong><small>{data.coveredMs > 0 || data.totals[index] > 0 ? whole.format(data.totals[index]) : DASH} {tr('wyk.', 'fills')}</small></span>)}
                </div>
                <Timeline data={data} cursor={t} go={pickTime} />
              </>}
              <LensPriceMatrix rows={visiblePrices} covered={point.covered} selected={selection} onSelect={selectCell}
                fmtPx={price => store.fmtPx(price)} graphical={view === 'graph'} />
              {!point.covered ? <p className="ml-state">{tr('Brak pokrycia taśmy przy kursorze', 'No tape coverage at cursor')}</p>
                : selectedPrices.length === 0 && <p className="ml-state">{tr('0 wykonań w tej milisekundzie', '0 executions in this millisecond')}</p>}
              {selectedPrices.length > 0 && <Pager count={selectedPrices.length} size={pricesPerPage} page={priceIndex}
                setPage={page => setPricePosition(page * pricesPerPage)} label={tr('Ceny wykonania', 'Execution prices')} range={priceRange} />}
            </> : <>
              <div className="ml-data-head">
                <div className="ml-views" role="group" aria-label={tr('Zakres taśmy', 'Tape range')}>
                  <button type="button" aria-pressed={tapeScope === 'moment'} onClick={() => { setTapeScope('moment'); setTapePage(0); }}>1 ms</button>
                  <button type="button" aria-pressed={tapeScope === 'window'} onClick={() => { setTapeScope('window'); setTapePage(0); }}>{tr('Do 2 min', 'Up to 2 min')}</button>
                </div>
                {tapeScope === 'window' && tapeTo > tapeFrom && <small>{clock.format(tapeFrom)}–{clock.format(t)} UTC</small>}
              </div>
              <div className="ml-bands ml-tape-filters" role="group" aria-label={tr('Filtr nominału', 'Notional filter')}>
                {NOMINAL_BANDS.map((value, index) => (
                  <button key={value} type="button" aria-pressed={band === index} onClick={() => {
                    const next = band === index ? null : index;
                    if (selection) setSelection({ px: selection.px, band: next });
                    else setTapeBand(next);
                    setTapePage(0);
                  }}>{value}</button>
                ))}
              </div>
              {tapeRows.length === 0 ? <p className="ml-state">{coveredMs === 0
                ? tr('Brak pokrycia taśmy w wybranym zakresie', 'No tape coverage in the selected range')
                : tr('Brak odebranych wykonań dla tego filtra', 'No received executions for this filter')}</p> :
                <table className="ml-executions">
                  <thead><tr><th scope="col">UTC</th><th scope="col">{tr('Strona', 'Side')}</th><th scope="col">{tr('Cena', 'Price')}</th><th scope="col">{tr('Ilość', 'Size')}</th><th scope="col">USD</th></tr></thead>
                  <tbody>{tapeRows.map(trade => <tr key={`${trade.t}:${trade.tid}`} data-ml-tid={trade.tid} data-ml-trade-time={trade.t}>
                    <th scope="row"><button type="button" onClick={() => {
                      pickTime(trade.t);
                      const index = momentAt(store.tape, store.coverage, trade.t, sizeDecimals).prices.findIndex(row => row.px === trade.px);
                      setPricePosition(Math.max(0, index));
                      setSelection({ px: trade.px, band: trade.band });
                      setTapeBand(null);
                      setView('numbers');
                    }}>{clock.format(trade.t)}</button></th>
                    <td className={trade.side === 1 ? 'ml-bid' : 'ml-ask'}>{trade.side === 1 ? tr('Kupno', 'Buy') : tr('Sprzedaż', 'Sell')}</td>
                    <td>{store.fmtPx(trade.px)}</td><td>{preciseUsd.format(trade.sz)}</td><td>{trade.usd === null ? DASH : formatAtoms(trade.usd, 6)}</td>
                  </tr>)}</tbody>
                </table>}
              {tapeCount > 0 && <Pager count={tapeCount} size={tradesPerPage} page={tradeIndex} setPage={setTapePage} label={tr('Strony taśmy', 'Tape pages')} />}
            </>}
            {selection && <LensCellDetail selection={selection} row={selectedRow} covered={point.covered}
              fmtPx={price => store.fmtPx(price)} unit={unit} decimals={sizeDecimals}
              clear={() => { setSelection(null); setTapeBand(null); setTapePage(0); }} executions={inspectCell} />}
          </section>
        </div>
        <footer className="ml-transport">
          <div className="ml-clock">
            <label htmlFor={seekId}><time data-ml-cursor={t}>{clock.format(t)} UTC</time></label>
            <small data-ml-tape-coverage={inspected?.coveredMs} data-ml-tape-duration={inspected?.durationMs}>
              {inspected ? tr('Pokrycie taśmy', 'Tape coverage') : tr('Pokrycie kontekstu', 'Context coverage')} {coverageText}
              {coveredMs < durationMs && ` · ${tr('luki', 'gaps')}`}
              {!inspected && data.unclassified > 0 && ` · ${data.unclassified} ${tr('bez nominału', 'unclassified')}`}
            </small>
          </div>
          <div className="ml-range">
            <input id={seekId} type="range" min={0} max={LENS_MS - 1} value={t - data.from} step={1} aria-label={tr('Czas UTC w oknie dwóch minut', 'UTC time within two-minute window')} aria-valuetext={`${clock.format(t)} UTC`} onChange={e => pickTime(data.from + e.currentTarget.valueAsNumber)} />
            <span>{clock.format(data.from)}</span><span>{clock.format(data.to - 1)}</span>
          </div>
          <div className="ml-steps">
            <button type="button" aria-label={tr('Poprzednia chwila z wykonaniem', 'Previous execution moment')} disabled={before === undefined} onClick={() => pickTime(before)}><ChevronLeft size={16} /></button>
            <button type="button" disabled={data.peak === null} onClick={() => { if (data.peak !== null) pickTime(data.peak); }}><Crosshair size={15} aria-hidden="true" />{tr('Najwięcej wyk.', 'Most executions')}</button>
            <button type="button" aria-label={tr('Następna chwila z wykonaniem', 'Next execution moment')} disabled={after === undefined} onClick={() => pickTime(after)}><ChevronRight size={16} /></button>
            <button type="button" aria-pressed={!paused} onClick={() => { setPaused(null); setPricePosition(0); setTapePage(0); }}>{tr('Na żywo', 'Live')}</button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}
