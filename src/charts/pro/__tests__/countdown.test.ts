import { describe, expect, it } from 'vitest';
import { fmtLeft } from '../chart/countdown';

describe('odliczanie do zamknięcia świecy', () => {
  it('minuty i sekundy, od godziny także godziny; ułamek sekundy w górę', () => {
    expect(fmtLeft(42_000)).toBe('0:42');
    expect(fmtLeft(41_001)).toBe('0:42');
    expect(fmtLeft(14 * 60_000 + 5_000)).toBe('14:05');
    expect(fmtLeft(3_600_000)).toBe('1:00:00');
    expect(fmtLeft(23 * 3_600_000 + 59 * 60_000 + 59_000)).toBe('23:59:59');
    expect(fmtLeft(-5)).toBe('0:00');
  });

  it('od doby dni i godziny (świece 1W i 1M)', () => {
    expect(fmtLeft(24 * 3_600_000)).toBe('1d 0h');
    expect(fmtLeft(37 * 3_600_000 + 25 * 60_000)).toBe('1d 13h');
    expect(fmtLeft(30 * 24 * 3_600_000)).toBe('30d 0h');
  });
});
