import { describe, expect, it } from 'vitest';
import { HIP4_PER_SIDE, selectOutcomes } from '../chart/hip4Select';

/** 14 płynnych rynków: progi co 250 USD wokół ceny 80 400 (7 nad, 7 pod). */
const px = Array.from({ length: 14 }, (_, i) => ({ px: 78_750 + i * 250 }));

describe('rynki HIP-4: które progi na wykresie (selectOutcomes)', () => {
  it(`komputer: najwyżej ${HIP4_PER_SIDE} najbliższe nad ceną i ${HIP4_PER_SIDE} pod; reszta jako liczba`, () => {
    const s = selectOutcomes(px, 80_400, false);
    expect(s.shown.map((i) => px[i].px)).toEqual([79_750, 80_000, 80_250, 80_500, 80_750, 81_000]);
    expect(s.rest).toBe(8);
  });

  it('telefon: tylko najbliższy', () => {
    const s = selectOutcomes(px, 80_400, true);
    expect(s.shown.map((i) => px[i].px)).toEqual([80_500]);
    expect(s.rest).toBe(13);
  });

  it('próg na cenie liczy się jako nad nią; bez ceny albo rynków — nic', () => {
    expect(selectOutcomes([{ px: 100 }, { px: 90 }], 100, false).shown).toEqual([1, 0]);
    expect(selectOutcomes(px, 0, false)).toEqual({ shown: [], rest: 14 });
    expect(selectOutcomes([], 80_000, true)).toEqual({ shown: [], rest: 0 });
  });
});
