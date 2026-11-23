import { useSyncExternalStore } from 'react';

/**
 * Stan szyny bocznej na tym urządzeniu (widoczna albo schowana), wspólny dla szyny i przycisku w nagłówku. Zapis
 * w localStorage; zablokowana pamięć nie psuje przełącznika (stan zostaje w karcie).
 */
export const SZYNA_KLUCZ = 'hq.szyna';

const czytaj = (): boolean => {
  try {
    return localStorage.getItem(SZYNA_KLUCZ) === 'ukryta';
  } catch {
    return false;
  }
};

let ukryta = typeof localStorage === 'undefined' ? false : czytaj();
const sluchacze = new Set<() => void>();

export function ustawSzyne(v: boolean) {
  if (v === ukryta) return;
  ukryta = v;
  try {
    localStorage.setItem(SZYNA_KLUCZ, v ? 'ukryta' : 'widoczna');
  } catch {
    /* pamięć zablokowana */
  }
  sluchacze.forEach((f) => f());
  // Wykresy mierzą kontener przy zmianie rozmiaru okna; szyna zmienia szerokość obszaru roboczego
  if (typeof window !== 'undefined') requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

export const przelaczSzyne = () => ustawSzyne(!ukryta);

export function useSzynaUkryta(): boolean {
  return useSyncExternalStore(
    (f) => {
      sluchacze.add(f);
      return () => sluchacze.delete(f);
    },
    () => ukryta,
    () => false
  );
}
