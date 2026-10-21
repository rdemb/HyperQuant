/**
 * Kwantyl przybliżony histogramem o stałych kubełkach — O(n), bez sortowania i bez alokacji
 * przy ponownym użyciu (reset). Dokładność = szerokość kubełka.
 */
export class HistQuantile {
  readonly bins: Uint32Array;
  count = 0;

  constructor(
    readonly lo: number,
    readonly hi: number,
    readonly nBins: number
  ) {
    this.bins = new Uint32Array(nBins);
  }

  reset(): void {
    this.bins.fill(0);
    this.count = 0;
  }

  add(v: number): void {
    let k = Math.floor(((v - this.lo) / (this.hi - this.lo)) * this.nBins);
    if (k < 0) k = 0;
    else if (k >= this.nBins) k = this.nBins - 1;
    this.bins[k]++;
    this.count++;
  }

  /** Górna krawędź kubełka, w którym skumulowana liczność osiąga q·n; NaN gdy pusto. */
  quantile(q: number): number {
    if (this.count === 0) return Number.NaN;
    const target = Math.max(1, Math.ceil(q * this.count));
    let acc = 0;
    const w = (this.hi - this.lo) / this.nBins;
    for (let k = 0; k < this.nBins; k++) {
      acc += this.bins[k];
      if (acc >= target) return this.lo + (k + 1) * w;
    }
    return this.hi;
  }
}
