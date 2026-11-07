import { describe, expect, it } from 'vitest';
import { LEDGER_KEY, makeEntry } from '../../../utils/forecastLedger';
import { legacyPlanJson, legacyPlanSummary, legacyRawText, plansLabel } from '../legacyPlanData';

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
    expect(legacyPlanSummary(s)).toEqual({ plans: 2, hasEquity: false, unreadable: false });
  });
  it('pusty storage daje zero planów', () => {
    expect(legacyPlanSummary(fakeStorage())).toEqual({ plans: 0, hasEquity: false, unreadable: false });
    expect(legacyPlanSummary(fakeStorage({ [LEDGER_KEY]: '[]' }))).toEqual({ plans: 0, hasEquity: false, unreadable: false });
  });
  it('wykrywa zapisany kapitał hq.plan.equity', () => {
    expect(legacyPlanSummary(fakeStorage({ 'hq.plan.equity': '10000' })).hasEquity).toBe(true);
  });
  it('zapis nie do odczytu (zły JSON, nie tablica, wpisy odrzucone przy odczycie) to „unreadable”', () => {
    expect(legacyPlanSummary(fakeStorage({ [LEDGER_KEY]: '{uszkodzone' }))).toEqual({ plans: 0, hasEquity: false, unreadable: true });
    expect(legacyPlanSummary(fakeStorage({ [LEDGER_KEY]: '{"a":1}' })).unreadable).toBe(true);
    expect(legacyPlanSummary(fakeStorage({ [LEDGER_KEY]: JSON.stringify([entry(1), { zly: true }]) }))).toEqual({ plans: 1, hasEquity: false, unreadable: true });
  });
});

describe('legacyRawText', () => {
  it('surowy napis hq.ledger.v1 bez zmian; klucz nietknięty', () => {
    const s = fakeStorage({ [LEDGER_KEY]: '{uszkodzone' });
    expect(legacyRawText(s)).toBe('{uszkodzone');
    expect(s.getItem(LEDGER_KEY)).toBe('{uszkodzone');
    expect(legacyRawText(fakeStorage())).toBeNull();
  });
});

describe('plansLabel', () => {
  it('polskie liczebniki: 1 zapisany plan, 2–4 zapisane plany, 5+ i 12–14 zapisanych planów', () => {
    expect([1, 2, 4, 5, 12, 14, 22, 25, 101].map(plansLabel)).toEqual([
      '1 zapisany plan',
      '2 zapisane plany',
      '4 zapisane plany',
      '5 zapisanych planów',
      '12 zapisanych planów',
      '14 zapisanych planów',
      '22 zapisane plany',
      '25 zapisanych planów',
      '101 zapisanych planów',
    ]);
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
