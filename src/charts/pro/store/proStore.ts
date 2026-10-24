import { AssetCtx, Candle, Fill, parseAssetCtx, parseBook, parseCandle, parseFills } from '../hl/parse';
import { fetchAssetCtx, fetchCandles, fetchFunding } from '../hl/rest';
import { HlStream, StreamStatus, Subscription } from '../hl/stream';
import { BookHistory, bookSigFigs, bookStep, toFrame } from '../core/book';
import { Coverage, Span } from '../core/coverage';
import { FootprintBar, FootprintBuilder, hlTick } from '../core/footprintBar';
import { WallTracker } from '../core/clashes';
import { OrderAggregator, OrderLog } from '../core/orders';
import { FundingBook, HOUR_MS, OiLog } from '../core/stats';
import { Tape, TradeRow } from '../core/tape';
import { utcDayStart } from '../core/sessions';
import { DAY, DEFAULT_INTERVAL, Interval, barStart, intervalById } from '../core/time';

/**
 * Magazyn wykresu Pro (bez Reacta, jeden na rynek): świece Hyperliquid wybranego interwału
 * (historia z REST, bieżąca świeca z WebSocket), taśma transakcji od otwarcia widoku z pokryciem
 * i lukami, footprint każdej świecy i zlecenia agresora. Odbiorcy dostają powiadomienie o zmianie
 * i sami czytają stan (`bars()`, `ctx`, `orders`).
 */

/** Rynki perp Hyperliquid w widoku Wykresy. */
export const MARKETS = ['BTC', 'ETH', 'SOL', 'HYPE'] as const;
export type Market = (typeof MARKETS)[number];
export const COIN: Market = 'BTC';
/** Tyle świec pobieramy na start i przy każdym doczytaniu historii. */
export const PAGE_BARS = 1500;
/** Taśma i zlecenia są trzymane w pamięci przez dobę. */
export const RETENTION_MS = 24 * 3600_000;
/** Historia finansowania do statystyk świec: najwyżej tyle wstecz (6 stron API po 500 godzin). */
const FUNDING_MAX_MS = 120 * DAY;
/** Tyle dni świec dziennych pobieramy dla poziomów dnia (PDH, PDL, PDC, otwarcie). */
const DAILY_DAYS = 400;

export interface ProBar {
  t: number;
  candle: Candle;
  /** Footprint z taśmy; null, gdy świeca jest poza nagraniem. */
  fp: FootprintBar | null;
  /** Udział wolumenu świecy (z API) zarejestrowany na taśmie; NaN bez taśmy. */
  share: number;
  /** Świeca w całości objęta nagrywaniem taśmy (bez luki). */
  complete: boolean;
}

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

interface FpCacheEntry {
  sig: string;
  fp: FootprintBar | null;
}

/** Przesunięcie zegara serwera względem klienta: największe (czas bloku − odbiór) z ostatnich próbek. */
export class ClockSync {
  private samples: number[] = [];
  offset = 0;

  observe(serverTime: number, recvAt: number): void {
    this.samples.push(serverTime - recvAt);
    if (this.samples.length > 64) this.samples.shift();
    this.offset = Math.max(...this.samples);
  }

  toServer(clientMs: number): number {
    return clientMs + this.offset;
  }
}

export class ProStore {
  readonly coin: string;
  readonly stream: HlStream;
  readonly tape = new Tape();
  readonly coverage = new Coverage();
  readonly orders = new OrderLog();
  /** Wchłanianie zleceń agresora przez makerów (ściany), z taśmy na żywo. */
  readonly walls = new WallTracker();
  /** Otwarte pozycje z kanału activeAssetCtx (od otwarcia strony) i stawki finansowania z historii API. */
  readonly oi = new OiLog();
  readonly funding = new FundingBook();
  private fundingLoading = false;
  readonly clock = new ClockSync();
  private readonly aggregator = new OrderAggregator();

  interval: Interval = intervalById(DEFAULT_INTERVAL);
  candles: Candle[] = [];
  /** Świece dzienne (00:00 UTC) — poziomy dnia niezależne od interwału wykresu. */
  daily: Candle[] = [];
  loadState: LoadState = 'idle';
  /** Doczytywanie starszej historii w toku / historia wyczerpana (limit API). */
  loadingOlder = false;
  historyExhausted = false;
  ctx: AssetCtx | null = null;
  status: StreamStatus = 'idle';
  version = 0;

  private started = false;
  private candleSub: Subscription | null = null;
  private loadSeq = 0;
  private readonly listeners = new Set<() => void>();
  private fpCache = new Map<number, FpCacheEntry>();
  private barCache = new Map<number, ProBar>();
  /** Bieżąca (najnowsza) świeca liczona przyrostowo. */
  private live: FootprintBuilder | null = null;
  private liveFp: FootprintBar | null = null;
  private liveFpTrades = -1;
  private timers: ReturnType<typeof setInterval>[] = [];
  /** Subskrypcja transakcji potwierdzona, czekamy na pierwszą wiadomość (migawkę ostatnich transakcji). */
  private tradesPending = false;
  /** Dzień UTC, dla którego świece dzienne są pobrane albo w drodze. */
  private dailyDay = 0;
  /** Subskrypcje arkusza: bliska (~2 pb ceny) i daleka (10 × większy krok) agregacja; migawki rozpoznajemy po kroku cen. */
  private bookSubs: Subscription[] = [];
  private readonly books = new Map<number, BookHistory>();
  private bookSteps: [number, number] = [Number.NaN, Number.NaN];

  constructor(stream?: HlStream, coin: string = COIN) {
    this.coin = coin;
    this.stream = stream ?? new HlStream();
    this.stream.listen({
      onMessage: (ch, data, recvAt) => this.onMessage(ch, data, recvAt),
      onSubscribed: (sub, recvAt) => {
        if (sub.type === 'trades') this.tradesPending = true;
        // Po ponownym połączeniu dociągamy świece, które mogły przyjść w trakcie przerwy
        if (sub.type === 'candle' && this.candles.length > 0) void this.refreshRecent();
      },
      onClosed: (at) => {
        this.coverage.close(this.clock.toServer(at));
        this.bump();
      },
      onStatus: (s) => {
        this.status = s;
        this.bump();
      },
    });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private bump(): void {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  /** Start nagrywania i strumieni (raz na sesję strony — taśma ma rosnąć także poza widokiem wykresu). */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.stream.add({ type: 'trades', coin: this.coin });
    this.stream.add({ type: 'activeAssetCtx', coin: this.coin });
    this.stream.start();
    void fetchAssetCtx(this.coin).then((c) => {
      if (c && !this.ctx) {
        this.ctx = c;
        this.oi.push(this.serverNow(), c.openInterest);
        this.ensureBookSubs(c.markPx);
        this.bump();
      }
    });
    // Interwał mógł zostać już ustawiony (i jego świece są w drodze) przed startem
    if (this.loadState === 'idle') void this.setInterval(this.interval.id, true);
    void this.loadDaily();
    // Zlecenia bez nowych wypełnień zamykają się także w ciszy na rynku
    this.timers.push(setInterval(() => this.flushOrders(), 2000));
    this.timers.push(
      setInterval(() => {
        this.prune();
        void this.loadDaily();
        void this.refreshFunding();
      }, 60_000)
    );
  }

  /** Tylko dla testów: zatrzymuje strumień i liczniki. */
  stop(): void {
    this.stream.stop();
    this.timers.forEach((id) => clearInterval(id));
    this.timers = [];
    this.started = false;
  }

  serverNow(): number {
    return this.clock.toServer(Date.now());
  }

  // ───────────────────────── świece ─────────────────────────

  async setInterval(id: string, force = false): Promise<void> {
    const next = intervalById(id);
    if (!force && next.id === this.interval.id && this.candles.length > 0) return;
    this.interval = next;
    this.candles = [];
    this.fpCache = new Map();
    this.barCache = new Map();
    this.live = null;
    this.liveFp = null;
    this.liveFpTrades = -1;
    this.historyExhausted = false;
    this.loadState = 'loading';
    if (this.candleSub) this.stream.remove(this.candleSub);
    this.candleSub = { type: 'candle', coin: this.coin, interval: next.id };
    this.stream.add(this.candleSub);
    this.bump();

    const seq = ++this.loadSeq;
    const now = Date.now();
    const list = await fetchCandles(this.coin, next.id, now - PAGE_BARS * next.ms, now + next.ms);
    if (seq !== this.loadSeq) return;
    if (list.length === 0) {
      this.loadState = 'error';
      this.bump();
      return;
    }
    this.mergeCandles(list);
    this.loadState = 'ready';
    this.bump();
    void this.loadFunding();
  }

  /** Doczytuje starszą historię (przewinięcie wykresu w lewo). */
  async loadOlder(): Promise<void> {
    if (this.loadingOlder || this.historyExhausted || this.candles.length === 0) return;
    this.loadingOlder = true;
    const seq = this.loadSeq;
    const iv = this.interval;
    const first = this.candles[0].t;
    const list = await fetchCandles(this.coin, iv.id, first - PAGE_BARS * iv.ms, first - 1);
    this.loadingOlder = false;
    if (seq !== this.loadSeq) return;
    const older = list.filter((c) => c.t < first);
    if (older.length === 0) this.historyExhausted = true;
    else this.mergeCandles(older);
    this.bump();
    void this.loadFunding();
  }

  /** Stawki finansowania od najstarszej świecy (najwyżej FUNDING_MAX_MS wstecz); pobrany okres nie jest pobierany drugi raz. */
  private async loadFunding(): Promise<void> {
    if (this.fundingLoading || this.candles.length === 0) return;
    const from = Math.max(this.candles[0].t, Date.now() - FUNDING_MAX_MS);
    if (from >= this.funding.from) return;
    this.fundingLoading = true;
    try {
      const pts = await fetchFunding(this.coin, from);
      this.funding.add(pts, from);
      this.bump();
    } catch {
      // Bez historii wiersz finansowania pokazuje tylko stawkę prognozowaną bieżącej godziny
    } finally {
      this.fundingLoading = false;
    }
  }

  /** Rozliczenie kolejnej godziny (wypłata o pełnej godzinie) — dociągane, gdy już powinno być w API. */
  private async refreshFunding(): Promise<void> {
    const last = this.funding.latest;
    if (this.fundingLoading || !Number.isFinite(last) || this.serverNow() < last + 2 * HOUR_MS + 30_000) return;
    this.fundingLoading = true;
    try {
      this.funding.add(await fetchFunding(this.coin, last + 1.5 * HOUR_MS), this.funding.from);
      this.bump();
    } catch {
      // Ponowienie przy następnym takcie; do tego czasu godzina ma stawkę prognozowaną
    } finally {
      this.fundingLoading = false;
    }
  }

  /** Świece dzienne — raz na dzień UTC; brak świecy bieżącego dnia albo błąd → ponowienie przy następnym takcie. */
  private async loadDaily(): Promise<void> {
    const now = Date.now();
    const day = utcDayStart(this.serverNow());
    if (this.dailyDay === day) return;
    this.dailyDay = day;
    const list = await fetchCandles(this.coin, '1d', now - DAILY_DAYS * DAY, now + DAY);
    if (list.length === 0 || list[list.length - 1].t < day) this.dailyDay = 0;
    if (list.length === 0) return;
    this.daily = list;
    this.bump();
  }

  private async refreshRecent(): Promise<void> {
    const iv = this.interval;
    const seq = this.loadSeq;
    const now = Date.now();
    const list = await fetchCandles(this.coin, iv.id, now - 60 * iv.ms, now + iv.ms);
    if (seq !== this.loadSeq || list.length === 0) return;
    this.mergeCandles(list);
    this.bump();
  }

  /** Scala świece (nowsza wersja tej samej świecy wygrywa), utrzymując porządek czasu. */
  mergeCandles(list: readonly Candle[]): void {
    if (list.length === 0) return;
    const arr = this.candles;
    const last = arr[arr.length - 1];
    // Szybka ścieżka: aktualizacja bieżącej świecy albo nowa świeca na końcu
    if (list.length === 1 && last && list[0].t >= last.t) {
      if (list[0].t === last.t) arr[arr.length - 1] = list[0];
      else arr.push(list[0]);
      return;
    }
    const byT = new Map<number, Candle>();
    for (const c of arr) byT.set(c.t, c);
    for (const c of list) byT.set(c.t, c);
    this.candles = [...byT.values()].sort((a, b) => a.t - b.t);
  }

  // ───────────────────────── strumień ─────────────────────────

  private onMessage(channel: string, data: unknown, recvAt: number): void {
    if (channel === 'trades') {
      const fills = parseFills(data, this.coin);
      if (fills.length === 0) return;
      let newest = 0;
      for (const f of fills) if (f.time > newest) newest = f.time;
      this.clock.observe(newest, recvAt);
      if (this.tradesPending) {
        // Pierwsza wiadomość po subskrypcji to migawka ostatnich transakcji, więc od najnowszej z nich taśma
        // jest kompletna — początek nagrania w zegarze giełdy, niezależnie od zegara przeglądarki
        this.tradesPending = false;
        this.coverage.open(newest);
      }
      this.ingestFills(fills, recvAt);
    } else if (channel === 'candle') {
      const c = parseCandle(data);
      const d = data as { s?: unknown; i?: unknown } | null;
      if (!c || d?.s !== this.coin || d?.i !== this.interval.id || this.loadState !== 'ready') return;
      this.mergeCandles([c]);
      this.bump();
    } else if (channel === 'activeAssetCtx') {
      const d = data as { coin?: unknown; ctx?: unknown } | null;
      if (d?.coin !== this.coin) return;
      const ctx = parseAssetCtx(d.ctx);
      if (ctx) {
        this.ctx = ctx;
        this.oi.push(this.serverNow(), ctx.openInterest);
        this.ensureBookSubs(ctx.markPx);
        this.bump();
      }
    } else if (channel === 'l2Book') {
      const snap = parseBook(data, this.coin);
      if (!snap) return;
      const step = bookStep(snap);
      if (step !== this.bookSteps[0] && step !== this.bookSteps[1]) return;
      let h = this.books.get(step);
      if (!h) this.books.set(step, (h = new BookHistory(step)));
      h.add(toFrame(snap, step));
      this.bump();
    }
  }

  // ───────────────────────── arkusz ─────────────────────────

  /** Agregacje arkusza dopasowane do rzędu wielkości ceny (zmiana tylko przy przejściu przez 10^k). */
  private ensureBookSubs(price: number): void {
    if (!(price > 0)) return;
    const { near, far } = bookSigFigs(price);
    const digits = Math.floor(Math.log10(price)) + 1;
    const steps: [number, number] = [10 ** (digits - near), 10 ** (digits - far)];
    if (steps[0] === this.bookSteps[0] && steps[1] === this.bookSteps[1]) return;
    for (const sub of this.bookSubs) this.stream.remove(sub);
    this.bookSteps = steps;
    this.books.clear();
    this.bookSubs = [near, far].map((n) => ({ type: 'l2Book', coin: this.coin, nSigFigs: n }) as const);
    for (const sub of this.bookSubs) this.stream.add(sub);
  }

  /** Historia arkusza w agregacji bliskiej (~2 pb ceny) i dalekiej (10 × większy krok); null przed pierwszą migawką. */
  book(which: 'near' | 'far'): BookHistory | null {
    return this.books.get(this.bookSteps[which === 'near' ? 0 : 1]) ?? null;
  }

  /** Wejście transakcji (WebSocket albo zapis z przeglądarki). */
  ingestFills(fills: Fill[], recvAt = Date.now()): void {
    const sorted = fills.length > 1 ? [...fills].sort((a, b) => a.time - b.time) : fills;
    const { accepted } = this.tape.insert(sorted);
    if (accepted.length === 0) return;
    this.feedLive(accepted);
    this.walls.push(accepted);
    this.orders.add(this.aggregator.push(accepted, this.clock.toServer(recvAt)));
    this.bump();
  }

  /** Wczytuje zapisaną taśmę i jej pokrycie (zapis nie ma adresów, więc nie odtwarza zleceń agresora). */
  restore(rows: readonly TradeRow[], spans: readonly Span[]): void {
    for (const [a, b] of spans) this.coverage.addSpan(a, b);
    const { accepted } = this.tape.insert(rows);
    // Bieżąca świeca mogła dostać starsze transakcje z zapisu
    if (accepted.length > 0 && this.live) this.live = this.buildFromTape(this.live.t);
    this.bump();
  }

  /**
   * Bieżąca świeca liczona przyrostowo. Nowa świeca albo transakcja spóźniona względem już policzonych
   * → przeliczenie świecy z taśmy (taśma ma już całą paczkę).
   */
  private feedLive(fills: readonly Fill[]): void {
    const ms = this.interval.ms;
    let maxT = Number.NEGATIVE_INFINITY;
    for (const f of fills) maxT = Math.max(maxT, barStart(f.time, ms));
    const live = this.live;
    if (!live || live.t < maxT) {
      this.live = this.buildFromTape(maxT);
      return;
    }
    if (live.t > maxT) return; // same starsze świece — przeliczy je pamięć podręczna
    for (const f of fills) {
      if (barStart(f.time, ms) !== live.t) continue;
      if (!live.empty && f.time < live.lastTime) {
        this.live = this.buildFromTape(live.t);
        return;
      }
      live.add(f.time, f.px, f.sz, f.side);
    }
  }

  private buildFromTape(t: number): FootprintBuilder {
    const ms = this.interval.ms;
    let b: FootprintBuilder | null = null;
    this.tape.forEach(t, t + ms, (time, px, sz, side) => {
      b ??= new FootprintBuilder(t, baseTick(px));
      b.add(time, px, sz, side);
    });
    return b ?? new FootprintBuilder(t);
  }

  // ───────────────────────── świece z footprintem ─────────────────────────

  private footprintFor(t: number): FootprintBar | null {
    const live = this.live;
    if (live && live.t === t) {
      if (this.liveFpTrades !== live.trades || this.liveFp?.t !== t) {
        this.liveFp = live.build();
        this.liveFpTrades = live.trades;
      }
      return this.liveFp;
    }
    const sig = this.tape.signature(t, t + this.interval.ms);
    const hit = this.fpCache.get(t);
    if (hit && hit.sig === sig) return hit.fp;
    const fp = sig === '0:0' ? null : this.buildFromTape(t).build();
    this.fpCache.set(t, { sig, fp });
    return fp;
  }

  /** Świece bieżącego interwału z footprintem; niezmienione świece zachowują referencję (tani diff na wykresie). */
  bars(): ProBar[] {
    const ms = this.interval.ms;
    const now = this.serverNow();
    const firstTape = this.tape.firstTime;
    const out: ProBar[] = new Array(this.candles.length);
    for (let i = 0; i < this.candles.length; i++) {
      const c = this.candles[i];
      const t = c.t;
      const end = Math.min(t + ms, now);
      // Świece sprzed nagrania nie mają taśmy — bez przeglądania pamięci podręcznej
      const fp = t + ms > firstTape ? this.footprintFor(t) : null;
      const complete = fp !== null && this.coverage.covers(t, end);
      const share = fp && c.v > 0 ? (fp.buyVol + fp.sellVol) / c.v : Number.NaN;
      const prev = this.barCache.get(t);
      if (prev && prev.candle === c && prev.fp === fp && prev.complete === complete) {
        out[i] = prev;
        continue;
      }
      const bar: ProBar = { t, candle: c, fp, share, complete };
      this.barCache.set(t, bar);
      out[i] = bar;
    }
    return out;
  }

  // ───────────────────────── sprzątanie ─────────────────────────

  private prune(): void {
    const cut = this.serverNow() - RETENTION_MS;
    this.tape.prune(cut);
    this.coverage.prune(cut);
    this.orders.prune(cut);
    this.walls.prune(this.serverNow(), cut);
    this.oi.prune(cut);
    this.books.forEach((b) => b.prune(cut));
    const ms = this.interval.ms;
    this.fpCache.forEach((_v, t) => {
      if (t + ms < cut) this.fpCache.delete(t);
    });
  }

  private flushOrders(): void {
    const done = this.aggregator.flush(this.serverNow());
    if (done.length === 0) return;
    this.orders.add(done);
    this.bump();
  }

  /** Zlecenia jeszcze zbierające wypełnienia (do podglądu na żywo). */
  pendingOrders() {
    return this.aggregator.pending();
  }
}

/** Tick bazowy footprintu z ceny o 5% niższej — patrz FootprintBuilder. */
function baseTick(px: number): number {
  return hlTick(px * 0.95);
}

const stores = new Map<Market, ProStore>();

/** Magazyn rynku, jeden na stronę: raz otwarty nagrywa taśmę dalej także po przełączeniu wykresu na inny rynek. */
export function storeFor(coin: Market): ProStore {
  let s = stores.get(coin);
  if (!s) stores.set(coin, (s = new ProStore(undefined, coin)));
  return s;
}

/** Magazyny rynków otwartych na tej stronie (alerty cenowe sprawdzamy na każdym z nich). */
export function openStores(): ProStore[] {
  return [...stores.values()];
}
