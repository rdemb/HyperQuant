import { fitBranching, type Branching } from './hawkes';

/**
 * Dopasowanie n w Web Workerze wspólnym dla wszystkich instancji wskaźnika; bez obsługi workerów (testy) albo po błędzie
 * workera — od razu na miejscu.
 */
let worker: Worker | null | undefined;
let seq = 0;
const pending = new Map<number, (r: Branching | null) => void>();

function get(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = typeof Worker !== 'undefined' ? new Worker(new URL('../../../workers/branching.worker.ts', import.meta.url), { type: 'module' }) : null;
  } catch {
    worker = null;
  }
  if (worker) {
    worker.onmessage = (e: MessageEvent<{ id: number; r: Branching | null }>) => {
      pending.get(e.data.id)?.(e.data.r);
      pending.delete(e.data.id);
    };
    worker.onerror = () => {
      // Worker niedostępny (np. polityka przeglądarki): oczekujące bez wyniku, następne na miejscu
      for (const r of pending.values()) r(null);
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

/** Czy dopasowania idą do workera (wynik później), czy liczą się od razu. */
export function inBackground(): boolean {
  return get() !== null;
}

/** n z przedziałem dla czasów zdarzeń `ts` (sekundy od początku okna długości `T` s), w workerze albo na miejscu. */
export function fitBranchingLater(ts: Float64Array, T: number): Promise<Branching | null> {
  const w = get();
  if (!w) return Promise.resolve(fitBranching(ts, T));
  return new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    w.postMessage({ id, ts, T }, [ts.buffer]);
  });
}
