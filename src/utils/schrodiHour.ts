import { type Bar, type Tree, sigmoid, treeSum } from './schrodi.ts';

/**
 * Schrödi, godzina na żywo (`public/schrodi/hour-v1.json`): szansa dużego ruchu i wzrostu w bieżącej pełnej godzinie,
 * przeliczana po każdej minucie z drogi ceny od początku godziny i prognozy kota z jej początku. Trzy głowy LightGBM
 * z ograniczeniami monotonicznymi i kalibracją Platta (ostatnie 90 dni przed eksportem):
 *  - `big`: duży ruch z drogi ceny i prognozy kota z początku godziny,
 *  - `bigRule`: duży ruch z samej drogi ceny (reguła, z którą kot jest porównywany w dzienniku),
 *  - `dir`: wzrost z samej drogi ceny (prognoza kota z początku godziny nic tu nie dodaje, docs/SCHRODI.md).
 * Cechy po m pełnych minutach w jednostkach progu dużego ruchu (mediana zakresu godziny z 30 dni).
 */

export const HOUR_FEATURES = ['m', 'rr', 'up', 'dn', 'rv', 'ret', 'l0b', 'l0d'] as const;
export type HourFeature = (typeof HOUR_FEATURES)[number];
export type HourX = Record<HourFeature, number>;

export interface HourHead {
  features: HourFeature[];
  /** Drzewa bez wartości węzłów wewnętrznych */
  gb: Pick<Tree, 'f' | 't' | 'm' | 'l' | 'r' | 'lv'>[];
  /** Kalibracja Platta: p = σ(a · logit(p_drzew) + b) */
  platt: [number, number];
}

export interface HourModel {
  version: string;
  trainedTo: string;
  calibratedTo: string;
  heads: { big: HourHead; bigRule: HourHead; dir: HourHead };
  card: Record<string, unknown>;
}

const MIN = 60_000;
const HOUR = 3_600_000;

/** logit z obcięciem p do [eps, 1 − eps] */
export const logit = (p: number, eps: number) => {
  const q = Math.min(1 - eps, Math.max(eps, p));
  return Math.log(q / (1 - q));
};

/**
 * Cechy po `mins.length` pełnych minutach godziny (1 do 59): zakres do teraz (`rr`), odległość ceny od maksimum (`up`)
 * i minimum (`dn`), zmiana od początku (`ret`), zmienność minutowa (`rv`), logit prognoz kota z początku godziny.
 * `c0` = cena na początku godziny, `thr` = próg dużego ruchu (pb, log).
 */
export function hourX(c0: number, thr: number, p0b: number, p0d: number, mins: readonly { h: number; l: number; c: number }[]): HourX | null {
  const m = mins.length;
  if (m < 1 || m > 59 || !(c0 > 0) || !(thr > 0)) return null;
  let hi = -Infinity;
  let lo = Infinity;
  let s2 = 0;
  let prev = c0;
  for (const b of mins) {
    if (!(b.h > 0 && b.l > 0 && b.c > 0)) return null;
    hi = Math.max(hi, b.h);
    lo = Math.min(lo, b.l);
    s2 += Math.log(b.c / prev) ** 2;
    prev = b.c;
  }
  const k = 1e4 / thr;
  return {
    m,
    rr: Math.log(hi / lo) * k,
    up: Math.log(hi / prev) * k,
    dn: Math.log(prev / lo) * k,
    rv: (Math.sqrt(s2) * k) / Math.sqrt(m),
    ret: Math.log(prev / c0) * k,
    l0b: logit(p0b, 1e-4),
    l0d: logit(p0d, 1e-4),
  };
}

const headP = (h: HourHead, x: HourX) => sigmoid(h.platt[0] * logit(sigmoid(treeSum(h.gb, h.features.map((f) => x[f]))), 1e-6) + h.platt[1]);

export interface HourProbs {
  /** Duży ruch w tej godzinie: kot (droga ceny + prognoza z początku godziny) */
  pBig: number;
  /** Duży ruch z samej drogi ceny */
  pBigRule: number;
  /** Wzrost w tej godzinie (zamknięcie wyżej niż cena z jej początku), z samej drogi ceny */
  pUp: number;
}

/** Szanse z cech; zakres już ponad progiem → duży ruch pewny (1). */
export function hourProbs(model: HourModel, x: HourX): HourProbs {
  const done = x.rr > 1;
  return {
    pBig: done ? 1 : headP(model.heads.big, x),
    pBigRule: done ? 1 : headP(model.heads.bigRule, x),
    pUp: headP(model.heads.dir, x),
  };
}

/** Pełne minuty godziny `hs` przed chwilą `end` (bez dziur); brak którejś minuty → null */
export function hourMinutes(m1: readonly Bar[], hs: number, end: number): Bar[] | null {
  const out = m1.filter((b) => b.t >= hs && b.t + MIN <= end && b.t < hs + HOUR);
  const n = Math.min(60, Math.floor((end - hs) / MIN));
  return out.length === n && out.every((b, i) => b.t === hs + i * MIN) ? out : null;
}

/** Punkt wykresu godziny: szanse po m minutach */
export interface HourPoint extends HourProbs {
  m: number;
}

/**
 * Godzina na żywo: szanse po każdej pełnej minucie od początku godziny do `end` (minuta w trakcie liczona jak zamknięta,
 * jak w kocie na żywo). Start (m = 0) to prognoza kota z początku godziny. Brak minut albo progu → null.
 */
export function hourPath(model: HourModel, m1: readonly Bar[], start: { hs: number; c0: number; thr: number; pBig: number; pUp: number }, end: number): HourPoint[] | null {
  const mins = hourMinutes(m1, start.hs, end);
  if (!mins) return null;
  const pts: HourPoint[] = [{ m: 0, pBig: start.pBig, pBigRule: NaN, pUp: start.pUp }];
  for (let m = 1; m <= Math.min(59, mins.length); m++) {
    const x = hourX(start.c0, start.thr, start.pBig, start.pUp, mins.slice(0, m).map((b) => ({ h: b.h, l: b.l, c: b.c })));
    if (!x) return null;
    pts.push({ m, ...hourProbs(model, x) });
  }
  return pts;
}
