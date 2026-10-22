import { describe, expect, it } from 'vitest';
import {
  addCancel,
  fitHawkes,
  hawkesLogLik,
  nelderMead,
  ofiEvent,
  olsFit,
  weightedMid,
  imbalanceAdjustment,
  absorption,
} from '../microMechanics';

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
  it('nelderMead znajduje minimum funkcji Rosenbrocka', () => {
    const r = nelderMead(([x, y]) => (1 - x) ** 2 + 100 * (y - x * x) ** 2, [-1.2, 1], { maxIter: 4000, tol: 1e-12 });
    expect(r.x[0]).toBeCloseTo(1, 3);
    expect(r.x[1]).toBeCloseTo(1, 3);
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
});
