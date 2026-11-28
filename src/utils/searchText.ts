/** Tekst do porównania: małe litery, bez znaków diakrytycznych („Źródła” → „zrodla”, „ł” → „l”). */
export const doSzukania = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .toLowerCase();
