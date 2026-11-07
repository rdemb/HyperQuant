import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FourNumbers } from '../../../utils/fourNumbers';
import { FourCardView } from '../FourCard';

const N: FourNumbers = {
  coin: 'BTC',
  now: Date.UTC(2026, 10, 7, 6, 30),
  items: [
    { id: 'clarity', title: 'Czytelność wczoraj', value: 'trendowy · mapa 2/4', badge: 'MODEL', flag: 'luka', hint: 'MODEL · Dalton: sesja NY' },
    { id: 'fuel', title: 'Paliwo ±1%', value: 'pod 3,5M · nad 3,4M', badge: 'LIVE', note: '5 min', hint: 'Mapa skanera' },
    { id: 'hourWidth', title: 'Szerokość · Londyn 09:00', value: '—', badge: 'MODEL', hint: 'MODEL · mediana 20 dni: za mało historii' },
    { id: 'vwap', title: 'Od VWAP', value: '—', badge: 'LIVE', note: 'tylko BTC', hint: 'Tylko BTC' },
  ],
};

describe('Czwórka: karta czterech liczb przed sesją', () => {
  const html = renderToStaticMarkup(<FourCardView n={N} />);

  it('cztery kafle: na komputerze jeden rząd, na telefonie 2×2', () => {
    expect(html).toContain('grid-cols-2');
    expect(html).toContain('lg:grid-cols-4');
    expect(html.match(/data-four=/g)).toHaveLength(4);
  });

  it('każdy kafel: tytuł, wartość, plakietka (wiek migawki albo „tylko BTC” zamiast niej) i podpowiedź', () => {
    for (const i of N.items) {
      expect(html).toContain(i.title);
      expect(html).toContain(i.value);
      expect(html).toContain(i.hint);
    }
    expect(html).toContain('MODEL');
    expect(html).toContain('5 min');
    expect(html).toContain('tylko BTC');
    // Luka w świecach 1m: uwaga obok plakietki MODEL, nie zamiast niej
    expect(html).toMatch(/MODEL<\/span><span[^>]*>luka</);
  });

  it('podpis karty z rynkiem i kotwica karty (Klatka, zadanie 9)', () => {
    expect(html).toContain('Czwórka');
    expect(html).toContain('BTC');
    expect(html).toContain('id="czworka"');
  });

  it('bez słów kupna i sprzedaży', () => {
    expect(html.toLowerCase()).not.toMatch(/kupuj|sprzedaj|\bbuy\b|\bsell\b|long\b|short\b/);
  });
});
