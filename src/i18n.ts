/**
 * Język interfejsu (PL/EN). Jawny język adresu obowiązuje dla tej strony.
 * Bez niego używamy zapisanego wyboru, a na pierwszej wizycie angielskiego.
 * Język jest stały przez cały czas życia strony: zmiana zapisuje wybór i przeładowuje stronę,
 * dzięki czemu teksty w stałych modułach i na canvasie nie wymagają subskrypcji.
 */
export type Lang = 'pl' | 'en';

export const LANG_KEY = 'hq.lang';

export function detectLang(saved: string | null, requested: string | null = null): Lang {
  if (requested === 'pl' || requested === 'en') return requested;
  return saved === 'pl' ? 'pl' : 'en';
}

function initialLang(): Lang {
  // Poza przeglądarką (testy, skrypty) zostaje polski — teksty źródłowe
  if (typeof window === 'undefined') return 'pl';
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(LANG_KEY);
  } catch {
    // Przy zablokowanej pamięci nadal działa jawny język adresu.
  }
  return detectLang(saved, new URLSearchParams(window.location.search).get('lang'));
}

export const lang: Lang = initialLang();

/** Locale dla Intl (daty, godziny, liczby). en-GB: zegar 24 h i dzień przed miesiącem. */
export const locale = lang === 'en' ? 'en-GB' : 'pl-PL';

/** Tekst w bieżącym języku; działa też dla fragmentów JSX. */
export function tr<T>(pl: T, en: T): T {
  return lang === 'en' ? en : pl;
}

export function setLang(next: Lang): void {
  try {
    window.localStorage.setItem(LANG_KEY, next);
  } catch {
    return;
  }
  const url = new URL(window.location.href);
  if (url.searchParams.has('lang')) {
    url.searchParams.delete('lang');
    window.location.replace(url.href);
  } else if (next !== lang) {
    window.location.reload();
  }
}
