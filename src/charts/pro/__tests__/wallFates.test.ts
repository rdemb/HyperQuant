import { describe, expect, it } from 'vitest';
import type { BookFrame } from '../core/book';
import type { TradeScan } from '../core/ladder';
import { BEYOND_MS, MAX_GAP_MS, wallFates, wallThreshold } from '../core/wallFates';
import type { Side } from '../hl/parse';

/** Migawka kroku `step`: poziomy [cena, wielkość], najpierw bidy (malejąco), potem aski (rosnąco). */
const frame = (t: number, bids: [number, number][], asks: [number, number][], step = 1): BookFrame => {
  const all = [...bids, ...asks];
  return { t, step, px: Float64Array.from(all.map((l) => l[0])), sz: Float64Array.from(all.map((l) => l[1])), n: Float64Array.from(all.map(() => 1)), nBids: bids.length };
};

/** Taśma z listy [czas, cena, wielkość, strona agresora]. */
const tape =
  (rows: [number, number, number, Side][]): TradeScan =>
  (from, to, fn) => {
    for (const [t, px, sz, side] of rows) if (t >= from && t < to) fn(t, px, sz, side);
  };

const bids = (): [number, number][] => [
  [99, 1],
  [98, 1],
  [97, 1],
  [96, 1],
];

describe('wallFates', () => {
  it('ściana zjedzona: ubytek pokryły transakcje kupujących na jej cenie', () => {
    const frames = [frame(0, bids(), [[100, 1], [101, 100], [102, 1], [103, 1]]), frame(5000, bids(), [[100, 1], [101, 10], [102, 1], [103, 1]])];
    const { fates, open } = wallFates(frames, tape([[3000, 101, 90, 1]]), 5000);
    expect(open).toEqual([]);
    expect(fates).toHaveLength(1);
    expect(fates[0]).toMatchObject({ px: 101, bid: false, verdict: 'eaten', touched: true, since: 0, t: 5000 });
    expect(fates[0].eatenUsd).toBeCloseTo(90 * 101);
    expect(fates[0].pulledUsd).toBeCloseTo(0);
  });

  it('ściana zdjęta: zniknęła bez transakcji i bez przyrostu obok', () => {
    const frames = [frame(0, [[99, 1], [98, 80], [97, 1], [96, 1], [95, 1]], [[100, 1]]), frame(5000, [[99, 1], [97, 1], [96, 1], [95, 1]], [[100, 1]])];
    const [f] = wallFates(frames, tape([]), 5000).fates;
    expect(f).toMatchObject({ px: 98, bid: true, verdict: 'pulled', touched: false });
    expect(f.movedUsd).toBe(0);
    expect(f.pulledUsd).toBeCloseTo(80 * 98);
  });

  it('ściana przesunięta: w tej samej migawce tyle samo przybyło dwa poziomy dalej', () => {
    const frames = [frame(0, [[99, 1], [98, 80], [97, 1], [96, 1]], [[100, 1]]), frame(5000, [[99, 1], [97, 1], [96, 81], [95, 1]], [[100, 1]])];
    const [f] = wallFates(frames, tape([]), 5000).fates;
    expect(f.verdict).toBe('moved');
    // Zwykła rotacja obok (tyle samo ubyło, ile przybyło) nie udaje przeniesienia
    const churn = [frame(0, [[99, 30], [98, 80], [97, 1], [96, 1]], [[100, 1]]), frame(5000, [[99, 1], [97, 1], [96, 30], [95, 1]], [[100, 1]])];
    expect(wallFates(churn, tape([]), 5000).fates.find((x) => x.px === 98)?.verdict).toBe('pulled');
  });

  it('kubełki agregacji jak w Hyperliquid: bid b = [b, b + krok), ask a = (a − krok, a]', () => {
    const f0 = frame(0, [[100, 100], [90, 1]], [[110, 100], [120, 1]], 10);
    const f1 = frame(5000, [[100, 1], [90, 1]], [[110, 1], [120, 1]], 10);
    const scan = tape([
      [1000, 105, 99, -1], // sprzedający zdejmuje bid 105 — kubełek bidów 100
      [2000, 105, 99, 1], // kupujący zdejmuje ask 105 — kubełek asków 110
    ]);
    const fates = wallFates([f0, f1], scan, 5000).fates;
    expect(fates.map((x) => [x.px, x.verdict])).toEqual([
      [100, 'eaten'],
      [110, 'eaten'],
    ]);
  });

  it('cena poza widocznymi poziomami: bez werdyktu, ściana czeka na powrót, a po BEYOND_MS znika bez śladu', () => {
    const base = (t: number) => frame(t, [[99, 1], [98, 80], [97, 1]], [[100, 1]]);
    // Cena w górę: najgłębszy widoczny bid 101, ściana na 98 poza zasięgiem
    const up = (t: number) => frame(t, [[103, 1], [102, 1], [101, 1]], [[104, 1]]);
    const back = wallFates([base(0), up(5000), up(10_000), base(15_000)], tape([]), 5000);
    expect(back.fates).toEqual([]);
    expect(back.open).toMatchObject([{ px: 98, bid: true, since: 0 }]);
    const lost = wallFates([base(0), ...Array.from({ length: 14 }, (_, i) => up(5000 * (i + 1)))], tape([]), 5000);
    expect(5000 * 14).toBeGreaterThan(BEYOND_MS);
    expect(lost.fates).toEqual([]);
    expect(lost.open).toEqual([]);
  });

  it('przerwa w migawkach zrywa śledzenie bez werdyktu', () => {
    const frames = [frame(0, [[99, 1], [98, 80]], [[100, 1]]), frame(MAX_GAP_MS + 1, [[99, 1], [97, 1]], [[100, 1]])];
    expect(wallFates(frames, tape([]), 5000).fates).toEqual([]);
  });

  it('wallThreshold: kwantyl wartości poziomów, nie niżej niż podłoga', () => {
    const f = frame(0, Array.from({ length: 19 }, (_, i): [number, number] => [100 - i, 1]), [[200, 50]]);
    expect(wallThreshold([f], 0, 0.95)).toBeCloseTo(200 * 50);
    expect(wallThreshold([f], 1e6, 0.95)).toBe(1e6);
    expect(wallThreshold([], 7)).toBe(7);
  });
});
