import { describe, expect, it } from 'vitest';
import { extractLeaderboardAccounts } from '../seed.ts';
import { AddressBook } from '../addressBook.ts';

const A = (n: number) => `0x${String(n).padStart(40, '0')}`;
const sample = `{
  "leaderboardRows": [
    { "ethAddress": "${A(1)}", "accountValue": "60780022.18", "windowPerformances": [] },
    { "ethAddress": "${A(2)}",
      "accountValue": "250000.5", "windowPerformances": [] },
    { "ethAddress": "${A(3)}", "accountValue": "900", "windowPerformances": [] },
    { "ethAddress": "${A(4)}", "accountValue": "3500000", "windowPerformances": [] }
  ]
}`;

describe('extractLeaderboardAccounts — konta z publicznego rankingu Hyperliquid', () => {
  it('wyciąga adres i wartość konta (także przy wcięciach), filtruje progiem, sortuje malejąco, limituje', () => {
    expect(extractLeaderboardAccounts(sample, 100_000, 10)).toEqual([
      { address: A(1), accountValue: 60780022.18 },
      { address: A(4), accountValue: 3500000 },
      { address: A(2), accountValue: 250000.5 },
    ]);
    expect(extractLeaderboardAccounts(sample, 100_000, 2).map((x) => x.address)).toEqual([A(1), A(4)]);
  });
  it('zły kształt → pusta lista', () => {
    expect(extractLeaderboardAccounts('nie json', 0, 10)).toEqual([]);
  });
});

describe('AddressBook.seed — zasiew dużych kont', () => {
  it('nowe konto trafia do kolejki z priorytetem wg wartości; istniejące nie jest ponownie oznaczane', () => {
    const b = new AddressBook();
    b.recordTrade(['0xa', '0xb'], 1000, 0);
    b.updatePosition('0xa', null, 0);
    b.updatePosition('0xb', null, 0);
    b.seed('0xbig', 5e6, 0);
    b.seed('0xmid', 5e5, 0);
    b.seed('0xa', 9e9, 0);
    expect(b.due(0, 10)).toEqual(['0xbig', '0xmid']);
    expect(b.seededCount).toBe(2);
  });
});
