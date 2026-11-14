import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLIKI_APLIKACJI, cyfryPozaEtykietami, noweWidoki } from './pustyStan.mjs';

describe('pusty stan: każda cyfra poza etykietą to błąd', () => {
  it('tekst bez cyfr przechodzi', () => {
    for (const t of ['—', 'Brak danych: mapa likwidacji niedostępna', 'Klarowność — Paliwo — RVOL —']) expect(cyfryPozaEtykietami(t), t).toEqual([]);
  });

  it('każda wartość jest wykrywana (także te, które przepuszczała heurystyka)', () => {
    for (const t of ['RVOL 1.28×', 'Paliwo 8.1 mln', 'Klarowność 78', 'Paliwo 22 mln', 'Funding +12 bp', 'OI $2B', 'Odchylenie −3 σ', 'Bid 64 USD', 'n = 42', 'Cena 80 434'])
      expect(cyfryPozaEtykietami(t).length, t).toBeGreaterThan(0);
    expect(cyfryPozaEtykietami('Wynik NaN')).toContain('NaN/Infinity');
  });
});

describe('lista widoków nowego wyglądu z src/nowy/widoki.ts', () => {
  it('czyta klucze rejestru, także w cudzysłowie i z komentarzem', () => {
    expect(noweWidoki('export const NOWE_WIDOKI: X = {};')).toEqual([]);
    expect(noweWidoki("export const NOWE_WIDOKI: X = {\n  charts: lazy(() => import('./widoki/WSesji')),\n  // komentarz: before\n  'before': lazy(() => import('./widoki/PrzedSesja')),\n};")).toEqual(['charts', 'before']);
    expect(Array.isArray(noweWidoki(readFileSync('src/nowy/widoki.ts', 'utf8')))).toBe(true);
  });

  it('niezgodna liczba import() i kluczy to błąd, nie cicho pominięty widok', () => {
    expect(() => noweWidoki("export const NOWE_WIDOKI: X = {\n  [k]: lazy(() => import('./widoki/A')),\n};")).toThrow(/import\(\)/);
  });
});

describe('pusty stan: pliki z tej samej strony', () => {
  it('przechodzą tylko pliki aplikacji, dane (lekcje, powtórki, szablony) nie', () => {
    for (const p of ['/', '/index.html', '/assets/index-x.js', '/fonts/fonts.css', '/sw.js', '/manifest.webmanifest', '/icons/a.png', '/favicon.svg']) expect(PLIKI_APLIKACJI.test(p), p).toBe(true);
    for (const p of ['/lessons/ny.json', '/data/aggr_template.json', '/lessons/replay/x.json', '/schrodi/model.json']) expect(PLIKI_APLIKACJI.test(p), p).toBe(false);
  });
});
