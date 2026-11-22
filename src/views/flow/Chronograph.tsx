import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type KeyboardEvent } from 'react';
import type { BookFrame } from '../../charts/pro/core/book';
import type { Coverage } from '../../charts/pro/core/coverage';
import type { Tape, TradeRow } from '../../charts/pro/core/tape';
import { locale, tr } from '../../i18n';
import { DASH, fmtFixed, fmtSigned } from '../../ui/format';
import { compactDomUsd } from './domDisplay';
import { bookMetrics, visibleExecutions } from './hip3Flow';
import { readSizeThreshold, TAPE_MINIMUMS } from './chronographModel';
import { depthChangeAtPrice, FLOW_WINDOW_MS, type BookSide, tradeActivity } from './orderFlowDesk';
import './chronograph.css';

export interface ChronographSource {
  tape: Tape;
  coverage: Coverage;
  through: number;
  book: BookFrame | null;
  previous: BookFrame | null;
  bookCoverage: Coverage;
  bookAge: number | null;
  bookFresh: boolean;
  fmtPx: (price: number) => string;
  unit: string;
  sizeDecimals: number;
  recorded?: boolean;
}

type Trade = TradeRow & { usd: number };
export type TapeExcerpt = { rows: readonly Trade[]; firstBelow: Trade | null; label: string; close: () => void };

const WINDOWS = [30_000, 120_000, 300_000];
const DEPTHS = [5, 10, 20] as const;
const TAPE_LIMIT = 180;
const timestamp = new Intl.DateTimeFormat(locale, {
  timeZone: 'UTC', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
const shortNumber = new Intl.NumberFormat(locale, { maximumFractionDigits: 5 });
const significantQuantity = new Intl.NumberFormat(locale, { maximumSignificantDigits: 4 });
const emptyAmounts = { buyUsd: 0, sellUsd: 0, buySize: 0, sellSize: 0 };
const windowName = (ms: number) => ms < 60_000 ? `${ms / 1000} s` : `${ms / 60_000} min`;
const quantity = (value: number | null, digits: number) => value === null ? DASH : fmtFixed(value, digits);
const keyOf = (row: TradeRow) => `${row.t}:${row.tid}`;
const usdCompact = (value: number) => compactDomUsd(BigInt(Math.round(value * 1_000_000)));
const signClass = (value: number | null) => value === null || value === 0 ? '' : value > 0 ? 'of-buy' : 'of-sell';
const signedQuantity = (value: number | null) => value === null ? DASH
  : (value < 0 ? '−' : value > 0 ? '+' : '') + significantQuantity.format(Math.abs(value));
export const chronoTime = (ms: number) => `${timestamp.format(ms)}${tr(',', '.')}${String(ms % 1000).padStart(3, '0')}`;

function Amount({ value, max, text, detail, side }: {
  value: number | null; max: number; text: string; detail: string; side?: BookSide;
}) {
  return <span className="oc-amount" data-side={side} title={detail} style={value === null
    ? undefined : { '--oc-fill': `${Math.min(100, 100 * Math.abs(value) / max)}%` } as CSSProperties}>
    <span>{text}</span>
  </span>;
}

export function Chronograph({
  source, compare, demoControls, trial, excerpt, initialMinimum = 0, initialPrice = null, fixedWindow, showSideFilter = true, onPickBook, tapeQuestion, ladderSettings, onMinimumChange, onDepthChange,
}: {
  source: ChronographSource;
  compare?: ReactNode;
  demoControls?: ReactNode;
  trial?: ReactNode;
  excerpt?: TapeExcerpt;
  initialMinimum?: number;
  initialPrice?: number | null;
  fixedWindow?: number;
  showSideFilter?: boolean;
  onPickBook?: (price: number, side: BookSide | null) => void;
  tapeQuestion?: { control: ReactNode; price: number | null; open: (trade: TradeRow, trigger: HTMLButtonElement) => void };
  ladderSettings?: { tapeMinimumUsd: number; bookDepth: (typeof DEPTHS)[number] };
  onMinimumChange?: (minimum: number) => void;
  onDepthChange?: (depth: (typeof DEPTHS)[number]) => void;
}) {
  const { tape, coverage, through, book, previous, bookCoverage, fmtPx, unit, sizeDecimals } = source;
  const [windowMs, setWindowMs] = useState(120_000);
  const [internalDepth, setInternalDepth] = useState<(typeof DEPTHS)[number]>(10);
  const depth = ladderSettings?.bookDepth ?? internalDepth;
  const [showChange, setShowChange] = useState(true);
  const [aggressors, setAggressors] = useState(false);
  const [side, setSide] = useState<'all' | 'buy' | 'sell'>('all');
  const [internalMinimum, setInternalMinimum] = useState(initialMinimum);
  const minimum = ladderSettings?.tapeMinimumUsd ?? internalMinimum;
  const setMinimum = onMinimumChange ?? setInternalMinimum;
  const setDepth = onDepthChange ?? setInternalDepth;
  const [crossed, setCrossed] = useState(false);
  const [selected, setSelected] = useState<number | null>(initialPrice);
  const [print, setPrint] = useState<{ row: Trade } | null>(null);
  const tapeScroll = useRef<HTMLDivElement>(null);
  const priceScroll = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const priceHeading = useId();
  const tapeHeading = useId();
  const ms = fixedWindow ?? windowMs;
  const from = through - ms;
  const coveredMs = coverage.coveredMs(from, through);
  const signature = tape.signature(from, through);
  const activity = useMemo(() => tradeActivity(tape, coverage, from, through), [tape, coverage, from, through, coveredMs, signature]);
  const metrics = useMemo(() => book ? bookMetrics(book) : null, [book]);
  const bids = metrics?.bids.slice(0, depth) ?? [];
  const asks = metrics?.asks.slice(0, depth) ?? [];
  const last = useMemo(() => visibleExecutions(tape, through - 1, 0, 1)[0], [tape, through, tape.lastTime, tape.count]);
  const lastPrice = last?.px ?? null;
  const price = selected ?? lastPrice ?? bids[0]?.px ?? asks[0]?.px ?? null;
  const sizes = Math.min(6, sizeDecimals);
  const compactQty = (value: number | null) => value === null ? DASH : shortNumber.format(value);
  const floor = Math.max(0, minimum - .0000005);
  const aggressor = side === 'all' ? undefined : side === 'buy' ? 1 : -1;
  const questionPrice = tapeQuestion?.price ?? null;
  const recentTrades = useMemo(() => excerpt?.rows
    ?? visibleExecutions(tape, through - 1, floor, TAPE_LIMIT, from, aggressor, questionPrice ?? undefined),
    [excerpt, tape, through, from, floor, aggressor, signature, questionPrice]);
  const keptPrint = !excerpt && print && print.row.t >= from && print.row.t < through
    && (questionPrice === null || print.row.px === questionPrice)
    && coverage.covers(print.row.t, print.row.t + 1)
    && print.row.usd >= floor && (aggressor === undefined || print.row.side === aggressor)
    && !recentTrades.some(row => keyOf(row) === keyOf(print.row)) ? print.row : null;
  const trades = keptPrint ? [...recentTrades.slice(0, TAPE_LIMIT - 1), keptPrint] : recentTrades;
  const threshold = useMemo(() => minimum > 0 && !excerpt && side === 'all'
    ? readSizeThreshold(tape, coverage, from, through, minimum, sizeDecimals) : null,
    [minimum, excerpt, side, tape, coverage, from, through, sizeDecimals, coveredMs, signature]);
  const allPrices = [...new Set([...bids.map(row => row.px), ...asks.map(row => row.px),
    ...(activity?.atPrice.keys() ?? []), ...(price === null ? [] : [price])])].sort((a, b) => b - a);
  const bookMin = bids.at(-1)?.px ?? null;
  const bookMax = asks.at(-1)?.px ?? null;
  const activeIndex = price === null ? 0 : allPrices.indexOf(price);
  const byBid = new Map(bids.map(level => [level.px, level]));
  const byAsk = new Map(asks.map(level => [level.px, level]));
  const fromRow = Math.max(0, activeIndex - depth);
  const toRow = activeIndex + depth;
  const rows = allPrices.filter((px, index) => byBid.has(px) || byAsk.has(px) || (index >= fromRow && index <= toRow));
  const maxDepth = Math.max(1, ...bids.map(level => level.size), ...asks.map(level => level.size));
  const volume = (row: typeof emptyAmounts) => row.buyUsd + row.sellUsd;
  let peak: { price: number; usd: number } | null = null;
  let maxBuySize = 1;
  for (const [px, row] of activity?.atPrice ?? []) {
    const usd = volume(row);
    if (!peak || usd > peak.usd) peak = { price: px, usd };
    maxBuySize = Math.max(maxBuySize, row.buySize);
  }
  const highlight = excerpt ? excerpt.firstBelow && keyOf(excerpt.firstBelow) : print && keyOf(print.row);
  const atPrice = trades.find(row => row.px === price);
  const setPrice = (px: number) => {
    setSelected(px);
    setPrint(null);
    onPickBook?.(px, byBid.has(px) ? 'bid' : byAsk.has(px) ? 'ask' : null);
  };
  const onPriceKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const next = rows[index + (e.key === 'ArrowUp' ? -1 : 1)];
    if (next === undefined) return;
    setPrice(next);
    priceScroll.current?.querySelector<HTMLButtonElement>(`[data-of-level="${next}"]`)?.focus();
  };
  useLayoutEffect(() => {
    const scroll = priceScroll.current;
    const active = scroll?.querySelector<HTMLElement>('[data-oc-selected]');
    const header = scroll?.querySelector('thead');
    if (!scroll || !active || !header) return;
    const outer = scroll.getBoundingClientRect();
    const inner = active.getBoundingClientRect();
    const top = outer.top + header.getBoundingClientRect().height;
    if (inner.top < top || inner.bottom > outer.bottom) {
      scroll.scrollTop += inner.top - top - (outer.bottom - top - inner.height) / 2;
    }
  }, [price, depth]);
  useLayoutEffect(() => {
    const scroll = tapeScroll.current;
    const target = scroll?.querySelector<HTMLElement>('[data-oc-highlight]');
    if (!scroll || (!target && !excerpt)) return;
    const outer = scroll.getBoundingClientRect();
    const next = target ? target.getBoundingClientRect().top - outer.top + scroll.scrollTop - scroll.clientHeight / 3 : 0;
    const motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroll.scrollTo({ top: Math.max(0, next), behavior: motion ? 'smooth' : 'instant' });
    if (excerpt) back.current?.focus({ preventScroll: true });
    else scroll.focus({ preventScroll: true });
    scroll.scrollIntoView({ block: 'nearest', behavior: motion ? 'smooth' : 'instant' });
  }, [print, excerpt]);
  useEffect(() => {
    if (print && !trades.some(row => keyOf(row) === keyOf(print.row))) {
      setPrint(null);
      setCrossed(false);
    }
  }, [trades, print]);

  const count = activity?.count;
  const delta = activity ? activity.buySize - activity.sellSize : null;
  const bidTotal = bids.at(-1)?.totalSize;
  const askTotal = asks.at(-1)?.totalSize;
  const tilt = bidTotal !== undefined && askTotal !== undefined && bidTotal + askTotal > 0
    ? 100 * (bidTotal - askTotal) / (bidTotal + askTotal) : null;
  const changeIn = book && previous ? `${fmtFixed((book.t - previous.t) / 1000, 1)} s` : DASH;
  const changeAt = (level: number, side: BookSide) => {
    const usd = showChange ? depthChangeAtPrice(book, previous, level, bookCoverage, side) : null;
    return usd === null ? null : usd / level;
  };
  const setFloor = (value: number) => {
    setMinimum(value);
    setCrossed(false);
    setPrint(null);
  };
  return <div className="oc-workspace" data-oc-source={source.recorded ? 'replay' : 'live'}>
    <section className="oc-control-card" aria-label={tr('Ustawienia drabinki', 'Ladder controls')}>
      <div className="oc-controls">
        {demoControls}
        <label>{tr('Kolumny', 'Columns')} <select value={aggressors ? 'sides' : 'delta'} onChange={e => setAggressors(e.currentTarget.value === 'sides')}>
          <option value="delta">{tr('Delta i obrót', 'Delta & volume')}</option>
          <option value="sides">{tr('Kupno i sprzedaż', 'Buy & sell')}</option>
        </select></label>
        <label>{tr('Okno', 'Window')} <select value={ms} disabled={fixedWindow !== undefined} onChange={e => setWindowMs(Number(e.currentTarget.value))}>
          {WINDOWS.map(value => <option key={value} value={value}>{windowName(value)}</option>)}
        </select></label>
        <label><input type="checkbox" checked={showChange} onChange={e => setShowChange(e.currentTarget.checked)} /> Δ L2 · ~30 s</label>
        <label>{tr('Głębokość', 'Depth')} <select value={depth} onChange={e => {
          const value = DEPTHS.find(d => String(d) === e.currentTarget.value);
          if (value !== undefined) setDepth(value);
        }}>
          {DEPTHS.map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>
        {compare}
      </div>
      <div className="oc-read" data-oc-totals>
        <span>{tr('Rynek', 'Market')} · {windowName(ms)}</span>
        <span>Δ <strong className={signClass(delta)} data-of-activity>{fmtSigned(delta, sizes, ` ${unit}`)}</strong></span>
        {activity && <>
          <span><b className="of-buy">↑ {compactQty(activity.buySize)}</b> / <b className="of-sell">↓ {compactQty(activity.sellSize)}</b> {unit}</span>
          <span>{tr('Obrót', 'Volume')} <strong>{usdCompact(activity.buyUsd + activity.sellUsd)} USD</strong></span>
          <span>{fmtFixed(activity.count * 1000 / ms, 2)} {tr('wyk./s', 'trades/s')}</span>
          <span>{tr('Szczyt obrotu', 'Peak volume')} <strong>{peak ? fmtPx(peak.price) : DASH}</strong></span>
        </>}
        <span data-oc-coverage>{tr('Taśma', 'Tape')} {Math.floor(coveredMs / 1000)}/{ms / 1000} s
          {!activity && ` · ${tr('brak pełnego pokrycia', 'incomplete coverage')}`}</span>
        {count !== undefined && <span>{count} {tr('wyk.', 'trades')}</span>}
      </div>
    </section>
    <div className="oc-grid">
      <section className="of-card oc-ladder" aria-labelledby={priceHeading}>
        <header className="oc-card-head"><h2 id={priceHeading}>{tr('Drabinka cen', 'Price ladder')}</h2>
          <span>{tr('Głębokość i wykonania', 'Depth & executed volume')}</span>
        </header>
        {rows.length ? <div ref={priceScroll} className="oc-scroll oc-price-scroll" role="region" tabIndex={0} aria-labelledby={priceHeading}>
          <table className="oc-prices">
            <colgroup><col /><col className="oc-orders" /><col /><col /><col /><col className="oc-orders" /><col /></colgroup>
            <thead><tr>
              <th scope="col">{aggressors ? tr('Sprz.', 'Sell') : 'Δ'} <small>{unit}</small></th>
              <th scope="col" className="oc-orders" aria-label={tr('Liczba zleceń BID', 'Bid order count')}>#</th>
              <th scope="col">Bid <small>{unit}</small></th>
              <th scope="col" className="oc-price">{tr('Cena', 'Price')} <small>USD</small></th>
              <th scope="col">Ask <small>{unit}</small></th>
              <th scope="col" className="oc-orders" aria-label={tr('Liczba zleceń ASK', 'Ask order count')}>#</th>
              <th scope="col">{aggressors ? tr('Kupno', 'Buy') : tr('Obr.', 'Vol.')} <small>{aggressors ? unit : 'USD'}</small></th>
            </tr></thead>
            <tbody>{rows.map((px, index) => {
              const bid = byBid.get(px), ask = byAsk.get(px);
              const observed = bookMin !== null && bookMax !== null && px >= bookMin && px <= bookMax;
              const empty = observed ? '' : DASH;
              const row = activity ? activity.atPrice.get(px) ?? emptyAmounts : null;
              const left = row ? aggressors ? row.sellSize : row.buySize - row.sellSize : null;
              const right = row ? aggressors ? row.buySize : volume(row) : null;
              const changeBid = bid ? changeAt(px, 'bid') : null;
              const changeAsk = ask ? changeAt(px, 'ask') : null;
              const selectedRow = px === price;
              return <tr key={px} data-oc-selected={selectedRow || undefined}>
                <td className={aggressors ? 'of-sell' : signClass(left)} title={quantity(left, sizes)}>{aggressors ? compactQty(left) : signedQuantity(left)}</td>
                <td className="oc-orders">{bid ? Number.isFinite(bid.orders) ? bid.orders : DASH : empty}</td>
                <td className="of-buy">{bid ? <Amount value={bid.size} max={maxDepth} text={compactQty(bid.size)}
                  detail={`${quantity(bid.size, sizes)} ${unit} · Σ ${quantity(bid.totalSize, sizes)} ${unit} · ${fmtFixed(bid.usd, 2)} USD`} side="bid" /> : empty}
                  {bid && showChange && <small className={'oc-change ' + signClass(changeBid)} title={quantity(changeBid, sizes)}>{signedQuantity(changeBid)}</small>}</td>
                <th scope="row" className="oc-price">
                  <button type="button" data-of-level={px} tabIndex={selectedRow ? 0 : -1} aria-pressed={selectedRow}
                    onClick={() => setPrice(px)} onKeyDown={e => onPriceKey(e, index)}>{fmtPx(px)}</button>
                </th>
                <td className="of-sell">{ask ? <Amount value={ask.size} max={maxDepth} text={compactQty(ask.size)}
                  detail={`${quantity(ask.size, sizes)} ${unit} · Σ ${quantity(ask.totalSize, sizes)} ${unit} · ${fmtFixed(ask.usd, 2)} USD`} side="ask" /> : empty}
                  {ask && showChange && <small className={'oc-change ' + signClass(changeAsk)} title={quantity(changeAsk, sizes)}>{signedQuantity(changeAsk)}</small>}</td>
                <td className="oc-orders">{ask ? Number.isFinite(ask.orders) ? ask.orders : DASH : empty}</td>
                <td className={aggressors ? 'of-buy' : undefined}><Amount value={right} max={aggressors ? maxBuySize : peak?.usd || 1}
                  text={right === null ? DASH : aggressors ? compactQty(right) : usdCompact(right)}
                  detail={right === null ? DASH : (aggressors ? quantity(right, sizes) + ' ' + unit : fmtFixed(right, 2) + ' USD')} /></td>
              </tr>;
            })}</tbody>
          </table>
        </div> : <p className="of-empty">{tr('Czekam na arkusz i wykonania Hyperliquid', 'Waiting for the Hyperliquid book and trades')}</p>}
        <footer className="oc-book-foot">
          <div className="oc-read" data-oc-book>
            {book ? <><span>{tr('Widoczne poziomy', 'Visible levels')} {bids.length}/{asks.length} BID/ASK</span>
              <span className="of-buy">Bid {compactQty(bidTotal ?? null)} {unit}</span>
              <span className="of-sell">Ask {compactQty(askTotal ?? null)} {unit}</span>
              <span>{tr('Przewaga', 'Depth tilt')} <strong>{tilt === null ? DASH : `${fmtFixed(Math.abs(tilt), 1)}% ${tilt >= 0 ? 'Bid' : 'Ask'}`}</strong></span>
              <span>L2 {tr('wiek', 'age')} {source.bookAge === null ? DASH : fmtFixed(source.bookAge / 1000, 1) + ' s'}</span>
              <span>{tr('Spread', 'Spread')} {metrics?.spread == null ? DASH : shortNumber.format(metrics.spread) + ' USD'}</span>
              {showChange && <span title={tr('Różnica między porównywalnymi migawkami', 'Difference between comparable snapshots')}>Δ L2 · {changeIn}</span>}</>
              : <span>{tr('Brak migawki L2. Taśma ma osobne pokrycie.', 'No L2 snapshot. Tape coverage is independent.')}</span>}
            {book && !source.bookFresh && !source.recorded && <span>{tr('Ostatnia migawka', 'Last snapshot')}</span>}
          </div>
          {trial}
          {!excerpt && price !== null && <div className="oc-price-action">
            <span>{tr('Poziom', 'Level')} <strong>{fmtPx(price)} USD</strong></span>
            <button type="button" disabled={!atPrice} onClick={() => {
              if (atPrice) { setSelected(atPrice.px); setPrint({ row: atPrice }); }
            }}>
              {tr('Pokaż wykonanie', 'Show trade')}
            </button>
            {!atPrice && <small>{tr('Brak tej ceny na widocznej taśmie', 'This price is absent from the visible tape')}</small>}
          </div>}
        </footer>
      </section>
      <section className="of-card oc-tape" aria-labelledby={tapeHeading}>
        <header className="oc-card-head">
          <div><h2 id={tapeHeading}>{tr('Taśma wykonań', 'Trade tape')}</h2>
            <span>{excerpt?.label ?? `${source.recorded ? tr('Nagranie', 'Recorded') : 'Hyperliquid'} · ${windowName(ms)} · UTC`}</span></div>
          {excerpt && <button type="button" ref={back} onClick={excerpt.close}>{tr('Wróć do taśmy', 'Back to tape')}</button>}
        </header>
        {!excerpt && <div className="oc-filters">
          {tapeQuestion?.control}
          <label>{tr('Min. nominał', 'Min. trade size')} <select value={minimum} data-oc-floor onChange={e => setFloor(Number(e.currentTarget.value))}>
            {TAPE_MINIMUMS.map(value => <option value={value} key={value}>{value ? `≥ $${usdCompact(value)}` : tr('Wszystkie', 'All sizes')}</option>)}
            {!TAPE_MINIMUMS.includes(minimum) && <option value={minimum}>≥ ${fmtFixed(minimum, 6)} USD</option>}
          </select></label>
          {showSideFilter && <label>{tr('Strona', 'Side')} <select value={side} onChange={e => {
            const value = e.currentTarget.value;
            setSide(value === 'buy' || value === 'sell' ? value : 'all');
            setPrint(null);
          }}>
            <option value="all">{tr('Obie', 'Both')}</option>
            <option value="buy">{tr('Kupno', 'Buy')}</option>
            <option value="sell">{tr('Sprzedaż', 'Sell')}</option>
          </select></label>}
        </div>}
        {threshold && <div className="oc-threshold" aria-live="polite">
          {threshold.kind === 'covered' ? <>
            <div><span>{tr('Pełna delta', 'Full delta')} <strong className={signClass(threshold.full)}>{fmtSigned(threshold.full, sizes, ` ${unit}`)}</strong></span>
              <span>{tr('Delta po filtrze', 'Filtered delta')} <strong className={signClass(threshold.filtered)}>{fmtSigned(threshold.filtered, sizes, ` ${unit}`)}</strong></span></div>
            <small>{threshold.count}/{threshold.total} {tr('wykonań', 'trades')}</small>
            {threshold.crossing ? <button type="button" onClick={() => {
              const crossing = threshold.crossing;
              if (!crossing) return;
              setMinimum(crossing.minimum);
              const match = visibleExecutions(tape, crossing.time, 0, Infinity, crossing.time).find(row => row.tid === crossing.tid);
              if (match) {
                setSelected(match.px);
                setPrint({ row: match });
                setCrossed(true);
              }
            }}>{tr('Pokaż zmianę znaku przy', 'Show flip at')} ≥ {fmtFixed(threshold.crossing.minimum, 6)} USD</button>
            : <small>{crossed ? tr('Wyróżniono wykonanie na progu', 'Threshold trade highlighted')
              : threshold.filtered === 0 ? tr('Delta na progu wynosi zero', 'Delta at the threshold is zero')
                : tr('Brak zmiany znaku poniżej progu', 'No sign change below this threshold')}</small>}
          </> : <p>{threshold.kind === 'gap' ? tr('Nie można porównać delt przy luce taśmy', 'Delta comparison needs full tape coverage')
            : tr('Brak wymaganej precyzji nominału', 'Required notional precision is unavailable')}</p>}
        </div>}
        {!excerpt && !activity && <p className="oc-tape-gap">{tr('Widać odebrane wykonania. Okno jest niepełne.', 'Received trades only. The window has incomplete coverage.')}</p>}
        <div ref={tapeScroll} className="oc-scroll oc-tape-scroll" role="region" tabIndex={0} aria-labelledby={tapeHeading}>
          <table>
            <thead><tr><th scope="col" aria-label={tr('Strona agresora', 'Aggressor side')}>↕</th><th scope="col">UTC</th>
              <th scope="col">{tr('Cena', 'Price')}</th><th scope="col">{unit}</th><th scope="col">USD</th></tr></thead>
            <tbody>{trades.map(row => <tr key={keyOf(row)} data-of-trade-price={row.px} data-of-trade-side={row.side}
              data-oc-highlight={keyOf(row) === highlight || undefined} data-oc-at-price={row.px === price || undefined}
              className={row.side === 1 ? 'of-buy' : 'of-sell'}>
              <td><span aria-label={row.side === 1 ? tr('Agresywne kupno', 'Aggressive buy') : tr('Agresywna sprzedaż', 'Aggressive sell')}>{row.side === 1 ? '↑' : '↓'}</span></td>
              <td title={chronoTime(row.t) + ' UTC'}>{tapeQuestion && questionPrice !== null && !excerpt
                ? <button type="button" className="oc-question-trade" data-oc-question-trade={row.tid}
                    aria-label={tr('Porównaj wykonanie', 'Compare trade') + ` · ${chronoTime(row.t)} UTC · ${quantity(row.sz, sizes)} ${unit}`}
                    onClick={e => tapeQuestion.open(row, e.currentTarget)}>{chronoTime(row.t)}</button>
                : timestamp.format(row.t)}</td>
              <td>{fmtPx(row.px)}</td><td title={quantity(row.sz, sizes)}>{compactQty(row.sz)}</td>
              <td title={fmtFixed(row.usd, 6)}>{usdCompact(row.usd)}</td>
            </tr>)}</tbody>
          </table>
          {!trades.length && <p className="of-empty">{tr('Brak odebranych wykonań dla tego wyboru', 'No received trades match this selection')}</p>}
        </div>
        <footer className="oc-read">
          <span>{tr('Widocznych', 'Shown')} {trades.length}{excerpt ? '' : `/${TAPE_LIMIT}`}</span>
          {keptPrint && <span>{tr('W tym wskazane wykonanie', 'Includes the selected trade')}</span>}
          {!excerpt && <span>{tr('Drabinka liczy całe okno', 'Ladder uses the full window')}</span>}
          <span>↑ {tr('Kupno', 'Buy')} / ↓ {tr('Sprzedaż', 'Sell')}</span>
        </footer>
      </section>
    </div>
  </div>;
}
