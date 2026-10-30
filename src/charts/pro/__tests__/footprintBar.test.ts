import { describe, expect, it } from 'vitest';
import { IMB_BUY, IMB_SELL } from '../../orderflow/footprint';
import { bookSigFigs } from '../core/book';
import { FootprintBuilder, aggregateRows, hlTick, rowAt, rowIndex, stackedRuns } from '../core/footprintBar';

function build(trades: [number, number, number, 1 | -1][]) {
  const b = new FootprintBuilder(0, 1);
  for (const [t, px, sz, side] of trades) b.add(t, px, sz, side);
  return b.build()!;
}

describe('hlTick', () => {
  it('5 cyfr znaczących ceny BTC, a cena całkowita zawsze dozwolona (od 100 tys. nadal 1 USD)', () => {
    expect(hlTick(80000)).toBe(1);
    expect(hlTick(81234)).toBe(1);
    expect(hlTick(100500)).toBe(1);
    expect(hlTick(123456)).toBe(1);
    expect(hlTick(123456, 5)).toBe(1);
    expect(hlTick(9876.5)).toBe(0.1);
    expect(hlTick(2.5, 5)).toBe(0.1); // ograniczenie 10^−(6 − szDecimals)
  });

  it('tick i agregacje arkusza ETH, SOL i HYPE proporcjonalne do ceny', () => {
    expect(hlTick(2802.9)).toBe(0.1);
    expect(hlTick(195.07)).toBeCloseTo(0.01, 12);
    expect(hlTick(36.837)).toBeCloseTo(0.001, 12);
    // krok bliski = 10^(cyfry − near): BTC 10, ETH 1, SOL 0,1, HYPE 0,01
    expect(bookSigFigs(75_000)).toEqual({ near: 4, far: 3 });
    expect(bookSigFigs(105_000)).toEqual({ near: 5, far: 4 });
    expect(bookSigFigs(2_800)).toEqual({ near: 4, far: 3 });
    expect(bookSigFigs(195)).toEqual({ near: 4, far: 3 });
    expect(bookSigFigs(36.8)).toEqual({ near: 4, far: 3 });
  });

  it('rowIndex nie gubi wiersza przez błąd zmiennoprzecinkowy', () => {
    expect(rowIndex(0.3, 0.1)).toBe(3);
    expect(rowIndex(81239.99, 10)).toBe(8123);
  });
});

describe('FootprintBuilder', () => {
  it('liczy wolumeny stron, deltę z maksimum i minimum oraz OHLC z taśmy', () => {
    const fp = build([
      [1, 100, 2, 1],
      [2, 101, 1, 1],
      [3, 99, 5, -1],
      [4, 100, 1, 1],
    ]);
    expect(fp.buyVol).toBe(4);
    expect(fp.sellVol).toBe(5);
    expect(fp.delta).toBe(-1);
    expect(fp.maxDelta).toBe(3);
    expect(fp.minDelta).toBe(-2);
    expect([fp.open, fp.high, fp.low, fp.close]).toEqual([100, 101, 99, 100]);
    expect(fp.lo).toBe(99);
    expect([...fp.buy]).toEqual([0, 3, 1]);
    expect([...fp.sell]).toEqual([5, 0, 0]);
    expect(fp.trades).toBe(4);
    expect(fp.buyTrades).toBe(3);
  });

  it('zapamiętuje deltę w chwili ostatniego dotknięcia szczytu i dołka', () => {
    // kupujący pchają do 102 (delta +4), potem sprzedaż oddaje 6 → od szczytu −6
    const fp = build([
      [1, 100, 1, 1],
      [2, 102, 3, 1],
      [3, 101, 6, -1],
    ]);
    expect(fp.deltaAtHigh).toBe(4);
    expect(fp.delta - fp.deltaAtHigh).toBe(-6);
    expect(fp.deltaAtLow).toBe(1); // dołek = otwarcie 100 po pierwszej transakcji
  });

  it('bez podanego ticku bierze tick Hyperliquid z ceny pierwszej transakcji', () => {
    const b = new FootprintBuilder(0);
    b.add(1, 81234, 1, 1);
    expect(b.build()!.tick).toBe(1);
  });

  it('pusty builder nie buduje świecy', () => {
    expect(new FootprintBuilder(0).build()).toBeNull();
  });
});

describe('aggregateRows', () => {
  it('sumuje ticki do wiersza 5 USD i wyznacza POC oraz value area', () => {
    const fp = build([
      [1, 100, 1, 1],
      [2, 103, 2, -1],
      [3, 105, 10, 1],
      [4, 109, 1, -1],
      [5, 111, 1, 1],
    ]);
    const r = aggregateRows(fp, 5, { ratio: 3, minVol: 0 });
    expect(r.step).toBe(5);
    expect(r.lo).toBe(20); // 100 / 5
    expect(r.n).toBe(3);
    expect([...r.buy]).toEqual([1, 10, 1]);
    expect([...r.sell]).toEqual([2, 1, 0]);
    expect(r.poc).toBe(1);
    expect(r.maxVol).toBe(11);
    expect(r.maxSide).toBe(10);
  });

  it('wiersz mniejszy niż tick bazowy jest podnoszony do ticku', () => {
    const fp = build([[1, 100, 1, 1]]);
    expect(aggregateRows(fp, 0.5, { ratio: 3, minVol: 0 }).step).toBe(1);
  });

  it('nierównowaga diagonalna: kupno w p kontra sprzedaż w p − 1', () => {
    const fp = build([
      [1, 100, 1, -1],
      [2, 101, 4, 1],
      [3, 102, 0.5, 1],
    ]);
    const r = aggregateRows(fp, 1, { ratio: 3, minVol: 0 });
    expect(r.imb[1] & IMB_BUY).toBe(IMB_BUY); // 4 ≥ 3 × 1
    expect(r.imb[0] & IMB_SELL).toBe(0); // 1 < 3 × 4
  });
});

describe('rowAt', () => {
  const fp = build([
    [1, 100, 1, 1],
    [2, 104, 1, -1],
    [3, 112, 1, 1],
  ]);

  it('tick: wiersz ceny P obejmuje P ± pół ticku', () => {
    const r = aggregateRows(fp, 1, { ratio: 3, minVol: 0 });
    expect(rowAt(r, 1, 100)).toBe(0);
    expect(rowAt(r, 1, 100.49)).toBe(0);
    expect(rowAt(r, 1, 100.5)).toBe(1);
    expect(rowAt(r, 1, 99.6)).toBe(0);
    expect(rowAt(r, 1, 99.4)).toBe(-1);
    expect(rowAt(r, 1, 112.4)).toBe(12);
    expect(rowAt(r, 1, 112.6)).toBe(-1);
  });

  it('wiersz zagregowany obejmuje ceny k·step … (k+1)·step − tick', () => {
    const r = aggregateRows(fp, 5, { ratio: 3, minVol: 0 });
    expect(rowAt(r, 1, 104)).toBe(0);
    expect(rowAt(r, 1, 104.6)).toBe(1);
    expect(rowAt(r, 1, 112)).toBe(2);
    expect(rowAt(r, 1, 115)).toBe(-1);
  });
});

describe('stackedRuns', () => {
  it('znajduje serie ≥ 3 kolejnych nierównowag po jednej stronie', () => {
    const imb = Uint8Array.from([IMB_BUY, IMB_BUY, IMB_BUY, 0, IMB_SELL, IMB_SELL, IMB_BUY, IMB_BUY]);
    expect(stackedRuns(imb, imb.length, 3)).toEqual([{ side: 1, from: 0, to: 2 }]);
    expect(stackedRuns(imb, imb.length, 2)).toEqual([
      { side: 1, from: 0, to: 2 },
      { side: -1, from: 4, to: 5 },
      { side: 1, from: 6, to: 7 },
    ]);
  });
});
