import { afterEach, describe, expect, it, vi } from 'vitest';
import { count, report, reset, timed } from './deskPerf';

describe('deskPerf', () => {
  afterEach(() => {
    reset();
    vi.restoreAllMocks();
  });

  it('timed zwraca wynik i liczy czas, także gdy obliczenie rzuca', () => {
    let t = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    expect(
      timed('quant', () => {
        t += 12;
        return 7;
      })
    ).toBe(7);
    expect(() =>
      timed('quant', () => {
        t += 60;
        throw new Error('x');
      })
    ).toThrow('x');
    count('ctx');
    t = 1000 + 60_000;
    const r = report();
    const q = r.rows.find((x) => x.name === 'quant')!;
    expect(q).toMatchObject({ n: 2, maxMs: 60, over50: 1 });
    expect(q.meanMs).toBe(36);
    expect(q.perMin).toBeCloseTo(2, 2);
    expect(r.rows.find((x) => x.name === 'ctx')).toMatchObject({ n: 1, meanMs: 0 });
    expect(r.rows[0].name).toBe('quant');
  });

  it('reset czyści liczniki', () => {
    count('ctx');
    reset();
    expect(report().rows).toEqual([]);
  });
});
