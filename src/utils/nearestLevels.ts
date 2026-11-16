/**
 * Panel „Najbliższe poziomy” (rekomendacje Pioniera, pkt 3): posortowana lista poziomów nad ceną i pod nią z odległością
 * w % i w ATR świec 5m oraz paliwem likwidacji między ceną a poziomem. Każdy poziom liczony tą samą funkcją co linia
 * na wykresie albo liczba nagłówka układu (PDH i PDL — `dayLevels`, VWAP doby i pasma σ — `dayVwapOf` jak linia VWAP,
 * IB — `initialBalances`, klastry — `liqLevels`, stożek — `coneForecastOf` i `coneQuantile`, value area wczoraj —
 * `utcDayProfiles` jak nagłówek Mapy dnia), więc odległość w panelu jest odległością linii. Zakres Azji i mediana wejść
 * Uwięzionych na wykresie linii nie mają: liczone tu z tych samych świec 1m i z mapy wejść skanera.
 * Brak danych — poziom na liście „bez liczby” z powodem, nigdy liczba zastępcza. Opis, nie rekomendacja.
 */
import { tr } from '../i18n';
import { fmtCompact, fmtFixed } from '../ui/format';
import { fmtPx } from '../charts/pro/core/footprintBar';
import { type IndicatorBar, dayLevels, initialBalances, liqLevels, sdUsable } from '../charts/pro/core/indicators';
import { SESSION_LABEL, sessionAt, sessionOpens, utcDayStart } from '../charts/pro/core/sessions';
import { fmtHm } from '../charts/pro/core/time';
import type { Candle } from '../charts/pro/hl/parse';
import { profileStep, utcDayProfiles } from './auction';
import { coneForecastOf, coneQuantile } from './cone';
import { dayVwapOf } from './dayVwap';
import type { DeskLedgerSummary } from './deskLedger';
import type { EntryBucket, EntryMap } from './entryMap';
import { LIQ_MAP_RANGE, type LiqMap } from './liqMap';
import { scannerAge } from './scanState';
import { type Absent, type Got, WAIT_TEXT, isAbsent, missingWhy } from './sessionText';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** ATR: średnia prawdziwego zakresu tylu ostatnich zamkniętych świec 5m. */
export const ATR_N = 14;
const BAR_5M = 5 * MIN;
/** Najwyżej tyle poziomów po każdej stronie ceny. */
export const LEVELS_PER_SIDE = 6;
/** Stożek: horyzont granic w panelu (min) i kwantyle przedziału 90%. */
const CONE_H = 60;
const CONE_TAUS = [0.05, 0.95] as const;

export type LevelId =
  | 'pdh'
  | 'pdl'
  | 'vwap'
  | 'vwapUp1'
  | 'vwapDn1'
  | 'vwapUp2'
  | 'vwapDn2'
  | 'poc'
  | 'vah'
  | 'val'
  | 'ibh'
  | 'ibl'
  | 'asiaHi'
  | 'asiaLo'
  | 'liqLong'
  | 'liqShort'
  | 'trappedLong'
  | 'trappedShort'
  | 'coneHi'
  | 'coneLo';

export type LevelBadge = 'LIVE' | 'MODEL';

/** Poziom z ceną: podpis, plakietka (LIVE — z ceny i świec, MODEL — skaner i dziennik prognoz) i skąd liczba. */
export interface Level {
  id: LevelId;
  label: string;
  px: number;
  badge: LevelBadge;
  hint: string;
}

/** Poziom bez liczby: powód „—”. */
export interface MissingLevel {
  id: LevelId;
  label: string;
  badge: LevelBadge;
  why: string;
}

/** Wiersz listy: odległość od ceny w % (dodatnia — poziom nad ceną), w ATR 5m i paliwo likwidacji między ceną a poziomem. */
export interface LevelRow extends Level {
  distPct: number;
  /** |poziom − cena| / ATR; null — ATR bez liczby (powód w `NearestLevels.atr`). */
  distAtr: number | null;
  fuel: Got<number>;
}

/** Stan migawki skanera do legendy panelu: chwila stanu, pokrycie open interest, opóźnione odczyty. */
export interface ScanMeta {
  asOf: number;
  share: number;
  delayed: boolean;
}

export interface NearestLevels {
  coin: string;
  now: number;
  price: Got<number>;
  atr: Got<{ value: number; n: number }>;
  /** Nad ceną, od najbliższego. */
  above: LevelRow[];
  /** Pod ceną, od najbliższego. */
  below: LevelRow[];
  /** Poziomy poza listą przez limit na stronę (dalsze). */
  hidden: number;
  missing: MissingLevel[];
  liq: Got<ScanMeta>;
  entry: Got<ScanMeta>;
}

/** Migawka skanera z hooka (`useLiqMap`, `useEntryMap`). */
interface ScanInput<M> {
  status: string;
  map: M | null;
}

/** Wejścia panelu; pole `undefined` — jeszcze się wczytuje. */
export interface LevelInputs {
  coin: string;
  now: number;
  /** Miejsca wielkości zlecenia rynku (dokładność ceny w podpowiedziach). */
  szDecimals?: number;
  price?: Got<number>;
  /** Zdolności rynku: skaner kont (mapa likwidacji, Uwięzieni) i prognozy dziennika (stożek); powód „—” bez nich. */
  scanner: boolean;
  forecasts: boolean;
  noScannerWhy: string;
  /** Świece dzienne (00:00 UTC) magazynu rynku — poziomy dnia jak na wykresie. */
  daily?: Got<readonly Candle[]>;
  /** Świece 1m rosnąco od 00:00 UTC bieżącej doby. */
  c1m?: Got<readonly Candle[]>;
  /** Świece 1h rosnąco (profil wczorajszej doby UTC, jak nagłówek Mapy dnia). */
  c1h?: Got<readonly Candle[]>;
  /** Świece 5m rosnąco (ATR). */
  c5m?: Got<readonly Candle[]>;
  liq: ScanInput<LiqMap>;
  entry: ScanInput<EntryMap>;
  ledger: { status: string; summary: DeskLedgerSummary | null };
}

const got = <T>(v: Got<T> | undefined): T | null => (v === undefined || isAbsent(v) ? null : v);

/** Odległość poziomu od ceny w % (dodatnia — poziom nad ceną), jak w nagłówku układu. */
export const distPctOf = (level: number, price: number): number => (level / price - 1) * 100;

/**
 * ATR(14) świec 5m: średnia prawdziwego zakresu (max z H − L i odległości H, L od poprzedniego zamknięcia) ostatnich
 * 14 zamkniętych świec; świeca w trakcie się nie liczy.
 */
export function atr5mOf(c5m: readonly Candle[], now: number, n = ATR_N): Got<{ value: number; n: number }> {
  const closed = c5m.filter((c) => c.t + BAR_5M <= now);
  if (closed.length < n + 1) {
    return { why: tr(`Za mało zamkniętych świec 5m do ATR(${n}): ${closed.length} z ${n + 1}`, `Too few closed 5m candles for ATR(${n}): ${closed.length} of ${n + 1}`) };
  }
  let sum = 0;
  for (let i = closed.length - n; i < closed.length; i++) {
    const c = closed[i];
    const pc = closed[i - 1].c;
    sum += Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc));
  }
  const value = sum / n;
  return value > 0 ? { value, n } : { why: tr('ATR 5m zerowy (brak ruchu ceny)', 'Zero 5m ATR (no price movement)') };
}

/**
 * USD likwidacji z kubełków mapy (longi i shorty razem, po środku kubełka) między ceną a poziomem: nad ceną w (cena, poziom],
 * pod nią w [poziom, cena) — te same granice co paliwo ±1% Czwórki (`liqFuel`).
 */
export function liqBetween(map: Pick<LiqMap, 'longs' | 'shorts' | 'stepUsd'>, price: number, level: number): number {
  let sum = 0;
  for (const b of [...map.longs, ...map.shorts]) {
    const px = b.px + map.stepUsd / 2;
    if (level > price ? px > price && px <= level : px >= level && px < price) sum += b.ntlUsd;
  }
  return sum;
}

/** Mediana ceny wejścia ważona wartością (środek kubełka); bez wartości — null. */
export function entryMedian(buckets: readonly EntryBucket[], stepUsd: number): number | null {
  const list = [...buckets].sort((a, b) => a.px - b.px);
  const total = list.reduce((s, b) => s + b.ntlUsd, 0);
  if (!(total > 0)) return null;
  let cum = 0;
  for (const b of list) {
    cum += b.ntlUsd;
    if (cum >= total / 2) return b.px + stepUsd / 2;
  }
  return null;
}

/** Powód braku migawki skanera albo null (aktualna: `ready` lub `delayed`); nieaktualna — z wiekiem. */
function scanWhy(s: ScanInput<{ asOf: number }>, oldest: number | null, now: number, name: { pl: string; en: string }): string | null {
  if ((s.status === 'ready' || s.status === 'delayed') && s.map) return null;
  switch (s.status) {
    case 'loading':
      return WAIT_TEXT;
    case 'unconfigured':
      return tr(`${name.pl} niedostępna w tej wersji strony`, `${name.en} unavailable in this version of the site`);
    case 'error':
      return tr(`Nie udało się pobrać: ${name.pl.toLowerCase()}`, `Could not load the ${name.en.toLowerCase()}`);
    default: {
      const age = oldest === null ? null : (scannerAge(oldest, now) ?? tr('ponad 10 min', 'over 10 min'));
      return age
        ? tr(`${name.pl} sprzed ${age}: po 10 min bez świeżej publikacji skanera liczby są ukryte`, `${name.en} from ${age} ago: after 10 min without a fresh scanner publication the numbers are hidden`)
        : tr(`${name.pl}: skaner nie publikuje teraz aktualnych danych`, `${name.en}: the scanner is not publishing current data right now`);
    }
  }
}

const LIQ_NAME = { pl: 'Mapa likwidacji', en: 'Liquidation map' };
const ENTRY_NAME = { pl: 'Mapa wejść (Uwięzieni)', en: 'Entry map (trapped positions)' };

/** Mapa likwidacji do paliwa i klastrów: mapa albo powód. */
function liqState(x: LevelInputs): Got<LiqMap> {
  if (!x.scanner) return { why: x.noScannerWhy };
  const m = x.liq.map;
  const why = scanWhy(x.liq, m ? Math.min(m.asOf, m.ctxAt) : null, x.now, LIQ_NAME);
  if (why) return { why };
  if (m!.coin !== x.coin) return { why: tr(`Mapa likwidacji opisuje ${m!.coin}`, `The liquidation map describes ${m!.coin}`) };
  return m!;
}

function entryState(x: LevelInputs): Got<EntryMap> {
  if (!x.scanner) return { why: x.noScannerWhy };
  const m = x.entry.map;
  const why = scanWhy(x.entry, m ? m.asOf : null, x.now, ENTRY_NAME);
  if (why) return { why };
  if (m!.coin !== x.coin) return { why: tr(`Mapa wejść opisuje ${m!.coin}`, `The entry map describes ${m!.coin}`) };
  return m!;
}

const meta = (m: Got<LiqMap | EntryMap>, status: string): Got<ScanMeta> => (isAbsent(m) ? m : { asOf: m.asOf, share: m.coverage.share, delayed: status === 'delayed' });

/** Poziomy z ceną i poziomy bez liczby (z powodem) w stałej kolejności grup. */
export function levelsOf(x: LevelInputs): { levels: Level[]; missing: MissingLevel[] } {
  const levels: Level[] = [];
  const missing: MissingLevel[] = [];
  const px = (p: number) => fmtPx(p, x.szDecimals);
  const now = x.now;
  const today = utcDayStart(now);
  const add = (id: LevelId, label: string, badge: LevelBadge, v: Got<{ px: number; hint: string }>) =>
    isAbsent(v) ? missing.push({ id, label, badge, why: v.why }) : levels.push({ id, label, badge, px: v.px, hint: v.hint });
  const miss = (why: string) => ({ why }) as Absent;

  // PDH i PDL: poziomy bieżącej doby UTC ze świec dziennych (jak linie PDH i PDL na wykresie, `selectDays`)
  {
    const daily = got(x.daily);
    const d = daily ? dayLevels(daily).find((l) => l.t === today) : undefined;
    const src = tr('świeca dzienna Hyperliquid poprzedniej doby UTC, jak linia na wykresie', 'Hyperliquid daily candle of the previous UTC day, like the chart line');
    if (!d) {
      const why = miss(!daily ? missingWhy(x.daily) : tr('Świece dzienne bez bieżącej i poprzedniej doby UTC', 'Daily candles lack the current and previous UTC day'));
      add('pdh', 'PDH', 'LIVE', why);
      add('pdl', 'PDL', 'LIVE', why);
    } else {
      add('pdh', 'PDH', 'LIVE', { px: d.pdh, hint: tr(`Szczyt poprzedniej doby UTC ${px(d.pdh)}: ${src}.`, `Previous UTC day high ${px(d.pdh)}: ${src}.`) });
      add('pdl', 'PDL', 'LIVE', { px: d.pdl, hint: tr(`Dołek poprzedniej doby UTC ${px(d.pdl)}: ${src}.`, `Previous UTC day low ${px(d.pdl)}: ${src}.`) });
    }
  }

  // VWAP doby UTC i pasma ±1σ, ±2σ (ostatni punkt linii VWAP i jej pasm na wykresie)
  {
    const c1m = got(x.c1m);
    const v = c1m ? dayVwapOf(c1m, now) : miss(missingWhy(x.c1m));
    const label = tr('VWAP doby', 'Day VWAP');
    if (isAbsent(v)) {
      add('vwap', label, 'LIVE', v);
      for (const id of ['vwapUp1', 'vwapDn1', 'vwapUp2', 'vwapDn2'] as const) add(id, bandLabel(id), 'LIVE', v);
    } else {
      add('vwap', label, 'LIVE', { px: v.vwap, hint: tr(`VWAP doby UTC ze świec 1m od 00:00 UTC: ${px(v.vwap)}, jak linia VWAP na wykresie.`, `UTC-day VWAP from 1m candles since 00:00 UTC: ${px(v.vwap)}, like the VWAP line on the chart.`) });
      const usable = sdUsable({ vwap: v.vwap, sd: v.sd, start: false });
      for (const [id, k] of [
        ['vwapUp1', 1],
        ['vwapDn1', -1],
        ['vwapUp2', 2],
        ['vwapDn2', -2],
      ] as const) {
        const p = v.vwap + k * v.sd;
        add(
          id,
          bandLabel(id),
          'LIVE',
          usable
            ? { px: p, hint: tr(`VWAP ${px(v.vwap)} ${k > 0 ? '+' : '−'} ${Math.abs(k)} × σ (${fmtFixed(v.sd, 2)}) = ${px(p)}, jak pasmo VWAP na wykresie.`, `VWAP ${px(v.vwap)} ${k > 0 ? '+' : '−'} ${Math.abs(k)} × σ (${fmtFixed(v.sd, 2)}) = ${px(p)}, like the VWAP band on the chart.`) }
            : miss(tr('σ VWAP jeszcze bez znaczenia: za mało świec od 00:00 UTC', 'VWAP σ not meaningful yet: too few candles since 00:00 UTC'))
        );
      }
    }
  }

  // POC, VAH i VAL wczorajszej doby UTC ze świec 1h (jak VAH i VAL wczoraj w nagłówku Mapy dnia)
  {
    const c1h = got(x.c1h);
    const p = got(x.price);
    const step = p !== null && p > 0 ? profileStep(p) : Number.NaN;
    let v: Got<{ day: number; poc: number; vah: number; val: number }>;
    if (!c1h) v = miss(missingWhy(x.c1h));
    else if (c1h.length === 0) v = miss(tr('Czekam na świece 1h', 'Waiting for 1h candles'));
    else if (!(step > 0)) v = miss(tr('Brak ceny do profilu', 'No price for the profile'));
    // Tylko świece wczorajszej doby (profil tej doby ten sam, bez liczenia ok. 200 starszych dób co 2 s)
    else v = utcDayProfiles(c1h.filter((c) => c.t >= today - DAY && c.t < today), now, step).find((d) => d.day === today - DAY) ?? miss(tr('Świece 1h nie obejmują całej wczorajszej doby UTC', "The 1h candles do not cover all of yesterday's UTC day"));
    const src = tr('profil wolumenu wczorajszej doby UTC ze świec 1h (value area 70%), jak nagłówek Mapy dnia', "yesterday's UTC-day volume profile from 1h candles (70% value area), like the Day map header");
    for (const [id, key, name] of [
      ['poc', 'poc', 'POC'],
      ['vah', 'vah', 'VAH'],
      ['val', 'val', 'VAL'],
    ] as const) {
      add(id, tr(`${name} wczoraj`, `${name} yesterday`), 'LIVE', isAbsent(v) ? v : { px: v[key], hint: `${name} ${px(v[key])}: ${src}.` });
    }
  }

  // IB bieżącej sesji (pierwsza godzina; sesje jak linie otwarć na wykresie) i zakres Azji bieżącej doby UTC
  {
    const c1m = got(x.c1m);
    const ses = sessionAt(now);
    const name = SESSION_LABEL[ses.id];
    const bars: IndicatorBar[] | null = c1m ? c1m.filter((c) => c.t >= today && c.t <= now).map((c) => ({ t: c.t, candle: c })) : null;
    const ib = bars ? initialBalances(bars, MIN).find((b) => b.session.start === ses.start) : undefined;
    const ibWhy = !bars ? missingWhy(x.c1m) : !ib ? tr(`Świece 1m nie obejmują otwarcia sesji (${fmtHm(ses.start)})`, `The 1m candles do not cover the session open (${fmtHm(ses.start)})`) : null;
    const forming = ib && !ib.complete ? tr(' w budowie', ' forming') : '';
    const ibSrc = (edge: string, p: number) =>
      tr(
        `${edge} pierwszej godziny sesji ${name} (${fmtHm(ses.start)}–${fmtHm(ses.start + 60 * MIN)})${forming ? ', zakres jeszcze w budowie' : ''}: ${px(p)}, jak IB na wykresie.`,
        `${edge} of the first hour of the ${name} session (${fmtHm(ses.start)}–${fmtHm(ses.start + 60 * MIN)})${forming ? ', range still forming' : ''}: ${px(p)}, like the IB on the chart.`
      );
    add('ibh', `IBH · ${name}${forming}`, 'LIVE', ibWhy || !ib ? miss(ibWhy ?? WAIT_TEXT) : { px: ib.hi, hint: ibSrc(tr('Szczyt', 'High'), ib.hi) });
    add('ibl', `IBL · ${name}${forming}`, 'LIVE', ibWhy || !ib ? miss(ibWhy ?? WAIT_TEXT) : { px: ib.lo, hint: ibSrc(tr('Dołek', 'Low'), ib.lo) });

    const [asia, london] = sessionOpens(today);
    const inAsia = bars ? bars.filter((b) => b.t >= asia && b.t < london) : null;
    const asiaWhy = !bars ? missingWhy(x.c1m) : c1m!.length > 0 && c1m![0].t > asia ? tr('Świece 1m nie obejmują 00:00 UTC', 'The 1m candles do not cover 00:00 UTC') : !inAsia || inAsia.length === 0 ? WAIT_TEXT : null;
    const hi = inAsia && inAsia.length > 0 ? Math.max(...inAsia.map((b) => b.candle.h)) : Number.NaN;
    const lo = inAsia && inAsia.length > 0 ? Math.min(...inAsia.map((b) => b.candle.l)) : Number.NaN;
    const open = now < london;
    const asiaSrc = (edge: string, p: number) =>
      tr(
        `${edge} sesji azjatyckiej bieżącej doby (00:00 UTC do otwarcia Londynu o ${fmtHm(london)})${open ? ', sesja w toku' : ''}: ${px(p)}. Ze świec 1m; tej linii nie ma na wykresie.`,
        `${edge} of the current day's Asian session (00:00 UTC to the London open at ${fmtHm(london)})${open ? ', session in progress' : ''}: ${px(p)}. From 1m candles; the chart has no such line.`
      );
    const asiaTag = open ? tr(' w toku', ' ongoing') : '';
    add('asiaHi', tr(`Szczyt Azji${asiaTag}`, `Asia high${asiaTag}`), 'LIVE', asiaWhy ? miss(asiaWhy) : { px: hi, hint: asiaSrc(tr('Szczyt', 'High'), hi) });
    add('asiaLo', tr(`Dołek Azji${asiaTag}`, `Asia low${asiaTag}`), 'LIVE', asiaWhy ? miss(asiaWhy) : { px: lo, hint: asiaSrc(tr('Dołek', 'Low'), lo) });
  }

  // Największy klaster likwidacji po każdej stronie (pierwszy z klastrów rysowanych na wykresie, `liqLevels`)
  {
    const m = liqState(x);
    const lv = isAbsent(m) ? [] : liqLevels(m);
    for (const side of ['long', 'short'] as const) {
      const id = side === 'long' ? 'liqLong' : 'liqShort';
      const label = side === 'long' ? tr('Klaster likw. longów', 'Long liq. cluster') : tr('Klaster likw. shortów', 'Short liq. cluster');
      const l = lv.find((c) => c.side === side);
      add(
        id,
        label,
        'MODEL',
        isAbsent(m)
          ? m
          : !l
            ? miss(tr('Brak klastra od 1 mln USD po tej stronie mapy', 'No cluster of 1M USD or more on this side of the map'))
            : {
                px: l.px,
                hint: tr(
                  `MODEL · mapa likwidacji skanera: największy klaster ${side === 'long' ? 'longów' : 'shortów'} na wykresie, ${fmtCompact(l.ntlUsd, '$')} przy ${px(l.px)} (przedziały ok. 0,25% ceny). Pozycje śledzone przez skaner (${fmtFixed(m.coverage.share * 100, 0)}% open interest), stan z ${fmtHm(m.asOf)}.`,
                  `MODEL · scanner liquidation map: the largest ${side} cluster on the chart, ${fmtCompact(l.ntlUsd, '$')} at ${px(l.px)} (bins of about 0.25% of price). Positions tracked by the scanner (${fmtFixed(m.coverage.share * 100, 0)}% of open interest), as of ${fmtHm(m.asOf)}.`
                ),
              }
      );
    }
  }

  // Mediana cen wejścia Uwięzionych (mapa wejść skanera), osobno longi i shorty
  {
    const m = entryState(x);
    for (const side of ['long', 'short'] as const) {
      const id = side === 'long' ? 'trappedLong' : 'trappedShort';
      const label = side === 'long' ? tr('Uwięzieni: wejścia longów', 'Trapped: long entries') : tr('Uwięzieni: wejścia shortów', 'Trapped: short entries');
      if (isAbsent(m)) {
        add(id, label, 'MODEL', m);
        continue;
      }
      const med = entryMedian(side === 'long' ? m.longs : m.shorts, m.stepUsd);
      const range = fmtFixed(m.rangePct * 100, 0);
      add(
        id,
        label,
        'MODEL',
        med === null
          ? miss(tr(`Brak wejść ${side === 'long' ? 'longów' : 'shortów'} w ±${range}% od ceny`, `No ${side} entries within ±${range}% of price`))
          : {
              px: med,
              hint: tr(
                `MODEL · mapa wejść skanera: mediana ceny wejścia ${side === 'long' ? 'longów' : 'shortów'} ważona wartością, ${px(med)} (środek kubełka co ok. 0,25% ceny; wejścia dalej niż ±${range}% od ceny pominięte). Pokrycie ${fmtFixed(m.coverage.share * 100, 0)}% open interest, stan z ${fmtHm(m.asOf)}. Opis pozycji, nie prognoza.`,
                `MODEL · scanner entry map: value-weighted median ${side} entry price, ${px(med)} (bucket middle, buckets of about 0.25% of price; entries further than ±${range}% from price left out). Coverage ${fmtFixed(m.coverage.share * 100, 0)}% of open interest, as of ${fmtHm(m.asOf)}. A description of positions, not a forecast.`
              ),
            }
      );
    }
  }

  // Granice stożka 90% na 1 h (ta sama prognoza co stożek na wykresie)
  {
    let f: Got<{ t: number; px0: number; lo: number; hi: number }>;
    if (!x.forecasts) f = miss(x.noScannerWhy);
    else if (!x.ledger.summary) {
      f = miss(
        x.ledger.status === 'loading'
          ? WAIT_TEXT
          : x.ledger.status === 'unconfigured'
            ? tr('Dziennik prognoz niedostępny w tej wersji strony', 'The forecast ledger is unavailable in this version of the site')
            : tr('Nie udało się pobrać dziennika prognoz', 'Could not load the forecast ledger')
      );
    } else {
      const c = coneForecastOf(x.ledger.summary, x.coin, now);
      const [qlo, qhi] = c ? CONE_TAUS.map((tau) => coneQuantile(c, tau, CONE_H)) : [null, null];
      f = !c
        ? miss(tr('Brak prognozy z ostatnich 3 h', 'No forecast from the last 3 h'))
        : qlo === null || qhi === null
          ? miss(tr('Prognoza bez kwantyli 5% i 95% na 1 h', 'The forecast lacks the 5% and 95% quantiles at 1 h'))
          : { t: c.t, px0: c.px0, lo: c.px0 * Math.exp(qlo), hi: c.px0 * Math.exp(qhi) };
    }
    const hint = (p: number, v: { t: number; px0: number }) =>
      tr(
        `MODEL · dziennik prognoz HyperQuant: granica przedziału 90% (kwantyle 5% i 95% log-zwrotu) 1 h po prognozie z ${fmtHm(v.t)} (cena wtedy ${px(v.px0)}): ${px(p)}, jak stożek na wykresie. Przedział, nie kierunek.`,
        `MODEL · HyperQuant forecast ledger: bound of the 90% interval (5% and 95% log-return quantiles) 1 h after the forecast from ${fmtHm(v.t)} (price then ${px(v.px0)}): ${px(p)}, like the cone on the chart. An interval, not a direction.`
      );
    add('coneHi', tr('Stożek 1 h: górna granica 90%', 'Cone 1 h: upper 90% bound'), 'MODEL', isAbsent(f) ? f : { px: f.hi, hint: hint(f.hi, f) });
    add('coneLo', tr('Stożek 1 h: dolna granica 90%', 'Cone 1 h: lower 90% bound'), 'MODEL', isAbsent(f) ? f : { px: f.lo, hint: hint(f.lo, f) });
  }

  return { levels, missing };
}

function bandLabel(id: 'vwapUp1' | 'vwapDn1' | 'vwapUp2' | 'vwapDn2'): string {
  const k = id === 'vwapUp1' ? '+1σ' : id === 'vwapDn1' ? '−1σ' : id === 'vwapUp2' ? '+2σ' : '−2σ';
  return `VWAP ${k}`;
}

/** Paliwo między ceną a poziomem: USD albo powód (mapa bez liczby, poziom poza zasięgiem mapy). */
function fuelOf(m: Got<LiqMap>, price: number, level: number): Got<number> {
  if (isAbsent(m)) return m;
  if (Math.abs(level / m.markPx - 1) > LIQ_MAP_RANGE) {
    const r = fmtFixed(LIQ_MAP_RANGE * 100, 0);
    return { why: tr(`Poziom poza zasięgiem mapy likwidacji (±${r}% od ceny mark)`, `The level is outside the liquidation map range (±${r}% of the mark price)`) };
  }
  return liqBetween(m, price, level);
}

/** Lista panelu: poziomy nad i pod ceną (po `perSide` najbliższych), poziomy bez liczby i stan migawek skanera. */
export function nearestLevels(x: LevelInputs, perSide = LEVELS_PER_SIDE): NearestLevels {
  const { levels, missing } = levelsOf(x);
  const liq = liqState(x);
  const entry = entryState(x);
  const p = got(x.price);
  const c5m = got(x.c5m);
  const atr = c5m ? atr5mOf(c5m, x.now) : { why: missingWhy(x.c5m) };
  const base = { coin: x.coin, now: x.now, atr, missing, liq: meta(liq, x.liq.status), entry: meta(entry, x.entry.status) };
  if (p === null || !(p > 0)) {
    const why = p === null ? missingWhy(x.price) : tr('Brak ceny rynku', 'No market price');
    return { ...base, price: { why }, above: [], below: [], hidden: 0 };
  }
  const a = isAbsent(atr) ? null : atr.value;
  const rows: LevelRow[] = levels
    .filter((l) => Number.isFinite(l.px) && l.px > 0)
    .map((l) => ({ ...l, distPct: distPctOf(l.px, p), distAtr: a === null ? null : Math.abs(l.px - p) / a, fuel: fuelOf(liq, p, l.px) }));
  const above = rows.filter((r) => r.px >= p).sort((u, v) => u.px - v.px);
  const below = rows.filter((r) => r.px < p).sort((u, v) => v.px - u.px);
  const hidden = Math.max(0, above.length - perSide) + Math.max(0, below.length - perSide);
  return { ...base, price: p, above: above.slice(0, perSide), below: below.slice(0, perSide), hidden };
}
