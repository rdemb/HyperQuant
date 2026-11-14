/**
 * Uczciwość liczb w pustym stanie: widok bez danych pokazuje „—” z powodem, nie wartości. Czysta funkcja dla testu
 * wszystkich widoków nowego wyglądu w `ui:check` (przebieg „Pusty stan”, bez API giełdy i danych skanera).
 *
 * Dozwolone są etykiety z liczbami (np. „Obrót 24 h”, „Paliwo ±1%”, „IB 60 min”, „7 dni”, „01”): krótkie liczby całkowite
 * przy jednostce czasu albo numer kroku. Niedozwolone: liczba dziesiętna, liczba od 100 (także z odstępem tysięcy),
 * procent poza etykietą, znane stałe makiety i NaN / Infinity.
 */
const ETYKIETY = [
  /±\s?\d+(?:[.,]\d+)?\s?%/g, // zakres w nazwie miary, np. „Paliwo ±1%”
  /\b\d{1,2}\s?(?:h|min|s|d|dni|dzień|godz\.?|godzin[ay]?|tyg\.?|m)\b/g, // okna czasu w etykietach
  /\b\d{1,2}(?::\d{2})?\s?(?:UTC|CET|CEST|ET)\b/g, // godziny sesji w nazwach
  /\b(?:0?[1-9])\b(?=\s*[·./)]|\s*$)/g, // numer kroku („01”, „2.”)
];

/** Znane stałe makiety (designHQ), które nie mogą trafić do aplikacji jako wartości. */
export const STALE_MAKIETY = ['78/100', '22,6', '19,4', '0,68', '0,74', '0,142', '8,1 mln', '1,28', '64%', '41,8', '64,2', '0,86', '0,42'];

/** Fragmenty tekstu, które wyglądają na wartość liczbową (lista do komunikatu testu); pusta = w porządku. */
export function liczbyPozaEtykietami(tekst) {
  const out = [];
  for (const s of STALE_MAKIETY) if (tekst.includes(s)) out.push(s);
  if (/\b(?:NaN|Infinity)\b/.test(tekst)) out.push('NaN/Infinity');
  let t = tekst;
  for (const re of ETYKIETY) t = t.replace(re, ' ');
  for (const m of t.matchAll(/[−+-]?\d[\d   ]*(?:[.,]\d+)?\s?%?/g)) {
    const v = m[0].trim();
    const goly = v.replace(/[   ]/g, '');
    const dziesietna = /[.,]\d/.test(goly);
    const duza = /\d{3,}/.test(goly.replace(/[^\d]/g, ''));
    const procent = goly.endsWith('%');
    if (dziesietna || duza || procent) out.push(v);
  }
  return [...new Set(out)];
}

/** Klucze rejestru NOWE_WIDOKI z treści src/nowy/widoki.ts (widoki w nowym wyglądzie). */
export function noweWidoki(zrodlo) {
  const blok = zrodlo.match(/NOWE_WIDOKI[^=]*=\s*\{([\s\S]*?)\};/)?.[1] ?? '';
  return [...blok.matchAll(/^\s*([a-z]+)\s*:/gm)].map((m) => m[1]);
}
