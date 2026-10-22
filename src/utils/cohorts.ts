/**
 * Przepływ kohort uczestników Hyperliquid — typy publikowanego dokumentu i odczyty dla UI (bez importów zewnętrznych;
 * moduł ładowany także natywnie przez Node 24 w skanerze).
 *
 * Każda transakcja z publicznej taśmy ma adresy obu stron, a strona agresora wskazuje biorcę płynności. Skaner przypisuje
 * strony do kohort (market makerzy, statystycznie poinformowani, wieloryby, reszta) i publikuje wyłącznie agregaty:
 *  - kupno/sprzedaż wszystkich fillów kohorty (przepływ netto = zmiana zapasów; suma netto po kohortach = 0),
 *  - kupno/sprzedaż kohorty jako biorcy (agresywne CVD),
 *  - markouty transakcji biorców po klasyfikacji (walidacja poza próbą).
 * k-anonimowość: komórka (kohorta × kubełek) z < 5 uczestnikami albo z jednym uczestnikiem > 50% obrotu jest ukrywana (null).
 */

export const COHORTS = ['mm', 'informed', 'whale', 'rest'] as const;
export type CohortId = (typeof COHORTS)[number];

export const COHORT_LABEL: Record<CohortId, string> = {
  mm: 'Market makerzy',
  informed: 'Poinformowani',
  whale: 'Wieloryby',
  rest: 'Reszta',
};

export interface CohortCell {
  /** Kupno / sprzedaż wszystkich fillów kohorty (obie strony transakcji), USD */
  buy: number;
  sell: number;
  /** Kupno / sprzedaż kohorty jako biorcy płynności (agresor), USD */
  takerBuy: number;
  takerSell: number;
}

export interface CohortBucket {
  /** Początek kubełka, ms UTC */
  t: number;
  /** null = ukryte (k-anonimowość) */
  cells: Record<CohortId, CohortCell | null>;
}

export interface CohortMarkout {
  /** Liczba transakcji biorcy (po klasyfikacji) z rozliczonym horyzontem 5 min */
  n: number;
  /** Nominał tych transakcji, USD */
  usd: number;
  /** Markout ważony nominałem, bp (dodatni = cena poszła w kierunku transakcji); null = brak danych */
  m1: number | null;
  m5: number | null;
  m60: number | null;
}

export interface CohortFlow {
  v: 1;
  coin: string;
  asOf: number;
  /** Od kiedy skaner obserwuje bez przerwy */
  since: number;
  bucketMin: number;
  /** Kubełki z ostatnich 24 h z jakąkolwiek aktywnością, rosnąco */
  buckets: CohortBucket[];
  /** Sumy z kubełków nieukrytych; hidden = liczba ukrytych komórek w oknie */
  totals: { h1: Record<CohortId, CohortCell & { hidden: number }>; h24: Record<CohortId, CohortCell & { hidden: number }> };
  /** Adresy aktywne w 24 h przypisane do kohorty (liczności, bez adresów) */
  members: Record<CohortId, number>;
  /** Klasyfikacja „poinformowanych”: test jednostronny markoutu 5 min, kontrola FDR (Benjamini–Hochberg), empiryczny Bayes */
  informed: { candidates: number; selected: number; fdrQ: number; minN: number; mu0Bp: number | null; tauBp: number | null; classifiedAt: number | null };
  /** Markouty transakcji biorców wg kohorty w chwili transakcji (klasyfikacja z danych wcześniejszych) — 24 h */
  oos: Record<CohortId, CohortMarkout>;
  kMin: number;
  method: 'hl-cohorts-v1';
}

export const emptyCell = (): CohortCell => ({ buy: 0, sell: 0, takerBuy: 0, takerSell: 0 });

/** Przepływ netto komórki (zmiana zapasów kohorty), USD */
export const netOf = (c: CohortCell) => c.buy - c.sell;
/** Agresywna delta komórki (CVD biorców), USD */
export const takerNetOf = (c: CohortCell) => c.takerBuy - c.takerSell;

/** Skumulowany przepływ netto kohorty po kubełkach (ukryte komórki = 0, oznaczone osobno) */
export function cumulativeNet(flow: CohortFlow, id: CohortId, taker = false): { t: number; v: number; hidden: boolean }[] {
  let acc = 0;
  return flow.buckets.map((b) => {
    const c = b.cells[id];
    if (c) acc += taker ? takerNetOf(c) : netOf(c);
    return { t: b.t, v: acc, hidden: c === null };
  });
}

export function cohortFreshness(flow: CohortFlow, now: number): 'ready' | 'stale' | 'expired' {
  const min = 60_000;
  if (now - flow.asOf > 60 * min) return 'expired';
  if (now - flow.asOf > 10 * min) return 'stale';
  return 'ready';
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const finOrNull = (v: unknown) => v === null || fin(v);
const isCell = (c: unknown): c is CohortCell =>
  !!c && typeof c === 'object' && fin((c as CohortCell).buy) && fin((c as CohortCell).sell) && fin((c as CohortCell).takerBuy) && fin((c as CohortCell).takerSell);
const isTotal = (c: unknown) => isCell(c) && fin((c as { hidden?: unknown }).hidden);
const isRecordOf = (r: unknown, f: (x: unknown) => boolean) => !!r && typeof r === 'object' && COHORTS.every((k) => f((r as Record<string, unknown>)[k]));
const isMarkout = (m: unknown) =>
  !!m && typeof m === 'object' && fin((m as CohortMarkout).n) && fin((m as CohortMarkout).usd) && finOrNull((m as CohortMarkout).m1) && finOrNull((m as CohortMarkout).m5) && finOrNull((m as CohortMarkout).m60);

export function isCohortFlow(x: unknown): x is CohortFlow {
  if (!x || typeof x !== 'object') return false;
  const f = x as Partial<CohortFlow>;
  return (
    f.v === 1 &&
    typeof f.coin === 'string' &&
    fin(f.asOf) &&
    fin(f.since) &&
    fin(f.bucketMin) &&
    Array.isArray(f.buckets) &&
    f.buckets.every((b) => !!b && fin(b.t) && isRecordOf(b.cells, (c) => c === null || isCell(c))) &&
    !!f.totals &&
    isRecordOf(f.totals.h1, isTotal) &&
    isRecordOf(f.totals.h24, isTotal) &&
    isRecordOf(f.members, fin) &&
    !!f.informed &&
    fin(f.informed.candidates) &&
    fin(f.informed.selected) &&
    finOrNull(f.informed.mu0Bp) &&
    finOrNull(f.informed.tauBp) &&
    finOrNull(f.informed.classifiedAt) &&
    isRecordOf(f.oos, isMarkout) &&
    fin(f.kMin)
  );
}
