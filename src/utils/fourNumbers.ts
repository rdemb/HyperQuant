/**
 * Czwórka (Przed sesją): cztery liczby przed otwarciem sesji, każda z plakietką LIVE albo MODEL (MODEL z nazwą metody
 * w podpowiedzi), a brak danych — „—” z powodem, nigdy 0 ani liczba zastępcza.
 * (1) Czytelność wczoraj: typ dnia (Dalton) ostatniej zamkniętej sesji NY i trafienia jej mapy z bloga;
 * (2) paliwo 1% pod i nad ceną: USD likwidacji z kubełków mapy skanera (pozycje on-chain, tylko BTC);
 * (3) typowa szerokość najbliższej godziny sesji: mediana high − low tej godziny UTC z 20 dni świec 1h;
 * (4) odległość ceny od VWAP doby w σ.
 * Te same reguły i pomocnicze funkcje co nagłówek układu i Rozliczenie sesji (`sessionFacts`, `settleRange`, `vwapNum`,
 * `candlesFrom`), więc liczba w Czwórce nie rozjeżdża się z tą na wykresie. Opis, nie sygnał.
 */
import { tr } from '../i18n';
import { DASH, fmtCompact, fmtFixed } from '../ui/format';
import { scannerAge, liqScan } from '../charts/pro/chart/layerSources';
import { fmtPx } from '../charts/pro/chart/layout';
import { type InputStore, candlesFrom, seriesCandles } from '../charts/pro/chart/layoutInputs';
import { dayVwapOf, vwapNum } from '../charts/pro/chart/layoutNumbers';
import { utcDayStart } from '../charts/pro/core/sessions';
import { fmtDayTime, fmtDm, fmtHm } from '../charts/pro/core/time';
import type { Candle } from '../charts/pro/hl/parse';
import type { BlogMap, BlogMapsState } from '../state/useBlogMaps';
import { type VBar, toVBars } from './auction';
import { classifyDay } from './dayType';
import type { LiqMap } from './liqMap';
import { mapWindow, settleRange } from './mapSettlement';
import { RVOL_MIN_DAYS, median } from './rvol';
import { type TradeSession, currentTradeSession, nextTradeSession, tradeSessionOn } from './sessionDay';
import { sessionFacts } from './sessionFacts';
import { TRADE_SESSION_NAME } from './sessionNames';
import { sessionMaps } from './sessionReview';
import { DAY_TYPE_LABEL, type Got, WAIT_TEXT, amt, blogMapName, isAbsent } from './sessionText';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Okno typowej szerokości godziny (dni) — jak RVOL; próba od RVOL_MIN_DAYS dni. */
const WIDTH_DAYS = 20;
/** Paliwo: ten ułamek ceny pod nią i nad nią. */
const FUEL_BAND = 0.01;

export type FourId = 'clarity' | 'fuel' | 'hourWidth' | 'vwap';

export interface FourNumber {
  id: FourId;
  /** Krótki tytuł. */
  title: string;
  /** Liczba albo opis; brak danych — „—”. */
  value: string;
  badge: 'LIVE' | 'MODEL';
  /** Zamiast tekstu plakietki: wiek migawki skanera starszej niż 2 min, „opóźnione” albo „tylko BTC”. */
  note?: string;
  /** Skąd liczba (MODEL: „MODEL · metoda: …”) albo powód braku. */
  hint: string;
}

/** Cztery liczby w stałej kolejności (1–4) dla rynku `coin` w chwili `now`. */
export interface FourNumbers {
  coin: string;
  now: number;
  items: readonly [FourNumber, FourNumber, FourNumber, FourNumber];
}

/** Wejścia Czwórki; pole `undefined` — jeszcze się wczytuje. */
export interface FourInputs {
  /** Rynek wykresu Przed sesją. */
  coin: string;
  now: number;
  /** Ostatnia cena rynku. */
  price?: Got<number>;
  /** Świece 1m rynku rosnąco, od otwarcia ostatniej sesji NY (z mapą z bloga — od jej wpisu, jeśli wcześniej). */
  bars1m?: Got<readonly VBar[]>;
  /** Mapy z bloga (BTC). */
  maps: BlogMapsState;
  /** Mapa likwidacji skanera (`useLiqMap`, BTC). */
  liq: { status: string; map: LiqMap | null };
  /** Świece 1h rynku rosnąco, od 20 dni przed najbliższą godziną sesji. */
  bars1h?: Got<readonly VBar[]>;
  /** VWAP doby UTC ze świec 1m (jak nagłówek Kokpitu). */
  dayVwap?: Got<{ vwap: number; sd: number }>;
}

const val = <T>(v: Got<T> | undefined): T | null => (v === undefined || isAbsent(v) ? null : v);
const whyOf = (v: Got<unknown> | undefined): string => (v !== undefined && isAbsent(v) ? v.why : WAIT_TEXT);
/** Zdanie z kropką na końcu (bez podwójnej po „…” albo „.”). */
const dot = (s: string) => (/[.…!?]$/.test(s) ? s : `${s}.`);

/** Ostatnia zamknięta sesja NY: NY kończy się o 00:00 UTC (spec §7.11), więc to zawsze NY poprzedniej doby UTC. */
export function lastClosedNy(now: number): TradeSession {
  return tradeSessionOn(utcDayStart(now) - DAY, 'ny');
}

/**
 * Mapa z bloga rozliczana na sesji NY `ny` (te same mapy co karta Rozliczenia tej sesji, tylko z oknem sesji): Mapa dnia,
 * inaczej Mapa przed NY, inaczej najnowsza inna; w każdym rodzaju najnowsza. Brak — null.
 */
export function nyMap(maps: readonly BlogMap[], ny: TradeSession, now: number): BlogMap | null {
  const rank = (m: BlogMap) => (m.kind === 'dzien' ? 2 : m.kind === 'ny' ? 1 : 0);
  let best: BlogMap | null = null;
  for (const m of sessionMaps(maps, ny, now)) {
    if (!mapWindow(m.kind, m.publishedAt)) continue;
    if (!best || rank(m) > rank(best) || (rank(m) === rank(best) && m.publishedAt > best.publishedAt)) best = m;
  }
  return best;
}

// ───────────────────────── (1) czytelność wczoraj ─────────────────────────

/** Typ dnia sesji NY ze świec 1m (fakty z `sessionFacts`, jak nagłówek Rozliczenia i karta sesji). */
function dayTypeOf(x: FourInputs, ny: TradeSession): Got<{ label: string; hint: string }> {
  const bars = x.bars1m;
  if (bars === undefined || isAbsent(bars)) return { why: whyOf(bars) };
  const f = sessionFacts(bars, ny, x.now);
  if (isAbsent(f)) return f;
  const t = classifyDay(f);
  if (t === 'unknown') return { why: tr('zakres IB zerowy albo brak liczb', 'zero IB range or missing numbers') };
  const k = fmtFixed((f.hi - f.lo) / (f.ibHi - f.ibLo), 1);
  return {
    label: DAY_TYPE_LABEL[t],
    hint: tr(
      `sesja NY ${fmtDm(ny.start)}, IB ${fmtPx(f.ibLo)}–${fmtPx(f.ibHi)}, zakres ${fmtPx(f.lo)}–${fmtPx(f.hi)} (${k}× IB), zamknięcie ${fmtPx(f.close)} — ${DAY_TYPE_LABEL[t]}`,
      `the NY session ${fmtDm(ny.start)}, IB ${fmtPx(f.ibLo)}–${fmtPx(f.ibHi)}, range ${fmtPx(f.lo)}–${fmtPx(f.hi)} (${k}× IB), close ${fmtPx(f.close)} — ${DAY_TYPE_LABEL[t]}`
    ),
  };
}

/**
 * Poziomy mapy sesji NY dotknięte od wpisu do końca sesji — `settleRange`, ta sama reguła co ✓ na wykresie i karta
 * Rozliczenia. Przy luce w świecach 1m brak liczby (dotknięcia znane tylko częściowo), z powodem.
 */
function mapHitsOf(x: FourInputs, ny: TradeSession): Got<{ value: string; hint: string }> {
  if (x.coin !== 'BTC') return { why: tr('tylko BTC (mapy z bloga opisują BTC)', 'BTC only (the blog maps describe BTC)') };
  const st = x.maps;
  if (st.status === 'loading') return { why: WAIT_TEXT };
  if (st.status === 'missing') return { why: tr('plik map z bloga niedostępny', 'the blog maps file is unavailable') };
  const m = nyMap(st.maps, ny, x.now);
  const w = m && mapWindow(m.kind, m.publishedAt);
  if (!m || !w) {
    return { why: tr(`Brak mapy z bloga dla sesji NY ${fmtDm(ny.start)} (plik ma mapy z ostatnich 3 dni)`, `No blog map for the NY session ${fmtDm(ny.start)} (the file holds maps from the last 3 days)`) };
  }
  const bars = x.bars1m;
  if (bars === undefined || isAbsent(bars)) return { why: whyOf(bars) };
  const name = `${blogMapName(m.kind)} ${fmtDayTime(m.publishedAt, x.now)}`;
  const r = settleRange(m.levels, bars, w.from, Math.min(w.to, ny.end), x.now);
  if (!r) return { why: tr(`${name}: świece 1m nie sięgają wpisu`, `${name}: the 1m candles do not reach the post`) };
  const hit = r.levels.filter((l) => l.touchedAt !== null).length;
  const n = r.levels.length;
  if (!r.complete) {
    return { why: tr(`${name}: luka w świecach 1m — dotknięte co najmniej ${hit} z ${n}, reszta nierozliczona`, `${name}: a gap in the 1m candles — at least ${hit} of ${n} touched, the rest unsettled`) };
  }
  return {
    value: `${hit}/${n}`,
    hint: tr(
      `${name}: ${hit}/${n} poziomów dotkniętych od wpisu do końca sesji NY (świeca 1m Hyperliquid z low ≤ poziom ≤ high, jak ✓ na wykresie; poziomy z tekstu autora, nie model HyperQuant)`,
      `${name}: ${hit}/${n} levels touched from the post to the end of the NY session (a Hyperliquid 1m candle with low ≤ level ≤ high, like the ✓ on the chart; levels from the author's post, not a HyperQuant model)`
    ),
  };
}

/** (1) Typ dnia ostatniej zamkniętej sesji NY i trafienia jej mapy z bloga: „trendowy · mapa 3/5”; brak części — „—” w niej. */
export function clarityNum(x: FourInputs): FourNumber {
  const ny = lastClosedNy(x.now);
  const d = dayTypeOf(x, ny);
  const m = mapHitsOf(x, ny);
  const map = tr('mapa', 'map');
  const value = isAbsent(d) && isAbsent(m) ? DASH : `${isAbsent(d) ? DASH : d.label} · ${map} ${isAbsent(m) ? DASH : m.value}`;
  const dayHint = `MODEL · Dalton: ${dot(isAbsent(d) ? d.why : d.hint)}`;
  const mapHint = isAbsent(m) ? `${tr('Mapa', 'Map')}: ${dot(m.why)}` : dot(m.hint);
  // Ten sam powód obu części (np. świece w drodze) raz
  const hint = isAbsent(d) && isAbsent(m) && d.why === m.why ? dayHint : `${dayHint} ${mapHint} ${tr('Opis, nie sygnał.', 'A description, not a signal.')}`;
  return {
    id: 'clarity',
    title: tr('Czytelność wczoraj', "Yesterday's clarity"),
    value,
    // Typ dnia to model; sama mapa (bez typu dnia) to tekst autora rozliczony na świecach
    badge: !isAbsent(d) || isAbsent(m) ? 'MODEL' : 'LIVE',
    hint,
  };
}

// ───────────────────────── (2) paliwo ±1% ─────────────────────────

/**
 * USD likwidacji z kubełków mapy (longi i shorty razem — liczy się cena, nie strona) w [p·0,99, p) i (p, p·1,01]. Cena
 * kubełka to jego środek (jak histogram i klastry panelu mapy likwidacji); kubełek dokładnie na cenie nie należy do żadnej strony.
 */
export function liqFuel(map: Pick<LiqMap, 'longs' | 'shorts' | 'stepUsd'>, price: number): { below: number; above: number } {
  const lo = price * (1 - FUEL_BAND);
  const hi = price * (1 + FUEL_BAND);
  let below = 0;
  let above = 0;
  for (const b of [...map.longs, ...map.shorts]) {
    const px = b.px + map.stepUsd / 2;
    if (px >= lo && px < price) below += b.ntlUsd;
    else if (px > price && px <= hi) above += b.ntlUsd;
  }
  return { below, above };
}

/** (2) Paliwo 1% pod i nad ceną z mapy likwidacji skanera: LIVE, po 2 min wiek migawki; poza BTC „—, tylko BTC”. */
export function fuelNum(x: FourInputs): FourNumber {
  const base = { id: 'fuel', title: tr('Paliwo ±1%', 'Fuel ±1%'), badge: 'LIVE' } as const;
  if (x.coin !== 'BTC') return { ...base, value: DASH, note: tr('tylko BTC', 'BTC only'), hint: tr('Tylko BTC: skaner mapuje pozycje na BTC', 'BTC only: the scanner maps BTC positions') };
  const ls = liqScan(x.liq);
  const map = x.liq.map;
  if ('why' in ls || !map) return { ...base, value: DASH, hint: 'why' in ls ? ls.why : WAIT_TEXT };
  const p = val(x.price);
  if (p === null || !(p > 0)) return { ...base, value: DASH, hint: whyOf(x.price) };
  const { below, above } = liqFuel(map, p);
  const delayed = x.liq.status === 'delayed';
  const note = scannerAge(map.asOf, x.now) ?? (delayed ? tr('opóźnione', 'delayed') : null);
  const late = delayed ? tr(' Połowa nominału z odczytów pozycji starszych niż 15 min — klastry mogły się przesunąć.', ' Half of the notional comes from position reads older than 15 min, so clusters may have moved.') : '';
  const share = `${fmtFixed(map.coverage.share * 100, 0)}%`;
  return {
    ...base,
    value: `${tr('pod', 'below')} ${fmtCompact(below)} · ${tr('nad', 'above')} ${fmtCompact(above)}`,
    hint: tr(
      `Mapa likwidacji skanera z pozycji on-chain Hyperliquid, stan z ${fmtHm(map.asOf)}: w 1% pod ceną ${fmtPx(p)} (do ${fmtPx(p * (1 - FUEL_BAND))}) ${fmtCompact(below)} USD likwidacji, w 1% nad nią (do ${fmtPx(p * (1 + FUEL_BAND))}) ${fmtCompact(above)} USD. Longi i shorty razem, po cenie kubełka; tylko pozycje śledzone przez skaner (${share} open interest).${late}`,
      `The scanner's liquidation map from Hyperliquid on-chain positions, as of ${fmtHm(map.asOf)}: within 1% below the price ${fmtPx(p)} (to ${fmtPx(p * (1 - FUEL_BAND))}) ${fmtCompact(below)} USD of liquidations, within 1% above it (to ${fmtPx(p * (1 + FUEL_BAND))}) ${fmtCompact(above)} USD. Longs and shorts together, by bucket price; only positions tracked by the scanner (${share} of open interest).${late}`
    ),
    ...(note ? { note } : {}),
  };
}

// ───────────────────────── (3) typowa szerokość godziny ─────────────────────────

/**
 * Najbliższa godzina sesji: pierwsza świeca 1h, która jeszcze się nie zaczęła i należy do sesji Londynu albo NY —
 * w sesji następna pełna godzina, w Azji (i po końcu NY o północy UTC) godzina otwarcia Londynu. Godzina, w której sesja
 * się otwiera (np. 14:00–15:00 UTC z otwarciem NY o 14:30), należy do otwieranej sesji (`opens`).
 */
export function nextSessionHour(now: number): { hour: number; s: TradeSession; opens: boolean } {
  let h = Math.floor(now / HOUR) * HOUR + HOUR;
  // Noc azjatycka trwa kilka godzin; dwie doby to zapas
  for (let i = 0; i < 48; i++, h += HOUR) {
    const day = utcDayStart(h);
    const opening = [tradeSessionOn(day, 'london'), tradeSessionOn(day, 'ny')].find((s) => s.start >= h && s.start < h + HOUR);
    if (opening) return { hour: h, s: opening, opens: true };
    const s = currentTradeSession(h);
    if (s) return { hour: h, s, opens: false };
  }
  const s = nextTradeSession(now);
  return { hour: Math.floor(s.start / HOUR) * HOUR, s, opens: true };
}

/**
 * Typowa szerokość godziny `hour` (MODEL): mediana high − low zamkniętych świec 1h z tej samej godziny UTC z 20 dni przed
 * nią (świece bez liczb odpadają). Mniej niż RVOL_MIN_DAYS próbek — `median: null` (nie zgadujemy). `n` — liczba próbek.
 */
export function hourWidth(bars1h: readonly VBar[], hour: number, now: number): { median: number | null; n: number } {
  const slot = ((hour % DAY) + DAY) % DAY;
  const from = hour - WIDTH_DAYS * DAY;
  const xs: number[] = [];
  for (const b of bars1h) {
    if (b.time < from || b.time >= hour || b.time + HOUR > now || ((b.time % DAY) + DAY) % DAY !== slot) continue;
    if (Number.isFinite(b.high) && Number.isFinite(b.low) && b.high >= b.low) xs.push(b.high - b.low);
  }
  return { median: xs.length >= RVOL_MIN_DAYS ? median(xs) : null, n: xs.length };
}

/** (3) Typowa szerokość najbliższej godziny sesji w USD (MODEL · mediana 20 dni). */
export function hourWidthNum(x: FourInputs): FourNumber {
  const { hour, s, opens } = nextSessionHour(x.now);
  const name = TRADE_SESSION_NAME[s.id];
  const m = tr('mediana 20 dni', '20-day median');
  const base = { id: 'hourWidth', title: `${tr('Szerokość', 'Width')} · ${name} ${fmtHm(hour)}`, badge: 'MODEL' } as const;
  const bars = x.bars1h;
  if (bars === undefined || isAbsent(bars)) return { ...base, value: DASH, hint: `MODEL · ${m}: ${whyOf(bars)}` };
  const hh = `${String(new Date(hour).getUTCHours()).padStart(2, '0')}:00 UTC`;
  const w = hourWidth(bars, hour, x.now);
  if (w.median === null) {
    return {
      ...base,
      value: DASH,
      hint: tr(`MODEL · ${m}: za mało historii godziny ${hh} — ${w.n} dni z min. ${RVOL_MIN_DAYS}`, `MODEL · ${m}: not enough history for the ${hh} hour — ${w.n} days of min. ${RVOL_MIN_DAYS}`),
    };
  }
  const p = val(x.price);
  const share = p !== null && p > 0 ? tr(`, ${fmtFixed((w.median / p) * 100, 2)}% ceny`, `, ${fmtFixed((w.median / p) * 100, 2)}% of the price`) : '';
  const when = opens ? tr(`otwarcie ${name} o ${fmtHm(s.start)}`, `the ${name} open at ${fmtHm(s.start)}`) : tr(`sesja ${name}`, `the ${name} session`);
  return {
    ...base,
    value: `${amt(w.median)} USD`,
    hint: tr(
      `MODEL · ${m}: typowy zakres high − low świecy 1h ${fmtHm(hour)}–${fmtHm(hour + HOUR)} (${hh}, ${when}) z ${w.n} ostatnich dni${share}. Zmienność godziny, nie kierunek ruchu.`,
      `MODEL · ${m}: the typical high − low range of the 1h candle ${fmtHm(hour)}–${fmtHm(hour + HOUR)} (${hh}, ${when}) over the last ${w.n} days${share}. The hour's volatility, not the direction of the move.`
    ),
  };
}

// ───────────────────────── (4) odległość od VWAP ─────────────────────────

/** (4) Cena wobec VWAP doby UTC w σ — liczba z nagłówka Kokpitu (`vwapNum`), z tytułem Czwórki. */
export function vwapFour(x: FourInputs): FourNumber {
  const n = vwapNum({ coin: x.coin, now: x.now, price: x.price, dayVwap: x.dayVwap });
  return { id: 'vwap', title: tr('Od VWAP', 'From VWAP'), value: n.value, badge: n.badge, hint: n.hint };
}

// ───────────────────────── całość ─────────────────────────

/** Cztery liczby Czwórki (zawsze cztery, brak danych — „—” z powodem). */
export function fourNumbers(x: FourInputs): FourNumbers {
  return { coin: x.coin, now: x.now, items: [clarityNum(x), fuelNum(x), hourWidthNum(x), vwapFour(x)] };
}

/** Czwórka jako jedna linia tekstu: wszystkie cztery wartości z plakietkami (tekst alternatywny Klatki, zadanie 9). */
export function fourNumbersText(n: FourNumbers): string {
  const parts = n.items.map((i) => {
    const tag = i.value === DASH ? (i.note ?? tr('brak danych', 'no data')) : i.note ? `${i.badge}, ${i.note}` : i.badge;
    return `${i.title}: ${i.value} (${tag})`;
  });
  return `${tr('Czwórka', 'Four numbers')} ${n.coin}, ${fmtDm(n.now)} ${fmtHm(n.now)}: ${parts.join('; ')}.`;
}

// ───────────────────────── wejścia z magazynu ─────────────────────────

const vbars = (c: Got<readonly Candle[]> | undefined): Got<readonly VBar[]> | undefined => (c === undefined || isAbsent(c) ? c : toVBars(c));

/**
 * Wejścia Czwórki z magazynu rynku wykresu (jak nagłówek układu): świece 1m od otwarcia ostatniej sesji NY, a z mapą z bloga
 * (BTC) od jej wpisu, jeśli wcześniej; świece 1h od 20 dni przed najbliższą godziną sesji (seria doczytuje starsze strony,
 * do tego czasu — undefined); VWAP doby ze świec 1m już wczytanych (jak Kokpit, bez czekania na starsze strony).
 */
export function readFourInputs(store: InputStore, liq: FourInputs['liq'], maps: BlogMapsState): FourInputs {
  const now = store.serverNow();
  const lp = store.lastPrice();
  const ny = lastClosedNy(now);
  const m = store.coin === 'BTC' && maps.status === 'ready' ? nyMap(maps.maps, ny, now) : null;
  const w = m && mapWindow(m.kind, m.publishedAt);
  const live = seriesCandles(store, '1m', now);
  return {
    coin: store.coin,
    now,
    price: lp > 0 ? lp : undefined,
    bars1m: vbars(candlesFrom(store, '1m', w ? Math.min(ny.start, w.from) : ny.start, now)),
    maps,
    liq,
    bars1h: vbars(candlesFrom(store, '1h', nextSessionHour(now).hour - WIDTH_DAYS * DAY, now)),
    dayVwap: live === undefined || isAbsent(live) ? live : dayVwapOf(live, now),
  };
}
