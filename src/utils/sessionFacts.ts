/**
 * Fakty sesji Londynu albo NY ze świec 1m — jedno źródło dla nagłówka układu Rozliczenie i kart Rozliczenia sesji Po sesji:
 * zakres z minutami ekstremów, IB (pierwsza godzina) i pierwsze wyjście z niego, zamknięcie, value area 70% (`profile`)
 * tej i poprzedniej sesji tego samego typu. Oraz sesja w toku na żywo (`sessionNowOf`: nagłówek Kokpitu i Otwarcia
 * aukcji, serwer MCP). Bez modułów wykresu.
 */
import { tr } from '../i18n';
import { fmtDayTime, fmtDm, fmtHm } from '../charts/pro/core/time';
import type { Candle } from '../charts/pro/hl/parse';
import { type VBar, profile, profileStep, sessionVwap, toVBars } from './auction';
import { type TradeSession, currentTradeSession, lastClosedSessions, nextTradeSession, previousSameSession } from './sessionDay';
import { TRADE_SESSION_NAME } from './sessionNames';
import type { Got } from './sessionText';

const MIN = 60_000;
/** Fakty tylko przy ≥ 95% minut okresu w świecach 1m. */
const COVERAGE = 0.95;

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

const asiaWhy = (now: number) => {
  const next = nextTradeSession(now);
  return tr(
    `Sesja azjatycka: budżet, IB i VWAP sesji liczymy w sesjach Londynu i NY; ${TRADE_SESSION_NAME[next.id]} otwiera o ${fmtHm(next.start)}`,
    `Asian session: the budget, IB and session VWAP are computed in the London and NY sessions; ${TRADE_SESSION_NAME[next.id]} opens at ${fmtHm(next.start)}`
  );
};

/** Sesja Londynu albo NY w toku ze świec 1m (rosnąco), które obejmują jej otwarcie; w Azji — powód. */
export function sessionNowOf(c1m: readonly Candle[], now: number): Got<SessionNow> {
  const s = currentTradeSession(now);
  if (!s) return { why: asiaWhy(now) };
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
