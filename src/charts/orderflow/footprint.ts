/** Logika footprintu (bez Reacta i bez płótna): kubełki ceny, nierównowagi, POC, value area. */

/** Flagi nierównowagi wiersza (bitowo). */
export const IMB_BUY = 1; // ask[p] ≥ ratio × bid[p−1] — przewaga kupujących agresorów
export const IMB_SELL = 2; // bid[p] ≥ ratio × ask[p+1] — przewaga sprzedających agresorów

/** Indeks kubełka ceny: kubełek k obejmuje [k·tick, (k+1)·tick). */
export function bucketIndex(price: number, tick: number): number {
  return Math.floor(price / tick + 1e-9);
}

/**
 * Nierównowaga diagonalna. Wiersze rosnąco wg ceny; `bid` = wolumen agresywnej sprzedaży
 * (uderza w bid), `ask` = wolumen agresywnego kupna (zdejmuje ask).
 * Kupno w wierszu p porównujemy z bid w wierszu p−1, sprzedaż w p z ask w p+1.
 * `minVol` odsiewa „nierównowagi” z pyłu (np. 0.02 BTC vs 0).
 */
export function detectImbalances(
  bid: ArrayLike<number>,
  ask: ArrayLike<number>,
  n: number,
  ratio: number,
  minVol: number,
  out: Uint8Array
): void {
  for (let i = 0; i < n; i++) {
    let f = 0;
    const a = ask[i];
    if (i > 0 && a > 0 && a >= minVol && a >= ratio * bid[i - 1]) f |= IMB_BUY;
    const b = bid[i];
    if (i < n - 1 && b > 0 && b >= minVol && b >= ratio * ask[i + 1]) f |= IMB_SELL;
    out[i] = f;
  }
}

/** Wiersz o największym wolumenie (remis → niższa cena); −1 gdy brak wolumenu. */
export function pocIndex(vol: ArrayLike<number>, n: number): number {
  let best = -1;
  let max = 0;
  for (let i = 0; i < n; i++) {
    if (vol[i] > max) {
      max = vol[i];
      best = i;
    }
  }
  return best;
}

/**
 * Value area: od POC dokładamy większego z sąsiadów (powyżej/poniżej), aż suma ≥ pct całości.
 * Zwraca indeksy wierszy (lo..hi włącznie) albo null dla pustego profilu.
 */
export function valueArea(vol: ArrayLike<number>, n: number, pct = 0.7): { poc: number; lo: number; hi: number } | null {
  const poc = pocIndex(vol, n);
  if (poc < 0) return null;
  let total = 0;
  for (let i = 0; i < n; i++) total += vol[i];
  const target = total * pct;
  let lo = poc;
  let hi = poc;
  let acc = vol[poc];
  while (acc < target) {
    const up = hi + 1 < n ? vol[hi + 1] : -1;
    const down = lo - 1 >= 0 ? vol[lo - 1] : -1;
    if (up < 0 && down < 0) break;
    if (up >= down) {
      hi++;
      acc += up;
    } else {
      lo--;
      acc += down;
    }
  }
  return { poc, lo, hi };
}

/** Wolumen BTC w ≤ 4 znakach (komórki footprintu: tabular mono 10 px). */
export function fmtVol(v: number): string {
  if (!(v > 0)) return '0';
  if (v < 0.01) return '<.01';
  if (v < 10) return v.toFixed(2);
  if (v < 100) return v.toFixed(1);
  if (v < 1000) return v.toFixed(0);
  return `${(v / 1000).toFixed(1)}K`;
}
