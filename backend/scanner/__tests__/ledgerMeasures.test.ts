import { describe, expect, it } from 'vitest';
import { chi2Sf, kupiecTest } from '../../../src/utils/forecastScore.ts';
import { BOOT, daySkillCi } from '../../../src/utils/ledgerBootstrap.ts';
import { mulberry32 } from '../../../src/utils/pathEngine.ts';
import { isDeskLedgerSummary } from '../../../src/utils/deskLedger.ts';
import { TAUS, buildSummary, catScores, kupiec60Of, pitTestOf, retScores, seasonalBigBase, type CatForecast, type CatResolution, type Forecast, type Resolution, type RetForecast, type RetResolution } from '../forecaster.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Wartości wzorcowe policzone ręcznie: LR = −2[x ln(0,6/π) + (n − x) ln(0,4/(1 − π))], p = P(χ²₁ > LR) = erfc(√(LR/2));
// χ²(9) wzorem zamkniętym dla nieparzystych stopni swobody (2(1 − Φ(√x)) + 2φ(√x)(√x + x^1,5/3 + x^2,5/15 + x^3,5/105))
describe('test Kupca przedziału 60% — wartości wzorcowe', () => {
  it('n = 10, x = 3: π = 0,3, LR = −2[3 ln 2 + 7 ln(4/7)] = 3,6757, p = 0,0552', () => {
    const k = kupiecTest(10, 3, 0.6)!;
    expect(k.lr).toBeCloseTo(3.675737947736244, 9);
    expect(k.p).toBeCloseTo(0.05520980877835722, 6);
    expect(kupiec60Of([1, 1, 1, 0, 0, 0, 0, 0, 0, 0])).toEqual({ n: 10, x: 3, cover: 0.3, lr: 3.6757, p: 0.0552 });
  });
  it('x = n i x = 0: składnik z zerową licznością pominięty', () => {
    expect(kupiecTest(5, 5, 0.6)!.lr).toBeCloseTo(-10 * Math.log(0.6), 9); // 5,1083
    expect(kupiecTest(5, 5, 0.6)!.p).toBeCloseTo(0.02381224184237929, 6);
    expect(kupiecTest(4, 0, 0.6)!.lr).toBeCloseTo(-8 * Math.log(0.4), 9); // 7,3303
    expect(kupiecTest(4, 0, 0.6)!.p).toBeCloseTo(0.00678007610398572, 6);
  });
  it('trafienia równe nominałowi: LR = 0, p = 1; brak prognoz: null z powodem', () => {
    expect(kupiecTest(10, 6, 0.6)).toEqual({ lr: 0, p: 1 });
    expect(kupiec60Of([])).toEqual({ n: 0, x: 0, cover: null, lr: null, p: null, reason: 'min-n' });
  });
});

describe('jednostajność PIT — wartości wzorcowe', () => {
  const pitsOf = (bins: number[]) => bins.flatMap((c, k) => Array(c).fill(k / 10 + 0.05));
  it('koszyki po 5 z 50: χ² = 0, p = 1', () => {
    expect(pitTestOf(pitsOf([5, 5, 5, 5, 5, 5, 5, 5, 5, 5]))).toEqual({ n: 50, bins: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5], chi2: 0, p: 1 });
  });
  it('[14, 6, 5, 5, 5, 5, 5, 5, 0, 0]: χ² = (81 + 1 + 25 + 25)/5 = 26,4, p = 0,0018', () => {
    expect(chi2Sf(26.4, 9)).toBeCloseTo(0.0017566038860033798, 8);
    expect(pitTestOf(pitsOf([14, 6, 5, 5, 5, 5, 5, 5, 0, 0]))).toMatchObject({ n: 50, chi2: 26.4, p: 0.0018 });
  });
  it('[8, 7, 6, 5, 5, 5, 4, 4, 3, 3]: χ² = 24/5 = 4,8, p = 0,8514', () => {
    expect(chi2Sf(4.8, 9)).toBeCloseTo(0.8513825753567951, 8);
    expect(pitTestOf(pitsOf([8, 7, 6, 5, 5, 5, 4, 4, 3, 3]))).toMatchObject({ chi2: 4.8, p: 0.8514 });
  });
  it('PIT = 1 w ostatnim koszyku; poniżej 50 prognoz bez testu (null z powodem)', () => {
    expect(pitTestOf([1, 0.99, 0]).bins).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 2]);
    expect(pitTestOf(pitsOf([5, 5, 5, 5, 5, 5, 5, 5, 5, 4]))).toMatchObject({ n: 49, chi2: null, p: null, reason: 'min-n' });
  });
  it('χ²(1) zgodny z erfc(√(x/2))', () => {
    expect(chi2Sf(3.675737947736244, 1)).toBeCloseTo(0.05520980877835722, 8);
    expect(chi2Sf(0, 9)).toBe(1);
  });
});

describe('przedział umiejętności z bootstrapu blokowego po dobach UTC', () => {
  const D0 = 20_400;
  it('procedura ze specyfikacji: mulberry32(20261111), 1000 losowań, indeks floor(u × liczbaDób), 25. i 975. wartość', () => {
    const days = Array.from({ length: 9 }, (_, i) => ({ day: D0 + i, num: 1 + (i % 3) * 0.5, den: 2 + (i % 4) * 0.25 }));
    // Kolejność wejścia bez znaczenia (doby rosnąco)
    const got = daySkillCi([...days].reverse());
    const u = mulberry32(20261111);
    const stats: number[] = [];
    for (let k = 0; k < 1000; k++) {
      let a = 0;
      let b = 0;
      for (let j = 0; j < 9; j++) {
        const d = days[Math.floor(u() * 9)];
        a += d.num;
        b += d.den;
      }
      stats.push(1 - a / b);
    }
    stats.sort((x, y) => x - y);
    const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
    const num = days.reduce((s, d) => s + d.num, 0);
    const den = days.reduce((s, d) => s + d.den, 0);
    expect(got).toEqual({ value: r4(1 - num / den), lo: r4(stats[24]), hi: r4(stats[974]), days: 9 });
    expect(got.lo!).toBeLessThan(got.value!);
    expect(got.hi!).toBeGreaterThan(got.value!);
    expect(BOOT).toMatchObject({ seed: 20261111, reps: 1000, minDays: 7 });
  });
  it('stała umiejętność w każdej dobie: przedział zerowej szerokości', () => {
    expect(daySkillCi(Array.from({ length: 7 }, (_, i) => ({ day: D0 + i, num: 0.5, den: 1 })))).toEqual({ value: 0.5, lo: 0.5, hi: 0.5, days: 7 });
  });
  it('poniżej 7 dób: wartość bez przedziału, powód min-days; zerowy mianownik: no-base', () => {
    expect(daySkillCi(Array.from({ length: 6 }, (_, i) => ({ day: D0 + i, num: 0.5, den: 1 })))).toEqual({ value: 0.5, lo: null, hi: null, days: 6, reason: 'min-days' });
    expect(daySkillCi(Array.from({ length: 8 }, (_, i) => ({ day: D0 + i, num: 0.5, den: 0 })))).toEqual({ value: null, lo: null, hi: null, days: 8, reason: 'no-base' });
  });
});

const T0 = Date.UTC(2026, 9, 26); // poniedziałek
const retF = (slot: number, aci = 0.1): RetForecast => ({ k: 'f', id: `${slot}-ret60`, slot, ti: slot, t: slot, kind: 'ret', h: 60, px0: 100_000, taus: TAUS, q: TAUS.map((t) => (t - 0.5) / 100), bq: TAUS.map((t) => (t - 0.5) / 50), aci, model: 'x' });
const retR = (f: RetForecast, i: number): RetResolution => ({ k: 'r', id: f.id, t: f.t + HOUR, c0: 1, c1: 1, y: 0, crps: 0.001 + (i % 5) * 1e-4, crpsB: 0.0015 + (i % 3) * 1e-4, pit: ((i * 7) % 10) / 10 + 0.05, in90: 1, in60: i % 2 === 0 ? 1 : 0, inAci: 1 });

describe('retScores: nowe miary', () => {
  it('Kupiec 60% i PIT na próbie rozłącznej (pełne godziny), CRPSS z przedziałem po dobach, udział nieskończonych ACI', () => {
    const pairs: { f: RetForecast; r: RetResolution }[] = [];
    for (let i = 0; i < 8 * 24 * 4; i++) {
      const f = retF(T0 + i * 15 * MIN, i % 10 === 0 ? 0 : i % 25 === 0 ? -0.02 : 0.1);
      pairs.push({ f, r: retR(f, i) });
    }
    const s = retScores(pairs);
    const disjoint = pairs.filter((p) => p.f.slot % HOUR === 0);
    expect(disjoint).toHaveLength(8 * 24);
    expect(s.kupiec60).toEqual(kupiec60Of(disjoint.map((p) => p.r.in60)));
    expect(s.kupiec60!.n).toBe(192);
    expect(s.pit).toEqual(pitTestOf(disjoint.map((p) => p.r.pit)));
    expect(s.crpssCi!.days).toBe(8);
    expect(s.crpssCi!.lo).not.toBeNull();
    expect(s.crpssCi!.value).toBeCloseTo(s.crpss!, 4);
    const inf = pairs.filter((p) => p.f.aci <= 0).length;
    expect(s.aciInf).toEqual({ n: pairs.length, inf, share: Math.round((inf / pairs.length) * 1e4) / 1e4 });
  });
  it('mało danych: przedziały null z powodem, Kupiec bez prognoz rozłącznych null', () => {
    const f = retF(T0 + 15 * MIN);
    const s = retScores([{ f, r: retR(f, 1) }]);
    expect(s.kupiec60).toMatchObject({ n: 0, p: null, reason: 'min-n' });
    expect(s.pit).toMatchObject({ n: 0, chi2: null, reason: 'min-n' });
    expect(s.crpssCi).toMatchObject({ days: 1, lo: null, hi: null, reason: 'min-days' });
  });
});

describe('baza sezonowa dużego ruchu kota', () => {
  const WED = Date.UTC(2026, 10, 11); // środa
  const hours = (fill: (day: number, h: number) => 0 | 1 | undefined, back = 40) => {
    const m = new Map<number, 0 | 1>();
    for (let d = 1; d <= back; d++)
      for (let h = 0; h < 24; h++) {
        const y = fill(d, h);
        if (y !== undefined) m.set(WED - d * DAY + h * HOUR, y);
      }
    return m;
  };
  it('ta sama godzina UTC z 20 poprzednich dni roboczych (weekendy pominięte), od 8 rozstrzygnięć', () => {
    // Godzina 10:00: duży ruch co drugi dzień kalendarzowy; inne godziny zawsze 1 (nie mogą wejść)
    const m = hours((d, h) => (h === 10 ? (d % 2 === 0 ? 1 : 0) : 1));
    const weekdays: number[] = [];
    for (let d = 1; weekdays.length < 20; d++) if (![0, 6].includes(new Date(WED - d * DAY).getUTCDay())) weekdays.push(d);
    const want = weekdays.filter((d) => d % 2 === 0).length / 20;
    expect(seasonalBigBase(WED + 10 * HOUR + 15 * MIN, m)).toBe(want);
  });
  it('mniej niż 8 rozstrzygnięć tej godziny: częstość wszystkich godzin tych dób; brak godzin → null', () => {
    const m = hours((d, h) => (h === 10 ? (d <= 7 ? 1 : undefined) : h === 3 ? 0 : undefined));
    // 10:00 tylko w 5 dniach roboczych z 7 ostatnich dni; godzina 3:00 = 0 we wszystkich 20 dniach roboczych
    expect(seasonalBigBase(WED + 10 * HOUR, m)).toBe(5 / 25);
    expect(seasonalBigBase(WED + 10 * HOUR, new Map())).toBeNull();
  });
  it('sobota: tylko weekendy', () => {
    const SAT = Date.UTC(2026, 10, 14);
    const m = new Map<number, 0 | 1>();
    for (let d = 1; d <= 80; d++) {
      const t = SAT - d * DAY;
      const we = [0, 6].includes(new Date(t).getUTCDay());
      m.set(t + 12 * HOUR, we ? 1 : 0);
    }
    expect(seasonalBigBase(SAT + 12 * HOUR, m)).toBe(1);
  });
  it('catScores: BSS wobec bazy sezonowej 1 − Σ(p − y)² / Σ(baza − y)², n prognoz z bazą', () => {
    const m = hours((d, h) => (h === 10 ? (d <= 14 && d % 7 !== 3 && d % 7 !== 4 ? (d % 10 < 3 ? 1 : 0) : undefined) : undefined));
    const base = seasonalBigBase(WED + 10 * HOUR, m)!;
    const f: CatForecast = { k: 'f', id: 'c', slot: WED + 10 * HOUR, ti: 0, t: WED + 10 * HOUR, kind: 'cat', h: 60, bar: 0, px0: 1, x: [], pUp: 0.5, pBig: 0.4, thr: 30, model: 'm', mh: 'h' };
    const r: CatResolution = { k: 'r', id: 'c', t: 0, c0: 1, c1: 1, hi: 1.01, lo: 1, yDir: 0, yBig: 1 };
    const s = catScores([{ f, r }], m).big.bssSeasonal!;
    expect(s.n).toBe(1);
    expect(s.value).toBeCloseTo(1 - 0.36 / (base - 1) ** 2, 4);
    expect(s).toMatchObject({ days: 1, lo: null, hi: null, reason: 'min-days' });
  });
});

describe('podsumowanie z nowymi polami przechodzi walidację strony', () => {
  it('buildSummary: kupiec60, pit, crpssCi, aciInf, bssCi, bssDistCi, big.bssSeasonal', () => {
    const fs = new Map<string, Forecast>();
    const rs = new Map<string, Resolution>();
    for (let i = 0; i < 40; i++) {
      const f = retF(T0 + i * 15 * MIN);
      fs.set(f.id, f);
      rs.set(f.id, retR(f, i));
    }
    const s = buildSummary({ coin: 'BTC', now: T0 + 12 * HOUR, head: { hash: 'h', lines: 80 }, forecasts: fs, resolutions: rs, aci: {}, ots: [] });
    expect(isDeskLedgerSummary(s)).toBe(true);
    const sc = s.scores.ret['60'];
    expect(sc.kupiec60).toMatchObject({ n: 10 });
    expect(sc.pit).toMatchObject({ n: 10, reason: 'min-n' });
    expect(sc.crpssCi).toMatchObject({ days: 1, reason: 'min-days' });
    expect(sc.aciInf).toEqual({ n: 40, inf: 0, share: 0 });
    expect(s.scores.touch.bssCi).toMatchObject({ days: 0, value: null });
    expect(s.scores.touch.bssDistCi).toMatchObject({ days: 0 });
    expect(s.cat?.scores.big.bssSeasonal).toMatchObject({ n: 0, value: null });
  });
});
