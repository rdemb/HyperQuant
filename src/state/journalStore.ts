import { parseJournal, serializeJournal, type Journal } from '../utils/tradeJournal';

/** Minimalny interfejs pamięci (localStorage albo atrapa w testach). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface JournalSnapshot {
  journal: Journal;
  /** Ostatni zapis się nie udał (np. pełna pamięć przeglądarki) — zmiany tylko w tej karcie */
  saveError: boolean;
  /** Klucz kopii uszkodzonego zapisu, gdy dziennik w pamięci był nieczytelny */
  recovered: string | null;
}

export interface JournalStore {
  get(): JournalSnapshot;
  update(f: (j: Journal) => Journal): void;
  subscribe(listener: () => void): () => void;
  /** Ponowny odczyt pamięci (zdarzenie `storage` z innej karty) */
  reload(): void;
}

export const JOURNAL_KEY = 'hq.journal.v1';
const EMPTY: Journal = { v: 1, setups: [], trades: [] };

/**
 * Dziennik w pamięci modułu (niezależny od montowania widoku — wzbogacenie zagrania po przełączeniu zakładki nie ginie).
 * Każdy zapis czyta najpierw aktualną wartość z pamięci przeglądarki, więc zmiany z innej karty nie są nadpisywane.
 * Uszkodzona wartość jest kopiowana pod `<klucz>.uszkodzony` przed pierwszym nadpisaniem; błąd zapisu jest zgłaszany.
 */
export function createJournalStore(storage: StorageLike | null, key = JOURNAL_KEY): JournalStore {
  const listeners = new Set<() => void>();
  let recovered: string | null = null;

  const read = (): Journal => {
    if (!storage) return snap.journal;
    let raw: string | null = null;
    try {
      raw = storage.getItem(key);
    } catch {
      return snap.journal;
    }
    if (raw === null) return EMPTY;
    const parsed = parseJournal(raw);
    if (parsed) return parsed;
    // Nieczytelny zapis — kopia przed nadpisaniem (raz), dziennik zaczyna się od zera
    if (recovered === null) {
      recovered = `${key}.uszkodzony`;
      try {
        if (storage.getItem(recovered) === null) storage.setItem(recovered, raw);
      } catch {
        // brak miejsca na kopię — informacja i tak trafia do użytkownika
      }
    }
    return EMPTY;
  };

  let snap: JournalSnapshot = { journal: EMPTY, saveError: false, recovered: null };
  snap = { journal: read(), saveError: false, recovered };

  const notify = () => {
    for (const l of listeners) l();
  };

  return {
    get: () => snap,
    update(f) {
      // Po nieudanym zapisie pamięć przeglądarki jest starsza niż stan strony — wtedy bazą jest stan strony
      const base = snap.saveError ? snap.journal : read();
      const next = f(base);
      let saveError = false;
      if (storage) {
        try {
          storage.setItem(key, serializeJournal(next));
        } catch {
          saveError = true;
        }
      }
      snap = { journal: next, saveError, recovered };
      notify();
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    reload() {
      if (snap.saveError) return; // niezapisane zmiany tej karty mają pierwszeństwo
      snap = { journal: read(), saveError: false, recovered };
      notify();
    },
  };
}
