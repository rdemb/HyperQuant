import { describe, expect, it } from 'vitest';
import { Coverage } from '../core/coverage';
import { AggressorOrder, OrderLog } from '../core/orders';
import { PlayerFlow, bigPlayerUsd } from '../core/players';

const M1 = 60_000;
const H = 60 * M1;
// Godzina UTC z dala od zera (czas serwera w ms)
const H0 = 1000 * H;

const order = (time: number, taker: string, side: 1 | -1, notional: number, px = 100): AggressorOrder => ({
  time,
  side,
  sz: notional / px,
  notional,
  vwap: px,
  pxFirst: px,
  pxLast: px,
  fills: 1,
  levels: 1,
  taker,
  makers: 1,
  topMakerUsd: notional,
});

const flow = (orders: AggressorOrder[], spans: [number, number][] = [[H0, H0 + 3 * H]], threshold = 1000) => {
  const log = new OrderLog();
  log.add(orders);
  return { log, players: new PlayerFlow(log, new Coverage(spans), threshold) };
};

describe('Kto handluje', () => {
  it('konto z sumą wejść w godzinie UTC od progu jest dużym graczem także przy zleceniach pociętych na małe', () => {
    // a: 4 × 300 = 1200 (≥ 1000, duży), b: 900 (reszta), c: sprzedaż 500 (reszta)
    const { players } = flow([
      order(H0 + 1000, 'a', 1, 300),
      order(H0 + 5 * M1, 'a', 1, 300),
      order(H0 + 20 * M1, 'b', 1, 900),
      order(H0 + 30 * M1, 'a', 1, 300),
      order(H0 + 40 * M1, 'c', -1, 500),
      order(H0 + 50 * M1, 'a', 1, 300),
    ]);
    const s = players.split(H0, H, H0 + 3 * H)!;
    expect(s.big).toBeCloseTo(12);
    expect(s.rest).toBeCloseTo(9 - 5);
    expect(s.bigShare).toBeCloseTo((1200 / 2600) * 100);
    // Świeca 1m: tylko zlecenia z tej minuty, klasyfikacja z całej godziny
    const m = players.split(H0 + 5 * M1, M1, H0 + 3 * H)!;
    expect([m.big, m.rest, m.bigUsd, m.usd, m.bigShare]).toEqual([3, 0, 300, 300, 100]);
  });

  it('godziny liczone osobno: to samo konto w kolejnej godzinie poniżej progu jest resztą', () => {
    const { players } = flow([order(H0 + M1, 'a', 1, 1200), order(H0 + H + M1, 'a', 1, 400)]);
    const s = players.split(H0, 2 * H, H0 + 3 * H)!;
    expect(s.big).toBeCloseTo(12);
    expect(s.rest).toBeCloseTo(4);
  });

  it('zlecenie bez konta zostaje w reszcie, nawet gdy takich zleceń jest dużo', () => {
    const { players } = flow([order(H0 + M1, '', 1, 800), order(H0 + 2 * M1, '', 1, 800)]);
    const s = players.split(H0, H, H0 + 3 * H)!;
    expect([s.big, s.bigShare]).toEqual([0, 0]);
    expect(s.rest).toBeCloseTo(16);
  });

  it('bez taśmy z kontami brak zamiast zera; świeca bez wejść ma udział nieznany', () => {
    const { players } = flow([order(H0 + M1, 'a', 1, 1200)], [[H0 + H, H0 + 2 * H]]);
    expect(players.split(H0, H, H0 + 3 * H)).toBeNull();
    expect(players.split(H0 + H, H, H0 + 3 * H)).toEqual({ big: 0, rest: 0, bigUsd: 0, usd: 0, bigShare: null });
    // Przyszła świeca
    expect(players.split(H0 + 4 * H, H, H0 + 3 * H)).toBeNull();
  });

  it('bieżąca godzina: nowe zlecenie przelicza godzinę i konto, które przekroczyło próg, przechodzi do dużych w całej godzinie', () => {
    const { log, players } = flow([order(H0 + M1, 'a', 1, 600)]);
    const now = H0 + 10 * M1;
    expect(players.split(H0, H, now)!.big).toBe(0);
    log.add([order(H0 + 9 * M1, 'a', 1, 600)]);
    const s = players.split(H0, H, now)!;
    expect(s.big).toBeCloseTo(12);
    expect(s.rest).toBe(0);
  });

  it('czyszczenie zostawia godziny po granicy; progi rynków', () => {
    const { log, players } = flow([order(H0 + M1, 'a', 1, 1200), order(H0 + H + M1, 'a', 1, 1200)]);
    players.split(H0, 2 * H, H0 + 3 * H);
    players.prune(H0 + H);
    log.prune(H0 + H);
    expect(players.split(H0 + H, H, H0 + 3 * H)!.big).toBeCloseTo(12);
    expect(bigPlayerUsd('BTC')).toBe(1_000_000);
    expect(bigPlayerUsd('XYZ')).toBe(250_000);
  });
});
