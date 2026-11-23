import { afterEach, describe, expect, it, vi } from 'vitest';
import { tipsPending } from '../../utils/firstVisit';
import { enterApp } from '../DeskContext';

/** Pamięć przeglądarki na Map (Storage: getItem, setItem, key, length). */
function storage(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

function page(hash: string, init?: Record<string, string>) {
  const localStorage = storage(init);
  vi.stubGlobal('window', { location: { hash, pathname: '/', search: '' }, history: { state: null, replaceState() {} }, localStorage });
  return localStorage;
}

afterEach(() => vi.unstubAllGlobals());

describe('wejście do aplikacji (pusty adres)', () => {
  it('pierwsza wizyta (pusta pamięć) otwiera Dziś i zapisuje pierwszą wizytę', () => {
    const s = page('');
    expect(enterApp(1)).toBe('dzis');
    expect(s.getItem('hq.onboarding.v1')).not.toBeNull();
  });

  it('kolejne wejście po samej pierwszej wizycie bez ostatniego widoku: W sesji (klucz hq.* jest)', () => {
    page('');
    enterApp(1);
    expect(enterApp(2)).toBe('charts');
  });

  it('powrót otwiera ostatni widok', () => {
    page('', { 'hq.view.last': 'markets', 'hq.onboarding.v1': '{}' });
    expect(enterApp(1)).toBe('markets');
  });

  it('stały użytkownik sprzed Startu (klucze hq.*, bez ostatniego widoku) zostaje na W sesji', () => {
    page('', { 'hq.lang': 'pl' });
    expect(enterApp(1)).toBe('charts');
  });

  it('adres z widokiem wygrywa', () => {
    page('#after');
    expect(enterApp(1)).toBe('after');
  });

  it('pierwsza wizyta z adresu #flow: zapisana jako pierwsza (dymki), choć adres zapisuje klucz hq.charts.dock.v1', () => {
    const s = page('#flow');
    expect(enterApp(1)).toBe('charts');
    expect(s.getItem('hq.charts.dock.v1')).toBe('1');
    expect(tipsPending(s)).toBe(true);
  });
});
