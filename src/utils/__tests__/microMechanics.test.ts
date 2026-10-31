import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addCancel,
  fitHawkes,
  hawkesLogLik,
  ofiEvent,
  olsFit,
  weightedMid,
  imbalanceAdjustment,
  absorption,
  oosR2,
} from '../microMechanics';

/** Generator LCG (deterministyczny) */
const lcg = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

describe('OFI (Cont, Kukanov, Stoikov 2014)', () => {
  const q = (bid: number, bidSz: number, ask: number, askSz: number) => ({ bid, bidSz, ask, askSz });
  it('bez zmiany cen: przyrost kupna przy bid − przyrost przy ask', () => {
    expect(ofiEvent(q(100, 5, 101, 5), q(100, 8, 101, 4))).toBe(3 - -1);
  });
  it('bid w górę: cała nowa ilość na bid; bid w dół: minus stara ilość', () => {
    expect(ofiEvent(q(100, 5, 101, 5), q(100.5, 2, 101, 5))).toBe(2);
    expect(ofiEvent(q(100, 5, 101, 5), q(99.5, 7, 101, 5))).toBe(-5);
  });
  it('ask w dół: minus nowa ilość (presja sprzedaży); ask w górę: plus stara ilość', () => {
    expect(ofiEvent(q(100, 5, 101, 5), q(100, 5, 100.5, 3))).toBe(-3);
    expect(ofiEvent(q(100, 5, 101, 5), q(100, 5, 101.5, 9))).toBe(5);
  });
});

describe('regresja i optymalizacja', () => {
  it('olsFit: β, α, R² i błąd standardowy β', () => {
    const xs = [1, 2, 3, 4, 5];
    const ys = xs.map((x) => 2 * x + 1);
    const f = olsFit(xs, ys)!;
    expect(f.beta).toBeCloseTo(2, 12);
    expect(f.alpha).toBeCloseTo(1, 12);
    expect(f.r2).toBeCloseTo(1, 12);
    expect(olsFit([1, 1, 1], [1, 2, 3])).toBeNull(); // brak zmienności x
  });
});

describe('proces Hawkesa (jądro wykładnicze)', () => {
  /** Symulacja Ogaty (thinning) dla μ, α, β na [0, T]. */
  function simulate(mu: number, alpha: number, beta: number, T: number, seed = 1): number[] {
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const out: number[] = [];
    let t = 0;
    let excite = 0; // Σ α e^{−β(t−ti)}
    while (t < T) {
      const lamBar = mu + excite;
      const w = -Math.log(rnd()) / lamBar;
      excite *= Math.exp(-beta * w);
      t += w;
      if (t >= T) break;
      if (rnd() * lamBar <= mu + excite) {
        out.push(t);
        excite += alpha;
      }
    }
    return out;
  }

  it('log-wiarygodność: proces Poissona (α = 0) = n·ln μ − μT', () => {
    const times = [0.5, 1.2, 3.3];
    expect(hawkesLogLik(times, 2, 0, 1, 5)).toBeCloseTo(3 * Math.log(2) - 10, 9);
  });

  it('MLE odzyskuje współczynnik rozgałęzienia n = α/β z symulacji', () => {
    const times = simulate(0.5, 1.2, 2, 4000, 7); // n = 0.6
    const f = fitHawkes(times)!;
    expect(f.branching).toBeGreaterThan(0.5);
    expect(f.branching).toBeLessThan(0.7);
    expect(f.mu).toBeGreaterThan(0.35);
    expect(f.mu).toBeLessThan(0.65);
  });

  it('za mało zdarzeń → null', () => {
    expect(fitHawkes([1, 2, 3])).toBeNull();
  });

  it('prawdziwa taśma: bez fałszywego optimum n = 0, w które wpadał sympleks (wiarygodność wyraźnie ponad procesem Poissona)', () => {
    const { dt } = JSON.parse(readFileSync(new URL('./fixtures/hawkes-tape.json', import.meta.url), 'utf8')) as { dt: number[] };
    let t = 0;
    const times = dt.map((d) => (t += d) / 1000);
    const f = fitHawkes(times)!;
    expect(f.n).toBe(3000);
    expect(f.branching).toBeGreaterThan(0.5);
    expect(f.branching).toBeLessThan(0.8);
    expect(f.halfLife).toBeGreaterThan(1);
    expect(f.halfLife).toBeLessThan(10);
    // Proces Poissona (n = 0) przy najlepszym μ = N/T; poprzednie dopasowanie kończyło tutaj
    const T = times[times.length - 1] - times[0] + 1e-9;
    const poisson = times.length * Math.log(times.length / T) - times.length;
    expect(f.logLik - poisson).toBeGreaterThan(50);
  });
});

describe('mikrocena i nierównowaga', () => {
  it('średnia ważona: przy większej ilości na bid bliżej ask', () => {
    expect(weightedMid(100, 3, 101, 1)).toBeCloseTo(100.75, 12);
  });
  it('korekta wg koszyków nierównowagi: średnia przyszła zmiana mid w koszyku i R² predykcji', () => {
    const samples = Array.from({ length: 1000 }, (_, i) => {
      const imb = (i % 10) / 10 + 0.05;
      return { imb, dmid: (imb - 0.5) * 2 };
    });
    const a = imbalanceAdjustment(samples, 10);
    expect(a.g[9]).toBeCloseTo(0.9, 9);
    expect(a.g[0]).toBeCloseTo(-0.9, 9);
    expect(a.r2).toBeCloseTo(1, 9);
  });
  it('symetryzacja Stoikova: sam dryf (bez związku z nierównowagą) nie tworzy korekty', () => {
    const rnd = lcg(11);
    const samples = Array.from({ length: 2000 }, () => ({ imb: rnd(), dmid: 0.8 + (rnd() - 0.5) * 0.1 }));
    const raw = imbalanceAdjustment(samples, 10);
    const sym = imbalanceAdjustment(samples, 10, { symmetric: true });
    expect(raw.g[2]).toBeCloseTo(0.8, 1);
    for (const g of sym.g) expect(Math.abs(g ?? 0)).toBeLessThan(0.05);
  });
  it('R² poza próbą (benchmark: brak zmiany): sygnał → wysoki; szum niezależny → ≤ ~0', () => {
    const rnd = lcg(5);
    const sig = Array.from({ length: 3000 }, () => {
      const imb = rnd();
      return { imb, dmid: (imb - 0.5) * 2 + (rnd() - 0.5) * 0.1 };
    });
    expect(oosR2(sig.slice(0, 2000), sig.slice(2000), 10)!).toBeGreaterThan(0.9);
    const noise = Array.from({ length: 3000 }, () => ({ imb: rnd(), dmid: rnd() - 0.5 }));
    expect(oosR2(noise.slice(0, 2000), noise.slice(2000), 10)!).toBeLessThan(0.02);
    expect(oosR2([], noise, 10)).toBeNull();
  });
});

describe('dodawanie i anulowanie zleceń', () => {
  it('ubytek ilości przy poziomie ponad wykonania = anulowanie; przyrost = dodanie', () => {
    const prev = { bids: [{ px: 100, sz: 10 }, { px: 99, sz: 5 }], asks: [{ px: 101, sz: 4 }] };
    const cur = { bids: [{ px: 100, sz: 3 }, { px: 99, sz: 8 }], asks: [{ px: 101, sz: 4 }, { px: 102, sz: 6 }] };
    const r = addCancel(prev, cur, [{ px: 100, sz: 2, side: 'sell' }], 100.5, 300);
    // bid 100: −7, z czego 2 wykonane → anulowano 5; bid 99: +3 dodane; ask 102: +6 dodane
    expect(r.bid).toEqual({ added: 3, cancelled: 5, executed: 2 });
    expect(r.ask).toEqual({ added: 6, cancelled: 0, executed: 0 });
  });
  it('ucięcie do 20 poziomów: poziom wyłaniający się na dnie widoku to nie dodanie (porównanie we wspólnym zakresie)', () => {
    // Pełny arkusz co 1 USD; widoczne 20 najlepszych. Między migawkami anulowano 1 BTC na 100 000 —
    // na dnie widoku pojawia się 99 980, który istniał wcześniej (ukryty).
    const bids = (top: number) => Array.from({ length: 20 }, (_, i) => ({ px: top - i, sz: 1 }));
    const asks = Array.from({ length: 20 }, (_, i) => ({ px: 100_001 + i, sz: 1 }));
    const r = addCancel({ bids: bids(100_000), asks }, { bids: bids(99_999), asks }, [], 100_000, 10);
    expect(r.bid).toEqual({ added: 0, cancelled: 1, executed: 0 });
    expect(r.ask).toEqual({ added: 0, cancelled: 0, executed: 0 });
  });
  it('wykonanie na poziomie spoza obu migawek (dodany i zjedzony między nimi) jest liczony', () => {
    const b = { bids: [{ px: 100, sz: 5 }], asks: [{ px: 101, sz: 5 }] };
    const r = addCancel(b, b, [{ px: 100.5, sz: 2, side: 'sell' }], 100.5, 300);
    expect(r.bid).toEqual({ added: 2, cancelled: 0, executed: 2 });
  });
});

describe('absorpcja: wysiłek vs efekt', () => {
  it('duży wolumen agresora bez ruchu ceny → zdarzenie absorpcji z resztą przeciwną do wysiłku', () => {
    const iv = Array.from({ length: 200 }, (_, i) => {
      const v = Math.sin(i) * 10;
      return { t: i * 10_000, signedVol: v, dmid: 0.5 * v + Math.cos(i * 7) * 0.2 };
    });
    iv.push({ t: 200 * 10_000, signedVol: 40, dmid: 0 }); // kupno 40, cena stoi
    const a = absorption(iv, 2);
    expect(a.lambda).toBeCloseTo(0.5, 1);
    expect(a.events.map((e) => e.t)).toContain(200 * 10_000);
    expect(a.events.find((e) => e.t === 200 * 10_000)!.side).toBe('buy');
  });
  it('punkty dźwigni nie przestawiają nachylenia (Theil–Sen) i są wykrywane jako absorpcja', () => {
    const rnd = lcg(9);
    const iv = Array.from({ length: 27 }, (_, i) => {
      const v = -5 + (10 * i) / 26;
      return { t: i * 10_000, signedVol: v, dmid: 2 * v + (rnd() - 0.5) * 0.4 };
    });
    iv.push({ t: 27e4, signedVol: 20, dmid: -10 }, { t: 28e4, signedVol: -20, dmid: 10 }, { t: 29e4, signedVol: 20, dmid: -8 });
    const a = absorption(iv, 2);
    expect(a.lambda!).toBeGreaterThan(1.7);
    expect(a.lambda!).toBeLessThan(2.3);
    expect(a.events.map((e) => e.t).sort()).toEqual([27e4, 28e4, 29e4]);
  });
  it('mały wolumen przy przesuniętej średniej nie jest „dużym wysiłkiem” (rozmiar i strona względem zera)', () => {
    const rnd = lcg(4);
    const iv = Array.from({ length: 60 }, (_, i) => {
      const v = 8 + (rnd() - 0.5) * 4;
      return { t: i * 10_000, signedVol: v, dmid: 0.5 * v + (rnd() - 0.5) * 0.5 };
    });
    iv.push({ t: 60e4, signedVol: 0.5, dmid: -3 });
    expect(absorption(iv, 2).events.map((e) => e.t)).not.toContain(60e4);
  });
});

describe('przypadki brzegowe regresji', () => {
  it('olsFit: stałe y (brak zmienności do wyjaśnienia) → null, nie R² = 1', () => {
    expect(olsFit([1, 2, 3, 4], [5, 5, 5, 5])).toBeNull();
  });
});
