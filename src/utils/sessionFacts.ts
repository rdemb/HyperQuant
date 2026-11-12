/**
 * Fakty sesji Londynu albo NY ze świec 1m — jedno źródło dla nagłówka układu Rozliczenie i kart Rozliczenia sesji Po sesji:
 * zakres z minutami ekstremów, IB (pierwsza godzina) i pierwsze wyjście z niego, zamknięcie, value area 70% (`profile`)
 * tej i poprzedniej sesji tego samego typu. Oraz sesja w toku na żywo (`sessionNowOf`: nagłówek Kokpitu i Otwarcia
 * aukcji, serwer MCP), typ dnia z faktów (`dayTypeOf`) i oczekiwany zakres ze świec 1h z powodem braku (`expectedFrom`). Bez modułów
 * wykresu (i18n tutaj, nie w `sessionDay`).
 */
import { tr } from '../i18n';
import { fmtDayTime, fmtDm, fmtHm } from '../charts/pro/core/time';
import type { Candle } from '../charts/pro/hl/parse';
import { type VBar, extremeTouches, profile, profileStep, sessionVwap, toVBars } from './auction';
import { type DayType, classifyDay } from './dayType';
import {
  type TradeSession,
  LEVEL_HOURS,
  LEVEL_MIN_HOURS,
  PROFILE_DAYS,
  PROFILE_LOOKBACK_DAYS,
  currentTradeSession,
  expectedSessionRange,
  lastClosedSessions,
  nextTradeSession,
  previousSameSession,
} from './sessionDay';
import { TRADE_SESSION_NAME } from './sessionNames';
import type { Expected, Got } from './sessionText';

const MIN = 60_000;
/** Fakty tylko przy ≥ 95% minut okresu w świecach 1m. */
const COVERAGE = 0.95;
/** Okno słabości ekstremum poprzedniej sesji (dwa różne okna z ekstremum — szczyt albo dno słabe). */
const POOR_WINDOW_MS = 30 * MIN;

export interface SessionFacts {
  s: TradeSession;
  hi: number;
  lo: number;
  /** Minuty pierwszego osiągnięcia szczytu i dołka sesji. */
  hiAt: number;
  loAt: number;
  close: number;
  ibHi: number;
  ibLo: number;
  ibDone: boolean;
  /** Pierwsza minuta po IB z ceną poza nim; null — bez wybicia. */
  breakAt: number | null;
  /** Koszyk profilu (USD). */
  step: number;
  va: { vah: number; val: number } | null;
  /** Poprzednia sesja tego samego typu i jej value area; null — świece 1m jej nie obejmują. */
  prev: TradeSession;
  prevVa: { vah: number; val: number } | null;
}

/** Sesja do rozliczenia w nagłówku: w toku albo ostatnia zamknięta. */
export function reviewSession(now: number): { s: TradeSession; inProgress: boolean } {
  const cur = currentTradeSession(now);
  return cur ? { s: cur, inProgress: true } : { s: lastClosedSessions(now, 1)[0], inProgress: false };
}

/** Świece okresu [from, min(to, now)), gdy obejmują jego początek i ≥ 95% minut; inaczej null. */
function windowBars(bars: readonly VBar[], from: number, to: number, now: number): VBar[] | null {
  const end = Math.min(to, now);
  if (bars.length === 0 || bars[0].time > from || !(end > from)) return null;
  const list = bars.filter((b) => b.time >= from && b.time < end);
  return list.length > 0 && list.length >= COVERAGE * Math.ceil((end - from) / MIN) ? list : null;
}

/** Fakty sesji `s` w chwili `now` ze świec 1m (rosnąco, najlepiej od otwarcia poprzedniej sesji tego samego typu). */
export function sessionFacts(bars1m: readonly VBar[], s: TradeSession, now: number): Got<SessionFacts> {
  const bars = windowBars(bars1m, s.start, s.end, now);
  const ib = bars ? bars.filter((b) => b.time < s.ibEnd) : [];
  const name = TRADE_SESSION_NAME[s.id];
  if (!bars || ib.length === 0) {
    const since = bars1m.length ? tr(`; świece od ${fmtDayTime(bars1m[0].time, now)}`, `; candles from ${fmtDayTime(bars1m[0].time, now)}`) : '';
    return {
      why: tr(
        `Świece 1m nie obejmują całej sesji ${name} od ${fmtHm(s.start)} (min. 95% minut${since})`,
        `The 1m candles do not cover the whole ${name} session since ${fmtHm(s.start)} (min. 95% of minutes${since})`
      ),
    };
  }
  let hi = -Infinity;
  let lo = Infinity;
  let hiAt = 0;
  let loAt = 0;
  for (const b of bars) {
    if (b.high > hi) [hi, hiAt] = [b.high, b.time];
    if (b.low < lo) [lo, loAt] = [b.low, b.time];
  }
  const ibHi = Math.max(...ib.map((b) => b.high));
  const ibLo = Math.min(...ib.map((b) => b.low));
  const brk = bars.find((b) => b.time >= s.ibEnd && (b.high > ibHi || b.low < ibLo));
  const close = bars[bars.length - 1].close;
  const step = profileStep(close);
  const prev = previousSameSession(s);
  const prevBars = windowBars(bars1m, prev.start, prev.end, now);
  const va = profile(bars, step);
  const pv = prevBars ? profile(prevBars, step) : null;
  return {
    s,
    hi,
    lo,
    hiAt,
    loAt,
    close,
    ibHi,
    ibLo,
    ibDone: now >= s.ibEnd,
    breakAt: brk ? brk.time : null,
    step,
    va: va ? { vah: va.vah, val: va.val } : null,
    prev,
    prevVa: pv ? { vah: pv.vah, val: pv.val } : null,
  };
}

/**
 * Typ dnia (MODEL · Dalton) z faktów sesji: dopiero po IB; IB w budowie albo zakres IB zerowy — powód. Jedno źródło dla
 * nagłówka układu Rozliczenie, karty Rozliczenia i serwera MCP.
 */
export function dayTypeOf(f: SessionFacts): Got<Exclude<DayType, 'unknown'>> {
  if (!f.ibDone) return { why: tr(`IB w budowie do ${fmtHm(f.s.ibEnd)}`, `IB forming until ${fmtHm(f.s.ibEnd)}`) };
  const t = classifyDay(f);
  return t === 'unknown' ? { why: tr('zakres IB zerowy albo brak liczb', 'zero IB range or missing numbers') } : t;
}

/** Poprzednia sesja tego samego typu: profil wolumenu (POC i value area 70%, koszyki `PROFILE_STEP`), ekstrema i ich słabość. */
export interface PrevSessionProfile {
  poc: number;
  vah: number;
  val: number;
  high: number;
  low: number;
  poorHigh: boolean;
  poorLow: boolean;
}

/**
 * Profil poprzedniej sesji tego samego typu co `s` ze świec 1m (rosnąco) — poziomy „poprz. sesji” Kontekstu aukcji Przed
 * sesją i serwera MCP: tylko przy ≥ 95% minut tamtej sesji (inaczej profil z dziurą), słabość ekstremów w oknach 30 min.
 * Za mało świec albo świece bez wolumenu — powód.
 */
export function prevSessionProfile(bars1m: readonly VBar[], s: TradeSession): Got<PrevSessionProfile> {
  const p0 = previousSameSession(s);
  const bars = bars1m.filter((b) => b.time >= p0.start && b.time < p0.end);
  if (bars.length < COVERAGE * ((p0.end - p0.start) / MIN)) {
    const pn = `${TRADE_SESSION_NAME[p0.id]} ${fmtDm(p0.start)}`;
    return { why: tr(`Świece 1m nie obejmują poprzedniej sesji ${pn} (min. 95% minut)`, `The 1m candles do not cover the previous session ${pn} (min. 95% of minutes)`) };
  }
  const p = profile(bars);
  const t = extremeTouches(bars, POOR_WINDOW_MS);
  if (!p || !t) return { why: tr('Brak wolumenu w świecach poprzedniej sesji', 'No volume in the candles of the previous session') };
  return { ...p, high: t.high, low: t.low, poorHigh: t.hiTouches >= 2, poorLow: t.loTouches >= 2 };
}

/** Powód braku migracji VA (ten sam w nagłówku i na karcie); null — obie value area są. */
export function vaMissing(f: SessionFacts): string | null {
  const pn = `${TRADE_SESSION_NAME[f.prev.id]} ${fmtDm(f.prev.start)}`;
  if (!f.prevVa) return tr(`Świece 1m nie obejmują poprzedniej sesji ${pn} (min. 95% minut)`, `The 1m candles do not cover the previous session ${pn} (min. 95% of minutes)`);
  if (!f.va) return tr('Brak wolumenu w świecach sesji', 'No volume in the session candles');
  return null;
}

/** Sesja Londynu albo NY w toku ze świec 1m: zakres od otwarcia, Initial Balance (pierwsza godzina) i VWAP sesji. */
export interface SessionNow {
  s: TradeSession;
  hi: number;
  lo: number;
  close: number;
  ibHi: number;
  ibLo: number;
  ibDone: boolean;
  vwap: { vwap: number; sd: number } | null;
}

/** Powód braku liczb sesji w sesji azjatyckiej, z godziną najbliższego otwarcia (nagłówek układu, serwer MCP). */
export const asianSessionWhy = (now: number): string => {
  const next = nextTradeSession(now);
  return tr(
    `Sesja azjatycka: budżet, IB i VWAP sesji liczymy w sesjach Londynu i NY; ${TRADE_SESSION_NAME[next.id]} otwiera o ${fmtHm(next.start)}`,
    `Asian session: the budget, IB and session VWAP are computed in the London and NY sessions; ${TRADE_SESSION_NAME[next.id]} opens at ${fmtHm(next.start)}`
  );
};

/** Sesja Londynu albo NY w toku ze świec 1m (rosnąco), które obejmują jej otwarcie; w Azji — powód. */
export function sessionNowOf(c1m: readonly Candle[], now: number): Got<SessionNow> {
  const s = currentTradeSession(now);
  if (!s) return { why: asianSessionWhy(now) };
  if (c1m.length === 0) return { why: tr('Czekam na świece 1m', 'Waiting for 1m candles') };
  if (c1m[0].t > s.start) return { why: tr('Świece 1m nie obejmują otwarcia sesji', 'The 1m candles do not cover the session open') };
  const bars = toVBars(c1m.filter((c) => c.t >= s.start && c.t < Math.min(now, s.end)));
  if (bars.length === 0) return { why: tr('Brak świec sesji', 'No session candles') };
  const ib = bars.filter((b) => b.time < s.ibEnd);
  const v = sessionVwap(bars);
  return {
    s,
    hi: Math.max(...bars.map((b) => b.high)),
    lo: Math.min(...bars.map((b) => b.low)),
    close: bars[bars.length - 1].close,
    ibHi: Math.max(...ib.map((b) => b.high)),
    ibLo: Math.min(...ib.map((b) => b.low)),
    ibDone: now >= s.ibEnd,
    vwap: v ? { vwap: v.vwap, sd: v.sd } : null,
  };
}

/**
 * Oczekiwany zakres sesji albo powód braku — jedno źródło dla nagłówka układu, karty Rozliczenia i serwera MCP (świece 1h
 * rozwiązuje wywołujący, od `expectedCandlesFrom`). Liczony ze świec zamkniętych przed godziną otwarcia, więc ten sam
 * w trakcie sesji i po jej końcu (sesja zamknięta — od własnej ceny sprzed otwarcia, nie od bieżącej).
 */
export function expectedFrom(bars1h: readonly VBar[], s: TradeSession): Got<Expected> {
  const e = expectedSessionRange(bars1h, s);
  if (!('missing' in e)) return { usd: e.usd, typical: e.typical, method: e.method };
  if (e.missing === 'price') return { why: tr('Brak świecy 1h sprzed otwarcia sesji', 'No 1h candle from before the session open') };
  if (e.missing === 'level') {
    return {
      why: tr(
        `Za mało świec 1h z doby przed sesją (${e.hours} z ${LEVEL_HOURS}, min. ${LEVEL_MIN_HOURS})`,
        `Too few 1h candles from the day before the session (${e.hours} of ${LEVEL_HOURS}, min. ${LEVEL_MIN_HOURS})`
      ),
    };
  }
  const days = e.weekend ? tr('dni weekendowych', 'weekend days') : tr('dni roboczych', 'weekdays');
  return {
    why: tr(
      `Mniej niż ${PROFILE_DAYS} ${days} ze świecami 1h w ${PROFILE_LOOKBACK_DAYS} dniach przed sesją`,
      `Fewer than ${PROFILE_DAYS} ${days} with 1h candles in the ${PROFILE_LOOKBACK_DAYS} days before the session`
    ),
  };
}
