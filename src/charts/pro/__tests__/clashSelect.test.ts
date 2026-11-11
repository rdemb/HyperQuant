import { describe, expect, it } from 'vitest';
import { type Burst, type Wall, DEFAULT_THRESHOLD_USD, bursts } from '../core/clashes';
import type { AggressorOrder } from '../core/orders';
import { BURSTS_MAX, CLASHES_EVIDENCE, WALLS_DONE_MAX, WALLS_LIVE_MAX, WALL_MIN_MS, selectClashes, thresholdAt, wallShown } from '../chart/clashSelect';

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 24, 16, 0);

const order = (o: Partial<AggressorOrder>): AggressorOrder => ({
  time: 0,
  side: 1,
  sz: 1,
  notional: 10_000,
  vwap: 100_000,
  pxFirst: 100_000,
  pxLast: 100_000,
  fills: 1,
  levels: 1,
  taker: '0x1',
  makers: 1,
  topMakerUsd: 5_000,
  ...o,
});

/** Godzina z 300 zleceniami: 98,5. percentyl około `top`. */
function hour(start: number, top: number): AggressorOrder[] {
  return Array.from({ length: 300 }, (_, i) => order({ time: start + i * 10_000, notional: i >= 290 ? top : 5_000 + i * 10 }));
}

const wall = (o: Partial<Wall>): Wall => ({ from: T0, to: T0 + 20_000, px: 100_000, side: 1, usd: 200_000, sz: 2, hits: 3, shown: 0, iceberg: false, ...o });
const burst = (o: Partial<Burst>): Burst => ({ from: T0, to: T0 + 1000, side: 1, usd: 150_000, sz: 1.5, vwap: 100_000, orders: 8, takers: 6, ...o });

describe('próg z chwili zdarzenia (szereg godzinowy z taśmy)', () => {
  const all = [...hour(T0, 300_000), ...hour(T0 + H, 1_200_000)];
  const range = (from: number, to: number) => all.filter((o) => o.time >= from && o.time < to);

  it('zdarzenie w godzinie H ocenia próg z zamkniętej godziny przed nią; bez próbki — próg domyślny', () => {
    const at = thresholdAt(range, 0);
    expect(at(T0 + H + 5)).toBe(500_000);
    expect(at(T0 + 2 * H + 5)).toBe(2_000_000);
    expect(at(T0 + 5)).toBe(DEFAULT_THRESHOLD_USD);
  });

  it('próg godziny z przeszłości nie zmienia się po dojściu kolejnych godzin taśmy', () => {
    const later = [...all, ...hour(T0 + 2 * H, 50_000)];
    const at = thresholdAt((f, t) => later.filter((o) => o.time >= f && o.time < t), 0);
    expect(at(T0 + H + 5)).toBe(thresholdAt(range, 0)(T0 + H + 5));
  });

  it('próg ręczny z ustawień — ten sam dla każdej chwili', () => {
    const at = thresholdAt(range, 250_000);
    expect([at(T0), at(T0 + 5 * H)]).toEqual([250_000, 250_000]);
  });

  it('serie: zlecenia oceniane progiem z chwili serii (funkcja progu)', () => {
    const list = Array.from({ length: 6 }, (_, i) => order({ time: T0 + i * 300, notional: 20_000, taker: `0x${i}` }));
    expect(bursts(list, () => 100_000)).toHaveLength(1);
    expect(bursts(list, () => 500_000)).toEqual([]);
  });
});

describe('ściana na wykresie', () => {
  it(`trwała co najmniej ${WALL_MIN_MS / 1000} s albo wchłonęła co najmniej 3 × próg; 2-sekundowa poniżej 3 × progu nie`, () => {
    expect(wallShown(wall({ to: T0 + 2_000, usd: 250_000 }), 100_000)).toBe(false);
    expect(wallShown(wall({ to: T0 + 2_000, usd: 300_000 }), 100_000)).toBe(true);
    expect(wallShown(wall({ to: T0 + WALL_MIN_MS, usd: 120_000 }), 100_000)).toBe(true);
    expect(wallShown(wall({ to: T0 + 60_000, usd: 90_000 }), 100_000)).toBe(false);
  });
});

describe('wybór ścian i serii (selectClashes)', () => {
  const now = T0 + H;
  const thr = () => 100_000;

  it(`najwyżej ${WALLS_DONE_MAX} największych ścian zakończonych, ${WALLS_LIVE_MAX} trwających i ${BURSTS_MAX} największych serii`, () => {
    const done = Array.from({ length: 9 }, (_, i) => wall({ from: T0 + i * 60_000, to: T0 + i * 60_000 + 20_000, usd: 200_000 + i * 1000 }));
    const live = Array.from({ length: 5 }, (_, i) => wall({ from: now - 40_000, to: now - 1_000 - i, usd: 400_000 + i, px: 100_000 + i }));
    const bs = Array.from({ length: 8 }, (_, i) => burst({ from: T0 + i * 1000, usd: 150_000 + i }));
    const s = selectClashes(done.concat(live), bs, now, thr);
    expect(s.walls.filter((w) => now - w.to >= 30_000).map((w) => w.usd)).toEqual([208_000, 207_000, 206_000, 205_000, 204_000]);
    expect(s.walls.filter((w) => now - w.to < 30_000)).toHaveLength(3);
    expect(s.bursts.map((b) => b.usd)).toEqual([150_007, 150_006, 150_005, 150_004, 150_003]);
    expect(s.walls.length + s.bursts.length).toBeLessThanOrEqual(13);
  });

  it('ściana oceniana progiem z chwili powstania: bez zmiany progu bieżącego nie znika ani nie wraca', () => {
    const w = wall({ from: T0 + 10, usd: 250_000 });
    const byHour = (t: number) => (t < T0 + H ? 200_000 : 1_000_000);
    expect(selectClashes([w], [], now + 5 * H, byHour).walls).toHaveLength(1);
  });

  it('opis: wynik sprawdzianu, PL i EN', () => {
    expect(CLASHES_EVIDENCE.pl).toContain('Po ścianie cena nie rusza się w stronę obrony: +0,02 pb po 5 min (n 9 834).');
    expect(CLASHES_EVIDENCE.en).toContain('+0.02 bp after 5 min (n 9,834)');
  });
});
