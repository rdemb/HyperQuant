import { describe, expect, it } from 'vitest';
import { type BookFrame, LOT_GAP_MS, largeLots, lotThreshold } from '../core/book';

/** Migawka: poziomy [cena, wielkość, liczba zleceń], najpierw bidy. */
const frame = (t: number, bids: [number, number, number][], asks: [number, number, number][]): BookFrame => {
  const all = [...bids, ...asks];
  return {
    t,
    step: 10,
    px: Float64Array.from(all.map((l) => l[0])),
    sz: Float64Array.from(all.map((l) => l[1])),
    n: Float64Array.from(all.map((l) => l[2])),
    nBids: bids.length,
  };
};

describe('largeLots', () => {
  it('poziom z dużym średnim zleceniem trwa od pojawienia się, aż poziom straci jego wartość', () => {
    const frames = [
      frame(0, [[100, 10, 20]], [[110, 1, 1]]), // bid: 1000 USD / 20 = 50 — tłum; ask: 110 USD w 1 zleceniu
      frame(5, [[100, 10, 1]], [[110, 1, 1]]), // bid: 1000 USD w 1 zleceniu
      frame(10, [[100, 12, 2]], []), // bid: 1200 / 2 = 600 — nadal duże
      frame(15, [[100, 13, 40]], []), // dołączyły drobne: średnia spada, ale poziom wciąż mieści duże zlecenie
      frame(20, [[100, 4, 39]], []), // poziom stracił wartość dużego zlecenia — zdjęte albo wypełnione
    ];
    const lots = largeLots(frames, 500);
    expect(lots).toEqual([{ px: 100, bid: true, from: 5, to: 20, open: false, usd: 1000, orders: 1 }]);
  });

  it('znika z arkusza w zasięgu widocznych poziomów — koniec; poza zasięgiem czeka na powrót ceny', () => {
    const base = (t: number) => frame(t, [[100, 10, 1], [99, 1, 1]], [[101, 1, 1]]);
    // Bidy kończą się na 99,5 (zlecenie na 100 zniknęło w zasięgu)
    expect(largeLots([base(0), frame(5, [[100.5, 1, 1], [99.5, 1, 1]], [[101, 1, 1]])], 500)[0]).toMatchObject({ to: 5, open: false });
    // Cena poszła w górę: najgłębszy bid 100,5 — zlecenie na 100 poza zasięgiem, potem znów widoczne
    const up = (t: number) => frame(t, [[102, 1, 1], [100.5, 1, 1]], [[103, 1, 1]]);
    const back = largeLots([base(0), up(5), up(30), base(55)], 500);
    expect(back).toEqual([{ px: 100, bid: true, from: 0, to: 55, open: true, usd: 1000, orders: 1 }]);
    // Poza zasięgiem dłużej niż LOT_GAP_MS — koniec w ostatniej migawce, w której było widać zlecenie
    const gone = largeLots([base(0), up(5), up(LOT_GAP_MS + 1)], 500);
    expect(gone[0]).toMatchObject({ to: 0, open: false });
    // Ostatnia migawka bez zlecenia (poza zasięgiem) — nie jest otwarte
    expect(largeLots([base(0), up(5)], 500)[0]).toMatchObject({ to: 0, open: false });
  });

  it('poziom w najnowszej migawce jest otwarty; strony liczone osobno', () => {
    const frames = [frame(0, [[100, 10, 1]], [[100.5, 10, 1]]), frame(5, [[100, 10, 1]], [[100.5, 10, 1]])];
    const lots = largeLots(frames, 500);
    expect(lots.map((l) => [l.bid, l.open, l.to])).toEqual([
      [true, true, 5],
      [false, true, 5],
    ]);
  });

  it('pomija poziomy bez liczby zleceń', () => {
    expect(largeLots([frame(0, [[100, 10, Number.NaN]], [])], 1)).toEqual([]);
  });
});

describe('lotThreshold', () => {
  it('kwantyl średniego zlecenia poziomu, nie niżej niż próg minimalny', () => {
    // 100 poziomów: średnie zlecenie 1…100 USD (cena 1, wielkość k, 1 zlecenie)
    const levels: [number, number, number][] = Array.from({ length: 100 }, (_, k) => [1, k + 1, 1]);
    const f = frame(0, levels.slice(0, 50), levels.slice(50));
    expect(lotThreshold([f], 10)).toBe(100);
    expect(lotThreshold([f], 10, 0.5)).toBe(51);
    expect(lotThreshold([f], 80, 0.5)).toBe(80);
  });

  it('bez migawek albo bez liczby zleceń — próg minimalny', () => {
    expect(lotThreshold([], 500)).toBe(500);
    expect(lotThreshold([frame(0, [[100, 1, Number.NaN]], [])], 500)).toBe(500);
  });
});
