/**
 * Kalibracja szansy dużego ruchu kota `cat-cal-v1` (projekt B, zegar ruchu). Ranking `pBig` jest dobry, ale procenty są
 * zaniżone: gdy zmienność rośnie, próg dużego ruchu (mediana zakresu 720 godzin) zostaje w tyle, a dni robocze są
 * ruchliwsze niż weekend. Kalibracja przesuwa logit `pBig` o wartość dopasowaną do rozliczonej przeszłości:
 *  1. zbiór uczący S: pary (prognoza kota, rozstrzygnięcie) z rozstrzygnięciem zapisanym w dzienniku przed wydaniem,
 *     z prognozą z 14 dni przed `t`, bez unieważnionych, z tym samym modelem (`mh`) — filtr modelu i unieważnień robi
 *     wywołujący, okno i kolejność dziennika (`rt` ≤ chwila wydania) — ta funkcja;
 *  2. z_i = logit(clip(pBig_i, 1e-4, 1 − 1e-4));
 *  3. przesunięcie wspólne a: Σ (y_i − σ(z_i + a)) − a / 1,0 = 0 (Newton, 25 kroków od 0), zapis z 6 miejscami;
 *  4. poprawka typu dnia d: to samo po podzbiorze S o typie dnia `t` (weekend = sobota i niedziela UTC według t_i)
 *     z przesunięciem z_i + a (a zapisane) i członem − d / 0,25; pusty podzbiór → d = 0; zapis z 6 miejscami;
 *  5. p = σ(z + clip(a + d, ±1,5)) z wartości zapisanych, 4 miejsca;
 *  6. mniej niż 96 par → brak kalibracji (null).
 * Bez sieci i stanu: ten sam wynik w skanerze, w podsumowaniu i (osobną implementacją) w weryfikatorze.
 */

import { fixedBCrit, neweyWest } from './abTest.ts';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** Epoka bloków oceny liczona od rejestracji planu w dzienniku (rekord `k: 'p'`); tu tylko stałe. */
export const CAT_CAL_DESIGN = {
  id: 'cat-cal-v1',
  question: 'Czy przesunięcie logitu pBig kota dopasowane do rozstrzygnięć z 14 dni (z poprawką typu dnia) daje niższy Brier dużego ruchu niż surowe pBig?',
  model: 'schrodi-v1 (pBig bez zmian), kalibracja w polu cal rekordu kota',
  windowDays: 14,
  pairs: 'prognozy kota z tym samym mh, z rozstrzygnięciem zapisanym w dzienniku przed wydaniem, t - 14 dni <= t_i, bez void',
  logitClip: 1e-4,
  priorVar: { a: 1, d: 0.25 },
  newtonSteps: 25,
  dayType: 'weekend = sobota i niedziela UTC według t prognozy',
  clip: 1.5,
  rounding: 'a i d do 6 miejsc, p = σ(z + clip(a + d)) z wartości zapisanych, do 4 miejsc; d liczone z przesunięciem z_i + a zapisane',
  minPairs: 96,
  metric: 'δ_i = (cal.p − yBig)² − (pBig − yBig)², te same rekordy, bez void',
  blockDays: 14,
  blocksFrom: 'rejestracja planu w dzienniku',
  hacLag: 96,
  kernel: 'bartlett',
  ci: 'fixed-b Kiefer-Vogelsang 2005, 95%',
  minN: 672,
  criteria: {
    main: 'górna granica przedziału Neweya–Westa średniej δ w zakończonym bloku < 0',
    calibration:
      '(a) |średnie cal.p − częstość| ≤ 0,03 w bloku; (b) ≤ 0,05 osobno dla dni roboczych i weekendu, gdy typ ma ≥ 192 rekordy; (c) w 10 decylach cal.p najwyżej 2 poza pasmem 95% (pasmo z losowania dób UTC jak w src/utils/ledgerBootstrap.ts: mulberry32, ziarno 20261111, 1000 losowań, 2,5. i 97,5. percentyl częstości w decylu) i żadne odchylenie średniego p od częstości > 0,10',
    failure: 'dolna granica przedziału δ > 0 w jednym bloku albo brak kryterium głównego w dwóch blokach z rzędu: kalibracja zamknięta',
    promotion: 'oba kryteria w jednym bloku i decyzja właściciela: dopiero wtedy strona pokazuje procent jako szansę',
  },
} as const;

/** Para uczenia: prognoza kota (czas `t`, `pBig`), wynik `yBig` i czas rekordu rozstrzygnięcia w dzienniku `rt`. */
export interface CalPair {
  t: number;
  pBig: number;
  yBig: 0 | 1;
  rt: number;
}

/** Pole `cal` rekordu kota */
export interface CatCal {
  v: 'cat-cal-v1';
  p: number;
  a: number;
  d: number;
  /** Liczność S i podzbioru typu dnia */
  n: number;
  nT: number;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => {
  const e = CAT_CAL_DESIGN.logitClip;
  const q = Math.min(1 - e, Math.max(e, p));
  return Math.log(q / (1 - q));
};
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Weekend UTC (sobota, niedziela): doba 0 to czwartek 1.01.1970 */
export const calWeekend = (t: number): boolean => {
  const dow = (((Math.floor(t / DAY) + 4) % 7) + 7) % 7;
  return dow === 0 || dow === 6;
};

/** Rozwiązanie Σ (y − σ(z + off + x)) − x / v = 0 metodą Newtona, 25 kroków od 0. */
function fitShift(zs: readonly number[], ys: readonly number[], off: number, v: number): number {
  let x = 0;
  for (let k = 0; k < CAT_CAL_DESIGN.newtonSteps; k++) {
    let g = -x / v;
    let h = -1 / v;
    for (let i = 0; i < zs.length; i++) {
      const s = sigmoid(zs[i] + off + x);
      g += ys[i] - s;
      h -= s * (1 - s);
    }
    x -= g / h;
  }
  return x;
}

/**
 * Kalibracja prognozy kota z czasu `at.t` wydanej w chwili `at.ti` (surowe `pBig`); mniej niż 96 par w S → null.
 */
export function catCal(pairs: readonly CalPair[], at: { t: number; ti: number }, pBig: number): CatCal | null {
  const from = at.t - CAT_CAL_DESIGN.windowDays * DAY;
  const s = pairs.filter((x) => x.rt <= at.ti && x.t >= from && x.t < at.t && (x.yBig === 0 || x.yBig === 1) && Number.isFinite(x.pBig));
  if (s.length < CAT_CAL_DESIGN.minPairs) return null;
  const zs = s.map((x) => logit(x.pBig));
  const ys = s.map((x) => x.yBig);
  const a = r6(fitShift(zs, ys, 0, CAT_CAL_DESIGN.priorVar.a));
  const we = calWeekend(at.t);
  const idx = s.map((x, i) => (calWeekend(x.t) === we ? i : -1)).filter((i) => i >= 0);
  const d = idx.length ? r6(fitShift(idx.map((i) => zs[i]), idx.map((i) => ys[i]), a, CAT_CAL_DESIGN.priorVar.d)) : 0;
  const shift = Math.max(-CAT_CAL_DESIGN.clip, Math.min(CAT_CAL_DESIGN.clip, a + d));
  return { v: 'cat-cal-v1', p: r4(sigmoid(logit(pBig) + shift)), a, d, n: s.length, nT: idx.length };
}

/** Rekord oceny: prognoza kota z polem `cal` i jej rozstrzygnięcie (bez unieważnionych) */
export interface CalRow {
  slot: number;
  t: number;
  /** cal.p i surowe pBig */
  p: number;
  raw: number;
  y: 0 | 1;
}

export interface CalGroup {
  n: number;
  meanP: number | null;
  freq: number | null;
}

/**
 * Rozliczenie kalibracji w podsumowaniu (`cat.cal`): okno podsumowania (30 dni) — Brier cal.p i surowego pBig na tych
 * samych rekordach, średnie p i częstość, osobno dni robocze i weekend, decyle cal.p; `block` — ostatni zakończony blok
 * 14 dni od rejestracji planu z różnicą średniej δ = (cal.p − y)² − (pBig − y)² i 95% przedziałem Neweya–Westa (fixed-b),
 * od 672 rekordów. W bloku w toku przedziału nie ma (wynik tylko w zakończonym bloku, jak w planie).
 */
export interface CalSummary {
  plan: { at: number; hash: string };
  n: number;
  brier: number | null;
  brierRaw: number | null;
  meanP: number | null;
  freq: number | null;
  byType: { weekday: CalGroup; weekend: CalGroup };
  deciles: ({ lo: number; hi: number } & CalGroup)[];
  block: { start: number; end: number; n: number; diff: { mean: number; lo: number; hi: number } | null } | null;
}

/** Zapas po końcu bloku na rozstrzygnięcia: horyzont 60 min + unieważnienie po 6 h + 15 min (jak ocena A/B) */
const CAL_GRACE = (60 + 6 * 60 + 15) * MIN;

const group = (rs: readonly CalRow[]): CalGroup =>
  rs.length ? { n: rs.length, meanP: rs.reduce((s, x) => s + x.p, 0) / rs.length, freq: rs.reduce((s, x) => s + x.y, 0) / rs.length } : { n: 0, meanP: null, freq: null };

export function calSummary(rows: readonly CalRow[], plan: { at: number; hash: string }, now: number): CalSummary {
  const win = rows.filter((r) => r.t >= now - 30 * DAY);
  const brier = (k: 'p' | 'raw') => (win.length ? win.reduce((s, x) => s + (x[k] - x.y) ** 2, 0) / win.length : null);
  const all = group(win);
  const deciles = Array.from({ length: 10 }, (_, i) => {
    const lo = i / 10;
    const hi = (i + 1) / 10;
    return { lo, hi, ...group(win.filter((x) => x.p >= lo && (i === 9 ? x.p <= hi : x.p < hi))) };
  });
  const len = CAT_CAL_DESIGN.blockDays * DAY;
  const k = Math.floor((now - CAL_GRACE - plan.at) / len);
  let block: CalSummary['block'] = null;
  if (k >= 1) {
    const start = plan.at + (k - 1) * len;
    const end = start + len;
    const bs = rows.filter((r) => r.t >= start && r.t < end);
    const pts = bs.map((r) => ({ slot: r.slot, d: (r.p - r.y) ** 2 - (r.raw - r.y) ** 2 }));
    const est = bs.length >= CAT_CAL_DESIGN.minN ? neweyWest(pts, CAT_CAL_DESIGN.hacLag) : null;
    const c = est ? fixedBCrit((CAT_CAL_DESIGN.hacLag + 1) / bs.length) : 0;
    block = { start, end, n: bs.length, diff: est ? { mean: est.mean, lo: est.mean - c * est.se, hi: est.mean + c * est.se } : null };
  }
  return {
    plan,
    n: win.length,
    brier: brier('p'),
    brierRaw: brier('raw'),
    meanP: all.meanP,
    freq: all.freq,
    byType: { weekday: group(win.filter((x) => !calWeekend(x.t))), weekend: group(win.filter((x) => calWeekend(x.t))) },
    deciles,
    block,
  };
}
