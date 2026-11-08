/**
 * Narzędzie `market_brief`: skrót przed sesją jak ekran Przed sesją HyperQuant. Czwórka (czytelność wczoraj, paliwo ±1%,
 * typowa szerokość najbliższej godziny sesji, odległość od VWAP doby) z tej samej funkcji co karta Czwórki (`fourNumbers`
 * z `src/utils`), poziomy dzisiejszej Mapy dnia z bloga (`pickMap`, jak `day_map`) oraz VAH, POC i VAL poprzedniej sesji
 * (`prevSessionProfile`, jak Kontekst aukcji), sesja w toku i najbliższe otwarcie. Tu tylko pobranie wejść (pliki publiczne,
 * świece Hyperliquid) w miejsce magazynu strony i te same liczby jako `Num`.
 */
import { utcDayStart } from '../../../src/charts/pro/core/sessions';
import type { Candle } from '../../../src/charts/pro/hl/parse';
import { tr } from '../../../src/i18n';
import { type BlogMapsState, pickMap } from '../../../src/state/useBlogMaps';
import { DASH } from '../../../src/ui/format';
import { PROFILE_STEP, VA_PCT, toVBars } from '../../../src/utils/auction';
import { dayVwapOf, vwapSigma } from '../../../src/utils/dayVwap';
import {
  type FourId,
  type FourInputs,
  type FourNumber,
  type SessionHour,
  fourNumbers,
  gotValue,
  hourWidth,
  lastClosedNy,
  liqFuel,
  nextSessionHour,
  sessionHourSamples,
} from '../../../src/utils/fourNumbers';
import { type LiqMap, isLiqMap } from '../../../src/utils/liqMap';
import { liqMapFreshness } from '../../../src/utils/liqMapView';
import { type TradeSession, type TradeSessionId, currentTradeSession, nextTradeSession, previousSameSession } from '../../../src/utils/sessionDay';
import { prevSessionProfile, reviewSession } from '../../../src/utils/sessionFacts';
import { TRADE_SESSION_NAME } from '../../../src/utils/sessionNames';
import { type Got, blogMapName, isAbsent } from '../../../src/utils/sessionText';
import { type Envelope, type Num, type SourceRef, envelope, guardedLabel, iso, num } from '../envelope';
import type { Fetched, Sources } from '../sources';
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
  /** Paliwo: USD likwidacji w 1% pod ceną i nad nią. */
  parts?: { below: Num; above: Num };
}

export interface BriefLevel {
  /** Etykieta; null — wstrzymana przez strażnika treści (powód w `labelWhy`), cena zostaje. */
  label: string | null;
  labelWhy: string | null;
  price: Num;
  from: 'blog' | 'vah' | 'val' | 'poc';
}

export interface BriefData {
  /** Cztery pozycje w kolejności karty: clarity, fuel, hourWidth, vwap. */
  four: BriefItem[];
  /** Poziomy od najwyższej ceny; bez ceny — na końcu. */
  levels: BriefLevel[];
  /** Sesja Londynu albo NY w toku (w Azji null) i najbliższe otwarcie sesji po chwili odpowiedzi. */
  session: { current: TradeSessionId | null; next: TradeSessionId; nextOpensAt: string };
}

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

/** Paliwo jako dwie liczby (`liqFuel`, jak karta); karta bez liczby — null z jej powodem albo z powodem nieudanego pobrania mapy. */
function fuelParts(n: FourNumber, x: FourInputs, fl: Fetched<LiqMap>, now: number): { below: Num; above: Num } {
  const map = x.liq.map;
  const p = gotValue(x.price);
  if (n.value === DASH || !map || p === null) {
    const why = fl.ok ? n.hint : tr(`mapa likwidacji niedostępna (${fl.why})`, `liquidation map unavailable (${fl.why})`);
    return { below: num(null, 'usd', 'LIVE', { why }), above: num(null, 'usd', 'LIVE', { why }) };
  }
  const r = liqFuel(map, p);
  const note = ageNote(map.asOf, now) ?? (x.liq.status === 'delayed' ? tr('opóźnione', 'delayed') : undefined);
  const extra = note === undefined ? {} : { note };
  return { below: num(r.below, 'usd', 'LIVE', extra), above: num(r.above, 'usd', 'LIVE', extra) };
}

/** Typowa szerokość godziny w USD (`hourWidth`, jak karta); karta bez liczby — null z jej podpowiedzią jako powodem. */
function widthNum(n: FourNumber, x: FourInputs, at: SessionHour, now: number): Num {
  const bars = gotValue(x.bars1h);
  const w = n.value === DASH || bars === null ? null : hourWidth(bars, at, now).median;
  return num(w, 'usd', 'MODEL', { why: n.hint, method: WIDTH_METHOD });
}

/** Odległość od VWAP w σ (`vwapSigma`, jak karta); karta bez liczby — null z jej podpowiedzią jako powodem. */
function vwapValue(n: FourNumber, x: FourInputs): Num {
  const v = gotValue(x.dayVwap);
  const p = gotValue(x.price);
  const z = n.value === DASH || v === null || p === null ? null : vwapSigma(p, v.vwap, v.sd);
  return num(z, 'sigma', 'LIVE', { why: n.hint });
}

/** Poziomy dzisiejszej Mapy dnia (`pickMap`, jak `day_map`); etykieta z radą albo adresem — wstrzymana, poziom zostaje. */
function blogLevels(fm: Fetched<BlogMapsState>, now: number, siteBase: string, notes: string[]): BriefLevel[] {
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

async function run(src: Sources): Promise<Envelope<BriefData>> {
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
  return envelope(NAME, data, sources, now, notes);
}

export const marketBrief: ToolDef = {
  name: NAME,
  title: tr('Skrót przed sesją BTC', 'BTC pre-session brief'),
  description: tr(
    'Skrót BTC przed sesją, jak ekran Przed sesją HyperQuant: Czwórka (czytelność wczoraj: typ dnia ostatniej sesji NY i trafienia jej mapy z bloga, MODEL; paliwo ±1%: USD likwidacji w 1% pod ceną i nad nią z mapy skanera, LIVE; typowa szerokość najbliższej godziny sesji, MODEL: mediana 20 dni; odległość ceny od VWAP doby UTC w σ, LIVE), poziomy dzisiejszej Mapy dnia z bloga oraz VAH, POC i VAL poprzedniej sesji, sesja w toku i najbliższe otwarcie. Każda pozycja Czwórki z tekstem i podpowiedzią jak na stronie oraz z liczbą jako Num. Bez argumentów. Dane publiczne, tylko odczyt; opis rynku, nie porada inwestycyjna.',
    "A BTC pre-session brief, like the HyperQuant Pre-session screen: the four numbers (yesterday's clarity: the day type of the last NY session and the hits of its blog map, MODEL; fuel ±1%: USD of liquidations within 1% below and above the price from the scanner map, LIVE; the typical width of the next session hour, MODEL: 20-day median; the price distance from the UTC-day VWAP in σ, LIVE), the levels of today's blog Day map and the previous session's VAH, POC and VAL, the session in progress and the next open. Each of the four comes with the site's text and hint and with the number as Num. No arguments. Public read-only data; market description, not investment advice."
  ),
  run: (src) => run(src),
};
