import { describe, expect, it } from 'vitest';
import { pinnedEdge, vwapAutoscale } from '../chart/overlay';
import type { ProBar } from '../store/proStore';

/** Świece wokół `mid` z zakresem ±`half` (bez footprintu). */
const bars = (n: number, mid: number, half: number): ProBar[] =>
  Array.from({ length: n }, (_, i) => ({
    t: i * 60_000,
    candle: { t: i * 60_000, o: mid, h: mid + half, l: mid - half, c: mid, v: 1, n: 1 },
    fp: null,
    share: Number.NaN,
    complete: false,
  }));
const line = (n: number, vwap: number) => Array.from({ length: n }, () => ({ vwap }) as never);

describe('VWAP w autoskali: tylko blisko świec', () => {
  it('przy zbliżeniu (mało świec) skala należy do ceny', () => {
    expect(vwapAutoscale(bars(20, 100, 1), [line(20, 101)], 0, 19)).toBeNull();
  });

  it('VWAP blisko świec wchodzi do skali (świece zachowują co najmniej 2/3 wysokości)', () => {
    // świece 99–101, VWAP 101,5: razem 99–101,5 = 1,25 × zakres świec
    expect(vwapAutoscale(bars(150, 100, 1), [line(150, 101.5)], 0, 149)).toEqual({ minValue: 101.5, maxValue: 101.5 });
  });

  it('daleki VWAP nie ściska świec (1m: VWAP dnia 1,4% od ceny przy zakresie 0,4%)', () => {
    // świece 59 660–59 900, VWAP 60 629: skala z VWAP byłaby ~4 × zakres świec
    expect(vwapAutoscale(bars(150, 59_780, 120), [line(150, 60_629)], 0, 149)).toBeNull();
  });

  it('bez widocznych świec zostaje sam VWAP; bez VWAP — nic', () => {
    expect(vwapAutoscale([], [line(150, 100)], 0, 149)).toEqual({ minValue: 100, maxValue: 100 });
    expect(vwapAutoscale(bars(150, 100, 1), [null], 0, 149)).toBeNull();
  });
});

describe('VWAP poza skalą: etykieta przy krawędzi ze strzałką w stronę ceny', () => {
  it('nad panelem — u góry ze strzałką w górę, pod panelem — u dołu ze strzałką w dół', () => {
    expect(pinnedEdge(-40, 500, 8)).toEqual({ y: 8, arrow: '↑' });
    expect(pinnedEdge(900, 500, 8)).toEqual({ y: 492, arrow: '↓' });
  });

  it('w panelu bez zmian; brak współrzędnej zostaje brakiem', () => {
    expect(pinnedEdge(250, 500, 8)).toEqual({ y: 250, arrow: '' });
    expect(pinnedEdge(Number.NaN, 500, 8).y).toBeNaN();
  });
});
