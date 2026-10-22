import type { BackendQuantTelemetry } from '../types/trading.ts';
import { makeInnovation, mulberry32, normalGen, seedFrom } from './pathEngine.ts';
import { VOL_STEP_MIN } from './volatility.ts';

/**
 * Silniki Monte Carlo wspólne dla desku (przeglądarka) i dziennika prognoz (skaner w Node 24 — importy z rozszerzeniem .ts).
 */

/**
 * Prawdopodobieństwa dotknięcia PDH / PDL / D-EQ w 2 h: 2000 ścieżek, ziarno z bieżącej minuty (wspólne liczby losowe —
 * w obrębie minuty wynik zmienia się płynnie z ceną; błąd standardowy ≤ 1.1 pp). Bez przyciągania do D-EQ
 * (nieestymowane).
 * - Z modelem zmienności (`stepSigmas`): kroki 5 min z σ sezonowego log-HAR, innowacje FHS, korekta mostu Browna
 *   dla dotknięć między krokami.
 * - Bez modelu (zapas): Merton jump-diffusion z ZAŁOŻENIEM — skoki 20% wariancji, 1 skok / 2 h, krok 1 min, σ np. z Parkinsona.
 */
export function runTouchMonteCarlo(
  currentPrice: number,
  pdh: number,
  pdl: number,
  deq: number,
  sigma2h: number,
  opts: { stepSigmas?: number[]; residuals?: ArrayLike<number> | null; nowMs?: number } = {}
): BackendQuantTelemetry['monteCarlo'] {
  const numPaths = 2000;
  const now = opts.nowMs ?? Date.now();
  // Wspólne liczby losowe w obrębie minuty: drobna zmiana ceny przesuwa wynik płynnie zamiast losować ścieżki od nowa
  const seed = seedFrom(Math.floor(now / 60_000));
  const useModel = Array.isArray(opts.stepSigmas) && opts.stepSigmas.length > 0;
  const sigma = Math.max(0, sigma2h);

  // Zapas Merton: wariancja dyfuzji 80%, skoki 20% (założenie), λ = 1 na 2 h
  const jumpShare = 0.2;
  const jumpLambda = 1;
  const mertonSteps = 120;
  const stepMin = useModel ? VOL_STEP_MIN : 1;
  const sig = useModel ? opts.stepSigmas! : Array<number>(mertonSteps).fill((sigma * Math.sqrt(1 - jumpShare)) / Math.sqrt(mertonSteps));
  const steps = sig.length;
  const sigmaJump = sigma * Math.sqrt(jumpShare / jumpLambda);
  const muJump = -0.5 * sigmaJump * sigmaJump;
  const sigmaEff = useModel ? Math.sqrt(sig.reduce((a, s) => a + s * s, 0)) : sigma;

  const u = mulberry32(seed);
  const innov = useModel ? makeInnovation(u, opts.residuals ?? null) : normalGen(u);
  const uJump = mulberry32(seed ^ 0x51ed27);
  const jumpNormal = normalGen(uJump);
  const uBridge = mulberry32(seed ^ 0x9e3779b9);

  // Poziomy w log-cenie względem startu; D-EQ dotknięte przy przejściu na drugą stronę względem startu
  const lh = Math.log(pdh / currentPrice);
  const ll = Math.log(pdl / currentPrice);
  const ld = Math.log(deq / currentPrice);
  const deqBelow = ld <= 0;

  let hitPDH = 0;
  let hitPDL = 0;
  let hitDEQ = 0;
  let sumPDH = 0;
  let sumPDL = 0;
  let sumDEQ = 0;
  const sampledPaths: BackendQuantTelemetry['monteCarlo']['sampledPaths'] = [];
  // Most Browna: stała liczba losowań na krok (po jednym na poziom) — zużycie strumienia nie zależy od stanu ścieżki,
  // więc przy wspólnym ziarnie mała zmiana ceny nie przesuwa losowań kolejnych ścieżek
  const bridgeHit = (d0: number, d1: number, v: number, u: number) => useModel && u < Math.exp((-2 * d0 * d1) / v);

  for (let p = 0; p < numPaths; p++) {
    let w = 0;
    let tH = false;
    let tL = false;
    let tD = false;
    const pts: { step: number; price: number }[] = [{ step: 0, price: currentPrice }];

    for (let k = 1; k <= steps; k++) {
      const s = sig[k - 1];
      const v = s * s;
      const uH = useModel ? uBridge() : 1;
      const uL = useModel ? uBridge() : 1;
      const uD = useModel ? uBridge() : 1;
      let wn = w + s * innov();
      if (!useModel) {
        wn -= 0.5 * v;
        if (uJump() < jumpLambda / mertonSteps) wn += muJump + sigmaJump * jumpNormal();
      }
      const minute = k * stepMin;
      if (!tH && (wn >= lh || (w < lh && bridgeHit(lh - w, lh - wn, v, uH)))) {
        tH = true;
        hitPDH++;
        sumPDH += minute;
      }
      if (!tL && (wn <= ll || (w > ll && bridgeHit(w - ll, wn - ll, v, uL)))) {
        tL = true;
        hitPDL++;
        sumPDL += minute;
      }
      if (!tD) {
        const crossed = deqBelow ? wn <= ld : wn >= ld;
        const near = deqBelow ? w > ld && bridgeHit(w - ld, wn - ld, v, uD) : w < ld && bridgeHit(ld - w, ld - wn, v, uD);
        if (crossed || near) {
          tD = true;
          hitDEQ++;
          sumDEQ += minute;
        }
      }
      w = wn;
      if (p < 18 && minute % 5 === 0) pts.push({ step: minute / 5, price: Number((currentPrice * Math.exp(w)).toFixed(1)) });
    }

    if (p < 18) {
      const finalPrice = pts[pts.length - 1].price;
      const band = currentPrice * sigmaEff * 0.5;
      const type = finalPrice > currentPrice + band ? 'bull' : finalPrice < currentPrice - band ? 'bear' : 'mean_revert';
      sampledPaths.push({ id: `mc-path-${p}`, type, points: pts });
    }
  }

  // Średni czas dojścia tylko z trafień; null gdy brak trafień
  const avgMins = (sum: number, hits: number) => (hits > 0 ? Math.round(sum / hits) : null);
  const pct = (hits: number) => Number(((hits / numPaths) * 100).toFixed(1));

  return {
    probTouchPDH2h: pct(hitPDH),
    probTouchPDL2h: pct(hitPDL),
    probTouchDEQ2h: pct(hitDEQ),
    expectedMinsToPDH: avgMins(sumPDH, hitPDH),
    expectedMinsToPDL: avgMins(sumPDL, hitPDL),
    expectedMinsToDEQ: avgMins(sumDEQ, hitDEQ),
    sampledPaths,
    method: useModel ? 'fhs-har' : 'merton-assumed',
  };
}

/**
 * Kwantyle log-zwrotu w horyzoncie z kroków σ modelu zmienności (sezonowy log-HAR) i innowacji FHS (reszty standaryzowane;
 * null = normalne). Dryf −½Σσ² — cena jest martyngałem (bez prognozy kierunku). Deterministyczne dla danego ziarna.
 * Kwantyle empiryczne z interpolacją liniową (typ 7) — rosnąco jak `taus`.
 */
export function forecastReturnQuantiles(
  stepSigmas: number[],
  residuals: ArrayLike<number> | null,
  taus: number[],
  o: { paths?: number; seed: number }
): number[] {
  const n = o.paths ?? 4000;
  const innov = makeInnovation(mulberry32(o.seed), residuals);
  const drift = -0.5 * stepSigmas.reduce((a, s) => a + s * s, 0);
  const out = new Float64Array(n);
  for (let p = 0; p < n; p++) {
    let w = drift;
    for (const s of stepSigmas) w += s * innov();
    out[p] = w;
  }
  out.sort();
  return taus.map((t) => {
    const pos = (n - 1) * t;
    const lo = Math.floor(pos);
    const hi = Math.min(n - 1, lo + 1);
    return out[lo] + (out[hi] - out[lo]) * (pos - lo);
  });
}
