import { type Ref, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowUpRight, ChevronLeft, Crosshair, SlidersHorizontal, X } from 'lucide-react';
import type { BookFrame } from '../../charts/pro/core/book';
import type { Side } from '../../charts/pro/hl/parse';
import { storeFor, type ProStore } from '../../charts/pro/store/proStore';
import { useStoreVersion } from '../../charts/pro/store/useStoreVersion';
import { deskMarketOf } from '../../config/deskMarkets';
import { locale, tr } from '../../i18n';
import { useNow } from '../../shell/dzien';
import { subscribeHash } from '../../state/route';
import { SectionHeading } from '../../ui';
import { DASH, fmtCompact, fmtFixed, fmtNum, fmtSigned } from '../../ui/format';
import { bookMetrics, hip3TapeFilters, isHip3DeskFlow, visibleExecutions } from './hip3Flow';
import { DeltaMomentCard } from './DeltaMomentCard';
import type { DomMode } from './DomWorkspace';
import { MomentLens } from './MomentLens';
import { readDeltaMoment, type DeltaMoment } from './deltaMoment';
import {
  BOOK_HIDE_AFTER_MS, FLOW_WINDOW_MS, MAX_BOOK_AGE_MS, ORDER_FLOW_MARKETS, PIN_MIN_MS, PIN_TAPE_LIMIT,
  captureLevel, deskMarketFromHash, depthChangeAtPrice, referenceBook, tradeActivity,
  type BookSide, type PinnedLevel,
} from './orderFlowDesk';
import './orderFlowView.css';

const TAPE_VIEW_MS = 5 * 60_000;
const BOOK_LEVELS_PER_SIDE = 10;
const PRO_BOOK_LEVELS_PER_SIDE = 20;
const EXECUTION_WINDOWS = [FLOW_WINDOW_MS, 120_000, 300_000];
const windowLabel = (ms: number) => ms < 60_000 ? `${ms / 1_000} s` : `${ms / 60_000} min`;
const clock = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const midpointPrice = new Intl.NumberFormat(locale, { maximumFractionDigits: 7, useGrouping: true });
const timeLabel = (time: number) => Number.isFinite(time) ? clock.format(time) : DASH;
const exactTime = (time: number | null) => time === null ? DASH : `${timeLabel(time)}${tr(',', '.')}${String(time % 1000).padStart(3, '0')}`;
const amount = (v: number | null | undefined) => v == null ? DASH : fmtCompact(v);
const dollars = (v: number | null | undefined) => v == null ? DASH : `${fmtCompact(v)} USD`;
const signedUsd = (v: number | null | undefined) => v == null ? DASH : `${v > 0 ? '+' : ''}${fmtCompact(v)} USD`;
const readHash = () => deskMarketFromHash(window.location.hash);

type OrderFlowBook = ReturnType<typeof bookMetrics>;
type Level = OrderFlowBook['bids'][number];
type Activity = NonNullable<ReturnType<typeof tradeActivity>>;

function SessionSummary({
  book, activity, store, windowMs, coverageSeconds, compare,
}: {
  book: OrderFlowBook | null; activity: Activity | null; store: ProStore; windowMs: number; coverageSeconds: number;
  compare: { open: boolean; toggle: () => void; button: Ref<HTMLButtonElement> } | null;
}) {
  const bid = book?.bids[0]?.px;
  const ask = book?.asks[0]?.px;
  const midpoint = book?.spread != null && bid !== undefined && ask !== undefined ? (bid + ask) / 2 : null;
  const bidDepth = book?.bids[4]?.totalUsd;
  const askDepth = book?.asks[4]?.totalUsd;
  const bidShare = bidDepth !== undefined && askDepth !== undefined && bidDepth + askDepth > 0
    ? 100 * bidDepth / (bidDepth + askDepth) : null;
  const delta = activity ? activity.buyUsd - activity.sellUsd : null;
  const deltaClass = `of-metric ${delta === null || delta === 0 ? '' : delta > 0 ? 'of-buy' : 'of-sell'}`;
  return (
    <section className="of-summary" aria-label={tr('Odczyt rynku', 'Market at a glance')}>
      <div>
        <div className="of-label">{tr('Środek spreadu', 'Spread midpoint')}</div>
        <strong className="of-metric of-anchor">{midpoint !== null ? midpointPrice.format(midpoint) : DASH}</strong>
        <div className="of-meta">
          <span className="of-buy">Bid {bid === undefined ? DASH : store.fmtPx(bid)}</span>
          <span className="of-sell">Ask {ask === undefined ? DASH : store.fmtPx(ask)}</span>
          <span>{book?.spreadBp != null ? `${fmtFixed(book.spreadBp, 2)} bp` : DASH}</span>
        </div>
      </div>
      <div>
        <div className="of-label">{tr('Głębokość · po 5 poziomów · USD', 'Depth · 5 levels each · USD')}</div>
        <dl className="of-depth-pair" data-of-depth>
          <div><dt>Bid</dt><dd className="of-buy">{amount(bidDepth)}</dd></div>
          <div><dt>Ask</dt><dd className="of-sell">{amount(askDepth)}</dd></div>
        </dl>
        {bidShare !== null ? (
          <div className="of-balance" aria-label={tr(`Kupno ${Math.round(bidShare)}% widocznej głębokości`, `Bids are ${Math.round(bidShare)}% of visible depth`)}>
            <span style={{ width: `${bidShare}%` }} />
          </div>
        ) : <div className="of-meta">{tr('Czekam na 5 poziomów po każdej stronie', 'Waiting for 5 levels each side')}</div>}
      </div>
      <div>
        <div className="of-label">{tr('Delta wykonań', 'Trade delta')} · {windowLabel(windowMs)}</div>
        {compare && windowMs === FLOW_WINDOW_MS
          ? <button ref={compare.button} type="button" className="of-delta-trigger" aria-expanded={compare.open}
              aria-controls={compare.open ? 'of-delta-moment' : undefined} onClick={compare.toggle}>
              <span className={deltaClass} data-of-activity>{signedUsd(delta)}</span>
              <span>{tr('Delta bez jednej chwili', 'Delta without one moment')}</span>
            </button>
          : <div className={deltaClass} data-of-activity>{signedUsd(delta)}</div>}
        <div className="of-meta">{activity ? tr(
          `${dollars(activity.buyUsd + activity.sellUsd)} obrotu · ${activity.count} wyk.`,
          `${dollars(activity.buyUsd + activity.sellUsd)} volume · ${activity.count} trades`,
        ) : tr(`Pokrycie taśmy ${coverageSeconds}/${windowMs / 1000} s`, `Tape coverage ${coverageSeconds}/${windowMs / 1000} s`)}</div>
        {compare && windowMs !== FLOW_WINDOW_MS && <button ref={compare.button} type="button" className="of-delta-trigger"
          aria-expanded={compare.open} aria-controls={compare.open ? 'of-delta-moment' : undefined} onClick={compare.toggle}>
          {tr('Sprawdź deltę 30 s', 'Inspect 30 s delta')}
        </button>}
      </div>
    </section>
  );
}

function Ladder({
  book, frame, previous, store, activity, focus, setFocus, pro, windowMs, setWindowMs,
}: {
  book: OrderFlowBook | null; frame: BookFrame | null; previous: BookFrame | null; store: ProStore;
  activity: Activity | null; focus: PinnedLevel | null; setFocus: (px: number, side: BookSide) => void; pro: boolean;
  windowMs: number; setWindowMs: (value: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const limit = pro ? PRO_BOOK_LEVELS_PER_SIDE : BOOK_LEVELS_PER_SIDE;
  const asks = book?.asks.slice(0, limit) ?? [];
  const bids = book?.bids.slice(0, limit) ?? [];
  const maxUsd = Math.max(1, ...asks.map(row => row.usd), ...bids.map(row => row.usd));
  const comparisonTime = frame && previous ? `${fmtFixed((frame.t - previous.t) / 1_000, 1)} s` : DASH;
  const renderLevel = (level: Level, side: 'bid' | 'ask', rank: number) => {
    const depthChange = pro ? depthChangeAtPrice(frame, previous, level.px, store.bookCoverage, side) : null;
    const totals = activity?.atPrice.get(level.px);
    const bought = activity ? totals?.buyUsd ?? 0 : null;
    const sold = activity ? totals?.sellUsd ?? 0 : null;
    const picked = focus?.price === level.px && focus.side === side;
    const label = side === 'bid' ? tr('Kupno', 'Bid') : tr('Sprzedaż', 'Ask');
    const depth = <span className="of-liquidity">
      <span className="of-liquidity-fill" aria-hidden="true" style={{ width: `${100 * level.usd / maxUsd}%` }} />
      <span title={fmtFixed(level.usd, 2)}>{amount(level.usd)}</span>
    </span>;
    const orders = Number.isFinite(level.orders) ? level.orders : DASH;
    const change = depthChange === null ? DASH : `${depthChange > 0 ? '+' : ''}${amount(depthChange)}`;
    return (
      <button
        type="button" key={`${side}:${level.px}`}
        className={`of-ladder-row of-${side}${rank > 3 ? ' of-far' : ''}${rank > 5 ? ' of-deeper' : ''}${rank === 1 ? ' of-near' : ''}${picked ? ' of-picked' : ''}`}
        aria-pressed={picked}
        aria-label={`${label} ${store.fmtPx(level.px)} · ${dollars(level.usd)}`}
        data-of-level={level.px}
        data-of-side={side}
        onClick={() => setFocus(level.px, side)}
      >
        <span className="of-compact-cells">
          <span className="of-compact-depth"><span className={side === 'bid' ? 'of-buy' : 'of-sell'}>{label}</span>{depth}</span>
          <strong className="of-level-price">{store.fmtPx(level.px)}</strong>
          <span className="of-orders">{orders}</span>
          {pro && <><span className="of-pro">{activity ? amount((totals?.buyUsd ?? 0) + (totals?.sellUsd ?? 0)) : DASH}</span><span className="of-pro">{change}</span></>}
        </span>
        {pro && <span className="of-terminal-cells">
          <span className={`of-sell of-executed${sold ? '' : ' of-executed-empty'}`} data-of-sold>{amount(sold)}</span>
          <span className="of-cumulative">{side === 'bid' && amount(level.totalUsd)}</span>
          <span className="of-pro">{side === 'bid' && change}</span>
          <span className="of-orders">{side === 'bid' && orders}</span>
          <span className="of-terminal-depth">{side === 'bid' && depth}</span>
          <strong className="of-level-price">{store.fmtPx(level.px)}</strong>
          <span className="of-terminal-depth">{side === 'ask' && depth}</span>
          <span className="of-orders">{side === 'ask' && orders}</span>
          <span className="of-pro">{side === 'ask' && change}</span>
          <span className="of-cumulative">{side === 'ask' && amount(level.totalUsd)}</span>
          <span className={`of-buy of-executed${bought ? '' : ' of-executed-empty'}`} data-of-bought>{amount(bought)}</span>
        </span>}
      </button>
    );
  };
  return (
    <section className="of-card" aria-labelledby="of-book-title">
      <header className="of-card-header">
        <div><h2 id="of-book-title">{tr('Drabinka DOM', 'DOM ladder')}</h2>
          <p>{pro && book ? tr(`${bids.length} bid / ${asks.length} ask · kwoty w USD`, `${bids.length} bids / ${asks.length} asks · amounts in USD`)
            : tr('Wybierz cenę, by przypiąć poziom', 'Select a price to pin its level')}</p></div>
        <div className="of-book-controls">
          {pro && <select className="of-window" aria-label={tr('Okno wykonań', 'Execution window')} value={windowMs} onChange={event => setWindowMs(Number(event.target.value))}>
            {EXECUTION_WINDOWS.map(value => <option value={value} key={value}>{windowLabel(value)}</option>)}
          </select>}
          <span className="of-source">{frame ? timeLabel(frame.t) : DASH}</span>
          {!!book && <button type="button" className="of-depth-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
            {expanded ? tr('Zwiń', 'Collapse') : tr('Więcej cen', 'More prices')}
          </button>}
        </div>
      </header>
      {!book || (!asks.length && !bids.length) ? (
        <p className="of-empty">{tr('Czekam na świeży arkusz Hyperliquid', 'Waiting for a fresh Hyperliquid book')}</p>
      ) : (
        <div className={`of-ladder${pro ? ' of-ladder-pro' : ''}${expanded ? ' of-ladder-expanded' : ''}`}>
          <div className="of-ladder-columns" aria-hidden="true">
            <span className="of-compact-cells">
              <span>{tr('Głębokość USD', 'Depth USD')}</span><span>{tr('Cena', 'Price')}</span><span>{tr('Zlec.', 'Orders')}</span>
              {pro && <><span>{tr('Wyk.', 'Trades')} {windowLabel(windowMs)}</span><span>{tr('Δ ark.', 'Book Δ')}</span></>}
            </span>
            {pro && <span className="of-terminal-cells">
              <span className="of-sell">{tr('Sprzedano', 'Sold')}</span><span>Σ Bid</span><span>Δ Bid</span><span>{tr('Zlec.', 'Orders')}</span><span className="of-buy">Bid</span>
              <span>{tr('Cena', 'Price')}</span>
              <span className="of-sell">Ask</span><span>{tr('Zlec.', 'Orders')}</span><span>Δ Ask</span><span>Σ Ask</span><span className="of-buy">{tr('Kupiono', 'Bought')}</span>
            </span>}
          </div>
          <div className="of-half of-ask-half">{asks.map((level, i) => renderLevel(level, 'ask', i + 1))}</div>
          <div className="of-spread">
            <span>{tr('Spread', 'Spread')}{pro && <span className="of-spread-note" data-of-book-window> · {tr('Δ arkusza', 'Book Δ')} {comparisonTime}</span>}</span>
            <strong>{book.spreadBp !== null ? `${fmtFixed(book.spreadBp, 2)} bp` : DASH}</strong>
          </div>
          <div className="of-half">{bids.map((level, i) => renderLevel(level, 'bid', i + 1))}</div>
        </div>
      )}
    </section>
  );
}

function PinnedRead({ focus, store, clearFocus, refresh }: {
  focus: PinnedLevel; store: ProStore; clearFocus: () => void; refresh: () => void;
}) {
  const max = Math.max(1, focus.before ?? 0, focus.after ?? 0);
  const depth = (usd: number | null, time: number | null) => usd !== null ? dollars(usd)
    : time === null ? DASH : tr('Poza zasięgiem', 'Outside book range');
  const executionLabel = focus.side === 'ask' ? tr('Kupiono', 'Bought') : tr('Sprzedano', 'Sold');
  return (
    <div className="of-focus">
      <div className="of-focus-title">
        <Crosshair size={16} />
        <span>{focus.side === 'ask' ? 'Ask' : 'Bid'} <strong data-of-focus>{store.fmtPx(focus.price)}</strong></span>
        <button type="button" className="of-focus-refresh" onClick={refresh}>{tr('Odśwież', 'Refresh')}</button>
        <button type="button" onClick={clearFocus} aria-label={tr('Zwolnij przypiętą cenę', 'Unpin price')}><X size={18} /></button>
      </div>
      <dl className="of-focus-values">
        <div><dt>{tr('Było', 'Before')}</dt><dd>{depth(focus.before, focus.from)}</dd></div>
        <div><dt>{executionLabel}</dt><dd>{focus.executions ? dollars(focus.executions.usd) : DASH}</dd></div>
        <div><dt>{tr('Na końcu', 'After')}</dt><dd>{depth(focus.after, focus.through)}</dd></div>
      </dl>
      {focus.before !== null && focus.after !== null && (
        <div className="of-depth-compare" aria-hidden="true">
          <span style={{ width: `${100 * focus.after / max}%` }} />
          <i style={{ left: `calc(${100 * focus.before / max}% - 1px)` }} />
        </div>
      )}
      <div className="of-focus-time">
        <span>{exactTime(focus.from)} → {exactTime(focus.through)}</span>
        {focus.through !== null && focus.from !== null && <span>{fmtFixed((focus.through - focus.from) / 1000, 3)} s</span>}
      </div>
      {focus.from === null ? <p>{tr('Czekam na porównywalną parę migawek', 'Waiting for a comparable pair of snapshots')}</p>
        : !focus.executions ? <p>{tr('Niepełne pokrycie taśmy w tym odcinku', 'Incomplete tape coverage in this interval')}</p>
          : <p>{tr(`${focus.executions.count} wykonań`, `${focus.executions.count} trades`)}
            {focus.executions.count > PIN_TAPE_LIMIT && tr(` · poniżej ostatnie ${PIN_TAPE_LIMIT}`, ` · latest ${PIN_TAPE_LIMIT} below`)}</p>}
    </div>
  );
}

function TapePanel({ store, now, isLive, focus, clearFocus, refreshFocus, pro, activity }: {
  store: ProStore; now: number; isLive: boolean; focus: PinnedLevel | null; clearFocus: () => void; refreshFocus: () => void;
  pro: boolean; activity: Activity | null;
}) {
  const [side, setSide] = useState<'all' | 'buy' | 'sell'>('all');
  const [minimum, setMinimum] = useState(0);
  const intendedSide: Side | undefined = side === 'all' ? undefined : side === 'buy' ? 1 : -1;
  const filters = isHip3DeskFlow(store.coin) ? hip3TapeFilters(store.coin) : [0, 2_000, 10_000, 50_000, 200_000];
  const limit = pro ? 50 : 20;
  const trades = focus ? focus.executions?.rows ?? []
    : visibleExecutions(store.tape, now, minimum, limit, now - TAPE_VIEW_MS, intendedSide);
  return (
    <section className="of-card of-tape" aria-labelledby="of-tape-title">
      <header className="of-card-header">
        <div><h2 id="of-tape-title">{tr('Taśma wykonań', 'Trade tape')}</h2>
          <p>{focus ? tr('Wykonania z przypiętego odcinka', 'Trades in the pinned interval')
            : tr(`Ostatnie 5 min · do ${limit} wykonań`, `Last 5 min · up to ${limit} trades`)}</p></div>
        <span className="of-source">{focus ? tr('Przypięto', 'Pinned') : timeLabel(store.tape.lastTime)}</span>
      </header>
      {pro && !focus && <dl className="of-tape-balance">
        <div><dt>{tr('Kupiono w oknie', 'Bought in window')}</dt><dd className="of-buy" data-of-window-buy>{dollars(activity?.buyUsd)}</dd></div>
        <div><dt>{tr('Sprzedano w oknie', 'Sold in window')}</dt><dd className="of-sell" data-of-window-sell>{dollars(activity?.sellUsd)}</dd></div>
      </dl>}
      {focus ? <PinnedRead focus={focus} store={store} clearFocus={clearFocus} refresh={refreshFocus} /> : <div className="of-filters">
        <label>{tr('Strona', 'Side')}
          <select value={side} onChange={e => setSide(e.target.value as typeof side)}>
            <option value="all">{tr('Obie strony', 'Both sides')}</option>
            <option value="buy">{tr('Kupno', 'Buy')}</option>
            <option value="sell">{tr('Sprzedaż', 'Sell')}</option>
          </select>
        </label>
        <label>{tr('Nominał', 'Notional')}
          <select value={minimum} onChange={e => setMinimum(Number(e.target.value))}>
            {filters.map(value => <option value={value} key={value}>{value ? `≥ ${dollars(value)}` : tr('Wszystkie', 'All sizes')}</option>)}
          </select>
        </label>
      </div>}
      {!focus && !isLive && <p className="of-tape-stale">{tr('Taśma bez połączenia. Widać ostatnie odebrane wykonania.', 'Tape disconnected. Showing the last received trades.')}</p>}
      <div className="of-tape-table">
        <table>
          <thead><tr><th scope="col">{tr('Czas', 'Time')}</th><th scope="col">{tr('Agresor', 'Taker')}</th><th scope="col">{tr('Cena', 'Price')}</th>
            {pro && <th scope="col" className="of-trade-size">{tr('Ilość', 'Size')}</th>}<th scope="col">USD</th></tr></thead>
          <tbody>
            {trades.map(row => (
              <tr key={`${row.t}:${row.tid}`} data-of-trade-price={row.px} data-of-trade-side={row.side}>
                <td>{timeLabel(row.t)}</td>
                <td className={row.side === 1 ? 'of-buy' : 'of-sell'}>{row.side === 1 ? tr('↑ Kupno', '↑ Buy') : tr('↓ Sprz.', '↓ Sell')}</td>
                <td>{store.fmtPx(row.px)}</td>
                {pro && <td className="of-trade-size" title={fmtNum(row.sz)}>{fmtNum(row.sz)}</td>}
                <td title={fmtFixed(row.usd, 2)}>{row.usd >= 1000 ? fmtCompact(row.usd) : fmtFixed(row.usd, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!focus && trades.length === 0 && <p className="of-empty">{tr('Brak odebranych wykonań spełniających filtry', 'No received trades match the filters')}</p>}
      </div>
    </section>
  );
}

function FlowMarket({ coin, pro, momentOpen, closeMoment, mode, setMode }: {
  coin: string; pro: boolean; momentOpen: boolean; closeMoment: () => void; mode: DomMode; setMode: (mode: DomMode) => void;
}) {
  const store = storeFor(coin);
  useEffect(() => store.start(), [store]);
  useStoreVersion(store, 300);
  useNow(1_000);
  const now = Date.now();
  const [focus, setFocus] = useState<PinnedLevel | null>(null);
  const [proWindow, setProWindow] = useState(FLOW_WINDOW_MS);
  const [pin, setPin] = useState<{ to: number; sizeDecimals: number | undefined } | null>(null);
  const [capture, setCapture] = useState<{ pin: NonNullable<typeof pin>; result: DeltaMoment } | null>(null);
  const compareButton = useRef<HTMLButtonElement>(null);
  const windowMs = pro ? proWindow : FLOW_WINDOW_MS;
  const isLive = store.status === 'open' && store.coverage.isOpen;
  const history = store.exactBook();
  const latest = history?.latest() ?? null;
  const bookAge = latest ? store.liveBookAge(latest, now) : null;
  const bookFresh = store.status === 'open' && bookAge !== null && bookAge <= MAX_BOOK_AGE_MS;
  const frame = bookAge !== null && bookAge <= BOOK_HIDE_AFTER_MS ? latest : null;
  const previous = pro && history && frame ? referenceBook(history, frame.t, FLOW_WINDOW_MS, store.bookCoverage) : null;
  const book = frame ? bookMetrics(frame) : null;
  const activityThrough = Math.floor(now / 1_000) * 1_000;
  const activity = useMemo(() => isLive ? tradeActivity(store.tape, store.coverage, activityThrough - windowMs, activityThrough) : null,
    [store, isLive, activityThrough, windowMs]);
  useEffect(() => {
    if (!pro) { setPin(null); setCapture(null); return; }
    if (!pin) return;
    const abort = new AbortController();
    void readDeltaMoment(store.tape, store.coverage, pin.to, pin.sizeDecimals, abort.signal).then(result => {
      if (result && !abort.signal.aborted) setCapture({ pin, result });
    });
    return () => abort.abort();
  }, [pin, pro, store]);
  const pinned = pro ? pin : null;
  const refreshDelta = () => {
    setCapture(null);
    setPin({ to: activityThrough, sizeDecimals: store.szDecimals ?? deskMarketOf(coin)?.szDecimals });
  };
  const closeDelta = () => { setPin(null); setCapture(null); compareButton.current?.focus(); };
  const readLevel = (price: number, side: BookSide) => {
    const anchor = frame && bookFresh ? frame.t - PIN_MIN_MS : null;
    const earlier = anchor === null ? null : history?.range(anchor, anchor + 1).at(-1) ?? null;
    return captureLevel({ price, side, current: frame, previous: earlier, bookCoverage: store.bookCoverage, tape: store.tape, tapeCoverage: store.coverage });
  };
  const status = (
    <div className="of-status">
      <span className={isLive && bookFresh ? 'of-status-live' : undefined} data-of-status>
        <span className="of-status-dot" aria-hidden="true" />
        <strong>{deskMarketOf(coin)?.label ?? coin}</strong>{' · '}
        {isLive && bookFresh ? 'Hyperliquid · LIVE'
          : frame && bookAge !== null && !bookFresh
            ? tr(`Ostatnia migawka arkusza · ${Math.floor(bookAge / 1000)} s temu`, `Last book snapshot · ${Math.floor(bookAge / 1000)} s ago`)
            : tr('Czekam na świeży arkusz i taśmę', 'Waiting for fresh book and tape')}
      </span>
      {Number.isFinite(store.tape.lastPx) && <span>{tr('Ostatnie wykonanie', 'Last trade')} <strong>{store.fmtPx(store.tape.lastPx)}</strong></span>}
    </div>
  );
  return (
    <div data-of-market={coin}>
      {pro && status}
      {(!pro || momentOpen) && <MomentLens store={store} close={closeMoment} expanded={momentOpen} status={status} mode={mode} setMode={setMode} />}
      {pro && <>
        <SessionSummary book={book} activity={activity} store={store} windowMs={windowMs}
          coverageSeconds={Math.floor(store.coverage.coveredMs(activityThrough - windowMs, activityThrough) / 1000)}
          compare={pro ? { open: !!pinned, button: compareButton, toggle: pinned ? closeDelta : refreshDelta } : null} />
        <div className={pro ? 'of-grid of-grid-pro' : 'of-grid'}>
          {pinned && <DeltaMomentCard to={pinned.to} readout={capture?.pin === pinned ? capture.result : null} store={store}
            refresh={refreshDelta} close={closeDelta} />}
          <Ladder book={book} frame={frame} previous={previous} store={store} activity={activity} focus={focus}
            setFocus={(px, side) => setFocus(focus?.price === px && focus.side === side ? null : readLevel(px, side))}
            pro={pro} windowMs={windowMs} setWindowMs={setProWindow} />
          <TapePanel store={store} now={now} isLive={isLive} focus={focus} clearFocus={() => setFocus(null)} pro={pro} activity={activity}
            refreshFocus={() => { if (focus) setFocus(readLevel(focus.price, focus.side)); }} />
        </div>
        <p className="of-note">{tr(
          'Głębokość to widoczne zlecenia. Zmiana między migawkami pokazuje zmianę netto na cenie. Taśma liczy wyłącznie faktyczne wykonania.',
          'Depth measures visible orders. The change between snapshots is the net change at a price. The tape counts only actual trades.',
        )}</p>
      </>}
    </div>
  );
}

export default function OrderFlowView() {
  const coin = useSyncExternalStore(subscribeHash, readHash);
  const [pro, setPro] = useState(false);
  const [mode, setMode] = useState<DomMode>('memory');
  const [momentOpen, setMomentOpen] = useState(false);
  const momentButton = useRef<HTMLButtonElement>(null);
  const closeMoment = () => {
    setMomentOpen(false);
    momentButton.current?.focus();
  };
  return (
    <section className="of-desk" data-order-flow aria-labelledby="orderflow-title">
      <div className="of-page-heading">
        <SectionHeading id="orderflow-title" level={1} title="Order Flow" />
        <a href={`#charts?m=${encodeURIComponent(coin)}`} className="of-chart-link"><ChevronLeft size={16} aria-hidden="true" />{tr('Wykres', 'Chart')}</a>
        <div className="of-controls">
          <nav aria-label={tr('Rynki order flow', 'Order flow markets')}>
            {ORDER_FLOW_MARKETS.map(market => (
              <a key={market.coin} href={`#orderflow?m=${encodeURIComponent(market.coin)}`} aria-current={market.coin === coin ? 'page' : undefined}>{market.label}</a>
            ))}
          </nav>
          <button type="button" className="of-mode" aria-pressed={pro} onClick={() => setPro(value => !value)}><SlidersHorizontal size={15} aria-hidden="true" />Pro</button>
          <button type="button" className="of-mode of-moment-launch" ref={momentButton} aria-haspopup="dialog" aria-expanded={momentOpen} onClick={() => setMomentOpen(true)}><Crosshair size={15} aria-hidden="true" />{tr('Przekrój chwili', 'Moment lens')}</button>
        </div>
      </div>
      <FlowMarket key={coin} coin={coin} pro={pro} momentOpen={momentOpen} closeMoment={closeMoment} mode={mode} setMode={setMode} />
      <a className="of-link" href="https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions" target="_blank" rel="noreferrer">
        {tr('Źródło danych Hyperliquid', 'Hyperliquid data source')}<ArrowUpRight size={14} aria-hidden="true" />
      </a>
    </section>
  );
}
