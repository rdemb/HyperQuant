import { describe, expect, it } from 'vitest';
import type { AggressorOrder } from '../core/orders';
import { PHASE_TOL_MS, SLICE_MS, matchPlan, planAhead, planDone, planEnd, planPhase, runningPlans, twapStreams, type TwapPlan } from '../core/twapPlans';
import type { Side } from '../hl/parse';

// Wpis dziennika twapHistory w kształcie z pomiaru 1.11 (pola liczbowe jako tekst, czas startu w ms)
const entry = (twapId: number | undefined, status: string, o: { coin?: string; side?: 'B' | 'A'; sz?: string; minutes?: number; timestamp?: number; reduceOnly?: boolean } = {}) => ({
  time: Math.floor((o.timestamp ?? 0) / 1000),
  twapId,
  status: { status },
  state: { coin: o.coin ?? 'BTC', side: o.side ?? 'B', sz: o.sz ?? '1.0', executedSz: '0.0', executedNtl: '0.0', minutes: o.minutes ?? 60, reduceOnly: o.reduceOnly ?? false, randomize: false, timestamp: o.timestamp ?? 0, stopPx: null, user: '0x' + 'a'.repeat(40) },
});

const plan = (start: number, minutes: number, side: Side = 1, sz = 1): TwapPlan => ({ id: start, side, sz, minutes, start, reduceOnly: false });

const slice = (time: number, taker: string, side: Side = 1, notional = 7000): AggressorOrder => ({ time, side, sz: notional / 70_000, notional, vwap: 70_000, pxFirst: 70_000, pxLast: 70_000, fills: 1, levels: 1, taker, makers: 1, topMakerUsd: notional, zero: true });

describe('runningPlans', () => {
  const now = 10 * 3_600_000;
  it('w toku = activated bez wpisu końcowego, tylko ten rynek, od najnowszego', () => {
    const raw = [
      entry(1, 'activated', { timestamp: now - 30 * 60_000, minutes: 60 }),
      entry(2, 'activated', { timestamp: now - 20 * 60_000, minutes: 60, side: 'A', sz: '2.5' }),
      entry(2, 'finished', { timestamp: now - 20 * 60_000, minutes: 60, side: 'A' }),
      entry(3, 'activated', { timestamp: now - 10 * 60_000, minutes: 60, coin: 'ETH' }),
      entry(4, 'activated', { timestamp: now - 5 * 60_000, minutes: 30, side: 'A', sz: '0.4', reduceOnly: true }),
      entry(undefined, 'activated', { timestamp: now - 60_000 }),
      entry(5, 'waitingForTrigger', { timestamp: now - 60_000 }),
    ];
    const plans = runningPlans(raw, 'BTC', now);
    expect(plans?.map((p) => p.id)).toEqual([4, 1]);
    expect(plans?.[0]).toMatchObject({ side: -1, sz: 0.4, minutes: 30, reduceOnly: true });
    expect(plans?.[1]).toMatchObject({ side: 1, sz: 1, reduceOnly: false });
  });

  it('po końcu harmonogramu bez wpisu końcowego plan znika po dogrywce; zły kształt = null', () => {
    const raw = [entry(1, 'activated', { timestamp: now - 64 * 60_000, minutes: 60 }), entry(2, 'activated', { timestamp: now - 66 * 60_000, minutes: 60 })];
    expect(runningPlans(raw, 'BTC', now)?.map((p) => p.id)).toEqual([1]);
    expect(runningPlans({ error: 'x' }, 'BTC', now)).toBeNull();
    expect(runningPlans([], 'BTC', now)).toEqual([]);
  });
});

describe('postęp i faza planu', () => {
  it('postęp liniowy jak w pomiarze (939 z 1470 min ≈ 0,639)', () => {
    const p = plan(0, 1470);
    expect(planDone(p, 939 * 60_000)).toBeCloseTo(0.639, 3);
    expect(planDone(p, -1)).toBe(0);
    expect(planDone(p, planEnd(p) + 1)).toBe(1);
  });

  it('faza = start + 1,5 s w takcie 30 s (przykład z pomiaru)', () => {
    expect(planPhase(plan(1793519541185, 60))).toBe((1793519541185 + 1500) % SLICE_MS);
    expect(planPhase(plan(1793519541185, 60))).toBe(22_685);
  });

  it('wartość w horyzoncie: pełny horyzont albo reszta planu', () => {
    const p = plan(0, 60, 1, 6); // 0,1 BTC na minutę
    expect(planAhead(p, 0, 15 * 60_000, 70_000)).toBeCloseTo(1.5 * 70_000, 6);
    expect(planAhead(p, 50 * 60_000, 15 * 60_000, 70_000)).toBeCloseTo(1 * 70_000, 6);
    expect(planAhead(p, 61 * 60_000, 15 * 60_000, 70_000)).toBe(0);
  });
});

describe('twapStreams i matchPlan', () => {
  it('plasterki grupowane po koncie, stronie i fazie (także przez granicę 30 s)', () => {
    // Rosnąco: konto x w fazie ~0,2 s i ~29,9 s (ta sama faza po okręgu), konto x drugi TWAP w fazie 12 s, konto y
    const orders = [slice(30_200, 'x'), slice(42_000, 'x'), slice(42_000, 'y', -1), slice(59_900, 'x'), slice(72_000, 'x'), slice(90_200, 'x')];
    const streams = twapStreams(orders);
    expect(streams).toHaveLength(3);
    const a = streams.find((s) => s.taker === 'x' && s.phase === 200);
    expect(a).toMatchObject({ slices: 3, first: 30_200, last: 90_200, usd: 21_000 });
    expect(streams.find((s) => s.taker === 'x' && s.phase === 12_000)).toMatchObject({ slices: 2 });
    expect(streams.find((s) => s.taker === 'y')).toMatchObject({ side: -1, slices: 1 });
  });

  it('zwykłe zlecenia i wypełnienia bez biorcy pomijane', () => {
    const o = slice(20_000, 'x');
    delete o.zero;
    expect(twapStreams([slice(15_000, ''), o])).toEqual([]);
  });

  it('dopasowanie planu: ta sama strona i najbliższa faza w tolerancji', () => {
    const near = plan(20_000 - 1500, 60); // faza 20 000
    const nearer = plan(21_000 - 1500, 60); // faza 21 000
    const sell = plan(21_500 - 1500, 60, -1);
    const stream = { taker: 'x', side: 1 as Side, phase: 21_400, first: 0, last: 0, slices: 3, sz: 0.3, usd: 21_000 };
    expect(matchPlan(stream, [near, nearer, sell])?.id).toBe(nearer.id);
    expect(matchPlan({ ...stream, phase: 21_000 + PHASE_TOL_MS + 1 + 1000 }, [near, nearer])).toBeNull();
  });
});
