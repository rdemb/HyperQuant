import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../pathEngine.ts';
import { FEATURES } from '../schrodi.ts';
import { isCat, isTrust } from '../deskLedger.ts';
import {
  TRUST_DESIGN,
  type TrustHour,
  type TrustStep,
  catTrust,
  corp,
  deltaStep,
  driftAlarms,
  driftState,
  oodKeys,
  proofPath,
  proofState,
  spiegelhalter,
  trustHour,
  wilson,
} from '../schrodiTrust.ts';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 28, 12);
const LG20 = Math.log10(20);

/** Kroki zakładu dla dużego ruchu: wynik ~ Bernoulli(truth), kot mówi p, reguła stałe q */
function steps(n: number, seed: number, cat: (truth: number, u: () => number) => number, q = TRUST_DESIGN.baseline.big): TrustStep[] {
  const u = mulberry32(seed);
  const out: TrustStep[] = [];
  for (let i = 0; i < n; i++) {
    const truth = q;
    const p = cat(truth, u);
    const y: 0 | 1 = u() < truth ? 1 : 0;
    out.push({ slot: T0 + i * HOUR, ...deltaStep(p, q, y) });
  }
  return out;
}

describe('schrodiTrust — przedziały i testy', () => {
  it('Wilson: znane wartości 95%, brak próby → null, skrajne k w [0, 1]', () => {
    const [lo, hi] = wilson(5, 10, 1.959963984540054)!;
    expect(lo).toBeCloseTo(0.2366, 4);
    expect(hi).toBeCloseTo(0.7634, 4);
    expect(wilson(0, 0)).toBeNull();
    const z = wilson(0, 20)!;
    expect(z[0]).toBe(0);
    expect(z[1]).toBeGreaterThan(0);
    expect(wilson(20, 20)![1]).toBe(1);
  });

  it('Spiegelhalter: jedna prognoza 25% i wynik 1 → Z = √3; dobra kalibracja → duże p; zawyżone p → małe p', () => {
    expect(spiegelhalter([{ p: 0.25, y: 1 }])!.z).toBeCloseTo(Math.sqrt(3), 10);
    expect(spiegelhalter([{ p: 0.5, y: 1 }])).toBeNull();
    const u = mulberry32(3);
    const good: { p: number; y: 0 | 1 }[] = [];
    const bad: { p: number; y: 0 | 1 }[] = [];
    for (let i = 0; i < 4000; i++) {
      const p = 0.1 + 0.8 * u();
      const y: 0 | 1 = u() < p ? 1 : 0;
      good.push({ p, y });
      bad.push({ p: Math.min(0.99, p + 0.15), y });
    }
    expect(spiegelhalter(good)!.p).toBeGreaterThan(0.01);
    expect(spiegelhalter(bad)!.p).toBeLessThan(1e-6);
  });

  it('CORP: dokładnie BS = MCB − DSC + UNC, MCB i DSC nieujemne; remisy p jako jeden blok', () => {
    const u = mulberry32(11);
    const pp = Array.from({ length: 500 }, () => {
      const p = Math.round(u() * 20) / 20;
      return { p, y: (u() < 0.2 + 0.6 * p ? 1 : 0) as 0 | 1 };
    });
    const c = corp(pp)!;
    expect(c.bs).toBeCloseTo(c.mcb - c.dsc + c.unc, 12);
    expect(c.mcb).toBeGreaterThanOrEqual(-1e-12);
    expect(c.dsc).toBeGreaterThanOrEqual(-1e-12);
    // Stała prognoza równa częstości: zero wiedzy i zero błędu kalibracji
    const flat = corp([
      { p: 0.5, y: 1 },
      { p: 0.5, y: 0 },
    ])!;
    expect(flat).toMatchObject({ mcb: 0, dsc: 0, unc: 0.25, bs: 0.25 });
    expect(corp([])).toBeNull();
  });
});

describe('schrodiTrust — dowód (e-proces) i dryf (e-detektor)', () => {
  it('kot = reguła → kapitał stoi w 1; δ w granicach [δmin, δmax] przed wynikiem', () => {
    const s = steps(50, 1, (t) => t);
    expect(proofPath(s).every((v) => v === 0)).toBe(true);
    for (const p of [0.1, 0.483, 0.9])
      for (const y of [0, 1] as const) {
        const d = deltaStep(p, 0.4, y);
        expect(d.d).toBeGreaterThanOrEqual(d.lo);
        expect(d.d).toBeLessThanOrEqual(d.hi);
      }
  });

  it('kot z wiedzą przekracza 20; kot bez przewagi przekracza 20 najwyżej w ~5% przebiegów (Ville)', () => {
    // Wiedza: prawda zmienna, kot ją zna, reguła stała
    const u = mulberry32(5);
    const know: TrustStep[] = [];
    for (let i = 0; i < 400; i++) {
      const truth = u() < 0.5 ? 0.2 : 0.8;
      const y: 0 | 1 = u() < truth ? 1 : 0;
      know.push({ slot: T0 + i * HOUR, ...deltaStep(truth, 0.5, y) });
    }
    expect(Math.max(...proofPath(know))).toBeGreaterThan(LG20);
    // Bez przewagi: kot szumi wokół prawdy (gorszy od reguły); 300 przebiegów po 500 godzin
    let crossed = 0;
    for (let run = 0; run < 300; run++) {
      const path = proofPath(steps(500, 100 + run, (t, r) => Math.min(0.99, Math.max(0.01, t + (r() - 0.5) * 0.1))));
      if (path.some((v) => v >= LG20)) crossed++;
    }
    expect(crossed / 300).toBeLessThanOrEqual(0.05);
  });

  it('dryf: kot wyraźnie gorszy → alarm z początkiem; potem dobry kot → alarm gaśnie, jeden epizod', () => {
    const bad = steps(300, 7, () => 0.95);
    const a = driftState(bad);
    expect(a.alarm).toBe(true);
    expect(a.episodes).toBe(1);
    expect(a.since).not.toBeNull();
    const u = mulberry32(9);
    const good: TrustStep[] = [];
    for (let i = 0; i < 2000; i++) {
      const truth = u() < 0.5 ? 0.1 : 0.9;
      good.push({ slot: T0 + (300 + i) * HOUR, ...deltaStep(truth, 0.483, u() < truth ? 1 : 0) });
    }
    const b = driftState([...bad, ...good]);
    expect(b).toMatchObject({ alarm: false, episodes: 1, since: null });
    // Kot równy regule: brak alarmu
    expect(driftState(steps(2000, 8, (t) => t)).alarm).toBe(false);
  });
});

describe('schrodiTrust — godziny, rzadki rynek, ocena', () => {
  const x = FEATURES.map((k) => (k === 'rv_1d' ? 300 : k === 'rng4h_rel' ? 1 : 0));
  const f = { slot: T0, pUp: 0.55, pBig: 0.6, thr: 30, px0: 100_000, x, tl: [{ px: 100_300, p: 0.3 }, { px: 99_900, p: 0.6 }] };

  it('trustHour: wyniki z cen jak w dzienniku; poza pełną godziną null; bez zmienności doby bez dotknięć', () => {
    const h = trustHour(f, { c0: 100_000, c1: 100_100, hi: 100_350, lo: 99_950 })!;
    expect(h).toMatchObject({ slot: T0, yDir: 1, yBig: 1 });
    expect(h.touch.map((l) => l.y)).toEqual([1, 0]);
    for (const l of h.touch) {
      expect(l.q).toBeGreaterThan(0);
      expect(l.q).toBeLessThan(1);
    }
    expect(trustHour({ ...f, slot: T0 + 15 * 60_000 }, { c0: 1, c1: 1, hi: 1, lo: 1 })).toBeNull();
    const noRv = trustHour({ ...f, x: x.map((v, i) => (FEATURES[i] === 'rv_1d' ? null : v)) }, { c0: 1, c1: 1, hi: 1, lo: 1 })!;
    expect(noRv.touch).toEqual([]);
  });

  it('oodKeys: w zakresie pusto, poza zakresem nazwa cechy, brak danych nie flaguje', () => {
    expect(oodKeys(() => 0)).toEqual(['rv_1h', 'rv_1d', 'rng4h_rel']);
    const mid = Object.fromEntries(Object.entries(TRUST_DESIGN.ood.ranges).map(([k, [lo, hi]]) => [k, (lo + hi) / 2])) as Record<string, number>;
    expect(oodKeys((k) => mid[k])).toEqual([]);
    expect(oodKeys((k) => (k === 'ret_4h' ? 900 : mid[k]))).toEqual(['ret_4h']);
    expect(oodKeys((k) => (k === 'ret_4h' ? NaN : k === 'vol_z' ? null : mid[k]))).toEqual([]);
  });

  it('catTrust: bez planu pusto; godziny przed planem poza oceną; ścieżka najwyżej 400 punktów z ostatnim; kontrakt strony', () => {
    const u = mulberry32(21);
    const hours: TrustHour[] = [];
    for (let i = 0; i < 1000; i++) {
      const pBig = u();
      hours.push({ slot: T0 + i * HOUR, pUp: 0.5, pBig, yDir: u() < 0.5 ? 1 : 0, yBig: u() < pBig ? 1 : 0, x, touch: [{ p: 0.4, q: 0.3, y: u() < 0.4 ? 1 : 0 }] });
    }
    const none = catTrust(hours, null);
    expect(none.big.n).toBe(0);
    expect(none.big.path).toEqual([]);
    const plan = { id: TRUST_DESIGN.id, hash: 'a'.repeat(64), at: T0 + 10 * HOUR + 30_000 };
    const t = catTrust([...hours].reverse(), plan);
    expect(t.big.n).toBe(989);
    expect(t.big.step).toBe(3);
    expect(t.big.path.length).toBeLessThanOrEqual(400);
    expect(t.big.path.at(-1)).toBeCloseTo(t.big.lg, 3);
    expect(t.big.lgMax).toBeGreaterThan(LG20);
    expect(t.big.proofAt).not.toBeNull();
    expect(t.big.rel.reduce((a, b) => a + b.n, 0)).toBe(989);
    expect(t.touch.spiegel).toBeNull();
    expect(t.ood.n).toBe(989); // rv_1h = 0 poza zakresem w każdej godzinie
    expect(isTrust(t)).toBe(true);
    expect(isTrust(JSON.parse(JSON.stringify(t)))).toBe(true);
    expect(isTrust({ ...t, big: { ...t.big, path: [...t.big.path, 'x'] } })).toBe(false);
    expect(isTrust({ ...t, dir: { ...t.dir, drift: { ...t.dir.drift, alarm: 'tak' } } })).toBe(false);
    expect(driftAlarms(t)).toEqual([]);
    expect(driftAlarms({ ...t, touch: { ...t.touch, drift: { ...t.touch.drift, alarm: true } } })).toEqual(['touch']);
    expect(driftAlarms(null)).toEqual([]);
    expect(proofState(t.big)).toBe(t.big.lg >= LG20 ? 'holding' : 'faded');
    expect(proofState({ ...t.big, lg: 0.5 })).toBe('faded');
    expect(proofState(none.big)).toBe('none');
  });

  it('isCat: uszkodzona ocena zaufania odrzuca sekcję kota, brak oceny (starsze podsumowania) nie', () => {
    const head = { brier: null, brierBase: null, bss: null, auc: null, hit: null };
    const cat = {
      model: 'schrodi-v1',
      since: T0,
      issued: 0,
      slots: 0,
      latest: null,
      scores: { n: 0, nEff: 0, dir: { ...head, long: { n: 0, hit: null }, short: { n: 0, hit: null }, unsure: 0 }, big: { ...head, reliability: [] } },
    };
    expect(isCat(cat)).toBe(true);
    expect(isCat({ ...cat, trust: catTrust([], null) })).toBe(true);
    expect(isCat({ ...cat, trust: { plan: null } })).toBe(false);
  });
});
