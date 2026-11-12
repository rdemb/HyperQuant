/**
 * Prognoza `hrel-v1` (projekt B, zegar ruchu): szansa dużego ruchu „jak na tę godzinę” dla czterech kolejnych godzin UTC.
 * Wszystko ze świec 1h BTC Hyperliquid, godziny UTC:
 *  1. zakres godziny u (początek pełnej godziny): rng(u) = ln(high / low) × 10⁴;
 *  2. typ dnia: weekend, gdy początek godziny wypada w sobotę albo niedzielę UTC; inaczej dzień roboczy;
 *  3. próg thr(u): mediana rng tej samej godziny UTC z 20 ostatnich wcześniejszych dni tego samego typu, dla których jest
 *     świeca; szukane najwyżej 80 dni wstecz; mniej niż 20 → brak progu;
 *  4. zdarzenie: y(u) = 1, gdy rng(u) > thr(u); baza to stałe 50%;
 *  5. cechy w chwili hs (tylko świece zamknięte do hs): z(u) = clip(ln(rng(u) / thr(u)), ±1,5), przy rng = 0 → −1,5;
 *     r1 = z(hs − 1 h), r3 = średnia z z 3 godzin przed hs, r24 = średnia z z 24 godzin przed hs; brak którejkolwiek
 *     z 24 świec albo progu → brak prognozy; cechy zapisane z 6 miejscami;
 *  6. szanse godzin hs + j h (j = 0..3): p_j = σ(w_j0 + w_j1·r1 + w_j2·r3 + w_j3·r24) z cech zapisanych, 4 miejsca.
 * Wagi z uczenia na latach 2020–2023 (świece Binance), bez późniejszego strojenia; zmiana wag albo definicji = nowy plan
 * i nowa nazwa modelu. Bez sieci i stanu: ten sam wynik w skanerze, w podsumowaniu i (osobną implementacją) w weryfikatorze.
 * Logistyczna regresja trwałości zmienności: Andersen, Bollerslev (1997), Journal of Empirical Finance 4 — sezonowość
 * zmienności w ciągu doby; Corsi (2009), Journal of Financial Econometrics 7 — składowe 1, 3 i 24 okresów (HAR).
 */

import { neweyWest } from './abTest.ts';
import { auc } from './forecastScore.ts';
import { type SkillCi, type DaySum, addDaySum, daySkillCi } from './ledgerBootstrap.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Wagi [w0, w1 (r1), w2 (r3), w3 (r24)] dla wyprzedzeń j = 0..3 */
export const HREL_WEIGHTS = [
  [-0.1329, 0.7038, 0.8185, 1.7707],
  [-0.1286, 0.3314, 0.7581, 1.9449],
  [-0.1267, 0.2062, 0.6896, 2.0109],
  [-0.1251, 0.231, 0.5441, 2.0417],
] as const;

export const HREL_MODEL = 'hrel-logit-v1';

/** Plan prerejestrowany w dzienniku (rekord `k: 'p'`); epoka bloków = rejestracja planu. Zmiana = nowy identyfikator. */
export const HREL_DESIGN = {
  id: 'hrel-v1',
  question: 'Czy szanse dużego ruchu jak na tę godzinę z modelu trwałości zmienności mają niższy Brier niż stała 50% (wyprzedzenie 1 h)?',
  model: HREL_MODEL,
  data: 'świece 1h BTC Hyperliquid (candleSnapshot, interwał 1h), godziny UTC',
  range: 'rng(u) = ln(high / low) × 10^4, u = początek pełnej godziny UTC',
  dayType: 'weekend = sobota i niedziela UTC według początku godziny, inaczej dzień roboczy',
  threshold: 'thr(u) = mediana rng tej samej godziny UTC z 20 ostatnich wcześniejszych dni tego samego typu, dla których jest świeca; szukane najwyżej 80 dni wstecz; mniej niż 20 → brak progu',
  thresholdDays: 20,
  lookbackDays: 80,
  event: 'y(u) = 1, gdy rng(u) > thr(u); rng i thr zapisane z 4 miejscami, y z wartości zapisanych',
  base: 0.5,
  features: 'z(u) = clip(ln(rng(u) / thr(u)), −1,5, +1,5), rng = 0 → −1,5; r1 = z(hs − 1 h), r3 = średnia z z 3 godzin przed hs, r24 = średnia z z 24 godzin przed hs; tylko świece zamknięte do hs; brak którejkolwiek z 24 świec albo progu → brak prognozy; 6 miejsc',
  zClip: 1.5,
  probs: 'p_j = σ(w_j0 + w_j1 × r1 + w_j2 × r3 + w_j3 × r24) z cech zapisanych, 4 miejsca; godzina docelowa hs + j h, j = 0..3',
  weights: HREL_WEIGHTS,
  weightsFrom: 'uczenie 2020–2023, bez późniejszego strojenia',
  record: '{ k: f, kind: hrel, id: <hs>-hrel, slot, ti, t: hs, x: [r1, r3, r24], thr: [thr(hs + j h)], p: [p0..p3], model, plan }',
  issue: 'raz na godzinę, w pierwszym slocie dziennika po hs, razem z prognozami głównymi slotu; rekord zapisany później niż hs + 15 min nie powstaje; bez uzupełniania wstecz',
  maxLateMin: 15,
  resolution: 'po zamknięciu godziny hs + 3 h, ze świec 1h: { k: r, id, t, rng: [4], y: [4] }; brak świecy godziny u → null w rng i y tej godziny, a brak wszystkich czterech → void, oba tylko 6 h po hs + 4 h i tylko wtedy, gdy źródło zwróciło świecę późniejszą niż u (przerwa źródła nie jest brakiem — rozstrzygnięcie czeka na świece)',
  metric: 'δ = (p_j − y)² − (0,5 − y)² na każdej rozstrzygniętej godzinie',
  stat: 't = średnia δ / błąd Neweya–Westa (jądro Bartletta, 24 opóźnienia godzinowe)',
  hacLag: 24,
  kernel: 'bartlett',
  blockDays: 14,
  blocksFrom: 'rejestracja planu w dzienniku; godzina należy do bloku według hs',
  minN: 300,
  quintiles: 'rozstrzygnięte godziny bloku posortowane rosnąco po p (remisy według hs), pięć grup: od floor(k·n/5) do floor((k+1)·n/5)',
  criteria: {
    main: 'wyprzedzenie 1 h: t < −2,24 po bloku 1 albo na danych łącznych bloków 1–2 po bloku 2 (dwa spojrzenia po 1,25% jednostronnie, łącznie 2,5%)',
    calibration: 'wyprzedzenie 1 h, te same dane co kryterium główne: |średnie p − częstość| ≤ 0,07 oraz największe odchylenie średniego p od częstości w pięciu kwintylach ≤ 0,18',
    failure: 't > +1,96 w którymkolwiek spojrzeniu albo brak kryterium głównego po bloku 2: prognoza zamknięta, wynik zostaje w dzienniku',
    descriptive: 'wyprzedzenia 0, 2 i 3 h; godziny okien handlu w dni robocze; dni po zmianie czasu — bez wpływu na wynik',
    promotion: 'oba kryteria spełnione i decyzja właściciela: dopiero wtedy liczba trafia na stronę i do odprawy',
  },
} as const;

/** Świeca 1h: początek godziny UTC (ms), maksimum i minimum */
export interface HourBar {
  t: number;
  h: number;
  l: number;
}

/** Świece według początku godziny (ostatnia wersja świecy wygrywa) */
export type HourIndex = ReadonlyMap<number, HourBar>;

export const hourIndex = (bars: Iterable<HourBar>): Map<number, HourBar> => {
  const m = new Map<number, HourBar>();
  for (const b of bars) if (b.t % HOUR === 0 && Number.isFinite(b.h) && Number.isFinite(b.l) && b.l > 0 && b.h >= b.l) m.set(b.t, b);
  return m;
};

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Weekend UTC (sobota, niedziela): doba 0 to czwartek 1.01.1970 */
export const hrelWeekend = (t: number): boolean => {
  const dow = (((Math.floor(t / DAY) + 4) % 7) + 7) % 7;
  return dow === 0 || dow === 6;
};

/** Zakres godziny w pb (log) */
export const hrelRange = (b: HourBar): number => Math.log(b.h / b.l) * 1e4;

/** Próg godziny `u`: mediana zakresu tej samej godziny z 20 wcześniejszych dni tego samego typu (do 80 dni wstecz) */
export function hrelThreshold(candles: HourIndex, u: number): number | null {
  const we = hrelWeekend(u);
  const xs: number[] = [];
  for (let k = 1; k <= HREL_DESIGN.lookbackDays && xs.length < HREL_DESIGN.thresholdDays; k++) {
    const v = u - k * DAY;
    if (hrelWeekend(v) !== we) continue;
    const b = candles.get(v);
    if (b) xs.push(hrelRange(b));
  }
  if (xs.length < HREL_DESIGN.thresholdDays) return null;
  xs.sort((a, b) => a - b);
  return (xs[9] + xs[10]) / 2;
}

/** z(u) = clip(ln(rng / thr), ±1,5); rng = 0 → −1,5; brak świecy albo progu → null */
function zOf(candles: HourIndex, u: number): number | null {
  const b = candles.get(u);
  const thr = hrelThreshold(candles, u);
  if (!b || thr === null) return null;
  const rng = hrelRange(b);
  if (!(rng > 0)) return -HREL_DESIGN.zClip;
  return Math.max(-HREL_DESIGN.zClip, Math.min(HREL_DESIGN.zClip, Math.log(rng / thr)));
}

/** Cechy [r1, r3, r24] (6 miejsc) z 24 godzin przed `hs`; `hs` poza pełną godziną albo brak danych → null */
export function hrelFeatures(candles: HourIndex, hs: number): { x: [number, number, number] } | null {
  if (hs % HOUR !== 0) return null;
  const z: number[] = [];
  for (let k = 1; k <= 24; k++) {
    const v = zOf(candles, hs - k * HOUR);
    if (v === null) return null;
    z.push(v);
  }
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  return { x: [r6(z[0]), r6(mean(z.slice(0, 3))), r6(mean(z))] };
}

/** Szanse p_0..p_3 (4 miejsca) z cech zapisanych */
export function hrelProbs(x: readonly number[]): number[] {
  return HREL_WEIGHTS.map((w) => r4(sigmoid(w[0] + w[1] * x[0] + w[2] * x[1] + w[3] * x[2])));
}

/** Prognoza z chwili `hs`: cechy, progi godzin docelowych (4 miejsca) i szanse; brak cech albo progu → null */
export function hrelForecast(candles: HourIndex, hs: number): { x: number[]; thr: number[]; p: number[] } | null {
  const f = hrelFeatures(candles, hs);
  if (!f) return null;
  const thr: number[] = [];
  for (let j = 0; j < 4; j++) {
    const v = hrelThreshold(candles, hs + j * HOUR);
    if (v === null) return null;
    thr.push(r4(v));
  }
  return { x: f.x, thr, p: hrelProbs(f.x) };
}

/** Wynik: zakresy godzin docelowych (4 miejsca) i y = [rng > thr] z wartości zapisanych; brak świecy → null */
export function hrelOutcome(candles: HourIndex, hs: number, thr: readonly number[]): { rng: (number | null)[]; y: (0 | 1 | null)[] } {
  const rng = thr.map((_, j) => {
    const b = candles.get(hs + j * HOUR);
    return b ? r4(hrelRange(b)) : null;
  });
  return { rng, y: rng.map((v, j) => (v === null ? null : v > thr[j] ? 1 : 0)) };
}

/** Rekord oceny: chwila hs, szanse i wyniki czterech godzin (null = brak świecy albo brak rozstrzygnięcia) */
export interface HrelRow {
  t: number;
  p: readonly number[];
  y: readonly (0 | 1 | null)[];
}

export interface HrelGroup {
  n: number;
  meanP: number | null;
  freq: number | null;
}

export interface HrelLead extends HrelGroup {
  /** Wyprzedzenie w godzinach (0 = godzina, która się zaczyna) */
  j: number;
  brier: number | null;
  /** BSS wobec stałej 0,5 z przedziałem z bootstrapu po dobach UTC godziny docelowej */
  bss: SkillCi;
  auc: number | null;
  quintiles: HrelGroup[];
}

/** Blok oceny (wyprzedzenie 1 h): δ = (p − y)² − (0,5 − y)², t Neweya–Westa (24 opóźnienia), kalibracja */
export interface HrelBlock extends HrelGroup {
  start: number;
  end: number;
  mean: number | null;
  se: number | null;
  /** null — mniej niż 300 rozstrzygniętych godzin albo zerowa wariancja */
  t: number | null;
  /** Największe |średnie p − częstość| w pięciu kwintylach */
  maxQDev: number | null;
}

export interface HrelSummary {
  plan: { at: number; hash: string };
  /** Okno miar opisowych (dni) */
  days: number;
  leads: HrelLead[];
  /** Zakończone bloki 14 dni od rejestracji planu (wyprzedzenie 1 h) */
  blocks: HrelBlock[];
  /** Dane łączne bloków 1–2 (drugie spojrzenie) — po zakończeniu bloku 2 */
  pooled: HrelBlock | null;
  latest: { t: number; x: number[]; thr: number[]; p: number[] } | null;
}

/** Zapas po końcu bloku: ostatnia godzina docelowa (hs + 4 h) + unieważnienie po 6 h + 15 min */
export const HREL_GRACE = 4 * HOUR + 6 * HOUR + 15 * MIN;
const WINDOW_DAYS = 30;

const group = (pp: readonly { p: number; y: 0 | 1 }[]): HrelGroup =>
  pp.length ? { n: pp.length, meanP: pp.reduce((s, x) => s + x.p, 0) / pp.length, freq: pp.reduce((s, x) => s + x.y, 0) / pp.length } : { n: 0, meanP: null, freq: null };

/** Kwintyle: rosnąco po p (stabilnie — remisy w kolejności hs), grupy od floor(k·n/5) do floor((k+1)·n/5) */
function quintiles(pp: readonly { t: number; p: number; y: 0 | 1 }[]): HrelGroup[] {
  const s = [...pp].sort((a, b) => a.p - b.p || a.t - b.t);
  return Array.from({ length: 5 }, (_, k) => group(s.slice(Math.floor((k * s.length) / 5), Math.floor(((k + 1) * s.length) / 5))));
}

function block(rows: readonly HrelRow[], start: number, end: number): HrelBlock {
  const pp = rows.filter((r) => r.t >= start && r.t < end && r.y[1] !== null).map((r) => ({ t: r.t, p: r.p[1], y: r.y[1] as 0 | 1 }));
  const nw = pp.length >= HREL_DESIGN.minN ? neweyWest(pp.map((x) => ({ slot: x.t, d: (x.p - x.y) ** 2 - (HREL_DESIGN.base - x.y) ** 2 })), HREL_DESIGN.hacLag, HOUR) : null;
  const mean = pp.length ? pp.reduce((s, x) => s + (x.p - x.y) ** 2 - (HREL_DESIGN.base - x.y) ** 2, 0) / pp.length : null;
  const qs = quintiles(pp);
  return {
    start,
    end,
    ...group(pp),
    mean,
    se: nw ? nw.se : null,
    t: nw ? nw.mean / nw.se : null,
    maxQDev: pp.length >= 5 ? Math.max(...qs.map((q) => Math.abs(q.meanP! - q.freq!))) : null,
  };
}

/**
 * Rozliczenie `hrel-v1` w podsumowaniu: dla każdego wyprzedzenia z 30 dni — liczność, Brier, BSS wobec 0,5 z przedziałem,
 * AUC, średnie p i częstość, kwintyle; dla wyprzedzenia 1 h zakończone bloki 14 dni od rejestracji planu i dane łączne
 * bloków 1–2 (statystyka t i kalibracja z planu). Werdykt według kryteriów planu wydaje człowiek, nie ta funkcja.
 */
export function hrelSummary(rows: readonly HrelRow[], plan: { at: number; hash: string }, now: number, latest: HrelSummary['latest']): HrelSummary {
  const from = now - WINDOW_DAYS * DAY;
  const win = rows.filter((r) => r.t >= from);
  const leads = [0, 1, 2, 3].map((j): HrelLead => {
    const pp = win.filter((r) => r.y[j] !== null).map((r) => ({ t: r.t, p: r.p[j], y: r.y[j] as 0 | 1 }));
    const days = new Map<number, DaySum>();
    for (const x of pp) addDaySum(days, x.t + j * HOUR, (x.p - x.y) ** 2, (HREL_DESIGN.base - x.y) ** 2);
    return {
      j,
      ...group(pp),
      brier: pp.length ? pp.reduce((s, x) => s + (x.p - x.y) ** 2, 0) / pp.length : null,
      bss: daySkillCi(days.values()),
      auc: auc(pp),
      quintiles: quintiles(pp),
    };
  });
  const len = HREL_DESIGN.blockDays * DAY;
  const done = Math.max(0, Math.floor((now - HREL_GRACE - plan.at) / len));
  const blocks = Array.from({ length: done }, (_, k) => block(rows, plan.at + k * len, plan.at + (k + 1) * len));
  return { plan, days: WINDOW_DAYS, leads, blocks, pooled: done >= 2 ? block(rows, plan.at, plan.at + 2 * len) : null, latest };
}
