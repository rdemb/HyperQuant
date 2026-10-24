import { Coverage } from '../core/coverage';
import { OiLog } from '../core/stats';
import type { Interval } from '../core/time';
import {
  BINANCE_OI_PERIOD,
  FlowVenue,
  OiPoint,
  OiVenue,
  VenueBar,
  VenueTrade,
  parseBinanceKlineMsg,
  parseBybitTicker,
  parseBybitTrades,
  per8h,
  symbolOf,
} from './parse';
import {
  fetchBinanceFunding,
  fetchBinanceFundingInfo,
  fetchBinanceKlines,
  fetchBinanceOi,
  fetchBinanceOiHist,
  fetchBybitOi,
} from './rest';
import { LiveSocket } from './socket';

/**
 * Przepływ Binance i Bybit dla rynku Hyperliquid (panele „CVD giełd” i „ΔOI giełd”), pobierany przez przeglądarkę
 * czytelnika — nic nie przechodzi przez serwer HyperQuant. Delta Binance perp i spot z świec (kupno biorców), także
 * historyczna; Bybit perp z transakcji od otwarcia strony. OI z historii obu giełd i odczytów bieżących, finansowanie
 * przeliczone na 8 h. Połączenia działają tylko, gdy któryś wykres ma panel giełd włączony.
 */

const MIN = 60_000;
/** Historia OI Binance sięga 30 dni wstecz. */
const BINANCE_OI_MAX_MS = 30 * 24 * 60 * MIN;
/** Najwięcej stron historii w jednym przebiegu (kolejne przy następnej synchronizacji wykresu). */
const MAX_PAGES = 4;
/** Po błędzie zapytania kolejna próba najwcześniej po tylu ms. */
const RETRY_MS = 30_000;
/** Odczyty bieżące Binance (OI, finansowanie) co tyle ms. */
const POLL_MS = 30_000;
const BYBIT_PING_MS = 20_000;

/** Stan pobierania historii jednej serii: najstarsza pobrana chwila i blokady. */
interface HistState {
  oldest: number;
  loading: boolean;
  exhausted: boolean;
  retryAt: number;
}

const newHist = (): HistState => ({ oldest: Number.POSITIVE_INFINITY, loading: false, exhausted: false, retryAt: 0 });

/** Delta Bybit z transakcji na żywo w minutach; świeca liczy się tylko w całości nagrana (bez luki połączenia). */
export class MinuteFlow {
  private readonly mins = new Map<number, [vol: number, buy: number]>();
  readonly coverage = new Coverage();

  add(trades: readonly VenueTrade[]): void {
    for (const x of trades) {
      const m = Math.floor(x.t / MIN) * MIN;
      const acc = this.mins.get(m);
      if (acc) {
        acc[0] += x.sz;
        if (x.buy) acc[1] += x.sz;
      } else this.mins.set(m, [x.sz, x.buy ? x.sz : 0]);
    }
  }

  /** Delta świecy [t, t + ms) (bieżąca do `now`); null, gdy nagranie jej nie obejmuje. */
  delta(t: number, ms: number, now: number): number | null {
    const end = Math.min(t + ms, now);
    if (!(end > t) || !this.coverage.covers(t, end)) return null;
    let d = 0;
    for (let m = t; m < end; m += MIN) {
      const acc = this.mins.get(m);
      if (acc) d += 2 * acc[1] - acc[0];
    }
    return d;
  }
}

/** Świece Binance jednego interwału (perp albo spot). */
class KlineBook {
  readonly bars = new Map<number, VenueBar>();
  readonly hist = newHist();

  merge(list: readonly VenueBar[]): void {
    for (const b of list) this.bars.set(b.t, b);
    if (list.length > 0) this.hist.oldest = Math.min(this.hist.oldest, list[0].t);
  }

  delta(t: number): number | null {
    const b = this.bars.get(t);
    return b ? 2 * b.buy - b.v : null;
  }
}

export class VenueStore {
  /** Otwarte pozycje (jednostki rynku) z historii i odczytów bieżących. */
  readonly oi: Record<OiVenue, OiLog> = { binance: new OiLog(), bybit: new OiLog() };
  /** Bieżąca stopa finansowania na 8 h (ułamek); null przed pierwszym odczytem. */
  readonly funding: Record<OiVenue, number | null> = { binance: null, bybit: null };
  readonly bybitFlow = new MinuteFlow();
  version = 0;
  private readonly books = new Map<string, KlineBook>();
  private readonly oiHist = new Map<string, HistState>();
  private readonly listeners = new Set<() => void>();

  constructor(readonly coin: string) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  bump(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  private book(venue: 'binance' | 'binanceSpot', interval: string): KlineBook {
    const key = `${venue}|${interval}`;
    let b = this.books.get(key);
    if (!b) this.books.set(key, (b = new KlineBook()));
    return b;
  }

  /** Delta świecy [t, t + ms) giełdy (jednostki rynku); null bez danych. */
  delta(venue: FlowVenue, iv: Interval, t: number, now: number): number | null {
    return venue === 'bybit' ? this.bybitFlow.delta(t, iv.ms, now) : this.book(venue, iv.id).delta(t);
  }

  /** Historia od `from`: świece Binance perp i spot, OI Binance i Bybit — najwyżej kilka stron na raz, w tle. */
  ensure(iv: Interval, from: number): void {
    void this.loadKlines('binance', iv, from);
    void this.loadKlines('binanceSpot', iv, from);
    void this.loadOi('binance', iv, Math.max(from, Date.now() - BINANCE_OI_MAX_MS + iv.ms));
    void this.loadOi('bybit', iv, from);
  }

  private async loadKlines(venue: 'binance' | 'binanceSpot', iv: Interval, from: number): Promise<void> {
    const b = this.book(venue, iv.id);
    const h = b.hist;
    if (h.loading || h.exhausted || h.oldest <= from || Date.now() < h.retryAt) return;
    h.loading = true;
    for (let page = 0; page < MAX_PAGES && h.oldest > from; page++) {
      const end = Number.isFinite(h.oldest) ? h.oldest - 1 : Date.now() + iv.ms;
      const list = await fetchBinanceKlines(venue, this.coin, iv.id, end);
      if (list === null) {
        h.retryAt = Date.now() + RETRY_MS;
        break;
      }
      if (list.length === 0) {
        h.exhausted = true;
        break;
      }
      b.merge(list);
      this.bump();
    }
    h.loading = false;
  }

  /** Ostatnie świece po ponownym połączeniu (wiadomości z przerwy przepadły); przed pierwszą stroną historii nic. */
  async refreshRecent(venue: 'binance' | 'binanceSpot', iv: Interval): Promise<void> {
    if (this.book(venue, iv.id).bars.size === 0) return;
    const list = await fetchBinanceKlines(venue, this.coin, iv.id, Date.now() + iv.ms);
    if (!list || list.length === 0) return;
    this.book(venue, iv.id).merge(list);
    this.bump();
  }

  private async loadOi(venue: OiVenue, iv: Interval, from: number): Promise<void> {
    const period = BINANCE_OI_PERIOD[iv.id];
    const key = `${venue}|${period}`;
    let h = this.oiHist.get(key);
    if (!h) this.oiHist.set(key, (h = newHist()));
    if (h.loading || h.exhausted || h.oldest <= from || Date.now() < h.retryAt) return;
    h.loading = true;
    for (let page = 0; page < MAX_PAGES && h.oldest > from; page++) {
      const end = Number.isFinite(h.oldest) ? h.oldest - 1 : Date.now();
      const pts = venue === 'binance' ? await fetchBinanceOiHist(this.coin, iv.id, end) : await fetchBybitOi(this.coin, iv.id, end);
      if (pts === null) {
        h.retryAt = Date.now() + RETRY_MS;
        break;
      }
      if (pts.length === 0) {
        h.exhausted = true;
        break;
      }
      h.oldest = Math.min(h.oldest, pts[0][0]);
      this.oi[venue].restore(pts);
      this.bump();
    }
    h.loading = false;
  }

  // ───────────────────────── na żywo ─────────────────────────

  onKline(venue: 'binance' | 'binanceSpot', interval: string, bar: VenueBar): void {
    const b = this.books.get(`${venue}|${interval}`);
    if (!b) return;
    b.bars.set(bar.t, bar);
    this.bump();
  }

  onOi(venue: OiVenue, p: OiPoint): void {
    this.oi[venue].push(p[0], p[1]);
    this.bump();
  }

  setFunding(venue: OiVenue, rate8h: number): void {
    if (this.funding[venue] === rate8h) return;
    this.funding[venue] = rate8h;
    this.bump();
  }
}

const stores = new Map<string, VenueStore>();

export function venueStoreFor(coin: string): VenueStore {
  let s = stores.get(coin);
  if (!s) stores.set(coin, (s = new VenueStore(coin)));
  return s;
}

const coinOf = (symbol: string) => (symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol);

// ───────────────────────── połączenia (wspólne dla wszystkich wykresów) ─────────────────────────

/** Wykresy z panelem giełd: liczba na (rynek, interwał). */
const live = new Map<string, { coin: string; iv: Interval; n: number }>();
/** Rynki z subskrypcją Bybit potwierdzoną albo w drodze. */
const bybitSubs = new Set<string>();
let fundingHours: Map<string, number> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

const klineStreams = () => [...live.values()].map((x) => `${symbolOf(x.coin).toLowerCase()}@kline_${x.iv.id}`).sort();
const liveCoins = () => new Set([...live.values()].map((x) => x.coin));

function binanceSocket(venue: 'binance' | 'binanceSpot'): LiveSocket {
  return new LiveSocket({
    onOpen: () => {
      for (const x of live.values()) void venueStoreFor(x.coin).refreshRecent(venue, x.iv);
    },
    onMessage: (msg) => {
      const k = parseBinanceKlineMsg(msg);
      if (k) venueStoreFor(coinOf(k.symbol)).onKline(venue, k.interval, k.bar);
    },
    onClose: () => {},
  });
}

const binancePerp = binanceSocket('binance');
const binanceSpot = binanceSocket('binanceSpot');

/** Okres finansowania Bybit (h) z pierwszej, pełnej wiadomości tickera rynku. */
const bybitHours = new Map<string, number>();

const bybitTopics = (coin: string) => [`publicTrade.${symbolOf(coin)}`, `tickers.${symbolOf(coin)}`];

const bybit = new LiveSocket({
  onOpen: () => {
    bybitSubs.clear();
    syncBybit();
  },
  onMessage: (msg) => {
    const m = msg as { op?: unknown; success?: unknown; req_id?: unknown };
    // Potwierdzenie subskrypcji rynku (req_id = rynek): od tej chwili transakcje Bybit są nagrywane bez luki
    if (m.op === 'subscribe' && m.success === true && typeof m.req_id === 'string') {
      venueStoreFor(m.req_id).bybitFlow.coverage.open(Date.now());
      return;
    }
    const tr = parseBybitTrades(msg);
    if (tr) {
      const s = venueStoreFor(coinOf(tr.symbol));
      s.bybitFlow.add(tr.trades);
      s.bump();
      return;
    }
    const tk = parseBybitTicker(msg);
    if (!tk) return;
    const s = venueStoreFor(coinOf(tk.symbol));
    if (tk.oi !== undefined) s.onOi('bybit', [tk.time > 0 ? tk.time : Date.now(), tk.oi]);
    if (tk.funding !== undefined) s.setFunding('bybit', per8h(tk.funding, tk.intervalH ?? bybitHours.get(tk.symbol) ?? 8));
    if (tk.intervalH !== undefined) bybitHours.set(tk.symbol, tk.intervalH);
  },
  onClose: () => {
    const now = Date.now();
    for (const coin of bybitSubs) venueStoreFor(coin).bybitFlow.coverage.close(now);
    bybitSubs.clear();
  },
  ping: { everyMs: BYBIT_PING_MS, msg: { op: 'ping' } },
});

/** Subskrypcje Bybit zgodne z rynkami wykresów: nowe rynki dopisywane, porzucone wypisywane (bez zrywania połączenia). */
function syncBybit(): void {
  if (!bybit.open) return;
  const want = liveCoins();
  for (const coin of want) {
    if (bybitSubs.has(coin)) continue;
    bybitSubs.add(coin);
    bybit.send({ op: 'subscribe', req_id: coin, args: bybitTopics(coin) });
  }
  for (const coin of [...bybitSubs]) {
    if (want.has(coin)) continue;
    bybitSubs.delete(coin);
    bybit.send({ op: 'unsubscribe', args: bybitTopics(coin) });
    venueStoreFor(coin).bybitFlow.coverage.close(Date.now());
  }
}

async function poll(): Promise<void> {
  fundingHours ??= await fetchBinanceFundingInfo();
  for (const coin of liveCoins()) {
    const s = venueStoreFor(coin);
    const [oi, rate] = await Promise.all([fetchBinanceOi(coin), fetchBinanceFunding(coin)]);
    if (oi) s.onOi('binance', oi);
    if (rate !== null) s.setFunding('binance', per8h(rate, fundingHours.get(symbolOf(coin)) ?? 8));
  }
}

function refreshLive(): void {
  const streams = klineStreams();
  binancePerp.setUrl(streams.length ? `wss://fstream.binance.com/market/stream?streams=${streams.join('/')}` : null);
  binanceSpot.setUrl(streams.length ? `wss://data-stream.binance.vision/stream?streams=${streams.join('/')}` : null);
  bybit.setUrl(live.size ? 'wss://stream.bybit.com/v5/public/linear' : null);
  syncBybit();
  if (live.size && pollTimer === null) {
    void poll();
    pollTimer = setInterval(() => void poll(), POLL_MS);
  } else if (!live.size && pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Wykres z panelem giełd na (rynek, interwał): połączenia na żywo do zwolnienia zwróconą funkcją. */
export function acquireVenues(coin: string, iv: Interval): () => void {
  const key = `${coin}|${iv.id}`;
  const x = live.get(key);
  if (x) x.n++;
  else live.set(key, { coin, iv, n: 1 });
  refreshLive();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const y = live.get(key);
    if (y && --y.n <= 0) live.delete(key);
    refreshLive();
  };
}
