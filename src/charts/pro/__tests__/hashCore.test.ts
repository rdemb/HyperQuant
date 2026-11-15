import { describe, expect, it } from 'vitest';
import { replayHashCore } from '../replay/hashCore';
import { replayHash } from '../replay/link';

describe('adres powtórki bez modułów wykresu', () => {
  it('rdzeń daje ten sam adres co pełny replayHash (bez warstw)', () => {
    const l = { source: 'history' as const, coin: 'BTC', from: Date.parse('2026-11-15T10:00:00Z'), to: Date.parse('2026-11-15T10:15:00.250Z'), station: 'cockpit' as const };
    expect(replayHashCore(l)).toBe(replayHash(l));
    expect(replayHashCore(l)).toBe('#charts?replay=history&m=BTC&from=2026-11-15T10:00:00Z&to=2026-11-15T10:15:00.250Z&station=cockpit');
  });
});
