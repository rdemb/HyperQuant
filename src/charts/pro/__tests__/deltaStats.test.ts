import { describe, expect, it } from 'vitest';
import { deltaStatsParts } from '../chart/paneLegend';

const texts = (p: { text: string }[]) => p.map((x) => x.text);

describe('liczby taśmy świecy w opisie panelu delty albo CVD', () => {
  it('delta z udziałem, maksimum, minimum, transakcje i udział taśmy', () => {
    const p = deltaStatsParts({ fp: { delta: 0.06, buyVol: 1.53, sellVol: 1.47, maxDelta: 0.89, minDelta: -0.37, trades: 152 }, share: 1, complete: true });
    expect(texts(p)).toEqual(['(2%)', 'max', '+0,89', 'min', '−0,37', 'Transakcje', '152', 'Taśma', '100%']);
  });

  it('świeca częściowo nagrana: udział taśmy z dopiskiem; brak taśmy — bez liczb', () => {
    const p = deltaStatsParts({ fp: { delta: -1, buyVol: 0, sellVol: 1, maxDelta: 0, minDelta: -1, trades: 3 }, share: 0.23, complete: false });
    expect(texts(p).slice(-2)).toEqual(['Taśma', '23% · częściowa']);
    expect(deltaStatsParts({ fp: null, share: Number.NaN, complete: false })).toEqual([]);
  });
});
