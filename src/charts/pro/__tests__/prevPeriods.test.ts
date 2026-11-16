import { describe, expect, it } from 'vitest';
import { periodOf, prevHighLow } from '../core/prevPeriods';
import { DAY } from '../core/time';
describe('previous UTC periods', () => {
  const asOf = Date.UTC(2026, 10, 16, 12);
  const start = Date.UTC(2026, 10, 9);
  const daily = Array.from({ length: 7 }, (_, i) => ({ t: start + i * DAY, o: 100, h: 110 + i, l: 90 - i, c: 100, v: 1, n: 1 }));
  it('uses only the complete previous week', () => {
    expect(prevHighLow([...daily, { ...daily[0], t: start + 7 * DAY, h: 999 }], 'week', asOf)).toMatchObject({ hi: 116, lo: 84, to: start + 7 * DAY });
  });
  it('rejects a missing day, including when another day is duplicated', () => {
    expect(prevHighLow([...daily.slice(0, 6), daily[0]], 'week', asOf)).toMatchObject({ why: 'partial', have: 6, need: 7 });
  });
  it('uses calendar months including year boundaries', () => {
    expect(periodOf('month', Date.UTC(2027, 0, 2))).toEqual({ from: Date.UTC(2027, 0, 1), to: Date.UTC(2027, 1, 1) });
  });
});
