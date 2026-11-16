import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NearestLevelsView } from '../NearestLevelsPanel';
import type { LevelRow, NearestLevels } from '../../../utils/nearestLevels';

const NOW = Date.UTC(2026, 10, 10, 16, 10);
const row = (id: LevelRow['id'], label: string, px: number, o: Partial<LevelRow> = {}): LevelRow => ({
  id,
  label,
  px,
  badge: 'LIVE',
  hint: `opis ${label}`,
  distPct: (px / 100_000 - 1) * 100,
  distAtr: Math.abs(px - 100_000) / 50,
  fuel: 1_500_000,
  ...o,
});

const base: NearestLevels = {
  coin: 'BTC',
  now: NOW,
  price: 100_000,
  atr: { value: 50, n: 14 },
  above: [row('vwapUp1', 'VWAP +1σ', 100_200), row('pdh', 'PDH', 100_900), row('liqShort', 'Klaster likw. shortów', 101_500, { badge: 'MODEL' })],
  below: [row('vwap', 'VWAP doby', 99_900), row('pdl', 'PDL', 99_100, { fuel: { why: 'Poziom poza zasięgiem mapy likwidacji' } })],
  hidden: 0,
  missing: [
    { id: 'coneHi', label: 'Stożek 1 h: górna granica 90%', badge: 'MODEL', why: 'Brak prognozy z ostatnich 3 h' },
    { id: 'coneLo', label: 'Stożek 1 h: dolna granica 90%', badge: 'MODEL', why: 'Brak prognozy z ostatnich 3 h' },
  ],
  liq: { asOf: NOW - 60_000, share: 0.48, delayed: false },
  entry: { why: 'Czekam na dane…' },
};

const ids = (html: string) => [...html.matchAll(/data-poziom="(\w+)"/g)].map((m) => m[1]);

describe('Najbliższe poziomy: widok', () => {
  it('drabinka: od najdalszego poziomu nad ceną, przez cenę, do najdalszego pod nią', () => {
    const html = renderToStaticMarkup(<NearestLevelsView n={base} />);
    expect(ids(html)).toEqual(['liqShort', 'pdh', 'vwapUp1', 'vwap', 'pdl']);
    const price = html.indexOf('>Cena<');
    expect(price).toBeGreaterThan(html.indexOf('data-poziom="vwapUp1"'));
    expect(price).toBeLessThan(html.indexOf('data-poziom="vwap"'));
    expect(html).toContain('Najbliższe poziomy');
    expect(html).toContain('+0,20%');
    expect(html).toContain('−0,90%');
  });

  it('plakietki LIVE i MODEL przy poziomach; paliwo bez liczby — „—” z powodem w podpowiedzi', () => {
    const html = renderToStaticMarkup(<NearestLevelsView n={base} />);
    expect(html.match(/data-tone="model"/g)).toHaveLength(1);
    expect(html.match(/data-tone="live"/g)).toHaveLength(4);
    expect(html).toContain('title="Poziom poza zasięgiem mapy likwidacji">—<');
  });

  it('poziomy bez liczby zgrupowane po wspólnym powodzie; legenda z pokryciem mapy i stanem Uwięzionych', () => {
    const html = renderToStaticMarkup(<NearestLevelsView n={base} />);
    expect(html).toContain('Bez liczby');
    expect(html.split('Brak prognozy z ostatnich 3 h')).toHaveLength(2);
    expect(html).toContain('Stożek 1 h: górna granica 90%, Stożek 1 h: dolna granica 90%');
    expect(html).toContain('Mapa likwidacji: pokrycie 48% open interest');
    expect(html).toContain('Uwięzieni: — Czekam na dane…');
    expect(html).toContain('Opis, nie rekomendacja.');
  });

  it('bez ceny: stan pusty z powodem, bez wierszy i bez liczb zastępczych', () => {
    const html = renderToStaticMarkup(<NearestLevelsView n={{ ...base, price: { why: 'Czekam na dane…' }, above: [], below: [], atr: { why: 'Czekam na dane…' } }} />);
    expect(ids(html)).toEqual([]);
    expect(html).toContain('Czekam na dane…');
    expect(html).not.toContain('>Cena<');
  });
});
