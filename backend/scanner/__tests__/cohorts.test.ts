import { describe, expect, it } from 'vitest';
import { CohortEngine, SecondPrices, benjaminiHochberg, ebPrior, normalSf, selectInformed } from '../cohortEngine.ts';
import { COHORTS, isCohortFlow, netOf } from '../../../src/utils/cohorts.ts';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 22, 12, 0, 0);
const A = (tag: string, i = 0) => `0x${(tag.charCodeAt(0).toString(16) + String(i)).padStart(40, '0')}`;

describe('statystyka', () => {
  it('normalSf: prawy ogon rozkładu normalnego', () => {
    expect(normalSf(0)).toBeCloseTo(0.5, 6); // przybliżenie erfc: błąd względny < 1.2e-7
    expect(normalSf(1.6449)).toBeCloseTo(0.05, 3);
    expect(normalSf(-1.96)).toBeCloseTo(0.975, 3);
    expect(normalSf(8)).toBeLessThan(1e-14);
  });

  it('Benjamini–Hochberg: największe k z p(k) ≤ k/m·q', () => {
    expect(benjaminiHochberg([0.001, 0.02, 0.03, 0.5], 0.1)).toEqual([true, true, true, false]);
    expect(benjaminiHochberg([0.5, 0.03, 0.001, 0.02], 0.1)).toEqual([false, true, true, true]);
    expect(benjaminiHochberg([0.2, 0.3], 0.1)).toEqual([false, false]);
    expect(benjaminiHochberg([], 0.1)).toEqual([]);
  });

  it('ebPrior: metoda momentów — τ² = średni kwadrat odchylenia średnich − średni błąd², nie mniej niż 0', () => {
    expect(ebPrior([1, 2, 3, 4, 5], [0.5, 0.5, 0.5, 0.5, 0.5])).toEqual({ mu0: 3, tau2: 1.5 });
    expect(ebPrior([1, 1.1, 0.9], [4, 4, 4]).tau2).toBe(0);
  });

  it('selectInformed: wybiera adresy z istotnie dodatnim markoutem, kontroluje FDR, pomija małe próby', () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
    const rows = [];
    for (let i = 0; i < 60; i++) {
      const xs = Array.from({ length: 50 }, () => 30 * gauss()); // brak przewagi
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      rows.push({ addr: `n${i}`, n: xs.length, mean, variance: xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length });
    }
    for (let i = 0; i < 3; i++) rows.push({ addr: `inf${i}`, n: 60, mean: 25, variance: 30 ** 2 });
    rows.push({ addr: 'small', n: 10, mean: 80, variance: 10 }); // za mała próba
    const r = selectInformed(rows, { minN: 30, q: 0.1 });
    expect([...r.selected].filter((a) => a.startsWith('inf')).sort()).toEqual(['inf0', 'inf1', 'inf2']);
    expect([...r.selected].filter((a) => a.startsWith('n')).length).toBeLessThanOrEqual(2);
    expect(r.selected.has('small')).toBe(false);
    expect(r.candidates).toBe(63);
  });
});

describe('SecondPrices', () => {
  it('cena w chwili t = ostatnia cena nie później niż t (do 60 s wstecz)', () => {
    const p = new SecondPrices();
    p.record(100, T0);
    p.record(101, T0 + 3000);
    expect(p.priceAt(T0 + 2000)).toBe(100);
    expect(p.priceAt(T0 + 3500)).toBe(101);
    expect(p.priceAt(T0 + 120_000)).toBeNull();
    expect(p.priceAt(T0 - 1000)).toBeNull();
  });
});

function trade(buyer: string, seller: string, side: 'B' | 'A', px: number, sz: number, time: number) {
  return { users: [buyer, seller] as [string, string], side, px, sz, time };
}

describe('CohortEngine — przepływy', () => {
  it('przepływ netto kohort sumuje się do zera; agresor przypisany po stronie transakcji', () => {
    const whales = new Set([0, 1, 2, 3, 4].map((i) => A('W', i)));
    const e = new CohortEngine({ coin: 'BTC', isWhale: (a) => whales.has(a) });
    for (let i = 0; i < 5; i++) e.onTrade(trade(A('W', i), A('R', i), 'B', 100, 10, T0 + i * 1000));
    const f = e.build(T0 + 10_000, T0);
    const cells = f.buckets[0].cells;
    expect(cells.whale).toEqual({ buy: 5000, sell: 0, takerBuy: 5000, takerSell: 0 });
    expect(cells.rest).toEqual({ buy: 0, sell: 5000, takerBuy: 0, takerSell: 0 });
    expect(COHORTS.reduce((s, k) => s + (cells[k] ? netOf(cells[k]!) : 0), 0)).toBe(0);
    expect(f.totals.h1.whale.buy).toBe(5000);
    expect(isCohortFlow(f)).toBe(true);
  });

  it('k-anonimowość: < 5 uczestników → komórka ukryta i liczona w sumach jako ukryta', () => {
    const whales = new Set([0, 1, 2, 3].map((i) => A('W', i)));
    const e = new CohortEngine({ coin: 'BTC', isWhale: (a) => whales.has(a) });
    for (let i = 0; i < 4; i++) e.onTrade(trade(A('W', i), A('R', i), 'B', 100, 1, T0 + i * 1000));
    const f = e.build(T0 + 10_000, T0);
    expect(f.buckets[0].cells.whale).toBeNull();
    expect(f.buckets[0].cells.rest).toBeNull();
    expect(f.totals.h1.whale).toMatchObject({ buy: 0, hidden: 1 });
  });

  it('dominacja: jeden uczestnik > 50% obrotu komórki → ukryta mimo ≥ 5 uczestników', () => {
    const whales = new Set([0, 1, 2, 3, 4].map((i) => A('W', i)));
    const e = new CohortEngine({ coin: 'BTC', isWhale: (a) => whales.has(a) });
    e.onTrade(trade(A('W', 0), A('R', 0), 'B', 100, 100, T0));
    for (let i = 1; i < 5; i++) e.onTrade(trade(A('W', i), A('R', i), 'B', 100, 1, T0 + i * 1000));
    const f = e.build(T0 + 10_000, T0);
    expect(f.buckets[0].cells.whale).toBeNull();
  });

  it('transakcja z samym sobą jest pomijana; kubełki 15 min sprzed okresu obserwacji nie są publikowane', () => {
    const e = new CohortEngine({ coin: 'BTC', isWhale: () => false });
    e.onTrade(trade(A('R', 1), A('R', 1), 'B', 100, 1, T0));
    e.onTrade(trade(A('R', 2), A('R', 3), 'B', 100, 1, T0 - 30 * MIN));
    const f = e.build(T0 + MIN, T0);
    expect(f.buckets).toEqual([]);
    expect(f.bucketMin).toBe(15);
  });
});

describe('CohortEngine — markouty i klasyfikacja', () => {
  it('markout biorcy 1/5/60 min w bp, przypisany kohorcie z chwili transakcji (walidacja poza próbą)', () => {
    const e = new CohortEngine({ coin: 'BTC', isWhale: () => false });
    e.onTrade(trade(A('R', 1), A('R', 2), 'B', 100, 10, T0)); // kupno biorcy po 100
    e.recordPrice(100.5, T0 + MIN);
    e.recordPrice(101, T0 + 5 * MIN);
    e.settle(T0 + 5 * MIN + 5000);
    const f = e.build(T0 + 5 * MIN + 5000, T0);
    expect(f.oos.rest.n).toBe(1);
    expect(f.oos.rest.m1).toBeCloseTo(50, 6);
    expect(f.oos.rest.m5).toBeCloseTo(100, 6);
    expect(f.oos.rest.m60).toBeNull();
    expect(f.oos.whale).toEqual({ n: 0, usd: 0, m1: null, m5: null, m60: null });
  });

  it('market maker: ≥ 80% nominału jako maker i ≥ 1 mln USD → kohorta mm po klasyfikacji', () => {
    const e = new CohortEngine({ coin: 'BTC', isWhale: () => false });
    const mm = A('M', 1);
    for (let i = 0; i < 25; i++) e.onTrade(trade(A('R', i), mm, 'B', 100_000, 1, T0 + i * 1000)); // mm sprzedaje jako maker
    expect(e.cohortOf(mm)).toBe('rest');
    e.classify(T0 + MIN);
    expect(e.cohortOf(mm)).toBe('mm');
    expect(e.cohortOf(A('R', 1))).toBe('rest');
  });

  it('opublikowany dokument nie zawiera adresów; stan przetrwa zapis i odczyt', () => {
    const e = new CohortEngine({ coin: 'BTC', isWhale: () => false });
    for (let i = 0; i < 6; i++) e.onTrade(trade(A('R', i), A('S', i), 'A', 100, 1, T0 + i * 1000));
    const f = e.build(T0 + MIN, T0);
    expect(JSON.stringify(f)).not.toMatch(/0x[0-9a-f]{40}/i);
    const back = CohortEngine.fromJSON(JSON.parse(JSON.stringify(e.toJSON())), { coin: 'BTC', isWhale: () => false });
    expect(back.build(T0 + MIN, T0).buckets).toEqual(f.buckets);
    expect(back.build(T0 + MIN, T0).members).toEqual(f.members);
  });
});
