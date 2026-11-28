import { describe, expect, it } from 'vitest';
import { L4Book, parseRawBookDiff } from '../l4book.ts';
import { eventsOfLine, parseFill, parseLiquidation, positionAfter } from '../records.ts';

const A = (k: number) => `0x${String(k).padStart(40, '0')}`;

describe('rekordy plików noda (schematy z dokumentacji, parsowanie obronne)', () => {
  it('linia: pojedyncze zdarzenie albo blok z listą zdarzeń; zła linia — nic', () => {
    expect(eventsOfLine('{"a":1}')).toEqual([{ a: 1 }]);
    expect(eventsOfLine('{"local_time":"t","block_time":"t","block_number":7,"events":[{"a":1},{"a":2}]}')).toEqual([{ a: 1 }, { a: 2 }]);
    expect(eventsOfLine('nie json')).toEqual([]);
    expect(eventsOfLine('null')).toEqual([]);
  });

  it('wypełnienie: para [adres, obiekt]; pozycja po wypełnieniu ze znakiem', () => {
    const raw = [A(1), { coin: 'BTC', px: '60000.0', sz: '0.5', side: 'A', time: 1795813179479, startPosition: '0.2', dir: 'Close Long', closedPnl: '12.5', hash: '0xab', oid: 123, crossed: true, fee: '1', tid: 99, twapId: null }];
    const f = parseFill(raw)!;
    expect(f).toMatchObject({ user: A(1), coin: 'BTC', px: 60_000, sz: 0.5, side: 'A', crossed: true, oid: 123, tid: 99, twapId: null, dir: 'Close Long' });
    expect(positionAfter(f)).toBeCloseTo(-0.3, 10);
    expect(parseFill([A(1), { ...raw[1] as object, side: 'X' }])).toBeNull();
    expect(parseFill({ coin: 'BTC' })).toBeNull();
  });

  it('likwidacja z misc_events (także kont spoza skanera); inne zdarzenia — null', () => {
    const ev = {
      time: '2026-11-27T21:00:00.000',
      hash: '0xcd',
      inner: { Liquidation: { liquidatedUser: A(2), liquidatedNtlPos: '1250000.5', accountValue: '40000', leverageType: 'Cross', liquidatedPositions: [{ coin: 'BTC', szi: '-20.5' }] } },
    };
    expect(parseLiquidation(ev)).toEqual({ time: Date.parse(ev.time), hash: '0xcd', user: A(2), ntl: 1_250_000.5, accountValue: 40_000, leverageType: 'Cross', positions: [{ coin: 'BTC', szi: -20.5 }] });
    expect(parseLiquidation({ time: ev.time, hash: '0x', inner: { Funding: { coin: 'BTC' } } })).toBeNull();
    expect(parseLiquidation({ ...ev, inner: { Liquidation: { ...ev.inner.Liquidation, liquidatedPositions: [] } } })).toBeNull();
  });
});

describe('arkusz L4 z różnic noda', () => {
  const diff = (oid: number, user: number, side: 'Bid' | 'Ask', px: string, d: unknown) => parseRawBookDiff({ user: A(user), oid, coin: 'BTC', side, px, raw_book_diff: d })!;

  it('nowe, zmiana i zdjęcie: poziomy z sumą wielkości i liczbą zleceń, od najlepszej ceny', () => {
    const b = new L4Book();
    b.apply(diff(1, 1, 'Bid', '59990', { new: { sz: '2' } }));
    b.apply(diff(2, 2, 'Bid', '59990', { new: { sz: '3' } }));
    b.apply(diff(3, 3, 'Bid', '60000', { new: { sz: '1' } }));
    b.apply(diff(4, 4, 'Ask', '60010', { new: { sz: '5' } }));
    expect(b.levels('BTC', 'Bid')).toEqual([
      { px: 60_000, sz: 1, n: 1 },
      { px: 59_990, sz: 5, n: 2 },
    ]);
    const before = b.apply(diff(2, 2, 'Bid', '59990', { update: { origSz: '3', newSz: '1' } }));
    expect(before?.sz).toBe(3);
    expect(b.levels('BTC', 'Bid', 2)[1]).toEqual({ px: 59_990, sz: 3, n: 2 });
    expect(b.apply(diff(1, 1, 'Bid', '59990', 'remove'))?.user).toBe(A(1));
    expect(b.levels('BTC', 'Bid')[1]).toEqual({ px: 59_990, sz: 1, n: 1 });
    expect(b.apply(diff(77, 1, 'Bid', '59990', 'remove'))).toBeNull();
    expect(b.levels('BTC', 'Ask')).toEqual([{ px: 60_010, sz: 5, n: 1 }]);
  });

  it('ściany z właścicielem i miejsce w kolejce (zlecenia o niższym numerze na tej samej cenie są przed)', () => {
    const b = new L4Book();
    b.apply(diff(10, 1, 'Ask', '60010', { new: { sz: '4' } }));
    b.apply(diff(11, 2, 'Ask', '60010', { new: { sz: '9' } }));
    b.apply(diff(12, 3, 'Ask', '60010', { new: { sz: '1' } }));
    b.apply(diff(13, 4, 'Ask', '60020', { new: { sz: '20' } }));
    expect(b.largest('BTC', 'Ask', 2).map((o) => [o.oid, o.user])).toEqual([
      [13, A(4)],
      [11, A(2)],
    ]);
    expect(b.queueAhead('BTC', 12)).toEqual({ sz: 13, n: 2 });
    expect(b.queueAhead('BTC', 10)).toEqual({ sz: 0, n: 0 });
    expect(b.queueAhead('BTC', 999)).toBeNull();
  });

  it('zmiana nieznanego zlecenia (sprzed migawki) dopisuje je; wielkość 0 zdejmuje; zły rekord — null', () => {
    const b = new L4Book();
    b.apply(diff(5, 1, 'Bid', '100', { update: { origSz: '2', newSz: '1.5' } }));
    expect(b.levels('BTC', 'Bid')).toEqual([{ px: 100, sz: 1.5, n: 1 }]);
    b.apply(diff(5, 1, 'Bid', '100', { update: { origSz: '1.5', newSz: '0' } }));
    expect(b.size('BTC')).toBe(0);
    expect(parseRawBookDiff({ user: A(1), oid: 1, coin: 'BTC', side: 'Buy', px: '1', raw_book_diff: 'remove' })).toBeNull();
    expect(parseRawBookDiff({ user: A(1), oid: 1, coin: 'BTC', side: 'Bid', px: '1', raw_book_diff: { other: {} } })).toBeNull();
  });
});
