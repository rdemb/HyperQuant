/**
 * Laboratorium ryzyka: serie transakcji o stałym ułamku ryzyka (ryzyko liczone od bieżącego kapitału). Wygrana
 * dodaje `payoff` R, przegrana zabiera 1 R, a koszty (opłaty i poślizg) zabierają `cost` R przy każdej transakcji.
 * Stałe ziarno daje wspólne liczby losowe: przy zmianie suwaka zmienia się wynik, a nie los.
 */

export interface RiskParams {
  /** Skuteczność 0–1. */
  winRate: number;
  /** Średni zysk do średniej straty (R). */
  payoff: number;
  /** Ryzyko na transakcję jako ułamek kapitału. */
  riskPct: number;
  trades: number;
  /** Koszty na transakcję w R. */
  cost: number;
}

export const RISK_DEFAULTS: RiskParams = { winRate: 0.5, payoff: 1.5, riskPct: 0.02, trades: 200, cost: 0.1 };

export interface RiskResult {
  /** Oczekiwany wynik na transakcję w R (po kosztach). */
  expectancy: number;
  /** Kapitał na końcu (start = 100): mediana i zakres 5–95%. */
  median: number;
  p5: number;
  p95: number;
  /** Odsetek serii z obsunięciem od szczytu ≥ 20% i ≥ 50%. */
  dd20: number;
  dd50: number;
  /** Mediana najdłuższej serii strat z rzędu. */
  streak: number;
  /** Wachlarz kapitału w kolejnych punktach: [nr transakcji, 5%, 50%, 95%]. */
  fan: [number, number, number, number][];
  /** Kilka przykładowych ścieżek (te same punkty co wachlarz). */
  paths: number[][];
}

/** Generator mulberry32: szybki, powtarzalny, wystarczający do symulacji dydaktycznej. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const expectancyR = (p: RiskParams) => p.winRate * p.payoff - (1 - p.winRate) - p.cost;

const quantile = (sorted: Float64Array | number[], q: number) => {
  const i = (sorted.length - 1) * q;
  const a = Math.floor(i);
  const b = Math.min(sorted.length - 1, a + 1);
  return sorted[a] + (sorted[b] - sorted[a]) * (i - a);
};

export function simulateRisk(p: RiskParams, runs = 1000, seed = 20261024, keep = 12, points = 100): RiskResult {
  const rnd = mulberry32(seed);
  const n = Math.max(1, Math.round(p.trades));
  const stepEvery = Math.max(1, Math.ceil(n / points));
  const marks: number[] = [];
  for (let t = 0; t < n; t += stepEvery) marks.push(t);
  marks.push(n);
  const cols = marks.map(() => new Float64Array(runs));
  const win = 1 + p.riskPct * (p.payoff - p.cost);
  const loss = Math.max(0, 1 - p.riskPct * (1 + p.cost));
  const finals = new Float64Array(runs);
  const streaks = new Float64Array(runs);
  const paths: number[][] = [];
  let dd20 = 0;
  let dd50 = 0;

  for (let r = 0; r < runs; r++) {
    let eq = 100;
    let peak = 100;
    let maxDd = 0;
    let run = 0;
    let longest = 0;
    let m = 0;
    const path: number[] = [];
    for (let t = 0; t <= n; t++) {
      if (t > 0) {
        if (rnd() < p.winRate) {
          eq *= win;
          run = 0;
        } else {
          eq *= loss;
          run++;
          if (run > longest) longest = run;
        }
        if (eq > peak) peak = eq;
        const dd = 1 - eq / peak;
        if (dd > maxDd) maxDd = dd;
      }
      if (marks[m] === t) {
        cols[m][r] = eq;
        if (r < keep) path.push(eq);
        m++;
      }
    }
    finals[r] = eq;
    streaks[r] = longest;
    if (maxDd >= 0.2) dd20++;
    if (maxDd >= 0.5) dd50++;
    if (r < keep) paths.push(path);
  }

  finals.sort();
  streaks.sort();
  const fan = marks.map((t, i) => {
    const c = cols[i].sort();
    return [t, quantile(c, 0.05), quantile(c, 0.5), quantile(c, 0.95)] as [number, number, number, number];
  });
  return {
    expectancy: expectancyR(p),
    median: quantile(finals, 0.5),
    p5: quantile(finals, 0.05),
    p95: quantile(finals, 0.95),
    dd20: dd20 / runs,
    dd50: dd50 / runs,
    streak: quantile(streaks, 0.5),
    fan,
    paths,
  };
}
