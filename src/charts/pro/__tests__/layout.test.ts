import { describe, expect, it } from 'vitest';
import { CELL_MIN_ROW_PX, CELL_MIN_SPACING, autoRowStep, cellAreaPx, cellFontPx, fmtCell, pickDetail } from '../chart/layout';

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
    expect(pickDetail(CELL_MIN_SPACING, CELL_MIN_ROW_PX)).toBe('cells');
    expect(pickDetail(CELL_MIN_SPACING - 1, CELL_MIN_ROW_PX)).toBe('profile');
    expect(pickDetail(200, 5)).toBe('profile');
  });

  it('wąska świeca albo wiersz poniżej piksela → zwykła świeca', () => {
    expect(pickDetail(5, 20)).toBe('candle');
    expect(pickDetail(40, 0.5)).toBe('candle');
  });
});

describe('cellFontPx', () => {
  it('rozmiar czcionki w granicach 9–12 px', () => {
    expect(cellFontPx(8)).toBe(9);
    expect(cellFontPx(14)).toBe(10);
    expect(cellFontPx(40)).toBe(12);
  });

  it('wąska kolumna ogranicza czcionkę, ale nie poniżej 9 px', () => {
    // 3 znaki po 0,6 em + 2 px marginesu: kolumna 20 px mieści 10 px
    expect(cellFontPx(40, 20)).toBe(10);
    expect(cellFontPx(40, 12)).toBe(9);
    expect(cellFontPx(40, 40, 4)).toBe(12);
  });
});

describe('cellAreaPx', () => {
  it('przy najmniejszej szerokości komórek bid × ask para trzech znaków 9 px mieści się w kolumnach', () => {
    const col = cellAreaPx(CELL_MIN_SPACING) / 2;
    expect(col).toBeGreaterThanOrEqual(3 * 0.6 * 9 + 2);
  });
});

describe('fmtCell', () => {
  it('najwyżej trzy znaki i zero tylko dla braku transakcji', () => {
    expect(fmtCell(0)).toBe('0');
    expect(fmtCell(0.001)).toBe('.00');
    expect(fmtCell(0.05)).toBe('.05');
    expect(fmtCell(0.994)).toBe('.99');
    expect(fmtCell(0.996)).toBe('1.0');
    expect(fmtCell(1.24)).toBe('1.2');
    expect(fmtCell(9.96)).toBe('10');
    expect(fmtCell(37.6)).toBe('38');
    expect(fmtCell(999.4)).toBe('999');
    expect(fmtCell(1240)).toBe('1K');
  });
});
