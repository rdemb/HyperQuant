import { describe, expect, it } from 'vitest';
import { CohortEngine, SecondPrices, benjaminiHochberg, ebPrior, normalSf, selectInformed, suppress } from '../cohortEngine.ts';
import { COHORTS, isCohortFlow, netOf } from '../../../src/utils/cohorts.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.UTC(2026, 9, 22, 12, 0, 0);
const A = (tag: string, i = 0) => `0x${(tag.charCodeAt(0).toString(16) + String(i)).padStart(40, '0')}`;
/** Chwila, w której kubełek 15 min zaczynający się w T0 jest już zamknięty i sfinalizowany */
const AFTER_CLOSE = T0 + 16 * MIN;

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
      const xs = Array.from({ length: 50 }, () => 30 * gauss());
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      rows.push({ addr: `n${i}`, n: xs.length, mean, variance: xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length });
    }
    for (let i = 0; i < 3; i++) rows.push({ addr: `inf${i}`, n: 60, mean: 25, variance: 30 ** 2 });
    rows.push({ addr: 'small', n: 10, mean: 80, variance: 10 });
    const r = selectInformed(rows, { minN: 30, q: 0.1 });
    expect([...r.selected].filter((a) => a.startsWith('inf')).sort()).toEqual(['inf0', 'inf1', 'inf2']);
    expect([...r.selected].filter((a) => a.startsWith('n')).length).toBeLessThanOrEqual(2);
    expect(r.selected.has('small')).toBe(false);
    expect(r.candidates).toBe(63);
  });
});

describe('suppress — ukrywanie pierwotne i wtórne (sumy kohort są publiczne)', () => {
  const parts = (...v: number[]) => new Map(v.map((x, i) => [`a${x}-${i}`, x]));
  it('jedna komórka nie spełnia k → ukryta także najmniejsza inna, a suma ukrytych spełnia k i dominację', () => {
    const vis = suppress({
      mm: parts(10, 10, 10, 10, 10),
      informed: parts(5, 5),
      whale: parts(30, 30, 30, 30, 30),
      rest: parts(4, 4, 4, 4, 4, 4),
    });
    expect(vis).toEqual({ mm: true, informed: false, whale: true, rest: false });
  });
  it('gdy suma ukrytych wciąż łamie dominację — ukrywane są kolejne', () => {
    // informed (500) + reszta (5 × 10): 500 / 550 > 50% → + mm → + wieloryby → wszystko ukryte
    const vis = suppress({
      mm: parts(1, 1, 1, 1, 1),
      informed: parts(500),
      whale: parts(2, 2, 2, 2, 2),
      rest: parts(10, 10, 10, 10, 10),
    });
    expect(vis).toEqual({ mm: false, informed: false, whale: false, rest: false });
  });
  it('ukryci „poinformowani” parują się najpierw z „resztą” (MM i wieloryby da się odtworzyć z danych publicznych)', () => {
    const vis = suppress({
      mm: parts(1, 1, 1, 1, 1), // najmniejszy obrót, ale odtwarzalny publicznie
      informed: parts(5, 5),
      whale: parts(30, 30, 30, 30, 30),
      rest: parts(40, 40, 40, 40, 40, 40),
    });
    expect(vis).toEqual({ mm: true, informed: false, whale: true, rest: false });
  });

  it('wszystkie spełniają → widoczne; komórki bez aktywności nie wymagają ukrycia', () => {
    expect(suppress({ mm: parts(1, 1, 1, 1, 1), informed: new Map(), whale: new Map(), rest: parts(2, 2, 2, 2, 2) })).toEqual({
      mm: true,
      informed: true,
      whale: true,
      rest: true,
    });
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
  it('tylko zamknięte kubełki; netto sumuje się do zera; wartości zaokrąglone do 10 tys. USD', () => {
    const whales = new Set([0, 1, 2, 3, 4].map((i) => A('W', i)));
    const e = new CohortEngine({ coin: 'BTC', isWhale: (a) => whales.has(a) });
    for (let i = 0; i < 5; i++) e.onTrade(trade(A('W', i), A('R', i), 'B', 100_123, 1, T0 + i * 1000));
    e.housekeep(T0 + 5 * MIN);
    expect(e.build(T0 + 5 * MIN, T0).buckets).toEqual([]); // kubełek otwarty — niepublikowany
    e.housekeep(AFTER_CLOSE);
    const f = e.build(AFTER_CLOSE, T0);
    const cells = f.buckets[0].cells;
    expect(cells.whale).toEqual({ buy: 500_000, sell: 0, takerBuy: 500_000, takerSell: 0 });
    expect(cells.rest).toEqual({ buy: 0, sell: 500_000, takerBuy: 0, takerSell: 0 });
    expect(COHORTS.reduce((s, k) => s + (cells[k] ? netOf(cells[k]!) : 0), 0)).toBe(0);
    expect(f.totals.h1.whale.buy).toBe(500_000);
    expect(isCohortFlow(f)).toBe(true);
  });

  it('warstwa biorcy ukrywana osobno: komórka widoczna, ale jeden biorca dominuje → takerBuy/takerSell = null', () => {
    const e = new CohortEngine({ coin: 'BTC', isWhale: () => false });
    for (let i = 0; i < 6; i++) e.onTrade(trade(A('B', 1), A('S', i), 'B', 100_000, 1, T0 + i * 1000));
    for (let i = 0; i < 5; i++) e.onTrade(trade(A('X', i), A('Y', i), 'A', 100_000, 1, T0 + 10_000 + i * 1000));
    e.housekeep(AFTER_CLOSE);
    const f = e.build(AFTER_CLOSE, T0);
    expect(f.buckets[0].cells.rest).toEqual({ buy: 1_100_000, sell: 1_100_000, takerBuy: null, takerSell: null });
    expect(f.totals.h1.rest).toMatchObject({ buy: 1_100_000, takerBuy: 0, takerHidden: 1, hidden: 0 });
  });

  it('transakcja z samym sobą pominięta; kubełki sprzed okresu obserwacji nie są publikowane', () => {
    const e = new CohortEngine({ coin: 'BTC', isWhale: () => false });
    e.onTrade(trade(A('R', 1), A('R', 1), 'B', 100_000, 1, T0));
    e.onTrade(trade(A('R', 2), A('R', 3), 'B', 100_000, 1, T0 - 30 * MIN));
    e.housekeep(AFTER_CLOSE);
    const f = e.build(AFTER_CLOSE, T0);
    expect(f.buckets).toEqual([]);
    expect(f.bucketMin).toBe(15);
  });

  it('liczności kohort z klasyfikacji, zaokrąglone w dół do dziesiątek (0 = mniej niż 10)', () => {
    const e = new CohortEngine({ coin: 'BTC', isWhale: () => false });
    for (let i = 0; i < 23; i++) e.onTrade(trade(A('R', i), A('S', i), 'B', 100_000, 1, T0 + i));
    expect(e.build(T0 + MIN, T0).members.rest).toBe(0);
    e.classify(T0 + MIN);
    expect(e.build(T0 + MIN, T0).members).toEqual({ mm: 0, informed: 0, whale: 0, rest: 40 });
  });
});

describe('CohortEngine — markouty i klasyfikacja', () => {
  it('markouty tylko z w pełni rozliczonych godzin z ≥ 5 biorcami; tylko średnie (bez liczności i nominału)', () => {
    const e = new CohortEngine({ coin: 'BTC', isWhale: () => false });
    for (let i = 0; i < 6; i++) e.onTrade(trade(A('R', i), A('S', i), 'B', 100, 1000 + i, T0 + i * 1000));
    e.recordPrice(100.5, T0 + MIN);
    e.recordPrice(101, T0 + 5 * MIN);
    e.recordPrice(100.2, T0 + 60 * MIN);
    e.settle(T0 + 61 * MIN + 10_000);
    e.housekeep(T0 + 61 * MIN + 10_000);
    expect(e.build(T0 + 61 * MIN + 10_000, T0).oos.rest.hours).toBe(0); // godzina nie jest jeszcze rozliczona w całości
    e.settle(T0 + 2 * HOUR + MIN);
    e.housekeep(T0 + 2 * HOUR + MIN);
    const o = e.build(T0 + 2 * HOUR + MIN, T0).oos.rest;
    expect(o.hours).toBe(1);
    expect(o.m1).toBeCloseTo(50, 1);
    expect(o.m5).toBeCloseTo(100, 1);
    expect(o.m60).toBeCloseTo(20, 1);
    // bez liczności i nominału (wagi pozwalałyby odtwarzać ukryte godziny z publicznych sum taśmy)
    expect(Object.keys(o).sort()).toEqual(['hiddenHours', 'hours', 'm1', 'm5', 'm60']);
  });

  it('okno markoutów = 24 ostatnie sfinalizowane godziny (nowa wchodzi w tym samym kroku, w którym stara wypada)', () => {
    const e = new CohortEngine({ coin: 'BTC', isWhale: () => false });
    for (let h = 0; h < 26; h++) {
      for (let i = 0; i < 6; i++) e.onTrade(trade(A('R', i), A('S', i), 'B', 100, 1000, T0 + h * HOUR + i * 1000));
      e.recordPrice(101, T0 + h * HOUR + 5 * MIN);
      e.recordPrice(100, T0 + h * HOUR + 30 * MIN);
    }
    const end = T0 + 28 * HOUR;
    e.settle(end);
    e.housekeep(end);
    expect(e.build(end, T0).oos.rest.hours).toBe(24);
  });

  it('godzina z < 5 biorcami w kohorcie nie wchodzi do markoutów (liczona jako ukryta)', () => {
    const e = new CohortEngine({ coin: 'BTC', isWhale: () => false });
    for (let i = 0; i < 3; i++) e.onTrade(trade(A('R', i), A('S', i), 'B', 100, 1000, T0 + i * 1000));
    e.recordPrice(101, T0 + 5 * MIN);
    e.settle(T0 + 3 * HOUR);
    e.housekeep(T0 + 3 * HOUR);
    expect(e.build(T0 + 3 * HOUR, T0).oos.rest).toMatchObject({ hours: 0, m5: null, hiddenHours: 1 });
  });

  it('jedno zlecenie zamiatające wielu makerów to jedna obserwacja testu (blok 5 min), nie 35', () => {
    const e = new CohortEngine({ coin: 'BTC', isWhale: () => false });
    for (let i = 0; i < 35; i++) e.onTrade(trade(A('T', 1), A('M', i), 'B', 100 + i * 0.01, 0.1, T0));
    e.recordPrice(101, T0 + 5 * MIN);
    e.settle(T0 + 11 * MIN);
    expect(e.informedObservations(A('T', 1))).toBeCloseTo(1, 2);
  });

  it('market maker: ≥ 80% nominału jako maker i ≥ 1 mln USD → kohorta mm po klasyfikacji', () => {
    const e = new CohortEngine({ coin: 'BTC', isWhale: () => false });
    const mm = A('M', 1);
    for (let i = 0; i < 25; i++) e.onTrade(trade(A('R', i), mm, 'B', 100_000, 1, T0 + i * 1000));
    expect(e.cohortOf(mm)).toBe('rest');
    e.classify(T0 + MIN);
    expect(e.cohortOf(mm)).toBe('mm');
    expect(e.cohortOf(A('R', 1))).toBe('rest');
  });

  it('statystyki nieaktywnych małych adresów wypadają po 7 dniach; twardy limit liczby adresów', () => {
    const e = new CohortEngine({ coin: 'BTC', isWhale: () => false, maxStats: 50 });
    for (let i = 0; i < 40; i++) e.onTrade(trade(A('R', i), A('S', i), 'B', 100, 1, T0 + i));
    e.classify(T0 + 8 * 24 * HOUR);
    expect(e.statsSize).toBe(0);
    for (let i = 0; i < 40; i++) e.onTrade(trade(A('P', i), A('Q', i), 'B', 100_000, 10, T0 + 9 * 24 * HOUR + i));
    e.classify(T0 + 9 * 24 * HOUR + MIN);
    expect(e.statsSize).toBeLessThanOrEqual(50);
  });

  it('dokument bez adresów; stan przetrwa zapis i odczyt; uszkodzony stan nie wywraca odczytu', () => {
    const e = new CohortEngine({ coin: 'BTC', isWhale: () => false });
    for (let i = 0; i < 6; i++) e.onTrade(trade(A('R', i), A('S', i), 'A', 100_000, 1, T0 + i * 1000));
    e.classify(T0 + MIN);
    e.housekeep(AFTER_CLOSE);
    const f = e.build(AFTER_CLOSE, T0);
    expect(JSON.stringify(f)).not.toMatch(/0x[0-9a-f]{40}/i);
    const back = CohortEngine.fromJSON(JSON.parse(JSON.stringify(e.toJSON())), { coin: 'BTC', isWhale: () => false });
    expect(back.build(AFTER_CLOSE, T0)).toEqual(f);
    const broken = JSON.parse(JSON.stringify(e.toJSON()));
    broken.meta = { candidates: 1, selected: 1, at: 'x' };
    broken.buckets.push([T0 + HOUR, { mm: { parts: [null] } }]);
    expect(() => CohortEngine.fromJSON(broken, { coin: 'BTC', isWhale: () => false })).not.toThrow();
    expect(isCohortFlow(CohortEngine.fromJSON(broken, { coin: 'BTC', isWhale: () => false }).build(AFTER_CLOSE, T0))).toBe(true);
  });
});
