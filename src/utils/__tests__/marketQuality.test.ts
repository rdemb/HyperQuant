import { describe, expect, it } from 'vitest';
import { deskMarketOf } from '../../config/deskMarkets';
import { marketQuality } from '../marketQuality';
import type { Underlying } from '../underlying';

const gold = deskMarketOf('xyz:GOLD')!;
const open: Underlying = { state: 'open', rth: null, next: null, rthNext: null };
const closed: Underlying = { state: 'closed', rth: null, next: null, rthNext: null };
const ctx = (o: Partial<{ markPx: number; oraclePx: number; midPx: number; impactPxs: [number, number] | null }>) => ({
  markPx: 4000,
  dayNtlVlm: 1,
  openInterest: 1,
  funding: 0,
  oraclePx: 4000,
  midPx: 4000,
  impactPxs: [3999.8, 4000.2] as [number, number],
  ...o,
});

describe('jakość rynku HIP-3 (projekt 60, Q3)', () => {
  it('w sesji: mały rozjazd i wąski spread → dobra', () => {
    const q = marketQuality(gold, ctx({}), open);
    expect(q.level).toBe('good');
    expect(q.spreadBp).toBeCloseTo(1, 5);
    expect(q.markOracleBp).toBe(0);
  });

  it('rozjazd 35 pb w sesji → zła z powodem; ten sam poza sesją → cena platformy', () => {
    const c = ctx({ markPx: 4014 });
    expect(marketQuality(gold, c, open)).toMatchObject({ level: 'bad', reasons: ['mark-oracle'] });
    expect(marketQuality(gold, c, closed)).toMatchObject({ level: 'platform', reasons: ['platform'] });
  });

  it('spread 5 pb → ograniczona; 12 pb → zła', () => {
    expect(marketQuality(gold, ctx({ impactPxs: [3999, 4001] }), open)).toMatchObject({ level: 'limited', reasons: ['spread'] });
    expect(marketQuality(gold, ctx({ impactPxs: [3997.6, 4002.4] }), open).level).toBe('bad');
  });

  it('bez cen impact → „—: brak notowań impact” jako ograniczona; bez odczytu → brak oceny', () => {
    expect(marketQuality(gold, ctx({ impactPxs: null }), open)).toMatchObject({ level: 'limited', spreadBp: null, reasons: ['no-impact'] });
    expect(marketQuality(gold, null, open)).toMatchObject({ level: 'na', reasons: ['no-ctx'] });
  });
});
