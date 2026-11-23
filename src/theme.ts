import { useSyncExternalStore } from 'react';
import { ustawMotywWykresu } from './charts/paleta';

/**
 * Motyw strony: ciemny („Chronograf”, grafit) albo jasny („papier”). Wybór w localStorage (hq.theme); bez wyboru —
 * ustawienie systemu. Pierwszy motyw ustawia skrypt w index.html przed malowaniem (bez błysku), tu tylko zmiana.
 * Karta wykresu ma zawsze własny ciemny zasięg (data-theme="dark"), więc paleta „Głębia” się nie zmienia.
 */
export type Theme = 'dark' | 'light';

const KEY = 'hq.theme';
/** Kolor paska przeglądarki i ekranu startowego PWA: tło strony motywu */
const BAR: Record<Theme, string> = { dark: '#0B0A12', light: '#F2F1F6' };
const listeners = new Set<() => void>();

export function currentTheme(): Theme {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

// Ostatnie wskazanie: z tego miejsca nowy motyw rozlewa się kołem (View Transitions, jeśli przeglądarka je ma)
let wskazanie: { x: number; y: number; at: number } | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => { wskazanie = { x: e.clientX, y: e.clientY, at: Date.now() }; }, { capture: true, passive: true });
}

type DocVT = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void>; ready?: Promise<void>; skipTransition?: () => void } };

export function setTheme(t: Theme): void {
  const doc = typeof document !== 'undefined' ? (document as DocVT) : null;
  const ograniczony =
    !doc ||
    doc.documentElement.dataset.motion === 'reduced' ||
    (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (!doc || !doc.startViewTransition || ograniczony || currentTheme() === t) {
    zastosujMotyw(t);
    return;
  }
  const el = doc.activeElement as HTMLElement | null;
  const r = el && el !== doc.body ? el.getBoundingClientRect() : null;
  const p = wskazanie && Date.now() - wskazanie.at < 1500 ? wskazanie : r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: window.innerWidth - 40, y: 28 };
  wskazanie = null;
  const root = doc.documentElement;
  root.style.setProperty('--vt-x', `${Math.round(p.x)}px`);
  root.style.setProperty('--vt-y', `${Math.round(p.y)}px`);
  root.classList.add('vt-motyw');
  try {
    const przejscie = doc.startViewTransition(() => zastosujMotyw(t));
    // Pominięte przejście odrzuca `ready` (AbortError): motyw i tak jest już zmieniony
    przejscie.ready?.catch(() => undefined);
    // Zatrzymany zegar animacji (karta w tle, słaby sprzęt) nie może zostawić strony pod warstwą przejścia: koniec po 1,2 s
    const straz = window.setTimeout(() => {
      try {
        przejscie.skipTransition?.();
      } catch {
        // przejście już skończone
      }
    }, 1200);
    void przejscie.finished.catch(() => undefined).finally(() => {
      window.clearTimeout(straz);
      root.classList.remove('vt-motyw');
    });
  } catch {
    root.classList.remove('vt-motyw');
    zastosujMotyw(t);
  }
}

function zastosujMotyw(t: Theme): void {
  document.documentElement.dataset.theme = t;
  // Płótno wykresów idzie za motywem (paleta Głębia albo Papier; wykresy montują się od nowa)
  ustawMotywWykresu(t === 'light' ? 'light' : 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[t]);
  try {
    window.localStorage.setItem(KEY, t);
    window.localStorage.setItem('hqp.theme', t === 'light' ? 'paper' : 'deep');
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
