import { describe, expect, it } from 'vitest';
import {
  type CohortFlow,
  type CohortTotal,
  cohortNet,
  cohortSeen,
  cohortTakerNet,
  cohortWindowEnd,
  hiddenTogether,
  informedNoneText,
  informedState,
  isCohortFlow,
  shareDenominator,
} from '../cohorts';

const T = (o: Partial<CohortTotal>): CohortTotal => ({ buy: 0, sell: 0, takerBuy: 0, takerSell: 0, hidden: 0, takerHidden: 0, ...o });

describe('odczyty sum kohort (panel Przepływ kohort i serwer MCP)', () => {
  it('netto = kupno − sprzedaż, agresor = kupno − sprzedaż jako biorca', () => {
    const t = T({ buy: 5e6, sell: 2e6, takerBuy: 1e6, takerSell: 3e6 });
    expect(cohortNet(t)).toBe(3e6);
    expect(cohortTakerNet(t)).toBe(-2e6);
  });

  it('kohorta „widoczna” w oknie: transakcje albo ukryte kubełki; bez nich — „—”, nie zero', () => {
    expect(cohortSeen(T({}))).toBe(false);
    expect(cohortSeen(T({ buy: 1e4 }))).toBe(true);
    expect(cohortSeen(T({ hidden: 1 }))).toBe(true);
    expect(cohortSeen(T({ takerHidden: 2 }))).toBe(true);
  });

  it('mianownik udziału = 2 × wolumen taśmy; plik bez wolumenu: suma widocznych tylko bez ukrytych komórek, inaczej nieznany', () => {
    const totals = { mm: T({ buy: 5e6, sell: 5e6 }), informed: T({}), whale: T({ hidden: 4 }), rest: T({ hidden: 4 }) };
    const tape = { volume: 7e6, hidden: { buy: 2e6, sell: 2e6, takerBuy: 1e6, takerSell: 1e6 } };
    expect(shareDenominator(totals, tape)).toBe(14e6);
    // Bez wolumenu taśmy udział MM wyszedłby 1 (10 / 10), więc mianownik nieznany
    expect(shareDenominator(totals, undefined)).toBeNull();
    expect(shareDenominator(totals, null)).toBeNull();
    const open = { mm: T({ buy: 5e6, sell: 3e6 }), informed: T({}), whale: T({ buy: 1e6, sell: 3e6 }), rest: T({}) };
    expect(shareDenominator(open, undefined)).toBe(12e6);
    expect(hiddenTogether(tape)).toEqual({ buy: 2e6, sell: 2e6, takerBuy: 1e6, takerSell: 1e6, hidden: 0, takerHidden: 0 });
    expect(hiddenTogether(undefined)).toBeNull();
  });

  it('„poinformowani”: przed klasyfikacją, nikogo nie wykryto (z liczbą sprawdzonych z pliku), wykryci', () => {
    const inf = (o: Partial<CohortFlow['informed']>) => ({
      informed: { candidates: 2640, selected: 0, fdrQ: 0.1, minN: 30, mu0Bp: 0.2, tauBp: 0, classifiedAt: 1, ...o },
    });
    expect(informedState(inf({ classifiedAt: null }))).toBe('pending');
    expect(informedState(inf({}))).toBe('none');
    expect(informedState(inf({ selected: 20 }))).toBe('detected');
    expect(informedNoneText(inf({}))).toBe('nie wykryto kont z trwałą przewagą (≈ 2640 sprawdzonych)');
    expect(informedNoneText(inf({ candidates: 0 }))).toBe('nie wykryto kont z trwałą przewagą (< 10 sprawdzonych)');
  });

  it('strażnik pliku: pole tape opcjonalne (pliki sprzed 11.11.2026), a gdy jest — liczby albo null', () => {
    const cells = { mm: null, informed: null, whale: null, rest: null };
    const tot = { mm: T({}), informed: T({}), whale: T({}), rest: T({}) };
    const m = { hours: 0, hiddenHours: 0, m1: null, m5: null, m60: null };
    const base = {
      v: 1,
      coin: 'BTC',
      asOf: 1,
      since: 0,
      bucketMin: 15,
      buckets: [{ t: 0, cells }],
      totals: { h1: tot, h24: tot },
      members: { mm: 0, informed: 0, whale: 0, rest: 0 },
      informed: { candidates: 0, selected: 0, fdrQ: 0.1, minN: 30, mu0Bp: null, tauBp: null, classifiedAt: null },
      oos: { mm: m, informed: m, whale: m, rest: m },
      kMin: 5,
      method: 'hl-cohorts-v1',
    };
    expect(isCohortFlow(base)).toBe(true);
    expect(isCohortFlow({ ...base, tape: { h1: null, h24: { volume: 1e6, hidden: { buy: 0, sell: 0, takerBuy: 0, takerSell: 0 } } } })).toBe(true);
    expect(isCohortFlow({ ...base, tape: { h1: null, h24: { volume: 'x', hidden: {} } } })).toBe(false);
  });

  it('koniec okna sum: koniec ostatniego kubełka w pliku; bez kubełków — null', () => {
    const cells = { mm: null, informed: null, whale: null, rest: null };
    expect(cohortWindowEnd({ bucketMin: 15, buckets: [{ t: 0, cells }, { t: 900_000, cells }] })).toBe(1_800_000);
    expect(cohortWindowEnd({ bucketMin: 15, buckets: [] })).toBeNull();
  });
});
