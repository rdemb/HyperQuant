import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_ALERTS, lineLabel, newAlert, parseAlerts, parseLog, parsePriceInput, windowOf } from '../chart/alerts';
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

describe('okno alarmu w dobie zmiany czasu', () => {
  const tz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'Europe/Warsaw';
  });
  afterAll(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });
  const at = (t: number) => {
    const d = new Date(t);
    return `${d.getDate()}.${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  it('25.10.2026 (doba 25 h): koniec i początek trzymają godzinę zegara', () => {
    // 24.10 20:00 CEST: najbliższe 16:00 to już 25.10 po cofnięciu zegara (nie 15:00)
    const [f1, u1] = windowOf('08:00', '16:00', new Date(2026, 9, 24, 20, 0).getTime());
    expect([at(f1), at(u1)]).toEqual(['25.10 08:00', '25.10 16:00']);
    // Okno przez noc zmiany czasu: początek dzień wcześniej o 22:00, nie o 23:00
    const [f2, u2] = windowOf('22:00', '06:00', new Date(2026, 9, 24, 23, 0).getTime());
    expect([at(f2), at(u2)]).toEqual(['24.10 22:00', '25.10 06:00']);
    expect(u2 - f2).toBe(9 * 3600_000);
  });

  it('29.03.2026 (doba 23 h): to samo przy przestawieniu zegara do przodu', () => {
    const [f1, u1] = windowOf('08:00', '16:00', new Date(2026, 2, 28, 20, 0).getTime());
    expect([at(f1), at(u1)]).toEqual(['29.3 08:00', '29.3 16:00']);
    const [f2, u2] = windowOf('22:00', '06:00', new Date(2026, 2, 28, 23, 0).getTime());
    expect([at(f2), at(u2)]).toEqual(['28.3 22:00', '29.3 06:00']);
    expect(u2 - f2).toBe(7 * 3600_000);
  });

  it('zwykła doba bez zmian: samo „do” i samo „od”', () => {
    const now = new Date(2026, 9, 30, 12, 0).getTime();
    expect(at(windowOf('', '10:00', now)[1])).toBe('31.10 10:00');
    expect(at(windowOf('13:30', '', now)[0])).toBe('30.10 13:30');
  });
});
