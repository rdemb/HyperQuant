/**
 * Czwórka (Przed sesją): cztery liczby przed otwarciem sesji, każda z plakietką LIVE albo MODEL (MODEL z nazwą metody
 * w podpowiedzi), a brak danych — „—” z powodem, nigdy 0 ani liczba zastępcza.
 * (1) Czytelność wczoraj: typ dnia (Dalton) ostatniej zamkniętej sesji NY i trafienia jej mapy z bloga;
 * (2) paliwo 1% pod i nad ceną: USD likwidacji z kubełków mapy skanera (pozycje on-chain, tylko BTC);
 * (3) typowa szerokość najbliższej godziny sesji: mediana high − low tej samej godziny sesji z 20 dni świec 1h;
 * (4) odległość ceny od VWAP doby w σ.
 * Tu cała logika czterech liczb bez modułów wykresu (te same reguły co Rozliczenie: `sessionFacts`, `settleRange`,
 * `mapHitsText`; stan skanera z `scanState`, VWAP z `dayVwap`), wspólna dla karty Czwórki i serwera MCP; wejścia z magazynu
 * rynku wykresu składa `views/before/fourInputs`. Opis, nie sygnał.
 */
import { tr } from '../i18n';
import { DASH, fmtCompact, fmtFixed } from '../ui/format';
import { fmtPx } from '../charts/pro/core/footprintBar';
import { utcDayStart } from '../charts/pro/core/sessions';
import { fmtDayTime, fmtDm, fmtHm } from '../charts/pro/core/time';
import type { BlogMap, BlogMapsState } from '../state/useBlogMaps';
import type { VBar } from './auction';
import { vwapNum } from './dayVwap';
import { classifyDay } from './dayType';
import type { LiqMap } from './liqMap';
import { mapWindow, settleRange } from './mapSettlement';
import { RVOL_MIN_DAYS, median, nyClock } from './rvol';
import { liqScan, scannerAge } from './scanState';
import { type TradeSession, currentTradeSession, nextTradeSession, tradeSessionOn } from './sessionDay';
import { sessionFacts } from './sessionFacts';
import { TRADE_SESSION_NAME } from './sessionNames';
import { sessionMaps } from './sessionReview';
import { DAY_TYPE_LABEL, type Got, WAIT_TEXT, amt, blogMapName, isAbsent, mapHitsText, missingWhy } from './sessionText';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Okno typowej szerokości godziny: tyle poprzednich sesji tego samego typu (jak RVOL); próba od RVOL_MIN_DAYS. */
export const WIDTH_DAYS = 20;
/** Paliwo: ten ułamek ceny pod nią i nad nią. */
export const FUEL_BAND = 0.01;

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
  /** Obok plakietki: liczba tylko częściowo rozliczona („luka” w świecach 1m, jak w nagłówku Rozliczenia). */
  flag?: string;
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
  /** Świece 1h rynku rosnąco, od najwcześniejszej próby typowej szerokości godziny (`sessionHourSamples`). */
  bars1h?: Got<readonly VBar[]>;
  /** VWAP doby UTC ze świec 1m (jak nagłówek Kokpitu). */
  dayVwap?: Got<{ vwap: number; sd: number }>;
}

/** Wartość wejścia albo null (brak, wczytywanie). */
export const gotValue = <T>(v: Got<T> | undefined): T | null => (v === undefined || isAbsent(v) ? null : v);
/** Powód braku wejścia; wczytywane — „Czekam na dane…” (ten sam pomocnik co nagłówek układu: `missingWhy`). */
export const gotWhy = missingWhy;
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
  if (bars === undefined || isAbsent(bars)) return { why: gotWhy(bars) };
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
 * Rozliczenia. Przy luce w świecach 1m „X/Y” z uwagą „luka” jak w nagłówku Rozliczenia (`mapHitsText`).
 */
function mapHitsOf(x: FourInputs, ny: TradeSession): Got<{ value: string; hint: string; flag: string | null }> {
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
  if (bars === undefined || isAbsent(bars)) return { why: gotWhy(bars) };
  const name = `${blogMapName(m.kind)} ${fmtDayTime(m.publishedAt, x.now)}`;
  const r = settleRange(m.levels, bars, w.from, Math.min(w.to, ny.end), x.now);
  if (!r) return { why: tr(`${name}: świece 1m nie sięgają wpisu`, `${name}: the 1m candles do not reach the post`) };
  const t = mapHitsText(r.levels.filter((l) => l.touchedAt !== null).length, r.levels.length, r.complete);
  const gap = t.gap ? `; ${t.gap}` : '';
  return {
    value: t.value,
    flag: t.note,
    hint: tr(
      `${name}: ${t.value} poziomów dotkniętych od wpisu do końca sesji NY (świeca 1m Hyperliquid z low ≤ poziom ≤ high, jak ✓ na wykresie; poziomy z tekstu autora, nie model HyperQuant)${gap}`,
      `${name}: ${t.value} levels touched from the post to the end of the NY session (a Hyperliquid 1m candle with low ≤ level ≤ high, like the ✓ on the chart; levels from the author's post, not a HyperQuant model)${gap}`
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
  const flag = isAbsent(m) ? null : m.flag;
  return {
    id: 'clarity',
    title: tr('Czytelność wczoraj', "Yesterday's clarity"),
    value,
    // Typ dnia to model; sama mapa (bez typu dnia) to tekst autora rozliczony na świecach
    badge: !isAbsent(d) || isAbsent(m) ? 'MODEL' : 'LIVE',
    hint,
    ...(flag ? { flag } : {}),
  };
}

// ───────────────────────── (2) paliwo ±1% ─────────────────────────

/**
 * USD likwidacji z kubełków mapy (longi i shorty razem — liczy się cena, nie strona) w [p·(1 − band), p) i (p, p·(1 + band)],
 * domyślnie 1% (Czwórka; serwer MCP liczy też 3%). Cena kubełka to jego środek (jak histogram i klastry panelu mapy
 * likwidacji); kubełek dokładnie na cenie nie należy do żadnej strony.
 */
export function liqFuel(map: Pick<LiqMap, 'longs' | 'shorts' | 'stepUsd'>, price: number, band: number = FUEL_BAND): { below: number; above: number } {
  const lo = price * (1 - band);
  const hi = price * (1 + band);
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
  const p = gotValue(x.price);
  if (p === null || !(p > 0)) return { ...base, value: DASH, hint: gotWhy(x.price) };
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

/** Godzina sesji: świeca 1h od `hour`, jej sesja, czy sesja się w niej otwiera, `k` — pełne godziny od godziny otwarcia. */
export interface SessionHour {
  hour: number;
  s: TradeSession;
  opens: boolean;
  k: number;
}

/** Godzina, w której sesja się otwiera (świeca 1h z otwarciem: Londyn 08:00 czasu londyńskiego, NY 09:30 → pełna godzina przed). */
const openHour = (s: TradeSession) => Math.floor(s.start / HOUR) * HOUR;

/**
 * Do której sesji należy świeca 1h od pełnej godziny `h`: sesji, która się w niej otwiera (np. 14:00–15:00 UTC z otwarciem
 * NY o 14:30), inaczej sesji trwającej o `h`; w Azji null.
 */
export function sessionHourAt(h: number): { s: TradeSession; opens: boolean } | null {
  const day = utcDayStart(h);
  const opening = [tradeSessionOn(day, 'london'), tradeSessionOn(day, 'ny')].find((s) => s.start >= h && s.start < h + HOUR);
  if (opening) return { s: opening, opens: true };
  const s = currentTradeSession(h);
  return s ? { s, opens: false } : null;
}

/**
 * Najbliższa godzina sesji: pierwsza świeca 1h, która jeszcze się nie zaczęła i należy do sesji Londynu albo NY —
 * w sesji następna pełna godzina, w Azji (i po końcu NY o północy UTC) godzina otwarcia Londynu.
 */
export function nextSessionHour(now: number): SessionHour {
  let h = Math.floor(now / HOUR) * HOUR + HOUR;
  // Noc azjatycka trwa kilka godzin; dwie doby to zapas
  for (let i = 0; i < 48; i++, h += HOUR) {
    const a = sessionHourAt(h);
    if (a) return { hour: h, ...a, k: (h - openHour(a.s)) / HOUR };
  }
  const s = nextTradeSession(now);
  return { hour: openHour(s), s, opens: true, k: 0 };
}

/** Najdalej wstecz szukamy dni tego samego typu dla typowej szerokości (20 weekendów to ok. 70 dni) */
const WIDTH_LOOKBACK_DAYS = 80;

/**
 * Początki świec 1h tej samej godziny sesji z WIDTH_DAYS ostatnich wcześniejszych dni tego samego typu (robocze albo sobota
 * i niedziela według daty w Nowym Jorku), od najnowszej, szukane do 80 dni wstecz: godzina otwarcia albo k-ta pełna
 * godzina po niej według granic sesji danego dnia (`sessionDay` z czasem letnim), więc po zmianie czasu próba nadal jest
 * tą samą godziną sesji. Dzień, w którym ta godzina należy do innej sesji albo jest godziną otwarcia innej, odpada.
 */
export function sessionHourSamples(at: SessionHour): number[] {
  const day0 = utcDayStart(at.s.start);
  const weekend = nyClock(at.hour).weekend;
  const out: number[] = [];
  for (let i = 1; i <= WIDTH_LOOKBACK_DAYS && out.length < WIDTH_DAYS; i++) {
    const s = tradeSessionOn(day0 - i * DAY, at.s.id);
    const t = openHour(s) + at.k * HOUR;
    if (nyClock(t).weekend !== weekend) continue;
    const c = sessionHourAt(t);
    if (c && c.s.start === s.start && c.s.id === s.id && c.opens === at.opens) out.push(t);
  }
  return out;
}

/** Zakresy high − low zamkniętych świec 1h z próby `sessionHourSamples` (świece bez liczb odpadają), od najnowszej. */
export function hourWidthSample(bars1h: readonly VBar[], at: SessionHour, now: number): number[] {
  const want = new Set(sessionHourSamples(at).filter((t) => t + HOUR <= now));
  const xs: number[] = [];
  for (const b of bars1h) {
    if (!want.has(b.time)) continue;
    // Każda godzina raz (gdyby seria miała powtórzoną świecę)
    want.delete(b.time);
    if (Number.isFinite(b.high) && Number.isFinite(b.low) && b.high >= b.low) xs.push(b.high - b.low);
  }
  return xs;
}

/**
 * Typowa szerokość godziny sesji `at` (MODEL): mediana high − low zamkniętych świec 1h tej samej godziny sesji z 20 dni
 * tego samego typu (`hourWidthSample`). Mniej niż RVOL_MIN_DAYS próbek — `median: null`. `n` — liczba próbek.
 */
export function hourWidth(bars1h: readonly VBar[], at: SessionHour, now: number): { median: number | null; n: number } {
  const xs = hourWidthSample(bars1h, at, now);
  return { median: xs.length >= RVOL_MIN_DAYS ? median(xs) : null, n: xs.length };
}

/** Typ dni próby do opisu: dni robocze albo weekend (data w Nowym Jorku) */
const weekendWord = (t: number) => (nyClock(t).weekend ? tr('z weekendów', 'on weekends') : tr('z dni roboczych', 'on weekdays'));

/** (3) Typowa szerokość najbliższej godziny sesji w USD (MODEL · mediana 20 dni). */
export function hourWidthNum(x: FourInputs): FourNumber {
  const at = nextSessionHour(x.now);
  const { hour, s, opens, k } = at;
  const name = TRADE_SESSION_NAME[s.id];
  const m = tr('mediana 20 dni', '20-day median');
  const base = { id: 'hourWidth', title: `${tr('Szerokość', 'Width')} · ${name} ${fmtHm(hour)}`, badge: 'MODEL' } as const;
  const bars = x.bars1h;
  if (bars === undefined || isAbsent(bars)) return { ...base, value: DASH, hint: `MODEL · ${m}: ${gotWhy(bars)}` };
  const w = hourWidth(bars, at, x.now);
  if (w.median === null) {
    return {
      ...base,
      value: DASH,
      hint: tr(`MODEL · ${m}: za mało historii tej godziny sesji ${name} — ${w.n} sesji z min. ${RVOL_MIN_DAYS}`, `MODEL · ${m}: not enough history for this ${name} session hour — ${w.n} sessions of min. ${RVOL_MIN_DAYS}`),
    };
  }
  const p = gotValue(x.price);
  const share = p !== null && p > 0 ? tr(`, ${fmtFixed((w.median / p) * 100, 2)}% ceny`, `, ${fmtFixed((w.median / p) * 100, 2)}% of the price`) : '';
  const which = opens
    ? tr(`godzina otwarcia ${name} (otwarcie o ${fmtHm(s.start)})`, `the ${name} opening hour (open at ${fmtHm(s.start)})`)
    : tr(`${k}. pełna godzina po godzinie otwarcia ${name}`, `full hour ${k} after the ${name} opening hour`);
  return {
    ...base,
    value: `${amt(w.median)} USD`,
    hint: tr(
      `MODEL · ${m}: typowy zakres high − low świecy 1h ${fmtHm(hour)}–${fmtHm(hour + HOUR)} (${which}) z ${w.n} ostatnich sesji ${name} ${weekendWord(hour)}${share}. Każdego dnia ta sama godzina sesji, także po zmianie czasu. Zmienność godziny, nie kierunek ruchu.`,
      `MODEL · ${m}: the typical high − low range of the 1h candle ${fmtHm(hour)}–${fmtHm(hour + HOUR)} (${which}) over the last ${w.n} ${name} sessions ${weekendWord(hour)}${share}. The same session hour every day, also across clock changes. The hour's volatility, not the direction of the move.`
    ),
  };
}

// ───────────────────────── (4) od VWAP ─────────────────────────

/** (4) Cena wobec VWAP doby UTC w σ — liczba z nagłówka Kokpitu (`vwapNum`), z tytułem Czwórki. */
export function vwapFour(x: FourInputs): FourNumber {
  const n = vwapNum({ coin: x.coin, now: x.now, price: x.price, dayVwap: x.dayVwap });
  return { id: 'vwap', title: tr('Od VWAP', 'From VWAP'), value: n.value, badge: n.badge, hint: n.hint };
}

/** Cztery liczby Czwórki (zawsze cztery, brak danych — „—” z powodem). */
export function fourNumbers(x: FourInputs): FourNumbers {
  return { coin: x.coin, now: x.now, items: [clarityNum(x), fuelNum(x), hourWidthNum(x), vwapFour(x)] };
}

// ───────────────────────── tekst ─────────────────────────

/** Czwórka jako jedna linia tekstu: wszystkie cztery wartości z plakietkami (tekst alternatywny Klatki, zadanie 9). */
export function fourNumbersText(n: FourNumbers): string {
  const parts = n.items.map((i) => {
    const tag = i.value === DASH ? (i.note ?? tr('brak danych', 'no data')) : [i.badge, i.note, i.flag].filter(Boolean).join(', ');
    return `${i.title}: ${i.value} (${tag})`;
  });
  return `${tr('Czwórka', 'Four numbers')} ${n.coin}, ${fmtDm(n.now)} ${fmtHm(n.now)}: ${parts.join('; ')}.`;
}
