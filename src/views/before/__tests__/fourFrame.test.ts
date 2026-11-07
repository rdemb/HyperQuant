import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FourNumbers, fourNumbersText } from '../../../utils/fourNumbers';
import { frameAlt } from '../../../charts/pro/chart/frame';
import { fourCanvas, fourTitle } from '../fourFrame';
import { ctxOf, fakeDocument } from '../../../charts/pro/__tests__/fakeCanvas';

const N: FourNumbers = {
  coin: 'BTC',
  now: new Date(2026, 10, 7, 7, 30).getTime(),
  items: [
    { id: 'clarity', title: 'Czytelność wczoraj', value: 'trendowy · mapa 2/4', badge: 'MODEL', flag: 'luka', hint: 'MODEL · Dalton: sesja NY' },
    { id: 'fuel', title: 'Paliwo ±1%', value: 'pod 3,5M · nad 3,4M', badge: 'LIVE', note: '5 min', hint: 'Mapa skanera' },
    { id: 'hourWidth', title: 'Szerokość · Londyn 09:00', value: '—', badge: 'MODEL', hint: 'MODEL · mediana 20 dni: za mało historii' },
    { id: 'vwap', title: 'Od VWAP', value: '—', badge: 'LIVE', note: 'tylko BTC', hint: 'Tylko BTC' },
  ],
};

beforeEach(() => vi.stubGlobal('document', fakeDocument()));
afterEach(() => vi.unstubAllGlobals());

describe('Czwórka w Klatce: karta na płótnie', () => {
  it('podpis z rynkiem, w każdym kaflu tytuł, wartość, plakietka (wiek albo „tylko BTC” zamiast niej, „luka” obok) i źródło', () => {
    const ctx = ctxOf(fourCanvas(N, '16:9')!);
    const texts = ctx.texts.map((t) => t.text);
    expect(texts).toContain('CZWÓRKA · BTC');
    for (const i of N.items) {
      expect(texts).toContain(i.title.toLocaleUpperCase('pl-PL'));
      expect(texts).toContain(i.value);
    }
    // Jak na karcie: wiek migawki i „tylko BTC” zamiast plakietki, „luka” obok MODEL
    for (const b of ['MODEL', '5 MIN', 'TYLKO BTC', 'LUKA']) expect(texts).toContain(b);
    expect(texts).not.toContain('LIVE');
    const all = texts.join(' ');
    for (const i of N.items) expect(all).toContain(i.hint);
    expect(all).toContain('Opis, nie sygnał');
  });

  it('16:9 — cztery kafle w jednym rzędzie, 1:1 — 2 × 2', () => {
    const rows = (ratio: '16:9' | '1:1') => {
      const ctx = ctxOf(fourCanvas(N, ratio)!);
      return new Set(N.items.map((i) => ctx.texts.find((t) => t.text === i.title.toLocaleUpperCase('pl-PL'))!.y)).size;
    };
    expect(rows('16:9')).toBe(1);
    expect(rows('1:1')).toBe(2);
    const wide = fourCanvas(N, '16:9')!;
    const square = fourCanvas(N, '1:1')!;
    expect(wide.width / wide.height).toBeGreaterThan(2.5);
    expect(square.width / square.height).toBeLessThan(2);
  });

  it('bez kontekstu 2D — null (Klatka pokaże błąd zamiast pustej karty)', () => {
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => null }) });
    expect(fourCanvas(N, '16:9')).toBeNull();
  });

  it('tekst alternatywny Klatki Czwórki: każda liczba raz (opis ma wszystkie cztery, tytuł ich nie powtarza)', () => {
    const q = { tapePct: null, mapPct: null, tapeWhy: 'Czwórka liczy ze świec', mapWhy: 'tylko BTC' };
    const alt = frameAlt({ title: fourTitle(N), time: N.now, source: 'Hyperliquid', quality: q, body: fourNumbersText(N) });
    const count = (s: string) => alt.split(s).length - 1;
    for (const i of N.items) expect(count(`${i.title}: `), i.id).toBe(1);
    expect(count('pod 3,5M · nad 3,4M')).toBe(1);
    expect(count('trendowy · mapa 2/4')).toBe(1);
    expect(alt).toContain('Czwórka BTC przed sesją.');
    // Tytuł zmieniony przez użytkownika zostaje w całości (inne słowa niż w opisie)
    const own = frameAlt({ title: 'Paliwo blisko ceny\nPaliwo ±1%: pod 3,5M (LIVE)', time: N.now, source: 'Hyperliquid', quality: q, body: fourNumbersText(N) });
    expect(own).toContain('Paliwo blisko ceny. Paliwo ±1%: pod 3,5M (LIVE).');
  });

  it('domyślny tytuł Klatki Czwórki: rynek i liczba z karty, bez rad', () => {
    const t = fourTitle(N);
    expect(t).toContain('BTC');
    expect(t).toContain('pod 3,5M · nad 3,4M');
    expect(t.toLowerCase()).not.toMatch(/kup|sprzedaj|\bbuy\b|\bsell\b/);
  });
});
