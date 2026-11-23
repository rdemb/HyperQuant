import { useSyncExternalStore } from 'react';

/**
 * Motyw płótna wykresów (Zorza: „Głębia” na grafitowym tle, Opal: „Papier” na jasnym). Moduły rysujące trzymają
 * gotowe kolory (napisy z kryciem, rampy), liczone raz przy wczytaniu; rejestrują tu przeliczenie, które biegnie przy
 * każdej zmianie motywu, w kolejności wczytania modułów (najpierw paleta bazowa, potem zależne). Wykresy po zmianie
 * montują się od nowa (`usePaletaWykresu` w kluczu), więc serie i opcje lightweight-charts biorą nowe kolory.
 */
export type MotywWykresu = 'dark' | 'light';

let motyw: MotywWykresu = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
const przeliczenia: (() => void)[] = [];
const sluchacze = new Set<() => void>();

export const motywWykresu = (): MotywWykresu => motyw;

/** Przeliczenie gotowych kolorów modułu przy zmianie motywu (wartości startowe moduł liczy sam przy wczytaniu). */
export function naZmianePalety(fn: () => void): void {
  przeliczenia.push(fn);
}

export function ustawMotywWykresu(t: MotywWykresu): void {
  if (t === motyw) return;
  motyw = t;
  for (const f of przeliczenia) f();
  sluchacze.forEach((f) => f());
}

/** Bieżący motyw płótna (do klucza wykresu: zmiana montuje wykres od nowa z nowymi kolorami). */
export function usePaletaWykresu(): MotywWykresu {
  return useSyncExternalStore(
    (f) => {
      sluchacze.add(f);
      return () => sluchacze.delete(f);
    },
    () => motyw,
    () => 'dark'
  );
}
