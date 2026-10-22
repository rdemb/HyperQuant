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
    // 0xa jest w rankingu — liczy się jako konto z rankingu, choć nie został ponownie oznaczony do odczytu
    expect(b.seededCount).toBe(3);
  });

  it('liczba kont z rankingu przetrwa zapis i odczyt stanu (restart usługi)', () => {
    const b = new AddressBook();
    b.seed('0xbig', 5e6, 0);
    b.seed('0xmid', 5e5, 0);
    const back = AddressBook.fromJSON(JSON.parse(JSON.stringify(b.toJSON())));
    expect(back.seededCount).toBe(2);
  });

  it('konto wciąż obecne w rankingu nie wypada przy czyszczeniu; konto spoza rankingu bez pozycji — tak', () => {
    const DAY = 24 * 60 * 60_000;
    const b = new AddressBook();
    b.seed('0xstays', 5e6, 0);
    b.seed('0xgone', 5e6, 0);
    b.updatePosition('0xstays', null, 0);
    b.updatePosition('0xgone', null, 0);
    b.seed('0xstays', 5e6, 2.5 * DAY); // ponowny zasiew co 6 h odświeża obecność w rankingu
    b.prune(3 * DAY + 1);
    expect(b.has('0xstays')).toBe(true);
    expect(b.has('0xgone')).toBe(false);
    expect(b.seededCount).toBe(1);
  });

  it('ponowny zasiew znanego konta nie oznacza go do ponownego odczytu', () => {
    const b = new AddressBook();
    b.seed('0xbig', 5e6, 0);
    b.updatePosition('0xbig', null, 0);
    b.seed('0xbig', 5e6, 60_000);
    expect(b.due(120_000, 10)).toEqual([]);
  });

  it('wartość konta z rankingu: zapamiętana (także dla znanego adresu), przetrwa zapis stanu; wieloryb wg pozycji lub konta', () => {
    const b = new AddressBook();
    b.recordTrade(['0xknown', '0xz'], 1, 0);
    b.seed('0xrich', 12e6, 0);
    b.seed('0xknown', 3e6, 0);
    b.updatePosition('0xpos', { szi: 15, entryPx: 80_000, liqPx: 70_000, scannedAt: 0 }, 0);
    expect(b.accountValue('0xrich')).toBe(12e6);
    expect(b.accountValue('0xknown')).toBe(3e6);
    expect(b.accountValue('0xz')).toBeNull();
    const back = AddressBook.fromJSON(JSON.parse(JSON.stringify(b.toJSON())));
    expect(back.accountValue('0xrich')).toBe(12e6);
    expect(back.isWhale('0xrich')).toBe(true); // konto ≥ 10 mln
    expect(back.isWhale('0xpos')).toBe(true); // pozycja 1.2 mln USD
    expect(back.isWhale('0xknown')).toBe(false);
  });
});
