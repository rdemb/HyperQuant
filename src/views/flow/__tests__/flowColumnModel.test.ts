import { describe, expect, it } from 'vitest';
import { DEFAULT_FLOW_PREFS, DOCK_MIN_W, dockAllowed, parseDock, parseFlowPrefs, scannerScope, shortcutTarget } from '../flowColumnModel';

describe('kolumna DOM i taśmy: czyste pomocniki', () => {
  it('panele skanera (kto przyjmuje, TWAP-y) tylko dla BTC', () => {
    expect(scannerScope('BTC')).toBe('full');
    expect(scannerScope('ETH')).toBe('btc-only');
    expect([scannerScope('SOL'), scannerScope('HYPE'), scannerScope('btc'), scannerScope('')]).toEqual(['btc-only', 'btc-only', 'btc-only', 'btc-only']);
  });

  it('kolumna przypięta od 1280 px szerokości', () => {
    expect(dockAllowed(1279)).toBe(false);
    expect(dockAllowed(1280)).toBe(true);
    expect(dockAllowed(390)).toBe(false);
    expect(dockAllowed(1920)).toBe(true);
    expect(DOCK_MIN_W).toBe(1280);
  });

  it('Alt+1…6: układy w kolejności przed sesją, w sesji, po sesji; poza tym null', () => {
    expect(shortcutTarget(1)).toEqual({ phase: 'before', layout: 'day-map' });
    expect(shortcutTarget(2)).toEqual({ phase: 'before', layout: 'fuel' });
    expect(shortcutTarget(3)).toEqual({ phase: 'session', layout: 'cockpit' });
    expect(shortcutTarget(4)).toEqual({ phase: 'session', layout: 'auction-open' });
    expect(shortcutTarget(5)).toEqual({ phase: 'session', layout: 'big-hands' });
    expect(shortcutTarget(6)).toEqual({ phase: 'after', layout: 'review' });
    expect(shortcutTarget(7)).toBeNull();
    expect([shortcutTarget(0), shortcutTarget(-1), shortcutTarget(1.5), shortcutTarget(Number.NaN)]).toEqual([null, null, null, null]);
  });

  it('stan kolumny: domyślnie widoczna, schowana tylko z zapisem „0”', () => {
    expect(parseDock(null)).toBe(true);
    expect(parseDock('1')).toBe(true);
    expect(parseDock('0')).toBe(false);
    expect(parseDock('cokolwiek')).toBe(true);
  });

  it('preferencje taśmy i drabiny (hq.flow.v1): walidacja pól pojedynczo', () => {
    expect(parseFlowPrefs(null)).toEqual(DEFAULT_FLOW_PREFS);
    expect(parseFlowPrefs('x')).toEqual(DEFAULT_FLOW_PREFS);
    expect(parseFlowPrefs({ minUsd: 50_000, sound: true, step: 'far' })).toEqual({ minUsd: 50_000, sound: true, step: 'far' });
    expect(parseFlowPrefs({ minUsd: -1, sound: 'tak', step: 'blisko' })).toEqual(DEFAULT_FLOW_PREFS);
    expect(parseFlowPrefs({ minUsd: 0, step: 'exact' })).toEqual({ ...DEFAULT_FLOW_PREFS, minUsd: 0, step: 'exact' });
  });
});
