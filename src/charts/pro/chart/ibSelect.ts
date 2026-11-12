import { IB_EXTENSIONS, type IndicatorBar, type InitialBalance } from '../core/indicators';
import { sessionAt } from '../core/sessions';

/**
 * Co rysuje warstwa zakresu początkowego sesji (initial balance) — czysta funkcja, wspólna dla nakładki i pomiaru
 * układu (`ui:check`):
 * - pełny rysunek (prostokąt pierwszej godziny, szczyt i dołek, etykiety) tylko dla bieżącej sesji; z poprzedniej same
 *   linie szczytu i dołka; starsze sesje — nic (dotąd każda sesja w widoku: prostokąt, dwie linie i cztery rozszerzenia),
 * - rozszerzenia 1,5× i 2× dopiero po pierwszym zamknięciu półgodziny poza zakresem i tylko po tej stronie, od chwili
 *   tego zamknięcia; liczą się tylko świece kończące kubełek 30 min (zakres to dwie półgodziny, sesje zaczynają się
 *   o pełnej godzinie albo o :30), więc wynik nie zależy od interwału wykresu; świeca w trakcie się nie liczy,
 * - sesja bieżąca i poprzednia od chwili ostatniej świecy, nie od przewinięcia; najwyżej 7 obiektów.
 */

export const IB_OBJECTS_MAX = 7;

const HALF_HOUR = 1_800_000;

/** Wynik sprawdzianu do opisu warstwy (PL i EN). */
export const IB_EVIDENCE = {
  pl: 'Szczyt i dołek pierwszej godziny pękają częściej niż losowy poziom obok (odrzucenie 40% wobec 47%, n 1 239).',
  en: 'The first-hour high and low break more often than a random nearby level (rejection 40% vs 47%, n 1,239).',
};

export interface IbDraw {
  ib: InitialBalance;
  /** Sesja bieżąca (pełny rysunek); false — poprzednia (same linie). */
  current: boolean;
  /** Pierwsze zamknięcie poza zakresem po pierwszej godzinie: strona i chwila zamknięcia (ms); null — jeszcze nie było. */
  breakout: { side: 1 | -1; t: number } | null;
}

/**
 * Zakresy do rysowania: bieżąca sesja (ta, w której jest ostatnia świeca) i poprzednia. `now` — chwila danych: świeca
 * zamknięta, gdy jej koniec ≤ `now`.
 */
export function selectIbs(ibs: readonly InitialBalance[], bars: readonly IndicatorBar[], intervalMs: number, now: number): IbDraw[] {
  if (bars.length === 0) return [];
  const cur = sessionAt(bars[bars.length - 1].t);
  const prev = sessionAt(cur.start - 1);
  const out: IbDraw[] = [];
  for (const ib of ibs) {
    if (ib.session.start === prev.start) out.push({ ib, current: false, breakout: null });
    else if (ib.session.start === cur.start) out.push({ ib, current: true, breakout: ibBreakout(ib, bars, intervalMs, now) });
  }
  return out;
}

/** Pierwsze zamknięcie świecy poza zakresem po pierwszej godzinie, do chwili `now` (także rycina lekcji). */
export function ibBreakout(ib: InitialBalance, bars: readonly IndicatorBar[], ms: number, now: number): IbDraw['breakout'] {
  for (const b of bars) {
    if (b.t < ib.end || b.t >= ib.session.end) continue;
    if (b.t + ms > now) break;
    // Tylko zamknięcia półgodzin: ten sam wynik na 5m, 15m i 30m
    if ((b.t + ms) % HALF_HOUR !== 0) continue;
    if (b.candle.c > ib.hi) return { side: 1, t: b.t + ms };
    if (b.candle.c < ib.lo) return { side: -1, t: b.t + ms };
  }
  return null;
}

/** Obiekty rysunku: bieżąca — prostokąt, szczyt, dołek i rozszerzenia po stronie wybicia; poprzednia — szczyt i dołek. */
export const ibObjects = (d: IbDraw): number => (d.current ? 3 + (d.breakout ? IB_EXTENSIONS.length : 0) : 2);
