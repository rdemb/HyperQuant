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

/** Częstość dużego ruchu w rozliczeniach rejestru przy danym poziomie */
export interface LevelFreq {
  /** Częstość (0–1) */
  freq: number;
  /** Ta sama częstość zaokrąglona do „X na 10” */
  tenths: number;
  /** Liczba rozstrzygniętych prognoz w tercylu (zaokrąglona) */
  n: number;
}

/**
 * Częstość dużego ruchu w rozstrzygniętych prognozach z przedziału `pBig` danego tercyla, z tego samego histogramu co
 * tercyle (`n` i `freq` koszyków). Koszyk tylko częściowo w przedziale wnosi część swoich prognoz proporcjonalną do
 * nakładającej się szerokości (to samo założenie o równomiernym rozkładzie w koszyku co przy interpolacji granic
 * tercyli), a jego `freq` waży się tą samą częścią `n`. Brak koszyków z `freq` w przedziale → null.
 */
export function levelFreq(bins: readonly ReliabilityBin[] | null | undefined, t: MoveTerciles, level: MoveLevel): LevelFreq | null {
  const [a, b] = level === 'calm' ? [-Infinity, t.q1] : level === 'typical' ? [t.q1, t.q2] : [t.q2, Infinity];
  let w = 0;
  let wf = 0;
  for (const bin of bins ?? []) {
    if (!(bin.n > 0) || bin.freq === null || !Number.isFinite(bin.freq) || !(bin.hi > bin.lo)) continue;
    const share = Math.max(0, Math.min(bin.hi, b) - Math.max(bin.lo, a)) / (bin.hi - bin.lo);
    w += bin.n * share;
    wf += bin.n * share * bin.freq;
  }
  if (!(w > 0)) return null;
  const freq = wf / w;
  return { freq, tenths: Math.round(freq * 10), n: Math.round(w) };
}

/**
 * „X na 10” z częstości: przy części ułamkowej `freq × 10` od 0,3 do 0,7 zakres („6–7”), żeby liczba nie skakała
 * między sąsiednimi dziesiątkami przy każdej aktualizacji podsumowania; poza tym zaokrąglenie.
 */
export function tenthsText(freq: number): string {
  const x = Math.min(10, Math.max(0, freq * 10));
  const lo = Math.floor(x);
  const frac = x - lo;
  return lo < 10 && frac >= 0.3 && frac <= 0.7 ? `${lo}–${lo + 1}` : String(Math.round(x));
}

/**
 * Zdanie pod poziomem w dymku: częstość dużego ruchu przy tym poziomie w rozliczeniach rejestru. Jednostką są prognozy
 * (co 15 min, okna 60 min się nakładają), nie rozłączne godziny, więc „przypadków” i liczba prognoz.
 */
export const levelFreqLine = (f: LevelFreq): string =>
  tr(
    `W rejestrze przy tym poziomie duży ruch był w ${tenthsText(f.freq)} na 10 przypadków (${f.n} prognoz z rejestru).`,
    `In the ledger, at this level a big move happened in ${tenthsText(f.freq)} of 10 cases (${f.n} forecasts from the ledger).`
  );

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
export type MoveView = { kind: 'level'; level: MoveLevel; terciles: MoveTerciles; freq: LevelFreq | null } | { kind: 'none'; reason: string };

export function moveView(pBig: number, cat: CatSection | null | undefined): MoveView {
  if (!cat) return { kind: 'none', reason: tr('brak podsumowania rejestru', 'no ledger summary') };
  const bins = cat.scores.big.reliability;
  const t = moveTerciles(bins);
  if (!t) return { kind: 'none', reason: moveNoDataReason((bins ?? []).reduce((s, b) => s + (Number.isFinite(b.n) ? b.n : 0), 0)) };
  const level = moveLevel(pBig, t);
  return { kind: 'level', level, terciles: t, freq: levelFreq(bins, t, level) };
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
