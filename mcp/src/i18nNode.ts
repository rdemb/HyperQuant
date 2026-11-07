/**
 * Język tekstów w procesie serwera MCP: podmienia `src/i18n.ts` w bundlu (wtyczka w `mcp/vite.config.ts`), to samo API.
 * Bez przeglądarki: język z `HQ_LANG` (`pl`, `pl-PL`, `en`…), domyślnie angielski — klient MCP i model czytają po angielsku.
 * Język stały przez cały proces, jak na stronie (stałe moduły liczą teksty raz, przy imporcie).
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

const fromEnv = typeof process === 'undefined' ? undefined : process.env.HQ_LANG;

export const lang: Lang = detectLang(null, fromEnv ? [fromEnv] : []);

/** Locale dla Intl (daty, godziny, liczby). en-GB: zegar 24 h i dzień przed miesiącem. */
export const locale = lang === 'en' ? 'en-GB' : 'pl-PL';

export function tr<T>(pl: T, en: T): T {
  return lang === 'en' ? en : pl;
}

/** Zmiana języka w działającym procesie nie ma sensu (teksty stałe policzone przy imporcie): ustaw `HQ_LANG` i uruchom ponownie. */
export function setLang(next: Lang): void {
  if (next === lang) return;
  console.error(`hyperquant-mcp: HQ_LANG=${next} działa po ponownym uruchomieniu serwera`);
}
