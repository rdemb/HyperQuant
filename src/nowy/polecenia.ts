import type { ViewId } from '../state/types';

/** Działanie polecenia palety ⌘K (nawigacja, wykres rynku, strona statyczna, język interfejsu). */
export type Akcja =
  | { typ: 'widok'; id: ViewId }
  | { typ: 'rynek'; coin: string }
  | { typ: 'link'; href: string }
  | { typ: 'jezyk'; lang: 'pl' | 'en' };

export type Polecenie = { id: string; grupa: string; etykieta: string; slowa?: string; akcja: Akcja };

/** Tekst do porównania: małe litery, bez znaków diakrytycznych („Źródła” → „zrodla”, „ł” → „l”). */
export const doSzukania = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .toLowerCase();

/** Polecenia pasujące do zapytania: każde słowo zapytania w etykiecie, grupie albo słowach kluczowych; puste — wszystkie. */
export function filtruj(lista: readonly Polecenie[], zapytanie: string): Polecenie[] {
  const slowa = doSzukania(zapytanie).split(/\s+/).filter(Boolean);
  if (slowa.length === 0) return [...lista];
  return lista.filter((p) => {
    const tekst = doSzukania(`${p.etykieta} ${p.grupa} ${p.slowa ?? ''}`);
    return slowa.every((s) => tekst.includes(s));
  });
}
