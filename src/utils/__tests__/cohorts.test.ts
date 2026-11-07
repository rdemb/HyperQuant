import { describe, expect, it } from 'vitest';
import { type CohortTotal, cohortNet, cohortSeen, cohortTakerNet, cohortWindowEnd } from '../cohorts';

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

  it('koniec okna sum: koniec ostatniego kubełka w pliku; bez kubełków — null', () => {
    const cells = { mm: null, informed: null, whale: null, rest: null };
    expect(cohortWindowEnd({ bucketMin: 15, buckets: [{ t: 0, cells }, { t: 900_000, cells }] })).toBe(1_800_000);
    expect(cohortWindowEnd({ bucketMin: 15, buckets: [] })).toBeNull();
  });
});
