import type { DeskMarket } from '../config/deskMarkets.ts';
import { NYSE_CALENDAR, type NyseCalendar, nyClock, wallStreetAt } from './wallStreet.ts';

/**
 * Stan rynku bazowego rynku desku (projekt 60, Q1). Rynki HIP-3 trade.xyz (złoto, S&P 500) mają wyrocznię z rynku bazowego
 * od niedzieli 18:00 do piątku 17:00 czasu Nowego Jorku, z przerwą 17:00–18:00 od poniedziałku do czwartku; poza tym
 * cenę wyznacza sama platforma (arkusz). S&P 500 ma dodatkowo sesję regularną NYSE (9:30–16:00 ET) z kalendarzem świąt
 * z repozytorium; w dzień wolny NYSE stan „holiday”. Święta CME i ICE nie są jeszcze zweryfikowane u źródła, więc dla
 * złota nie ma stanu „holiday” (zamiast zgadywania — notka). Czysta logika: czas w argumencie, strefa Nowego Jorku z Intl.
 */
export type UnderlyingState = 'always' | 'open' | 'break' | 'closed' | 'holiday';

export interface Underlying {
  state: UnderlyingState;
  /** Sesja regularna NYSE trwa (tylko S&P 500); null dla rynków bez sesji regularnej. */
  rth: boolean | null;
  /** Najbliższa zmiana stanu (ms); null dla rynków całodobowych albo poza zasięgiem wyszukiwania. */
  next: number | null;
  /** Najbliższa zmiana sesji regularnej (ms, tylko S&P 500). */
  rthNext: number | null;
}

const OPEN_MIN = 18 * 60;
const CLOSE_MIN = 17 * 60;

/** Stan platformowego harmonogramu HIP-3 (bez świąt) w chwili `ms`. */
function weekly(ms: number): 'open' | 'break' | 'closed' {
  const { minute, weekday } = nyClock(ms);
  if (weekday === 6) return 'closed';
  if (weekday === 0) return minute >= OPEN_MIN ? 'open' : 'closed';
  if (weekday === 5) return minute < CLOSE_MIN ? 'open' : 'closed';
  return minute >= CLOSE_MIN && minute < OPEN_MIN ? 'break' : 'open';
}

function stateAt(m: Pick<DeskMarket, 'underlying'>, ms: number, cal: NyseCalendar | null): UnderlyingState {
  if (m.underlying.calendar === 'crypto') return 'always';
  if (m.underlying.calendar === 'nyse+cme') {
    const ws = wallStreetAt(ms, cal);
    if (ws.state === 'closed' && ws.why === 'holiday') return 'holiday';
  }
  return weekly(ms);
}

const rthAt = (ms: number, cal: NyseCalendar | null): boolean => wallStreetAt(ms, cal).state === 'open';

/** Pierwsza chwila po `from`, w której `f` zmienia wartość (krok 5 min, potem dokładnie do minuty), do 8 dób. */
function nextChange<T>(from: number, f: (t: number) => T): number | null {
  const start = Math.floor(from / 60_000) * 60_000;
  const v0 = f(start);
  const STEP = 5 * 60_000;
  for (let t = start + STEP; t <= start + 8 * 86_400_000; t += STEP) {
    if (f(t) === v0) continue;
    for (let u = t - STEP + 60_000; u <= t; u += 60_000) if (f(u) !== v0) return u;
    return t;
  }
  return null;
}

export function underlyingAt(m: Pick<DeskMarket, 'underlying'>, ms: number, cal: NyseCalendar | null = NYSE_CALENDAR): Underlying {
  const state = stateAt(m, ms, cal);
  if (state === 'always') return { state, rth: null, next: null, rthNext: null };
  const rth = m.underlying.rth ? rthAt(ms, cal) : null;
  return {
    state,
    rth,
    next: nextChange(ms, (t) => stateAt(m, t, cal)),
    rthNext: m.underlying.rth ? nextChange(ms, (t) => rthAt(t, cal)) : null,
  };
}

/** Cena ustalana przez platformę (rynek bazowy nie notuje): wykres i liczby mają to pokazać. */
export const platformPriced = (u: Underlying): boolean => u.state === 'closed' || u.state === 'break' || u.state === 'holiday';
