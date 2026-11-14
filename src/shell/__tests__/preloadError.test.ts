import { describe, expect, it, vi } from 'vitest';
import { PRZELADOWANIE_KEY, PRZERWA_MS, obsluzBladLadowania } from '../preloadError';

function sesja(start: Record<string, string> = {}) {
  const m = new Map(Object.entries(start));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe('błąd ładowania leniwego modułu po wdrożeniu (vite:preloadError)', () => {
  it('pierwszy błąd: zapis znacznika, przerwanie domyślnego błędu i jedno przeładowanie', () => {
    const s = sesja();
    const reload = vi.fn();
    const preventDefault = vi.fn();
    expect(obsluzBladLadowania({ preventDefault }, s, reload, 1_000_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(s.getItem(PRZELADOWANIE_KEY)).toBe('1000000');
  });

  it('kolejny błąd zaraz po przeładowaniu: bez pętli, błąd idzie dalej (ekran błędu)', () => {
    const s = sesja({ [PRZELADOWANIE_KEY]: '1000000' });
    const reload = vi.fn();
    const preventDefault = vi.fn();
    expect(obsluzBladLadowania({ preventDefault }, s, reload, 1_000_000 + PRZERWA_MS - 1)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('błąd po dłuższej przerwie (następne wdrożenie): znów jedno przeładowanie', () => {
    const s = sesja({ [PRZELADOWANIE_KEY]: '1000000' });
    const reload = vi.fn();
    expect(obsluzBladLadowania({ preventDefault: () => {} }, s, reload, 1_000_000 + PRZERWA_MS)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('niedostępna pamięć sesji: bez przeładowania (bez znacznika nie da się wykluczyć pętli)', () => {
    const zla = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('x');
      },
    };
    const reload = vi.fn();
    expect(obsluzBladLadowania({ preventDefault: () => {} }, zla, reload, 1)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
