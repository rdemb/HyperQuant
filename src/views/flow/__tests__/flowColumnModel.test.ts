import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { followHash } from '../../../state/route';
import { DEFAULT_FLOW_PREFS, DOCK_KEY, DOCK_MIN_W, DRAWER_MIN_W, columnAfterHash, dockMode, parseDock, parseFlowPrefs, scannerScope, shortcutTarget } from '../flowColumnModel';

describe('kolumna DOM i taśmy: czyste pomocniki', () => {
  it('panele skanera (kto przyjmuje, TWAP-y) tylko dla BTC', () => {
    expect(scannerScope('BTC')).toBe('full');
    expect(scannerScope('ETH')).toBe('btc-only');
    expect([scannerScope('SOL'), scannerScope('HYPE'), scannerScope('btc'), scannerScope('')]).toEqual(['btc-only', 'btc-only', 'btc-only', 'btc-only']);
  });

  it('kolumna przypięta od 1280 px, szuflada od 640 do 1279 px, na telefonie bez kolumny', () => {
    expect(DOCK_MIN_W).toBe(1280);
    expect(DRAWER_MIN_W).toBe(640);
    expect([dockMode(1280), dockMode(1920)]).toEqual(['docked', 'docked']);
    expect([dockMode(1279), dockMode(1024), dockMode(640)]).toEqual(['drawer', 'drawer', 'drawer']);
    expect([dockMode(639), dockMode(390), dockMode(0)]).toEqual(['none', 'none', 'none']);
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

describe('kolumna po zmianie adresu (otwarty już W sesji)', () => {
  const store = new Map<string, string>();
  const win = (hash: string) => ({
    location: { hash, pathname: '/', search: '' },
    history: { state: null, replaceState: () => {} },
    localStorage: { setItem: (k: string, v: string) => void store.set(k, v) },
  });
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('#flow przy kolumnie schowanej klawiszem D (≥ 1280 px): po hashchange kolumna widoczna, szuflada dla W sesji', () => {
    store.set(DOCK_KEY, '0');
    expect(columnAfterHash('session')).toEqual({ dock: false, drawer: false });
    followHash(win('#flow'));
    expect(columnAfterHash('session')).toEqual({ dock: true, drawer: true });
    // Prośba o szufladę jednorazowa
    expect(columnAfterHash('session')).toEqual({ dock: true, drawer: false });
  });

  it('Wykresy innej fazy czytają zapis kolumny, ale nie zabierają prośby o szufladę', () => {
    store.set(DOCK_KEY, '0');
    followHash(win('#flow'));
    expect(columnAfterHash('before')).toEqual({ dock: true, drawer: false });
    expect(columnAfterHash('session')).toEqual({ dock: true, drawer: true });
  });
});
