/**
 * Narzędzie `market_brief`: skrót przed sesją jak ekran Przed sesją HyperQuant. Czwórka (czytelność wczoraj, paliwo ±1%,
 * typowa szerokość najbliższej godziny sesji, odległość od VWAP doby) z tej samej funkcji co karta Czwórki (`fourNumbers`
 * z `src/utils`), poziomy dzisiejszej Mapy dnia z bloga (`pickMap`, jak `day_map`) oraz VAH, POC i VAL poprzedniej sesji
 * (`prevSessionProfile`, jak Kontekst aukcji), sesja w toku i najbliższe otwarcie. Tu tylko pobranie wejść (pliki publiczne,
 * świece Hyperliquid) w miejsce magazynu strony i te same liczby jako `Num`. Z argumentem `level` także poziom wobec ceny,
 * VWAP i mapy likwidacji, z tych samych wejść (bez dodatkowego pobierania).
 */
import * as z from 'zod';
import { utcDayStart } from '../../../src/charts/pro/core/sessions';
import type { Candle } from '../../../src/charts/pro/hl/parse';
import { tr } from '../../../src/i18n';
import { pickMap } from '../../../src/utils/blogMaps';
import { DASH, fmtPrice } from '../../../src/ui/format';
import { PROFILE_STEP, VA_PCT, toVBars } from '../../../src/utils/auction';
import { dayVwapOf, vwapSigma } from '../../../src/utils/dayVwap';
import {
  type FourId,
  type FourInputs,
  type FourNumber,
  type SessionHour,
  fourNumbers,
  gotValue,
  gotWhy,
  hourWidth,
  hourWidthSample,
  lastClosedNy,
  liqFuel,
  nextSessionHour,
  sessionHourSamples,
} from '../../../src/utils/fourNumbers';
import { bootstrapMedian80 } from '../../../src/utils/rvol';
import { LIQ_MAP_RANGE, type LiqMap, isLiqMap } from '../../../src/utils/liqMap';
import { liqMapFreshness } from '../../../src/utils/liqMapView';
import { type TradeSession, type TradeSessionId, currentTradeSession, nextTradeSession, previousSameSession } from '../../../src/utils/sessionDay';
import { prevSessionProfile, reviewSession } from '../../../src/utils/sessionFacts';
import { TRADE_SESSION_NAME } from '../../../src/utils/sessionNames';
import { type Got, blogMapName, isAbsent } from '../../../src/utils/sessionText';
import { type Envelope, type Num, type SourceRef, envelope, iso, num } from '../envelope';
import { guardedLabel, levelsCutNote } from '../external';
import type { BlogMapsCut, Fetched, Sources } from '../sources';
import type { ToolDef } from './index';
import { BLOG_LEVEL_NOTE, ageNote, candleSource, candlesGot, fileSource } from './shared';

const NAME = 'market_brief';

export interface BriefItem {
  id: FourId;
  title: string;
  /** Jedna liczba pozycji (szerokość godziny w USD, odległość od VWAP w σ); null — czytelność (opis) i paliwo (dwie liczby w `parts`). */
  value: Num | null;
  /** Wartość jak na karcie Czwórki („trendowy · mapa 2/4”, „pod 3,5M · nad 3,4M”); brak danych — „—”. */
  text: string;
  badge: 'LIVE' | 'MODEL';
  /** Skąd liczba (MODEL z metodą) albo powód braku — podpowiedź karty. */
  hint: string;
  /** Zamiast plakietki na karcie: wiek migawki skanera starszej niż 2 min albo „opóźnione”. */
  note: string | null;
  /** Liczba rozliczona tylko częściowo (luka w świecach 1m). */
  flag: string | null;
  /** Paliwo: USD likwidacji w 1% pod ceną i nad nią (pełne dolary). */
  parts?: { below: Num; above: Num };
}

export interface BriefLevel {
  /** Etykieta; null — wstrzymana przez strażnika treści (powód w `labelWhy`), cena zostaje. */
  label: string | null;
  labelWhy: string | null;
  price: Num;
  from: 'blog' | 'vah' | 'val' | 'poc';
}

/** Poziom z argumentu `level` wobec ceny, VWAP doby UTC i mapy likwidacji. */
export interface BriefLevelCheck {
  /** Poziom z argumentu (wejście użytkownika, nie pomiar). */
  price: number;
  /** Poziom − cena (USD, do centa) i poziom / cena − 1 (procent, do 0,01). */
  fromPrice: { usd: Num; pct: Num };
  /** (Poziom − VWAP) / σ (`vwapSigma`, jak odległość ceny w Czwórce). */
  vwapDistance: Num;
  /**
   * USD likwidacji z mapy skanera między ceną a poziomem, po stronie poziomu (`liqFuel` w paśmie |poziom / cena − 1|,
   * pełne dolary); dalej niż 20% od ceny albo poza zakresem mapy — null z powodem, nigdy 0.
   */
  fuelToLevel: Num;
}

export interface BriefData {
  /** Cztery pozycje w kolejności karty: clarity, fuel, hourWidth, vwap. */
  four: BriefItem[];
  /** Poziomy od najwyższej ceny; bez ceny — na końcu. */
  levels: BriefLevel[];
  /** Sesja Londynu albo NY w toku (w Azji null) i najbliższe otwarcie sesji po chwili odpowiedzi. */
  session: { current: TradeSessionId | null; next: TradeSessionId; nextOpensAt: string };
  /** Tylko z argumentem `level`. */
  level?: BriefLevelCheck;
}

const briefInput = z.object({
  level: z
    .number()
    .positive()
    .optional()
    .describe(
      tr(
        'Cena poziomu do sprawdzenia w USD (np. poziom z Mapy dnia); dodaje pole level: odległość od ceny, od VWAP w σ i paliwo likwidacji do poziomu',
        'A price level to check, in USD (for example a Day map level); adds the level field: distance from the price, from the VWAP in σ and the liquidation fuel up to the level'
      )
    ),
});

/** Najdalszy poziom od ceny, dla którego liczymy paliwo do poziomu (ułamek ceny). */
const LEVEL_MAX = 0.2;

const WIDTH_METHOD = tr('mediana 20 dni', '20-day median');
const VA_LABEL = { vah: tr('VAH poprz. sesji', 'Prev. session VAH'), poc: tr('POC poprz. sesji', 'Prev. session POC'), val: tr('VAL poprz. sesji', 'Prev. session VAL') } as const;

const FOUR_NOTE = tr(
  'Czwórka z tej samej funkcji co karta Czwórki na ekranie Przed sesją HyperQuant: text, badge, hint, note i flag jak na stronie, value i parts to te same liczby jako Num. Czytelność wczoraj: typ dnia (MODEL · Dalton) ostatniej zamkniętej sesji NY i poziomy jej mapy z bloga dotknięte do końca sesji; paliwo ±1%: USD likwidacji z mapy skanera w 1% pod ceną i nad nią; szerokość: typowy zakres high − low najbliższej godziny sesji (MODEL · mediana 20 dni); od VWAP: cena wobec VWAP doby UTC w σ. Cena to zamknięcie ostatniej świecy 1m Hyperliquid (świece do 60 s), więc liczby mogą się nieco różnić od strony w tej samej chwili. Opis rynku, nie sygnał.',
  "The four numbers come from the same function as the Four numbers card on the HyperQuant Pre-session screen: text, badge, hint, note and flag as on the site; value and parts are the same numbers as Num. Yesterday's clarity: the day type (MODEL · Dalton) of the last closed NY session and the levels of its blog map touched by the end of that session; fuel ±1%: USD of liquidations from the scanner map within 1% below and above the price; width: the typical high − low range of the next session hour (MODEL · 20-day median); from VWAP: the price against the UTC-day VWAP in σ. The price is the close of the latest Hyperliquid 1m candle (candles up to 60 s old), so the numbers can differ slightly from the site at the same moment. A market description, not a signal."
);
const VA_NOTE = tr(
  'Value area: poprzednia sesja tego samego typu co sesja w toku (w Azji: co ostatnia zamknięta sesja NY), jak poziomy „poprz. sesji” w Kontekście aukcji Przed sesją.',
  'Value area: the previous session of the same type as the session in progress (in Asian hours: as the last closed NY session), like the “Prev. session” levels in the Auction context on Pre-session.'
);

const item = (n: FourNumber, value: Num | null, parts?: { below: Num; above: Num }): BriefItem => ({
  id: n.id,
  title: n.title,
  value,
  text: n.value,
  badge: n.badge,
  hint: n.hint,
  note: n.note ?? null,
  flag: n.flag ?? null,
  ...(parts && { parts }),
});

/**
 * Wejścia paliwa (karta „Paliwo ±1%” i paliwo do poziomu): mapa, cena i uwaga o wieku migawki jak przy innych liczbach
 * skanera; karta bez liczby — powód karty albo powód nieudanego pobrania mapy.
 */
function fuelInputs(n: FourNumber, x: FourInputs, fl: Fetched<LiqMap>, now: number): { why: string } | { map: LiqMap; p: number; extra: { note?: string } } {
  const map = x.liq.map;
  const p = gotValue(x.price);
  if (n.value === DASH || !map || p === null || !(p > 0)) return { why: fl.ok ? n.hint : tr(`mapa likwidacji niedostępna (${fl.why})`, `liquidation map unavailable (${fl.why})`) };
  const note = ageNote(map.asOf, now) ?? (x.liq.status === 'delayed' ? tr('opóźnione', 'delayed') : undefined);
  return { map, p, extra: note === undefined ? {} : { note } };
}

/** Paliwo jako dwie liczby (`liqFuel`, jak karta) w pełnych dolarach; karta bez liczby — null z powodem z `fuelInputs`. */
function fuelParts(n: FourNumber, x: FourInputs, fl: Fetched<LiqMap>, now: number): { below: Num; above: Num } {
  const f = fuelInputs(n, x, fl, now);
  if ('why' in f) return { below: num(null, 'usd', 'LIVE', { why: f.why }), above: num(null, 'usd', 'LIVE', { why: f.why }) };
  const r = liqFuel(f.map, f.p);
  return { below: num(Math.round(r.below), 'usd', 'LIVE', f.extra), above: num(Math.round(r.above), 'usd', 'LIVE', f.extra) };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const LEVEL_NOTE = tr(
  `Poziom z argumentu level: fromPrice = poziom − cena (USD) i poziom / cena − 1 (%), cena to zamknięcie ostatniej świecy 1m; vwapDistance = (poziom − VWAP doby UTC) / σ, jak odległość ceny w Czwórce; fuelToLevel = USD likwidacji z mapy skanera między ceną a poziomem po stronie poziomu, po środku kubełka (jak paliwo ±1%), tylko do ${pct(LEVEL_MAX)} od ceny i w zakresie mapy (±${pct(LIQ_MAP_RANGE)} od jej ceny mark).`,
  `Level from the level argument: fromPrice = level − price (USD) and level / price − 1 (%), the price being the latest 1m close; vwapDistance = (level − UTC-day VWAP) / σ, like the price distance in the four numbers; fuelToLevel = USD of liquidations from the scanner map between the price and the level on the level's side, by bucket mid (like fuel ±1%), only up to ${pct(LEVEL_MAX)} from the price and within the map range (±${pct(LIQ_MAP_RANGE)} around its mark price).`
);

/**
 * Paliwo do poziomu: `liqFuel` w paśmie |poziom / cena − 1| po stronie poziomu. Poziom równy cenie (brak pasma), dalej
 * niż `LEVEL_MAX` od ceny albo poza zakresem mapy (`LIQ_MAP_RANGE` od ceny mark) — null z powodem: brak kubełków tam
 * to brak danych, nie zero.
 */
function fuelToLevel(level: number, n: FourNumber, x: FourInputs, fl: Fetched<LiqMap>, now: number): Num {
  const f = fuelInputs(n, x, fl, now);
  const nil = (why: string) => num(null, 'usd', 'LIVE', { why });
  if ('why' in f) return nil(f.why);
  const band = Math.abs(level / f.p - 1);
  if (band === 0) return nil(tr('poziom równy cenie: między ceną a poziomem nie ma pasma', 'the level equals the price: there is no band between them'));
  if (band > LEVEL_MAX) return nil(tr(`poziom dalej niż ${pct(LEVEL_MAX)} od ceny`, `the level is more than ${pct(LEVEL_MAX)} from the price`));
  const lo = f.map.markPx * (1 - LIQ_MAP_RANGE);
  const hi = f.map.markPx * (1 + LIQ_MAP_RANGE);
  if (level < lo || level > hi) {
    const range = `±${pct(LIQ_MAP_RANGE)}`;
    return nil(
      tr(
        `poziom poza zakresem mapy likwidacji (${range} od ceny mark mapy: ${fmtPrice(lo, 0)} do ${fmtPrice(hi, 0)})`,
        `the level is outside the liquidation map range (${range} around the map's mark price: ${fmtPrice(lo, 0)} to ${fmtPrice(hi, 0)})`
      )
    );
  }
  const r = liqFuel(f.map, f.p, band);
  return num(Math.round(level > f.p ? r.above : r.below), 'usd', 'LIVE', f.extra);
}

/** Poziom wobec ceny, VWAP doby UTC (`vwapSigma`, jak karta „Od VWAP”) i mapy likwidacji; brak wejścia — null z powodem. */
function levelCheck(level: number, fuel: FourNumber, vwap: FourNumber, x: FourInputs, fl: Fetched<LiqMap>, now: number): BriefLevelCheck {
  const p = gotValue(x.price);
  const fromPrice =
    p === null || !(p > 0)
      ? { usd: num(null, 'usd', 'LIVE', { why: gotWhy(x.price) }), pct: num(null, 'pct', 'LIVE', { why: gotWhy(x.price) }) }
      : { usd: num(Math.round((level - p) * 100) / 100, 'usd', 'LIVE'), pct: num(Math.round((level / p - 1) * 10_000) / 100, 'pct', 'LIVE') };
  const v = gotValue(x.dayVwap);
  const z = vwap.value === DASH || v === null ? null : vwapSigma(level, v.vwap, v.sd);
  return { price: level, fromPrice, vwapDistance: num(z, 'sigma', 'LIVE', { why: vwap.hint }), fuelToLevel: fuelToLevel(level, fuel, x, fl, now) };
}

/** Typowa szerokość godziny w USD (`hourWidth`, jak karta); karta bez liczby — null z jej podpowiedzią jako powodem. */
function widthNum(n: FourNumber, x: FourInputs, at: SessionHour, now: number): Num {
  const bars = gotValue(x.bars1h);
  if (n.value === DASH || bars === null) return num(null, 'usd', 'MODEL', { why: n.hint, method: WIDTH_METHOD });
  // Próba dni (ta sama co karta) z przedziałem 80% mediany z bootstrapu po dniach
  const xs = hourWidthSample(bars, at, now);
  const w = hourWidth(bars, at, now).median;
  return num(w, 'usd', 'MODEL', { why: n.hint, method: WIDTH_METHOD, sample: w === null ? undefined : { n: xs.length, median: w, interval80: bootstrapMedian80(xs) } });
}

/** Odległość od VWAP w σ (`vwapSigma`, jak karta); karta bez liczby — null z jej podpowiedzią jako powodem. */
function vwapValue(n: FourNumber, x: FourInputs): Num {
  const v = gotValue(x.dayVwap);
  const p = gotValue(x.price);
  const z = n.value === DASH || v === null || p === null ? null : vwapSigma(p, v.vwap, v.sd);
  return num(z, 'sigma', 'LIVE', { why: n.hint });
}

/**
 * Poziomy dzisiejszej Mapy dnia (`pickMap`, jak `day_map`, najwyżej `LEVELS_MAX`); etykieta spoza formatu, z radą albo
 * adresem — wstrzymana, poziom zostaje.
 */
function blogLevels(fm: Fetched<BlogMapsCut>, now: number, siteBase: string, notes: string[]): BriefLevel[] {
  if (!fm.ok) {
    notes.push(tr(`Bez poziomów z bloga: plik map z bloga niedostępny (${fm.why}).`, `No blog levels: the blog maps file is unavailable (${fm.why}).`));
    return [];
  }
  const m = pickMap(fm.value.maps, now);
  if (!m) {
    notes.push(tr('Bez poziomów z bloga: brak Mapy dnia opublikowanej dziś (doba UTC).', 'No blog levels: no Day map published today (UTC day).'));
    return [];
  }
  // Adres wpisu z identyfikatora (sprawdzonego wzorcem `isMapId`), nie z pola `url` pliku
  notes.push(
    tr(
      `Poziomy z bloga: ${blogMapName(m.kind)} z ${iso(m.publishedAt)}, ${siteBase}/blog/${m.id}/ (tekst autora, nie model; dotknięcia od wpisu: day_map).`,
      `Blog levels: ${blogMapName(m.kind)} from ${iso(m.publishedAt)}, ${siteBase}/blog/${m.id}/ (author text, not a model; touches since the post: day_map).`
    )
  );
  const cut = fm.value.levelsCut[m.id];
  if (cut !== undefined) notes.push(levelsCutNote(m.id, cut));
  return m.levels.map((l) => ({ ...guardedLabel(l.label), price: num(l.price, 'price', 'LIVE', { note: BLOG_LEVEL_NOTE }), from: 'blog' as const }));
}

/** VAH, POC i VAL poprzedniej sesji tego samego typu co sesja kontekstu (`prevSessionProfile`, jak Kontekst aukcji). */
function vaLevels(c1: Got<Candle[]>, ctx: TradeSession): BriefLevel[] {
  const prev = previousSameSession(ctx);
  const pp = isAbsent(c1) ? c1 : prevSessionProfile(toVBars(c1), ctx);
  const name = TRADE_SESSION_NAME[prev.id];
  const pct = Math.round(VA_PCT * 100);
  const note = tr(
    `profil wolumenu poprzedniej sesji ${name} ${iso(prev.start)}–${iso(prev.end)} ze świec 1m Hyperliquid (koszyki ${PROFILE_STEP} USD, value area ${pct}%)`,
    `volume profile of the previous ${name} session ${iso(prev.start)}–${iso(prev.end)} from Hyperliquid 1m candles (${PROFILE_STEP} USD buckets, ${pct}% value area)`
  );
  return (['vah', 'poc', 'val'] as const).map((k) => ({
    label: VA_LABEL[k],
    labelWhy: null,
    price: isAbsent(pp) ? num(null, 'price', 'LIVE', { why: pp.why }) : num(pp[k], 'price', 'LIVE', { note }),
    from: k,
  }));
}

/** Od najwyższej ceny; poziom bez ceny na końcu (kolejność między nimi bez zmian). */
function byPrice(a: BriefLevel, b: BriefLevel): number {
  const x = a.price.value;
  const y = b.price.value;
  if (x === null) return y === null ? 0 : 1;
  return y === null ? -1 : y - x;
}

async function run(src: Sources, args: unknown): Promise<Envelope<BriefData>> {
  const { level } = briefInput.parse(args ?? {});
  const now = src.now();
  const ny = lastClosedNy(now);
  // Sesja Kontekstu aukcji: w toku albo (w Azji) ostatnia zamknięta; value area z poprzedniej sesji tego samego typu
  const { s: ctx } = reviewSession(now);
  const at = nextSessionHour(now);
  // Świece 1m od początku doby UTC ostatniej sesji NY (każda mapa rozliczana na tej sesji ma wpis z tej doby), a od otwarcia
  // poprzedniej sesji kontekstu, jeśli wcześniej. Wcześniejszy początek niż na stronie nie zmienia liczb (fakty sesji
  // i rozliczenie mapy biorą świece od otwarcia sesji i od wpisu), a żądanie świec nie czeka na plik map: cztery żądania
  // naraz, jeden limit czasu na całość.
  const from1m = Math.min(utcDayStart(ny.start), previousSameSession(ctx).start);
  const from1h = Math.min(at.hour, ...sessionHourSamples(at));
  const [fm, fl, f1, f1h] = await Promise.all([src.blogMaps(), src.published('liq-map/BTC.json', isLiqMap), src.candles('1m', from1m), src.candles('1h', from1h)]);
  const sources: SourceRef[] = [
    fileSource(tr('Mapy z bloga HyperQuant', 'HyperQuant blog maps'), fm),
    fileSource(tr('Mapa likwidacji skanera', 'Scanner liquidation map'), fl),
    candleSource('1m', f1),
    candleSource('1h', f1h),
  ];

  // Wejścia Czwórki jak `readFourInputs` strony, z powodem nieudanego pobrania w miejscu „czekam na dane”
  const c1 = candlesGot(f1, '1m');
  const c1h = candlesGot(f1h, '1h');
  const x: FourInputs = {
    coin: 'BTC',
    now,
    price: isAbsent(c1) ? c1 : c1[c1.length - 1].c,
    bars1m: isAbsent(c1) ? c1 : toVBars(c1),
    maps: fm.ok ? fm.value : { status: 'missing', maps: [] },
    liq: fl.ok ? { status: liqMapFreshness(fl.value, now), map: fl.value } : { status: 'error', map: null },
    bars1h: isAbsent(c1h) ? c1h : toVBars(c1h),
    dayVwap: isAbsent(c1) ? c1 : dayVwapOf(c1, now),
  };
  const [clarity, fuel, width, vwap] = fourNumbers(x).items;

  const notes = [FOUR_NOTE, VA_NOTE];
  const levels = [...blogLevels(fm, now, src.cfg.siteBase, notes), ...vaLevels(c1, ctx)].sort(byPrice);
  const next = nextTradeSession(now);
  const data: BriefData = {
    four: [item(clarity, null), item(fuel, null, fuelParts(fuel, x, fl, now)), item(width, widthNum(width, x, at, now)), item(vwap, vwapValue(vwap, x))],
    levels,
    session: { current: currentTradeSession(now)?.id ?? null, next: next.id, nextOpensAt: iso(next.start) },
  };
  if (level !== undefined) {
    data.level = levelCheck(level, fuel, vwap, x, fl, now);
    notes.push(LEVEL_NOTE);
  }
  return envelope(NAME, data, sources, now, notes);
}

export const marketBrief: ToolDef = {
  name: NAME,
  title: tr('Skrót przed sesją BTC', 'BTC pre-session brief'),
  description: tr(
    'Skrót BTC przed sesją, jak ekran Przed sesją HyperQuant: Czwórka (czytelność wczoraj: typ dnia ostatniej sesji NY i trafienia jej mapy z bloga, MODEL; paliwo ±1%: USD likwidacji w 1% pod ceną i nad nią z mapy skanera, LIVE; typowa szerokość najbliższej godziny sesji, MODEL: mediana 20 dni; odległość ceny od VWAP doby UTC w σ, LIVE), poziomy dzisiejszej Mapy dnia z bloga oraz VAH, POC i VAL poprzedniej sesji, sesja w toku i najbliższe otwarcie. Każda pozycja Czwórki z tekstem i podpowiedzią jak na stronie oraz z liczbą jako Num. Opcjonalny argument level (cena poziomu w USD) dodaje pole level: odległość poziomu od ceny (USD i %), od VWAP doby UTC w σ i paliwo likwidacji między ceną a poziomem (LIVE; do 20% od ceny i w zakresie mapy, dalej null z powodem). Dane publiczne, tylko odczyt; opis rynku, nie porada inwestycyjna.',
    "A BTC pre-session brief, like the HyperQuant Pre-session screen: the four numbers (yesterday's clarity: the day type of the last NY session and the hits of its blog map, MODEL; fuel ±1%: USD of liquidations within 1% below and above the price from the scanner map, LIVE; the typical width of the next session hour, MODEL: 20-day median; the price distance from the UTC-day VWAP in σ, LIVE), the levels of today's blog Day map and the previous session's VAH, POC and VAL, the session in progress and the next open. Each of the four comes with the site's text and hint and with the number as Num. The optional argument level (a price level in USD) adds a level field: the level's distance from the price (USD and %), from the UTC-day VWAP in σ, and the liquidation fuel between the price and the level (LIVE; up to 20% from the price and within the map range, otherwise null with a reason). Public read-only data; market description, not investment advice."
  ),
  input: briefInput,
  run: (src, args) => run(src, args),
};
