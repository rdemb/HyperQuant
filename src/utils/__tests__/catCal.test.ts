import { describe, expect, it } from 'vitest';
import { CAT_CAL_DESIGN, type CalPair, catCal } from '../catCal';

/**
 * Kalibracja `cat-cal-v1` (projekt B): przesunięcie logitu `pBig` kota z par rozstrzygniętych w 14 dniach przed prognozą
 * plus poprawka typu dnia (robocze albo weekend UTC). Wartości wzorcowe policzone niezależnie w Pythonie (ten sam
 * generator danych, osobna implementacja algorytmu).
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T = Date.UTC(2026, 10, 10); // wtorek
const sig = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => {
  const q = Math.min(1 - 1e-4, Math.max(1e-4, p));
  return Math.log(q / (1 - q));
};
const weekend = (t: number) => [0, 6].includes((Math.floor(t / DAY) + 4) % 7);

/** Ten sam generator co skrypt wzorcowy: LCG 16807, p w [0,05; 0,95], y ~ Bernoulli(σ(logit p + przesunięcie typu dnia)). */
function dataset(seed: number, n: number, t0: number, step: number, wd: number, we: number): CalPair[] {
  let s = seed;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const out: CalPair[] = [];
  for (let i = 0; i < n; i++) {
    const t = t0 + i * step;
    const p = Math.round((0.05 + 0.9 * r()) * 1e4) / 1e4;
    const y = r() < sig(logit(p) + (weekend(t) ? we : wd)) ? 1 : 0;
    out.push({ t, pBig: p, yBig: y, rt: t + HOUR });
  }
  return out;
}

describe('catCal: wartości wzorcowe (Python)', () => {
  const cases: [string, CalPair[], number, number, { p: number; a: number; d: number; n: number; nT: number }][] = [
    ['dni robocze +0,6', dataset(7, 600, T - 13 * DAY, 30 * MIN, 0.6, 0), T, 0.42, { p: 0.603, a: 0.504681, d: 0.235991, n: 600, nT: 408 }],
    ['bez przesunięcia', dataset(11, 300, T - 10 * DAY, 45 * MIN, 0, 0), T, 0.13, { p: 0.1209, a: -0.046276, d: -0.036448, n: 300, nT: 172 }],
    ['prognoza w weekend', dataset(3, 400, T - 9 * DAY, 30 * MIN, 1.2, -0.8), T + 4 * DAY + HOUR, 0.71, { p: 0.5689, a: 0.532922, d: -1.150904, n: 400, nT: 144 }],
  ];
  for (const [name, pairs, t, pBig, want] of cases) {
    it(name, () => {
      const c = catCal(pairs, { t, ti: t }, pBig)!;
      expect(c.v).toBe('cat-cal-v1');
      expect(c.n).toBe(want.n);
      expect(c.nT).toBe(want.nT);
      expect(Math.abs(c.a - want.a)).toBeLessThanOrEqual(1e-5);
      expect(Math.abs(c.d - want.d)).toBeLessThanOrEqual(1e-5);
      expect(Math.abs(c.p - want.p)).toBeLessThanOrEqual(1e-4);
    });
  }
});

describe('catCal: przypadki brzegowe', () => {
  it('pusty zbiór i mniej niż 96 par → null', () => {
    expect(catCal([], { t: T, ti: T }, 0.5)).toBeNull();
    expect(catCal(dataset(5, 95, T - 2 * DAY, 15 * MIN, 0, 0), { t: T, ti: T }, 0.5)).toBeNull();
    expect(catCal(dataset(5, 96, T - 2 * DAY, 15 * MIN, 0, 0), { t: T, ti: T }, 0.5)).not.toBeNull();
  });

  it('częstość równa średniemu p (y = p co do wartości oczekiwanej, duża próba) → |a| < 0,02', () => {
    // Deterministycznie: każda prognoza p ∈ {0,2; 0,5; 0,8} z dokładnie taką częstością w grupie
    const pairs: CalPair[] = [];
    let t = T - 12 * DAY;
    for (const [p, k] of [[0.2, 2], [0.5, 5], [0.8, 8]] as const) {
      for (let rep = 0; rep < 20; rep++) for (let i = 0; i < 10; i++) pairs.push({ t: (t += 15 * MIN), pBig: p, yBig: i < k ? 1 : 0, rt: t + HOUR });
    }
    const c = catCal(pairs, { t: T, ti: T }, 0.5)!;
    expect(Math.abs(c.a)).toBeLessThan(0.02);
  });

  it('przycięcie przesunięcia do ±1,5', () => {
    const all1 = dataset(9, 200, T - 5 * DAY, 30 * MIN, 0, 0).map((x) => ({ ...x, pBig: 0.05, yBig: 1 as const }));
    const c = catCal(all1, { t: T, ti: T }, 0.05)!;
    expect(c.a + c.d).toBeGreaterThan(1.5);
    expect(c.p).toBe(Math.round(sig(logit(0.05) + 1.5) * 1e4) / 1e4);
    const all0 = all1.map((x) => ({ ...x, pBig: 0.95, yBig: 0 as const }));
    expect(catCal(all0, { t: T, ti: T }, 0.95)!.p).toBe(Math.round(sig(logit(0.95) - 1.5) * 1e4) / 1e4);
  });

  it('para rozstrzygnięta po chwili wydania i para spoza 14 dni nie wchodzą do S; pBig 0 i 1 przycięte do 1e-4', () => {
    const base = dataset(13, 120, T - 6 * DAY, 30 * MIN, 0, 0);
    const n0 = catCal(base, { t: T, ti: T }, 0.3)!.n;
    const late = { t: T - 30 * MIN, pBig: 0.4, yBig: 1 as const, rt: T + MIN };
    const old = { t: T - 14 * DAY - MIN, pBig: 0.4, yBig: 1 as const, rt: T - 14 * DAY + HOUR };
    expect(catCal([...base, late, old], { t: T, ti: T }, 0.3)!.n).toBe(n0);
    expect(Number.isFinite(catCal(base, { t: T, ti: T }, 0)!.p)).toBe(true);
    expect(Number.isFinite(catCal(base, { t: T, ti: T }, 1)!.p)).toBe(true);
  });
});

describe('catCal: dane syntetyczne (20 dni, prawdziwa szansa σ(z + 0,6) w dni robocze i σ(z) w weekend)', () => {
  it('po 14 dniach średnie cal.p różni się od częstości o najwyżej 0,03 w obu typach dnia, a Brier jest niższy od surowego', () => {
    const start = Date.UTC(2026, 9, 1);
    const all = dataset(21, 20 * 96, start, 15 * MIN, 0.6, 0);
    const rows: { t: number; p: number; raw: number; y: number; truth: number }[] = [];
    for (const x of all) {
      if (x.t < start + 14 * DAY) continue;
      const c = catCal(all, { t: x.t, ti: x.t }, x.pBig);
      if (c) rows.push({ t: x.t, p: c.p, raw: x.pBig, y: x.yBig, truth: sig(logit(x.pBig) + (weekend(x.t) ? 0 : 0.6)) });
    }
    expect(rows.length).toBeGreaterThan(500);
    // Częstość oczekiwana (prawdziwa szansa danych), nie zrealizowana: przy ok. 190 godzinach weekendu błąd standardowy
    // częstości zrealizowanej to ok. 0,036, więc próg 0,03 sprawdzałby szum losowania, nie kalibrację
    for (const we of [false, true]) {
      const r = rows.filter((x) => weekend(x.t) === we);
      const meanP = r.reduce((s, x) => s + x.p, 0) / r.length;
      const freq = r.reduce((s, x) => s + x.truth, 0) / r.length;
      expect(Math.abs(meanP - freq), we ? 'weekend' : 'robocze').toBeLessThanOrEqual(0.03);
    }
    const brier = (k: 'p' | 'raw') => rows.reduce((s, x) => s + (x[k] - x.y) ** 2, 0) / rows.length;
    expect(brier('p')).toBeLessThan(brier('raw'));
  });
});

describe('plan cat-cal-v1', () => {
  it('stałe planu zgodne z projektem', () => {
    expect(CAT_CAL_DESIGN).toMatchObject({ id: 'cat-cal-v1', windowDays: 14, priorVar: { a: 1, d: 0.25 }, clip: 1.5, minPairs: 96, newtonSteps: 25, blockDays: 14, hacLag: 96, minN: 672 });
  });
});
