import { describe, expect, it } from 'vitest';
import { decodeTailFrames, encodeTailFrames } from '../tailFrames';

const bytes = (...xs: number[]) => new Uint8Array(xs);

describe('paczka ogonów wielu rynków (skaner → przekaźnik)', () => {
  it('ramki w obie strony: nazwy (także xyz:GOLD), puste i niepuste treści', () => {
    const entries: [string, Uint8Array][] = [
      ['BTC', bytes(0x1f, 0x8b, 1, 2, 3)],
      ['xyz:GOLD', bytes(0x1f, 0x8b)],
      ['ETH', bytes()],
    ];
    const back = decodeTailFrames(encodeTailFrames(entries))!;
    expect(back.map(([c, b]) => [c, [...b]])).toEqual(entries.map(([c, b]) => [c, [...b]]));
    expect(decodeTailFrames(encodeTailFrames([]))).toEqual([]);
  });

  it('ucięta albo zła paczka — null (bez wyjątku); zła nazwa przy kodowaniu — wyjątek', () => {
    const ok = encodeTailFrames([['BTC', bytes(1, 2, 3)]]);
    expect(decodeTailFrames(ok.subarray(0, ok.length - 1))).toBeNull();
    expect(decodeTailFrames(bytes(0, 0))).toBeNull();
    expect(decodeTailFrames(bytes(0, 1, 0xff, 0, 0, 0, 0))).toBeNull(); // nazwa spoza UTF-8
    expect(() => encodeTailFrames([['', bytes()]])).toThrow();
  });
});
