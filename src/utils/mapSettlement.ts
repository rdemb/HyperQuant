/**
 * Rozliczenie poziomów z map bloga: który poziom cena dotknęła w oknie ważności mapy i o której minucie.
 * Czysta logika bez DOM i Node (wspólna dla aplikacji i skryptów bloga). Dotknięcie = low ≤ cena poziomu ≤ high świecy 1m.
 */
import type { VBar } from './auction';
import { currentTradeSession, nextTradeSession, tradeSessionOn } from './sessionDay';
import { utcDayStart } from '../charts/pro/core/sessions';

export type MapKind = 'dzien' | 'ny' | 'otwarcie' | 'aktualizacja' | 'inne';

/** Identyfikator wpisu z mapą jak w skrypcie bloga (scripts/blog/posts.mjs): data i słowa z małych liter i cyfr. */
export const MAP_ID = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAP_ID_MAX = 120;
export const isMapId = (v: unknown): v is string => typeof v === 'string' && v.length <= MAP_ID_MAX && MAP_ID.test(v);

export type SettledLevel = { label: string; price: number; touchedAt: number | null };

/**
 * Okno ważności mapy [from, to): od publikacji do końca sesji handlowej, w której mapę opublikowano (Londyn albo NY wg
 * `sessionDay`). „Mapa dnia” (`dzien`) i „Mapa przed Nowym Jorkiem” (`ny`) obejmują sesję NY, którą zapowiadają: trwają do
 * końca sesji NY doby UTC publikacji (opublikowane w Azji, Londynie albo w NY). Pozostałe rodzaje (`aktualizacja`,
 * `otwarcie`) kończą się z sesją w toku, a opublikowane w Azji obejmują najbliższą sesję Londynu. Rodzaj `inne` (mapy weekendu i tygodnia)
 * nie jest mapą sesji: okna nie ma (null), poziomy można rysować, ale nie rozlicza się ich.
 */
export function mapWindow(kind: MapKind, publishedAt: number): { from: number; to: number } | null {
  if (kind === 'inne') return null;
  if (kind === 'dzien' || kind === 'ny') return { from: publishedAt, to: tradeSessionOn(utcDayStart(publishedAt), 'ny').end };
  const session = currentTradeSession(publishedAt) ?? nextTradeSession(publishedAt);
  return { from: publishedAt, to: session.end };
}

/**
 * Dla każdego poziomu minuta (początek świecy 1m) pierwszego dotknięcia w oknie [from, to) albo null. Świece
 * nieprawidłowe (NaN) są pomijane, kolejność świec nie ma znaczenia.
 */
export function settleLevels(levels: readonly { label: string; price: number }[], bars1m: readonly VBar[], from: number, to: number): SettledLevel[] {
  const inWindow = bars1m
    .filter((b) => b.time >= from && b.time < to && Number.isFinite(b.low) && Number.isFinite(b.high))
    .sort((a, b) => a.time - b.time);
  return levels.map((l) => {
    const hit = inWindow.find((b) => b.low <= l.price && l.price <= b.high);
    return { label: l.label, price: l.price, touchedAt: hit ? hit.time : null };
  });
}

const MIN = 60_000;

/**
 * Czy świece 1m (rosnąco) pokrywają bez przerwy minuty od `start` do `last` włącznie (początki świec). Brak minuty
 * w środku albo świece kończące się przed `last` — luka; pusty przedział (`last` < `start`) jest pokryty.
 */
export function minutesCovered(bars: readonly { time: number }[], start: number, last: number): boolean {
  let want = start;
  for (const b of bars) {
    if (want > last || b.time > last) break;
    if (b.time < want) continue;
    if (b.time !== want) return false;
    want += MIN;
  }
  return want > last;
}

/** Rozliczenie poziomów w okresie: minuty dotknięcia i czy świece objęły cały okres (bez tego brak dotknięcia nic nie znaczy). */
export interface RangeSettlement {
  levels: SettledLevel[];
  complete: boolean;
}

/**
 * Rozliczenie poziomów w okresie [from, to) w chwili `now` na świecach 1m (rosnąco) — jedna uczciwa reguła dla warstwy mapy
 * na wykresie i Rozliczenia doby. Pierwsza potrzebna świeca to pełna minuta od `from` (świeca, w której wpis wyszedł,
 * zaczęła się przed nim i się nie liczy); świece po `now` (powtórka) się nie liczą. Wymagane są świece każdej pełnej minuty
 * do min(now, to) — bieżąca, niepełna nie. Przy luce dotknięcia znalezione zostają, a `complete: false` mówi, że reszta
 * poziomów jest nierozliczona (brak dotknięcia nie znaczy wtedy „nie dotknięto”). Świece niesięgające początku — null.
 */
export function settleRange(levels: readonly { label: string; price: number }[], bars1m: readonly VBar[], from: number, to: number, now: number): RangeSettlement | null {
  const start = Math.ceil(from / MIN) * MIN;
  if (bars1m.length === 0 || bars1m[0].time > start) return null;
  const end = Math.min(now, to);
  const upToNow = bars1m.filter((b) => b.time <= now);
  return { levels: settleLevels(levels, upToNow, from, to), complete: minutesCovered(bars1m, start, Math.floor(end / MIN) * MIN - MIN) };
}
