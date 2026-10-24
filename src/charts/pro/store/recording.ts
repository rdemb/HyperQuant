import type { ProStore } from './proStore';
import { TapePersistence, openTapeDb } from './tapeDb';

let persistence: Promise<void> | null = null;

/** Start nagrywania taśmy i (raz na stronę) jej zapisu w przeglądarce z odtworzeniem ostatniej doby. */
export function startRecording(store: ProStore): void {
  store.start();
  persistence ??= openTapeDb()
    .then(async (kv) => {
      if (!kv) return;
      const p = new TapePersistence(store, kv);
      await p.restore();
      p.start();
    })
    .catch(() => {
      // Zapis niedostępny — wykres działa na taśmie z bieżącej sesji
    });
}
