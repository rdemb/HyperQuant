import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { followHash } from '../../../state/route';
import { DEFAULT_FLOW_PREFS, DOCK_KEY, DOCK_MIN_W, DRAWER_MIN_W, columnAfterHash, dockMode, parseDock, parseFlowPrefs, scannerScope } from '../flowColumnModel';

describe('kolumna DOM i taśmy: czyste pomocniki', () => {
  it('panele skanera (kto przyjmuje, TWAP-y) dla rynków z pełnym skanerem w rejestrze (dziś BTC)', () => {
    expect(scannerScope('BTC')).toBe('full');
    expect(scannerScope('ETH')).toBe('none');
    expect([scannerScope('SOL'), scannerScope('HYPE'), scannerScope('xyz:NVDA'), scannerScope('btc'), scannerScope('')]).toEqual(['none', 'none', 'none', 'none', 'none']);
  });

  it('kolumna przypięta od 1280 px, szuflada od 640 do 1279 px, na telefonie bez kolumny', () => {
    expect(DOCK_MIN_W).toBe(1280);
    expect(DRAWER_MIN_W).toBe(640);
    expect([dockMode(1280), dockMode(1920)]).toEqual(['docked', 'docked']);
    expect([dockMode(1279), dockMode(1024), dockMode(640)]).toEqual(['drawer', 'drawer', 'drawer']);
    expect([dockMode(639), dockMode(390), dockMode(0)]).toEqual(['none', 'none', 'none']);
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

  it('#flow przy kolumnie schowanej klawiszem D (≥ 1280 px): po hashchange kolumna widoczna i szuflada, raz', () => {
    store.set(DOCK_KEY, '0');
    followHash(win('#flow'));
    expect(columnAfterHash('session')).toEqual({ dock: true, drawer: true });
    // Prośba jednorazowa: kolejna zmiana adresu niczego nie zmienia
    expect(columnAfterHash('session')).toBeNull();
  });

  it('zwykła zmiana adresu (bez #flow) nie czyta zapisu kolumny ponownie', () => {
    store.set(DOCK_KEY, '0');
    followHash(win('#charts?m=ETH'));
    expect(columnAfterHash('session')).toBeNull();
    store.set(DOCK_KEY, '1');
    followHash(win('#before'));
    expect(columnAfterHash('session')).toBeNull();
  });

  it('Wykresy innej fazy nie zabierają prośby: odbierają ją Wykresy W sesji', () => {
    store.set(DOCK_KEY, '0');
    followHash(win('#flow'));
    expect(columnAfterHash('before')).toBeNull();
    expect(columnAfterHash('session')).toEqual({ dock: true, drawer: true });
  });
});
