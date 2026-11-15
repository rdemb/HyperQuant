import { describe, expect, it } from 'vitest';
import { deskMarketOf } from '../../config/deskMarkets';
import { sessionAnchor } from '../sessionAnchor';

const et = (iso: string) => Date.parse(`${iso}-05:00`);

describe('punkt odniesienia ruchu na Starcie', () => {
  it('BTC: od 00:00 UTC', () => {
    expect(sessionAnchor(deskMarketOf('BTC')!, Date.parse('2026-11-15T12:34:00Z'))).toEqual({ t: Date.parse('2026-11-15T00:00:00Z'), kind: 'utc-day' });
  });

  it('złoto: w sesji od 18:00 ET poprzedniego dnia; w weekend od ostatniego otwarcia (czwartek 18:00 ET)', () => {
    const gold = deskMarketOf('xyz:GOLD')!;
    expect(sessionAnchor(gold, et('2026-11-18T10:00:00'))).toEqual({ t: et('2026-11-17T18:00:00'), kind: 'cme-open' });
    expect(sessionAnchor(gold, et('2026-11-21T12:00:00'))).toEqual({ t: et('2026-11-19T18:00:00'), kind: 'cme-open' });
  });

  it('S&P 500: w sesji od 9:30 ET, poza nią od ostatniego zamknięcia NYSE', () => {
    const sp = deskMarketOf('xyz:SP500')!;
    expect(sessionAnchor(sp, et('2026-11-18T11:00:00'))).toEqual({ t: et('2026-11-18T09:30:00'), kind: 'nyse-open' });
    expect(sessionAnchor(sp, et('2026-11-18T20:00:00'))).toEqual({ t: et('2026-11-18T16:00:00'), kind: 'nyse-close' });
    // Niedziela: ostatnie zamknięcie w piątek 16:00 ET
    expect(sessionAnchor(sp, et('2026-11-22T12:00:00'))).toEqual({ t: et('2026-11-20T16:00:00'), kind: 'nyse-close' });
  });
});
