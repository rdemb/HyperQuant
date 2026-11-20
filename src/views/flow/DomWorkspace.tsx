import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { locale, tr } from '../../i18n';
import { DASH } from '../../ui/format';
import { bookQuote, type readDomTrades } from './domWorkspaceModel';
import type { BookFrame } from '../../charts/pro/core/book';
import { NOMINAL_BANDS, amountsAt, priceDelta, type LensDelta, type PriceRead } from './momentLensModel';
import { formatAtoms, nominalUsd } from './LensPriceMatrix';
import { compactDomUsd } from './domDisplay';

export type DomMode = 'ladder' | 'memory' | 'trace';
const modes: readonly DomMode[] = ['ladder', 'memory', 'trace'];

const modeLabel = (mode: DomMode) => ({
  ladder: tr('Drabinka', 'Ladder'),
  memory: tr('Pamięć arkusza', 'Book memory'),
  trace: tr('Ślad transakcji', 'Trade trace'),
})[mode];

export function DomModeControls({ mode, select }: { mode: DomMode; select: (mode: DomMode) => void }) {
  return (
    <div className="dom-modes" role="group" aria-label={tr('Widok Order Flow', 'Order Flow view')}>
      {modes.map(view => <button type="button" key={view} aria-pressed={mode === view} onClick={() => select(view)}>{modeLabel(view)}</button>)}
    </div>
  );
}

const timestamp = new Intl.DateTimeFormat(locale, {
  hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, timeZone: 'UTC',
});
const shortTimestamp = new Intl.DateTimeFormat(locale, { hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' });
const bookNumber = new Intl.NumberFormat(locale, { maximumFractionDigits: 6 });
const PAGE_SIZE = 28;

function Measure({ value, text, compact, exact, side, max }: { value: number | null; text: string; compact: string; exact: string; side?: 'bid' | 'ask'; max: number }) {
  const className = side === 'bid' ? 'ml-bid' : side === 'ask' ? 'ml-ask' : '';
  const width = value === null ? 0 : 100 * Math.min(1, Math.abs(value) / max);
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);
  const lastFlash = useRef(-Infinity);
  useEffect(() => {
    const changed = previous.current !== value;
    previous.current = value;
    const now = performance.now();
    if (changed && value !== null && now - lastFlash.current >= 350 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      lastFlash.current = now;
      const animation = ref.current?.animate([{ outlineColor: 'currentColor' }, { outlineColor: 'transparent' }], { duration: 160 });
      return () => animation?.cancel();
    }
  }, [value]);
  return <span ref={ref} className={'dom-measure ' + className} data-missing={value === null || undefined} title={exact}>
    <span className="dom-fill" style={{ width: width + '%' }} aria-hidden="true" />
    <span className="dom-amount-wide">{value === null ? DASH : text}</span>
    <span className="dom-amount-compact">{value === null ? DASH : compact}</span>
  </span>;
}

function bookMeasure(value: number | null, max: number, signed = false, side?: 'bid' | 'ask') {
  const sign = signed && value ? (value < 0 ? '−' : '+') : '';
  const abs = Math.abs(value ?? 0);
  const digits = abs < 0.01 ? bookNumber.format(abs) : nominalUsd(BigInt(Math.round(abs * 1_000_000)));
  return <Measure value={value} text={sign + digits} compact={compactDomUsd(BigInt(Math.round((value ?? 0) * 1_000_000)), signed)} exact={value === null ? DASH : sign + bookNumber.format(Math.abs(value)) + ' USD'} side={side ?? (signed && value ? value < 0 ? 'ask' : 'bid' : undefined)} max={max} />;
}

function SnapshotHeading({ book, group }: { book: BookFrame | null; group: 'older' | 'recent' | 'both' }) {
  const time = book ? timestamp.format(book.t) : DASH;
  return <th scope="col" data-group={group} data-dom-snapshot={book?.t} title={time + ' UTC'}>
    <span className="dom-full-clock">{time}</span>
    <span className="dom-short-clock" aria-hidden="true">{book ? shortTimestamp.format(book.t) : DASH}</span>
    <small>UTC</small>
  </th>;
}

function tradeMeasure(value: bigint | null, max: number, signed = false, side?: 'bid' | 'ask') {
  const amount = value === null ? null : Number(value) / 1_000_000;
  const abs = value === null ? 0n : value < 0n ? -value : value;
  const sign = signed && value ? (value < 0 ? '−' : '+') : '';
  const digits = abs > 0n && abs < 10_000n ? formatAtoms(abs, 6) : nominalUsd(abs);
  return <Measure value={amount} text={sign + digits} compact={compactDomUsd(value ?? 0n, signed)} exact={value === null ? DASH : sign + formatAtoms(abs, 6) + ' USD'} side={side ?? (signed && value ? value < 0n ? 'ask' : 'bid' : undefined)} max={max} />;
}

const valueOf = (delta: LensDelta) => delta.kind === 'exact' ? delta.micros : null;

function BandGrid({ prices, point, activePrice, activeBand, pick, fmtPx, priceFirst }: {
  prices: number[]; point: { prices: PriceRead[]; covered: boolean };
  activePrice: number | null; activeBand: number | null; pick: (px: number, band: number | null) => void;
  fmtPx: (px: number) => string; priceFirst: boolean;
}) {
  const atPrice = new Map(point.prices.map(row => [row.px, row]));
  const rows = prices.map(px => ({
    px, deltas: NOMINAL_BANDS.map((_, band) => valueOf(priceDelta(atPrice.get(px), point.covered, band))),
  }));
  const largest = rows.reduce((max, row) => Math.max(max, ...row.deltas.map(v => Math.abs(Number(v ?? 0n)) / 1e6)), 1);
  const columns = priceFirst ? [null, 0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, null, 3, 4, 5, 6];
  return <table className="dom-grid dom-class-grid" aria-label={tr('Delta według ceny i nominału · 1 ms', 'Delta by price and notional · 1 ms')}>
    <thead><tr>{columns.map(band => band === null
      ? <th scope="col" className="dom-price" key="price">{tr('Cena', 'Price')}<small>USD</small></th>
      : <th scope="col" data-group={band < 4 ? "recent" : "older"} key={band}>{NOMINAL_BANDS[band]}<small>Δ USD</small></th>)}</tr></thead>
    <tbody>{rows.map(({ px, deltas }) => <tr key={px} data-dom-price={px} className={activePrice === px ? 'dom-selected' : undefined}>
      {columns.map(band => band === null
        ? <th className="dom-price" scope="row" key="price"><button type="button"
            aria-pressed={activePrice === px} onClick={() => pick(px, null)}>{fmtPx(px)}</button></th>
        : <td key={band} data-group={band < 4 ? "recent" : "older"}><button type="button" data-dom-band={band} aria-pressed={activePrice === px && activeBand === band}
            onClick={() => pick(px, band)}>
            <span className="sr-only">{fmtPx(px)} USD · {NOMINAL_BANDS[band]} · Δ </span>
            {tradeMeasure(deltas[band], largest, true)}
          </button></td>)}
    </tr>)}</tbody>
  </table>;
}

export function DomWorkspace({
  mode, books, trades, point, cursor, activePrice, activeBand, pickBand, pickPrice, pickDot, fmtPx, stale,
}: {
  mode: DomMode; books: readonly (BookFrame | null)[]; trades: ReturnType<typeof readDomTrades>;
  point: { prices: PriceRead[]; covered: boolean }; cursor: number; activePrice: number | null;
  activeBand: number | null; pickBand: (px: number, band: number | null) => void;
  pickPrice: (px: number) => void; pickDot: (time: number, px: number) => void; fmtPx: (px: number) => string; stale: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [showBands, setShowBands] = useState(false);
  const [priceFirst, setPriceFirst] = useState(false);
  const [olderColumns, setOlderColumns] = useState(false);
  const [higherBands, setHigherBands] = useState(false);
  const [pathOpen, setPathOpen] = useState(false);
  const columns = showBands ? higherBands : olderColumns;
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const body = scroll?.parentElement;
    if (!scroll || !body) return;
    const reveal = () => {
      const row = scroll.querySelector('tr.dom-selected');
      if (!row) return;
      const viewport = scroll.getBoundingClientRect();
      const target = row.getBoundingClientRect();
      const header = scroll.querySelector('thead')?.getBoundingClientRect().height ?? 0;
      if (target.top < viewport.top + header || target.bottom > viewport.bottom) {
        const center = (header + viewport.height - target.height) / 2;
        scroll.scrollTop += target.top - viewport.top - center;
      }
    };
    const fit = () => {
      setPriceFirst(body.getBoundingClientRect().width <= 499);
      reveal();
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(body);
    return () => resize.disconnect();
  }, [mode, activePrice, showBands, columns, priceFirst]);
  const frame = books.at(-1) ?? null;
  const prices = new Set<number>(point.covered ? point.prices.map(row => row.px) : []);
  for (const book of books) book?.px.forEach(price => prices.add(price));
  if (mode === 'trace') for (const [price, row] of trades.rows) {
    if (trades.coverage.slices.some((covered, index) => covered && row.sliceCounts[index] > 0)) prices.add(price);
  }
  if (activePrice !== null) prices.add(activePrice);
  const sorted = [...prices].sort((a, b) => b - a);
  const anchor = activePrice ?? frame?.px[0];
  const center = Math.max(0, anchor === undefined ? 0 : sorted.indexOf(anchor));
  const limit = Math.max(0, sorted.length - PAGE_SIZE);
  const start = Math.max(0, Math.min(limit, center - Math.floor(PAGE_SIZE / 2) + offset));
  const visible = sorted.slice(start, start + PAGE_SIZE);
  const pointAtPrice = new Map(point.prices.map(row => [row.px, row]));
  const depthMax = Math.max(1, ...books.flatMap(book => book ? Array.from(book.sz, (size, i) => size * book.px[i]) : []));
  const tapeMax = visible.reduce((max, price) => {
    const row = trades.rows.get(price);
    const instant = pointAtPrice.get(price);
    const values = [row?.volume, row?.recent, ...(row?.slices ?? []),
      amountsAt(instant, null, 'buy', point.covered)?.usd, amountsAt(instant, null, 'sell', point.covered)?.usd];
    return Math.max(max, ...values.map(value => Math.abs(Number(value ?? 0n) / 1_000_000)));
  }, 1);
  const priceHeading = <th scope="col" className="dom-price">{tr('Cena', 'Price')}<small>USD</small></th>;
  const title = modeLabel(mode);
  const bestBid = frame && frame.nBids > 0 ? frame.px[0] : null;
  const bestAsk = frame && frame.nBids < frame.px.length ? frame.px[frame.nBids] : null;
  let bid = 0;
  let ask = 0;
  frame?.px.forEach((price, index) => {
    const usd = price * frame.sz[index];
    if (index < frame.nBids) bid += usd;
    else ask += usd;
  });
  const bookBalance = balanceReadout(frame ? { buy: bid, sell: ask } : null, true);
  const tapeBalance = balanceReadout(trades.totals, false);
  return (
    <section className="dom-board" aria-label={title} data-dom-mode={mode} data-dom-bands={showBands || undefined} data-dom-columns={columns ? "older" : "recent"}>
      <header className="dom-board-head">
        <div><h2>{showBands ? tr('Klasy nominału', 'Notional bands') : title}</h2><small>{showBands
          ? tr('Delta klasy przy cenie · 1 ms', 'Class delta at each price · 1 ms') : mode === 'memory'
          ? tr('Cztery migawki L2 · od najstarszej do najnowszej', 'Four L2 snapshots · oldest to newest')
          : mode === 'trace' ? tr('Delta wykonań · cztery odcinki po 5 s do kursora', 'Trade delta · four 5 s intervals through the cursor')
            : tr('Głębokość L2, liczba zleceń i wykonania w 1 ms', 'L2 depth, order count and executions in 1 ms')}</small></div>
        <div className="dom-top-quote" aria-label={tr('Najlepsze ceny L2 przy kursorze', 'Best L2 prices at the cursor')}>
          <span className="ml-bid" data-dom-best-bid={bestBid ?? undefined}>BID <strong>{bestBid === null ? DASH : fmtPx(bestBid)}</strong></span>
          <span className="ml-ask" data-dom-best-ask={bestAsk ?? undefined}>ASK <strong>{bestAsk === null ? DASH : fmtPx(bestAsk)}</strong></span>
        </div>
        <div className="dom-column-controls" role="group" aria-label={tr('Kolumny tabeli', 'Table columns')}>
          <button type="button" aria-pressed={!columns} onClick={() => (showBands ? setHigherBands : setOlderColumns)(false)}>
            {showBands ? '< 100k' : mode === 'memory' ? tr('Najnowsze', 'Latest') : mode === 'ladder' ? 'BID' : '10–0 s'}
          </button>
          <button type="button" aria-pressed={columns} onClick={() => (showBands ? setHigherBands : setOlderColumns)(true)}>
            {showBands ? '≥ 100k' : mode === 'memory' ? tr('Starsze', 'Earlier') : mode === 'ladder' ? 'ASK' : '20–10 s'}
          </button>
        </div>
        <div className="dom-page">
          <button type="button" aria-pressed={showBands} onClick={() => setShowBands(value => !value)}>
            {showBands ? tr('Wróć do układu', 'Back to layout') : tr('7 klas', '7 bands')}
          </button>
          <button type="button" disabled={start === 0} aria-label={tr('Wyższe ceny', 'Higher prices')} onClick={() => setOffset(start - center + Math.floor(PAGE_SIZE / 2) - PAGE_SIZE)}>↑</button>
          <button type="button" disabled={!offset} onClick={() => setOffset(0)}>{tr('Do ceny', 'To price')}</button>
          <button type="button" disabled={start === limit} aria-label={tr('Niższe ceny', 'Lower prices')} onClick={() => setOffset(start - center + Math.floor(PAGE_SIZE / 2) + PAGE_SIZE)}>↓</button>
        </div>
      </header>
      <div className="dom-board-body">
        <div className="dom-balances">
          <Balance label="L2" readout={bookBalance} />
          <Balance label="120 s" readout={tapeBalance} />
        </div>
        <div ref={scrollRef} className="dom-grid-scroll" tabIndex={0} role="region" aria-label={tr('Tabela cen w USD', 'Price table in USD')}>
          {showBands ? <BandGrid prices={visible} point={point} activePrice={activePrice} activeBand={activeBand} pick={pickBand} fmtPx={fmtPx} priceFirst={priceFirst} /> : <table className="dom-grid">
            <thead><tr>
              {priceFirst && priceHeading}
              {mode !== 'trace' && <th scope="col" className="dom-extra">{tr('Profil', 'Profile')}<small>{tr('Obrót 120 s', '120 s volume')}</small></th>}
              {mode === 'memory' && books.slice(0, -1).map((book, i) => <SnapshotHeading key={i} book={book} group={i < 2 ? "older" : "both"} />)}
              {mode === 'ladder' && <><th scope="col" className="dom-bids" data-group="recent">Bid<small>USD / n</small></th><th scope="col" data-group="recent">{tr('↓ Sprz.', '↓ Sell')}<small>1 ms</small></th></>}
              {mode === 'trace' && <><th scope="col" data-group="older">20–15 s</th><th scope="col" data-group="older">15–10 s</th></>}
              {!priceFirst && priceHeading}
              {mode === 'memory' && <>
                <SnapshotHeading book={frame} group="recent" />
                <th scope="col" className="dom-book-change">Δ L2<small>{tr('netto USD', 'net USD')}</small></th>
                <th scope="col" className="dom-extra dom-bids">Bid<small>USD</small></th><th scope="col" className="dom-extra dom-asks">Ask<small>USD</small></th>
                <th scope="col" className="dom-extra">{tr('Ślad', 'Trace')}<small>{tr('Ostatnie 2 s', 'Last 2 s')}</small></th>
              </>}
              {mode === 'ladder' && <><th scope="col" data-group="older">{tr('↑ Kup.', '↑ Buy')}<small>1 ms</small></th><th scope="col" className="dom-asks" data-group="older">Ask<small>USD / n</small></th></>}
              {mode === 'trace' && <><th scope="col" data-group="recent">10–5 s</th><th scope="col" data-group="recent">5–0 s</th></>}
              <th scope="col" className={mode === 'memory' ? 'dom-extra' : undefined}>Δ {tr('ceny', 'price')}<small>1 ms</small></th>
            </tr></thead>
            <tbody>{visible.map(px => {
              const row = trades.rows.get(px);
              const instant = pointAtPrice.get(px);
              const quotes = books.map(book => bookQuote(book, px));
              const latest = quotes.at(-1);
              const previous = quotes.at(-2);
              const selected = px === activePrice;
              const delta = latest && previous ? latest.bid - latest.ask - (previous.bid - previous.ask) : null;
              const slice = (i: number) => tradeMeasure(trades.coverage.slices[i] && !row?.missingSlices.has(i) ? row?.slices[i] ?? 0n : null, tapeMax, true);
              const depth = (side: 'bid' | 'ask', orders: number | null) => <div className="dom-depth">
                {bookMeasure(latest?.[side] ?? null, depthMax, false, side)}
                {mode === 'ladder' && <small title={tr('Liczba zleceń', 'Order count')}>{orders ?? DASH}</small>}
              </div>;
              const price = <th scope="row" className="dom-price"><button type="button" data-of-level={frame ? px : undefined} aria-pressed={selected}
                aria-label={tr('Wybierz cenę ', 'Select price ') + fmtPx(px) + ' USD'} onClick={() => { setOffset(0); pickPrice(px); }}>{fmtPx(px)}</button></th>;
              return <tr key={px} className={selected ? 'dom-selected' : undefined} data-dom-price={px}>
                {priceFirst && price}
                {mode !== 'trace' && <td className="dom-extra">{tradeMeasure(trades.coverage.volume && !row?.missingVolume ? row?.volume ?? 0n : null, tapeMax)}</td>}
                {mode === 'memory' && quotes.slice(0, -1).map((quote, i) => <td key={i} data-group={i < 2 ? 'older' : 'both'}>{bookMeasure(quote ? quote.bid - quote.ask : null, depthMax, true)}</td>)}
                {mode === 'ladder' && <><td className="dom-bids" data-group="recent">{depth('bid', latest?.bidOrders ?? null)}</td><td data-group="recent">{tradeMeasure(amountsAt(instant, null, 'sell', point.covered)?.usd ?? null, tapeMax, false, 'ask')}</td></>}
                {mode === 'trace' && <><td data-group="older">{slice(0)}</td><td data-group="older">{slice(1)}</td></>}
                {!priceFirst && price}
                {mode === 'memory' && <>
                  <td data-group="recent">{bookMeasure(latest ? latest.bid - latest.ask : null, depthMax, true)}</td>
                  <td className="dom-book-change">{bookMeasure(delta, depthMax, true)}</td>
                  <td className="dom-extra dom-bids">{depth('bid', null)}</td><td className="dom-extra dom-asks">{depth('ask', null)}</td>
                  <td className="dom-extra">{tradeMeasure(trades.coverage.recent && !row?.missingRecent ? row?.recent ?? 0n : null, tapeMax, true)}</td>
                </>}
                {mode === 'ladder' && <><td data-group="older">{tradeMeasure(amountsAt(instant, null, 'buy', point.covered)?.usd ?? null, tapeMax, false, 'bid')}</td><td className="dom-asks" data-group="older">{depth('ask', latest?.askOrders ?? null)}</td></>}
                {mode === 'trace' && <><td data-group="recent">{slice(2)}</td><td data-group="recent">{slice(3)}</td></>}
                <td className={mode === 'memory' ? 'dom-extra' : undefined}>{tradeMeasure(valueOf(priceDelta(instant, point.covered)), tapeMax, true)}</td>
              </tr>;
            })}</tbody>
          </table>}
          {!visible.length && <p className="dom-empty">{tr('Czekam na ceny z publicznego strumienia Hyperliquid.', 'Waiting for prices from the public Hyperliquid stream.')}</p>}
        </div>
      </div>
      <footer className="dom-board-foot">
        <span>{frame ? 'L2 ' + timestamp.format(frame.t) + ' UTC · ' + bookNumber.format((cursor - frame.t) / 1000) + ' s'
          : tr('L2 · brak migawki do kursora', 'L2 · no snapshot through the cursor')}</span>
        {stale && <span>{tr('Brak świeżego L2', 'Fresh L2 unavailable')}</span>}
        <span title={tr('Brak pokrycia, pomiaru lub precyzji', 'Missing coverage, observation or precision')}>
          {tr('— brak danych', '— missing data')}
        </span>
        <button type="button" className="dom-path-toggle" aria-expanded={pathOpen} onClick={() => setPathOpen(value => !value)}>
          {tr('Ścieżka 20 s', '20 s path')}
        </button>
        <details className="dom-level-detail">
          <summary>{tr('Dokładny poziom', 'Exact level')}</summary>
          <dl>
            <div><dt>{tr('Widoczna głębokość L2', 'Visible L2 depth')}</dt><dd data-dom-share="book">{bookBalance.text}</dd></div>
            <div><dt>{tr('Udział obrotu · 120 s', 'Volume share · 120 s')}</dt><dd data-dom-share="tape">{tapeBalance.text}</dd></div>
            {activePrice !== null && <LevelReadout px={activePrice} books={books} mode={mode} rows={trades}
              point={pointAtPrice.get(activePrice)} covered={point.covered} fmtPx={fmtPx} />}
          </dl>
        </details>
      </footer>
      <TradePath trades={trades} pick={pickDot} fmtPx={fmtPx} expanded={pathOpen} />
    </section>
  );
}

function balanceReadout(totals: { buy: number; sell: number } | null, bidAsk: boolean) {
  if (!totals) return { top: null, text: DASH };
  const total = totals.buy + totals.sell;
  if (total === 0) return { top: null, text: bidAsk
    ? tr('Brak widocznej głębokości', 'No visible depth') : tr('Brak obrotu', 'No trades') };
  const top = Math.round(100 * totals.sell / total);
  const text = (bidAsk ? 'ASK ' : tr('Sprzedaż ', 'Sell ')) + top + '% / '
    + (bidAsk ? 'BID ' : tr('Kupno ', 'Buy ')) + (100 - top) + '%';
  return { top, text };
}

function Balance({ label, readout }: { label: string; readout: ReturnType<typeof balanceReadout> }) {
  const { top, text } = readout;
  const description = label + ' · ' + text;
  return <div className="dom-balance" title={description} role="img" aria-label={description}>
    <small>{label}</small>
    <span className="dom-share ml-ask" aria-hidden="true">{top === null ? DASH : top + '%'}</span>
    <div className="dom-balance-bar" data-empty={top === null || undefined}>
      {top !== null && <><span style={{ height: top + '%' }} /><span style={{ height: 100 - top + '%' }} /></>}
    </div>
    <span className="dom-share ml-bid" aria-hidden="true">{top === null ? DASH : 100 - top + '%'}</span>
  </div>;
}

// Jeden rzeczywisty punkt na 0,5 s, z dostępem do ceny i milisekundy.
function TradePath({ trades, pick, fmtPx, expanded }: {
  trades: ReturnType<typeof readDomTrades>; pick: (time: number, px: number) => void; fmtPx: (px: number) => string; expanded: boolean;
}) {
  const { dots, traceFrom, to, spans } = trades;
  const x = (t: number) => (t - traceFrom) / (to - traceFrom);
  const lo = Math.min(...dots.map(dot => dot.px));
  const hi = Math.max(...dots.map(dot => dot.px));
  const y = (price: number) => hi === lo ? 50 : 90 - 80 * (price - lo) / (hi - lo);
  return (
    <section className="dom-path" data-expanded={expanded} aria-label={tr('Ścieżka wykonań z 20 sekund', '20-second execution path')}>
      <header><h3>{tr('Ścieżka wykonań', 'Execution path')} · 20 s</h3>
        <small>{tr('Do 1 wykonania na 0,5 s', 'Up to 1 fill per 0.5 s')}</small></header>
      <div className="dom-plot">
        {spans.map(([a, b]) => <i key={a} className="dom-plot-span" aria-hidden="true" style={{ left: x(a) * 100 + '%', width: (x(b) - x(a)) * 100 + '%' }} />)}
        {dots.map(dot => <button key={dot.time} type="button" className={dot.side === 1 ? 'ml-bid' : 'ml-ask'}
          style={{ left: 3 + 94 * x(dot.time) + '%', top: y(dot.px) + '%' }}
          title={timestamp.format(dot.time) + ' UTC · ' + fmtPx(dot.px) + ' USD'}
          aria-label={(dot.side === 1 ? tr('Kupno', 'Buy') : tr('Sprzedaż', 'Sell')) + ' · ' + timestamp.format(dot.time) + ' UTC · ' + fmtPx(dot.px) + ' USD'}
          onClick={() => pick(dot.time, dot.px)}>{dot.side === 1 ? '↑' : '↓'}</button>)}
        {!dots.length && <span className="dom-path-empty">{spans.length ? tr('Brak odebranych wykonań', 'No received executions') : tr('Brak pokrycia', 'No coverage')}</span>}
      </div>
    </section>
  );
}

function LevelReadout({ px, books, mode, rows, point, covered, fmtPx }: {
  px: number; books: readonly (BookFrame | null)[]; mode: DomMode;
  rows: ReturnType<typeof readDomTrades>; point: PriceRead | undefined; covered: boolean; fmtPx: (px: number) => string;
}) {
  const exactBook = (value: number | null) => value === null ? DASH
    : (value > 0 ? '+' : '') + bookNumber.format(value) + ' USD';
  const exactTrade = (value: bigint | null, signed = true) => value === null ? DASH
    : (value > 0n && signed ? '+' : value < 0n ? '−' : '') + formatAtoms(value < 0n ? -value : value, 6) + ' USD';
  const tradeRow = rows.rows.get(px);
  const current = bookQuote(books.at(-1) ?? null, px);
  const previous = bookQuote(books.at(-2) ?? null, px);
  const profile = rows.coverage.volume && !tradeRow?.missingVolume ? tradeRow?.volume ?? 0n : null;
  const recent = rows.coverage.recent && !tradeRow?.missingRecent ? tradeRow?.recent ?? 0n : null;
  return <>
    <div><dt>{tr('Cena', 'Price')}</dt><dd>{fmtPx(px)} USD</dd></div>
    {mode === 'memory' && books.map((book, i) => {
      const quote = bookQuote(book, px);
      return <div key={i}><dt>{book ? timestamp.format(book.t) + ' UTC' : 'L2 · ' + DASH}</dt>
        <dd>{exactBook(quote ? quote.bid - quote.ask : null)}</dd></div>;
    })}
    {mode === 'memory' && <div><dt>Δ L2</dt><dd>{exactBook(current && previous ? current.bid - current.ask - previous.bid + previous.ask : null)}</dd></div>}
    {mode !== 'trace' && <div><dt>{tr('Obrót 120 s', '120 s volume')}</dt><dd>{exactTrade(profile, false)}</dd></div>}
    {mode === 'memory' && <div><dt>{tr('Ślad · 2 s', 'Trace · 2 s')}</dt><dd>{exactTrade(recent)}</dd></div>}
    {mode === 'ladder' && <>
      <div><dt>BID</dt><dd>{current ? bookNumber.format(current.bid) + ' USD' : DASH}</dd></div>
      <div><dt>ASK</dt><dd>{current ? bookNumber.format(current.ask) + ' USD' : DASH}</dd></div>
      <div><dt>{tr('Kupiono · 1 ms', 'Bought · 1 ms')}</dt><dd>{exactTrade(amountsAt(point, null, 'buy', covered)?.usd ?? null, false)}</dd></div>
      <div><dt>{tr('Sprzedano · 1 ms', 'Sold · 1 ms')}</dt><dd>{exactTrade(amountsAt(point, null, 'sell', covered)?.usd ?? null, false)}</dd></div>
    </>}
    {mode === 'trace' && ['20–15 s', '15–10 s', '10–5 s', '5–0 s'].map((name, i) => <div key={name}>
      <dt>{name}</dt><dd>{exactTrade(rows.coverage.slices[i] && !tradeRow?.missingSlices.has(i) ? tradeRow?.slices[i] ?? 0n : null)}</dd>
    </div>)}
    <div><dt>Δ · 1 ms</dt><dd>{exactTrade(valueOf(priceDelta(point, covered)))}</dd></div>
  </>;
}
