import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ONBOARDING_KEY, startOnboarding, tipsPending } from '../../utils/firstVisit';

/** Atrapa Storage: Map z length/key. */
function fake(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

const T0 = Date.parse('2026-11-07T12:00:00Z');

describe('pierwszy kontakt: zapis pierwszej wizyty przy starcie aplikacji', () => {
  it('pierwsza wizyta na #before albo #after: wykresy zapisują hq.charts.*, a dymki W sesji i tak się pokazują', () => {
    const s = fake();
    // Start aplikacji (DeskProvider), zanim zamontuje się jakikolwiek wykres
    startOnboarding(s, T0);
    // Wykresy Przed sesją zapisują ustawienia
    s.setItem('hq.charts.v1', '{}');
    s.setItem('hq.charts.tabs.v1', '[]');
    // Później W sesji (FirstContact): zapis bez zmian, dymki czekają
    startOnboarding(s, T0 + 60_000);
    expect(tipsPending(s)).toBe(true);
    expect(JSON.parse(s.getItem(ONBOARDING_KEY)!)).toEqual({ firstAt: T0, done: false });
  });

  it('stały użytkownik z hq.charts.* sprzed tej wersji: bez zapisu i bez dymków', () => {
    const s = fake({ 'hq.charts.v1': '{}' });
    startOnboarding(s, T0);
    expect(s.getItem(ONBOARDING_KEY)).toBeNull();
    expect(tipsPending(s)).toBe(false);
  });

  it('moduł pierwszej wizyty bez modułów wykresu (jest w pierwszym pakiecie strony)', () => {
    expect(readFileSync('src/utils/firstVisit.ts', 'utf8')).not.toMatch(/from\s+['"][^'"]*charts\//);
  });
});
