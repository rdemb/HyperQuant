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
  rvolOf,
  sessionNowOf,
  toVBars,
  twapShareOf,
  whaleBalanceOf,
} from './layoutNumbers';
import type { StationId } from './stations';
import { tr } from '../../../i18n';
import { capsOf, marketOf } from '../../../state/markets';
import { deskMarketOf } from '../../../config/deskMarkets';
import { type FrameRef, PERIOD_MS, dayFrame, ivbCalendarOf, toBar5 } from '../core/dayFrame';
import type { TapeRows } from '../core/effortZones';
import { utcDayStart } from '../core/sessions';
import { VALUE_MS, type ValueRef, type ValueSource, valueReference } from '../core/valueReference';
import { dayProfileOf, requestDayProfiles } from '../store/dayProfiles';
import { archiveMinutesOf } from '../store/archiveMinutes';
import { NAKED_HOUR_DAYS, NAKED_VALUE_DAYS, nakedPocs } from '../core/nakedPoc';
import type { FrameInput } from './dayFrameText';

/**
 * Wejścia liczb nagłówka układu z magazynu rynku wykresu i migawek skanera (czytane co kilka sekund przez LayoutHeader).
 * Tylko to, czego układ potrzebuje: świece 1m, 5m (z taśmą: jedno źródło wartości) albo 1h (seria wczytuje się przy
 * pierwszym użyciu, nieudane wczytanie ponawiamy co 30 s), arkusz, taśma. Magazyn opisany strukturalnie, więc test podaje
 * atrapę.
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
  /** Świece z footprintem taśmy (`complete` — świeca w całości nagrana); bez metody — bez taśmy. */
  bars?(): readonly { t: number; fp: TapeRows | null; complete: boolean }[];
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
  /** Kontekst rynku z WebSocket (ceny impact do spreadu Czwórki na rynkach bez skanera) */
  ctx?: { markPx: number; midPx: number; impactPxs?: [number, number] | null } | null;
  /** Powiadomienie odbiorców o nowych danych (magazyn wykresu); z nim pobieramy pliki taśmy zamkniętych dób. */
  bump?(): void;
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

const hasBump = (s: InputStore): s is InputStore & { bump(): void } => typeof s.bump === 'function';

/**
 * Pliki taśmy zamkniętych dób z serwera (profil doby rejestratora, 7 dób) dla magazynu wykresu, pobierane przy pierwszym
 * pytaniu; magazyn bez powiadomień (atrapa w teście) — bez plików.
 */
export function dayTapeOf(store: InputStore): ValueSource['dayTape'] {
  if (!hasBump(store)) return undefined;
  return (day) => {
    requestDayProfiles(store, day);
    const p = dayProfileOf(store, day);
    return p ? { day: p.day, tick: p.tick, lo: p.lo, buy: p.buy, sell: p.sell, minuteVol: p.mv } : null;
  };
}

/** Źródło wartości ze świec 5m `c5` od `from`: footprint świec w całości nagranych i pliki taśmy dób. */
export function valueSourceFrom(store: InputStore, c5: readonly Candle[], from: number): ValueSource {
  const tape = new Map<number, TapeRows>();
  for (const b of store.series('5m').bars?.() ?? []) if (b.t >= from && b.complete && b.fp) tape.set(b.t, b.fp);
  const bars = [];
  for (const c of c5) if (c.t >= from) bars.push({ t: c.t, l: c.l, h: c.h, v: c.v, tape: tape.get(c.t) ?? null });
  return { bars, ms: VALUE_MS, dayTape: dayTapeOf(store) };
}

/**
 * Jedno źródło wartości z magazynu rynku: świece 5m od `from` (doczytywane jak na wykresie) z taśmą. Świece w drodze —
 * undefined; nieudane pobranie — powód.
 */
export function valueSourceOf(store: InputStore, from: number, now: number): Got<ValueSource> | undefined {
  const c5 = candlesFrom(store, '5m', from, now);
  if (c5 === undefined || isAbsent(c5)) return c5;
  return valueSourceFrom(store, c5, from);
}

/** Powód braku wczorajszej wartości przy za małej liczbie świec 5m. */
export const prevValueWhy = (): string => tr('Świece 5m nie obejmują 90% wczorajszej doby UTC', "The 5m candles do not cover 90% of yesterday's UTC day");

/**
 * VAH, VAL i POC wczorajszej doby UTC z jednego źródła (`valueReference`) — te same liczby w pasku „Rama dnia”, panelu
 * „Najbliższe poziomy” i nagłówku Mapy dnia.
 */
export function prevDayValueOf(store: InputStore, now: number): Got<ValueRef> | undefined {
  const day = utcDayStart(now);
  const src = valueSourceOf(store, day - DAY, now);
  if (src === undefined || isAbsent(src)) return src;
  return valueReference('day', day - DAY, src, now) ?? { why: prevValueWhy() };
}

/**
 * Nagie POC Mapy dnia, warstwa jednego źródła wartości: profile dób z tylu ostatnich dób świec 5m (ok. 4 000 świec,
 * w limicie 5 000 świec API); starsze doby z archiwum 1m i świec 1h (`core/nakedPoc.ts`).
 */
export const NAKED_POC_DAYS = NAKED_VALUE_DAYS;

/**
 * Historia świec 30m paska „Rama dnia” w dobach: 70 dób kontekstu stanu z dobą VA przed nimi oraz 60 dób szerokości IVB
 * z 15 dobami ATR przed nimi (ok. 3 650 świec, w limicie 5000 świec API).
 */
export const FRAME_HISTORY_DAYS = 76;

/**
 * Wejście paska „Rama dnia” z magazynu rynku: świece 5m od wczoraj 00:00 UTC z taśmą (jedno źródło wartości: VA wczoraj
 * i dziś; stan od otwarcia sesji, IVB) i 30m z 76 dób (kontekst stanu i szerokości IVB), doczytywane jak na wykresie.
 * `ref` — odniesienie wartości (domyślnie wczorajsza doba UTC, opcjonalnie ta sama sesja wczoraj). Świece w drodze —
 * `frame` undefined; nieudane pobranie historii 30m — rama bez częstości i percentyla, z powodem.
 */
export function frameInputOf(store: InputStore, minutes: number, ref: FrameRef = 'day'): FrameInput {
  const now = store.serverNow();
  const coin = store.coin;
  const m = marketOf(coin);
  const base = { coin, now, szDecimals: m?.szDecimals };
  const day = utcDayStart(now);
  const c5 = candlesFrom(store, '5m', day - DAY, now);
  if (c5 === undefined || isAbsent(c5)) return { ...base, frame: c5 };
  const c30 = candlesFrom(store, '30m', day - FRAME_HISTORY_DAYS * DAY, now);
  if (c30 === undefined) return { ...base, frame: undefined };
  const cal = ivbCalendarOf(coin, deskMarketOf(coin)?.underlying ?? null, m?.class);
  const frame = dayFrame({
    b5: toBar5(c5, 5 * 60_000, now),
    src: valueSourceFrom(store, c5, day - DAY),
    c30: isAbsent(c30) ? [] : toBar5(c30, PERIOD_MS, now),
    now,
    cal,
    minutes,
    ref,
  });
  return { ...base, frame, historyWhy: isAbsent(c30) ? c30.why : null };
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
    // VA wczoraj z jednego źródła (jak pasek Rama dnia i panel Najbliższe poziomy), nagie POC z profili dób świec 5m
    x.prevDay = prevDayValueOf(store, now);
    // Nagie POC warstwami: do 14 dób jedno źródło (świece 5m z taśmą), starsze z archiwum 1m (BTC) i świec 1h (~200 dób)
    const src = valueSourceOf(store, utcDayStart(now) - NAKED_POC_DAYS * DAY, now);
    const c1h = candlesFrom(store, '1h', utcDayStart(now) - NAKED_HOUR_DAYS * DAY, now);
    if (src === undefined || isAbsent(src)) x.nakedPoc = pass(src);
    else if (c1h === undefined) x.nakedPoc = undefined;
    else if (lp > 0) {
      const hours = isAbsent(c1h) ? [] : c1h.map((c) => ({ t: c.t, l: c.l, h: c.h, v: c.v }));
      x.nakedPoc = nakedPocs({ now, price: lp, value: src, hours, minuteDay: archiveMinutesOf(store.coin) });
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
    // Migracja VA z jednego źródła wartości (świece 5m z taśmą, jak karta); bez świec 5m — świece 5m złożone z minut
    const v = valueSourceOf(store, previousSameSession(s).start, now);
    if (c1 === undefined || isAbsent(c1)) x.review = pass(c1);
    else if (v === undefined) x.review = undefined;
    else {
      const f = sessionFacts(toVBars(c1), s, now, isAbsent(v) ? undefined : v);
      x.review = isAbsent(f) ? f : { ...f, inProgress };
    }
    // Mapy z bloga opisują BTC (inny rynek: liczba mówi „tylko BTC”)
    if (capsOf(store.coin).blog) x.mapHits = mapHitsOf(store, scan.blog, s, now);
  }
  return x;
}
