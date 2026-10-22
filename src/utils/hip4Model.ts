/**
 * Prawdopodobieństwa modelu desku dla rynków HIP-4 — moduł bez Reacta, używany w Web Workerze (obliczenia nie blokują
 * wątku strony) i w testach.
 */
import { outcomeProbabilities, type BtcOutcome } from './hip4';
import { seedFrom } from './pathEngine';
import { horizonStepSigmas, type VolModel } from './volatility';

const MIN = 60_000;
/** Dalej niż 14 dni model zmienności nie jest testowany — wiersz bez wartości modelu */
export const MAX_MODEL_HORIZON_MIN = 14 * 24 * 60;

/**
 * Krok symulacji: 5 min do doby, 15 min do 3 dni, 60 min dalej. Dotknięcia między krokami liczone są z dokładnego ekstremum
 * mostu Browna, więc dłuższy krok ich nie gubi.
 */
export const stepFor = (h: number) => (h <= 24 * 60 ? 5 : h <= 3 * 24 * 60 ? 15 : 60);

/** Prawdopodobieństwa modelu dla rynków (ten sam silnik co dziennik desku); poza horyzontem / bez modelu → null. */
export function modelProbabilities(qs: BtcOutcome[], model: VolModel | null, price: number, now: number): (number | null)[] {
  if (!model || !(price > 0)) return qs.map(() => null);
  const horizon = (q: BtcOutcome) => Math.round((q.expiry - now) / MIN);
  const inRange = qs.map((q) => horizon(q) > 0 && horizon(q) <= MAX_MODEL_HORIZON_MIN);
  const res = outcomeProbabilities(
    qs.map((q, i) => ({ kind: q.kind, K: q.K, horizonMin: inRange[i] ? horizon(q) : 0 })),
    price,
    {
      stepSigmas: (h) => horizonStepSigmas(model, now, h, stepFor(h)),
      residuals: model.residuals,
      seed: seedFrom(Math.floor(now / MIN)),
      paths: 2000,
      // Reszty FHS są 5-minutowe: krok 15/60 min = suma 3/12 innowacji (rozkład agregowanych zwrotów)
      innovSum: (h) => stepFor(h) / 5,
    }
  );
  return res.map((p, i) => (inRange[i] ? p : null));
}
