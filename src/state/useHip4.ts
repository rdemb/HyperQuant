import { useEffect, useRef, useState } from 'react';
import { postInfo } from '../utils/marketDataFeed';
import { parseBtcOutcomes, rowsFrom, type BtcOutcome, type Hip4Row } from '../utils/hip4';
import { modelProbabilities } from '../utils/hip4Model';
import type { VolModel } from '../utils/volatility';

const MIN = 60_000;
/** Najwyżej tyle rynków (najbliższe terminy): arkusz każdego to zapytanie l2Book (waga 2) co minutę. */
export const HIP4_MAX_MARKETS = 24;

export type { Hip4Row };

export interface Hip4State {
  status: 'loading' | 'ready' | 'error';
  rows: Hip4Row[];
  asOf: number | null;
}

let metaCache: { at: number; meta: unknown } | null = null;

/** Obliczenia modelu w Web Workerze (bez blokowania strony); brak obsługi workerów → obliczenie na miejscu. */
function makeComputer(): { run: (qs: BtcOutcome[], model: VolModel | null, price: number, now: number) => Promise<(number | null)[]>; close: () => void } {
  let worker: Worker | null = null;
  try {
    worker = typeof Worker !== 'undefined' ? new Worker(new URL('../workers/hip4.worker.ts', import.meta.url), { type: 'module' }) : null;
  } catch {
    worker = null;
  }
  let seq = 0;
  // Wynik workera; [] = błąd workera (liczymy na miejscu); null = anulowane przy odmontowaniu (bez liczenia)
  const pending = new Map<number, (p: (number | null)[] | null) => void>();
  if (worker) {
    worker.onmessage = (e: MessageEvent<{ id: number; probs: (number | null)[] }>) => {
      pending.get(e.data.id)?.(e.data.probs);
      pending.delete(e.data.id);
    };
    worker.onerror = () => {
      // Worker niedostępny (np. polityka przeglądarki) — dalej na miejscu
      for (const r of pending.values()) r([]);
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return {
    run: (qs, model, price, now) =>
      worker
        ? new Promise((resolve) => {
            const id = ++seq;
            pending.set(id, (p) => resolve(p === null ? qs.map(() => null) : p.length === qs.length ? p : modelProbabilities(qs, model, price, now)));
            worker!.postMessage({ id, qs, model, price, now });
          })
        : Promise.resolve(modelProbabilities(qs, model, price, now)),
    close: () => {
      // Oczekujące obliczenia kończą się (bez wycieku obietnic przy odmontowaniu)
      for (const r of pending.values()) r(null);
      pending.clear();
      worker?.terminate();
      worker = null;
    },
  };
}

/**
 * Rynki wynikowe BTC (HIP-4): lista co 10 min, arkusze strony „Yes” i model co minutę (w Web Workerze), tylko w widocznej
 * karcie (po powrocie od razu); najwyżej HIP4_MAX_MARKETS najbliższych terminów.
 */
export function useHip4(model: VolModel | null, price: number): Hip4State {
  const [state, setState] = useState<Hip4State>({ status: 'loading', rows: [], asOf: null });
  const ref = useRef({ model, price });
  ref.current = { model, price };
  useEffect(() => {
    let alive = true;
    let gen = 0;
    let lastAt = 0;
    const computer = makeComputer();
    const run = async () => {
      if (document.visibilityState !== 'visible') return;
      const my = ++gen;
      const now = Date.now();
      lastAt = now;
      // Starszy przebieg (np. zawieszone zapytanie) nie nadpisuje nowszego wyniku
      const current = () => alive && my === gen;
      try {
        if (!metaCache || now - metaCache.at > 10 * MIN) {
          const meta = await postInfo({ type: 'outcomeMeta' });
          if (meta) metaCache = { at: now, meta };
        }
        if (!metaCache) {
          // Błąd pobierania listy rynków — nie „brak rynków”
          if (current()) setState((s) => (s.status === 'ready' ? s : { status: 'error', rows: [], asOf: null }));
          return;
        }
        const qs = parseBtcOutcomes(metaCache.meta, now).slice(0, HIP4_MAX_MARKETS);
        const books = await Promise.all(qs.map((q) => postInfo({ type: 'l2Book', coin: q.coin })));
        const probs = await computer.run(qs, ref.current.model, ref.current.price, now);
        if (!current()) return;
        setState({ status: 'ready', rows: rowsFrom(qs, books, probs), asOf: now });
      } catch {
        if (current()) setState((s) => (s.status === 'ready' ? s : { status: 'error', rows: [], asOf: null }));
      }
    };
    void run();
    const id = window.setInterval(run, MIN);
    // Po powrocie do karty od razu, ale nie częściej niż co minutę (szybkie przełączanie kart)
    const onVisible = () => {
      if (Date.now() - lastAt >= MIN) void run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      computer.close();
    };
  }, []);
  return state;
}
