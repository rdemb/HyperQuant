import { describe, expect, it } from 'vitest';
import { isWhaleLayer } from '../../../src/utils/whaleLayer.ts';
import { AddressBook } from '../addressBook.ts';
import { ORD_EVERY_MS, POS_EVERY_MS, WhaleWatcher, gridPx, parseOrders, parsePositions } from '../whales.ts';

const T0 = Date.UTC(2026, 9, 24, 14, 0, 0);
const A = (k: number) => `0x${String(k).padStart(40, '0')}`;
const COINS = ['BTC', 'ETH', 'SOL', 'HYPE'];

const pos = (coin: string, szi: number, entryPx: number, positionValue: number, liquidationPx: number | null, lev = 10) => ({
  type: 'oneWay',
  position: { coin, szi: String(szi), entryPx: String(entryPx), positionValue: String(positionValue), unrealizedPnl: '1000.5', liquidationPx: liquidationPx === null ? null : String(liquidationPx), leverage: { type: 'cross', value: lev } },
});

describe('parsePositions / parseOrders — odczyt publicznego stanu konta', () => {
  it('pozycje tylko z wybranych rynków, strona ze znaku, likwidacja null bez ceny', () => {
    const st = { assetPositions: [pos('BTC', -12.5, 80_000, 1_000_000, 95_000), pos('DOGE', 1000, 0.1, 100, null), pos('ETH', 400, 2800, 1_120_000, null, 5)] };
    expect(parsePositions(st, COINS, T0)).toEqual([
      { coin: 'BTC', side: 'short', usd: 1_000_000, sz: 12.5, entry: 80_000, liq: 95_000, lev: 10, at: T0 },
      { coin: 'ETH', side: 'long', usd: 1_120_000, sz: 400, entry: 2800, liq: null, lev: 5, at: T0 },
    ]);
    expect(parsePositions({}, COINS, T0)).toBeNull();
  });

  it('zlecenia: limit po cenie limitu, stop i TP po cenie wyzwolenia, TP/SL całej pozycji z wielkością pozycji', () => {
    const positions = parsePositions({ assetPositions: [pos('BTC', 10, 80_000, 800_000, 70_000)] }, COINS, T0)!;
    const raw = [
      { coin: 'BTC', side: 'B', limitPx: '78000', sz: '5', isTrigger: false, orderType: 'Limit', reduceOnly: false },
      { coin: 'BTC', side: 'A', limitPx: '74000', sz: '0', isTrigger: true, triggerPx: '75000', orderType: 'Stop Market', isPositionTpsl: true, reduceOnly: true },
      { coin: 'BTC', side: 'A', limitPx: '90000', sz: '2', isTrigger: true, triggerPx: '90000', orderType: 'Take Profit Limit', reduceOnly: true },
      { coin: 'XRP', side: 'B', limitPx: '1', sz: '10', isTrigger: false, orderType: 'Limit' },
    ];
    expect(parseOrders(raw, COINS, positions, T0)).toEqual([
      { coin: 'BTC', side: 'bid', px: 78_000, usd: 390_000, kind: 'limit', reduce: false, at: T0 },
      { coin: 'BTC', side: 'ask', px: 75_000, usd: 750_000, kind: 'stop', reduce: true, at: T0 },
      { coin: 'BTC', side: 'ask', px: 90_000, usd: 180_000, kind: 'tp', reduce: true, at: T0 },
    ]);
  });
});

describe('WhaleWatcher', () => {
  const fakeRest = (states: Record<string, unknown>, orders: Record<string, unknown>) => {
    const calls: string[] = [];
    return {
      calls,
      rest: {
        async info(body: unknown) {
          const b = body as { type: string; user: string };
          calls.push(`${b.type}:${b.user}`);
          return b.type === 'clearinghouseState' ? (states[b.user] ?? null) : (orders[b.user] ?? null);
        },
      },
    };
  };

  it('pozycje kandydatów co 5 min, zlecenia tylko kont z dużą pozycją; plik bez adresów, z pseudonimem doby', async () => {
    const states = {
      [A(1)]: { assetPositions: [pos('BTC', 50, 80_087, 4_123_456, 60_123)] },
      [A(2)]: { assetPositions: [pos('SOL', 100, 190, 19_000, null)] }, // poniżej progu SOL
    };
    const orders = { [A(1)]: [{ coin: 'BTC', side: 'A', limitPx: '0', sz: '0', isTrigger: true, triggerPx: '76037', orderType: 'Stop Market', isPositionTpsl: true, reduceOnly: true }] };
    const f = fakeRest(states, orders);
    let now = T0;
    const w = new WhaleWatcher({ rest: f.rest, candidates: () => [A(1), A(2)], coins: COINS });
    expect(await w.tick(() => now)).toBe(3);
    expect(f.calls).toEqual([`clearinghouseState:${A(1)}`, `clearinghouseState:${A(2)}`, `frontendOpenOrders:${A(1)}`]);
    now += POS_EVERY_MS - 1;
    expect(await w.tick(() => now)).toBe(0);
    const layer = w.build(now);
    expect(isWhaleLayer(layer)).toBe(true);
    expect(JSON.stringify(layer)).not.toMatch(/0x/);
    const id = layer.markets.BTC.positions[0].id;
    expect(id).toMatch(/^W[0-9a-f]{6}$/);
    // Kwoty do 2 cyfr znaczących, ceny na siatce (wejście i likwidacja 200 USD przy tej cenie, zlecenie 50 USD), bez wielkości i wyniku
    expect(layer.markets.BTC.positions).toEqual([{ id, side: 'long', usd: 4_100_000, entry: 80_000, liq: 60_200, lev: 10, at: T0 }]);
    expect(layer.markets.BTC.orders).toEqual([{ id, side: 'ask', px: 76_050, usd: 3_800_000, kind: 'stop', reduce: true, at: T0 }]);
    expect(layer.markets.SOL.positions).toEqual([]);
    expect(layer.accounts).toBe(2);
    // Pseudonim stały w dobie, inny następnego dnia
    expect(w.alias(A(1), now)).toBe(id);
    expect(w.alias(A(1), now + 86_400_000)).not.toBe(id);
    expect(ORD_EVERY_MS).toBeGreaterThan(0);
  });

  it('konto, które wypadło z kandydatów, znika z pliku; odczyt starszy niż 15 min pominięty', async () => {
    const f = fakeRest({ [A(1)]: { assetPositions: [pos('ETH', 1000, 2800, 2_800_000, 2000)] } }, { [A(1)]: [] });
    let cands = [A(1)];
    const w = new WhaleWatcher({ rest: f.rest, candidates: () => cands, coins: COINS });
    await w.tick(() => T0);
    expect(w.build(T0).markets.ETH.positions).toHaveLength(1);
    expect(w.build(T0 + 16 * 60_000).markets.ETH.positions).toHaveLength(0);
    cands = [];
    await w.tick(() => T0 + 60_000);
    expect(w.build(T0 + 60_000).markets.ETH.positions).toHaveLength(0);
  });
});

describe('gridPx — siatka cen w pliku', () => {
  it('krok 1, 2, 2,5 albo 5 × 10^k najbliższy ułamkowi ceny, bez śmieci zmiennoprzecinkowych', () => {
    expect(gridPx(80_087, 0.0025)).toBe(80_000); // krok 200
    expect(gridPx(80_187, 0.0025)).toBe(80_200);
    expect(gridPx(2834.4, 0.0025)).toBe(2835); // ETH: krok 5
    expect(gridPx(190.37, 0.0025)).toBe(190.5); // SOL: krok 0,5
    expect(gridPx(38.123, 0.0025)).toBe(38.1); // HYPE: krok 0,1
    expect(gridPx(78_137, 0.0005)).toBe(78_150); // zlecenie BTC: krok 50
    expect(gridPx(38.123, 0.0005)).toBe(38.12); // zlecenie HYPE: krok 0,02
  });
});

describe('AddressBook.whaleCandidates', () => {
  it('największe konta z rankingu, potem duże pozycje BTC spoza listy', () => {
    const b = new AddressBook();
    b.seed(A(1), 5e6, T0);
    b.seed(A(2), 50e6, T0);
    b.seed(A(3), 20e6, T0);
    b.updatePosition(A(4), { szi: 30, entryPx: 80_000, liqPx: 60_000, scannedAt: T0 }, T0);
    b.updatePosition(A(5), { szi: 1, entryPx: 80_000, liqPx: 60_000, scannedAt: T0 }, T0);
    expect(b.whaleCandidates(2)).toEqual([A(2), A(3), A(4)]);
  });
});
