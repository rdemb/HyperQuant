import { describe, expect, it } from 'vitest';
import type { Fill } from '../hl/parse';
import type { AggressorOrder } from '../core/orders';
import { OrderAggregator } from '../core/orders';
import { DEFAULT_THRESHOLD_USD, WALL_GAP_MS, WallTracker, autoThreshold, minWallUsd, bursts, classify, niceUp, takerAlias, walletSummary } from '../core/clashes';

const order = (o: Partial<AggressorOrder>): AggressorOrder => ({
  time: 0,
  side: 1,
  sz: 1,
  notional: 100_000,
  vwap: 100_000,
  pxFirst: 100_000,
  pxLast: 100_000,
  fills: 1,
  levels: 1,
  taker: '0x01',
  makers: 1,
  topMakerUsd: 10_000,
  ...o,
});

const fill = (o: Partial<Fill>): Fill => ({ time: 1000, px: 100_000, sz: 1, side: 1, tid: 1, hash: '0xaa', taker: '0x01', maker: '0x99', ...o });

describe('próg dużego zlecenia', () => {
  it('zaokrągla w górę do 1, 2, 5 × 10^k', () => {
    expect(niceUp(130_000)).toBe(200_000);
    expect(niceUp(200_000)).toBe(200_000);
    expect(niceUp(510)).toBe(1000);
  });

  it('kwantyl 98,5% wartości zleceń, z próbką od 200 zleceń', () => {
    expect(autoThreshold([order({})])).toBe(DEFAULT_THRESHOLD_USD);
    const list = Array.from({ length: 1000 }, (_, i) => order({ notional: (i + 1) * 300 }));
    // Kwantyl ≈ 295 500 USD → 500 000
    expect(autoThreshold(list)).toBe(500_000);
    const tiny = Array.from({ length: 300 }, () => order({ notional: 100 }));
    expect(autoThreshold(tiny)).toBe(25_000);
  });

  it('skala rynku (`usdScale`): próg domyślny i granice razy skala; BTC (skala 1) bez zmian', () => {
    const tiny = Array.from({ length: 300 }, () => order({ notional: 100 }));
    expect(autoThreshold([order({})], 1)).toBe(100_000);
    expect(autoThreshold(tiny, 1)).toBe(25_000);
    expect(autoThreshold([order({})], 0.02)).toBe(2_000);
    expect(autoThreshold(tiny, 0.02)).toBe(500);
    const list = Array.from({ length: 1000 }, (_, i) => order({ notional: (i + 1) * 3 }));
    // Kwantyl ≈ 2 955 USD → 5 000 (w granicach 500–100 000 przy skali 0,02)
    expect(autoThreshold(list, 0.02)).toBe(5_000);
  });

  it('ściana zamknięta zostaje od najmniejszego progu rynku (BTC 25 000 USD, skala 0,02: 500 USD)', () => {
    expect(minWallUsd(1)).toBe(25_000);
    expect(minWallUsd(0.02)).toBe(500);
    // Trzy wchłonięcia po 0,003 przy 100 000 = 900 USD, potem przerwa dłuższa niż WALL_GAP_MS
    const fills = [1, 2, 3].map((i) => fill({ tid: i, taker: `0x${i}`, hash: `0xa${i}`, time: i * 1000, sz: 0.003 }));
    const btc = new WallTracker();
    const small = new WallTracker(minWallUsd(0.02));
    for (const w of [btc, small]) {
      w.push(fills);
      w.prune(10_000 + WALL_GAP_MS, 0);
    }
    expect(btc.walls(0, 1e9, 100)).toEqual([]);
    expect(small.walls(0, 1e9, 100)).toHaveLength(1);
  });
});

describe('klasy zleceń', () => {
  it('duże zlecenie z wielu makerów albo bitwa z jednym dużym makerem', () => {
    expect(classify(order({ notional: 50_000 }), 100_000)).toBeNull();
    expect(classify(order({ notional: 300_000, topMakerUsd: 40_000 }), 100_000)).toBe('big');
    expect(classify(order({ notional: 300_000, topMakerUsd: 60_000 }), 100_000)).toBe('clash');
  });

  it('agregator liczy makerów i największego z nich', () => {
    const agg = new OrderAggregator(1000);
    agg.push([fill({ tid: 1, maker: '0xa', sz: 1 }), fill({ tid: 2, maker: '0xb', sz: 2 }), fill({ tid: 3, maker: '0xa', sz: 2 })], 1000);
    const [o] = agg.flush(5000);
    expect(o.makers).toBe(2);
    expect(o.topMakerUsd).toBeCloseTo(300_000);
    expect(o.taker).toBe('0x01');
  });
});

describe('serie małych zleceń', () => {
  it('wiele małych zleceń różnych biorców w oknie 2 s, razem od progu', () => {
    const list = Array.from({ length: 6 }, (_, i) => order({ time: i * 300, notional: 20_000, sz: 0.2, taker: `0x${i}` }));
    const [b] = bursts(list, 100_000);
    expect(b.usd).toBe(120_000);
    expect(b.takers).toBe(6);
    expect(b.from).toBe(0);
    expect(b.to).toBe(1500);
  });

  it('jeden biorca, za mała suma albo duże zlecenie to nie seria', () => {
    const one = Array.from({ length: 6 }, (_, i) => order({ time: i * 300, notional: 20_000 }));
    expect(bursts(one, 100_000)).toEqual([]);
    const few = Array.from({ length: 4 }, (_, i) => order({ time: i * 300, notional: 20_000, taker: `0x${i}` }));
    expect(bursts(few, 100_000)).toEqual([]);
    const big = Array.from({ length: 6 }, (_, i) => order({ time: i * 300, notional: 30_000, taker: `0x${i}` }));
    expect(bursts(big, 100_000)).toEqual([]);
  });
});

describe('ściany', () => {
  it('jeden maker na jednej cenie wchłania kilka zleceń agresora', () => {
    const w = new WallTracker();
    w.push([
      fill({ tid: 1, taker: '0x1', hash: '0xa1' }),
      fill({ tid: 2, taker: '0x2', hash: '0xa2', time: 2000 }),
      fill({ tid: 3, taker: '0x3', hash: '0xa3', time: 3000 }),
    ]);
    const [x] = w.walls(0, 10_000, 250_000);
    // Agresorzy kupowali, więc maker stał po stronie asków
    expect(x.side).toBe(-1);
    expect(x.usd).toBe(300_000);
    expect(x.hits).toBe(3);
    expect(w.walls(0, 10_000, 400_000)).toEqual([]);
  });

  it('przerwa dłuższa niż WALL_GAP_MS zaczyna liczenie od nowa', () => {
    const w = new WallTracker();
    w.push([
      fill({ tid: 1, taker: '0x1' }),
      fill({ tid: 2, taker: '0x2', time: 1000 + WALL_GAP_MS + 1 }),
      fill({ tid: 3, taker: '0x3', time: 2000 + WALL_GAP_MS }),
    ]);
    expect(w.walls(0, 1e9, 100_000)).toEqual([]);
  });

  it('góra lodowa: maker wchłonął co najmniej 2 × więcej, niż poziom kiedykolwiek pokazywał w arkuszu', () => {
    const book = (ask: number, t: number) => ({ time: t, bids: [{ px: 99_999, sz: 3, n: 1 }], asks: [{ px: 100_000, sz: ask, n: 1 }] });
    const w = new WallTracker();
    w.observeBook(book(0.6, 900));
    w.push([fill({ tid: 1, taker: '0x1', hash: '0xa1' })]);
    // Po wypełnieniu maker odnawia 0,8 na tej samej cenie
    w.observeBook(book(0.8, 1500));
    w.push([fill({ tid: 2, taker: '0x2', hash: '0xa2', time: 2000 }), fill({ tid: 3, taker: '0x3', hash: '0xa3', time: 3000 })]);
    const [x] = w.walls(0, 10_000, 250_000);
    expect(x.shown).toBe(0.8);
    expect(x.sz).toBe(3);
    expect(x.iceberg).toBe(true);
    // Poziom, który pokazywał całą wielkość, to zwykła ściana
    const v = new WallTracker();
    v.observeBook(book(3, 900));
    v.push([fill({ tid: 1, taker: '0x1', hash: '0xa1' }), fill({ tid: 2, taker: '0x2', hash: '0xa2', time: 2000 }), fill({ tid: 3, taker: '0x3', hash: '0xa3', time: 3000 })]);
    expect(v.walls(0, 10_000, 250_000)[0].iceberg).toBe(false);
  });

  it('przemiecenie przed następną migawką to nie góra lodowa, nawet gdy wzięło kilka razy więcej niż stara migawka', () => {
    const book = (ask: number, t: number) => ({ time: t, bids: [{ px: 99_999, sz: 3, n: 1 }], asks: [{ px: 100_000, sz: ask, n: 1 }] });
    const w = new WallTracker();
    w.observeBook(book(0.5, 900));
    // Trzech biorców w jednym bloku i jeden blok później: zlecenie mogło stanąć po migawce z 0,5
    w.push([fill({ tid: 1, taker: '0x1', hash: '0xa1' }), fill({ tid: 2, taker: '0x2', hash: '0xa2' }), fill({ tid: 3, taker: '0x3', hash: '0xa3', time: 1100 })]);
    expect(w.walls(0, 10_000, 250_000)[0].iceberg).toBe(false);
    // Migawka po wypełnieniach znów pokazuje poziom, a maker wchłania dalej — odnawianie
    w.observeBook(book(0.6, 1500));
    expect(w.walls(0, 10_000, 250_000)[0].iceberg).toBe(false);
    w.push([fill({ tid: 4, taker: '0x4', hash: '0xa4', time: 2000 })]);
    expect(w.walls(0, 10_000, 250_000)[0].iceberg).toBe(true);
  });
});

describe('portfel', () => {
  it('podsumowanie zleceń jednego adresu pod pseudonimem konta, bez adresu', () => {
    const addr = '0x1234567890abcdef1234567890abcdef12345678';
    const s = walletSummary(
      [order({ taker: addr, sz: 2, notional: 200_000, time: 5 }), order({ taker: addr, side: -1, sz: 0.5, notional: 50_000, time: 9 }), order({})],
      addr
    )!;
    expect(s.label).toMatch(/^Konto \d+$/);
    expect(s.label).not.toContain('0x');
    expect(s.orders).toBe(2);
    expect(s.buySz).toBe(2);
    expect(s.sellSz).toBe(0.5);
    expect(s.largestUsd).toBe(200_000);
    expect([s.first, s.last]).toEqual([5, 9]);
    expect(walletSummary([order({})], '')).toBeNull();
    // Ten sam adres ma ten sam numer, inny adres — kolejny
    expect(takerAlias(addr)).toBe(s.label);
    expect(takerAlias('0xother')).not.toBe(s.label);
  });
});
