/// <reference lib="webworker" />
/** Web Worker: współczynnik rozgałęzienia Hawkesa dla okna taśmy (kilka–kilkadziesiąt ms na okno) poza wątkiem strony. */
import { fitBranching, type Branching } from '../charts/pro/core/hawkes';

export interface BranchingJob {
  id: number;
  ts: Float64Array;
  T: number;
}

self.onmessage = (e: MessageEvent<BranchingJob>) => {
  const { id, ts, T } = e.data;
  let r: Branching | null;
  try {
    r = fitBranching(ts, T);
  } catch {
    r = null;
  }
  (self as unknown as Worker).postMessage({ id, r });
};
