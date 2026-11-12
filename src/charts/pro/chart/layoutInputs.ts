import type { BlogMap, BlogMapsState } from '../../../state/useBlogMaps';
import type { LiqMap } from '../../../utils/liqMap';
import { mapWindow, settleRange } from '../../../utils/mapSettlement';
import type { WhaleLayer } from '../../../utils/whaleLayer';
import { type TradeSession, currentTradeSession, expectedCandlesFrom, previousSameSession } from '../../../utils/sessionDay';
import { expectedFrom, reviewSession, sessionFacts } from '../../../utils/sessionFacts';
import { nyMap } from '../../../utils/fourNumbers';
import { TRADE_SESSION_NAME } from '../../../utils/sessionNames';
import { sessionMaps } from '../../../utils/sessionReview';
import { RVOL_LOOKBACK_DAYS } from '../../../utils/rvol';
import type { BookFrame } from '../core/book';
import { liqLevels } from '../core/indicators';
import { DAY, fmtDm, fmtHm } from '../core/time';
import type { Candle, Side } from '../hl/parse';
import { marketCostBp } from '../indicators/registry';
import { blogMapScan, liqScan, whalesScan } from './layerSources';
import {
  type Absent,
  costAmount,
  costUsd,
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
import { capsOf } from '../../../state/markets';

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

/** Migawki skanera z wykresu (ProChart). */
export interface InputScan {
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

/**
 * Oczekiwany zakres sesji (MODEL „profil × poziom”) ze świec 1h tego rynku od `expectedCandlesFrom`, doczytywanych jak
 * na wykresie. Liczony ze świec zamkniętych przed godziną otwarcia, więc ten sam w toku i po zamknięciu sesji; liczba
 * i powód braku z `expectedFrom` (wspólne z serwerem MCP). Świece w drodze — undefined.
 */
function expectedOf(store: InputStore, s: TradeSession, now: number): Got<Expected> | undefined {
  const c1h = candlesFrom(store, '1h', expectedCandlesFrom(s), now);
  if (c1h === undefined || isAbsent(c1h)) return c1h;
  return expectedFrom(toVBars([...c1h]), s);
}

/** Oczekiwany zakres sesji `s` do rozliczenia (karta Rozliczenia) — ta sama liczba co budżet zakresu w nagłówku. */
export function sessionExpectedOf(store: InputStore, s: TradeSession): Got<Expected> | undefined {
  return expectedOf(store, s, store.serverNow());
}

/**
 * Poziomy mapy z bloga rozliczanej sesji `s` dotknięte od wpisu do końca tej sesji — ta sama reguła co ✓ warstwy i karta
 * Rozliczenia (`settleRange` na świecach 1m od wpisu, doczytywanych jak na wykresie). Mapa tej samej sesji co typ dnia
 * i migracja VA (w Azji — wczorajszego NY, nie dzisiejsza Mapa dnia): wybrana na wykresie, gdy należy do tej sesji, inaczej
 * mapa sesji (`nyMap`, jak Czwórka). Powody braku pliku jak w legendzie warstwy.
 */
function mapHitsOf(store: InputStore, blog: InputScan['blog'], s: TradeSession, now: number): LayoutInputs['mapHits'] {
  const st = blog.state;
  if (st.status !== 'ready') {
    const scan = blogMapScan(st, null);
    return 'why' in scan ? scan : undefined;
  }
  const list = sessionMaps(st.maps, s, now);
  const picked = blog.map && list.find((m) => m.id === blog.map!.id && mapWindow(m.kind, m.publishedAt));
  const map = picked ?? nyMap(st.maps, s, now);
  const sn = `${TRADE_SESSION_NAME[s.id]} ${fmtDm(s.start)}`;
  if (!map) {
    return list.length > 0
      ? { why: tr(`Mapa tygodnia albo weekendu — bez rozliczenia (sesja ${sn})`, `A weekly or weekend map — not settled (the ${sn} session)`) }
      : { why: tr(`Brak mapy z bloga dla sesji ${sn} (plik ma mapy z ostatnich 3 dni)`, `No blog map for the ${sn} session (the file holds maps from the last 3 days)`) };
  }
  const w = mapWindow(map.kind, map.publishedAt)!;
  const to = Math.min(w.to, s.end);
  const c1 = candlesFrom(store, '1m', w.from, now);
  if (c1 === undefined || isAbsent(c1)) return c1;
  const r = settleRange(map.levels, toVBars(c1), w.from, to, now);
  // Lista sięga wpisu albo historia API się skończyła — tu tylko ten drugi przypadek
  if (!r) return { why: tr(`Świece 1m nie sięgają wpisu (${fmtHm(w.from)}): limit historii API`, `The 1m candles do not reach the post (${fmtHm(w.from)}): API history limit`) };
  return { s, kind: map.kind, publishedAt: map.publishedAt, touched: r.levels.filter((l) => l.touchedAt !== null).length, total: r.levels.length, complete: r.complete, from: w.from, to };
}

/** Wejścia liczb układu `id`; `hawkes` liczy nagłówek w tle (Web Worker) i podaje gotowy. */
export function readInputs(id: StationId, store: InputStore, scan: InputScan, hawkes?: LayoutInputs['hawkes']): LayoutInputs {
  const now = store.serverNow();
  const lp = store.lastPrice();
  const x: LayoutInputs = { coin: store.coin, now, price: lp > 0 ? lp : undefined };
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
    x.expected = sn === undefined || isAbsent(sn) ? pass(sn) : expectedOf(store, sn.s, now);
  }
  if (id === 'cockpit' || id === 'fuel') {
    // Baza RVOL: 20 dni tego samego typu (weekend do ok. 70 dni wstecz), więc świece 1h z RVOL_LOOKBACK_DAYS dni
    const c1h = candlesFrom(store, '1h', Math.floor(now / 3_600_000) * 3_600_000 - (RVOL_LOOKBACK_DAYS + 1) * DAY, now);
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
      const usd = costUsd(store.coin);
      const ask = marketCostBp(f, usd, true);
      const bid = marketCostBp(f, usd, false);
      x.cost =
        Number.isFinite(ask) || Number.isFinite(bid)
          ? { ask, bid, at: f.t }
          : { why: tr(`20 poziomów arkusza nie mieści ${costAmount(usd)} USD po żadnej stronie`, `20 book levels cannot hold ${costAmount(usd)} USD on either side`) };
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
    if (capsOf(store.coin).blog) x.mapHits = mapHitsOf(store, scan.blog, s, now);
  }
  return x;
}
