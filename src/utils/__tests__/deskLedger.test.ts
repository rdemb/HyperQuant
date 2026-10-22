import { describe, expect, it } from 'vitest';
import { calibrate, ledgerFreshness, type DeskLedgerSummary } from '../deskLedger';

describe('calibrate — mapa izotoniczna (funkcja schodkowa)', () => {
  const map: [number, number][] = [
    [0.05, 0.02],
    [0.3, 0.2],
    [0.6, 0.45],
  ];
  it('wartość ostatniego punktu z p_i ≤ p; przed pierwszym — pierwszy; pusta mapa → null', () => {
    expect(calibrate(map, 0.01)).toBe(0.02);
    expect(calibrate(map, 0.3)).toBe(0.2);
    expect(calibrate(map, 0.59)).toBe(0.2);
    expect(calibrate(map, 0.9)).toBe(0.45);
    expect(calibrate([], 0.5)).toBeNull();
    expect(calibrate(map, Number.NaN)).toBeNull();
  });
});

describe('ledgerFreshness', () => {
  const s = (asOf: number) => ({ asOf }) as DeskLedgerSummary;
  it('≤ 35 min ready, ≤ 3 h stale, potem expired', () => {
    const now = 10 * 3_600_000;
    expect(ledgerFreshness(s(now - 20 * 60_000), now)).toBe('ready');
    expect(ledgerFreshness(s(now - 60 * 60_000), now)).toBe('stale');
    expect(ledgerFreshness(s(now - 4 * 3_600_000), now)).toBe('expired');
  });
});
