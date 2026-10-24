import { describe, expect, it } from 'vitest';
import { FootprintBuilder } from '../core/footprintBar';
import { ZoneBar, imbalanceZones, niceStep, unfinishedAuctions, zoneStep } from '../core/zones';

const M1 = 60_000;
const IMB = { ratio: 3, minVol: 0 };

/** Świeca z taśmą: transakcje [cena, wielkość, strona]. */
function bar(t: number, trades: [number, number, 1 | -1][], complete = true): ZoneBar {
  const b = new FootprintBuilder(t, 1);
  trades.forEach(([px, sz, side], i) => b.add(t + i, px, sz, side));
  const fp = b.build()!;
  return { t, high: fp.high, low: fp.low, fp, complete };
}

const plain = (t: number, low: number, high: number): ZoneBar => ({ t, low, high, fp: null, complete: false });

describe('siatka stref', () => {
  it('krok 1, 2, 5 × 10^k od mediany zakresu świec, nie mniej niż tick', () => {
    expect(niceStep(3.2, 1)).toBe(5);
    expect(niceStep(0.4, 1)).toBe(1);
    expect(niceStep(12, 1)).toBe(20);
    const bars = [bar(0, [[100, 1, 1], [160, 1, 1]]), bar(M1, [[100, 1, 1], [130, 1, 1]])];
    // Mediana zakresu 60 (górny środek z dwóch) → 60 / 12 = 5
    expect(zoneStep(bars, 0)).toBe(5);
    expect(zoneStep(bars, 10)).toBe(10);
    expect(zoneStep([plain(0, 1, 2)], 0)).toBe(0);
  });
});

describe('strefy nierównowagi', () => {
  // Kupno w wierszach 101–103 trzy razy większe niż sprzedaż wiersz niżej (100–102): seria trzech wierszy
  const stacked = bar(0, [
    [100, 1, -1],
    [101, 1, -1],
    [102, 1, -1],
    [101, 4, 1],
    [102, 4, 1],
    [103, 4, 1],
  ]);

  it('seria kupna trwa, dopóki cena nie zejdzie pod strefę; wejście w strefę to test', () => {
    const zones = imbalanceZones([stacked, plain(M1, 102, 110), plain(2 * M1, 99, 105)], 1, IMB, 3);
    expect(zones).toHaveLength(1);
    const z = zones[0];
    expect(z.side).toBe(1);
    expect([z.lo, z.hi]).toEqual([101, 104]);
    expect(z.tests).toBe(1);
    expect(z.to).toBe(2 * M1);
  });

  it('bez zamknięcia strefa zostaje otwarta; krótsza seria niż minimum nie jest strefą', () => {
    expect(imbalanceZones([stacked, plain(M1, 105, 110)], 1, IMB, 3)[0].to).toBeNull();
    expect(imbalanceZones([stacked], 1, IMB, 4)).toEqual([]);
  });
});

describe('niedokończone aukcje', () => {
  it('szczyt z kupnem i sprzedażą to niedokończona aukcja do powrotu ceny; jedna strona to aukcja dokończona', () => {
    const b = bar(0, [
      [100, 1, -1],
      [105, 1, 1],
      [105, 1, -1],
    ]);
    const list = unfinishedAuctions([b, plain(M1, 100, 104), plain(2 * M1, 101, 106)], 1);
    expect(list).toEqual([{ from: 0, to: 2 * M1, px: 105, end: 1 }]);
  });

  it('dołek z obiema stronami i świeca niepełna pomijana', () => {
    const b = bar(0, [
      [100, 1, 1],
      [100, 1, -1],
      [104, 1, 1],
    ]);
    expect(unfinishedAuctions([b], 1)).toEqual([{ from: 0, to: null, px: 100, end: -1 }]);
    expect(unfinishedAuctions([{ ...b, complete: false }], 1)).toEqual([]);
  });
});
