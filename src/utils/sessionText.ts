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

/** Oczekiwany zakres sesji (MODEL) i metoda. */
export type Expected = { usd: number; method: 'har' | 'parkinson' };

/** Nazwa metody oczekiwanego zakresu w podpowiedzi MODEL. */
export const METHOD: Record<Expected['method'], string> = { har: 'HAR', parkinson: 'Parkinson' };
export const METHOD_NOTE: Record<Expected['method'], string> = {
  har: tr(
    'Oczekiwany zakres E[H−L] = √(8/π)·σ sesji z modelu zmienności HAR (BTC, liczony w przeglądarce, z profilem godzin).',
    'Expected range E[H−L] = √(8/π)·session σ from the HAR volatility model (BTC, computed in the browser, with the hourly profile).'
  ),
  parkinson: tr(
    'Bez modelu HAR: σ Parkinsona z ostatnich zamkniętych świec 5m tego rynku przeskalowana do długości sesji, E[H−L] = √(8/π)·σ.',
    'Without the HAR model: Parkinson σ from the latest closed 5m candles of this market scaled to the session length, E[H−L] = √(8/π)·σ.'
  ),
};
/** Zamknięta sesja: oczekiwanie sprzed jej otwarcia (Parkinson ze świec 5m doby przed otwarciem). */
export const EX_ANTE_NOTE = tr(
  'Zamknięta sesja: σ Parkinsona ze świec 5m z doby przed otwarciem sesji (oczekiwanie sprzed sesji), E[H−L] = √(8/π)·σ.',
  'Closed session: Parkinson σ from 5m candles of the day before the session open (the expectation before the session), E[H−L] = √(8/π)·σ.'
);

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

/** Ułamek jako procent bez miejsc po przecinku. */
export const pctOf = (b: number) => `${fmtFixed(b * 100, 0)}%`;
/** Kwota albo odległość ceny (zakres, σ): bez groszy od 100, mniejsze z dokładnością pasującą do ceny rynku. */
export const amt = (v: number) => fmtFixed(v, Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 1 ? 2 : 4);
