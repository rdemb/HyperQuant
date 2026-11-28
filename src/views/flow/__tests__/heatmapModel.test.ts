import { describe, expect, it } from 'vitest';
import type { BookFrame } from '../../../charts/pro/core/book';
import { FRAME_MAX_MS, bestQuotes, bubbleRadius, frameAt, frameColumns, frameSpan, priceTicks, priceWindow, quantile, timeTicks } from '../heatmapModel';

const frame = (t: number, bids: number[], asks: number[], step = 10): BookFrame => {
  const px = [...bids, ...asks];
  return { t, step, px: new Float64Array(px), sz: new Float64Array(px.map(() => 1)), n: new Float64Array(px.map(() => 1)), nBids: bids.length };
};

describe('geometria heatmapy płynności', () => {
  it('okno ceny: `rows` kroków wokół środka na siatce kroku', () => {
    expect(priceWindow(60_003, 10, 40)).toEqual({ lo: 59_800, hi: 60_200 });
    expect(priceWindow(Number.NaN, 10, 40).lo).toBeNaN();
  });

  it('kolumny: migawka do następnej, najwyżej FRAME_MAX_MS i do teraz; poza oknem pominięta', () => {
    const fs = [frame(0, [1], [2]), frame(10_000, [1], [2]), frame(200_000, [1], [2])];
    const cols = frameColumns(fs, 0, 300_000, 300, 250_000);
    // 1 px = 1 s: [0,10) s, [10, 10+60) s (luka po 70 s zostaje pusta), [200, 250) s (do teraz)
    expect(cols.map((c) => [c.x0, c.x1])).toEqual([
      [0, 10],
      [10, 10 + FRAME_MAX_MS / 1000],
      [200, 250],
    ]);
    expect(frameColumns(fs, 300_000, 400_000, 100, 450_000)).toEqual([]);
  });

  it('czoło arkusza, zakres migawki i migawka w chwili t (najwyżej FRAME_MAX_MS wstecz)', () => {
    const f = frame(5_000, [100, 90, 80], [110, 120]);
    expect(bestQuotes(f)).toEqual({ bid: 100, ask: 110 });
    expect(frameSpan(f)).toEqual([80, 120]);
    expect(bestQuotes(frame(0, [], [5])).bid).toBeNaN();
    const list = [frame(0, [1], [2]), f];
    expect(frameAt(list, 4_999)?.t).toBe(0);
    expect(frameAt(list, 5_000)?.t).toBe(5_000);
    expect(frameAt(list, 5_000 + FRAME_MAX_MS + 1)).toBeNull();
    expect(frameAt(list, -1)).toBeNull();
  });

  it('bąble: pole proporcjonalne do wartości, w granicach; kwantyl próbki', () => {
    expect(bubbleRadius(1_000_000, 1_000_000)).toBe(18);
    expect(bubbleRadius(250_000, 1_000_000)).toBe(9);
    expect(bubbleRadius(1, 1_000_000)).toBe(1.5);
    expect(bubbleRadius(5e7, 1_000_000)).toBe(18);
    expect(quantile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(quantile([], 0.9)).toBeNaN();
  });

  it('podziałki: czas w pełnych krokach, cena co kilka kroków bez zagęszczenia', () => {
    expect(timeTicks(0, 15 * 60_000)).toEqual([0, 5, 10, 15].map((m) => m * 60_000));
    const ticks = priceTicks({ lo: 59_800, hi: 60_200 }, 10, 280);
    expect(ticks[0]).toBeGreaterThanOrEqual(59_800);
    expect(ticks.length).toBeLessThanOrEqual(11);
    expect(ticks.every((p) => p % 10 === 0)).toBe(true);
  });
});
