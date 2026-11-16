import { describe, expect, it } from 'vitest';
import { DESK_MARKETS } from '../../../config/deskMarkets';
import { PREMIUM_MAX_AGE_MS, PremiumLog, hlPremiumBp, markOracleBp, oracleLive, premiumMinutes, premiumNoiseBp, premiumRead, premiumStepBp } from '../core/premium';
import { type FlowContext, indicatorDef } from '../indicators/registry';

const S = 1_000;
const MIN = 60_000;

describe('premia HL wobec spotu: wzór (Pionier R3-2)', () => {
  it('główna seria: pole premium Hyperliquid (ułamek) w pb; brak pola — null, nie zero', () => {
    // Odczyt BTC z 16.11: premium −0,0007254654 = (impact_ask 64 739 − oracle 64 786) / oracle
    expect(hlPremiumBp(-0.0007254654)).toBeCloseTo(-7.254654, 9);
    expect(hlPremiumBp(0)).toBe(0);
    expect(hlPremiumBp(Number.NaN)).toBeNull();
  });

  it('seria pomocnicza (mark − oracle) / oracle w pb; brak albo zła cena — null, nie zero', () => {
    // Ten sam odczyt: mark 64 746, oracle 64 786
    expect(markOracleBp(64_746, 64_786)).toBeCloseTo(-6.1742, 3);
    expect(markOracleBp(100_100, 100_000)).toBeCloseTo(10, 12);
    expect(markOracleBp(100_000, 100_000)).toBe(0);
    expect(markOracleBp(100_000, 0)).toBeNull();
    expect(markOracleBp(100_000, Number.NaN)).toBeNull();
    expect(markOracleBp(Number.NaN, 100_000)).toBeNull();
    expect(markOracleBp(0, 100_000)).toBeNull();
  });

  it('krok ceny (5 cyfr znaczących) w pb: najmniejsza zmiana premii, jaką widać w odczycie', () => {
    expect(premiumStepBp(64_786)).toBeCloseTo(1e4 / 64_786, 12);
    expect(premiumStepBp(3_854.7)).toBeCloseTo((0.1 / 3_854.7) * 1e4, 12);
    expect(premiumStepBp(0)).toBeNull();
  });
});

describe('PremiumLog: próbki i średnia świecy ważona czasem', () => {
  it('trzyma wartości ujemne i zero (w przeciwieństwie do OI), odrzuca NaN; ta sama chwila nadpisuje', () => {
    const log = new PremiumLog();
    log.push(1 * S, -3);
    log.push(2 * S, 0);
    log.push(3 * S, Number.NaN);
    log.push(2 * S, 1);
    expect(log.times()).toEqual([1 * S, 2 * S]);
    expect(log.atWithin(2 * S, 10 * S)).toBe(1);
    expect(log.atWithin(1.5 * S, 10 * S)).toBe(-3);
  });

  it('odczyt starszy niż maksymalny wiek się nie liczy (przerwa w danych)', () => {
    const log = new PremiumLog();
    log.push(0, 5);
    expect(log.atWithin(30 * S, 60 * S)).toBe(5);
    expect(log.atWithin(61 * S, 60 * S)).toBeNull();
    expect(log.atWithin(-1, 60 * S)).toBeNull();
  });

  it('średnia świecy: każdy odczyt waży tyle, ile trwał do następnego (najwyżej maksymalny wiek)', () => {
    const log = new PremiumLog();
    log.push(0, 2);
    log.push(10 * S, 4);
    log.push(40 * S, -2);
    // (2·10 + 4·30 + (−2)·20) / 60
    expect(log.meanWithin(0, MIN, PREMIUM_MAX_AGE_MS)).toBeCloseTo(100 / 60, 12);
  });

  it('odczyt sprzed świecy liczy się od jej początku, jeśli jeszcze jest świeży', () => {
    const log = new PremiumLog();
    log.push(-10 * S, 7);
    // Ważny do 50 s, potem przerwa: średnia z samego okresu z odczytem
    expect(log.meanWithin(0, MIN, MIN)).toBe(7);
  });

  it('przerwa dłuższa niż maksymalny wiek: liczy się tylko czas z odczytem', () => {
    const log = new PremiumLog();
    log.push(0, 1);
    log.push(100 * S, 3);
    // 1 przez 60 s (wiek), luka 60–100 s, 3 przez 20 s do końca okna
    expect(log.meanWithin(0, 120 * S, MIN)).toBeCloseTo((1 * 60 + 3 * 20) / 80, 12);
  });

  it('świeca bez świeżego odczytu: null (stara próbka nie przechodzi na następne świece)', () => {
    const log = new PremiumLog();
    log.push(0, 5);
    expect(log.meanWithin(2 * MIN, 3 * MIN, MIN)).toBeNull();
    expect(log.meanWithin(MIN, MIN, MIN)).toBeNull();
    expect(new PremiumLog().meanWithin(0, MIN, MIN)).toBeNull();
  });

  it('sprzątanie zostawia ostatnią próbkę sprzed granicy (stan na początku zachowanego okresu)', () => {
    const log = new PremiumLog();
    for (let k = 0; k < 5; k++) log.push(k * MIN, k);
    log.prune(2.5 * MIN);
    expect(log.times()).toEqual([2 * MIN, 3 * MIN, 4 * MIN]);
  });

  it('premiumMinutes: średnie kolejnych minut, NaN w minucie bez odczytu', () => {
    const log = new PremiumLog();
    log.push(0, 1);
    log.push(30 * S, 3);
    log.push(3 * MIN, 5);
    const m = premiumMinutes(log, 0, 4 * MIN);
    expect(m).toHaveLength(4);
    expect(m[0]).toBeCloseTo(2, 12);
    // Odczyt z 30 s ważny 60 s: w drugiej minucie trwa do 90 s
    expect(m[1]).toBe(3);
    expect(Number.isNaN(m[2])).toBe(true);
    expect(m[3]).toBe(5);
  });
});

describe('wskaźnik „Premia”: wartość świecy z kontekstu wykresu', () => {
  const def = indicatorDef('premium');
  const run = (ctx: Partial<FlowContext>, t: number, ms: number) => {
    const out = new Float64Array(def.plots.length);
    def.flow!({ candle: { t, o: 1, h: 1, l: 1, c: 1, v: 1, n: 1 } }, ms, { now: 10 * MIN, ...ctx } as FlowContext, out);
    return Array.from(out);
  };

  it('panel własny, pasmo zwykłości (z pola premium), linia zera, bez parametrów; mark − oracle tylko w legendzie', () => {
    expect(def.pane).toBe('own');
    expect(def.usualBand).toEqual({});
    expect(def.levels).toEqual([0]);
    expect(def.params).toEqual([]);
    expect(def.plots[0].hidden).toBeUndefined();
    expect(def.plots[1]).toMatchObject({ hidden: true, title: 'mark − oracle' });
  });

  it('świeca zamknięta: średnia z [t, t + ms); bieżąca: do teraz; główna seria z pola premium, druga z mark − oracle', () => {
    const asked: [number, number][] = [];
    const premium = (a: number, b: number) => (asked.push([a, b]), 4.5);
    const markOracle = () => -1.5;
    expect(run({ premium, markOracle }, 2 * MIN, MIN)).toEqual([4.5, -1.5]);
    expect(run({ premium }, 9 * MIN, 5 * MIN)[0]).toBe(4.5);
    expect(asked).toEqual([
      [2 * MIN, 3 * MIN],
      [9 * MIN, 10 * MIN],
    ]);
  });

  it('bez odczytu albo bez źródła premii (powtórka, testy): NaN, czyli „—”', () => {
    expect(run({ premium: () => null, markOracle: () => null }, 0, MIN).every(Number.isNaN)).toBe(true);
    expect(run({}, 0, MIN).every(Number.isNaN)).toBe(true);
  });
});

describe('oracle rynku bazowego: HIP-3 poza notowaniami to cena platformy', () => {
  // Sobota 14.11.2026 12:00 UTC: rynek bazowy HIP-3 nie notuje; środa 18.11.2026 15:00 UTC: notuje
  const SAT = Date.UTC(2026, 10, 14, 12);
  const WED = Date.UTC(2026, 10, 18, 15);
  const hip3 = DESK_MARKETS.find((m) => m.underlying.calendar !== 'crypto')!;

  it('krypto zawsze; rynek desku HIP-3 tylko w godzinach rynku bazowego; rynek spoza konfiguracji — bez wiedzy, liczymy', () => {
    expect(oracleLive('BTC', SAT)).toBe(true);
    expect(oracleLive(hip3.coin, WED)).toBe(true);
    expect(oracleLive(hip3.coin, SAT)).toBe(false);
    expect(oracleLive('ETH', SAT)).toBe(true);
  });
});

describe('premiumNoiseBp: szum odczytu z rozkładu zmian minutowych w spokojnych godzinach', () => {
  /** Godzina minut na przemian a i b (|zmiana minutowa| = |a − b|). */
  const hour = (a: number, b: number) => Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? a : b));

  it('p90 |zmian| ze spokojniejszej połowy godzin: burzliwa godzina nie podnosi progu', () => {
    const xs = [...hour(1, 1.2), ...hour(0, 3), ...hour(1, 1.2)];
    expect(premiumNoiseBp(xs)).toBeCloseTo(0.2, 9);
  });

  it('próg nie niższy niż krok ceny', () => {
    const xs = [...hour(1, 1.2), ...hour(1, 1.2)];
    expect(premiumNoiseBp(xs, 0.5)).toBe(0.5);
  });

  it('jedna godzina: p90 z całej próby; mniej niż 30 zmian — null (za mało, żeby ocenić szum)', () => {
    const one = Array.from({ length: 41 }, (_, i) => (i % 10 === 0 ? 2 : 0) + (i % 2) * 0.1);
    const p90 = premiumNoiseBp(one);
    expect(p90).not.toBeNull();
    expect(p90!).toBeGreaterThan(0.1);
    expect(premiumNoiseBp(hour(0, 1).slice(0, 30))).toBeNull();
    // Minuta bez odczytu przerywa pary: 2 × 14 zmian
    expect(premiumNoiseBp([...hour(0, 1).slice(0, 15), Number.NaN, ...hour(0, 1).slice(0, 15)])).toBeNull();
  });
});

describe('premiumRead: kierunek zmiany premii z progiem szumu i położenie wobec pasma', () => {
  /** Dwie spokojne godziny (szum 0,2 pb), potem 15 minut z wartościami z `tail`. */
  const quiet = Array.from({ length: 120 }, (_, i) => (i % 2 === 0 ? 1 : 1.2));
  const withTail = (tail: (k: number) => number) => [...quiet, ...Array.from({ length: 16 }, (_, k) => tail(k))];

  it('wzrost o 3 pb w 15 min: „rośnie”; spadek: „spada”', () => {
    const up = premiumRead(withTail((k) => 1 + k * 0.2), { windowMin: 15 })!;
    expect(up.trend).toBe('rising');
    expect(up.changeBp).toBeCloseTo(3, 9);
    expect(up.noiseBp).toBeCloseTo(0.2, 9);
    expect(premiumRead(withTail((k) => 1 - k * 0.2), { windowMin: 15 })!.trend).toBe('falling');
  });

  it('zmiana nie większa niż szum odczytu: „płaska” (bez zmian)', () => {
    const r = premiumRead(withTail((k) => (k === 15 ? 1.15 : 1)), { windowMin: 15 })!;
    expect(r.changeBp).toBeCloseTo(0.15, 9);
    expect(r.trend).toBe('flat');
  });

  it('położenie wobec pasma: wyróżnienie tylko poza pasmem', () => {
    const tail = withTail(() => 5);
    expect(premiumRead(tail, { windowMin: 15, band: { lo: 0, hi: 2 } })!.side).toBe('above');
    expect(premiumRead(tail, { windowMin: 15, band: { lo: 0, hi: 6 } })!.side).toBe('inside');
    expect(premiumRead(tail, { windowMin: 15, band: { lo: 6, hi: 8 } })!.side).toBe('below');
    expect(premiumRead(tail, { windowMin: 15, band: { lo: Number.NaN, hi: Number.NaN } })!.side).toBeNull();
    expect(premiumRead(tail, { windowMin: 15 })!.side).toBeNull();
  });

  it('bez odczytu w ostatniej minucie: null; bez odczytu na początku okna albo bez szumu: kierunek null', () => {
    expect(premiumRead([...quiet, Number.NaN], { windowMin: 15 })).toBeNull();
    const gap = [...quiet.slice(0, 104), Number.NaN, ...quiet.slice(105), 1];
    const r = premiumRead(gap, { windowMin: 16 })!;
    expect(r.bp).toBe(1);
    expect(r.changeBp).toBeNull();
    expect(r.trend).toBeNull();
    const short = premiumRead([1, 1.1, 1.2], { windowMin: 2 })!;
    expect(short.changeBp).toBeCloseTo(0.2, 9);
    expect(short.noiseBp).toBeNull();
    expect(short.trend).toBeNull();
  });
});
