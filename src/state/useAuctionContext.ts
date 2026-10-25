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

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export interface AuctionContext {
  status: 'loading' | 'ready' | 'error';
  asOf: number | null;
  /** VWAP bieżącej sesji UTC (świece 1m) */
  vwap: { vwap: number; sd: number; volume: number } | null;
  /** Initial Balance 00:00–01:00 UTC (świece 1m) */
  ib: { hi: number; lo: number; done: boolean } | null;
  /** Poprzednia sesja ze świec 1m: profil (70%), ekstrema, słabość (okna 30 min) */
  prev: { poc: number; vah: number; val: number; high: number; low: number; poorHigh: boolean; poorLow: boolean } | null;
  /** Stan bieżącej sesji w regułach statystyki (poprzednia sesja ze świec 1h — tak jak w częstościach) */
  today: (TodayState & { prev1h: { val: number; vah: number; high: number; low: number; poorHigh: boolean; poorLow: boolean } }) | null;
  /** Częstości historyczne ze świec 1h */
  stats: AuctionStats | null;
}

const EMPTY: AuctionContext = { status: 'loading', asOf: null, vwap: null, ib: null, prev: null, today: null, stats: null };

// Pamięć modułu: przełączanie widoków nie pobiera ponownie świec 1h (≈ 208 dni)
let hourlyCache: { at: number; bars: VBar[] } | null = null;
// Świece 1m od początku poprzedniej sesji UTC — co minutę dociągamy tylko końcówkę (cała doba to ok. 260 kB)
let minuteCache: VBar[] = [];

/** Tylko świece 1h zamknięte w chwili `asOf` (trwająca godzina zaniżałaby ekstrema i profil). */
export const completeHourly = (bars: VBar[], asOf: number): VBar[] => bars.filter((b) => b.time + HOUR <= asOf);

/** Pamięć świec 1h do odświeżenia: brak, starsza niż 30 min albo z poprzedniego dnia UTC (wczorajsza sesja niepełna). */
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

/** Wylicza kontekst aukcji ze świec 1m (bieżąca i poprzednia sesja) i 1h (statystyki). Czysta funkcja — testowalna. */
export function computeAuctionContext(minute: VBar[], hourly: VBar[], now: number): AuctionContext {
  const d0 = dayStart(now);
  const todayBars = minute.filter((b) => b.time >= d0 && b.time < now);
  const prevBars = minute.filter((b) => b.time >= d0 - DAY && b.time < d0);
  const vwap = sessionVwap(todayBars);
  const ibBars = todayBars.filter((b) => b.time < d0 + HOUR);
  const ib = ibBars.length ? { hi: Math.max(...ibBars.map((b) => b.high)), lo: Math.min(...ibBars.map((b) => b.low)), done: now >= d0 + HOUR } : null;
  const p = prevBars.length >= 1380 ? profile(prevBars) : null; // ≥ 23 h danych 1m — inaczej profil niepełny
  const t = prevBars.length >= 1380 ? extremeTouches(prevBars, 30 * MIN) : null;
  const prev = p && t ? { ...p, high: t.high, low: t.low, poorHigh: t.hiTouches >= 2, poorLow: t.loTouches >= 2 } : null;
  const sessions = sessionsFromHourly(hourly.filter((b) => b.time < d0));
  const last = sessions[sessions.length - 1];
  const ts = last && last.day === d0 - DAY && todayBars.length ? todayState(last, todayBars, now) : null;
  return {
    status: 'ready',
    asOf: now,
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
    const from = dayStart(now) - DAY;
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

/** Kontekst aukcji: świece 1m co minutę (od początku poprzedniej sesji, dociągana końcówka), 1h co 30 min; wspólny dla wszystkich widoków. */
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
