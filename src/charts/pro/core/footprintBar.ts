import type { Side } from '../hl/parse';
import { IMB_BUY, IMB_SELL, detectImbalances, valueArea } from '../../orderflow/footprint';

/**
 * Footprint świecy z taśmy: wolumen agresywnego kupna i sprzedaży na każdym ticku ceny, delta z jej
 * maksimum i minimum w trakcie świecy oraz delta od chwili ustanowienia szczytu i dołka ceny.
 * Wiersze są trzymane na ticku bazowym; agregacja do wysokości wiersza wykresu jest osobnym krokiem.
 */

export interface FootprintBar {
  /** Początek świecy (ms). */
  t: number;
  /** Tick bazowy (USD); cena wiersza i = (lo + i) × tick. */
  tick: number;
  lo: number;
  /** Agresywne kupno per wiersz (jednostki rynku). */
  buy: Float64Array;
  /** Agresywna sprzedaż per wiersz (jednostki rynku). */
  sell: Float64Array;
  buyVol: number;
  sellVol: number;
  delta: number;
  maxDelta: number;
  minDelta: number;
  /** Delta skumulowana w chwili ostatniego ustanowienia szczytu ceny świecy. */
  deltaAtHigh: number;
  deltaAtLow: number;
  trades: number;
  buyTrades: number;
  sellTrades: number;
  open: number;
  high: number;
  low: number;
  close: number;
  firstTime: number;
  lastTime: number;
}

/**
 * Tick ceny perpów Hyperliquid: najwyżej 5 cyfr znaczących, ale cena całkowita jest zawsze dozwolona, więc tick nie
 * przekracza 1 (BTC przy 80 tys. i od 100 tys. = 1 USD); nie mniej niż 10^−(6 − szDecimals). Bez `szDecimals` — sama
 * reguła cyfr znaczących (przy cenach BTC, ETH, SOL i HYPE to ona wyznacza tick).
 */
export function hlTick(px: number, szDecimals?: number): number {
  if (!(px > 0)) return 1;
  const sig = Math.min(1, 10 ** (Math.floor(Math.log10(px)) - 4));
  return szDecimals === undefined ? sig : Math.max(sig, 10 ** -(6 - szDecimals));
}

/**
 * Tick bazowy footprintu, profili i TPO: z ceny o 5% niższej (świeca tuż nad granicą rzędu, np. 100 tys., nie traci ticku
 * 1 USD po spadku pod nią). Jedna kotwica dla wszystkich warstw wierszy, żeby leżały na tej samej siatce.
 */
export function baseTick(px: number): number {
  return hlTick(px * 0.95);
}

/** Indeks wiersza ceny na siatce `step` (zaokrąglenie chroni przed błędem zmiennoprzecinkowym). */
export function rowIndex(px: number, step: number): number {
  return Math.floor(px / step + 1e-7);
}

export class FootprintBuilder {
  private readonly rows = new Map<number, [number, number]>();
  buyVol = 0;
  sellVol = 0;
  delta = 0;
  maxDelta = 0;
  minDelta = 0;
  deltaAtHigh = 0;
  deltaAtLow = 0;
  trades = 0;
  buyTrades = 0;
  sellTrades = 0;
  open = Number.NaN;
  high = Number.NEGATIVE_INFINITY;
  low = Number.POSITIVE_INFINITY;
  close = Number.NaN;
  firstTime = Number.NaN;
  lastTime = Number.NaN;

  /** @param tick tick bazowy (USD); domyślnie z ceny pierwszej transakcji. */
  constructor(
    readonly t: number,
    private tick = Number.NaN
  ) {}

  /** Dokłada transakcję; wymaga kolejności czasu (delta w trakcie świecy zależy od kolejności). */
  add(time: number, px: number, sz: number, side: Side): void {
    if (Number.isNaN(this.tick)) this.tick = baseTick(px);
    const idx = rowIndex(px, this.tick);
    let r = this.rows.get(idx);
    if (!r) {
      r = [0, 0];
      this.rows.set(idx, r);
    }
    if (side === 1) {
      r[0] += sz;
      this.buyVol += sz;
      this.buyTrades++;
      this.delta += sz;
    } else {
      r[1] += sz;
      this.sellVol += sz;
      this.sellTrades++;
      this.delta -= sz;
    }
    this.trades++;
    if (this.delta > this.maxDelta) this.maxDelta = this.delta;
    if (this.delta < this.minDelta) this.minDelta = this.delta;
    if (Number.isNaN(this.open)) {
      this.open = px;
      this.firstTime = time;
    }
    // Szczyt i dołek: delta zapamiętana w chwili ostatniego dotknięcia skraju (także równego)
    if (px >= this.high) {
      this.high = px;
      this.deltaAtHigh = this.delta;
    }
    if (px <= this.low) {
      this.low = px;
      this.deltaAtLow = this.delta;
    }
    this.close = px;
    this.lastTime = time;
  }

  get empty(): boolean {
    return this.trades === 0;
  }

  build(): FootprintBar | null {
    if (this.trades === 0) return null;
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    this.rows.forEach((_r, i) => {
      if (i < lo) lo = i;
      if (i > hi) hi = i;
    });
    const n = hi - lo + 1;
    const buy = new Float64Array(n);
    const sell = new Float64Array(n);
    this.rows.forEach((r, i) => {
      buy[i - lo] = r[0];
      sell[i - lo] = r[1];
    });
    return {
      t: this.t,
      tick: this.tick,
      lo,
      buy,
      sell,
      buyVol: this.buyVol,
      sellVol: this.sellVol,
      delta: this.delta,
      maxDelta: this.maxDelta,
      minDelta: this.minDelta,
      deltaAtHigh: this.deltaAtHigh,
      deltaAtLow: this.deltaAtLow,
      trades: this.trades,
      buyTrades: this.buyTrades,
      sellTrades: this.sellTrades,
      open: this.open,
      high: this.high,
      low: this.low,
      close: this.close,
      firstTime: this.firstTime,
      lastTime: this.lastTime,
    };
  }
}

/** Wiersze footprintu po agregacji do wysokości `step` (USD), rosnąco wg ceny. */
export interface FootprintRows {
  step: number;
  /** Indeks pierwszego wiersza na siatce `step` (cena dolnej krawędzi = lo × step). */
  lo: number;
  n: number;
  buy: Float64Array;
  sell: Float64Array;
  vol: Float64Array;
  /** Flagi nierównowagi diagonalnej (IMB_BUY / IMB_SELL). */
  imb: Uint8Array;
  maxVol: number;
  maxSide: number;
  poc: number;
  vaLo: number;
  vaHi: number;
}

export interface ImbalanceParams {
  /** Stosunek nierównowagi diagonalnej (np. 3 = 300%). */
  ratio: number;
  /** Minimalny wolumen strony przewagi (jednostki rynku). */
  minVol: number;
}

/** Agreguje wiersze ticku bazowego do wiersza `step` (wielokrotność ticku) i liczy POC, VA 70% i nierównowagi. */
export function aggregateRows(bar: FootprintBar, step: number, imbalance: ImbalanceParams): FootprintRows {
  const s = step > bar.tick ? step : bar.tick;
  const lo = rowIndex(bar.lo * bar.tick, s);
  const hi = rowIndex((bar.lo + bar.buy.length - 1) * bar.tick, s);
  const n = hi - lo + 1;
  const buy = new Float64Array(n);
  const sell = new Float64Array(n);
  const vol = new Float64Array(n);
  for (let i = 0; i < bar.buy.length; i++) {
    const b = bar.buy[i];
    const a = bar.sell[i];
    if (b === 0 && a === 0) continue;
    const r = rowIndex((bar.lo + i) * bar.tick, s) - lo;
    buy[r] += b;
    sell[r] += a;
  }
  let maxVol = 0;
  let maxSide = 0;
  for (let i = 0; i < n; i++) {
    vol[i] = buy[i] + sell[i];
    if (vol[i] > maxVol) maxVol = vol[i];
    if (buy[i] > maxSide) maxSide = buy[i];
    if (sell[i] > maxSide) maxSide = sell[i];
  }
  const imb = new Uint8Array(n);
  detectImbalances(sell, buy, n, imbalance.ratio, imbalance.minVol, imb);
  const va = valueArea(vol, n, 0.7);
  return { step: s, lo, n, buy, sell, vol, imb, maxVol, maxSide, poc: va?.poc ?? -1, vaLo: va?.lo ?? -1, vaHi: va?.hi ?? -1 };
}

/**
 * Wiersz pod ceną `price` w układzie wykresu: wiersz ceny P (krok = tick) zajmuje [P − tick/2, P + tick/2),
 * wiersz zagregowany k — ceny [k·step, (k+1)·step). Zwraca indeks w `rows` albo −1.
 */
export function rowAt(rows: FootprintRows, tick: number, price: number): number {
  const r = Math.floor((price + tick / 2) / rows.step + 1e-9) - rows.lo;
  return r >= 0 && r < rows.n ? r : -1;
}

export interface StackedRun {
  side: Side;
  /** Pierwszy i ostatni wiersz serii (indeksy w FootprintRows). */
  from: number;
  to: number;
}

/** Serie ≥ `minRun` kolejnych wierszy z nierównowagą po tej samej stronie (strefy „stacked”). */
export function stackedRuns(imb: Uint8Array, n: number, minRun: number): StackedRun[] {
  const out: StackedRun[] = [];
  for (const [flag, side] of [
    [IMB_BUY, 1],
    [IMB_SELL, -1],
  ] as const) {
    let start = -1;
    for (let i = 0; i <= n; i++) {
      const on = i < n && (imb[i] & flag) !== 0;
      if (on && start < 0) start = i;
      else if (!on && start >= 0) {
        if (i - start >= minRun) out.push({ side, from: start, to: i - 1 });
        start = -1;
      }
    }
  }
  return out.sort((a, b) => a.from - b.from);
}
