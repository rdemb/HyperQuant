import { tr } from '../i18n.ts';
/**
 * Przepływ kohort uczestników Hyperliquid — typy publikowanego dokumentu i odczyty dla UI (bez importów zewnętrznych;
 * moduł ładowany także natywnie przez Node 24 w skanerze).
 *
 * Każda transakcja z publicznej taśmy ma adresy obu stron, a strona agresora wskazuje biorcę płynności. Skaner przypisuje
 * strony do kohort (market makerzy, statystycznie poinformowani, wieloryby, reszta) i publikuje wyłącznie agregaty:
 *  - kupno/sprzedaż wszystkich fillów kohorty (przepływ netto = zmiana zapasów; suma netto po kohortach = 0),
 *  - kupno/sprzedaż kohorty jako biorcy (agresywne CVD),
 *  - markouty transakcji biorców po klasyfikacji (walidacja poza próbą).
 * Prywatność (sumy kohort są publiczne — suma wszystkich kohort to wolumen z taśmy):
 *  - publikowane są tylko zamknięte kubełki; widoczność ustalana raz, przy zamknięciu;
 *  - k-anonimowość z regułą dominacji: komórka z < 5 uczestnikami albo z jednym > 50% obrotu jest ukrywana (null),
 *    a gdy ukryta jest choć jedna — ukrywane są kolejne (najmniejsze), aż suma ukrytych sama spełnia te warunki
 *    (inaczej ukrytą komórkę dałoby się odtworzyć przez odejmowanie od publicznej sumy);
 *  - warstwa biorcy (takerBuy/takerSell) ma własne, takie samo ukrywanie;
 *  - wartości zaokrąglone do 10 tys. USD, liczności do dziesiątek; markouty tylko z w pełni rozliczonych godzin
 *    (ta sama reguła z ukrywaniem wtórnym), bez liczności i nominału, okno = 24 ostatnie sfinalizowane godziny.
 */

export const COHORTS = ['mm', 'informed', 'whale', 'rest'] as const;
export type CohortId = (typeof COHORTS)[number];

export const COHORT_LABEL: Record<CohortId, string> = {
  mm: tr('Market makerzy', 'Market makers'),
  informed: tr('Poinformowani', 'Informed'),
  whale: tr('Wieloryby', 'Whales'),
  rest: tr('Reszta', 'Rest'),
};

/** Zaokrąglenie publikowanych kwot (utrudnia dopasowanie sum do pojedynczych transakcji z publicznej taśmy) */
export const ROUND_USD = 10_000;

export interface CohortCell {
  /** Kupno / sprzedaż wszystkich fillów kohorty (obie strony transakcji), USD */
  buy: number;
  sell: number;
  /** Kupno / sprzedaż kohorty jako biorcy płynności (agresor), USD; null = warstwa biorcy ukryta */
  takerBuy: number | null;
  takerSell: number | null;
}

export interface CohortTotal {
  buy: number;
  sell: number;
  takerBuy: number;
  takerSell: number;
  /** Ukryte komórki (całe) i ukryte warstwy biorcy w oknie */
  hidden: number;
  takerHidden: number;
}

export interface CohortBucket {
  /** Początek kubełka, ms UTC */
  t: number;
  /** null = ukryte (k-anonimowość) */
  cells: Record<CohortId, CohortCell | null>;
}

/**
 * Markout transakcji biorców kohorty z 24 ostatnich sfinalizowanych godzin — tylko średnie ważone nominałem
 * (bez liczności i nominału: wagi pozwalałyby odtwarzać ukryte godziny z publicznych sum taśmy).
 */
export interface CohortMarkout {
  /** Godziny w oknie: włączone i pominięte (< 5 biorców, dominacja lub ukrywanie wtórne) */
  hours: number;
  hiddenHours: number;
  /** Markout ważony nominałem, bp (dodatni = cena poszła w kierunku transakcji); null = brak danych */
  m1: number | null;
  m5: number | null;
  m60: number | null;
}

/**
 * Wolumen taśmy okna sum i komórki ukryte razem („pozostali razem”). Obie liczby wynikają z publicznej taśmy (suma kohort
 * w kubełku to jej wolumen), więc niczego nie ujawniają; rozbicia ukrytej sumy na kohorty nie da się odtworzyć, bo
 * ukrywanie wtórne zostawia w kubełku co najmniej dwie ukryte komórki, których suma sama spełnia k i dominację.
 */
export interface CohortTape {
  /** Wolumen taśmy w oknie (każda transakcja raz), USD; mianownik udziału kohorty = 2 × wolumen */
  volume: number;
  /** Ukryte komórki razem: kupno/sprzedaż ukrytych komórek, warstwa biorcy ukrytych komórek i ukrytych warstw biorcy */
  hidden: { buy: number; sell: number; takerBuy: number; takerSell: number };
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
  /** Sumy z komórek widocznych (ostatnia godzina = 4 ostatnie zamknięte kubełki) */
  totals: { h1: Record<CohortId, CohortTotal>; h24: Record<CohortId, CohortTotal> };
  /** Wolumen taśmy i ukryte razem w oknach sum; null = okno zawiera kubełki bez zapisanego wolumenu; brak pola = plik sprzed 11.11.2026 */
  tape?: { h1: CohortTape | null; h24: CohortTape | null };
  /** Adresy aktywne w 24 h przypisane do kohorty — w dół do dziesiątek (0 = mniej niż 10), z chwili klasyfikacji */
  members: Record<CohortId, number>;
  /**
   * Klasyfikacja „poinformowanych”: test jednostronny markoutu 5 min, kontrola FDR (Benjamini–Hochberg), empiryczny Bayes.
   * Wybór poniżej 10 kont albo przy τ = 0 nie jest publikowany (selected = 0, konta zostają w swoich kohortach).
   */
  informed: { candidates: number; selected: number; fdrQ: number; minN: number; mu0Bp: number | null; tauBp: number | null; classifiedAt: number | null };
  /** Markouty transakcji biorców wg kohorty w chwili transakcji (klasyfikacja z danych wcześniejszych) — 24 h */
  oos: Record<CohortId, CohortMarkout>;
  kMin: number;
  method: 'hl-cohorts-v1';
}

export const emptyCell = (): CohortCell => ({ buy: 0, sell: 0, takerBuy: 0, takerSell: 0 });

/** Przepływ netto komórki (zmiana zapasów kohorty), USD */
export const netOf = (c: CohortCell) => c.buy - c.sell;
/** Agresywna delta komórki (CVD biorców), USD; null = warstwa biorcy ukryta */
export const takerNetOf = (c: CohortCell): number | null => (c.takerBuy === null || c.takerSell === null ? null : c.takerBuy - c.takerSell);

/** Przepływ netto kohorty w oknie sum (zmiana zapasów), USD */
export const cohortNet = (t: CohortTotal) => t.buy - t.sell;
/** Agresywna delta kohorty w oknie sum (CVD biorców z widocznych warstw biorcy), USD */
export const cohortTakerNet = (t: CohortTotal) => t.takerBuy - t.takerSell;
/** Obrót kohorty w oknie sum (kupno + sprzedaż), USD */
export const cohortVolume = (t: CohortTotal) => t.buy + t.sell;
/** Kohorta ma dane w oknie: widoczne transakcje albo ukryte kubełki; bez nich liczby to „—”, nie zero. */
export const cohortSeen = (t: CohortTotal) => cohortVolume(t) > 0 || t.hidden > 0 || t.takerHidden > 0;

/**
 * Mianownik udziału w obrocie okna: 2 × wolumen taśmy (każda transakcja ma kupującego i sprzedającego). Plik bez wolumenu
 * taśmy: suma widocznych komórek tylko wtedy, gdy w oknie nic nie ukryto (inaczej udział kohorty przy ukrytych pozostałych
 * wychodziłby 1); null = nieznany.
 */
export function shareDenominator(totals: Record<CohortId, CohortTotal>, tape: CohortTape | null | undefined): number | null {
  if (tape) return 2 * tape.volume;
  if (COHORTS.some((c) => totals[c].hidden > 0)) return null;
  return COHORTS.reduce((s, c) => s + cohortVolume(totals[c]), 0);
}

export const HIDDEN_TOGETHER_LABEL = tr('Pozostali razem (ukryte)', 'Others combined (hidden)');

/** Ukryte komórki okna razem jako suma kohorty („pozostali razem”); null = plik bez wolumenu taśmy. */
export function hiddenTogether(tape: CohortTape | null | undefined): CohortTotal | null {
  return tape ? { ...tape.hidden, hidden: 0, takerHidden: 0 } : null;
}

/** Stan kohorty „poinformowanych”: przed pierwszą klasyfikacją, nikogo nie wykryto (pusta, niepublikowana), wykryta. */
export function informedState(flow: Pick<CohortFlow, 'informed'>): 'pending' | 'none' | 'detected' {
  if (flow.informed.classifiedAt === null) return 'pending';
  return flow.informed.selected > 0 ? 'detected' : 'none';
}

/** „Nie wykryto kont z trwałą przewagą (≈ 2630 sprawdzonych)” — liczba kandydatów z pliku (w dół do dziesiątek). */
export function informedNoneText(flow: Pick<CohortFlow, 'informed'>): string {
  const n = flow.informed.candidates;
  const checked = n < 10 ? '< 10' : `≈ ${n}`;
  return tr(`nie wykryto kont z trwałą przewagą (${checked} sprawdzonych)`, `no accounts with a persistent edge detected (${checked} checked)`);
}

/** Koniec okna sum `totals`: koniec ostatniego kubełka w pliku (etykieta „do …” panelu); bez kubełków — null. */
export function cohortWindowEnd(flow: Pick<CohortFlow, 'buckets' | 'bucketMin'>): number | null {
  const last = flow.buckets[flow.buckets.length - 1];
  return last ? last.t + flow.bucketMin * 60_000 : null;
}

/** Skumulowany przepływ netto kohorty po kubełkach (ukryte komórki = 0, oznaczone osobno) */
export function cumulativeNet(flow: CohortFlow, id: CohortId, taker = false): { t: number; v: number; hidden: boolean }[] {
  let acc = 0;
  return flow.buckets.map((b) => {
    const c = b.cells[id];
    const v = c ? (taker ? takerNetOf(c) : netOf(c)) : null;
    if (v !== null) acc += v;
    return { t: b.t, v: acc, hidden: v === null };
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
  !!c &&
  typeof c === 'object' &&
  fin((c as CohortCell).buy) &&
  fin((c as CohortCell).sell) &&
  finOrNull((c as CohortCell).takerBuy) &&
  finOrNull((c as CohortCell).takerSell);
const isTotal = (c: unknown) => {
  const t = c as Partial<CohortTotal> | null;
  return !!t && fin(t.buy) && fin(t.sell) && fin(t.takerBuy) && fin(t.takerSell) && fin(t.hidden) && fin(t.takerHidden);
};
const isTapeOrNull = (t: unknown) => {
  if (t === null) return true;
  const x = t as Partial<CohortTape> | undefined;
  return !!x && fin(x.volume) && !!x.hidden && fin(x.hidden.buy) && fin(x.hidden.sell) && fin(x.hidden.takerBuy) && fin(x.hidden.takerSell);
};
const isRecordOf =(r: unknown, f: (x: unknown) => boolean) => !!r && typeof r === 'object' && COHORTS.every((k) => f((r as Record<string, unknown>)[k]));
const isMarkout = (m: unknown) => {
  const o = m as Partial<CohortMarkout> | null;
  return !!o && fin(o.hours) && fin(o.hiddenHours) && finOrNull(o.m1) && finOrNull(o.m5) && finOrNull(o.m60);
};

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
    (f.tape === undefined || (!!f.tape && isTapeOrNull(f.tape.h1) && isTapeOrNull(f.tape.h24))) &&
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
