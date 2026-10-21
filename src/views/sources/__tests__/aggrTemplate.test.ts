import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { summarizeAggrTemplate } from '../aggrTemplate';

describe('summarizeAggrTemplate', () => {
  it('podsumowuje realny plik public/data/aggr_template.json', () => {
    const raw = JSON.parse(readFileSync(new URL('../../../../public/data/aggr_template.json', import.meta.url), 'utf8'));
    const s = summarizeAggrTemplate(raw)!;
    expect(s.name).toBe('aggrBTCv5');
    expect(s.version).toBe(7);
    expect(s.panes).toEqual({ total: 8, byType: { chart: 3, stats: 2, trades: 3 } });
    expect(s.indicators).toBe(30);
    expect(s.markets).toBe(41);
    expect(s.exchanges).toBe(15);
    // Progi taśmy perp z szablonu = progi classifyAggrThresholdTier
    expect(s.tapes.find((t) => t.name === 'Perp Trades')?.amounts).toEqual([48000, 430000, 930000, 2000000]);
    expect(s.tapes.find((t) => t.name === 'Spot Trades')?.amounts).toEqual([5000, 43000, 93000, 433000]);
  });

  it('odrzuca dane, które nie są workspace’em Aggr', () => {
    expect(summarizeAggrTemplate(null)).toBeNull();
    expect(summarizeAggrTemplate({ states: {} })).toBeNull();
    expect(summarizeAggrTemplate('<!doctype html>')).toBeNull();
  });
});
