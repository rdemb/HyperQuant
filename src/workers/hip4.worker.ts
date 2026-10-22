/// <reference lib="webworker" />
/** Web Worker: prawdopodobieństwa modelu dla rynków HIP-4 (Monte Carlo ~0.1–0.2 s) poza wątkiem strony. */
import { modelProbabilities } from '../utils/hip4Model';
import type { BtcOutcome } from '../utils/hip4';
import type { VolModel } from '../utils/volatility';

export interface Hip4Job {
  id: number;
  qs: BtcOutcome[];
  model: VolModel | null;
  price: number;
  now: number;
}

self.onmessage = (e: MessageEvent<Hip4Job>) => {
  const { id, qs, model, price, now } = e.data;
  let probs: (number | null)[];
  try {
    probs = modelProbabilities(qs, model, price, now);
  } catch {
    probs = qs.map(() => null);
  }
  (self as unknown as Worker).postMessage({ id, probs });
};
