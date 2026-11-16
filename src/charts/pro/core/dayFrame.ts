import { type VaMigration, vaMigration } from '../../../utils/dayType';
import { type TradeSessionId, currentTradeSession, previousSameSession, tradeSessionOn } from '../../../utils/sessionDay';
import { NYSE_CALENDAR, type NyseCalendar, wallStreetAt } from '../../../utils/wallStreet';
import { type Ivb, IVB_DEFAULT, type IvbState, ivbAt, ivbMinutes } from './ivb';
import { type Bar5, type Levels, profileLevels } from './pbRanges';
import { utcDayStart } from './sessions';
import { DAY } from './time';
import { type ValueKind, type ValueRef, type ValueSource, valueReference } from './valueReference';

/**
 * Rama dnia (Fabio runda 2, krok 1): opis stanu aukcji wobec wczorajszej wartości i IVB, bez słowa o dalszym kierunku.
 *
 * F-A1. Przyjęcie poza wartością (pojęcie akceptacji Daltona; reguła i progi HyperQuant, zamrożone przed oceną):
 * - VA wczoraj = value area 70% poprzedniej doby UTC z jednego źródła wartości (`valueReference`: taśma przy ≥ 90%
 *   wolumenu, inaczej świece 5m; koszyki 5 pb), tej samej co panel „Najbliższe poziomy”, nagłówek Mapy dnia i poziomy
 *   doby P/b; opcjonalnie (nie domyślnie) VA tej samej sesji wczoraj;
 * - liczniki (minuty poza VA, udział wolumenu, kolejne zamknięcia 30m) od otwarcia bieżącej sesji (Londyn, NY z kalendarza
 *   sesji, `currentTradeSession`), od nowa na każdym otwarciu; poza sesjami od 00:00 UTC („poza sesją”); tylko zamknięte
 *   świece; zamknięcie 30m = zamknięcie ostatniej świecy półgodziny liczonej od otwarcia;
 * - wolumen świecy rozłożony równo na jej zakres, część poza VA liczy się jako wolumen nad albo pod;
 * - przyjęcie nad (pod): ≥ 2 kolejne zamknięcia 30m nad VAH (pod VAL) i ≥ 30% wolumenu od otwarcia nad VAH (pod VAL);
 * - próba wyjścia nad (pod): ostatnie zamknięcie świecy nad VAH (pod VAL) bez spełnionego progu przyjęcia;
 * - powrót do wartości: ostatnie zamknięcie w VA po co najmniej jednym zamknięciu 30m poza VA od otwarcia;
 * - w wartości: ostatnie zamknięcie w VA i żadne zamknięcie 30m od otwarcia poza VA;
 * - niesklasyfikowane: przyjęcie po obu stronach VA od otwarcia albo ostatnie zamknięcie świecy po przeciwnej stronie
 *   VA niż ostatnie zamknięcie 30m (przejście przez całą wartość w ciągu pół godziny).
 * Kontekst (hipoteza zerowa): ten sam stan w tej samej minucie od otwarcia tej samej sesji (poza sesją: o tej samej porze
 * od 00:00 UTC) w 60 poprzednich dobach, ze świec 30m (VA doby poprzedniej też ze świec 30m — przybliżenie); mniej niż
 * 60 dób z danymi — bez częstości („krótka historia”).
 *
 * F-A2. Kontekst IVB (okno z `ivbAt`, domyślnie 30 min od otwarcia NY):
 * - status (fakt): w budowie, w środku, wybicie nad albo pod (ostatnie zamknięcie poza zakresem; od zamknięcia pierwszej
 *   świecy tej serii), powrót do środka (w zakresie po zamknięciu poza nim);
 * - szerokość w ATR doby (średni prawdziwy zakres 14 dób UTC przed dobą, ze świec 30m) i jej percentyl wobec 20
 *   poprzednich sesji NY tego samego typu (krypto: dni robocze albo weekend UTC; rynek z sesją NYSE: tylko dni sesji
 *   NYSE); mniej niż 20 sesji — bez percentyla.
 * Rynek bez sesji regularnej NYSE w kalendarzu (metale, ropa) albo spoza listy desku na giełdzie HIP-3: IVB „—” z powodem.
 */

export type Side = 1 | -1;
export interface Va {
  vah: number;
  val: number;
}

/** Progi przyjęcia (zamrożone 16.11.2026, przed oceną na danych). */
export const ACCEPT_CLOSES = 2;
export const ACCEPT_SHARE = 0.3;
export const PERIOD_MS = 30 * 60_000;
/** Doby kontekstu stanu i najdalej wstecz (doba bez danych jest pomijana). */
export const STATE_DAYS = 60;
export const STATE_LOOKBACK_DAYS = 70;
/** Sesje NY do percentyla szerokości IVB i najdalej wstecz. */
export const IVB_SESSIONS = 20;
export const IVB_LOOKBACK_DAYS = 60;
/** ATR doby: średni prawdziwy zakres z tylu dób UTC przed dobą (najmniej ATR_MIN_DAYS pełnych). */
export const ATR_DAYS = 14;
export const ATR_MIN_DAYS = 10;
/** Koszyk profilu jak jedno źródło wartości (`valueReference`). */
const DAY_BIN_BP = 5;
/** Doba albo okres z co najmniej tylu świec, ile powinno być (jak `valueReference`). */
const COMPLETE = 0.9;
/** Wartość dziś: profil z co najmniej pół godziny świec 5m. */
const TODAY_MIN_MS = 30 * 60_000;

/** Świece wykresu → świece profilu P/b: tylko zamknięte w `now`, wolumen w USD (wolumen × zamknięcie), jak warstwa P/b. */
export function toBar5(candles: readonly { t: number; o: number; h: number; l: number; c: number; v: number }[], ms: number, now: number): Bar5[] {
  const out: Bar5[] = [];
  for (const c of candles) if (c.t + ms <= now) out.push({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v * c.c });
  return out;
}

// ───────────────────────── F-A1: przyjęcie poza wartością ─────────────────────────

export type AuctionState =
  | { kind: 'inside' }
  | { kind: 'attempt'; side: Side }
  | { kind: 'accepted'; side: Side }
  | { kind: 'return' }
  | { kind: 'unclassified'; why: 'both-sides' | 'whipsaw' };

export type StateKey = 'inside' | 'attempt-up' | 'attempt-down' | 'accepted-up' | 'accepted-down' | 'return' | 'unclassified';
export const STATE_KEYS: readonly StateKey[] = ['inside', 'attempt-up', 'attempt-down', 'accepted-up', 'accepted-down', 'return', 'unclassified'];

export function stateKey(s: AuctionState): StateKey {
  switch (s.kind) {
    case 'attempt':
      return s.side > 0 ? 'attempt-up' : 'attempt-down';
    case 'accepted':
      return s.side > 0 ? 'accepted-up' : 'accepted-down';
    default:
      return s.kind;
  }
}

export interface Acceptance {
  state: AuctionState;
  /** Kolejne zamknięcia 30m poza VA po stronie ostatniego zamknięcia 30m (0 — w VA albo jeszcze bez zamknięcia). */
  run: number;
  runSide: Side | 0;
  /** Udział wolumenu doby dotąd nad VAH i pod VAL (0–1). */
  above: number;
  below: number;
  /** Minuty świec zamkniętych poza VA. */
  minutesOutside: number;
  /** Zamknięte półgodziny doby. */
  periods: number;
  /** Ostatnie zamknięcie świecy i jego chwila (koniec świecy). */
  close: number;
  closeAt: number;
}

/** Początek liczników: otwarcie bieżącej sesji Londynu albo NY; poza sesjami 00:00 UTC (`session` null). */
export interface CounterAnchor {
  from: number;
  session: TradeSessionId | null;
}

/** Początek liczników w chwili `now` z kalendarza sesji (czas letni z `tradeSessionOn`, bez stałych godzin). */
export function counterAnchor(now: number): CounterAnchor {
  const s = currentTradeSession(now);
  return s ? { from: s.start, session: s.id } : { from: utcDayStart(now), session: null };
}

/**
 * Stan aukcji od chwili `from` (otwarcie sesji albo 00:00 UTC) wobec `va` ze świec `bars` (rosnąco, interwał `ms`
 * dzielący 30 min) zamkniętych do `now`; półgodziny liczone od `from`; bez zamkniętej świecy od `from` — null.
 */
export function acceptanceAt(va: Va, bars: readonly Bar5[], ms: number, from: number, now: number): Acceptance | null {
  const sideOf = (x: number): Side | 0 => (x > va.vah ? 1 : x < va.val ? -1 : 0);
  let tot = 0;
  let up = 0;
  let dn = 0;
  let outMs = 0;
  let run = 0;
  let runSide: Side | 0 = 0;
  let periods = 0;
  let lastIdx = 0;
  let anyOut = false;
  const ever = { up: false, dn: false };
  let last: Bar5 | null = null;
  const share = (s: Side) => (tot > 0 ? (s > 0 ? up : dn) / tot : 0);
  const accepted = () => runSide !== 0 && run >= ACCEPT_CLOSES && share(runSide) >= ACCEPT_SHARE;
  for (const b of bars) {
    if (b.t < from || b.t >= from + DAY || b.t + ms > now) continue;
    const span = b.h - b.l;
    tot += b.v;
    if (span > 0) {
      up += (b.v * Math.max(0, b.h - Math.max(b.l, va.vah))) / span;
      dn += (b.v * Math.max(0, Math.min(b.h, va.val) - b.l)) / span;
    } else if (b.c > va.vah) up += b.v;
    else if (b.c < va.val) dn += b.v;
    if (sideOf(b.c) !== 0) outMs += ms;
    last = b;
    const end = b.t + ms;
    if ((end - from) % PERIOD_MS !== 0) continue;
    // Świeca zamyka półgodzinę; brak poprzedniej półgodziny (luka w danych) przerywa serię zamknięć
    const idx = (end - from) / PERIOD_MS;
    if (idx !== lastIdx + 1) {
      run = 0;
      runSide = 0;
    }
    lastIdx = idx;
    periods++;
    const s = sideOf(b.c);
    if (s === 0) {
      run = 0;
      runSide = 0;
    } else {
      anyOut = true;
      run = s === runSide ? run + 1 : 1;
      runSide = s;
    }
    if (accepted()) ever[runSide > 0 ? 'up' : 'dn'] = true;
  }
  if (!last) return null;
  const acc = accepted();
  if (acc) ever[runSide > 0 ? 'up' : 'dn'] = true;
  const s5 = sideOf(last.c);
  let state: AuctionState;
  if (ever.up && ever.dn) state = { kind: 'unclassified', why: 'both-sides' };
  else if (acc) state = { kind: 'accepted', side: runSide as Side };
  else if (s5 !== 0) state = runSide !== 0 && runSide !== s5 ? { kind: 'unclassified', why: 'whipsaw' } : { kind: 'attempt', side: s5 };
  else state = anyOut ? { kind: 'return' } : { kind: 'inside' };
  return { state, run, runSide, above: share(1), below: share(-1), minutesOutside: outMs / 60_000, periods, close: last.c, closeAt: last.t + ms };
}

/** Świece rosnąco pogrupowane po dobach UTC. */
function byUtcDay(bars: readonly Bar5[]): Map<number, Bar5[]> {
  const m = new Map<number, Bar5[]>();
  for (const b of bars) {
    const d = utcDayStart(b.t);
    const a = m.get(d);
    if (a) a.push(b);
    else m.set(d, [b]);
  }
  return m;
}

/** Profil okresu ze świec 30m (koszyki jak `valueReference`), gdy jest co najmniej 90% jego półgodzin. */
function va30(list: readonly Bar5[] | undefined, periods = DAY / PERIOD_MS): Levels | null {
  if (!list || list.length === 0 || list.length < COMPLETE * periods) return null;
  return profileLevels(
    list.map((b) => b.l),
    list.map((b) => b.h),
    list.map((b) => b.v),
    DAY_BIN_BP,
    false
  );
}

/** Odniesienie wartości: wczorajsza doba UTC (domyślnie) albo ta sama sesja wczoraj (opcja, nie domyślnie). */
export type FrameRef = 'day' | 'same-session';

export interface StateHistory {
  /** Doby z danymi (najwyżej STATE_DAYS). */
  n: number;
  counts: Record<StateKey, number>;
  /** Pierwsze pół godziny od otwarcia (poza sesją: doby UTC): brak zamkniętej półgodziny do porównania. */
  early: boolean;
}

const zeroCounts = (): Record<StateKey, number> => Object.fromEntries(STATE_KEYS.map((k) => [k, 0])) as Record<StateKey, number>;

/**
 * Stany w tej samej minucie od otwarcia tej samej sesji co `now` (poza sesją: o tej samej porze od 00:00 UTC) w 60
 * poprzednich dobach (szukane do 70 dób wstecz) ze świec 30m `c30`: otwarcie każdej doby z kalendarza sesji (czas letni),
 * VA doby poprzedniej (albo tej samej sesji dzień wcześniej) z jej świec 30m, stan z `acceptanceAt` na półgodzinach
 * od otwarcia zamkniętych do tej samej minuty. Doba, w której ta minuta wypada już po końcu sesji (krótsza sesja Londynu
 * w tygodniu rozjazdu czasu), jest pomijana.
 */
export function stateHistory(c30: readonly Bar5[], now: number, ref: FrameRef = 'day'): StateHistory {
  const today = utcDayStart(now);
  const anchor = counterAnchor(now);
  const offset = now - anchor.from;
  const expected = Math.floor(offset / PERIOD_MS);
  const counts = zeroCounts();
  if (expected === 0) return { n: 0, counts, early: true };
  const days = byUtcDay(c30);
  const window = (d: number) => (anchor.session ? tradeSessionOn(d, anchor.session) : { start: d, end: d + DAY });
  let n = 0;
  for (let k = 1; k <= STATE_LOOKBACK_DAYS && n < STATE_DAYS; k++) {
    const d = today - k * DAY;
    let va: Levels | null;
    if (ref === 'same-session' && anchor.session) {
      const p = previousSameSession(tradeSessionOn(d, anchor.session));
      va = va30(
        (days.get(utcDayStart(p.start)) ?? []).filter((b) => b.t >= p.start && b.t + PERIOD_MS <= p.end),
        Math.floor((p.end - p.start) / PERIOD_MS)
      );
    } else va = va30(days.get(d - DAY));
    if (!va) continue;
    const w = window(d);
    const cut = w.start + offset;
    if (cut > w.end) continue;
    const list = (days.get(d) ?? []).filter((b) => b.t >= w.start && b.t + PERIOD_MS <= cut);
    if (list.length < COMPLETE * expected) continue;
    const a = acceptanceAt(va, list, PERIOD_MS, w.start, cut);
    if (!a) continue;
    counts[stateKey(a.state)]++;
    n++;
  }
  return { n, counts, early: false };
}

// ───────────────────────── wartość dziś wobec wczoraj ─────────────────────────

export interface ValueToday {
  /** VA okresu dotąd (doba UTC albo, przy odniesieniu do sesji, bieżąca sesja) z jednego źródła. */
  today: ValueRef;
  migration: VaMigration;
  /** Część VA dziś leżąca w VA wczoraj (0–1). */
  overlap: number;
}

/**
 * VA doby UTC dotąd (albo bieżącej sesji przy `kind` „session”) z jednego źródła wartości wobec VA wczoraj; mniej niż
 * pół godziny świec — null.
 */
export function valueToday(src: ValueSource, now: number, prev: Va, kind: ValueKind = 'day'): ValueToday | null {
  const today = valueReference(kind, now, src, now);
  if (!today || today.bars * src.ms < TODAY_MIN_MS) return null;
  const w = today.vah - today.val;
  const common = Math.max(0, Math.min(today.vah, prev.vah) - Math.max(today.val, prev.val));
  return { today, migration: vaMigration(today, prev), overlap: w > 0 ? common / w : today.val >= prev.val && today.vah <= prev.vah ? 1 : 0 };
}

// ───────────────────────── F-A2: kontekst IVB ─────────────────────────

/** Kalendarz otwarć NY rynku: codziennie (krypto), dni sesji NYSE, albo IVB nie dotyczy (z powodem). */
export type IvbCalendar = { kind: 'daily' } | { kind: 'nyse' } | { kind: 'none'; why: 'no-rth' | 'unknown' };

/**
 * Kalendarz IVB rynku `coin`: rynek głównej giełdy Hyperliquid albo klasy krypto codziennie; z listy desku według
 * kalendarza rynku bazowego (sesja regularna NYSE — dni sesji, inny kalendarz — nie dotyczy); akcje i indeksy z rejestru
 * (`cls`) — dni sesji NYSE; reszta HIP-3 — kalendarz nieznany.
 */
export function ivbCalendarOf(coin: string, desk: { calendar: string; rth?: unknown } | null, cls?: string): IvbCalendar {
  if (desk) return desk.calendar === 'crypto' ? { kind: 'daily' } : desk.rth ? { kind: 'nyse' } : { kind: 'none', why: 'no-rth' };
  if (!coin.includes(':') || cls === 'crypto') return { kind: 'daily' };
  return cls === 'equity' || cls === 'index' ? { kind: 'nyse' } : { kind: 'none', why: 'unknown' };
}

export type IvbStatus = { kind: 'forming' } | { kind: 'inside' } | { kind: 'broke'; side: Side; since: number } | { kind: 'back' };

/** Status ceny wobec IVB ze świec `bars` (rosnąco, interwał `ms`) zamkniętych do `now`, od końca okna. */
export function ivbStatus(ivb: Ivb, bars: readonly Bar5[], ms: number, now: number): IvbStatus {
  if (!ivb.complete) return { kind: 'forming' };
  let side: Side | 0 = 0;
  let since = 0;
  let out = false;
  for (const b of bars) {
    if (b.t < ivb.end || b.t + ms > now) continue;
    const s: Side | 0 = b.c > ivb.hi ? 1 : b.c < ivb.lo ? -1 : 0;
    if (s !== 0) {
      out = true;
      if (s !== side) since = b.t + ms;
    }
    side = s;
  }
  if (side !== 0) return { kind: 'broke', side, since };
  return out ? { kind: 'back' } : { kind: 'inside' };
}

/** ATR doby `day`: średni prawdziwy zakres dób UTC przed nią ze świec 30m (doby z ≥ 90% półgodzin); za mało dób — null. */
function dayAtr(days: Map<number, Bar5[]>, day: number): number | null {
  const full = (d: number) => {
    const list = days.get(d);
    if (!list || list.length < COMPLETE * (DAY / PERIOD_MS)) return null;
    let h = -Infinity;
    let l = Infinity;
    for (const b of list) {
      h = Math.max(h, b.h);
      l = Math.min(l, b.l);
    }
    return { h, l, c: list[list.length - 1].c };
  };
  let sum = 0;
  let n = 0;
  for (let j = 1; j <= ATR_DAYS; j++) {
    const x = full(day - j * DAY);
    if (!x) continue;
    const pc = full(day - (j + 1) * DAY)?.c;
    sum += pc === undefined ? x.h - x.l : Math.max(x.h, pc) - Math.min(x.l, pc);
    n++;
  }
  return n >= ATR_MIN_DAYS && sum > 0 ? sum / n : null;
}

/** Sesja NYSE w dniu otwarcia NY `open`: true, false albo null (brak kalendarza na ten rok). */
function nyseOpenDay(open: number, cal: NyseCalendar | null): boolean | null {
  const ws = wallStreetAt(open + 60_000, cal);
  return ws.state === 'open' ? true : ws.state === 'closed' ? false : null;
}

const isWeekendDay = (d: number) => {
  const w = new Date(d).getUTCDay();
  return w === 0 || w === 6;
};

/** Szerokość IVB w ATR i jej percentyl wobec poprzednich sesji. */
export type IvbWidth =
  | { kind: 'ok'; ratio: number; atr: number; p: number; n: number; median: number }
  | { kind: 'short'; ratio: number; atr: number; n: number }
  | { kind: 'noAtr' };

/**
 * Szerokości IVB (w ATR doby) poprzednich sesji NY tego samego typu co doba `day`, od najnowszej, najwyżej 20 (szukane
 * do 60 dób wstecz), ze świec 30m: okno 30 min to jedna świeca 30m od otwarcia, 60 min — dwie.
 */
export function ivbWidthHistory(c30: readonly Bar5[], day: number, minutes: number, cal: IvbCalendar, nyse: NyseCalendar | null = NYSE_CALENDAR): number[] {
  if (cal.kind === 'none') return [];
  const days = byUtcDay(c30);
  const need = Math.round((minutes * 60_000) / PERIOD_MS);
  const out: number[] = [];
  for (let k = 1; k <= IVB_LOOKBACK_DAYS && out.length < IVB_SESSIONS; k++) {
    const d = day - k * DAY;
    const open = tradeSessionOn(d, 'ny').start;
    if (cal.kind === 'nyse' ? nyseOpenDay(open, nyse) !== true : isWeekendDay(d) !== isWeekendDay(day)) continue;
    const win = (days.get(d) ?? []).filter((b) => b.t >= open && b.t < open + minutes * 60_000);
    if (win.length !== need) continue;
    const atr = dayAtr(days, d);
    if (atr === null) continue;
    let h = -Infinity;
    let l = Infinity;
    for (const b of win) {
      h = Math.max(h, b.h);
      l = Math.min(l, b.l);
    }
    out.push((h - l) / atr);
  }
  return out;
}

/** Percentyl (0–100) wartości `x` wobec `past`: część mniejszych plus połowa równych. */
export function percentileOf(x: number, past: readonly number[]): number {
  let below = 0;
  let equal = 0;
  for (const v of past) {
    if (v < x) below++;
    else if (v === x) equal++;
  }
  return (100 * (below + 0.5 * equal)) / past.length;
}

const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export type IvbFrame =
  | { kind: 'na'; why: 'no-rth' | 'unknown' | 'nyse-closed' | 'no-nyse-calendar' }
  /** Stan okna bez zakresu z `ivbAt` (przed otwarciem, luka, interwał, brak danych). */
  | { kind: 'state'; state: Exclude<IvbState, { kind: 'ok' }> }
  | { kind: 'ok'; ivb: Ivb; status: IvbStatus; width: IvbWidth };

export interface IvbFrameInput {
  b5: readonly Bar5[];
  c30: readonly Bar5[];
  now: number;
  cal: IvbCalendar;
  minutes?: number;
  nyse?: NyseCalendar | null;
}

/** Kontekst IVB bieżącej sesji NY: zakres z `ivbAt` na świecach 5m, status i szerokość wobec 20 sesji. */
export function ivbFrame({ b5, c30, now, cal, minutes: raw = IVB_DEFAULT, nyse = NYSE_CALENDAR }: IvbFrameInput): IvbFrame {
  if (cal.kind === 'none') return { kind: 'na', why: cal.why };
  const minutes = ivbMinutes(raw);
  const ms = 5 * 60_000;
  const s = ivbAt(
    b5.map((b) => ({ t: b.t, candle: { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, n: 0 } })),
    ms,
    minutes,
    now
  );
  if (s.kind !== 'ok') return { kind: 'state', state: s };
  if (cal.kind === 'nyse') {
    const open = nyseOpenDay(s.ivb.start, nyse);
    if (open === null) return { kind: 'na', why: 'no-nyse-calendar' };
    if (!open) return { kind: 'na', why: 'nyse-closed' };
  }
  const day = utcDayStart(s.ivb.start);
  const atr = dayAtr(byUtcDay(c30), day);
  let width: IvbWidth = { kind: 'noAtr' };
  if (atr !== null) {
    const ratio = (s.ivb.hi - s.ivb.lo) / atr;
    const past = ivbWidthHistory(c30, day, minutes, cal, nyse);
    width = past.length >= IVB_SESSIONS ? { kind: 'ok', ratio, atr, p: percentileOf(ratio, past), n: past.length, median: median(past) } : { kind: 'short', ratio, atr, n: past.length };
  }
  return { kind: 'ok', ivb: s.ivb, status: ivbStatus(s.ivb, b5, ms, now), width };
}

// ───────────────────────── całość ─────────────────────────

export interface DayFrame {
  day: number;
  /** Odniesienie użyte w tej chwili (przy „same-session” poza sesją — doba). */
  ref: FrameRef;
  /** VA wczoraj z jednego źródła (`valueReference`); null — świece 5m nie obejmują 90% okresu. */
  prev: ValueRef | null;
  value: ValueToday | null;
  /** Początek liczników przyjęcia: otwarcie sesji albo 00:00 UTC poza sesją. */
  anchor: CounterAnchor;
  acceptance: Acceptance | null;
  history: StateHistory;
  ivb: IvbFrame;
}

export interface DayFrameInput extends IvbFrameInput {
  /** Jedno źródło wartości: świece 5m od wczoraj 00:00 UTC z taśmą i pliki taśmy zamkniętych dób. */
  src: ValueSource;
  /** Odniesienie (domyślnie wczorajsza doba UTC). */
  ref?: FrameRef;
}

/**
 * Rama dnia z zamkniętych świec 5m (od wczoraj 00:00 UTC), ze źródła wartości i ze świec 30m (ok. 80 dób) w chwili `now`.
 */
export function dayFrame(x: DayFrameInput): DayFrame {
  const ms = 5 * 60_000;
  const day = utcDayStart(x.now);
  const anchor = counterAnchor(x.now);
  const ref: FrameRef = x.ref === 'same-session' && anchor.session ? 'same-session' : 'day';
  const kind: ValueKind = ref === 'same-session' ? 'session' : 'day';
  const prevAt = ref === 'same-session' && anchor.session ? previousSameSession(tradeSessionOn(day, anchor.session)).start : day - DAY;
  const prev = valueReference(kind, prevAt, x.src, x.now);
  return {
    day,
    ref,
    prev,
    value: prev ? valueToday(x.src, x.now, prev, kind) : null,
    anchor,
    acceptance: prev ? acceptanceAt(prev, x.b5, ms, anchor.from, x.now) : null,
    history: stateHistory(x.c30, x.now, ref),
    ivb: ivbFrame(x),
  };
}
