import type { BlogMap, BlogMapsState } from '../../../state/useBlogMaps';
import type { LiqMap } from '../../../utils/liqMap';
import { mapWindow, settleRange } from '../../../utils/mapSettlement';
import type { VolModel } from '../../../utils/volatility';
import type { WhaleLayer } from '../../../utils/whaleLayer';
import { type TradeSession, currentTradeSession, expectedRange, previousSameSession } from '../../../utils/sessionDay';
import { reviewSession, sessionFacts } from '../../../utils/sessionFacts';
import type { BookFrame } from '../core/book';
import { liqLevels } from '../core/indicators';
import { fmtHm } from '../core/time';
import type { Candle, Side } from '../hl/parse';
import { marketCostBp } from '../indicators/registry';
import { blogMapScan, liqScan, whalesScan } from './layerSources';
import {
  type Absent,
  COST_USD,
  type Expected,
  FLOW_WINDOW_MS,
  type Got,
  type LayoutInputs,
  dayVwapOf,
  isAbsent,
  liqNearestOf,
  nakedPocOf,
  prevDayOf,
  profileStep,
  rvolOf,
  sessionNowOf,
  toVBars,
  twapShareOf,
  whaleBalanceOf,
} from './layoutNumbers';
import type { StationId } from './stations';
import { tr } from '../../../i18n';

/**
 * Wejścia liczb nagłówka układu z magazynu rynku wykresu i migawek skanera (czytane co kilka sekund przez LayoutHeader).
 * Tylko to, czego układ potrzebuje: świece 1m, 5m albo 1h (seria wczytuje się przy pierwszym użyciu, nieudane wczytanie
 * ponawiamy co 30 s), arkusz, taśma. Magazyn opisany strukturalnie, więc test podaje atrapę.
 */

/** Seria świec magazynu (CandleSeries). */
export interface InputSeries {
  loadState: 'idle' | 'loading' | 'ready' | 'error';
  load(): Promise<void>;
  candlesNow(): readonly Candle[];
  /** Starszej historii już nie ma (limit API). */
  historyExhausted?: boolean;
  /** Ostatnie doczytanie starszej strony się nie udało; seria ponawia je po 30 s. */
  olderFailed?: boolean;
}

/** Część magazynu rynku (ProStore), z której liczymy liczby nagłówka. */
export interface InputStore {
  coin: string;
  serverNow(): number;
  lastPrice(): number;
  series(id: string): InputSeries;
  /** Świece interwału od `from` (seria doczytuje starszą historię, jak warstwy wykresu). */
  indicatorCandles(id: string, from: number): readonly Candle[];
  exactBook(): { latest(): BookFrame | null } | null;
  zeroKnown: { covers(from: number, to: number): boolean };
  orders: { range(from: number, to: number): readonly { notional: number; side: Side; zero?: true }[] };
}

/** Migawki skanera i model zmienności z wykresu (ProChart). */
export interface InputScan {
  model: VolModel | null;
  liq: { status: string; map: LiqMap | null };
  whales: WhaleLayer | null;
  /** Build ma adres danych skanera. */
  whalesConfigured: boolean;
  /** Mapy z bloga i mapa wybrana na wykresie (`pickMap` z ustawieniem `blogMapId`). */
  blog: { state: BlogMapsState; map: BlogMap | null };
}

/** Migawka arkusza starsza niż tyle ms jest nieaktualna (zerwane połączenie), jak w Stanie rynku. */
export const BOOK_STALE_MS = 30_000;
/** Ponowne wczytanie serii świec po błędzie najwcześniej po tylu ms. */
export const RETRY_MS = 30_000;

/** Chwila następnej próby wczytania serii po błędzie (seria → ms). */
const retryAt = new WeakMap<InputSeries, number>();

/**
 * Świece interwału `id` z magazynu: seria wczytuje się przy pierwszym użyciu, po błędzie ponownie co RETRY_MS (z powodem
 * do tego czasu); w trakcie wczytywania — undefined.
 */
export function seriesCandles(store: InputStore, id: string, now: number): Got<readonly Candle[]> | undefined {
  const s = store.series(id);
  if (s.loadState === 'idle') void s.load();
  if (s.loadState === 'error') {
    const at = retryAt.get(s);
    if (at === undefined) retryAt.set(s, now + RETRY_MS);
    else if (now >= at) {
      retryAt.set(s, now + RETRY_MS);
      void s.load();
    }
    return { why: tr(`Nie udało się pobrać świec ${id} z Hyperliquid — kolejna próba za ≤ 30 s`, `Could not load ${id} candles from Hyperliquid — next attempt within 30 s`) };
  }
  retryAt.delete(s);
  return s.loadState === 'ready' ? s.candlesNow() : undefined;
}

/**
 * Świece interwału `id` od `from` (seria doczytuje starsze strony): pełna lista, gdy sięga `from` albo historia API się
 * skończyła; w trakcie doczytywania — undefined; nieudane doczytanie — powód z ponowną próbą (nigdy liczba z części danych).
 */
export function candlesFrom(store: InputStore, id: string, from: number, now: number): Got<readonly Candle[]> | undefined {
  const c = seriesCandles(store, id, now);
  if (c === undefined || isAbsent(c)) return c;
  const list = store.indicatorCandles(id, from);
  if (list.length > 0 && list[0].t <= from) return list;
  const s = store.series(id);
  if (s.olderFailed) return { why: tr(`Nie udało się pobrać starszych świec ${id} — kolejna próba za ≤ 30 s`, `Could not load older ${id} candles — next attempt within 30 s`) };
  return s.historyExhausted ? list : undefined;
}

/** Brak albo wczytywanie wejścia, od którego zależy liczba (gotowe wejście — tu nie trafia). */
const pass = (v: Got<unknown> | undefined): Absent | undefined => (v !== undefined && isAbsent(v) ? v : undefined);

/** Oczekiwany zakres sesji: z modelem HAR (BTC) od razu, bez niego ze świec 5m tego rynku (Parkinson) do chwili `asOf`. */
function expectedOf(store: InputStore, model: VolModel | null, s: TradeSession, now: number, asOf: number, price: number): Got<Expected> | undefined {
  let bars5m: Candle[] = [];
  if (!model) {
    const c5 = seriesCandles(store, '5m', now);
    if (c5 === undefined || isAbsent(c5)) return c5;
    bars5m = [...c5];
  }
  const e = expectedRange(model, toVBars(bars5m), s, asOf, price);
  if (e) return e;
  return {
    why: model
      ? tr('Model HAR nie daje zmienności dla tej sesji', 'The HAR model gives no volatility for this session')
      : asOf < now
        ? tr('Bez modelu HAR, a za mało zamkniętych świec 5m z doby przed sesją (min. 12)', 'No HAR model and too few closed 5m candles from the day before the session (min. 12)')
        : tr('Bez modelu HAR, a za mało zamkniętych świec 5m z ostatniej doby (min. 12)', 'No HAR model and too few closed 5m candles from the last day (min. 12)'),
  };
}

/**
 * Oczekiwany zakres sesji do rozliczenia (MODEL): sesja w toku — ta sama metoda co budżet zakresu na żywo (HAR, bez modelu
 * Parkinson), oczekiwanie na teraz; zamknięta — zawsze ex ante: Parkinson ze świec 5m z doby przed jej otwarciem (model HAR
 * zna tylko dzisiejszy poziom zmienności, nie prognozę sprzed tamtej sesji). Świece 5m w drodze — undefined.
 */
export function sessionExpectedOf(store: InputStore, model: VolModel | null, s: TradeSession, inProgress: boolean, price: number): Got<Expected> | undefined {
  const now = store.serverNow();
  return inProgress ? expectedOf(store, model, s, now, now, price) : expectedOf(store, null, s, now, s.start, price);
}

/**
 * Poziomy mapy z bloga wybranej na wykresie dotknięte w jej oknie — ta sama reguła co ✓ warstwy (`settleRange` na świecach 1m
 * od wpisu, doczytywanych jak na wykresie). Powody braku jak w legendzie warstwy.
 */
function mapHitsOf(store: InputStore, blog: InputScan['blog'], now: number): LayoutInputs['mapHits'] {
  const scan = blogMapScan(blog.state, blog.map);
  if ('why' in scan) return scan;
  const map = blog.map;
  if (!map) return undefined;
  const w = mapWindow(map.kind, map.publishedAt);
  if (!w) return { why: tr('Mapa tygodnia albo weekendu — bez rozliczenia', 'A weekly or weekend map — not settled') };
  const c1 = candlesFrom(store, '1m', w.from, now);
  if (c1 === undefined || isAbsent(c1)) return c1;
  const r = settleRange(map.levels, toVBars(c1), w.from, w.to, now);
  // Lista sięga wpisu albo historia API się skończyła — tu tylko ten drugi przypadek
  if (!r) return { why: tr(`Świece 1m nie sięgają wpisu (${fmtHm(w.from)}): limit historii API`, `The 1m candles do not reach the post (${fmtHm(w.from)}): API history limit`) };
  return { kind: map.kind, publishedAt: map.publishedAt, touched: r.levels.filter((l) => l.touchedAt !== null).length, total: r.levels.length, complete: r.complete, from: w.from, to: w.to };
}

/** Wejścia liczb układu `id`; `hawkes` liczy nagłówek w tle (Web Worker) i podaje gotowy. */
export function readInputs(id: StationId, store: InputStore, scan: InputScan, hawkes?: LayoutInputs['hawkes']): LayoutInputs {
  const now = store.serverNow();
  const lp = store.lastPrice();
  const x: LayoutInputs = { coin: store.coin, now, price: lp > 0 ? lp : undefined };
  // Model zmienności Desku liczy BTC; inne rynki — Parkinson z własnych świec
  const model = store.coin === 'BTC' ? scan.model : null;
  if (id === 'cockpit' || id === 'auction-open') {
    const c1 = seriesCandles(store, '1m', now);
    if (c1 !== undefined && !isAbsent(c1)) {
      x.dayVwap = dayVwapOf(c1, now);
      x.session = sessionNowOf(c1, now);
    } else {
      x.dayVwap = pass(c1);
      // Sesja azjatycka: powód nie zależy od świec
      x.session = currentTradeSession(now) ? pass(c1) : sessionNowOf([], now);
    }
    const sn = x.session;
    x.expected = sn === undefined || isAbsent(sn) ? pass(sn) : expectedOf(store, model, sn.s, now, now, lp > 0 ? lp : sn.close);
  }
  if (id === 'cockpit' || id === 'fuel') {
    const c1h = seriesCandles(store, '1h', now);
    x.rvol = c1h === undefined || isAbsent(c1h) ? pass(c1h) : rvolOf(c1h, now);
  }
  if (id === 'day-map') {
    const c1h = seriesCandles(store, '1h', now);
    if (c1h === undefined || isAbsent(c1h) || !(lp > 0)) {
      x.prevDay = x.nakedPoc = pass(c1h);
    } else {
      const step = profileStep(lp);
      x.prevDay = prevDayOf(c1h, now, step);
      x.nakedPoc = nakedPocOf(c1h, now, lp, step);
    }
  }
  if (id === 'fuel') {
    const ls = liqScan(scan.liq);
    if (lp > 0) x.liq = 'why' in ls ? ls : liqNearestOf(liqLevels(scan.liq.map!), lp, ls.asOf);
    const f = store.exactBook()?.latest() ?? null;
    if (!f) x.cost = undefined;
    else if (now - f.t > BOOK_STALE_MS) x.cost = { why: tr(`Migawka arkusza z ${fmtHm(f.t)} nieaktualna (połączenie?)`, `Book snapshot from ${fmtHm(f.t)} is stale (connection?)`) };
    else {
      const ask = marketCostBp(f, COST_USD, true);
      const bid = marketCostBp(f, COST_USD, false);
      x.cost = Number.isFinite(ask) || Number.isFinite(bid) ? { ask, bid, at: f.t } : { why: tr('20 poziomów arkusza nie mieści 100 000 USD po żadnej stronie', '20 book levels cannot hold 100,000 USD on either side') };
    }
  }
  if (id === 'big-hands') {
    const from = now - FLOW_WINDOW_MS;
    x.twap = store.zeroKnown.covers(from, now)
      ? twapShareOf(store.orders.range(from, now))
      : { why: tr('Taśma bez znaczników TWAP (hash zerowy) w całych ostatnich 15 min', 'The tape lacks TWAP marks (zero hash) over the whole last 15 min') };
    x.hawkes = hawkes;
    const ws = whalesScan(scan.whales, store.coin, scan.whalesConfigured);
    x.whales = 'why' in ws ? ws : whaleBalanceOf(scan.whales!.markets[store.coin].positions, ws.asOf);
  }
  if (id === 'review') {
    // Te same fakty co karta Rozliczenia sesji: świece 1m od otwarcia poprzedniej sesji tego samego typu (migracja VA)
    const { s, inProgress } = reviewSession(now);
    const c1 = candlesFrom(store, '1m', previousSameSession(s).start, now);
    if (c1 === undefined || isAbsent(c1)) x.review = pass(c1);
    else {
      const f = sessionFacts(toVBars(c1), s, now);
      x.review = isAbsent(f) ? f : { ...f, inProgress };
    }
    // Mapy z bloga opisują BTC (inny rynek: liczba mówi „tylko BTC”)
    if (store.coin === 'BTC') x.mapHits = mapHitsOf(store, scan.blog, now);
  }
  return x;
}
