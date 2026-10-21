import { describe, expect, it } from 'vitest';
import { candlesLabel, horizonDuration } from '../horizon';

describe('candlesLabel', () => {
  it('odmienia „świeca” po polsku', () => {
    expect(candlesLabel(1)).toBe('+1 świeca');
    expect(candlesLabel(3)).toBe('+3 świece');
    expect(candlesLabel(6)).toBe('+6 świec');
    expect(candlesLabel(12)).toBe('+12 świec');
    expect(candlesLabel(22)).toBe('+22 świece');
  });
});

describe('horizonDuration', () => {
  it('przelicza liczbę świec na czas przy bieżącym interwale', () => {
    expect(horizonDuration(1, 300)).toBe('5 min');
    expect(horizonDuration(3, 300)).toBe('15 min');
    expect(horizonDuration(12, 300)).toBe('1 h');
    expect(horizonDuration(6, 900)).toBe('1.5 h');
    expect(horizonDuration(12, 14400)).toBe('2 d');
    expect(horizonDuration(1, 60)).toBe('1 min');
  });

  it('zwraca „—” przy braku interwału', () => {
    expect(horizonDuration(3, 0)).toBe('—');
    expect(horizonDuration(3, Number.NaN)).toBe('—');
  });
});
