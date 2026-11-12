import type { ProStore } from './proStore';
import { type TapeKv, TapePersistence, deleteTapeDb, openTapeDb } from './tapeDb';

/** Zapis taśmy rynku w przeglądarce: w drodze albo działający (null — przeglądarka bez zapisu). */
const persistence = new Map<ProStore, Promise<{ p: TapePersistence; kv: TapeKv } | null>>();

/** Start nagrywania taśmy rynku i (raz na stronę) jej zapisu w przeglądarce z odtworzeniem ostatniej doby. */
export function startRecording(store: ProStore): void {
  store.start();
  if (persistence.has(store)) return;
  persistence.set(
    store,
    openTapeDb(store.coin)
      .then(async (kv) => {
        if (!kv) return null;
        const p = new TapePersistence(store, kv);
        await p.restore();
        p.start();
        return { p, kv };
      })
      .catch(() => {
        // Zapis niedostępny — wykres działa na taśmie z bieżącej sesji
        return null;
      })
  );
}

/**
 * Koniec nagrywania rynku, którego nie ma w rejestrze (link z nazwą w dobrym formacie, ale bez rynku): zapis zatrzymany,
 * połączenie z bazą zamknięte, a baza taśmy tej nazwy usunięta, żeby w przeglądarce nie zostawały puste bazy.
 */
export async function discardRecording(store: ProStore): Promise<void> {
  const rec = persistence.get(store);
  persistence.delete(store);
  const r = rec ? await rec : null;
  r?.p.stop();
  r?.kv.close?.();
  await deleteTapeDb(store.coin);
}
