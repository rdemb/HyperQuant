import { describe, expect, it, vi } from 'vitest';
import { type Burst, type Wall, DEFAULT_THRESHOLD_USD, bursts } from '../core/clashes';
import type { AggressorOrder } from '../core/orders';
import { BURSTS_K, BURSTS_MAX, CLASHES_EVIDENCE, RANK_WINDOW_MS, WALLS_DONE_MAX, WALLS_K, WALLS_LIVE_MAX, WALL_MIN_MS, selectClashes, thresholdAt, wallShown } from '../chart/clashSelect';

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

  it('progi zamkniętych godzin z pamięci wspólnej dla kolejnych scen: godzina liczona raz', () => {
    const src = vi.fn(range);
    const memo = new Map<number, number>();
    thresholdAt(src, 0, memo)(T0 + H + 5);
    expect(thresholdAt(src, 0, memo)(T0 + H + 50_000)).toBe(500_000);
    expect(src).toHaveBeenCalledTimes(1);
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
    // Każda kolejna ściana i seria większa od poprzednich — reguła przyczynowa przepuszcza wszystkie, decyduje limit
    const done = Array.from({ length: 15 }, (_, i) => wall({ from: T0 + i * 60_000, to: T0 + i * 60_000 + 20_000, usd: 200_000 + i * 1000 }));
    const live = Array.from({ length: 5 }, (_, i) => wall({ from: now - 40_000, to: now - 5_000 + i, usd: 400_000 + i, px: 100_000 + i }));
    const bs = Array.from({ length: 12 }, (_, i) => burst({ from: T0 + i * 1000, to: T0 + i * 1000 + 500, usd: 150_000 + i }));
    const s = selectClashes(done.concat(live), bs, now, thr);
    expect(s.walls.filter((w) => now - w.to >= 30_000).map((w) => w.usd)).toEqual(Array.from({ length: WALLS_DONE_MAX }, (_, i) => 214_000 - i * 1000));
    expect(s.walls.filter((w) => now - w.to < 30_000)).toHaveLength(3);
    expect(s.bursts.map((b) => b.usd)).toEqual(Array.from({ length: BURSTS_MAX }, (_, i) => 150_011 - i));
    expect(s.walls.length + s.bursts.length).toBeLessThanOrEqual(25);
  });

  it('limit bezpieczeństwa nie przycina zmierzonego maksimum: 11 ścian zakończonych i 9 serii zostaje w całości', () => {
    expect([WALLS_DONE_MAX, WALLS_LIVE_MAX, BURSTS_MAX]).toEqual([12, 3, 10]);
    const done = Array.from({ length: 11 }, (_, i) => wall({ from: T0 + i * 60_000, to: T0 + i * 60_000 + 20_000, usd: 200_000 + i * 1000, px: 100_000 + i }));
    const bs = Array.from({ length: 9 }, (_, i) => burst({ from: T0 + i * 1000, to: T0 + i * 1000 + 500, usd: 150_000 + i }));
    const s = selectClashes(done, bs, now, thr);
    expect(s.walls).toHaveLength(11);
    expect(s.bursts).toHaveLength(9);
  });

  it('ściana oceniana progiem z chwili powstania: bez zmiany progu bieżącego nie znika ani nie wraca', () => {
    const w = wall({ from: T0 + 10, usd: 250_000 });
    const byHour = (t: number) => (t < T0 + H ? 200_000 : 1_000_000);
    expect(selectClashes([w], [], now + 5 * H, byHour).walls).toHaveLength(1);
  });

  it(`ściana rysowana, gdy w chwili zakończenia była wśród ${WALLS_K} największych zakończonych w poprzednich ${RANK_WINDOW_MS / 60_000} min`, () => {
    const a = wall({ from: T0, to: T0 + 60_000, usd: 900_000, px: 1 });
    const b = wall({ from: T0 + 2 * 60_000, to: T0 + 3 * 60_000, usd: 800_000, px: 2 });
    const c = wall({ from: T0 + 4 * 60_000, to: T0 + 5 * 60_000, usd: 500_000, px: 3 });
    // d: większa niż c, ale mniejsza od a i b — trzecia; e: po godzinie od a i b — pierwsza
    const d = wall({ from: T0 + 6 * 60_000, to: T0 + 7 * 60_000, usd: 600_000, px: 4 });
    const e = wall({ from: T0 + 64 * 60_000, to: T0 + 65 * 60_000, usd: 300_000, px: 5 });
    const s = selectClashes([a, b, c, d, e], [], now + H, thr);
    expect(s.walls.map((w) => w.px).sort()).toEqual([1, 2, 5]);
  });

  it('raz narysowana ściana zostaje: późniejsze większe ściany i przewinięcie nie zmieniają wyboru z przeszłości', () => {
    const early = wall({ from: T0, to: T0 + 60_000, usd: 300_000, px: 1 });
    const later = Array.from({ length: 4 }, (_, i) => wall({ from: T0 + (10 + i) * 60_000, to: T0 + (11 + i) * 60_000, usd: 1_000_000 + i, px: 10 + i }));
    const at = (list: Wall[], when: number, from: number) => selectClashes(list, [], when, thr, from).walls.map((w) => w.px);
    expect(at([early], T0 + 5 * 60_000, T0)).toEqual([1]);
    // Kolejne większe ściany kończą się później; okno od początku albo przewinięte — `early` nadal narysowana
    expect(at([early, ...later.slice(0, 2)], T0 + 20 * 60_000, T0)).toContain(1);
    expect(at([early, ...later.slice(0, 2)], T0 + 20 * 60_000, T0 - 30 * 60_000)).toContain(1);
    // Ściany zakończone w godzinie przed widokiem liczą się do porównania, choć same nie są na ekranie
    expect(at([...later.slice(0, 2), wall({ from: T0 + 16 * 60_000, to: T0 + 17 * 60_000, usd: 500_000, px: 3 })], T0 + 30 * 60_000, T0 + 16 * 60_000)).toEqual([]);
  });

  it(`serie: ta sama reguła z K = ${BURSTS_K} (największa zakończona w poprzednich ${RANK_WINDOW_MS / 60_000} min)`, () => {
    const big = burst({ from: T0, to: T0 + 1000, usd: 900_000 });
    const small = burst({ from: T0 + 10 * 60_000, to: T0 + 10 * 60_000 + 1000, usd: 200_000 });
    const after = burst({ from: T0 + 70 * 60_000, to: T0 + 70 * 60_000 + 1000, usd: 150_000 });
    expect(selectClashes([], [big, small, after], now + H, thr).bursts.map((b) => b.usd)).toEqual([900_000, 150_000]);
    // Okno od chwili po pierwszej serii: ona zostaje w porównaniu (pobrana z godziny przed widokiem), ale nie na ekranie
    expect(selectClashes([], [big, small, after], now + H, thr, T0 + 5 * 60_000).bursts.map((b) => b.usd)).toEqual([150_000]);
  });

  it(`pokrycie taśmy: ściana i seria tylko, gdy taśma obejmuje całe ${RANK_WINDOW_MS / 60_000} min przed ich końcem (początek i luka)`, () => {
    const S = T0 + 2 * H;
    const M = 60_000;
    const w1 = wall({ from: S + 29 * M, to: S + 30 * M, usd: 900_000, px: 1 });
    const w2 = wall({ from: S + 60 * M, to: S + 61 * M, usd: 500_000, px: 2 });
    const b1 = burst({ from: S + 10 * M - 500, to: S + 10 * M, usd: 900_000 });
    const b2 = burst({ from: S + 75 * M - 500, to: S + 75 * M, usd: 200_000 });
    const pick = (covers: (a: number, b: number) => boolean) => {
      const s = selectClashes([w1, w2], [b1, b2], S + 5 * H, thr, Number.NEGATIVE_INFINITY, covers);
      return { walls: s.walls.map((w) => w.px), bursts: s.bursts.map((b) => b.usd) };
    };
    // Taśma od S: w pierwszej godzinie nic; ściana i seria po godzinie jak zwykle (wcześniejsze liczą się do porównania)
    expect(pick((a) => a >= S)).toEqual({ walls: [2], bursts: [200_000] });
    // Wcześniejsza taśma: dochodzą obiekty z pierwszej godziny, zestaw od S + 60 min bez zmian
    expect(pick((a) => a >= S - 2 * H)).toEqual({ walls: [1, 2], bursts: [900_000, 200_000] });
    // Luka w pokryciu [S − 30 min, S − 25 min) przy wcześniejszej taśmie działa jak początek
    expect(pick((a, b) => a >= S - 2 * H && !(a < S - 25 * M && b > S - 30 * M))).toEqual({ walls: [2], bursts: [200_000] });
  });

  it('opis: wynik sprawdzianu, PL i EN', () => {
    expect(CLASHES_EVIDENCE.pl).toContain('Po ścianie cena nie rusza się w stronę obrony: +0,02 pb po 5 min (n 9 834).');
    expect(CLASHES_EVIDENCE.en).toContain('+0.02 bp after 5 min (n 9,834)');
  });
});
