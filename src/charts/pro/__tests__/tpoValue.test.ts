import { describe, expect, it } from 'vitest';
import { tpoValue } from '../core/tpoValue';
describe('TPO value from time', () => {
  it('uses time counts and expands pairs to 70%', () => {
    expect(tpoValue([1, 2, 10, 4, 3, 1])).toEqual({ poc: 2, lo: 2, hi: 4 });
  });
  it('resolves POC ties nearest the range midpoint', () => {
    expect(tpoValue([5, 1, 5, 1, 1]).poc).toBe(2);
  });
  it('resolves equal pairs towards the previous POC, otherwise up', () => {
    expect(tpoValue([2, 2, 6, 2, 2])).toEqual({ poc: 2, lo: 2, hi: 4 });
    expect(tpoValue([2, 2, 6, 2, 2], 0)).toEqual({ poc: 2, lo: 0, hi: 2 });
  });
});
