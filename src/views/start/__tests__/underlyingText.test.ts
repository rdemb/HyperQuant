import { describe, expect, it } from 'vitest';
import { deskMarketOf } from '../../../config/deskMarkets';
import { underlyingAt } from '../../../utils/underlying';
import { underlyingText } from '../MarketsNow';

const gold = deskMarketOf('xyz:GOLD')!;
const sp = deskMarketOf('xyz:SP500')!;
const et = (iso: string) => Date.parse(`${iso}-05:00`);
// Chwila w czasie lokalnym jak w komponencie (dzień tygodnia, gdy inny dzień niż teraz): test nie zależy od strefy maszyny
const hm = (ms: number) => new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
const when = (ms: number, now: number) =>
  new Date(ms).toDateString() === new Date(now).toDateString() ? hm(ms) : `${new Intl.DateTimeFormat('pl-PL', { weekday: 'short' }).format(ms)} ${hm(ms)}`;
const text = (m: typeof sp, iso: string) => underlyingText(m, underlyingAt(m, et(iso)), et(iso));

describe('Rynki teraz: stan rynku bazowego słowami', () => {
  it('S&P 500 w weekend: NYSE z godziną otwarcia sesji 9:30 ET, futures osobno z 18:00 ET', () => {
    const s = text(sp, '2026-11-15T08:20:00');
    expect(s).toContain(`NYSE zamknięta do ${when(et('2026-11-16T09:30:00'), et('2026-11-15T08:20:00'))}`);
    expect(s).toContain(`futures od ${when(et('2026-11-15T18:00:00'), et('2026-11-15T08:20:00'))}`);
  });

  it('S&P 500 w przerwie futures (środa 17:30 ET): NYSE do czwartku 9:30, futures: przerwa do 18:00', () => {
    const s = text(sp, '2026-11-18T17:30:00');
    expect(s).toContain(`NYSE zamknięta do ${when(et('2026-11-19T09:30:00'), et('2026-11-18T17:30:00'))}`);
    expect(s).toContain(`futures: przerwa do ${when(et('2026-11-18T18:00:00'), et('2026-11-18T17:30:00'))}`);
  });

  it('S&P 500 w sesji NYSE i poza nią przy otwartych futures — bez zmian', () => {
    expect(text(sp, '2026-11-16T10:00:00')).toBe(`NYSE otwarta do ${when(et('2026-11-16T16:00:00'), et('2026-11-16T10:00:00'))}`);
    expect(text(sp, '2026-11-16T20:00:00')).toMatch(/^poza sesją NYSE, futures do /);
  });

  it('złoto w weekend: CME zamknięta do niedzieli 18:00 ET (bez zmian)', () => {
    expect(text(gold, '2026-11-15T08:20:00')).toBe(`CME zamknięta do ${when(et('2026-11-15T18:00:00'), et('2026-11-15T08:20:00'))}`);
  });
});
