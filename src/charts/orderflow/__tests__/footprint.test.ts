import { describe, expect, it } from 'vitest';
import { IMB_BUY, IMB_SELL, bucketIndex, detectImbalances, fmtVol, pocIndex, valueArea } from '../footprint';

describe('bucketIndex', () => {
  it('przypisuje cenę do kubełka po dolnej krawędzi', () => {
    expect(bucketIndex(100000, 5)).toBe(20000);
    expect(bucketIndex(100004.9, 5)).toBe(20000);
    expect(bucketIndex(100005, 5)).toBe(20001);
    expect(bucketIndex(99999.5, 10)).toBe(9999);
  });
});

describe('detectImbalances (diagonalnie, 3:1)', () => {
  it('kupno: ask[p] ≥ 3 × bid[p−1]; sprzedaż: bid[p] ≥ 3 × ask[p+1]', () => {
    // wiersze rosnąco wg ceny
    const bid = [6, 1, 2, 0.5];
    const ask = [1, 3.2, 1, 9];
    const out = new Uint8Array(4);
    detectImbalances(bid, ask, 4, 3, 0, out);
    // wiersz 1: ask 3.2 vs bid[0] 6 → nie; wiersz 3: ask 9 vs bid[2] 2 → 4.5:1 → tak
    expect(out[1] & IMB_BUY).toBe(0);
    expect(out[3] & IMB_BUY).toBe(IMB_BUY);
    // wiersz 0: bid 6 vs ask[1] 3.2 → 1.9:1 nie; wiersz 2: bid 2 vs ask[3] 9 → nie
    expect(out[0] & IMB_SELL).toBe(0);
    expect(out[2] & IMB_SELL).toBe(0);
  });

  it('dokładnie 3:1 jest nierównowagą; najniższy ask i najwyższy bid nie mają przekątnej', () => {
    const bid = [1, 0, 3];
    const ask = [5, 3, 1];
    const out = new Uint8Array(3);
    detectImbalances(bid, ask, 3, 3, 0, out);
    expect(out[0] & IMB_BUY).toBe(0); // brak bid[−1]
    expect(out[1] & IMB_BUY).toBe(IMB_BUY); // 3 vs 1 → 3:1
    expect(out[2] & IMB_SELL).toBe(0); // brak ask[3]
  });

  it('zero po drugiej stronie przekątnej liczy się tylko powyżej progu wolumenu', () => {
    const bid = [0, 0];
    const ask = [0, 0.2];
    const out = new Uint8Array(2);
    detectImbalances(bid, ask, 2, 3, 0.5, out);
    expect(out[1]).toBe(0);
    detectImbalances(bid, [0, 0.8], 2, 3, 0.5, out);
    expect(out[1] & IMB_BUY).toBe(IMB_BUY);
  });
});

describe('pocIndex', () => {
  it('zwraca wiersz o największym wolumenie (remis → niższa cena)', () => {
    expect(pocIndex([1, 5, 3, 5], 4)).toBe(1);
    expect(pocIndex([0, 0], 2)).toBe(-1);
  });
});

describe('valueArea (70%)', () => {
  it('rozszerza od POC w stronę większego sąsiada aż do 70% wolumenu', () => {
    const v = [1, 2, 10, 4, 3, 1];
    // suma 21 → cel 14.7: POC 2 (10) → +4 (14) → +3 (17)
    const va = valueArea(v, 6, 0.7);
    expect(va).toEqual({ poc: 2, lo: 2, hi: 4 });
  });

  it('pusty profil → null', () => {
    expect(valueArea([0, 0, 0], 3)).toBeNull();
  });
});

describe('fmtVol', () => {
  it('maksymalnie 4 znaki dla typowych wolumenów BTC (po polsku przecinek dziesiętny)', () => {
    expect(fmtVol(0)).toBe('0');
    expect(fmtVol(0.004)).toBe('<,01');
    expect(fmtVol(0.42)).toBe('0,42');
    expect(fmtVol(2.346)).toBe('2,35');
    expect(fmtVol(24.46)).toBe('24,5');
    expect(fmtVol(245.4)).toBe('245');
    expect(fmtVol(1234)).toBe('1,2K');
  });
});
