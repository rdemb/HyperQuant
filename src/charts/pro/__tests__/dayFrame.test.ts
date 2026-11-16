import { describe, expect, it } from 'vitest';
import { deskMarketOf } from '../../../config/deskMarkets';
import {
  ACCEPT_SHARE,
  IVB_SESSIONS,
  PERIOD_MS,
  STATE_DAYS,
  acceptanceAt,
  dayFrame,
  ivbCalendarOf,
  ivbFrame,
  ivbStatus,
  percentileOf,
  stateHistory,
  stateKey,
  toBar5,
  valueToday,
} from '../core/dayFrame';
import type { Ivb } from '../core/ivb';
import { type Bar5, dayLevels } from '../core/pbRanges';
import { tradeSessionOn } from '../../../utils/sessionDay';

const M5 = 5 * 60_000;
const DAY = 86_400_000;
/** Poniedziałek 16.11.2026, doba UTC (NY otwiera się o 14:30 UTC). */
const D = Date.UTC(2026, 10, 16);
const VA = { val: 100, vah: 110 };

/** Świece 5m od `from` z zamknięć (wąski zakres ±0,2 wokół zamknięcia, wolumen 1). */
const bars = (closes: readonly number[], from = D, v = 1): Bar5[] => closes.map((c, i) => ({ t: from + i * M5, o: c, h: c + 0.2, l: c - 0.2, c, v }));
const rep = (n: number, c: number) => Array<number>(n).fill(c);
const end = (b: readonly Bar5[]) => b[b.length - 1].t + M5;
const state = (b: readonly Bar5[], now = end(b)) => {
  const a = acceptanceAt(VA, b, M5, D, now);
  return a ? stateKey(a.state) : null;
};

describe('Rama dnia: przyjęcie poza wartością (F-A1)', () => {
  it('w wartości: wszystkie zamknięcia w VA', () => {
    expect(state(bars(rep(24, 105)))).toBe('inside');
  });

  it('przyjęcie nad: 2 kolejne zamknięcia 30m nad VAH i ≥ 30% wolumenu nad VAH', () => {
    const b = bars([...rep(12, 105), ...rep(12, 115)]);
    const a = acceptanceAt(VA, b, M5, D, end(b))!;
    expect(a.state).toEqual({ kind: 'accepted', side: 1 });
    expect(a.run).toBe(2);
    expect(a.above).toBeCloseTo(0.5, 6);
    expect(a.minutesOutside).toBe(60);
    expect(a.periods).toBe(4);
  });

  it('przyjęcie pod: lustrzanie pod VAL', () => {
    expect(state(bars([...rep(12, 105), ...rep(12, 95)]))).toBe('accepted-down');
  });

  it('2 zamknięcia 30m nad VAH, ale mniej niż 30% wolumenu: próba, nie przyjęcie', () => {
    const b = bars([...rep(36, 105), ...rep(12, 115)]);
    const a = acceptanceAt(VA, b, M5, D, end(b))!;
    expect(a.above).toBeLessThan(ACCEPT_SHARE);
    expect(a.run).toBe(2);
    expect(stateKey(a.state)).toBe('attempt-up');
  });

  it('jedno zamknięcie 30m nad VAH: próba wyjścia nad', () => {
    expect(state(bars([...rep(12, 105), ...rep(6, 115)]))).toBe('attempt-up');
  });

  it('świeca 5m pod VAL bez zamknięcia 30m: próba wyjścia pod', () => {
    expect(state(bars([...rep(12, 105), 95, 95]))).toBe('attempt-down');
  });

  it('powrót do wartości po zamknięciu 30m poza VA', () => {
    expect(state(bars([...rep(12, 105), ...rep(6, 115), ...rep(6, 105)]))).toBe('return');
  });

  it('wyjście tylko świecami 5m i powrót przed zamknięciem 30m: nadal w wartości', () => {
    expect(state(bars([...rep(12, 105), 115, 115, 105, 105, 105, 105]))).toBe('inside');
  });

  it('przyjęcie po obu stronach tej samej doby: niesklasyfikowane', () => {
    const b = bars([...rep(6, 105), ...rep(12, 115), ...rep(24, 95)]);
    expect(acceptanceAt(VA, b, M5, D, end(b))!.state).toEqual({ kind: 'unclassified', why: 'both-sides' });
  });

  it('ostatnia świeca po przeciwnej stronie VA niż ostatnie zamknięcie 30m: niesklasyfikowane', () => {
    const b = bars([...rep(6, 105), ...rep(6, 115), 95]);
    expect(acceptanceAt(VA, b, M5, D, end(b))!.state).toEqual({ kind: 'unclassified', why: 'whipsaw' });
  });

  it('luka w danych (brak półgodziny) przerywa serię zamknięć 30m', () => {
    const first = bars([...rep(12, 105), ...rep(6, 115)]);
    const after = bars(rep(6, 115), D + 24 * M5);
    const a = acceptanceAt(VA, [...first, ...after], M5, D, end(after))!;
    expect(a.run).toBe(1);
    expect(stateKey(a.state)).toBe('attempt-up');
  });

  it('wolumen świecy rozłożony na zakres: część nad VAH liczy się jako wolumen nad', () => {
    const b: Bar5[] = [
      { t: D, o: 105, h: 105.2, l: 104.8, c: 105, v: 4 },
      { t: D + M5, o: 109, h: 112, l: 108, c: 109, v: 4 },
    ];
    const a = acceptanceAt(VA, b, M5, D, D + 2 * M5)!;
    expect(a.above).toBeCloseTo(2 / 8, 9);
    expect(a.below).toBe(0);
  });

  it('świeca w trakcie (koniec po `now`) i świece innej doby nie wchodzą', () => {
    const b = bars([...rep(12, 105), 115], D);
    expect(state(b, end(b) - 1)).toBe('inside');
    expect(acceptanceAt(VA, bars(rep(6, 115), D - DAY), M5, D, D + DAY)).toBeNull();
  });
});

/** Świece 30m doby `d` z ceną zamknięcia z `px(k)` dla półgodziny k (zakres ±0,5, wolumen 1). */
const day30 = (d: number, px: (k: number) => number, range: (k: number) => number = () => 1): Bar5[] =>
  Array.from({ length: 48 }, (_, k) => {
    const c = px(k);
    const r = range(k) / 2;
    return { t: d + k * PERIOD_MS, o: c, h: c + r, l: c - r, c, v: 1 };
  });

describe('Rama dnia: częstość stanu o tej porze w 60 dobach', () => {
  it('60 pełnych dób: n 60, liczby stanów sumują się do n', () => {
    const c30 = Array.from({ length: 65 }, (_, i) => day30(D - (65 - i) * DAY, () => 100)).flat();
    const h = stateHistory(c30, D + 12 * 3_600_000);
    expect(h.n).toBe(STATE_DAYS);
    expect(h.counts.inside).toBe(STATE_DAYS);
    expect(Object.values(h.counts).reduce((a, b) => a + b, 0)).toBe(h.n);
  });

  it('krótka historia: tylko tyle dób, ile jest danych (bez dopełniania)', () => {
    const c30 = Array.from({ length: 30 }, (_, i) => day30(D - (30 - i) * DAY, () => 100)).flat();
    const h = stateHistory(c30, D + 12 * 3_600_000);
    expect(h.n).toBe(29);
    expect(h.n).toBeLessThan(STATE_DAYS);
  });

  it('pierwsze pół godziny doby: brak porównania', () => {
    const h = stateHistory([], D + 10 * 60_000);
    expect(h).toMatchObject({ n: 0, early: true });
  });

  it('ta sama pora doby: stan liczony tylko z półgodzin do tej samej godziny', () => {
    // Na przemian doba spokojna (100) i doba z popołudniem wysoko (od 12:00 UTC 130)
    const c30 = Array.from({ length: 66 }, (_, i) => {
      const d = D - (66 - i) * DAY;
      return day30(d, (k) => (i % 2 && k >= 24 ? 130 : 100));
    }).flat();
    const morning = stateHistory(c30, D + 6 * 3_600_000);
    const evening = stateHistory(c30, D + 18 * 3_600_000);
    expect(morning.counts['accepted-up']).toBe(0);
    expect(evening.counts['accepted-up']).toBe(30);
  });
});

describe('Rama dnia: wartość dziś wobec wczoraj', () => {
  it('VA wczoraj to `dayLevels` warstwy P/b (te same liczby co na wykresie), stan i wartość liczone od niej', () => {
    const y = bars(rep(288, 100).map((c, i) => c + (i % 12) * 0.5), D - DAY);
    const t = bars([...rep(60, 103), ...rep(24, 112)], D);
    const now = end(t);
    const f = dayFrame({ b5: [...y, ...t], c30: [], now, cal: { kind: 'daily' } });
    expect(f.prev).toEqual(dayLevels([...y, ...t], now));
    expect(f.prev).not.toBeNull();
    expect(f.acceptance).toEqual(acceptanceAt(f.prev!, [...y, ...t], M5, D, now));
    expect(f.value).toEqual(valueToday([...y, ...t], M5, now, f.prev!));
  });

  it('nakładanie: część VA dziś w VA wczoraj, z etykietą migracji', () => {
    const t = bars(rep(12, 108), D);
    const v = valueToday(t, M5, end(t), { val: 100, vah: 108 })!;
    expect(v.migration).toBe('overlap-higher');
    expect(v.overlap).toBeGreaterThan(0);
    expect(v.overlap).toBeLessThan(1);
    expect(valueToday(bars(rep(3, 108)), M5, D + 3 * M5, { val: 100, vah: 108 })).toBeNull();
  });

  it('świece wykresu → świece profilu jak warstwa P/b: bez świecy w trakcie, wolumen w USD', () => {
    const c = [
      { t: D, o: 1, h: 2, l: 1, c: 2, v: 3 },
      { t: D + M5, o: 2, h: 2, l: 2, c: 2, v: 5 },
    ];
    expect(toBar5(c, M5, D + M5 + 1)).toEqual([{ t: D, o: 1, h: 2, l: 1, c: 2, v: 6 }]);
  });
});

describe('Rama dnia: kontekst IVB (F-A2)', () => {
  it('kalendarz otwarć: krypto codziennie, sesja NYSE dla indeksu i akcji, metal i nieznany HIP-3 bez IVB', () => {
    const desk = (coin: string) => deskMarketOf(coin)?.underlying ?? null;
    expect(ivbCalendarOf('BTC', desk('BTC'))).toEqual({ kind: 'daily' });
    expect(ivbCalendarOf('ETH', null)).toEqual({ kind: 'daily' });
    expect(ivbCalendarOf('xyz:SP500', desk('xyz:SP500'))).toEqual({ kind: 'nyse' });
    expect(ivbCalendarOf('xyz:GOLD', desk('xyz:GOLD'))).toEqual({ kind: 'none', why: 'no-rth' });
    expect(ivbCalendarOf('xyz:NVDA', null, 'equity')).toEqual({ kind: 'nyse' });
    expect(ivbCalendarOf('abc:FOO', null)).toEqual({ kind: 'none', why: 'unknown' });
  });

  const open = tradeSessionOn(D, 'ny').start;
  const ivb: Ivb = { start: open, end: open + 30 * 60_000, sessionEnd: D + DAY, hi: 110, lo: 100, complete: true, through: open + 30 * 60_000 };

  it('status: w budowie, w środku, wybicie z chwilą pierwszego zamknięcia serii, powrót do środka', () => {
    expect(ivbStatus({ ...ivb, complete: false }, [], M5, open + 10 * 60_000)).toEqual({ kind: 'forming' });
    const after = (cs: number[]) => bars(cs, ivb.end);
    expect(ivbStatus(ivb, after([105, 105]), M5, ivb.end + 10 * 60_000)).toEqual({ kind: 'inside' });
    expect(ivbStatus(ivb, after([105, 111, 112]), M5, ivb.end + 15 * 60_000)).toEqual({ kind: 'broke', side: 1, since: ivb.end + 2 * M5 });
    expect(ivbStatus(ivb, after([99, 112, 105]), M5, ivb.end + 15 * 60_000)).toEqual({ kind: 'back' });
    // Wybicie pod po wybiciu nad: chwila od pierwszego zamknięcia pod
    expect(ivbStatus(ivb, after([112, 99, 98]), M5, ivb.end + 15 * 60_000)).toEqual({ kind: 'broke', side: -1, since: ivb.end + 2 * M5 });
  });

  it('percentyl: część mniejszych plus połowa równych', () => {
    expect(percentileOf(2, [1, 2, 3, 4])).toBe(37.5);
    expect(percentileOf(5, [1, 2, 3, 4])).toBe(100);
  });

  /** Świece 30m `n` dób przed D (otwarcie NY o szerokości `w(d)`, reszta 1) i świece 5m dziś do 15:30 UTC. */
  const input = (n: number, w: (i: number) => number) => {
    const c30 = Array.from({ length: n }, (_, i) => {
      const d = D - (n - i) * DAY;
      const o = tradeSessionOn(d, 'ny').start;
      return day30(d, () => 100, (k) => (d + k * PERIOD_MS === o ? w(i) : 1));
    }).flat();
    const t = Array.from({ length: (open - D) / M5 + 12 }, (_, i): Bar5 => {
      const at = D + i * M5;
      const inWin = at >= open && at < open + 30 * 60_000;
      return { t: at, o: 100, h: inWin ? 101.5 : 100.5, l: inWin ? 98.5 : 99.5, c: 100, v: 1 };
    });
    return { c30, b5: t, now: end(t) };
  };

  it('szerokość w ATR doby z percentylem wobec 20 sesji tego samego typu (także sprzed zmiany czasu w USA)', () => {
    const x = input(45, (i) => 1 + (i % 5));
    const f = ivbFrame({ ...x, cal: { kind: 'daily' } });
    expect(f.kind).toBe('ok');
    if (f.kind !== 'ok') return;
    expect(f.ivb.hi - f.ivb.lo).toBeCloseTo(3, 9);
    expect(f.status).toEqual({ kind: 'inside' });
    expect(f.width.kind).toBe('ok');
    if (f.width.kind !== 'ok') return;
    expect(f.width.n).toBe(IVB_SESSIONS);
    expect(f.width.p).toBeGreaterThan(0);
    expect(f.width.p).toBeLessThan(100);
  });

  it('krótka historia: szerokość bez percentyla z liczbą sesji', () => {
    const x = input(20, () => 2);
    const f = ivbFrame({ ...x, cal: { kind: 'daily' } });
    expect(f.kind === 'ok' && f.width).toMatchObject({ kind: 'short', n: expect.any(Number) });
    if (f.kind === 'ok' && f.width.kind === 'short') expect(f.width.n).toBeLessThan(IVB_SESSIONS);
  });

  it('rynek bez sesji NYSE albo dzień bez sesji NYSE: IVB nie dotyczy, z powodem', () => {
    const x = input(45, () => 2);
    expect(ivbFrame({ ...x, cal: { kind: 'none', why: 'no-rth' } })).toEqual({ kind: 'na', why: 'no-rth' });
    // Święto Dziękczynienia 26.11.2026: NYSE nieczynna
    const th = Date.UTC(2026, 10, 26);
    const o = tradeSessionOn(th, 'ny').start;
    const b5 = bars(rep((o - th) / M5 + 12, 100), th);
    expect(ivbFrame({ b5, c30: [], now: end(b5), cal: { kind: 'nyse' } })).toEqual({ kind: 'na', why: 'nyse-closed' });
  });

  it('przed otwarciem NY: stan okna z ivbAt (bez zakresu)', () => {
    const b5 = bars(rep(12, 100), D);
    expect(ivbFrame({ b5, c30: [], now: end(b5), cal: { kind: 'daily' } })).toMatchObject({ kind: 'state', state: { kind: 'outside' } });
  });
});
