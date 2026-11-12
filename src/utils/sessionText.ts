/**
 * Wspólne podpisy i drobne typy liczb sesji — dla nagłówka układu na wykresie i Rozliczenia sesji Po sesji. Bez modułów
 * wykresu (utils nie zależą od UI wykresu): brak liczby z powodem, nazwy typów dnia, migracji VA, metod oczekiwanego zakresu
 * i rodzajów map z bloga.
 */
import { tr } from '../i18n';
import { DASH, fmtFixed } from '../ui/format';
import type { DayType, VaMigration } from './dayType';
import type { MapKind } from './mapSettlement';

/** Tekst brakującej, jeszcze wczytywanej liczby (nagłówek, legenda, Rozliczenie). */
export const WAIT_TEXT = tr('Czekam na dane…', 'Waiting for data…');

/** Brak liczby z powodem (widok: „—” i powód w podpowiedzi). */
export interface Absent {
  why: string;
}
export type Got<T> = T | Absent;
export const isAbsent = (v: unknown): v is Absent => typeof v === 'object' && v !== null && 'why' in v;

/** Powód pierwszego brakującego wejścia liczby: w drodze (`undefined`) — „czekam na dane”, brak — jego powód. */
export function missingWhy(...vs: (Got<unknown> | undefined)[]): string {
  for (const v of vs) {
    if (v === undefined) return WAIT_TEXT;
    if (isAbsent(v)) return v.why;
  }
  return WAIT_TEXT;
}

/** Oczekiwany (średni) zakres sesji w USD (MODEL „profil × poziom”), typowy dzień (ok. mediana) i metoda. */
export type Expected = { usd: number; typical: number; method: 'profile' };

/** Nazwa metody oczekiwanego zakresu w podpowiedzi MODEL. */
export const METHOD: Record<Expected['method'], string> = { profile: tr('profil × poziom', 'profile × level') };
export const METHOD_NOTE: Record<Expected['method'], string> = {
  profile: tr(
    'Oczekiwany (średni) zakres ze świec 1h: profil godzin sesji z 20 dni tego samego typu razy poziom zmienności z 24 h przed otwarciem, liczony raz na otwarcie sesji; w połowie dni zakres jest poniżej ok. 0,87 tej wartości.',
    'Expected (mean) range from 1h candles: the hourly profile of the session from 20 days of the same type times the volatility level of the 24 h before the open, computed once at the session open; on half of the days the range is below about 0.87 of this value.'
  ),
};

export const DAY_TYPE_LABEL: Record<DayType, string> = {
  normal: tr('normalny', 'normal'),
  'normal-variation': tr('wariant normalny', 'normal variation'),
  trend: tr('trendowy', 'trend'),
  neutral: tr('neutralny', 'neutral'),
  unknown: DASH,
};

export const VA_MIGRATION_LABEL: Record<VaMigration, string> = {
  higher: tr('wyżej', 'higher'),
  lower: tr('niżej', 'lower'),
  'overlap-higher': tr('częściowo wyżej', 'overlap, higher'),
  'overlap-lower': tr('częściowo niżej', 'overlap, lower'),
  inside: tr('wewnątrz', 'inside'),
  outside: tr('szersza', 'wider'),
  unknown: DASH,
};

const MAP_KIND_NAME: Record<MapKind, string> = {
  dzien: tr('Mapa dnia', 'Day map'),
  ny: tr('Mapa przed NY', 'Pre-NY map'),
  otwarcie: tr('Otwarcie sesji', 'Session open'),
  aktualizacja: tr('Aktualizacja', 'Update'),
  inne: tr('Mapa z bloga', 'Blog map'),
};

/** Nazwa rodzaju mapy z bloga (etykieta na wykresie, lista map w ustawieniach, nagłówek i Rozliczenie). */
export const blogMapName = (kind: MapKind): string => MAP_KIND_NAME[kind];

/**
 * Dotknięte poziomy mapy z bloga „X/Y” i uwaga przy luce w świecach 1m (`note` obok liczby, `gap` do podpowiedzi) —
 * jedno źródło dla nagłówka Rozliczenia i Czwórki. Przy luce dotknięcia zostają, a reszta poziomów jest nierozliczona.
 */
export function mapHitsText(touched: number, total: number, complete: boolean): { value: string; note: string | null; gap: string | null } {
  return {
    value: `${touched}/${total}`,
    note: complete ? null : tr('luka', 'gap'),
    gap: complete ? null : tr('reszta nierozliczona: luka w świecach 1m (brak ✓ nie znaczy „nie dotknięto”)', 'the rest is unsettled: a gap in the 1m candles (no ✓ does not mean “not touched”)'),
  };
}

/** Ułamek jako procent bez miejsc po przecinku. */
export const pctOf = (b: number) => `${fmtFixed(b * 100, 0)}%`;
/** Kwota albo odległość ceny (zakres, σ): bez groszy od 100, mniejsze z dokładnością pasującą do ceny rynku. */
export const amt = (v: number) => fmtFixed(v, Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 1 ? 2 : 4);
