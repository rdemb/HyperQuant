/**
 * Język interfejsu (PL/EN). Wybór zapisany w przeglądarce ma pierwszeństwo, inaczej decyduje
 * pierwszy polski lub angielski język z ustawień przeglądarki (każdy inny → EN).
 * Język jest stały przez cały czas życia strony: zmiana zapisuje wybór i przeładowuje stronę,
 * dzięki czemu teksty w stałych modułach i na canvasie nie wymagają subskrypcji.
 */
export type Lang = 'pl' | 'en';

export const LANG_KEY = 'hq.lang';

export function detectLang(saved: string | null, languages: readonly string[]): Lang {
  if (saved === 'pl' || saved === 'en') return saved;
  for (const l of languages) {
    const code = l.toLowerCase();
    if (code.startsWith('pl')) return 'pl';
    if (code.startsWith('en')) return 'en';
  }
  return 'en';
}

function initialLang(): Lang {
  // Poza przeglądarką (testy, skrypty) zostaje polski — teksty źródłowe
  if (typeof document === 'undefined') return 'pl';
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(LANG_KEY);
  } catch {
    // Zablokowany localStorage: tylko język przeglądarki
  }
  return detectLang(saved, navigator.languages?.length ? navigator.languages : [navigator.language]);
}

export const lang: Lang = initialLang();

/** Locale dla Intl (daty, godziny, liczby). en-GB: zegar 24 h i dzień przed miesiącem. */
export const locale = lang === 'en' ? 'en-GB' : 'pl-PL';

/** Tekst w bieżącym języku; działa też dla fragmentów JSX. */
export function tr<T>(pl: T, en: T): T {
  return lang === 'en' ? en : pl;
}

export function setLang(next: Lang): void {
  if (next === lang) return;
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {
    // Zablokowany zapis: po przeładowaniu zostaje język przeglądarki
    return;
  }
  window.location.reload();
}
