// Zakres numeracji kont biorców (historia serwera: numer ważny w godzinie albo dobie UTC, na żywo adres): wspólne dla
// wskaźników (indicators/registry.ts) i Kto handluje (core/players.ts).

/**
 * Czy konta zleceń (bez zleceń bez konta) leżą w jednym zakresie numeracji: wszystkie na żywo albo z jednej godziny lub
 * doby — to samo co równy `accountScopeKey`, ale bez alokacji na zlecenie (pętla po wszystkich zleceniach okna i świecy):
 * przedrostek `~<zakres>:` pierwszego konta z historii (klucze z `toFills` zawsze mają dwukropek, więc `~1:` ≠ `~10:`).
 */
export function oneAccountScope(lists: readonly (readonly { taker: string }[])[]): boolean {
  // undefined — jeszcze bez konta; '' — konta na żywo (bez `~`); inaczej przedrostek zakresu z dwukropkiem
  let prefix: string | undefined;
  for (const list of lists) {
    for (const o of list) {
      const id = o.taker;
      if (id === '') continue;
      if (prefix === undefined) {
        const end = id.indexOf(':');
        prefix = !id.startsWith('~') ? '' : end < 0 ? id : id.slice(0, end + 1);
      } else if (prefix === '' ? id.startsWith('~') : !id.startsWith(prefix)) return false;
    }
  }
  return true;
}
