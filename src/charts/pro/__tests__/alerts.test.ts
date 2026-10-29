import { describe, expect, it } from 'vitest';
import { MAX_ALERTS, lineLabel, newAlert, parseAlerts, parseLog, parsePriceInput } from '../chart/alerts';
import { DEFAULT_TTL_MS } from '../../../utils/alertRules';

describe('alarmy cenowe w przeglądarce', () => {
  it('alarm z poprzedniej wersji (samo dotknięcie) czyta się z domyślnymi polami; uszkodzone wpisy odpadają', () => {
    const old = { id: 'a', coin: 'ETH', price: 2500, dir: 1, created: 5 };
    expect(parseAlerts([old, { id: 'b', coin: 'ETH', price: -1, dir: 1 }, { id: 'c', coin: 'ETH', price: 1, dir: 0 }, null])).toEqual([
      { ...old, kind: 'touch', iv: '15m', closes: 1, delta: false, from: 0, until: 5 + DEFAULT_TTL_MS, pair: '', note: '', after: '', armed: false, streak: 0 },
    ]);
    expect(parseAlerts('x')).toEqual([]);
    expect(parseAlerts(Array.from({ length: MAX_ALERTS + 5 }, (_, i) => ({ ...old, id: String(i) }))).length).toBe(MAX_ALERTS);
  });

  it('nowy alarm zachowuje warunek, a zapis i odczyt dają ten sam alarm (z historią zdarzeń)', () => {
    const spec = { coin: 'BTC', price: 64_670, kind: 'reclaim' as const, dir: 1 as const, iv: '15m', closes: 2, delta: true, from: 10, until: 99, pair: 'p', note: 'Long po pułapce', after: '' };
    const a = newAlert(spec, 7);
    const b = newAlert(spec, 7);
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({ ...spec, created: 7, armed: false, streak: 0 });
    expect(parseAlerts(JSON.parse(JSON.stringify([{ ...a, armed: true, streak: 1 }])))).toEqual([{ ...a, armed: true, streak: 1 }]);
    const e = { type: 'fire', rule: a, at: 5, px: 64_700, facts: null };
    expect(parseLog([e, { ...e, type: 'x' }, { ...e, rule: { id: 1 } }])).toEqual([e]);
    expect(lineLabel(a)).toBe('Alarm 15m×2 powrót nad');
    expect(lineLabel({ ...a, kind: 'close', closes: 1, dir: -1 })).toBe('Alarm 15m pod');
  });

  it('cena wpisana ręcznie: separatory tysięcy i przecinek dziesiętny rozstrzygane bliskością do ceny', () => {
    expect(parsePriceInput('75000', 75_100)).toBe(75_000);
    expect(parsePriceInput('75,000', 75_100)).toBe(75_000);
    expect(parsePriceInput('75 000', 75_100)).toBe(75_000);
    expect(parsePriceInput('2,950.5', 2_900)).toBe(2_950.5);
    expect(parsePriceInput('2950,5', 2_900)).toBe(2_950.5);
    expect(parsePriceInput('36,837', 36.8)).toBe(36.837);
    expect(parsePriceInput('', 1)).toBeNull();
    expect(parsePriceInput('-5', 1)).toBeNull();
    expect(parsePriceInput('abc', 1)).toBeNull();
    expect(parsePriceInput('0', 1)).toBeNull();
  });
});
