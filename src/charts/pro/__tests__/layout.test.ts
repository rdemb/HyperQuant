import { describe, expect, it } from 'vitest';
import { CELL_MIN_ROW_PX, autoRowStep, cellFontPx, cellMinSpacing, pickDetail } from '../chart/layout';

describe('autoRowStep', () => {
  it('wybiera najmniejszy krok z drabiny o wysokości ≥ minimum', () => {
    // 2 px/USD, minimum 13 px: 5 USD = 10 px za mało, 10 USD = 20 px
    expect(autoRowStep(2, 1, 13)).toBe(10);
    expect(autoRowStep(20, 1, 13)).toBe(1);
    expect(autoRowStep(7, 1, 13)).toBe(2);
    expect(autoRowStep(0.3, 1, 13)).toBe(50);
  });

  it('przechodzi do kolejnych rzędów wielkości (×100) i pozostaje wielokrotnością ticku', () => {
    expect(autoRowStep(0.05, 1, 13)).toBe(500);
    expect(autoRowStep(0.002, 1, 13)).toBe(10_000);
    expect(autoRowStep(2, 10, 13)).toBe(10);
    expect(autoRowStep(0.5, 10, 13)).toBe(50);
  });

  it('bez skali zwraca tick', () => {
    expect(autoRowStep(0, 1, 13)).toBe(1);
    expect(autoRowStep(Number.NaN, 10, 13)).toBe(10);
  });
});

describe('pickDetail', () => {
  it('komórki tylko przy szerokiej świecy i wysokim wierszu', () => {
    expect(pickDetail(cellMinSpacing('bidask'), CELL_MIN_ROW_PX, 'bidask')).toBe('cells');
    expect(pickDetail(cellMinSpacing('bidask') - 1, CELL_MIN_ROW_PX, 'bidask')).toBe('profile');
    expect(pickDetail(cellMinSpacing('delta'), CELL_MIN_ROW_PX, 'delta')).toBe('cells');
    expect(pickDetail(200, 5, 'bidask')).toBe('profile');
  });

  it('wąska świeca albo wiersz poniżej piksela → zwykła świeca', () => {
    expect(pickDetail(5, 20, 'volume')).toBe('candle');
    expect(pickDetail(40, 0.5, 'volume')).toBe('candle');
  });
});

describe('cellFontPx', () => {
  it('rozmiar czcionki w granicach 9–12 px', () => {
    expect(cellFontPx(8)).toBe(9);
    expect(cellFontPx(14)).toBe(10);
    expect(cellFontPx(40)).toBe(12);
  });
});
