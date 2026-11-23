import { type ReactNode, useEffect, useState } from 'react';
import { deskMarketOf, marketLabel } from '../../config/deskMarkets';
import { markOracleBp, oracleLive } from '../../charts/pro/core/premium';
import { DAY, fmtHms } from '../../charts/pro/core/time';
import type { ProStore } from '../../charts/pro/store/proStore';
import { requestHistory } from '../../charts/pro/store/serverHistory';
import { usePublishedHistory } from '../../state/historyAvailability';
import { useStoreVersion } from '../../charts/pro/store/useStoreVersion';
import { replayHashCore } from '../../charts/pro/replay/hashCore';
import { locale, tr } from '../../i18n';
import { DASH, fmtCompact, fmtFixed, fmtSigned } from '../../ui/format';
import { bookMetrics, executionWindow, hip3TapeFilters, topBookDepth, visibleExecutions } from './hip3Flow';
import { motywWykresu } from '../../charts/paleta';

const STALE_MS = 30_000;
const ROW_LIMIT = 160;
const HOUR_MS = DAY / 24;
const MINUTE_MS = 60_000;
const FUNDING_GRACE_MS = 5 * MINUTE_MS;
const TAPE_WINDOWS = [1, 5, 15];
const grid = 'grid grid-cols-[minmax(3rem,1.05fr)_minmax(3rem,1fr)_minmax(2.9rem,1fr)_minmax(3.3rem,1fr)] gap-x-1.5 px-2 items-center';
const domGrid = 'grid grid-cols-[minmax(3rem,1.05fr)_minmax(2.65rem,1fr)_minmax(1.5rem,.45fr)_minmax(2.8rem,1fr)_minmax(3.15rem,1fr)] gap-x-1.5 px-2 items-center';
const headers = `${grid} py-1.5 text-[10px] text-ink-3 [&>:not(:first-child)]:text-right`;

const num = (v: number, digits = 2) => Number.isFinite(v) ? fmtFixed(v, digits).replace(/([,.]\d*?)0+$/, '$1').replace(/[,.]$/, '') : DASH;
const dollars = (v: number) => Number.isFinite(v) ? `${fmtCompact(v)} USD` : DASH;
const timeRange = (a: number, b: number) => {
  const stamp = (t: number) => new Date(t).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `${stamp(a)} – ${stamp(b)}`;
};

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0 rounded-md bg-surface-2 px-2 py-1.5">
    <dt className="text-[10px] leading-4 text-ink-3">{label}</dt>
    <dd className="font-mono text-xs tabular-nums text-ink-1">{children}</dd>
  </div>;
}

export type Hip3FlowTab = 'tape' | 'dom' | 'market';

export function Hip3PublicFlow({ store, tab, onTab, mobile = false }: {
  store: ProStore; tab: Hip3FlowTab; onTab: (tab: Hip3FlowTab) => void; mobile?: boolean;
}) {
  useStoreVersion(store, 350);
  const [, setClock] = useState(0);
  const [minimum, setMinimum] = useState(0);
  const [windowMinutes, setWindowMinutes] = useState(1);
  const [tradeSide, setTradeSide] = useState<'all' | 'buy' | 'sell'>('all');
  const replay = store.replay !== null;
  useEffect(() => {
    if (store.replay) return;
    requestHistory(store, store.serverNow() - HOUR_MS);
    const timer = setInterval(() => setClock(now => now + 1), 1000);
    return () => clearInterval(timer);
  }, [store]);
  useEffect(() => {
    if (tab === 'market' && !store.replay) void store.requestFunding(store.serverNow() - DAY);
  }, [store, tab]);

  const now = store.serverNow();
  const open = store.status === 'open';
  const exactHistory = store.exactBook();
  const nearHistory = store.book('near');
  const exact = exactHistory?.latest();
  const near = nearHistory?.latest();
  const precise = !!exact && (now - exact.t <= STALE_MS || !near || exact.t >= near.t);
  const frame = precise ? exact : near;
  const bookGap = !!frame && replay && (!store.replayBookCovered || (now > frame.t && !store.bookCoverage.covers(frame.t, now)));
  const book = frame && !bookGap ? bookMetrics(frame) : null;
  const bookStale = !!frame && (bookGap || (!replay && !open) || now - frame.t > STALE_MS);
  const market = deskMarketOf(store.coin);
  const size = (v: number) => num(v, market?.szDecimals ?? 5);
  const price = (v: number) => v > 0 ? store.fmtPx(v) : DASH;
  const filters = hip3TapeFilters(store.coin);
  const minUsd = filters.includes(minimum) ? minimum : 0;
  const from = now - windowMinutes * MINUTE_MS;
  const side = tradeSide === 'all' ? undefined : tradeSide === 'buy' ? 1 : -1;
  const executions = tab === 'tape' ? visibleExecutions(store.tape, Math.ceil(now) - 1, minUsd, ROW_LIMIT, from, side) : [];
  const largest = Math.max(0, ...executions.map(fill => fill.usd));
  const last = Number.isFinite(store.tape.lastTime) ? store.tape.lastTime : null;
  const tradeFresh = last !== null && now - last < 60_000;
  const summary = tab === 'tape' && (open || replay) ? executionWindow(store.tape, store.coverage, from, now) : null;
  const coveredSeconds = Math.floor(store.coverage.coveredMs(from, now) / 1_000);
  const depthNow = bookStale ? null : topBookDepth(book);
  let depthChange: number | null = null;
  if (tab === 'dom' && frame && depthNow) {
    const at = frame.t - MINUTE_MS;
    const previous = (precise ? exactHistory : nearHistory)?.range(at, at + 1).at(-1);
    const continuous = previous && (!replay || store.bookCoverage.covers(previous.t, frame.t));
    const depthBefore = continuous && at - previous.t <= STALE_MS ? topBookDepth(bookMetrics(previous)) : null;
    if (depthBefore) depthChange = 100 * (depthNow.total / depthBefore.total - 1);
  }
  const history = usePublishedHistory(store.coin);
  const ctx = replay ? null : store.ctx;
  const recorded = store.recordedContext;
  const ctxAt = recorded?.t ?? store.ctxReceivedAt;
  const ctxStale = (ctx || recorded) && (Number.isNaN(ctxAt) || (!replay && !open) || now - ctxAt > (replay ? MINUTE_MS : STALE_MS));
  const oi = recorded?.oi ?? ctx?.openInterest;
  const mark = recorded?.mark ?? ctx?.markPx;
  const oiUsd = oi !== undefined && oi >= 0 && mark !== undefined ? oi * mark : Number.NaN;
  const oiBefore = tab === 'market' && ctx && !ctxStale ? store.oi.atWithin(ctxAt - 5 * MINUTE_MS, STALE_MS) : null;
  const oiChange = ctx && oiBefore !== null && ctx.openInterest >= 0 ? ctx.openInterest - oiBefore : null;
  const oracleTracked = replay || oracleLive(store.coin, now);
  const basis = ctx && oracleTracked ? markOracleBp(ctx.markPx, ctx.oraclePx) : null;
  const lastFunding = !replay && Number.isFinite(store.funding.latest) ? store.funding.latest : null;
  const settled = lastFunding === null ? null : store.funding.rate(lastFunding, HOUR_MS, now, null);
  const settlementTime = lastFunding === null ? null : lastFunding + HOUR_MS;
  const fundingStale = settlementTime !== null && now - settlementTime >= HOUR_MS + FUNDING_GRACE_MS;
  const funding = (rate: number | null | undefined) => rate !== null && rate !== undefined && Number.isFinite(rate) ? fmtSigned(rate * 100, 5, '%') : DASH;
  const bid = book?.bids[0], ask = book?.asks[0];
  const tabs: { id: Hip3FlowTab; label: string }[] = [
    { id: 'tape', label: tr('Wykonania', 'Trades') }, { id: 'dom', label: 'DOM' }, { id: 'market', label: tr('Rynek', 'Market') },
  ];

  function depth(side: NonNullable<typeof book>['bids'], selling: boolean) {
    const total = side.at(-1);
    return <div className="flex shrink-0 flex-wrap justify-between gap-x-2 border-t border-line px-2 py-1.5 text-[10px] text-ink-2">
      <span className={selling ? 'text-sell-ink' : 'text-buy-ink'}>{selling ? tr('Ask · sprzedaż', 'Ask · sell') : tr('Bid · kupno', 'Bid · buy')}</span>
      {total ? <span>{side.length} {tr('poz.', 'levels')} · {size(total.totalSize)} · {dollars(total.totalUsd)}</span> : <span>{tr('Pusta strona', 'Empty side')}</span>}
    </div>;
  }

  function ladder(side: NonNullable<typeof book>['bids'], selling: boolean) {
    const high = Math.max(0, ...side.map(level => level.usd));
    const levels = selling ? [...side].reverse() : side;
    return <div data-hip3-book-side={selling ? 'ask' : 'bid'}>
      {levels.map(level => <div key={level.px} data-hip3-level={level.px} className={`${domGrid} relative min-h-6 font-mono text-[11px] tabular-nums`}>
        <span aria-hidden="true" className={`absolute inset-y-px right-0 ${selling ? 'bg-sell/15' : 'bg-buy/15'}`} style={{ width: `${high > 0 ? 100 * level.usd / high : 0}%` }} />
        <span className={`relative ${selling ? 'text-sell-ink' : 'text-buy-ink'}`}>{price(level.px)}</span>
        <span className="relative text-right">{size(level.size)}</span>
        <span data-hip3-orders className="relative text-right text-ink-2"><span className="sr-only">{tr('Liczba zleceń', 'Order count')} </span>{Number.isFinite(level.orders) ? level.orders : DASH}</span>
        <span className="relative text-right" title={fmtFixed(level.usd, 2)}>{fmtCompact(level.usd)}</span>
        <span className="relative text-right text-ink-3" title={fmtFixed(level.totalUsd, 2)}>{fmtCompact(level.totalUsd)}</span>
      </div>)}
    </div>;
  }

  return <section data-hip3-flow={store.coin} data-hip3-mobile={mobile || undefined} data-theme={motywWykresu()} aria-label={tr('Dane kontraktu HIP-3', 'HIP-3 contract data')}
    className={`min-w-0 flex flex-col bg-surface-1 text-ink-1 ${mobile ? 'my-2 rounded-xl border border-line' : 'h-full min-h-0'}`}>
    <header className="shrink-0 px-2.5 pt-2">
      <div className="flex items-center justify-between gap-1 text-xs">
        <strong>{marketLabel(store.coin)} · HIP-3</strong>
        <span className={`text-[10px] ${open || replay ? 'text-ink-3' : 'text-warn'}`}>{replay ? tr('Hyperliquid · nagranie', 'Hyperliquid · recording') : open ? 'Hyperliquid · LIVE' : tr('Hyperliquid · łączenie', 'Hyperliquid · connecting')}</span>
      </div>
      <div data-hip3-bbo className="mt-1 grid grid-cols-3 gap-1 text-[11px] leading-4">
        <span className="font-mono text-buy-ink">Bid {bid ? price(bid.px) : DASH}</span>
        <span className="font-mono text-sell-ink">Ask {ask ? price(ask.px) : DASH}</span>
        <span className="text-right text-ink-3">{bookStale ? tr('Stara migawka', 'Old snapshot') : book?.spreadBp != null ? `${num(book.spreadBp)} bp` : DASH}</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1">
        {tabs.map(item => <button key={item.id} type="button" aria-pressed={tab === item.id} onClick={() => onTab(item.id)}
          className={`rounded-md border px-1 text-xs ${mobile ? 'min-h-11' : 'min-h-8'} ${tab === item.id ? 'border-line-strong bg-surface-3' : 'border-line text-ink-2 hover:bg-surface-2'}`}>{item.label}</button>)}
      </div>
    </header>

    {tab === 'tape' && <div className="flex min-h-0 flex-1 flex-col" data-hip3-tape>
      <div className="flex flex-wrap items-center justify-between gap-1 px-2.5 py-2 text-[11px] text-ink-2">
        <span>{last === null ? tr('Czekam na wykonania', 'Waiting for trades') : !open ? tr('Ostatnie zapisane', 'Last recorded') : tradeFresh ? tr('Ostatnie wykonanie', 'Latest trade') : tr('Brak nowych wykonań od', 'No new trades since')}{last === null ? '' : ` ${fmtHms(last)}`}</span>
        <select aria-label={tr('Okno taśmy', 'Tape window')} value={windowMinutes} onChange={event => setWindowMinutes(Number(event.target.value))}
          className={`rounded-md border border-line bg-surface-2 px-2 text-xs ${mobile ? 'min-h-11' : 'min-h-8'}`}>
          {TAPE_WINDOWS.map(minutes => <option key={minutes} value={minutes}>{minutes} min</option>)}
        </select>
      </div>
      <dl className="mb-1 grid grid-cols-3 gap-1 px-2">
        <Metric label={tr('Wykonania', 'Trades')}>{summary?.count ?? DASH}</Metric>
        <Metric label={tr('Obrót', 'Turnover')}>{summary ? dollars(summary.turnoverUsd) : DASH}</Metric>
        <Metric label={tr('Delta netto USD', 'Net delta USD')}>{summary ? (summary.deltaUsd > 0 ? '+' : '') + fmtCompact(summary.deltaUsd) : DASH}</Metric>
        <Metric label={tr('Kupno agresywne', 'Taker buy')}>{summary ? dollars(summary.buyUsd) : DASH}</Metric>
        <Metric label={tr('Sprzedaż agresywna', 'Taker sell')}>{summary ? dollars(summary.sellUsd) : DASH}</Metric>
        <Metric label="VWAP USD">{price(summary?.vwap ?? 0)}</Metric>
      </dl>
      {!summary && <p className="px-2 pb-1 text-[10px] text-warn">{tr('Pokrycie taśmy', 'Tape coverage')} {coveredSeconds}/{windowMinutes * 60} s{!replay && !open && ` · ${tr('Strumień rozłączony', 'Stream disconnected')}`}</p>}
      <div className="flex flex-wrap gap-1.5 px-2 pb-1.5">
        <select aria-label={tr('Strona wykonania', 'Trade side')} value={tradeSide}
          onChange={event => setTradeSide(event.target.value === 'buy' ? 'buy' : event.target.value === 'sell' ? 'sell' : 'all')}
          className={`rounded-md border border-line bg-surface-2 px-2 text-xs ${mobile ? 'min-h-11' : 'min-h-8'}`}>
          <option value="all">{tr('Kupno i sprzedaż', 'Buy and sell')}</option>
          <option value="buy">{tr('Kupno', 'Buy')}</option>
          <option value="sell">{tr('Sprzedaż', 'Sell')}</option>
        </select>
        <select aria-label={tr('Minimalny nominał wykonania', 'Minimum trade notional')} value={minUsd} onChange={event => setMinimum(Number(event.target.value))}
          className={`rounded-md border border-line bg-surface-2 px-2 text-xs ${mobile ? 'min-h-11' : 'min-h-8'}`}>
          {filters.map(v => <option key={v} value={v}>{v ? `≥ ${dollars(v)}` : tr('Wszystkie nominały', 'All sizes')}</option>)}
        </select>
      </div>
      <div className={`min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin] ${mobile ? 'max-h-64' : ''}`}>
        {!!summary?.profile.length && <details className="border-t border-line px-2 py-1.5 text-xs">
          <summary className="cursor-pointer text-ink-2">{tr('Profil wolumenu · największy obrót wg ceny', 'Volume profile · highest turnover by price')}</summary>
          <div className="mt-1 grid grid-cols-3 gap-1 tabular-nums">
            <span>{tr('Cena', 'Price')}</span><span className="text-right text-buy-ink">{tr('Kupno USD', 'Buy USD')}</span><span className="text-right text-sell-ink">{tr('Sprzedaż USD', 'Sell USD')}</span>
            {summary.profile.map(level => <div key={level.px} className="contents font-mono">
              <span>{price(level.px)}</span><span className="text-right">{fmtCompact(level.buyUsd)}</span><span className="text-right">{fmtCompact(level.sellUsd)}</span>
            </div>)}
          </div>
        </details>}
        <div className={`${headers} border-y border-line`}><span>{tr('Czas', 'Time')}</span><span>{tr('Cena', 'Price')}</span><span>{tr('Ilość', 'Size')}</span><span>USD</span></div>
        {executions.map(fill => <div key={`${fill.t}|${fill.tid}`} data-hip3-trade={fill.t} data-hip3-side={fill.side === 1 ? 'buy' : 'sell'}
          className={`${grid} relative min-h-6 font-mono text-[11px] tabular-nums`}>
          <span aria-hidden="true" className={`absolute inset-y-px right-0 ${fill.side === 1 ? 'bg-buy/15' : 'bg-sell/15'}`} style={{ width: `${largest > 0 ? 100 * fill.usd / largest : 0}%` }} />
          <span className="relative text-ink-3">{fmtHms(fill.t)}</span>
          <span className={`relative text-right whitespace-nowrap ${fill.side === 1 ? 'text-buy-ink' : 'text-sell-ink'}`} aria-label={`${fill.side === 1 ? tr('Kupno', 'Buy') : tr('Sprzedaż', 'Sell')} ${price(fill.px)}`}>
            <span aria-hidden="true">{fill.side === 1 ? '↑ ' : '↓ '}</span>{price(fill.px)}
          </span>
          <span className="relative text-right">{size(fill.sz)}</span>
          <span className="relative text-right" title={fmtFixed(fill.usd, 2)}>{fill.usd < 1000 ? num(fill.usd) : fmtCompact(fill.usd)}</span>
        </div>)}
        {executions.length === 0 && <p className="p-2 text-xs text-ink-3">{minUsd || side !== undefined ? tr('Brak wykonań dla wybranych filtrów', 'No trades match the selected filters') : tr('Brak zapisanych wykonań w tym oknie', 'No recorded trades in this window')}</p>}
      </div>
      <p className="border-t border-line px-2 py-1 text-[10px] text-ink-3">{tr('↑ kupno · ↓ sprzedaż · ilość w jednostkach kontraktu', '↑ buy · ↓ sell · size in contract units')}</p>
    </div>}

    {tab === 'dom' && <div className="flex min-h-0 flex-1 flex-col" data-hip3-dom>
      <p className={`px-2.5 py-2 text-[11px] ${bookStale ? 'text-warn' : 'text-ink-2'}`}>
        {frame ? `${precise ? tr('Arkusz dokładny', 'Native book') : tr('Arkusz agregowany', 'Aggregated book')} · ${fmtHms(frame.t)}${bookStale ? ` · ${tr('nieaktualny', 'out of date')}` : ''}` : tr('Czekam na migawkę arkusza', 'Waiting for the book snapshot')}
      </p>
      {book && <>
        <dl className="mb-1 grid grid-cols-2 gap-1 px-2">
          <Metric label={tr('Nierównowaga bid/ask · 5 poziomów', 'Bid/ask imbalance · 5 levels')}>{depthNow ? fmtSigned(depthNow.imbalancePct, 1, '%') : DASH}</Metric>
          <Metric label={tr('Zmiana głębokości / 1 min', 'Depth change / 1 min')}>{depthChange === null ? DASH : fmtSigned(depthChange, 1, '%')}</Metric>
        </dl>
        <div className={`${domGrid} border-y border-line py-1.5 text-[10px] text-ink-3 [&>:not(:first-child)]:text-right`}><span>{tr('Cena', 'Price')}</span><span>{tr('Ilość', 'Size')}</span><span>{tr('Zlec.', 'Orders')}</span><span>USD</span><span>Σ USD</span></div>
        <div className={`flex min-h-0 flex-1 flex-col ${mobile ? 'max-h-96' : ''}`}>
          {depth(book.asks, true)}
          <div tabIndex={0} role="region" aria-label={tr('Poziomy sprzedaży', 'Ask levels')} className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto [scrollbar-width:thin]">{ladder(book.asks, true)}</div>
          <div className="flex justify-between gap-1 border-y border-line bg-surface-2 px-2 py-1 text-[11px]">
            <span>Spread {book.spread === null ? DASH : `${num(book.spread, 6)} USD · ${num(book.spreadBp ?? Number.NaN)} bp`}</span>
          </div>
          {depth(book.bids, false)}
          <div tabIndex={0} role="region" aria-label={tr('Poziomy kupna', 'Bid levels')} className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">{ladder(book.bids, false)}</div>
        </div>
      </>}
      <p className="border-t border-line px-2 py-1 text-[10px] text-ink-3">{tr('Zlec. to liczba zleceń na cenie · Σ od najlepszego poziomu', 'Orders per price · Σ from the best level')}</p>
    </div>}

    {tab === 'market' && <div data-hip3-market className="min-h-0 flex-1 overflow-y-auto p-2">
      <p className={`mb-1 px-0.5 text-[11px] ${ctxStale ? 'text-warn' : 'text-ink-2'}`}>
        {ctx || recorded ? `${tr('Odczyt', 'Read at')} ${Number.isFinite(ctxAt) ? fmtHms(ctxAt) : DASH}${ctxStale ? ` · ${tr('nieaktualny', 'out of date')}` : ''}` : replay ? tr('Brak odczytu do tej chwili', 'No reading up to this time') : tr('Czekam na dane kontraktu', 'Waiting for contract data')}
      </p>
      <dl className="grid grid-cols-2 gap-1.5">
        <Metric label="Mark USD">{price(mark ?? 0)}</Metric>
        <Metric label="Oracle USD">{price(ctx?.oraclePx ?? 0)}</Metric>
        <Metric label={tr('Mark − oracle', 'Mark − oracle')}>{basis === null ? DASH : fmtSigned(basis, 2, ' bp')}</Metric>
        <Metric label={tr('Obrót 24 h', '24 h turnover')}>{dollars(ctx?.dayNtlVlm ?? Number.NaN)}</Metric>
        <Metric label={tr('Open interest · jednostki', 'Open interest · units')}>{oi !== undefined && oi >= 0 ? size(oi) : DASH}</Metric>
        <Metric label="Open interest × mark">{dollars(oiUsd)}</Metric>
        {!replay && <Metric label={tr('Zmiana OI / 5 min · jednostki', 'OI change / 5 min · units')}>{oiChange === null ? DASH : fmtSigned(oiChange, market?.szDecimals ?? 5)}</Metric>}
        <Metric label={tr('Funding bieżącej godziny', 'Funding this hour')}>{funding(recorded?.funding ?? ctx?.funding)}</Metric>
        {!replay && <Metric label={tr('Ostatni rozliczony funding', 'Last settled funding')}>
          {funding(settled)}
          {settlementTime !== null && <time className="block" dateTime={new Date(settlementTime).toISOString()}>
            {new Date(settlementTime).toLocaleString(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </time>}
          {fundingStale && <span className="block text-warn">{tr('Historia fundingu nieaktualna', 'Funding history out of date')}</span>}
        </Metric>}
      </dl>
      {!oracleTracked && <p className="mt-2 text-[10px] text-ink-3">{tr('Poza godzinami rynku bazowego oracle pokazuje cenę platformy.', 'Outside underlying market hours the oracle shows the platform price.')}</p>}
      <dl className="mt-2 grid gap-1.5">
        <Metric label={replay ? tr('Odtworzone wykonania', 'Replayed trades') : tr('Wykonania w pamięci przeglądarki', 'Trades retained in this browser')}>{last === null ? DASH : timeRange(store.tape.firstTime, last)}</Metric>
        {!replay && <Metric label={tr('Taśma i DOM w archiwum HyperQuant', 'Tape and DOM in the HyperQuant archive')}>
          <span data-hip3-history={history.kind}>{history.kind === 'listed' ? timeRange(history.from, history.to) : history.kind === 'unlisted' ? tr('Brak nagrań w publicznym indeksie', 'No recordings in the public index') : tr('Dostępność nieustalona', 'Availability undetermined')}</span>
          {history.kind === 'listed' && <a className="ml-2 underline" href={replayHashCore({ source: 'history', coin: store.coin, from: Math.max(history.from, history.to - HOUR_MS), to: history.to })}>{tr('Otwórz powtórkę', 'Open replay')}</a>}
        </Metric>}
      </dl>
      <p className="mt-2 text-[10px] text-ink-3">{replay ? tr('Archiwum zapisuje OI, funding i mark. Oracle i obrót 24 h są w widoku na żywo.', 'The archive records OI, funding and mark. Oracle and 24 h turnover are available live.') : tr('Świece i funding pochodzą z API Hyperliquid. Arkusz jest migawką z Hyperliquid.', 'Candles and funding come from the Hyperliquid API. The book is a Hyperliquid snapshot.')}</p>
    </div>}
  </section>;
}
