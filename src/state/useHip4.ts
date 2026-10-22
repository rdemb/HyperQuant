import { useEffect, useRef, useState } from 'react';
import { postInfo } from '../utils/marketDataFeed';
import { bookQuote, parseBtcOutcomes, type BtcOutcome, type Quote } from '../utils/hip4';
import { modelProbabilities } from '../utils/hip4Model';
import type { VolModel } from '../utils/volatility';

const MIN = 60_000;

export interface Hip4Row {
  q: BtcOutcome;
  quote: Quote | null;
  /** P(model) albo null (brak modelu / poza horyzontem) */
  model: number | null;
}

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
  const pending = new Map<number, (p: (number | null)[]) => void>();
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
            pending.set(id, (p) => resolve(p.length === qs.length ? p : modelProbabilities(qs, model, price, now)));
            worker!.postMessage({ id, qs, model, price, now });
          })
        : Promise.resolve(modelProbabilities(qs, model, price, now)),
    close: () => worker?.terminate(),
  };
}

/** Rynki wynikowe BTC (HIP-4): lista co 10 min, arkusze strony „Yes” i model co minutę (w Web Workerze). */
export function useHip4(model: VolModel | null, price: number): Hip4State {
  const [state, setState] = useState<Hip4State>({ status: 'loading', rows: [], asOf: null });
  const ref = useRef({ model, price });
  ref.current = { model, price };
  useEffect(() => {
    let alive = true;
    const computer = makeComputer();
    const run = async () => {
      const now = Date.now();
      try {
        if (!metaCache || now - metaCache.at > 10 * MIN) {
          const meta = await postInfo({ type: 'outcomeMeta' });
          if (meta) metaCache = { at: now, meta };
        }
        const qs = parseBtcOutcomes(metaCache?.meta ?? null, now);
        const books = await Promise.all(qs.map((q) => postInfo({ type: 'l2Book', coin: q.coin })));
        const probs = await computer.run(qs, ref.current.model, ref.current.price, now);
        if (!alive) return;
        setState({ status: 'ready', rows: qs.map((q, i) => ({ q, quote: bookQuote(books[i]), model: probs[i] ?? null })), asOf: now });
      } catch {
        if (alive) setState((s) => (s.status === 'ready' ? s : { status: 'error', rows: [], asOf: null }));
      }
    };
    void run();
    const id = window.setInterval(run, MIN);
    return () => {
      alive = false;
      window.clearInterval(id);
      computer.close();
    };
  }, []);
  return state;
}
