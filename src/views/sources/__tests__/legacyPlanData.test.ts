import { describe, expect, it } from 'vitest';
import { LEDGER_KEY, makeEntry } from '../../../utils/forecastLedger';
import { legacyPlanJson, legacyPlanSummary } from '../legacyPlanData';

function fakeStorage(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

const entry = (t: number) => makeEntry({ direction: 'LONG', entry: 100, stop: 99, target: 102, horizonMin: 60, pTarget: 0.4, pStop: 0.3, pNeither: 0.3 }, t);

describe('legacyPlanSummary', () => {
  it('liczy plany z hq.ledger.v1', () => {
    const s = fakeStorage({ [LEDGER_KEY]: JSON.stringify([entry(1), entry(2)]) });
    expect(legacyPlanSummary(s)).toEqual({ plans: 2, hasEquity: false });
  });
  it('pusty storage daje zero planów', () => {
    expect(legacyPlanSummary(fakeStorage())).toEqual({ plans: 0, hasEquity: false });
  });
  it('wykrywa zapisany kapitał hq.plan.equity', () => {
    expect(legacyPlanSummary(fakeStorage({ 'hq.plan.equity': '10000' })).hasEquity).toBe(true);
  });
});

describe('legacyPlanJson', () => {
  const NOW = Date.UTC(2026, 10, 7, 12, 0);
  it('plik eksportu: klucz, chwila eksportu, plany i kapitał (napis z pamięci)', () => {
    const s = fakeStorage({ [LEDGER_KEY]: JSON.stringify([entry(1), entry(2)]), 'hq.plan.equity': '25000' });
    const j = JSON.parse(legacyPlanJson(s, NOW));
    expect(Object.keys(j)).toEqual(['key', 'exportedAt', 'entries', 'equity']);
    expect(j.key).toBe(LEDGER_KEY);
    expect(j.exportedAt).toBe('2026-11-07T12:00:00.000Z');
    expect(j.entries).toHaveLength(2);
    expect(j.equity).toBe('25000');
  });
  it('bez zapisanego kapitału equity = null; pamięć nietknięta', () => {
    const before = { [LEDGER_KEY]: JSON.stringify([entry(1)]) };
    const s = fakeStorage(before);
    expect(JSON.parse(legacyPlanJson(s, NOW)).equity).toBeNull();
    expect(s.getItem(LEDGER_KEY)).toBe(before[LEDGER_KEY]);
    expect(s.length).toBe(1);
  });
});
