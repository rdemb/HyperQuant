import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { liczbyPozaEtykietami, noweWidoki } from './pustyStan.mjs';

describe('pusty stan: sprawdzanie tekstu widoku', () => {
  it('etykiety z liczbami przechodzą', () => {
    for (const t of ['Obrót 24 h', 'Paliwo ±1%', 'IB 60 min', 'Mediana 20 dni', '01 · Przed sesją', '—', 'Brak danych: mapa likwidacji niedostępna', 'Łączę… 12 s'])
      expect(liczbyPozaEtykietami(t), t).toEqual([]);
  });

  it('wartości i stałe makiety są wykrywane', () => {
    expect(liczbyPozaEtykietami('Klarowność 78/100')).toContain('78/100');
    expect(liczbyPozaEtykietami('Paliwo 22,6 mln')).toContain('22,6');
    expect(liczbyPozaEtykietami('Cena 80 434')).not.toEqual([]);
    expect(liczbyPozaEtykietami('Zmiana −0,04%')).not.toEqual([]);
    expect(liczbyPozaEtykietami('Budżet 128%')).not.toEqual([]);
    expect(liczbyPozaEtykietami('Wynik NaN')).toContain('NaN/Infinity');
  });
});

describe('lista widoków nowego wyglądu z src/nowy/widoki.ts', () => {
  it('czyta klucze rejestru (pusty rejestr = pusta lista)', () => {
    expect(noweWidoki('export const NOWE_WIDOKI: X = {};')).toEqual([]);
    expect(noweWidoki("export const NOWE_WIDOKI: X = {\n  charts: lazy(() => import('./widoki/WSesji')),\n  before: lazy(() => import('./widoki/PrzedSesja')),\n};")).toEqual(['charts', 'before']);
    expect(Array.isArray(noweWidoki(readFileSync('src/nowy/widoki.ts', 'utf8')))).toBe(true);
  });
});
