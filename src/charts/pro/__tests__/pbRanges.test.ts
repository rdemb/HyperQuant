import { describe, expect, it } from 'vitest';
import { type Bar5, LIFE, TF_MS, dayLevels, profileLevels, ranges, typicalHourBp, weekLevels } from '../core/pbRanges';

const T0 = Date.UTC(2026, 10, 2, 0, 0); // poniedziałek

/** Świece ze ścieżki zamknięć: otwarcie = poprzednie zamknięcie, knoty `wick` poza korpusem. */
function path(closes: readonly number[], start = T0, open = closes[0], wick = 0.5): Bar5[] {
  let o = open;
  return closes.map((c, i) => {
    const b = {
      t: start + i * TF_MS,
      o,
      h: Math.max(o, c) + wick,
      l: Math.min(o, c) - wick,
      c,
      v: 1000,
    };
    o = c;
    return b;
  });
}

/**
 * Spokojny rozbieg (ATR ok. 3), impuls w górę 16 × 4 do 1064 i zakres zamknięć 1051–1063 (krawędzie 1050,5–1064,5)
 * z dotknięciami co 12 świec; zakres z wielokrotności 24 świec kończy się przy górze.
 */
function scenario(rangeBars: number, tail: readonly number[]): { b: Bar5[]; e: number } {
  const closes: number[] = [];
  for (let i = 0; i < 200; i++) closes.push(i % 2 ? 1001 : 999);
  for (let i = 1; i <= 16; i++) closes.push(1000 + 4 * i);
  const e = closes.length - 1;
  for (let j = 0; j < rangeBars; j++) {
    const ph = j % 24;
    closes.push(ph < 12 ? 1063 - (ph + 1) : 1051 + (ph - 11));
  }
  closes.push(...tail);
  return { b: path(closes, T0, 1000), e };
}

describe('Zakresy P/b', () => {
  it('impuls w górę i zakres z trzema dotknięciami: P ważny po 48 świecach, dotknięcia naprzemiennie', () => {
    const { b, e } = scenario(120, []);
    const rs = ranges(b);
    expect(rs[0].hi).toBe(1064.5);
    expect(rs[0].lo).toBe(1050.5);
    expect(rs).toHaveLength(1);
    const r = rs[0];
    expect([r.e, r.s, r.kv]).toEqual([e, 1, e + 48]);
    expect(r.origin).toBeCloseTo(1000.5, 6);
    expect(r.imp).toBeCloseTo(64, 6);
    expect(r.touches.length).toBeGreaterThanOrEqual(3);
    r.touches.forEach((t, i) => i > 0 && expect(t.side).toBe(-r.touches[i - 1].side));
    // Bez wybicia i bez miejsc wejścia (plan 59, C1): zakres opisuje samą strukturę
    expect(Object.keys(r)).not.toContain('spots');
    expect(r.x).toBeNull();
    expect(r.end).toBe(b.length - 1);
  });

  it('przed świecą ważności zakres jest w budowie i nie zagląda w przyszłość', () => {
    const { b, e } = scenario(120, []);
    const pre = ranges(b.slice(0, e + 48));
    expect(pre).toHaveLength(1);
    expect(pre[0].kv).toBeNull();
    // Te same świece do kv: ten sam zakres co z pełną historią
    const full = ranges(b)[0];
    const cut = ranges(b.slice(0, e + 49))[0];
    expect([cut.kv, cut.hi, cut.lo]).toEqual([full.kv, full.hi, full.lo]);
  });

  it('pierwsze zamknięcie poza strefą kończy zakres (wybicie w górę i powrót niczego nie dodają)', () => {
    const { b } = scenario(96, [1068, 1062, 1058, 1055]);
    const r = ranges(b)[0];
    expect(r.x).toBe(b.findIndex((x) => x.c === 1068));
    expect(r.end).toBe(r.x);
    const up = ranges(scenario(96, [1068, 1069, 1065.5, 1070, 1074]).b)[0];
    expect(up.end).toBe(up.x);
  });

  it('luka w świecach przerywa zakres, a złamany kształt go kasuje', () => {
    const { b, e } = scenario(120, []);
    const gap = b.map((x, i) => (i > e + 20 ? { ...x, t: x.t + TF_MS } : x));
    expect(ranges(gap).every((r) => r.e !== e || r.kv === null)).toBe(true);
    expect(ranges(gap).some((r) => r.e === e)).toBe(false);
    // Dół zakresu poniżej połowy impulsu: to już nie P
    const deep = scenario(
      30,
      [1020, 1060, 1068, 1052, 1068, 1052, 1068, 1052, 1068, 1052, 1068, 1052, 1068, 1052, 1068, 1052, 1068, 1052, 1068, 1052, 1068, 1052],
    );
    expect(ranges(deep.b).some((r) => r.e === deep.e)).toBe(false);
  });

  it('zakres żyje najwyżej 192 świece po ważności', () => {
    const { b, e } = scenario(48 + LIFE + 40, []);
    const r = ranges(b).find((y) => y.e === e)!;
    expect(r.end).toBe(r.kv! + LIFE);
  });
});

describe('Poziomy profilu wolumenu', () => {
  it('POC w koszyku z największym wolumenem, obszar wartości wokół niego', () => {
    const lv = profileLevels([100, 100, 104], [100.01, 100.01, 104.01], [10, 10, 1], 10, false)!;
    expect(lv.poc).toBeGreaterThan(100);
    expect(lv.poc).toBeLessThan(100.11);
    expect(lv.val).toBeLessThan(100.0001);
    expect(lv.vah).toBeLessThan(104);
  });

  it('LVN w dolinie między dwoma szczytami wolumenu', () => {
    const lo: number[] = [];
    const hi: number[] = [];
    const vol: number[] = [];
    for (let k = 0; k < 40; k++) {
      const px = 100 * Math.exp((k * 10) / 1e4);
      lo.push(px);
      hi.push(px * 1.00001);
      vol.push(k < 12 || k > 27 ? 10 : 1);
    }
    const lv = profileLevels(lo, hi, vol, 10, true)!;
    expect(lv.lvn.length).toBeGreaterThan(0);
    for (const { px: p } of lv.lvn) {
      expect(p).toBeGreaterThan(lo[12]);
      expect(p).toBeLessThan(lo[28]);
    }
  });

  it('tydzień i doba tylko z co najmniej 90% świec poprzedniego okresu', () => {
    const week = 7 * 288;
    const b = path(
      Array.from({ length: week + 10 }, (_, i) => 1000 + (i % 7)),
      T0 - 7 * 86_400_000,
    );
    expect(weekLevels(b, T0 + TF_MS)).not.toBeNull();
    expect(dayLevels(b, T0 + TF_MS)).not.toBeNull();
    const holes = b.filter((_, i) => i % 5 !== 0);
    expect(weekLevels(holes, T0 + TF_MS)).toBeNull();
  });
});

describe('Zegar', () => {
  it('typowa godzina: mediana zakresu pełnych godzin w bp', () => {
    // Co godzinę 12 świec: zakres godziny 1000–1010 przy otwarciu 1000 = 100 bp
    const closes = Array.from({ length: 24 * 12 }, (_, i) => (i % 12 === 0 ? 1000 : 1005));
    const b = closes.map((c, i) => ({
      t: T0 + i * TF_MS,
      o: i % 12 === 0 ? 1000 : 1005,
      h: i % 12 === 6 ? 1010 : c,
      l: 1000,
      c,
      v: 1,
    }));
    expect(typicalHourBp(b, T0 + 24 * 3_600_000)).toBeCloseTo(100, 6);
    expect(typicalHourBp(b.slice(0, 100), T0 + 24 * 3_600_000)).toBeNull();
  });
});
