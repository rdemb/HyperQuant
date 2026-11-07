import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INDICATORS, indicatorDef, shortHistoryNote } from '../indicators/registry';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

describe('RVOL przy krótkiej historii wykresu', () => {
  const rvol = indicatorDef('rvol');

  it('1m (ok. 1 doby świec) i 5m (ok. 5 dób): w legendzie panelu powód zamiast pustego panelu', () => {
    expect(shortHistoryNote(rvol, 1500 * MIN)).toBe('za mało historii (min. 10 dni)');
    expect(shortHistoryNote(rvol, 1500 * 5 * MIN)).toBe('za mało historii (min. 10 dni)');
    expect(shortHistoryNote(rvol, 10 * DAY - MIN)).toBe('za mało historii (min. 10 dni)');
  });

  it('od 10 dni historii (15m: ok. 15 dób) — bez uwagi, wartości liczy model', () => {
    expect(shortHistoryNote(rvol, 10 * DAY)).toBeNull();
    expect(shortHistoryNote(rvol, 1500 * 15 * MIN)).toBeNull();
  });

  it('inne wskaźniki bez progu historii nie dostają uwagi', () => {
    for (const d of INDICATORS) if (d.id !== 'rvol') expect(shortHistoryNote(d, MIN), d.id).toBeNull();
  });

  it('legenda panelu wskaźnika pokazuje uwagę o historii', () => {
    expect(readFileSync('src/charts/pro/chart/controller.ts', 'utf8')).toMatch(/shortHistoryNote\(def,/);
  });
});
