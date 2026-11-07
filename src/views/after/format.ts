// Pomocniki formatowania i pól liczbowych (dawniej plan/hooks.ts)
import { useState } from 'react';

/** Pole liczbowe zapamiętane w localStorage (np. kapitał) — bez storage działa tylko w tej sesji. */
export function useStoredString(key: string, fallback: string): [string, (v: string) => void] {
  const [v, setV] = useState<string>(() => {
    try {
      return window.localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  });
  const set = (next: string) => {
    setV(next);
    try {
      window.localStorage.setItem(key, next);
    } catch {
      // tryb prywatny / zablokowany storage — wartość tylko w tej sesji
    }
  };
  return [v, set];
}

/** Liczba z pola tekstowego: akceptuje przecinek dziesiętny i spacje tysięcy; pusta/niepoprawna → NaN. */
export function parseNum(s: string): number {
  const t = s.replace(/[\s $]/g, '').replace(',', '.');
  if (t === '') return Number.NaN;
  const v = Number(t);
  return Number.isFinite(v) ? v : Number.NaN;
}

export function fmtMinutes(m: number): string {
  if (!Number.isFinite(m)) return '—';
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}
