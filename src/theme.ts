import { useSyncExternalStore } from 'react';

/**
 * Motyw strony: ciemny („Chronograf”, grafit) albo jasny („papier”). Wybór w localStorage (hq.theme); bez wyboru —
 * ustawienie systemu. Pierwszy motyw ustawia skrypt w index.html przed malowaniem (bez błysku), tu tylko zmiana.
 * Karta wykresu ma zawsze własny ciemny zasięg (data-theme="dark"), więc paleta „Głębia” się nie zmienia.
 */
export type Theme = 'dark' | 'light';

const KEY = 'hq.theme';
/** Kolor paska przeglądarki i ekranu startowego PWA: tło strony motywu */
const BAR: Record<Theme, string> = { dark: '#0C0D0F', light: '#F1EFE9' };
const listeners = new Set<() => void>();

export function currentTheme(): Theme {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function setTheme(t: Theme): void {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[t]);
  try {
    window.localStorage.setItem(KEY, t);
  } catch {
    // Brak dostępu do storage (tryb prywatny): motyw tylko do zamknięcia karty
  }
  for (const f of listeners) f();
}

function subscribe(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, currentTheme, () => 'dark');
}
