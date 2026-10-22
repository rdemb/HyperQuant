import { describe, expect, it } from 'vitest';
import {
  bootstrapMeanCi,
  excursions,
  parseJournal,
  rMultiple,
  serializeJournal,
  setupStats,
  type Trade,
} from '../tradeJournal';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 22, 10, 0);

const trade = (over: Partial<Trade> = {}): Trade => ({
  id: 't1',
  setupId: 's1',
  dir: 'LONG',
  entryT: T0,
  entryPx: 100_000,
  stopPx: 99_500,
  exitT: T0 + 30 * MIN,
  exitPx: 101_000,
  sizeBtc: null,
  note: '',
  mae: null,
  mfe: null,
  ctx: null,
  ...over,
});

describe('wynik zagrania w R', () => {
  it('long i short; ryzyko = |wejście − stop|; brak wyjścia albo zerowe ryzyko → null', () => {
    expect(rMultiple(trade())).toBeCloseTo(2, 12);
    expect(rMultiple(trade({ dir: 'SHORT', stopPx: 100_500, exitPx: 99_750 }))).toBeCloseTo(0.5, 12);
    expect(rMultiple(trade({ exitPx: null }))).toBeNull();
    expect(rMultiple(trade({ stopPx: 100_000 }))).toBeNull();
  });
});

describe('MAE / MFE ze świec 1m (w R)', () => {
  const bars = [
    { time: T0 - MIN, open: 100_000, high: 103_000, low: 97_000, close: 100_000 }, // przed wejściem — poza oknem
    { time: T0, open: 100_000, high: 100_200, low: 99_800, close: 100_100 },
    { time: T0 + 10 * MIN, open: 100_100, high: 100_900, low: 99_700, close: 100_800 },
    { time: T0 + 30 * MIN, open: 100_800, high: 102_000, low: 100_700, close: 101_500 }, // od wyjścia — poza oknem
  ];
  it('long: MAE z minimum, MFE z maksimum świec w [wejście, wyjście)', () => {
    expect(excursions(trade(), bars)).toEqual({ mae: -0.6, mfe: 1.8 });
  });
  it('short: odwrotnie; bez świec w oknie → null', () => {
    expect(excursions(trade({ dir: 'SHORT', stopPx: 100_500 }), bars)).toEqual({ mae: -1.8, mfe: 0.6 });
    expect(excursions(trade({ entryT: T0 + 100 * MIN, exitT: T0 + 200 * MIN }), bars)).toBeNull();
  });
});

describe('statystyki setupu', () => {
  it('bootstrap średniej: deterministyczny (stałe ziarno), przedział obejmuje średnią', () => {
    const xs = [1, -1, 2, -1, 0.5, 1.5, -1, 2.5, -1, 1];
    const a = bootstrapMeanCi(xs, 0.9, 2000, 7)!;
    const b = bootstrapMeanCi(xs, 0.9, 2000, 7)!;
    expect(a).toEqual(b);
    expect(a.lo).toBeLessThan(0.45);
    expect(a.hi).toBeGreaterThan(0.45);
    expect(bootstrapMeanCi([], 0.9, 100, 1)).toBeNull();
  });

  it('trafność (Wilson), średnie R, profit factor, mediany MAE zwycięskich i MFE przegranych; tylko zamknięte', () => {
    const ts: Trade[] = [
      trade({ id: 'a', exitPx: 101_000, mae: -0.4, mfe: 2.2 }), // +2R
      trade({ id: 'b', exitPx: 99_500, mae: -1, mfe: 0.8 }), // −1R
      trade({ id: 'c', exitPx: 100_500, mae: -0.2, mfe: 1.1 }), // +1R
      trade({ id: 'd', exitPx: null, exitT: null }), // otwarte — pomijane
      trade({ id: 'e', setupId: 's2', exitPx: 101_000 }),
    ];
    const s = setupStats(ts, 's1');
    expect(s.n).toBe(3);
    expect(s.wins).toBe(2);
    expect(s.winRate!.p).toBeCloseTo(2 / 3, 12);
    expect(s.meanR).toBeCloseTo(2 / 3, 12);
    expect(s.profitFactor).toBeCloseTo(3, 12);
    expect(s.medMaeWinners).toBeCloseTo(-0.3, 12);
    expect(s.medMfeLosers).toBeCloseTo(0.8, 12);
    expect(s.open).toBe(1);
  });
});

describe('eksport / import', () => {
  it('JSON w obie strony; niepoprawne wpisy odrzucane, nie psują całości', () => {
    const j = { v: 1 as const, setups: [{ id: 's1', name: 'Odrzucenie VAH', context: 'c', location: 'l', trigger: 't', execution: 'e', invalidation: 'i', createdAt: 1 }], trades: [trade()] };
    expect(parseJournal(serializeJournal(j))).toEqual(j);
    const bad = JSON.stringify({ v: 1, setups: [{ id: 3 }], trades: [{ ...trade(), entryPx: 'x' }, trade({ id: 'ok' })] });
    const p = parseJournal(bad)!;
    expect(p.setups).toEqual([]);
    expect(p.trades.map((t) => t.id)).toEqual(['ok']);
    expect(parseJournal('nie json')).toBeNull();
  });
});
