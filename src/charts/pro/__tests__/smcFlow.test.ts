import { describe, expect, it } from 'vitest';
import { SMC_ABSORPTION_Z, type SmcFlowBar, breakFlow, fvgFlow, obFlow } from '../chart/smcFlow';
import { TAG_H, layoutTags } from '../chart/smcLayer';

const MS = 60_000;

/** Świeca z footprintem: wiersze `rows` (cena → wolumen), tick 1, połowa kupna i połowa sprzedaży. */
function bar(i: number, o: number, h: number, l: number, c: number, rows: Record<number, number> | null, delta = 0): SmcFlowBar {
  if (!rows) return { t: i * MS, candle: { t: i * MS, o, h, l, c, v: 1 } as SmcFlowBar['candle'], fp: null, complete: false };
  const prices = Object.keys(rows).map(Number);
  const lo = Math.min(...prices);
  const n = Math.max(...prices) - lo + 1;
  const buy = new Float64Array(n);
  const sell = new Float64Array(n);
  for (const p of prices) {
    buy[p - lo] = rows[p] / 2;
    sell[p - lo] = rows[p] / 2;
  }
  return { t: i * MS, candle: { t: i * MS, o, h, l, c, v: 1 } as SmcFlowBar['candle'], fp: { delta, tick: 1, lo, buy, sell }, complete: true };
}

describe('OB z taśmą', () => {
  const bars = [bar(0, 105, 106, 100, 101, { 100: 5, 101: 9, 102: 30, 103: 4, 104: 2, 105: 1 }, -50)];

  it('POC świecy OB: wiersz z największym wolumenem (środek wiersza)', () => {
    expect(obFlow(bars, { idx: 0, dir: 1 }, { delta: -50, fc1: 0 }).poc).toBe(102.5);
  });

  it('absorpcja: delta przeciw impulsowi i F-C1 co najmniej p10 przeciw delcie; inaczej nie albo null bez danych', () => {
    const z = SMC_ABSORPTION_Z;
    // OB przed ruchem w górę: sprzedaż (delta < 0), a cena spadła mniej, niż oczekiwano (F-C1 > 0)
    expect(obFlow(bars, { idx: 0, dir: 1 }, { delta: -50, fc1: z + 0.1 }).absorption).toBe(true);
    expect(obFlow(bars, { idx: 0, dir: 1 }, { delta: -50, fc1: z - 0.5 }).absorption).toBe(false);
    // Delta zgodna z impulsem to nie absorpcja
    expect(obFlow(bars, { idx: 0, dir: 1 }, { delta: 50, fc1: -3 }).absorption).toBe(false);
    // OB przed ruchem w dół: kupno i cena wzrosła mniej, niż oczekiwano
    expect(obFlow(bars, { idx: 0, dir: -1 }, { delta: 40, fc1: -(z + 0.2) }).absorption).toBe(true);
    expect(obFlow(bars, { idx: 0, dir: 1 }, { delta: null, fc1: null })).toEqual({ poc: 102.5, absorption: null });
  });

  it('bez pełnej taśmy: POC null', () => {
    expect(obFlow([bar(0, 1, 2, 0, 1, null)], { idx: 0, dir: 1 }, { delta: null, fc1: null }).poc).toBeNull();
  });
});

describe('FVG pusta', () => {
  // Luka w górę [104, 108] przeszła w świecy 1 (zakres 100–112): w luce prawie nic nie handlowano
  const thin = [bar(0, 99, 104, 98, 103, { 100: 10 }), bar(1, 101, 112, 100, 111, { 100: 30, 101: 30, 104: 1, 110: 40 }), bar(2, 111, 113, 108, 112, { 110: 5 })];

  it('udział i gęstość wolumenu w luce wobec średniej świecy; ≤ 0,25 — pusta', () => {
    const x = fvgFlow(thin, { idx: 2, lo: 104, hi: 108 });
    expect(x).not.toBeNull();
    expect(x?.share).toBeCloseTo(1 / 101, 6);
    // Luka to 4/12 zakresu świecy, więc gęstość = udział / (1/3)
    expect(x?.density).toBeCloseTo(3 / 101, 6);
    expect(x?.thin).toBe(true);
  });

  it('gęsty handel w luce: nie pusta; bez taśmy środkowej świecy: null', () => {
    const dense = [thin[0], bar(1, 101, 112, 100, 111, { 104: 50, 105: 50, 106: 50, 107: 50 }), thin[2]];
    expect(fvgFlow(dense, { idx: 2, lo: 104, hi: 108 })?.thin).toBe(false);
    expect(fvgFlow([thin[0], bar(1, 101, 112, 100, 111, null), thin[2]], { idx: 2, lo: 104, hi: 108 })).toBeNull();
  });
});

describe('przełamanie z przyjęciem', () => {
  const brk = { idx: 0, dir: 1 as const, level: 100 };
  const asOf = 4 * MS;

  it('≥ 2 z 3 zamknięć i ≥ 50% wolumenu taśmy za poziomem: z przyjęciem', () => {
    const bars = [bar(0, 99, 102, 99, 101, { 101: 1 }), bar(1, 101, 103, 99, 102, { 101: 6, 99: 2 }), bar(2, 102, 103, 98, 99, { 99: 5, 102: 4 }), bar(3, 99, 104, 99, 103, { 103: 8 })];
    expect(breakFlow(bars, brk, MS, asOf)).toEqual({ closes: 2, share: 18 / 25, accepted: true });
  });

  it('powrót pod poziom: bez przyjęcia nawet bez taśmy; za wcześnie: null; brak taśmy przy 2 zamknięciach: null', () => {
    const back = [bar(0, 99, 102, 99, 101, null), bar(1, 101, 101, 97, 98, null), bar(2, 98, 99, 96, 97, null), bar(3, 97, 101, 96, 101, null)];
    expect(breakFlow(back, brk, MS, asOf)).toEqual({ closes: 1, share: null, accepted: false });
    expect(breakFlow(back, brk, MS, asOf - 1)).toBeNull();
    const noTape = [back[0], bar(1, 101, 103, 100, 102, null), bar(2, 102, 104, 101, 103, null), back[3]];
    expect(breakFlow(noTape, brk, MS, asOf)).toEqual({ closes: 3, share: null, accepted: null });
  });
});

describe('kolumna podpisów', () => {
  it('bez nakładania się, kolejność wysokości zachowana, w granicach panelu', () => {
    const ys = [50, 52, 51, 300, 395, 398];
    const out = layoutTags(ys, 400);
    const sorted = [...out].sort((a, b) => a - b);
    for (let k = 1; k < sorted.length; k++) expect(sorted[k] - sorted[k - 1]).toBeGreaterThanOrEqual(TAG_H);
    for (const y of out) {
      expect(y).toBeGreaterThanOrEqual(TAG_H / 2);
      expect(y).toBeLessThanOrEqual(400 - TAG_H / 2);
    }
    expect(out[0]).toBe(50);
    expect(out[3]).toBe(300);
    // Wyższy element dostaje wyższe miejsce
    expect(out[0]).toBeLessThan(out[2]);
    expect(out[2]).toBeLessThan(out[1]);
  });
});
