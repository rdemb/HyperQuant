import { describe, expect, it } from 'vitest';
import { DOCK_KEY } from '../../views/flow/flowColumnModel';
import { LEGACY_VIEW, PHASE_VIEW, followHash, resolveHash } from '../route';

describe('adres strony → widok', () => {
  it('pusty adres: W sesji, bez przepisania', () => {
    expect(resolveHash('')).toEqual({ view: 'charts', rewrite: null });
    expect(resolveHash('#')).toEqual({ view: 'charts', rewrite: null });
  });

  it('stare adresy przechodzą do nowych miejsc z zachowaniem części po „?”', () => {
    expect(resolveHash('#plan')).toEqual({ view: 'after', rewrite: '#after' });
    expect(resolveHash('#desk?x=1')).toEqual({ view: 'before', rewrite: '#before?x=1' });
    expect(resolveHash('#flow')).toEqual({ view: 'charts', rewrite: '#charts' });
    expect(resolveHash('#market')).toEqual({ view: 'before', rewrite: '#before' });
    expect(resolveHash('#lab')).toEqual({ view: 'charts', rewrite: '#charts' });
    expect(resolveHash('#micro')).toEqual({ view: 'research', rewrite: '#research' });
    expect(LEGACY_VIEW).toEqual({ desk: 'before', market: 'before', plan: 'after', lab: 'charts', micro: 'research', flow: 'charts' });
  });

  it('nowe adresy bez zmian (parametry wykresu i powtórki zostają)', () => {
    expect(resolveHash('#charts?replay=history&m=BTC')).toEqual({ view: 'charts', rewrite: null });
    expect(resolveHash('#charts?replay=history&m=BTC&station=scalp')).toEqual({ view: 'charts', rewrite: null });
    expect(resolveHash('#lessons?tab=myths').view).toBe('lessons');
    for (const v of ['before', 'charts', 'after', 'research', 'lessons', 'sources'] as const) expect(resolveHash(`#${v}`)).toEqual({ view: v, rewrite: null });
  });

  it('nieznany adres: W sesji, także nazwy pól obiektu', () => {
    expect(resolveHash('#nieznany').view).toBe('charts');
    expect(resolveHash('#constructor')).toEqual({ view: 'charts', rewrite: null });
    expect(resolveHash('#__proto__?a=1')).toEqual({ view: 'charts', rewrite: null });
    expect(resolveHash('#toString').view).toBe('charts');
  });

  it('faza dnia → widok aplikacji', () => {
    expect(PHASE_VIEW).toEqual({ before: 'before', session: 'charts', after: 'after' });
  });
});

/** Okno z adresem `hash`: zapis wywołań replaceState i pamięć (opcjonalnie rzucająca jak w trybie prywatnym). */
function fakeWin(hash: string, opts: { store?: Record<string, string>; throws?: boolean } = {}) {
  const calls: string[] = [];
  const store = new Map(Object.entries(opts.store ?? {}));
  const win = {
    location: { hash, pathname: '/HQ/', search: '?utm=x' },
    history: {
      state: { k: 1 },
      replaceState: (state: unknown, _t: string, url: string) => void calls.push(`${JSON.stringify(state)} ${url}`),
    },
    localStorage: {
      getItem: (k: string) => (opts.throws ? fail() : (store.get(k) ?? null)),
      setItem: (k: string, v: string) => (opts.throws ? fail() : void store.set(k, v)),
    },
  };
  return { win: win as unknown as Parameters<typeof followHash>[0], calls, store };
}

const fail = (): never => {
  throw new Error('SecurityError');
};

describe('przekierowanie w oknie (start i hashchange)', () => {
  it('stary adres: replaceState na nowy (ścieżka i zapytanie strony zostają), widok z nowego adresu', () => {
    const a = fakeWin('#plan');
    expect(followHash(a.win)).toBe('after');
    expect(a.calls).toEqual(['{"k":1} /HQ/?utm=x#after']);
    const b = fakeWin('#desk?m=ETH');
    expect(followHash(b.win)).toBe('before');
    expect(b.calls).toEqual(['{"k":1} /HQ/?utm=x#before?m=ETH']);
  });

  it('nowy, pusty albo nieznany adres: bez replaceState', () => {
    for (const h of ['', '#charts?replay=history&m=BTC&station=scalp', '#lessons?tab=myths', '#nieznany']) {
      const w = fakeWin(h);
      followHash(w.win);
      expect(w.calls, h).toEqual([]);
    }
  });

  it('#flow otwiera też kolumnę DOM i taśmy (hq.charts.dock.v1 = „1”, także po schowaniu)', () => {
    expect(DOCK_KEY).toBe('hq.charts.dock.v1');
    const w = fakeWin('#flow', { store: { [DOCK_KEY]: '0' } });
    expect(followHash(w.win)).toBe('charts');
    expect(w.calls).toEqual(['{"k":1} /HQ/?utm=x#charts']);
    expect(w.store.get(DOCK_KEY)).toBe('1');
    // Inne stare adresy nie ruszają kolumny
    const p = fakeWin('#lab', { store: { 'hq.charts.dock.v1': '0' } });
    followHash(p.win);
    expect(p.store.get('hq.charts.dock.v1')).toBe('0');
  });

  it('pamięć niedostępna: przekierowanie i tak działa', () => {
    const w = fakeWin('#flow?m=SOL', { throws: true });
    expect(followHash(w.win)).toBe('charts');
    expect(w.calls).toEqual(['{"k":1} /HQ/?utm=x#charts?m=SOL']);
  });
});
