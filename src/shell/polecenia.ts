import type { ViewId } from '../state/types';

/** Działanie polecenia palety ⌘K (nawigacja, wykres rynku, strona statyczna, język interfejsu). */
export type Akcja =
  | { typ: 'widok'; id: ViewId }
  | { typ: 'rynek'; coin: string }
  | { typ: 'link'; href: string }
  | { typ: 'jezyk'; lang: 'pl' | 'en' }
  | { typ: 'przelacznik'; co: 'strumien' | 'synchronizuj' | 'dzwiek' };

export type Polecenie = { id: string; grupa: string; etykieta: string; slowa?: string; akcja: Akcja };

import { doSzukania } from '../utils/searchText';

export { doSzukania };

/** Polecenia pasujące do zapytania: każde słowo zapytania w etykiecie, grupie albo słowach kluczowych; puste — wszystkie. */
export function filtruj(lista: readonly Polecenie[], zapytanie: string): Polecenie[] {
  const slowa = doSzukania(zapytanie).split(/\s+/).filter(Boolean);
  if (slowa.length === 0) return [...lista];
  return lista.filter((p) => {
    const tekst = doSzukania(`${p.etykieta} ${p.grupa} ${p.slowa ?? ''}`);
    return slowa.every((s) => tekst.includes(s));
  });
}

/** Najwięcej rynków spoza głównych w wynikach (uniwersum Hyperliquid ma kilkaset rynków). */
export const INNE_RYNKI_MAX = 8;

/**
 * Wyniki z rynkami spoza głównych: tylko przy niepustym zapytaniu, najwyżej INNE_RYNKI_MAX trafień, zaraz za głównymi
 * rynkami (identyfikator `m-…`; bez nich — za widokami `v-…`, bez widoków — na początku).
 */
export function zInnymiRynkami(wyniki: readonly Polecenie[], inne: readonly Polecenie[], zapytanie: string): Polecenie[] {
  if (doSzukania(zapytanie).trim() === '') return [...wyniki];
  const extra = filtruj(inne, zapytanie).slice(0, INNE_RYNKI_MAX);
  if (extra.length === 0) return [...wyniki];
  const after = (prefix: string) => wyniki.reduce((k, p, i) => (p.id.startsWith(prefix) ? i + 1 : k), -1);
  const at = after('m-') >= 0 ? after('m-') : Math.max(0, after('v-'));
  return [...wyniki.slice(0, at), ...extra, ...wyniki.slice(at)];
}
