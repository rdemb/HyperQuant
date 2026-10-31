import { AssetCtx, Candle, Fill, parseAssetCtx, parseBook, parseCandle, parseFills } from '../hl/parse';
import { fetchAssetCtx, fetchCandles, fetchFunding } from '../hl/rest';
import { HlStream, StreamStatus, Subscription } from '../hl/stream';
import { BookFrame, BookHistory, bookSigFigs, bookStep, toFrame } from '../core/book';
import { Coverage, Span } from '../core/coverage';
import { FootprintBar, FootprintBuilder, baseTick, hlTick } from '../core/footprintBar';
import { WallTracker } from '../core/clashes';
import { MakerFlow, MakerSplit } from '../core/makers';
import { OrderAggregator, OrderLog } from '../core/orders';
import { PlayerFlow, bigPlayerUsd } from '../core/players';
import { FundingBook, HOUR_MS, OiLog } from '../core/stats';
import { Tape, TradeRow } from '../core/tape';
import { periodStart, utcDayStart } from '../core/sessions';
import { indicatorScope, vwapSourceId } from '../core/indicators';
import { DAY, Interval, barStart, intervalById } from '../core/time';

/**
 * Magazyn wykresu Pro (bez Reacta, jeden na rynek): taśma transakcji od otwarcia widoku z pokryciem
 * i lukami, zlecenia agresora, arkusz i kontekst rynku oraz serie świec każdego używanego interwału
 * (`series(id)`: historia z REST, bieżąca świeca z WebSocket, footprint z taśmy). Odbiorcy dostają
 * powiadomienie o zmianie i sami czytają stan (`series(id).bars()`, `ctx`, `orders`).
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

/** Fragment historii z zapisu serwera (część albo godzina): taśma z pliku transakcji (null bez pliku) i migawki arkusza. */
export interface HistoryBatch {
  trades: {
    /** Zakres pliku [from, to) i odcinki ciągłego nagrania w nim. */
    from: number;
    to: number;
    spans: Span[];
    /** Odcinki z oznaczonymi hashami zerowymi (pliki rejestratora od wprowadzenia kolumny `z`). */
    zeroSpans?: Span[];
    /** Rosnąco po czasie; biorca, maker i hash to numery ważne w obrębie godziny. */
    fills: Fill[];
    /** [czas, otwarte pozycje] co minutę. */
    oi: [number, number][];
  } | null;
  frames: BookFrame[];
}

/**
 * Powtórka nagrania (magazyn bez strumienia na żywo): zegar odtwarzania zamiast zegara giełdy, koniec nagrania, do którego
 * sięgają zapytania o świece, i świece z pamięci powtórki (nowy magazyn po przewinięciu wstecz nie pyta API drugi raz).
 */
export interface ReplayClock {
  now(): number;
  end: number;
  candles(coin: string, interval: string, from: number, to: number): Promise<Candle[]>;
}

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
  /** Czas z kontami biorców na taśmie (strumień na żywo i historia serwera; zapis przeglądarki ich nie ma). */
  readonly addressed = new Coverage();
  /** Czas z oznaczonymi wypełnieniami z hashem zerowym (strumień na żywo i nowsze pliki historii serwera). */
  readonly zeroKnown = new Coverage();
  /** Kto handluje: wejścia dużych graczy i reszty z kont biorców. */
  readonly players: PlayerFlow;
  /** Wchłanianie zleceń agresora przez makerów (ściany), z taśmy na żywo. */
  readonly walls = new WallTracker();
  /** Kto przyjmuje agresję: animatorzy rynku i reszta makerów, z kont makerów. */
  private readonly makers = new MakerFlow();
  /** Otwarte pozycje z kanału activeAssetCtx (od otwarcia strony) i stawki finansowania z historii API. */
  readonly oi = new OiLog();
  readonly funding = new FundingBook();
  private fundingLoading = false;
  readonly clock = new ClockSync();
  private readonly aggregator = new OrderAggregator();
  /** Serie świec używanych interwałów (panele układu na tym rynku dzielą taśmę i połączenie). */
  private readonly seriesById = new Map<string, CandleSeries>();
  /**
   * Najstarsza transakcja pierwszej wiadomości strumienia (migawki) w tej sesji: od niej zlecenia agresora i ściany
   * liczy strumień na żywo; +∞ przed pierwszą wiadomością.
   */
  private liveFrom = Number.POSITIVE_INFINITY;
  /** Czas, dla którego zlecenia i ściany zostały już złożone z historii serwera (bez dublowania przy ponownym pliku). */
  private readonly derived = new Coverage();
  /** Cena ostatniej transakcji z taśmy na żywo (0 przed pierwszą). */
  private lastTradePx = 0;
  private lastTradeT = 0;

  /** Świece dzienne (00:00 UTC) — poziomy dnia niezależne od interwału wykresu. */
  daily: Candle[] = [];
  ctx: AssetCtx | null = null;
  status: StreamStatus = 'idle';
  version = 0;

  private started = false;
  private readonly listeners = new Set<() => void>();
  private timers: ReturnType<typeof setInterval>[] = [];
  /** Subskrypcja transakcji potwierdzona, czekamy na pierwszą wiadomość (migawkę ostatnich transakcji). */
  private tradesPending = false;
  /** Dzień UTC, dla którego świece dzienne są pobrane albo w drodze. */
  private dailyDay = 0;
  /**
   * Subskrypcje arkusza: bliska (~2 pb ceny) i daleka (10 × większy krok) agregacja do mapy ciepła oraz dokładny arkusz
   * (tick ceny) do wykrywania gór lodowych; migawki rozpoznajemy po kroku cen.
   */
  private bookSubs: Subscription[] = [];
  private readonly books = new Map<number, BookHistory>();
  private bookSteps: [number, number] = [Number.NaN, Number.NaN];
  private exactSub = false;
  /** Dokładny arkusz (bez agregacji ceny) od otwarcia strony, gdy bliska agregacja jest grubsza niż tick; serwer go nie nagrywa. */
  private readonly exact = new BookHistory(Number.NaN);

  constructor(
    stream?: HlStream,
    coin: string = COIN,
    readonly replay: ReplayClock | null = null
  ) {
    this.coin = coin;
    this.players = new PlayerFlow(this.orders, this.addressed, bigPlayerUsd(coin));
    this.stream = stream ?? new HlStream();
    this.stream.listen({
      onMessage: (ch, data, recvAt) => this.onMessage(ch, data, recvAt),
      onSubscribed: (sub, recvAt) => {
        if (sub.type === 'trades') this.tradesPending = true;
        // Po ponownym połączeniu dociągamy świece, które mogły przyjść w trakcie przerwy
        if (sub.type === 'candle') void this.seriesById.get(sub.interval)?.refreshRecent();
      },
      onClosed: (at) => {
        this.coverage.close(this.clock.toServer(at));
        this.addressed.close(this.clock.toServer(at));
        this.zeroKnown.close(this.clock.toServer(at));
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

  /** Powiadomienie odbiorców (także z serii świec tego rynku). */
  bump(): void {
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
    // Serie utworzone przed startem, których świece nie są jeszcze w drodze
    for (const s of this.seriesById.values()) if (s.loadState === 'idle') void s.load();
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
    return this.replay ? this.replay.now() : this.clock.toServer(Date.now());
  }

  /** Koniec zakresu zapytań o świece: teraz, a w powtórce koniec nagrania. */
  apiNow(): number {
    return this.replay ? this.replay.end : Date.now();
  }

  /** Świece z API (w powtórce z jej pamięci). */
  candles(interval: string, from: number, to: number): Promise<Candle[]> {
    return this.replay ? this.replay.candles(this.coin, interval, from, to) : fetchCandles(this.coin, interval, from, to);
  }

  /** Powtórka: agregacje arkusza od ceny nagrania (bez połączenia) i świece dzienne do poziomów dnia. */
  prepareReplay(price: number): void {
    this.ensureBookSubs(price);
    void this.loadDaily();
  }

  // ───────────────────────── świece ─────────────────────────

  /** Seria świec interwału (tworzona przy pierwszym użyciu; świece pobiera `load()`). */
  series(id: string): CandleSeries {
    const iv = intervalById(id);
    let s = this.seriesById.get(iv.id);
    if (!s) this.seriesById.set(iv.id, (s = new CandleSeries(this, iv)));
    return s;
  }

  /**
   * Świece, z których liczymy VWAP okresu na wykresie interwału `iv` (doba i sesje z 1m, tydzień z 5m) — ta sama wartość
   * na każdym interwale. Seria wczytuje się przy pierwszym użyciu, a do VWAP tygodnia także wstecz do poniedziałku.
   */
  vwapCandles(iv: Interval): readonly Candle[] {
    const mode = indicatorScope(iv.ms).vwapAnchor;
    const s = this.series(vwapSourceId(mode));
    if (s.loadState === 'idle') void s.load();
    else if (mode === 'week' && s.candles.length > 0 && s.candles[0].t > periodStart(this.serverNow(), mode)) void s.loadOlder();
    return s.candlesNow();
  }

  /**
   * Świece interwału wskaźnika (parametr „Interwał”, doba pivotów): seria wczytuje się przy pierwszym użyciu,
   * a starsza historia, gdy wykres sięga dalej wstecz niż `from`.
   */
  indicatorCandles(id: string, from: number): readonly Candle[] {
    const s = this.series(id);
    if (s.loadState === 'idle') void s.load();
    else if (s.candles.length > 0 && s.candles[0].t > from) void s.loadOlder();
    return s.candlesNow();
  }

  /** Ostatnia cena rynku: transakcja z taśmy, a przed pierwszą — zamknięcie najnowszej świecy którejś serii. */
  lastPrice(): number {
    if (this.lastTradePx > 0) return this.lastTradePx;
    let t = Number.NEGATIVE_INFINITY;
    let px = 0;
    for (const s of this.seriesById.values()) {
      const c = s.candles[s.candles.length - 1];
      if (c && c.t > t) {
        t = c.t;
        px = c.c;
      }
    }
    return px > 0 ? px : (this.ctx?.markPx ?? 0);
  }

  /** Stawki finansowania od najstarszej świecy serii (najwyżej FUNDING_MAX_MS wstecz); pobrany okres nie jest pobierany drugi raz. */
  async requestFunding(oldest: number): Promise<void> {
    if (this.fundingLoading) return;
    const from = Math.max(oldest, this.apiNow() - FUNDING_MAX_MS);
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
    const now = this.apiNow();
    const day = utcDayStart(this.serverNow());
    if (this.dailyDay === day) return;
    this.dailyDay = day;
    const list = await this.candles('1d', now - DAILY_DAYS * DAY, now + DAY);
    if (list.length === 0 || list[list.length - 1].t < day) this.dailyDay = 0;
    if (list.length === 0) return;
    this.daily = list;
    this.bump();
  }

  // ───────────────────────── strumień ─────────────────────────

  private onMessage(channel: string, data: unknown, recvAt: number): void {
    if (channel === 'trades') {
      const fills = parseFills(data, this.coin);
      if (fills.length === 0) return;
      let newest = 0;
      let oldest = Number.POSITIVE_INFINITY;
      for (const f of fills) {
        newest = Math.max(newest, f.time);
        oldest = Math.min(oldest, f.time);
      }
      this.clock.observe(newest, recvAt);
      if (this.liveFrom === Number.POSITIVE_INFINITY) this.liveFrom = oldest;
      if (this.tradesPending) {
        // Pierwsza wiadomość po subskrypcji to migawka ostatnich transakcji, więc od najnowszej z nich taśma
        // jest kompletna — początek nagrania w zegarze giełdy, niezależnie od zegara przeglądarki
        this.tradesPending = false;
        this.coverage.open(newest);
        this.addressed.open(newest);
        this.zeroKnown.open(newest);
      }
      this.ingestFills(fills, recvAt);
    } else if (channel === 'candle') {
      const c = parseCandle(data);
      const d = data as { s?: unknown; i?: unknown } | null;
      const series = typeof d?.i === 'string' ? this.seriesById.get(d.i) : undefined;
      if (!c || d?.s !== this.coin || !series || series.loadState !== 'ready') return;
      series.mergeCandles([c]);
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
      // Dokładny arkusz: jakaś cena poza siatką bliskiej agregacji (rzadkie poziomy mogą mieć odstępy jak agregacja)
      const near = this.bookSteps[0];
      const exact = [...snap.bids, ...snap.asks].some((l) => Math.abs(l.px / near - Math.round(l.px / near)) > 1e-6);
      if (exact) {
        this.walls.observeBook(snap);
        this.exact.add(toFrame(snap, bookStep(snap)));
        this.bump();
        return;
      }
      const step = bookStep(snap);
      if (step !== this.bookSteps[0] && step !== this.bookSteps[1]) return;
      // Rynek, na którym bliska agregacja równa się tickowi: bliska migawka jest arkuszem dokładnym
      if (step === near && !this.exactSub) this.walls.observeBook(snap);
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
    // Historia arkusza w tych samych krokach zostaje (także wczytana z serwera przed pierwszą ceną)
    for (const step of [...this.books.keys()]) if (step !== steps[0] && step !== steps[1]) this.books.delete(step);
    this.bookSubs = [near, far].map((n): Subscription => ({ type: 'l2Book', coin: this.coin, nSigFigs: n }));
    this.exactSub = steps[0] > hlTick(price) * 1.5;
    if (this.exactSub) this.bookSubs.push({ type: 'l2Book', coin: this.coin });
    for (const sub of this.bookSubs) this.stream.add(sub);
  }

  /** Historia arkusza w agregacji bliskiej (~2 pb ceny) i dalekiej (10 × większy krok); null przed pierwszą migawką. */
  book(which: 'near' | 'far'): BookHistory | null {
    return this.books.get(this.bookSteps[which === 'near' ? 0 : 1]) ?? null;
  }

  /** Migawki arkusza bez agregacji ceny: osobny kanał albo bliska agregacja, gdy równa się tickowi. */
  exactBook(): BookHistory | null {
    return this.exactSub ? this.exact : this.book('near');
  }

  /** Delta agresorów w [from, to) (w jednej godzinie UTC) przyjęta przez animatorów rynku i resztę makerów. */
  makerSplit(from: number, to: number): MakerSplit | null {
    const h = Math.floor(from / HOUR_MS) * HOUR_MS;
    const minutes = Math.round(this.addressed.coveredMs(h, Math.min(h + HOUR_MS, this.serverNow())) / 60_000);
    return this.makers.split(from, to, minutes);
  }

  /** Początek strumienia na żywo w tej sesji (najstarsza transakcja jego pierwszej wiadomości); +∞ przed nią. */
  get liveSince(): number {
    return this.liveFrom;
  }

  /** Wejście transakcji (WebSocket albo zapis z przeglądarki). */
  ingestFills(fills: Fill[], recvAt = Date.now()): void {
    const sorted = fills.length > 1 ? [...fills].sort((a, b) => a.time - b.time) : fills;
    const { accepted } = this.tape.insert(sorted);
    if (accepted.length === 0) return;
    for (const f of accepted) {
      if (f.time < this.lastTradeT) continue;
      this.lastTradeT = f.time;
      this.lastTradePx = f.px;
    }
    for (const s of this.seriesById.values()) s.feedLive(accepted);
    this.walls.push(accepted);
    this.makers.add(accepted);
    this.orders.add(this.aggregator.push(accepted, this.clock.toServer(recvAt)));
    this.bump();
  }

  /** Wczytuje zapisaną taśmę i jej pokrycie (zapis nie ma adresów, więc nie odtwarza zleceń agresora). */
  restore(rows: readonly TradeRow[], spans: readonly Span[]): void {
    for (const [a, b] of spans) this.coverage.addSpan(a, b);
    const { accepted } = this.tape.insert(rows);
    // Bieżąca świeca mogła dostać starsze transakcje z zapisu
    if (accepted.length > 0) for (const s of this.seriesById.values()) s.rebuildLive();
    this.bump();
  }

  /**
   * Historia z serwera: taśma z pokryciem, otwarte pozycje i migawki arkusza, a zlecenia agresora i ściany (bez gór
   * lodowych — zapis nie ma dokładnego arkusza) tylko z transakcji, których nie widział strumień na żywo: nowych na taśmie
   * albo sprzed jego początku i jeszcze nie złożonych z historii (zapis przeglądarki nie ma adresów, więc nie ma zleceń).
   */
  restoreHistory(b: HistoryBatch): void {
    const tr = b.trades;
    if (tr) {
      for (const [a, z] of tr.spans) {
        this.coverage.addSpan(a, z);
        this.addressed.addSpan(a, z);
      }
      for (const [a, z] of tr.zeroSpans ?? []) this.zeroKnown.addSpan(a, z);
      const { accepted } = this.tape.insert(tr.fills);
      const fresh = new Set(accepted);
      const used = tr.fills.filter((f) => fresh.has(f) || (f.time < this.liveFrom && !this.derived.covers(f.time, f.time + 1)));
      this.derived.addSpan(tr.from, Math.min(tr.to, this.liveFrom));
      if (used.length > 0) {
        const agg = new OrderAggregator();
        this.orders.add([...agg.push(used, Number.NEGATIVE_INFINITY), ...agg.flush(0, true)]);
        this.walls.pushHistory(used);
        this.makers.add(used);
      }
      if (accepted.length > 0) for (const s of this.seriesById.values()) s.rebuildLive();
      this.oi.restore(tr.oi);
    }
    const bySteps = new Map<number, BookFrame[]>();
    // Arkusz dokładny z nagrania (BTC) do tej samej historii co migawki dokładne na żywo
    this.exact.restore(b.frames.filter((f) => f.exact));
    for (const f of b.frames) if (!f.exact) bySteps.set(f.step, [...(bySteps.get(f.step) ?? []), f]);
    for (const [step, list] of bySteps) {
      let h = this.books.get(step);
      if (!h) this.books.set(step, (h = new BookHistory(step)));
      h.restore(list);
    }
    this.bump();
  }

  /**
   * Powtórka: kolejny odcinek nagrania do chwili odtwarzania — taśma, pokrycie, zlecenia i otwarte pozycje jak historia
   * serwera, migawki arkusza dopisywane po kolei (rosnąco po czasie), ostatnia cena z ostatniej transakcji odcinka.
   */
  feedReplay(b: HistoryBatch): void {
    this.restoreHistory({ trades: b.trades, frames: [] });
    for (const f of b.frames) {
      if (f.exact) {
        this.exact.add(f);
        continue;
      }
      let h = this.books.get(f.step);
      if (!h) this.books.set(f.step, (h = new BookHistory(f.step)));
      h.add(f);
    }
    const last = b.trades?.fills[b.trades.fills.length - 1];
    if (last && last.time >= this.lastTradeT) {
      this.lastTradeT = last.time;
      this.lastTradePx = last.px;
    }
    this.bump();
  }

  // ───────────────────────── sprzątanie ─────────────────────────

  private prune(): void {
    const cut = this.serverNow() - RETENTION_MS;
    this.tape.prune(cut);
    this.coverage.prune(cut);
    this.derived.prune(cut);
    this.orders.prune(cut);
    this.addressed.prune(cut);
    this.zeroKnown.prune(cut);
    this.players.prune(cut);
    this.walls.prune(this.serverNow(), cut);
    this.oi.prune(cut);
    this.books.forEach((b) => b.prune(cut));
    this.exact.prune(cut);
    this.makers.prune(cut);
    for (const s of this.seriesById.values()) s.prune(cut);
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

/**
 * Świece jednego interwału rynku: historia z REST (doczytywana w lewo), bieżąca świeca z WebSocket
 * i footprint każdej świecy z taśmy magazynu rynku. Niezmienione świece zachowują referencję (tani diff na wykresie).
 */
export class CandleSeries {
  candles: Candle[] = [];
  loadState: LoadState = 'idle';
  /** Doczytywanie starszej historii w toku / historia wyczerpana (limit API). */
  loadingOlder = false;
  historyExhausted = false;
  private sub: Subscription | null = null;
  private loadSeq = 0;
  private fpCache = new Map<number, FpCacheEntry>();
  private barCache = new Map<number, ProBar>();
  /** Bieżąca (najnowsza) świeca liczona przyrostowo. */
  private live: FootprintBuilder | null = null;
  private liveFp: FootprintBar | null = null;
  private liveFpTrades = -1;

  constructor(
    private readonly m: ProStore,
    readonly interval: Interval
  ) {}

  /** Historia świec i subskrypcja bieżącej; drugi raz tylko po błędzie albo z `force`. */
  async load(force = false): Promise<void> {
    if (!force && (this.loadState === 'loading' || this.loadState === 'ready')) return;
    const m = this.m;
    const iv = this.interval;
    this.candles = [];
    this.fpCache = new Map();
    this.barCache = new Map();
    this.live = null;
    this.liveFp = null;
    this.liveFpTrades = -1;
    this.historyExhausted = false;
    this.loadState = 'loading';
    if (!this.sub) {
      this.sub = { type: 'candle', coin: m.coin, interval: iv.id };
      m.stream.add(this.sub);
    }
    m.bump();

    const seq = ++this.loadSeq;
    const now = m.apiNow();
    const list = await m.candles(iv.id, now - PAGE_BARS * iv.ms, now + iv.ms);
    if (seq !== this.loadSeq) return;
    if (list.length === 0) {
      this.loadState = 'error';
      m.bump();
      return;
    }
    this.mergeCandles(list);
    this.loadState = 'ready';
    m.bump();
    void m.requestFunding(this.candles[0].t);
  }

  /** Doczytuje starszą historię (przewinięcie wykresu w lewo). */
  async loadOlder(): Promise<void> {
    if (this.loadingOlder || this.historyExhausted || this.candles.length === 0) return;
    this.loadingOlder = true;
    const seq = this.loadSeq;
    const iv = this.interval;
    const first = this.candles[0].t;
    const list = await this.m.candles(iv.id, first - PAGE_BARS * iv.ms, first - 1);
    this.loadingOlder = false;
    if (seq !== this.loadSeq) return;
    const older = list.filter((c) => c.t < first);
    if (older.length === 0) this.historyExhausted = true;
    else this.mergeCandles(older);
    this.m.bump();
    void this.m.requestFunding(this.candles[0].t);
  }

  /** Po ponownym połączeniu: świece, które mogły przyjść w trakcie przerwy. */
  async refreshRecent(): Promise<void> {
    if (this.candles.length === 0) return;
    const iv = this.interval;
    const seq = this.loadSeq;
    const now = this.m.apiNow();
    const list = await this.m.candles(iv.id, now - 60 * iv.ms, now + iv.ms);
    if (seq !== this.loadSeq || list.length === 0) return;
    this.mergeCandles(list);
    this.m.bump();
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

  /** Bieżąca świeca od nowa z taśmy (taśma dostała starsze transakcje z zapisu). */
  rebuildLive(): void {
    if (this.live) this.live = this.buildFromTape(this.live.t);
  }

  /**
   * Bieżąca świeca liczona przyrostowo. Nowa świeca albo transakcja spóźniona względem już policzonych
   * → przeliczenie świecy z taśmy (taśma ma już całą paczkę).
   */
  feedLive(fills: readonly Fill[]): void {
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
    this.m.tape.forEach(t, t + ms, (time, px, sz, side) => {
      b ??= new FootprintBuilder(t, baseTick(px));
      b.add(time, px, sz, side);
    });
    return b ?? new FootprintBuilder(t);
  }

  private footprintFor(t: number): FootprintBar | null {
    const live = this.live;
    if (live && live.t === t) {
      if (this.liveFpTrades !== live.trades || this.liveFp?.t !== t) {
        this.liveFp = live.build();
        this.liveFpTrades = live.trades;
      }
      return this.liveFp;
    }
    const sig = this.m.tape.signature(t, t + this.interval.ms);
    const hit = this.fpCache.get(t);
    if (hit && hit.sig === sig) return hit.fp;
    const fp = sig === '0:0' ? null : this.buildFromTape(t).build();
    this.fpCache.set(t, { sig, fp });
    return fp;
  }

  /**
   * Świece z footprintem; niezmienione świece zachowują referencję (tani diff na wykresie). W powtórce tylko do chwili
   * odtwarzania, a bieżąca świeca z taśmy do tej chwili (świeca z API zna już resztę ruchu).
   */
  bars(): ProBar[] {
    const ms = this.interval.ms;
    const now = this.m.serverNow();
    const replay = this.m.replay !== null;
    const firstTape = this.m.tape.firstTime;
    const out: ProBar[] = [];
    for (const api of this.candles) {
      const t = api.t;
      if (replay && t > now) break;
      const end = Math.min(t + ms, now);
      // Świece sprzed nagrania nie mają taśmy — bez przeglądania pamięci podręcznej
      const fp = t + ms > firstTape ? this.footprintFor(t) : null;
      const prev = this.barCache.get(t);
      let c = api;
      if (replay && t + ms > now) {
        if (!fp) break;
        c = prev && prev.fp === fp ? prev.candle : fpCandle(t, fp);
      }
      const complete = fp !== null && this.m.coverage.covers(t, end);
      const share = fp && c.v > 0 ? (fp.buyVol + fp.sellVol) / c.v : Number.NaN;
      if (prev && prev.candle === c && prev.fp === fp && prev.complete === complete) {
        out.push(prev);
        continue;
      }
      const bar: ProBar = { t, candle: c, fp, share, complete };
      this.barCache.set(t, bar);
      out.push(bar);
    }
    return out;
  }

  /** Świece bez footprintu (źródło VWAP): w powtórce tylko do chwili odtwarzania, a bieżąca złożona z taśmy, jak w `bars()`. */
  candlesNow(): readonly Candle[] {
    if (!this.m.replay) return this.candles;
    const ms = this.interval.ms;
    const now = this.m.serverNow();
    const out: Candle[] = [];
    for (const c of this.candles) {
      if (c.t > now) break;
      if (c.t + ms <= now) {
        out.push(c);
        continue;
      }
      const fp = this.footprintFor(c.t);
      if (fp) out.push(fpCandle(c.t, fp));
      break;
    }
    return out;
  }

  prune(cut: number): void {
    const ms = this.interval.ms;
    this.fpCache.forEach((_v, t) => {
      if (t + ms < cut) this.fpCache.delete(t);
    });
  }
}

/** Świeca z footprintu (bieżąca świeca powtórki: z taśmy do chwili odtwarzania). */
function fpCandle(t: number, fp: FootprintBar): Candle {
  return { t, o: fp.open, h: fp.high, l: fp.low, c: fp.close, v: fp.buyVol + fp.sellVol, n: fp.trades };
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
