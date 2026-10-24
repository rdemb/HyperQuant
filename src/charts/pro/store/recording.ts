import type { ProStore } from './proStore';
import { TapePersistence, openTapeDb } from './tapeDb';

const persistence = new Map<ProStore, Promise<void>>();

/** Start nagrywania taśmy rynku i (raz na stronę) jej zapisu w przeglądarce z odtworzeniem ostatniej doby. */
export function startRecording(store: ProStore): void {
  store.start();
  if (persistence.has(store)) return;
  persistence.set(
    store,
    openTapeDb(store.coin)
      .then(async (kv) => {
        if (!kv) return;
        const p = new TapePersistence(store, kv);
        await p.restore();
        p.start();
      })
      .catch(() => {
        // Zapis niedostępny — wykres działa na taśmie z bieżącej sesji
      })
  );
}
