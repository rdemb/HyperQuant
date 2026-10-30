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
    { time: T0 + 31 * MIN, open: 100_800, high: 102_000, low: 100_700, close: 101_500 }, // po minucie wyjścia — poza oknem
  ];
  it('long: MAE z minimum, MFE z maksimum świec w [minuta wejścia, minuta wyjścia]', () => {
    expect(excursions(trade({ exitPx: 100_800 }), bars)).toEqual({ mae: -0.6, mfe: 1.8 });
    // wyjście 101 000 (+2R) poza zakresem świec → MFE nie mniejsze niż wynik
    expect(excursions(trade(), bars)).toEqual({ mae: -0.6, mfe: 2 });
  });
  it('short: odwrotnie; bez świec w oknie → null', () => {
    expect(excursions(trade({ dir: 'SHORT', stopPx: 100_500, exitPx: 100_200 }), bars)).toEqual({ mae: -1.8, mfe: 0.6 });
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

describe('poprawki po recenzji: okno MAE/MFE, walidacja importu', () => {
  it('minuta wyjścia należy do okna (zlecenie wykonane w tej minucie); MAE ≤ min(0, R), MFE ≥ max(0, R)', () => {
    const t = trade({ exitT: T0 + 30 * MIN, exitPx: 99_500 }); // stop: −1R w minucie 10:30
    const bars = [
      { time: T0, open: 100_000, high: 100_100, low: 99_800, close: 99_900 },
      { time: T0 + 30 * MIN, open: 99_600, high: 99_650, low: 99_450, close: 99_500 },
    ];
    expect(excursions(t, bars)!.mae).toBeCloseTo(-1.1, 9);
    // luka w danych: świece nie sięgają ceny wyjścia — ekstremum nie może być płytsze niż wynik
    expect(excursions(t, bars.slice(0, 1))!.mae).toBeCloseTo(-1, 9);
    const win = trade({ exitPx: 101_000 }); // +2R, świece pokazują tylko +0.2R
    expect(excursions(win, bars.slice(0, 1))!.mfe).toBeCloseTo(2, 9);
  });

  it('import: wymagane v = 1; nieznany setup → bez setupu; absurdalne czasy, ceny ≤ 0 i zły kontekst odrzucane', () => {
    expect(parseJournal('{}')).toBeNull();
    expect(parseJournal('[]')).toBeNull();
    const j = parseJournal(
      JSON.stringify({
        v: 1,
        setups: [{ id: 's1', name: 'A', context: '', location: '', trigger: '', execution: '', invalidation: '', createdAt: 1 }],
        trades: [
          trade({ id: 'orphan', setupId: 'zniknal' }),
          trade({ id: 'ns', entryT: 1e20 }),
          trade({ id: 'neg', entryPx: -5 }),
          { ...trade({ id: 'ctx' }), ctx: { ib: {} } },
          { ...trade({ id: 'ok' }), ctx: { vwapZ: 1.2, openLoc: 'above', ib: 'both' } },
          { ...trade({ id: 'old' }), ctx: { vwapZ: null, openLoc: null, ib: 'wybity ↑' } },
          { ...trade({ id: 'odd' }), ctx: { vwapZ: null, openLoc: null, ib: 'toString' } },
        ],
      })
    )!;
    expect(j.trades.map((t) => t.id)).toEqual(['orphan', 'ctx', 'ok', 'old', 'odd']);
    expect(j.trades[0].setupId).toBeNull();
    expect(j.trades[1].ctx).toBeNull();
    expect(j.trades[2].ctx).toEqual({ vwapZ: 1.2, openLoc: 'above', ib: 'both' });
    // Wpis sprzed kodów (polska etykieta) czyta się jako kod; nieznany stan odrzuca sam kontekst
    expect(j.trades[3].ctx).toEqual({ vwapZ: null, openLoc: null, ib: 'up' });
    expect(j.trades[4].ctx).toBeNull();
  });
});
