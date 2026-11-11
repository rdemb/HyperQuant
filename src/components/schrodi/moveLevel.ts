import { tr } from '../../i18n';
import type { DeskLedgerSummary, ReliabilityBin } from '../../utils/deskLedger';

/**
 * Szansa dużego ruchu kota przed awansem kalibracji `cat-cal-v1`. Ranking `pBig` jest dobry (AUC w rejestrze), ale
 * procenty są zaniżone (w rejestrze średnie p ok. 0,50 wobec częstości ok. 0,58), więc do awansu kot nie pokazuje
 * procentu, tylko poziom wobec typowej godziny: tercyl `pBig` w rozstrzygniętych prognozach z rejestru.
 *
 * Źródło tercyli: histogram `cat.scores.big.reliability` z publicznego podsumowania rejestru (10 koszyków szerokości
 * 0,1, rozstrzygnięte prognozy z okna podsumowania, 30 dni), który strona już czyta. Granice tercyli interpolowane
 * liniowo w koszyku. Mniej niż 96 rozstrzygnięć: poziomu nie ma („—” z powodem).
 */

/**
 * Jedyne miejsce przełączenia. `false` = przed awansem: poziom bez procentu. Po awansie `cat-cal-v1` (wynik w rejestrze
 * i decyzja właściciela) ustawić `true`: wracają procenty szansy dużego ruchu.
 */
export const MOVE_PCT_PROMOTED = false;

/** Minimum rozstrzygnięć do tercyli (to samo minimum co dla kalibracji `cat-cal-v1`) */
export const MOVE_MIN_N = 96;

export type MoveLevel = 'calm' | 'typical' | 'elevated';

export interface MoveTerciles {
  /** Granice tercyli `pBig` */
  q1: number;
  q2: number;
  /** Liczba rozstrzygniętych prognoz w histogramie */
  n: number;
}

/** Granice tercyli z histogramu koszyków (interpolacja liniowa w koszyku); za mało danych → null. */
export function moveTerciles(bins: readonly ReliabilityBin[] | null | undefined): MoveTerciles | null {
  const bs = (bins ?? []).filter((b) => Number.isFinite(b.n) && b.n > 0 && Number.isFinite(b.lo) && Number.isFinite(b.hi)).sort((a, b) => a.lo - b.lo);
  const n = bs.reduce((s, b) => s + b.n, 0);
  if (n < MOVE_MIN_N) return null;
  const cut = (target: number): number => {
    let cum = 0;
    for (const b of bs) {
      if (cum + b.n >= target) return b.lo + ((target - cum) / b.n) * (b.hi - b.lo);
      cum += b.n;
    }
    return bs[bs.length - 1].hi;
  };
  return { q1: cut(n / 3), q2: cut((2 * n) / 3), n };
}

/** Poziom szansy wobec tercyli: dolny tercyl = spokojny, środkowy = zwykły, górny = podwyższony */
export const moveLevel = (pBig: number, t: MoveTerciles): MoveLevel => (pBig < t.q1 ? 'calm' : pBig < t.q2 ? 'typical' : 'elevated');

/** Słowo poziomu przy „ruch” (pasek: „ruch zwykły”, EN „move typical”) */
export const moveLevelWord = (l: MoveLevel): string =>
  l === 'calm' ? tr('spokojny', 'calm') : l === 'typical' ? tr('zwykły', 'typical') : tr('podwyższony', 'elevated');

/** Zdanie o kalibracji obok poziomu */
export const moveCalNote = (): string => tr('Procenty w trakcie kalibracji, wynik w rejestrze.', 'Percentages under calibration, results in the ledger.');

/** Powód braku poziomu */
export const moveNoDataReason = (n: number): string =>
  tr(`za mało rozstrzygnięć w rejestrze (${n} z ${MOVE_MIN_N})`, `too few resolved forecasts in the ledger (${n} of ${MOVE_MIN_N})`);

type CatSection = NonNullable<DeskLedgerSummary['cat']>;

/** Stan szansy ruchu do wyświetlenia przed awansem: poziom z tercyli albo brak z powodem */
export type MoveView = { kind: 'level'; level: MoveLevel; terciles: MoveTerciles } | { kind: 'none'; reason: string };

export function moveView(pBig: number, cat: CatSection | null | undefined): MoveView {
  if (!cat) return { kind: 'none', reason: tr('brak podsumowania rejestru', 'no ledger summary') };
  const bins = cat.scores.big.reliability;
  const t = moveTerciles(bins);
  if (!t) return { kind: 'none', reason: moveNoDataReason((bins ?? []).reduce((s, b) => s + (Number.isFinite(b.n) ? b.n : 0), 0)) };
  return { kind: 'level', level: moveLevel(pBig, t), terciles: t };
}

/**
 * Poziom do nastroju i zdania kota: po awansie z progów procentowych (jak przed kalibracją), przed awansem z tercyli;
 * brak danych → null (kot bez twierdzenia o ruchu).
 */
export function moodLevel(pBig: number, cat: CatSection | null | undefined): MoveLevel | null {
  if (MOVE_PCT_PROMOTED) return pBig >= 0.7 ? 'elevated' : pBig <= 0.25 ? 'calm' : 'typical';
  const v = moveView(pBig, cat);
  return v.kind === 'level' ? v.level : null;
}

/** AUC dużego ruchu z rejestru jako dowód rankingu (od 20 rozłącznych godzin), inaczej null */
export const moveAuc = (cat: CatSection | null | undefined): number | null =>
  cat && cat.scores.nEff >= 20 && cat.scores.big.auc !== null && Number.isFinite(cat.scores.big.auc) ? cat.scores.big.auc : null;
