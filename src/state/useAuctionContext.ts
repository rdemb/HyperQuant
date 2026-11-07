import { useEffect, useState } from 'react';
import { afterFirstSync, loadCandlesV, loadHourlyShared, parseHlCandlesV } from '../utils/marketDataFeed';
import {
  auctionStats,
  dayStart,
  extremeTouches,
  profile,
  sessionVwap,
  sessionsFromHourly,
  todayState,
  type AuctionStats,
  type TodayState,
  type VBar,
} from '../utils/auction';
import { currentTradeSession, lastClosedSessions, nextTradeSession, previousSameSession, type TradeSession } from '../utils/sessionDay';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Profil poprzedniej sesji z 1m tylko przy ≥ 95% minut sesji — inaczej profil z dziurą */
const PREV_COVERAGE = 0.95;

export interface AuctionContext {
  status: 'loading' | 'ready' | 'error';
  asOf: number | null;
  /**
   * Sesja, której dotyczą poziomy: bieżąca (Londyn albo NY) albo — w sesji azjatyckiej — ostatnia zamknięta
   * (NY poprzedniej doby UTC) z `closed: true`
   */
  session: (TradeSession & { closed: boolean }) | null;
  /** Następna sesja (tylko gdy pokazana sesja jest zamknięta) */
  next: TradeSession | null;
  /** VWAP sesji (świece 1m) */
  vwap: { vwap: number; sd: number; volume: number } | null;
  /** Initial Balance = pierwsza godzina sesji (świece 1m) */
  ib: { hi: number; lo: number; done: boolean } | null;
  /** Poprzednia sesja tego samego typu ze świec 1m: profil (70%), ekstrema, słabość (okna 30 min) */
  prev: { poc: number; vah: number; val: number; high: number; low: number; poorHigh: boolean; poorLow: boolean } | null;
  /** Stan sesji w regułach statystyki (poprzednia sesja ze świec 1h — tak jak w częstościach) */
  today: (TodayState & { prev1h: { val: number; vah: number; high: number; low: number; poorHigh: boolean; poorLow: boolean } }) | null;
  /** Częstości historyczne ze świec 1h — tylko sesje tego samego typu (Londyn albo NY) */
  stats: AuctionStats | null;
}

const EMPTY: AuctionContext = { status: 'loading', asOf: null, session: null, next: null, vwap: null, ib: null, prev: null, today: null, stats: null };

// Pamięć modułu: przełączanie widoków nie pobiera ponownie świec 1h (≈ 208 dni)
let hourlyCache: { at: number; bars: VBar[] } | null = null;
// Świece 1m od początku poprzedniej sesji tego samego typu — co minutę dociągamy tylko końcówkę
let minuteCache: VBar[] = [];

/** Sesja kontekstu: bieżąca (Londyn albo NY), a w sesji azjatyckiej ostatnia zamknięta (NY poprzedniej doby UTC). */
export function contextSession(now: number): { session: TradeSession; closed: boolean } {
  const cur = currentTradeSession(now);
  return cur ? { session: cur, closed: false } : { session: lastClosedSessions(now, 1)[0], closed: true };
}

/** Początek potrzebnych świec 1m: poprzednia sesja tego samego typu co sesja kontekstu (profil, ekstrema). */
export const minuteFrom = (now: number): number => previousSameSession(contextSession(now).session).start;

/** Tylko świece 1h zamknięte w chwili `asOf` (trwająca godzina zaniżałaby ekstrema i profil). */
export const completeHourly = (bars: VBar[], asOf: number): VBar[] => bars.filter((b) => b.time + HOUR <= asOf);

/** Pamięć świec 1h do odświeżenia: brak, starsza niż 30 min albo z poprzedniego dnia UTC (wczorajsza sesja NY niepełna). */
export const hourlyStale = (cacheAt: number | null, now: number): boolean =>
  cacheAt === null || now - cacheAt > 30 * MIN || dayStart(cacheAt) < dayStart(now);

/**
 * Pamięć 1m po dociągnięciu: świece sprzed pierwszej nowej zostają, nowe (od ostatniej, może trwającej) je zastępują;
 * wszystko sprzed `from` (początek poprzedniej sesji) odpada.
 */
export function mergeMinute(cache: VBar[], fresh: VBar[], from: number): VBar[] {
  const start = fresh.length ? fresh[0].time : Number.POSITIVE_INFINITY;
  return [...cache.filter((b) => b.time >= from && b.time < start), ...fresh.filter((b) => b.time >= from)];
}

/**
 * Wylicza kontekst aukcji sesji (Londyn albo NY; w Azji ostatnia zamknięta) ze świec 1m (ta sesja i poprzednia tego
 * samego typu) i 1h (statystyki tej sesji). Czysta funkcja — testowalna.
 */
export function computeAuctionContext(minute: VBar[], hourly: VBar[], now: number): AuctionContext {
  const { session: s, closed } = contextSession(now);
  const p0 = previousSameSession(s);
  const day = dayStart(s.start);
  const sesBars = minute.filter((b) => b.time >= s.start && b.time < Math.min(now, s.end));
  const prevBars = minute.filter((b) => b.time >= p0.start && b.time < p0.end);
  const vwap = sessionVwap(sesBars);
  const ibBars = sesBars.filter((b) => b.time < s.ibEnd);
  const ib = ibBars.length ? { hi: Math.max(...ibBars.map((b) => b.high)), lo: Math.min(...ibBars.map((b) => b.low)), done: now >= s.ibEnd } : null;
  const fullPrev = prevBars.length >= PREV_COVERAGE * ((p0.end - p0.start) / MIN);
  const p = fullPrev ? profile(prevBars) : null;
  const t = fullPrev ? extremeTouches(prevBars, 30 * MIN) : null;
  const prev = p && t ? { ...p, high: t.high, low: t.low, poorHigh: t.hiTouches >= 2, poorLow: t.loTouches >= 2 } : null;
  // Historia tylko sprzed pokazanej sesji i tylko ten sam typ sesji
  const sessions = sessionsFromHourly(hourly.filter((b) => b.time < s.start), s.id);
  const last = sessions[sessions.length - 1];
  const ts = last && last.day === day - DAY && sesBars.length ? todayState(last, sesBars, now, s) : null;
  return {
    status: 'ready',
    asOf: now,
    session: { ...s, closed },
    next: closed ? nextTradeSession(now) : null,
    vwap,
    ib,
    prev,
    today: ts ? { ...ts, prev1h: { val: last.val, vah: last.vah, high: last.high, low: last.low, poorHigh: last.poorHigh, poorLow: last.poorLow } } : null,
    stats: sessions.length > 1 ? auctionStats(sessions) : null,
  };
}

// Wspólny stan dla wszystkich widoków (Plan, Desk): jedno odpytywanie API niezależnie od liczby subskrybentów
let shared: AuctionContext = EMPTY;
const listeners = new Set<(c: AuctionContext) => void>();
let timer: number | null = null;
let inflight = false;

function publish(c: AuctionContext): void {
  shared = c;
  for (const l of listeners) l(c);
}

async function refresh(): Promise<void> {
  if (inflight) return;
  inflight = true;
  try {
    await afterFirstSync();
    const now = Date.now();
    if (hourlyStale(hourlyCache?.at ?? null, now)) {
      // Te same świece 1h co w modelu zmienności — jedno pobranie; po północy UTC tylko świeże (pełna wczorajsza sesja)
      const { at, raw } = await loadHourlyShared(Math.max(now - 30 * MIN, dayStart(now)), now);
      const bars = completeHourly(parseHlCandlesV(raw), at);
      if (bars.length) hourlyCache = { at, bars };
    }
    const from = minuteFrom(now);
    const kept = minuteCache.filter((b) => b.time >= from);
    const incremental = kept.length > 0 && kept[0].time - from < 5 * MIN;
    const fresh = await loadCandlesV('1m', incremental ? kept[kept.length - 1].time : from);
    if (fresh.length) minuteCache = mergeMinute(incremental ? kept : [], fresh, from);
    if (!minuteCache.length) {
      if (shared.status !== 'ready') publish({ ...EMPTY, status: 'error' });
      return;
    }
    publish(computeAuctionContext(minuteCache, hourlyCache?.bars ?? [], Date.now()));
  } catch {
    if (shared.status !== 'ready') publish({ ...EMPTY, status: 'error' });
  } finally {
    inflight = false;
  }
}

/**
 * Kontekst aukcji sesji Londynu albo NY: świece 1m co minutę (od początku poprzedniej sesji tego samego typu, dociągana
 * końcówka), 1h co 30 min; wspólny dla wszystkich widoków.
 */
export function useAuctionContext(): AuctionContext {
  const [ctx, setCtx] = useState<AuctionContext>(shared);
  useEffect(() => {
    listeners.add(setCtx);
    setCtx(shared);
    if (timer === null) {
      void refresh();
      timer = window.setInterval(() => void refresh(), MIN);
    }
    return () => {
      listeners.delete(setCtx);
      if (listeners.size === 0 && timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
  }, []);
  return ctx;
}
