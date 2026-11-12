import type { DayLevels } from '../core/indicators';
import { type Session, sessionsBetween, utcDayStart } from '../core/sessions';
import { DAY } from '../core/time';

/**
 * Co rysują poziomy dnia i linie sesji — czyste funkcje, wspólne dla nakładki i pomiaru układu (`ui:check`):
 * - poziomy dnia (PDH, PDL, otwarcie dnia) tylko dla bieżącego i poprzedniego dnia UTC, na interwałach od 4h tylko dla
 *   bieżącego; etykiety tylko bieżącego (dotąd każdy dzień w widoku: na 4h ok. 39 linii),
 * - linie otwarć sesji tylko dla bieżącej i poprzedniej doby UTC, podpis przy trzech ostatnich (dotąd każda sesja w
 *   widoku, ok. 9 na 30m),
 * - bieżący dzień i sesje od chwili ostatniej świecy, nie od przewinięcia; bez danych z przyszłości.
 */

/** Linie poziomów na dzień: PDH, PDL i otwarcie dnia. */
export const LEVEL_LINES = 3;
/** Od tego interwału poziomy tylko bieżącego dnia. */
const LONG_MS = 4 * 3_600_000;
export const SESSION_LINES_MAX = 6;
export const SESSION_LABELS = 3;

/** Wynik sprawdzianu do opisu warstwy (PL i EN). */
export const LEVELS_EVIDENCE = {
  pl: 'Po dotknięciu PDH albo PDL cena częściej idzie dalej, niż zawraca (odrzucenie 27–33% wobec 45% dla losowego poziomu, 2026 r.).',
  en: 'After touching PDH or PDL the price more often carries on than turns back (rejection 27–33% vs 45% for a random level, 2026).',
};

/** Dni z poziomami do rysowania w chwili `lastT` (początek ostatniej świecy): bieżący (z etykietami) i — poniżej 4h — poprzedni. */
export function selectDays(days: readonly DayLevels[], lastT: number, intervalMs: number): { day: DayLevels; current: boolean }[] {
  const today = utcDayStart(lastT);
  const from = intervalMs >= LONG_MS ? today : today - DAY;
  return days.filter((d) => d.t >= from && d.t <= today).map((day) => ({ day, current: day.t === today }));
}

/** Otwarcia sesji bieżącej i poprzedniej doby UTC, które już nastąpiły w chwili `lastT`; podpis przy trzech ostatnich. */
export function selectSessions(lastT: number): { session: Session; label: boolean }[] {
  const list = sessionsBetween(utcDayStart(lastT) - DAY, lastT + 1).filter((s) => s.start <= lastT);
  return list.map((session, i) => ({ session, label: i >= list.length - SESSION_LABELS }));
}
