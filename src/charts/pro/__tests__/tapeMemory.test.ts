import { describe, expect, it } from 'vitest';
import type { AggressorOrder } from '../core/orders';
import { TWAP_GAP_MS, tapeGap, tapePace, tapeRows } from '../core/tapeMemory';
import type { Side } from '../hl/parse';

const order = (time: number, taker: string, notional: number, side: Side = 1, zero = false): AggressorOrder => {
  const o: AggressorOrder = { time, side, sz: notional / 100, notional, vwap: 100, pxFirst: 100, pxLast: 100, fills: 1, levels: 1, taker, makers: 1, topMakerUsd: notional };
  if (zero) o.zero = true;
  return o;
};

describe('tapeRows', () => {
  it('plasterki TWAP jednego konta i strony sklejone w jeden wiersz; filtr wartości liczy sumę', () => {
    // Od najnowszego: trzy plasterki po 4 000 USD co 30 s i zwykłe zlecenie 20 000 USD
    const orders = [order(90_000, 'x', 4000, 1, true), order(80_000, 'y', 20_000), order(60_000, 'x', 4000, 1, true), order(30_000, 'x', 4000, 1, true)];
    const rows = tapeRows(orders, 10_000, 100_000, 50, 90_000);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: 'twap', slices: 3, usd: 12_000, first: 30_000, last: 90_000 });
    expect(rows[1]).toMatchObject({ kind: 'order' });
    // Za mała suma — TWAP pod progiem znika jak zwykłe zlecenie
    expect(tapeRows(orders, 15_000, 100_000, 50, 90_000).map((r) => r.kind)).toEqual(['order']);
  });

  it('przerwa dłuższa niż TWAP_GAP_MS albo inna strona zaczyna nowy wiersz', () => {
    const orders = [order(200_000, 'x', 6000, 1, true), order(200_000 - TWAP_GAP_MS - 1, 'x', 6000, 1, true), order(100_000, 'x', 6000, -1, true)];
    const rows = tapeRows(orders, 0, 100_000, 50, 200_000);
    expect(rows.map((r) => (r.kind === 'twap' ? r.slices : 0))).toEqual([1, 1, 1]);
  });

  it('licznik zleceń tego samego konta w oknie 15 min', () => {
    const now = 1_000_000;
    const orders = [order(now, 'a', 20_000), order(now - 1000, 'a', 20_000), order(now - 2000, 'b', 20_000), order(now - 16 * 60_000, 'a', 20_000)];
    const rows = tapeRows(orders, 0, 100_000, 50, now);
    expect(rows.map((r) => (r.kind === 'order' ? r.repeat : -1))).toEqual([2, 2, 1, 2]);
  });

  it('bitwa z jednym makerem od połowy progu dużego zlecenia', () => {
    const o = order(1, 'a', 200_000);
    const [r] = tapeRows([o], 0, 100_000, 50, 1);
    expect(r).toMatchObject({ kind: 'order', cls: 'clash' });
  });
});

describe('tapePace', () => {
  it('ostatnia minuta wobec mediany pełnych minut z nagraniem; za krótkie nagranie = NaN', () => {
    const now = 120 * 60_000 + 30_000;
    // Każda pełna minuta: 1 transakcja 1 000 USD; ostatnia minuta: kupno 3 000 i sprzedaż 1 000
    const rows: [number, number, number, Side][] = [];
    for (let m = 60; m < 120; m++) rows.push([m * 60_000 + 10, 100, 10, 1]);
    rows.push([now - 1000, 100, 30, 1], [now - 2000, 100, 10, -1]);
    const scan = (from: number, to: number, fn: (t: number, px: number, sz: number, side: Side) => void) => {
      for (const [t, px, sz, side] of rows) if (t >= from && t < to) fn(t, px, sz, side);
    };
    const p = tapePace(scan, now, () => true);
    expect(p.usd1m).toBeCloseTo(4000);
    expect(p.buyShare).toBeCloseTo(0.75);
    expect(p.median).toBeCloseTo(1000);
    expect(p.minutes).toBe(60);
    expect(Number.isNaN(tapePace(scan, now, () => false).median)).toBe(true);
  });

  it('ostatnia minuta bez nagrania (zerwane połączenie) to brak danych, nie zero; minuta bez transakcji to 0 bez udziału kupujących', () => {
    const now = 120 * 60_000 + 30_000;
    const rows: [number, number, number, Side][] = [];
    for (let m = 60; m < 119; m++) rows.push([m * 60_000 + 10, 100, 10, 1]);
    const scan = (from: number, to: number, fn: (t: number, px: number, sz: number, side: Side) => void) => {
      for (const [t, px, sz, side] of rows) if (t >= from && t < to) fn(t, px, sz, side);
    };
    // Nagranie urwało się 2 min temu: pełne minuty godziny są, ostatniej minuty nie ma
    const cut = now - 120_000;
    const p = tapePace(scan, now, (a, b) => b <= cut);
    expect([Number.isNaN(p.usd1m), Number.isNaN(p.buyShare)]).toEqual([true, true]);
    // Nagranie trwa, ale w ostatniej minucie nie było transakcji
    const q = tapePace(scan, now, () => true);
    expect(q.usd1m).toBe(0);
    expect(Number.isNaN(q.buyShare)).toBe(true);
  });
});

describe('tapeGap', () => {
  it('najdłuższa niepokryta część przedziału; krótsze niż minMs pomijane', () => {
    const spans: [number, number][] = [
      [0, 100],
      [105, 200],
      [500, 1000],
    ];
    expect(tapeGap(spans, 50, 700, 10)).toEqual([200, 500]);
    expect(tapeGap(spans, 50, 150, 10)).toBeNull();
    expect(tapeGap(spans, 50, 150, 3)).toEqual([100, 105]);
    // Brak pokrycia na końcu i przed pierwszym odcinkiem
    expect(tapeGap(spans, 900, 1200, 10)).toEqual([1000, 1200]);
    expect(tapeGap([[100, 200]], 0, 150, 10)).toEqual([0, 100]);
    expect(tapeGap([], 0, 50, 10)).toEqual([0, 50]);
  });
});
