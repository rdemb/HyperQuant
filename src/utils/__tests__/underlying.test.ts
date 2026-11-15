import { describe, expect, it } from 'vitest';
import { deskMarketOf } from '../../config/deskMarkets';
import { platformPriced, underlyingAt } from '../underlying';

const gold = deskMarketOf('xyz:GOLD')!;
const sp = deskMarketOf('xyz:SP500')!;
const btc = deskMarketOf('BTC')!;
// Czas Nowego Jorku w listopadzie 2026: EST (UTC−5); w lipcu EDT (UTC−4)
const et = (iso: string, offset = '-05:00') => Date.parse(`${iso}${offset}`);

describe('rynek bazowy (projekt 60, Q1)', () => {
  it('BTC: zawsze, bez zmian stanu', () => {
    expect(underlyingAt(btc, et('2026-11-15T12:00:00'))).toEqual({ state: 'always', rth: null, next: null, rthNext: null });
  });

  it('złoto: niedziela 17:59 ET zamknięte, 18:00 otwarte; następna zmiana o 18:00', () => {
    const a = underlyingAt(gold, et('2026-11-15T17:59:00'));
    expect(a.state).toBe('closed');
    expect(a.next).toBe(et('2026-11-15T18:00:00'));
    expect(underlyingAt(gold, et('2026-11-15T18:00:00')).state).toBe('open');
  });

  it('złoto: środa 17:30 ET przerwa do 18:00; piątek 17:00 zamknięcie na weekend', () => {
    const b = underlyingAt(gold, et('2026-11-18T17:30:00'));
    expect(b.state).toBe('break');
    expect(b.next).toBe(et('2026-11-18T18:00:00'));
    expect(underlyingAt(gold, et('2026-11-20T16:59:00')).state).toBe('open');
    const f = underlyingAt(gold, et('2026-11-20T17:00:00'));
    expect(f.state).toBe('closed');
    expect(f.next).toBe(et('2026-11-22T18:00:00'));
    expect(platformPriced(f)).toBe(true);
  });

  it('S&P 500: sesja regularna NYSE i święto (Wielki Piątek 3.04.2026)', () => {
    const rth = underlyingAt(sp, et('2026-11-18T10:00:00'));
    expect(rth).toMatchObject({ state: 'open', rth: true, rthNext: et('2026-11-18T16:00:00') });
    const pre = underlyingAt(sp, et('2026-11-18T08:00:00'));
    expect(pre).toMatchObject({ state: 'open', rth: false, rthNext: et('2026-11-18T09:30:00') });
    expect(underlyingAt(sp, et('2026-04-03T12:00:00', '-04:00')).state).toBe('holiday');
  });

  it('zmiana czasu w USA (8.03.2026): otwarcie w niedzielę 18:00 czasu lokalnego Nowego Jorku', () => {
    // 8.03.2026 o 2:00 EST → 3:00 EDT; wieczorem obowiązuje EDT (UTC−4)
    expect(underlyingAt(gold, et('2026-03-08T17:59:00', '-04:00')).state).toBe('closed');
    expect(underlyingAt(gold, et('2026-03-08T18:00:00', '-04:00')).state).toBe('open');
  });
});

describe('znaczniki otwarć rynków bazowych', () => {
  it('NYSE 9:30 ET i CME 18:00 ET, także w dniu zmiany czasu w USA (8.03.2026)', async () => {
    const { baseOpens } = await import('../underlying');
    expect(baseOpens(Date.parse('2026-11-18T15:00:00Z'))).toEqual({ nyse: Date.parse('2026-11-18T14:30:00Z'), cme: Date.parse('2026-11-18T23:00:00Z') });
    // 8.03.2026 po 3:00 EDT (UTC−4): 9:30 ET = 13:30 UTC, 18:00 ET = 22:00 UTC
    expect(baseOpens(Date.parse('2026-03-08T16:00:00Z'))).toEqual({ nyse: Date.parse('2026-03-08T13:30:00Z'), cme: Date.parse('2026-03-08T22:00:00Z') });
  });
});

describe('przedziały ceny platformy (projekt 60, Q2)', () => {
  it('tydzień złota: 4 przerwy pon.–czw. i weekend od piątku 17:00 do niedzieli 18:00 ET; BTC pusto', async () => {
    const { closedSpans } = await import('../underlying');
    const from = et('2026-11-16T00:00:00');
    const to = et('2026-11-23T00:00:00');
    const s = closedSpans(gold, from, to);
    expect(s.filter((x) => x.kind === 'break').map((x) => [x.from, x.to])).toEqual(
      ['16', '17', '18', '19'].map((d) => [et(`2026-11-${d}T17:00:00`), et(`2026-11-${d}T18:00:00`)])
    );
    expect(s.find((x) => x.kind === 'closed')).toMatchObject({ from: et('2026-11-20T17:00:00'), to: et('2026-11-22T18:00:00') });
    expect(closedSpans(btc, from, to)).toEqual([]);
  });

  it('S&P 500: Wielki Piątek 3.04.2026 jako dzień wolny NYSE', async () => {
    const { closedSpans } = await import('../underlying');
    const s = closedSpans(sp, Date.parse('2026-04-03T00:00:00Z'), Date.parse('2026-04-04T00:00:00Z'));
    expect(s.some((x) => x.kind === 'holiday' && x.from === Date.parse('2026-04-03T00:00:00-04:00'))).toBe(true);
  });
});
