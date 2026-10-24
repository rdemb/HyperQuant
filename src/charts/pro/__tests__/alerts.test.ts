import { describe, expect, it } from 'vitest';
import { MAX_ALERTS, newAlert, parseAlerts, parsePriceInput, reached } from '../chart/alerts';

describe('alerty cenowe', () => {
  it('kierunek z położenia poziomu względem ceny; alert osiągnięty dopiero po dojściu ceny', () => {
    const up = newAlert('BTC', 81_000, 80_600, 1);
    const down = newAlert('BTC', 80_000, 80_600, 1);
    expect(up.dir).toBe(1);
    expect(down.dir).toBe(-1);
    expect(up.id).not.toBe(down.id);
    expect(reached(up, 80_999)).toBe(false);
    expect(reached(up, 81_000)).toBe(true);
    expect(reached(down, 80_001)).toBe(false);
    expect(reached(down, 79_990)).toBe(true);
  });

  it('odczyt z zapisu odrzuca uszkodzone wpisy i trzyma najwyżej MAX_ALERTS', () => {
    const ok = { id: 'a', coin: 'ETH', price: 2500, dir: 1, created: 5 };
    expect(parseAlerts([ok, { id: 'b', coin: 'ETH', price: -1, dir: 1 }, { id: 'c', coin: 'ETH', price: 1, dir: 0 }, null])).toEqual([ok]);
    expect(parseAlerts('x')).toEqual([]);
    expect(parseAlerts(Array.from({ length: MAX_ALERTS + 5 }, (_, i) => ({ ...ok, id: String(i) }))).length).toBe(MAX_ALERTS);
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
