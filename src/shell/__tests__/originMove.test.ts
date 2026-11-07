import { describe, expect, it, vi } from 'vitest';
import { NEW_ORIGIN, OLD_ORIGIN, moveIn, moveOut, packStorage, unpack } from '../originMove';

/** Pamięć przeglądarki w Map (kolejność kluczy jak w localStorage: wstawiania). */
function memory(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

const dump = (s: Storage) => Object.fromEntries(Array.from({ length: s.length }, (_, i) => [s.key(i)!, s.getItem(s.key(i)!)]));

/** Okno z adresem `href`, pamięcią i podglądem replaceState / replace. */
function win(href: string, store: Storage, opts: { referrer?: string; confirm?: boolean; fetch?: () => Promise<unknown> } = {}) {
  const u = new URL(href);
  const calls: string[] = [];
  const w = {
    location: { origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash, replace: (t: string) => void calls.push(`replace ${t}`) },
    localStorage: store,
    history: { replaceState: (_s: unknown, _t: string, url: string) => void calls.push(`state ${url}`) },
    confirm: vi.fn(() => opts.confirm ?? false),
    fetch: vi.fn(opts.fetch ?? (async () => ({ type: 'basic' }))),
    document: { referrer: opts.referrer ?? '' },
  };
  return { w: w as unknown as Parameters<typeof moveIn>[0], calls, raw: w };
}

const OLD = { 'hq.lang': 'en', 'hq.charts.draw.v1': '[{"p":64000.5,"t":"Zażółć"}]', 'hq.charts.push.v1': '{"id":"d","token":"t"}', other: 'x' };

describe('pakiet ustawień', () => {
  it('niesie wszystkie klucze hq.* (z polskimi znakami) i widok, bez obcych kluczy', () => {
    const p = packStorage(memory(OLD), '#charts?m=BTC&i=5m');
    expect(p).toMatch(/^[A-Za-z0-9_-]+$/);
    const { other: _, ...hq } = OLD;
    expect(unpack(p)).toEqual({ h: '#charts?m=BTC&i=5m', k: hq });
  });

  it('uszkodzony albo obcy pakiet: null; klucze spoza hq.* i nietekstowe wartości odpadają', () => {
    expect(unpack('%%%')).toBeNull();
    expect(unpack(btoa('[1]'))).toBeNull();
    const evil = btoa(JSON.stringify({ h: '#move=x', k: { 'hq.a': '1', x: '2', 'hq.b': 3 } }));
    expect(unpack(evil)).toEqual({ h: '', k: { 'hq.a': '1' } });
  });
});

describe('nowy adres: przyjęcie pakietu', () => {
  const link = (h = '#charts?m=ETH') => `${NEW_ORIGIN}/#move=${packStorage(memory(OLD), h)}`;

  it('pakiet ze starego adresu: zapis kluczy (nadpisuje świeże), # wraca do widoku, drugi pakiet już nic nie zmienia', () => {
    const store = memory({ 'hq.lang': 'pl' });
    const a = win(link(), store, { referrer: `${OLD_ORIGIN}/` });
    expect(moveIn(a.w)).toBe(true);
    expect(a.calls).toEqual(['state /#charts?m=ETH']);
    expect(dump(store)).toMatchObject({ 'hq.lang': 'en', 'hq.charts.draw.v1': OLD['hq.charts.draw.v1'], 'hq.charts.push.v1': OLD['hq.charts.push.v1'] });
    expect(store.getItem('other')).toBeNull();

    store.setItem('hq.lang', 'pl');
    const b = win(link('#before'), store, { referrer: `${OLD_ORIGIN}/` });
    expect(moveIn(b.w)).toBe(false);
    expect(store.getItem('hq.lang')).toBe('pl');
    expect(b.calls).toEqual(['state /#before']);
  });

  it('bez śladu starego adresu: pyta o zgodę; odmowa nic nie zapisuje', () => {
    const store = memory();
    const no = win(link(), store, { referrer: 'https://evil.example/' });
    expect(moveIn(no.w)).toBe(false);
    expect(no.raw.confirm).toHaveBeenCalledOnce();
    expect(dump(store)).toEqual({});
    const yes = win(link(), store, { confirm: true });
    expect(moveIn(yes.w)).toBe(true);
    expect(store.getItem('hq.lang')).toBe('en');
  });

  it('zwykłe wejście bez pakietu: nic nie robi', () => {
    const a = win(`${NEW_ORIGIN}/#charts`, memory());
    expect(moveIn(a.w)).toBe(false);
    expect(a.calls).toEqual([]);
  });
});

describe('stary adres: wysłanie pakietu', () => {
  it('przed przeprowadzką (200): zostaje na miejscu', async () => {
    const a = win(`${OLD_ORIGIN}/HyperQuant/#charts`, memory(OLD));
    await moveOut(a.w);
    expect(a.raw.fetch).toHaveBeenCalledWith('./manifest.webmanifest', { method: 'HEAD', redirect: 'manual', cache: 'no-store' });
    expect(a.calls).toEqual([]);
  });

  it('po przeprowadzce (przekierowanie): przejście na nową domenę z pakietem, który nowy adres przyjmuje', async () => {
    const a = win(`${OLD_ORIGIN}/HyperQuant/#charts?m=BTC`, memory(OLD), { fetch: async () => ({ type: 'opaqueredirect' }) });
    await moveOut(a.w);
    expect(a.calls).toHaveLength(1);
    const target = a.calls[0].replace(/^replace /, '');
    expect(target.startsWith(`${NEW_ORIGIN}/#move=`)).toBe(true);
    const store = memory();
    const b = win(target, store, { referrer: `${OLD_ORIGIN}/` });
    expect(moveIn(b.w)).toBe(true);
    expect(b.calls).toEqual(['state /#charts?m=BTC']);
    expect(store.getItem('hq.charts.push.v1')).toBe(OLD['hq.charts.push.v1']);
  });

  it('inny adres albo brak sieci: nic nie robi', async () => {
    const a = win(`${NEW_ORIGIN}/#charts`, memory(OLD), { fetch: async () => ({ type: 'opaqueredirect' }) });
    await moveOut(a.w);
    expect(a.raw.fetch).not.toHaveBeenCalled();
    const b = win(`${OLD_ORIGIN}/HyperQuant/`, memory(OLD), { fetch: async () => Promise.reject(new TypeError('offline')) });
    await moveOut(b.w);
    expect(b.calls).toEqual([]);
  });
});
