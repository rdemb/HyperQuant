import type { Side } from '../hl/parse';
import { FootprintBar, FootprintRows, ImbalanceParams, aggregateRows, stackedRuns } from './footprintBar';

/**
 * Strefy z footprintu świec z taśmą, ciągnięte w prawo do chwili, gdy cena je zamknie:
 * - strefa nierównowagi — seria (stacked) co najmniej `minRun` kolejnych wierszy z nierównowagą diagonalną po jednej
 *   stronie; strefa kupna kończy się na świecy, której dołek schodzi poniżej strefy, strefa sprzedaży — szczyt powyżej,
 * - niedokończona aukcja — na szczycie (dołku) świecy handlowano po obu stronach (kupno i sprzedaż agresorów > 0);
 *   poziom kończy się na świecy, która wraca do tej ceny.
 * Siatka wierszy jest stała dla wszystkich świec (nie zależy od zbliżenia), więc strefy nie migają przy przewijaniu.
 */

export interface ZoneBar {
  t: number;
  high: number;
  low: number;
  fp: FootprintBar | null;
  /** Świeca zamknięta i w całości objęta taśmą (aukcje liczymy tylko z takich świec). */
  complete: boolean;
}

export interface ImbalanceZone {
  /** Świeca powstania i świeca zamknięcia (początki, ms); null = strefa wciąż otwarta. */
  from: number;
  to: number | null;
  lo: number;
  hi: number;
  /** 1 = przewaga kupna (wsparcie), −1 = sprzedaży (opór). */
  side: Side;
  /** Ile razy późniejsza świeca weszła w strefę, nie zamykając jej. */
  tests: number;
}

export interface UnfinishedAuction {
  from: number;
  to: number | null;
  px: number;
  /** 1 = szczyt świecy, −1 = dołek. */
  end: Side;
}

/** Krok siatki: 1, 2 albo 5 × 10^k, nie mniejszy niż tick. */
export function niceStep(v: number, tick: number): number {
  if (!(v > tick)) return tick;
  const k = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5]) if (m * k >= v) return Math.max(tick, m * k);
  return Math.max(tick, 10 * k);
}

/** Liczba wierszy na typową świecę przy automatycznej siatce stref. */
const ROWS_PER_BAR = 12;

/** Siatka stref: ręczna wysokość wiersza albo ~1/12 mediany zakresu świec z taśmą (ostatnie 60). */
export function zoneStep(bars: readonly ZoneBar[], rowStep: number): number {
  const tape = bars.filter((b) => b.fp).slice(-60);
  if (tape.length === 0) return 0;
  const tick = tape[0].fp!.tick;
  if (rowStep > 0) return Math.max(rowStep, tick);
  const ranges = tape.map((b) => b.high - b.low).sort((a, b) => a - b);
  return niceStep(ranges[ranges.length >> 1] / ROWS_PER_BAR, tick);
}

/** Wiersze footprintu świecy na siatce strefy (z pamięcią podręczną przekazaną z zewnątrz). */
export type RowsOf = (fp: FootprintBar, step: number, imb: ImbalanceParams) => FootprintRows;

export const plainRows: RowsOf = (fp, step, imb) => aggregateRows(fp, step, imb);

export function imbalanceZones(bars: readonly ZoneBar[], step: number, imb: ImbalanceParams, minRun: number, rowsOf: RowsOf = plainRows): ImbalanceZone[] {
  if (!(step > 0) || minRun < 2) return [];
  const out: ImbalanceZone[] = [];
  const open: ImbalanceZone[] = [];
  for (const b of bars) {
    // Najpierw późniejsze świece zamykają albo testują strefy wcześniejszych
    for (let i = open.length - 1; i >= 0; i--) {
      const z = open[i];
      const through = z.side === 1 ? b.low < z.lo : b.high > z.hi;
      if (through) {
        z.to = b.t;
        open.splice(i, 1);
      } else if (b.low <= z.hi && b.high >= z.lo) z.tests++;
    }
    if (!b.fp) continue;
    const rows = rowsOf(b.fp, step, imb);
    for (const run of stackedRuns(rows.imb, rows.n, minRun)) {
      const z: ImbalanceZone = { from: b.t, to: null, lo: (rows.lo + run.from) * rows.step, hi: (rows.lo + run.to + 1) * rows.step, side: run.side, tests: 0 };
      out.push(z);
      open.push(z);
    }
  }
  return out;
}

/** `imb` nie wpływa na wynik — te same parametry co strefy pozwalają współdzielić wiersze z pamięci podręcznej. */
export function unfinishedAuctions(
  bars: readonly ZoneBar[],
  step: number,
  rowsOf: RowsOf = plainRows,
  imb: ImbalanceParams = { ratio: 3, minVol: 0 }
): UnfinishedAuction[] {
  if (!(step > 0)) return [];
  const out: UnfinishedAuction[] = [];
  const open: UnfinishedAuction[] = [];
  for (const b of bars) {
    for (let i = open.length - 1; i >= 0; i--) {
      const u = open[i];
      if (u.end === 1 ? b.high >= u.px : b.low <= u.px) {
        u.to = b.t;
        open.splice(i, 1);
      }
    }
    if (!b.fp || !b.complete) continue;
    const rows = rowsOf(b.fp, step, imb);
    // Skrajne wiersze z wolumenem: górny (szczyt) i dolny (dołek)
    let top = rows.n - 1;
    while (top >= 0 && rows.vol[top] === 0) top--;
    let bot = 0;
    while (bot < rows.n && rows.vol[bot] === 0) bot++;
    if (top < 0) continue;
    if (rows.buy[top] > 0 && rows.sell[top] > 0) {
      const u: UnfinishedAuction = { from: b.t, to: null, px: b.fp.high, end: 1 };
      out.push(u);
      open.push(u);
    }
    if (bot !== top && rows.buy[bot] > 0 && rows.sell[bot] > 0) {
      const u: UnfinishedAuction = { from: b.t, to: null, px: b.fp.low, end: -1 };
      out.push(u);
      open.push(u);
    }
  }
  return out;
}
