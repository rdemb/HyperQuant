import { describe, expect, it } from 'vitest';
import { type Bar5, LIFE, type Range, TF_MS, ranges } from '../core/pbRanges';
import { PB_EVIDENCE, PB_LEVELS_PER_SIDE, PB_SPOTS_MAX, boxSpan, formingNote, nearestLevels, selectRanges, selectSpots } from '../chart/pbSelect';

const T0 = Date.UTC(2026, 10, 2, 0, 0);

const range = (o: Partial<Range>): Range => ({ e: 0, s: 1, origin: 0, ext: 0, imp: 0, kv: 60, hi: 110, lo: 100, touches: [], x: null, end: 0, spots: [], ...o });

/** Jak w pbRanges.test.ts: rozbieg, impuls w górę 16 × 4 i zakres zamknięć 1051–1063 z dotknięciami co 12 świec. */
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
  let o = 1000;
  const b = closes.map((c, i) => {
    const x = { t: T0 + i * TF_MS, o, h: Math.max(o, c) + 0.5, l: Math.min(o, c) - 0.5, c, v: 1000 };
    o = c;
    return x;
  });
  return { b, e };
}

describe('zakresy P/b: co rysujemy (pbSelect)', () => {
  it('zakres aktywny i ostatni zakończony; w budowie i starsze — nie', () => {
    const rs = [
      range({ e: 0, kv: 50, x: 90, end: 90 }),
      range({ e: 100, kv: 150, x: 200, end: 200 }),
      range({ e: 300, kv: 350, x: null, end: 400 }),
      range({ e: 380, kv: null, end: 400 }),
    ];
    expect(selectRanges(rs, 400)).toEqual({ active: 2, done: 1 });
    // Bez aktywnego: ostatni zakończony (życie minęło albo wybicie)
    expect(selectRanges(rs.slice(0, 2), 400)).toEqual({ active: null, done: 1 });
    expect(selectRanges([range({ e: 0, kv: 50, x: null, end: 50 + LIFE })], 50 + LIFE + 3)).toEqual({ active: null, done: 0 });
    expect(selectRanges([rs[3]], 400)).toEqual({ active: null, done: null });
  });

  it('pudełko: wypełnienie od świecy potwierdzenia, wcześniejsza część jako obrys; aktywne do bieżącej świecy', () => {
    expect(boxSpan(range({ e: 100, kv: 150, x: null, end: 170 }), 170, true)).toEqual({ from: 101, fillFrom: 150, to: 170, open: true });
    expect(boxSpan(range({ e: 100, kv: 150, x: 200, end: 200 }), 260, false)).toEqual({ from: 101, fillFrom: 150, to: 200, open: false });
  });

  it(`najwyżej ${PB_SPOTS_MAX} ostatnie miejsca 👀`, () => {
    const s = selectSpots([{ t: 5 }, { t: 1 }, { t: 9 }, { t: 7 }, { t: 3 }]);
    expect([...s].sort()).toEqual([0, 2, 3]);
  });

  it(`poziomy tygodnia i doby: najwyżej ${PB_LEVELS_PER_SIDE} najbliższe nad ceną i ${PB_LEVELS_PER_SIDE} pod`, () => {
    const lv = [{ px: 105 }, { px: 120 }, { px: 101 }, { px: 99 }, { px: 90 }, { px: 97 }, { px: 110 }];
    expect([...nearestLevels(lv, 100)].sort()).toEqual([0, 2, 3, 5]);
  });

  it('legenda zakresu w budowie: dotknięcia z 3', () => {
    expect(formingNote([range({ kv: null, touches: [{ k: 1, side: 1 }, { k: 5, side: -1 }] })])).toEqual({ s: 1, touches: 2, e: 0 });
    expect(formingNote([range({})])).toBeNull();
  });

  it('stan chwili X bez pudełka, którego nie było w przeliczeniu kończącym się na X; bez wypełnienia przed potwierdzeniem', () => {
    const { b, e } = scenario(120, []);
    for (const X of [e + 20, e + 47, e + 48, e + 60, b.length - 1]) {
      const rs = ranges(b.slice(0, X + 1));
      const { active, done } = selectRanges(rs, X);
      for (const i of [active, done]) {
        if (i === null) continue;
        // Narysowany zakres jest potwierdzony najpóźniej na X; jego wypełnienie zaczyna się od świecy potwierdzenia
        expect(rs[i].kv).not.toBeNull();
        expect(rs[i].kv!).toBeLessThanOrEqual(X);
      }
      if (X < e + 48) expect(active).toBeNull();
    }
  });

  it('opis: wynik miejsc 👀 z 2026 r., PL i EN', () => {
    expect(PB_EVIDENCE.pl).toContain('A 52% (n 183), B 48% (n 29), C 53% (n 59)');
    expect(PB_EVIDENCE.en).toContain('A 52% (n 183), B 48% (n 29), C 53% (n 59)');
  });
});
