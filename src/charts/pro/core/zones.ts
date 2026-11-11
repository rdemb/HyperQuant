import type { Side } from '../hl/parse';
import { FootprintBar, FootprintRows, ImbalanceParams, aggregateRows, stackedRuns } from './footprintBar';
import { utcDayStart } from './sessions';

/**
 * Strefy z footprintu świec z taśmą, ciągnięte w prawo do chwili, gdy cena je zamknie:
 * - strefa nierównowagi — seria (stacked) co najmniej `minRun` kolejnych wierszy z nierównowagą diagonalną po jednej
 *   stronie; strefa kupna kończy się na świecy, której dołek schodzi poniżej strefy, strefa sprzedaży — szczyt powyżej,
 * - niedokończona aukcja — na szczycie (dołku) świecy handlowano po obu stronach (kupno i sprzedaż agresorów > 0);
 *   poziom kończy się na świecy, która wraca do tej ceny.
 * Siatka wierszy nie zależy od zbliżenia; automatyczny krok jest stały w obrębie doby UTC (`dayZoneStep`), więc strefy
 * z historii nie liczą się od nowa, gdy zmienia się zakres ostatnich świec. Strefy i aukcje powstają tylko ze świec
 * zamkniętych i w całości nagranych (świeca w trakcie i świeca z luką w taśmie ich nie tworzą).
 */

export interface ZoneBar {
  t: number;
  high: number;
  low: number;
  fp: FootprintBar | null;
  /** Świeca zamknięta i w całości objęta taśmą (strefy i aukcje liczymy tylko z takich świec). */
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

/**
 * Krok siatki stały w obrębie doby UTC: o 00:00 UTC z mediany zakresu świec poprzedniej doby (1/12, 1, 2, 5 × 10^k, nie
 * mniej niż tick). Doba, której poprzedniej doby nie ma w całości w historii, dostaje 0 (bez stref), więc krok nie zależy
 * od głębokości wczytanej historii. Krok ręczny (`rowStep` > 0) — ten sam dla każdej świecy.
 */
export function dayZoneStep(bars: readonly ZoneBar[], rowStep: number): (t: number) => number {
  const tick = bars.find((b) => b.fp)?.fp!.tick ?? 0;
  if (!(tick > 0)) return () => 0;
  if (rowStep > 0) {
    const fixed = Math.max(rowStep, tick);
    return () => fixed;
  }
  const first = bars.length > 0 ? bars[0].t : Number.POSITIVE_INFINITY;
  const ranges = new Map<number, number[]>();
  for (const b of bars) {
    const d = utcDayStart(b.t);
    let list = ranges.get(d);
    if (!list) ranges.set(d, (list = []));
    list.push(b.high - b.low);
  }
  const memo = new Map<number, number>();
  return (t) => {
    const day = utcDayStart(t);
    const hit = memo.get(day);
    if (hit !== undefined) return hit;
    const prev = utcDayStart(day - 1);
    const list = first <= prev ? ranges.get(prev) : undefined;
    let step = 0;
    if (list && list.length > 0) {
      const sorted = [...list].sort((a, b) => a - b);
      step = niceStep(sorted[sorted.length >> 1] / ROWS_PER_BAR, tick);
    }
    memo.set(day, step);
    return step;
  };
}

/** Krok siatki: stały albo zależny od świecy (doba UTC). */
export type StepOf = number | ((t: number) => number);
const stepAt = (s: StepOf, t: number) => (typeof s === 'number' ? s : s(t));

/** Wiersze footprintu świecy na siatce strefy (z pamięcią podręczną przekazaną z zewnątrz). */
export type RowsOf = (fp: FootprintBar, step: number, imb: ImbalanceParams) => FootprintRows;

export const plainRows: RowsOf = (fp, step, imb) => aggregateRows(fp, step, imb);

export function imbalanceZones(bars: readonly ZoneBar[], step: StepOf, imb: ImbalanceParams, minRun: number, rowsOf: RowsOf = plainRows): ImbalanceZone[] {
  if (minRun < 2) return [];
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
    // Strefa tylko ze świecy zamkniętej i w całości nagranej (świeca w trakcie zmieniała strefy co sekundę)
    const st = stepAt(step, b.t);
    if (!b.fp || !b.complete || !(st > 0)) continue;
    const rows = rowsOf(b.fp, st, imb);
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
  step: StepOf,
  rowsOf: RowsOf = plainRows,
  imb: ImbalanceParams = { ratio: 3, minVol: 0 }
): UnfinishedAuction[] {
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
    const st = stepAt(step, b.t);
    if (!b.fp || !b.complete || !(st > 0)) continue;
    const rows = rowsOf(b.fp, st, imb);
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
