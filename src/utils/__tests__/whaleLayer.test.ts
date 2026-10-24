import { describe, expect, it } from 'vitest';
import { type WhaleOrder, groupWhaleOrders } from '../whaleLayer';

const order = (o: Partial<WhaleOrder>): WhaleOrder => ({ id: 'Wa', side: 'ask', px: 190, usd: 190_000, kind: 'limit', reduce: false, at: 0, ...o });

describe('groupWhaleOrders', () => {
  it('łączy zlecenia konta po stronie i rodzaju: zakres cen, liczba, suma; od największej sumy', () => {
    const g = groupWhaleOrders([
      order({ px: 190.1 }),
      order({ px: 190.4 }),
      order({ px: 189.9 }),
      order({ side: 'bid', px: 188, usd: 188_000 }),
      order({ side: 'bid', px: 187.5, usd: 188_000, kind: 'stop' }),
      order({ id: 'Wb', px: 191, usd: 600_000 }),
    ]);
    expect(g.map((x) => [x.id, x.side, x.kind, x.n])).toEqual([
      ['Wb', 'ask', 'limit', 1],
      ['Wa', 'ask', 'limit', 3],
      ['Wa', 'bid', 'limit', 1],
      ['Wa', 'bid', 'stop', 1],
    ]);
    expect(g[1]).toMatchObject({ lo: 189.9, hi: 190.4, usd: 570_000 });
  });
});
