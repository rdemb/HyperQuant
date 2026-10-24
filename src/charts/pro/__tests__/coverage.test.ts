import { describe, expect, it } from 'vitest';
import { Coverage } from '../core/coverage';

describe('Coverage', () => {
  it('otwarty odcinek pokrywa wszystko od startu', () => {
    const c = new Coverage();
    c.open(100);
    expect(c.isOpen).toBe(true);
    expect(c.covers(100, 10_000)).toBe(true);
    expect(c.covers(99, 200)).toBe(false);
  });

  it('luka między odcinkami nie jest pokryta', () => {
    const c = new Coverage();
    c.open(0);
    c.close(100);
    c.open(150);
    expect(c.covers(0, 100)).toBe(true);
    expect(c.covers(50, 160)).toBe(false);
    expect(c.coveredMs(0, 200)).toBe(150);
    expect(c.snapshot(300)).toEqual([
      [0, 100],
      [150, 300],
    ]);
  });

  it('addSpan scala nakładające się i stykające odcinki', () => {
    const c = new Coverage([
      [0, 10],
      [20, 30],
    ]);
    c.addSpan(10, 20);
    expect(c.list()).toEqual([[0, 30]]);
    c.addSpan(50, 60);
    c.addSpan(40, 45);
    expect(c.list()).toEqual([
      [0, 30],
      [40, 45],
      [50, 60],
    ]);
  });

  it('prune przycina pokrycie do okna', () => {
    const c = new Coverage([
      [0, 10],
      [20, 30],
    ]);
    c.prune(25);
    expect(c.list()).toEqual([[25, 30]]);
  });

  it('zamknięcie w chwili otwarcia usuwa pusty odcinek', () => {
    const c = new Coverage();
    c.open(5);
    c.close(5);
    expect(c.list()).toEqual([]);
  });
});
