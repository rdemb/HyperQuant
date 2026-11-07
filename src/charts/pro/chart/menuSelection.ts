/** Wiersz okna wskaźników w części potrzebnej do wyboru widocznych pozycji. */
export interface SelectableEntry {
  key: string;
  section: string;
  tier?: string;
  words: string;
  badge?: string;
  label: string;
}

/**
 * Pozycje, które okno naprawdę pokazuje (i które obsługują strzałki oraz Enter): wyniki wyszukiwania albo zawartość sekcji.
 * Zwinięte „Klasyczne” bez zapytania nie pokazują nic, więc nic nie można dodać po cichu.
 */
export function visibleEntries<E extends SelectableEntry>(
  entries: readonly E[],
  o: { q: string; section: string; classicOpen: boolean; favs: readonly string[]; hlOrder: readonly string[]; norm: (t: string) => string }
): E[] {
  const { q, section, classicOpen, favs, hlOrder, norm } = o;
  if (q) {
    const words = q.split(/\s+/);
    const hits = entries.filter((e) => words.every((w) => e.words.includes(w)));
    // Najpierw trafienia od początku skrótu albo nazwy („rsi”, „vwap”)
    const head = (e: E) => norm(e.badge ?? '').startsWith(q) || norm(e.label).startsWith(q);
    return [...hits.filter(head), ...hits.filter((e) => !head(e))];
  }
  const byKey = (k: string) => entries.find((e) => e.key === k);
  const found = (keys: readonly string[]) => keys.map(byKey).filter((e): e is E => e !== undefined);
  if (section === 'fav') return found(favs);
  // Warstwa `search` jest tylko w wynikach wyszukiwania
  if (section === 'flow') return entries.filter((e) => e.section === 'flow');
  if (section === 'classic') return classicOpen ? entries.filter((e) => e.tier === 'classic') : [];
  if (section === 'hl') return found(hlOrder);
  return [];
}
