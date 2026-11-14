import { useEffect, useState } from 'react';
import { DAY } from '../charts/pro/core/time';
import { type Session, type SessionId, sessionAt, sessionOpens, utcDayStart, zonedToUtc } from '../charts/pro/core/sessions';

/**
 * Doba tradera (opis czasu, nie rynku): sesje BTC jak na wykresie (core/sessions: Azja od 00:00 UTC, Londyn od 08:00
 * czasu Londynu, Nowy Jork od 09:30 czasu Nowego Jorku) i fazy dnia widoków. Używają: pasek dnia w powłoce, szyna
 * (znak „teraz” przy fazie), tarcza i Start. Moduł bez widoków: jest w pierwszym pakiecie razem z powłoką.
 */

export type DayPhase = 'before' | 'charts' | 'after';

/** Godzina lokalna (0–24) chwili w strefie przeglądarki */
export const localHour = (ms: number): number => {
  const d = new Date(ms);
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
};

/** Sesje doby UTC zawierającej `t` */
export function daySessions(t: number): Session[] {
  const day = utcDayStart(t);
  const [asia, london, ny] = sessionOpens(day);
  return [
    { id: 'asia', start: asia, end: london },
    { id: 'london', start: london, end: ny },
    { id: 'ny', start: ny, end: day + DAY },
  ];
}

/** Bieżąca i następna sesja z czasem trwania i odliczaniem */
export function sessionClock(now: number): { current: Session; next: Session; elapsed: number; untilNext: number } {
  const current = sessionAt(now);
  const next = sessionAt(current.end);
  return { current, next, elapsed: now - current.start, untilNext: next.start - now };
}

/** 1 h 26 min · 42 min */
export function fmtSpan(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/**
 * Faza dnia tradera: Azja = przed sesją; Londyn i Nowy Jork = w sesji; po zamknięciu Wall Street (16:00 czasu NY) = po sesji.
 * Ten sam podział co widoki faz (Przed sesją, W sesji, Po sesji).
 */
export function dayPhase(now: number): { phase: DayPhase; session: SessionId } {
  const { current } = sessionClock(now);
  if (current.id === 'asia') return { phase: 'before', session: 'asia' };
  if (current.id === 'ny') {
    const d = new Date(now);
    if (now >= zonedToUtc('America/New_York', d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 16, 0)) return { phase: 'after', session: 'ny' };
  }
  return { phase: 'charts', session: current.id };
}

/** Początek doby lokalnej (północ w strefie przeglądarki) */
export function localDayStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Odcinek sesji na osi doby lokalnej: `from` i `to` jako ułamki doby 0–1 */
export interface DaySegment {
  id: SessionId;
  from: number;
  to: number;
}

/**
 * Sesje przycięte do doby lokalnej zawierającej `now` (00:00–24:00 czasu przeglądarki), od lewej. Sesja przechodząca
 * przez północ daje dwa odcinki (koniec dnia wczorajszego i początek dzisiejszego).
 */
export function localDaySegments(now: number): DaySegment[] {
  const s = localDayStart(now);
  const e = s + DAY;
  const out: DaySegment[] = [];
  for (const t of [s - DAY, s, s + DAY]) {
    for (const x of daySessions(t)) {
      const a = Math.max(x.start, s);
      const b = Math.min(x.end, e);
      if (b > a) out.push({ id: x.id, from: (a - s) / DAY, to: (b - s) / DAY });
    }
  }
  // Ten sam odcinek z dwóch dób UTC (granice równe) liczy się raz
  const uniq = out.filter((x, i) => out.findIndex((y) => y.id === x.id && Math.abs(y.from - x.from) < 1e-9) === i);
  return uniq.sort((x, y) => x.from - y.from);
}

/** Chwila „teraz” odświeżana co `ms` (wstrzymana w ukrytej karcie) */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => !document.hidden && setNow(Date.now()), ms);
    const onVis = () => !document.hidden && setNow(Date.now());
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [ms]);
  return now;
}
