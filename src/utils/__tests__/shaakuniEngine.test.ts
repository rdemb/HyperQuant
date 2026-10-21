import { describe, expect, it } from 'vitest';
import { computeShaakuniIndicator, nyHourInTimeZone } from '../shaakuniEngine';
import { buildHyperliquidBar, recalculateIndicatorSeries } from '../marketDataFeed';
import { ShaakuniConfig } from '../../types/trading';

describe('nyHourInTimeZone — godziny sesji NY w czasie PL (DST przez Intl)', () => {
  it('zwykły okres: NY 02:00 = PL 08:00', () => {
    expect(nyHourInTimeZone(2, Date.parse('2026-10-21T12:00:00Z'), 'Europe/Warsaw').hour).toBe(8);
  });
  it('rozjazd DST (UE już zima, USA jeszcze lato): NY 02:00 = PL 07:00', () => {
    expect(nyHourInTimeZone(2, Date.parse('2026-10-27T12:00:00Z'), 'Europe/Warsaw').hour).toBe(7);
  });
  it('wiosenny rozjazd 2027: NY 07:00 = PL 12:00', () => {
    expect(nyHourInTimeZone(7, Date.parse('2027-03-20T12:00:00Z'), 'Europe/Warsaw').hour).toBe(12);
  });
  it('po zmianie czasu w USA wraca +6h', () => {
    expect(nyHourInTimeZone(20, Date.parse('2026-11-03T12:00:00Z'), 'Europe/Warsaw').hour).toBe(2);
  });
});

describe('computeShaakuniIndicator — brak zakodowanych poziomów', () => {
  const config: ShaakuniConfig = {
    tzChoice: 'Auto (DST)',
    showWeek: true,
    showEQ: true,
    showPrevW: true,
    showDay: true,
    showDEQ: true,
    showOB: true,
    showFresh: true,
    showMit: false,
    obSwingLen: 10,
    impMult: 0.7,
    showKeltner: true,
    showLiqHeatmap: true,
    showNeuralCone: true,
  };
  const bars = recalculateIndicatorSeries(
    Array.from({ length: 40 }, (_, i) => buildHyperliquidBar(100000, 100050, 99950, 100010, 5, 50, i * 300000, 50))
  );

  it('bez danych HTF poziomy są null (nie 83 138 / 81 719)', () => {
    const s = computeShaakuniIndicator(bars, config, 300, null);
    expect(s.pdh).toBeNull();
    expect(s.pdl).toBeNull();
    expect(s.deq).toBeNull();
    expect(s.pdhStatus).toBe('Active');
  });
  it('za mało świec: również null', () => {
    const s = computeShaakuniIndicator(bars.slice(0, 5), config, 300, null);
    expect(s.pdh).toBeNull();
    expect(s.weq).toBeNull();
  });
});
