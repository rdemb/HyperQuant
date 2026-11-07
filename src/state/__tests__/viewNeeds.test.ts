import { describe, expect, it } from 'vitest';
import { VIEWS } from '../route';
import { awaitingBars, needsVolModel } from '../viewNeeds';

describe('czego widok potrzebuje przed renderem', () => {
  it('do pierwszych świec stan „łączenie” tylko w Badaniach (metryki ilościowe z pustych danych byłyby zmyślone)', () => {
    expect(VIEWS.filter((v) => awaitingBars(v, 0))).toEqual(['research']);
    // Wykresy faz mają własne dane; Przed sesją czeka tylko pas kontekstu (w widoku)
    expect(awaitingBars('before', 0)).toBe(false);
    expect(awaitingBars('charts', 0)).toBe(false);
  });

  it('po pierwszych świecach żaden widok nie czeka', () => {
    expect(VIEWS.filter((v) => awaitingBars(v, 1))).toEqual([]);
    expect(VIEWS.filter((v) => awaitingBars(v, 500))).toEqual([]);
  });

  it('model zmienności (ok. 1,3 MB świec) tylko Przed sesją i w Badaniach', () => {
    expect(VIEWS.filter(needsVolModel)).toEqual(['before', 'research']);
  });
});
