import { describe, expect, it } from 'vitest';
import { coverAlt, coverSvg, liqSide, liqUsd, sessionHoursUtc } from './cover.mjs';

const post = {
  ms: Date.parse('2026-11-13T08:05:10+01:00'),
  section: 'Mapa dnia',
  price: 69044,
  levels: [
    { label: 'VWAP dnia', price: 69399, note: '77% dotknięcia do 13:00' },
    { label: 'Likwidacje longów', price: 67975, note: '9,3 mln USD, 17% dotknięcia do 13:00' },
    { label: 'Likwidacje shortów', price: 69975, note: '1 400,5 mln USD, 35% dotknięcia do 13:00' },
  ],
  scenarios: [
    { label: 'Cena o 13:00 poniżej 67 980', probability: 9 },
    { label: 'Cena o 13:00 między 67 980 a 69 980', probability: 74 },
    { label: 'Cena o 13:00 powyżej 69 980', probability: 17 },
  ],
};

describe('okładka wpisu', () => {
  it('czyta kwotę i stronę skupiska likwidacji', () => {
    expect(liqUsd('9,3 mln USD, 17% dotknięcia')).toBe(9.3);
    expect(liqUsd('1 400,5 mln USD')).toBe(1400.5);
    expect(liqUsd('77% dotknięcia')).toBeNull();
    expect(liqSide('Likwidacje longów')).toBe('long');
    expect(liqSide('Likwidacje shortów')).toBe('short');
    expect(liqSide('VWAP dnia')).toBeNull();
  });

  it('sesje w UTC zależą od czasu letniego Londynu i Nowego Jorku', () => {
    expect(sessionHoursUtc(Date.parse('2026-11-13T12:00:00Z'))).toEqual({ asia: 0, london: 8, ny: 14.5 });
    expect(sessionHoursUtc(Date.parse('2026-07-01T12:00:00Z'))).toEqual({ asia: 0, london: 7, ny: 13.5 });
  });

  it('rysuje cenę, poziom struktury, paski likwidacji i rozkład scenariuszy bez kierunku', () => {
    const svg = coverSvg(post);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('69 044');
    expect(svg).toContain('VWAP dnia');
    expect(svg.match(/fill-opacity="0.7"/g)).toHaveLength(2);
    // Najbardziej prawdopodobny scenariusz wyróżniony, procenty bez strzałek ani słów kierunku
    expect(svg).toContain('>74%<');
    expect(svg).not.toMatch(/▲|▼|wzrost|spad|long |short /i);
    expect(svg).not.toMatch(/<script|on\w+=/i);
  });

  it('bez ceny: sama tarcza doby', () => {
    const svg = coverSvg({ ms: post.ms, section: 'O HyperQuant', levels: [], scenarios: [] });
    expect(svg).toContain('<circle');
    expect(svg).not.toContain('VWAP');
  });

  it('escapuje etykiety poziomów', () => {
    const svg = coverSvg({ ...post, levels: [{ label: '<b>x</b>', price: 69500, note: '' }] });
    expect(svg).toContain('&lt;b&gt;');
    expect(svg).not.toContain('<b>');
  });

  it('tekst alternatywny opisuje okładkę', () => {
    expect(coverAlt(post)).toBe('Okładka: cena 69 044 USD na tle 3 poziomów z wpisu i tarczy doby z godziną publikacji');
  });
});
