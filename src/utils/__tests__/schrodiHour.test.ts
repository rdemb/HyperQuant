import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Bar } from '../schrodi';
import { HOUR_FEATURES, type HourModel, type HourX, hourMinutes, hourPath, hourProbs, hourX } from '../schrodiHour';

const model = JSON.parse(readFileSync(new URL('../../../public/schrodi/hour-v1.json', import.meta.url), 'utf8')) as HourModel;
const fx = JSON.parse(readFileSync(new URL('./fixtures/schrodi-hour.json', import.meta.url), 'utf8')) as {
  cases: { c0: number; thr: number; p0b: number; p0d: number; min: [number, number, number][]; exp: { m: number; x: HourX; p: { big: number; bigRule: number; dir: number } }[] }[];
};
const MIN = 60_000;

describe('schrodi, godzina na żywo', () => {
  it('szanse z cech jak w Pythonie (drzewa z JSON i Platt)', () => {
    for (const c of fx.cases)
      for (const e of c.exp) {
        const p = hourProbs(model, e.x);
        expect(p.pBig).toBeCloseTo(e.p.big, 12);
        expect(p.pBigRule).toBeCloseTo(e.p.bigRule, 12);
        expect(p.pUp).toBeCloseTo(e.p.dir, 12);
      }
  });

  it('cechy z minut godziny jak w badaniu (zakres, odległości, zmiana, zmienność, logity startu)', () => {
    for (const c of fx.cases)
      for (const e of c.exp) {
        const x = hourX(c.c0, c.thr, c.p0b, c.p0d, c.min.slice(0, e.m).map(([h, l, cl]) => ({ h, l, c: cl })))!;
        // Badanie trzyma cechy w float32
        for (const f of HOUR_FEATURES) expect(Math.abs(x[f] - e.x[f]), `${f} m=${e.m}`).toBeLessThan(1e-5 * Math.max(1, Math.abs(e.x[f])));
        const p = hourProbs(model, x);
        expect(Math.abs(p.pBig - e.p.big)).toBeLessThan(1e-4);
        expect(Math.abs(p.pUp - e.p.dir)).toBeLessThan(1e-4);
      }
  });

  it('zakres ponad progiem: duży ruch pewny; za mało minut albo dziura: brak', () => {
    const x = { ...fx.cases[0].exp[1].x, rr: 1.2 };
    expect(hourProbs(model, x).pBig).toBe(1);
    expect(hourProbs(model, x).pBigRule).toBe(1);
    expect(hourX(100, 30, 0.5, 0.5, [])).toBeNull();
    const hs = Date.parse('2026-10-28T13:00:00Z');
    const bars: Bar[] = Array.from({ length: 20 }, (_, i) => ({ t: hs + i * MIN, o: 1, h: 1, l: 1, c: 1, v: 1 }));
    expect(hourMinutes(bars, hs, hs + 20 * MIN)?.length).toBe(20);
    expect(hourMinutes(bars, hs, hs + 21 * MIN)).toBeNull();
    expect(hourMinutes(bars.filter((_, i) => i !== 7), hs, hs + 20 * MIN)).toBeNull();
  });

  it('ścieżka godziny: start z prognozy kota, potem szansa po każdej minucie', () => {
    const c = fx.cases[1];
    const hs = Date.parse('2026-10-28T13:00:00Z');
    const m1: Bar[] = c.min.map(([h, l, cl], i) => ({ t: hs + i * MIN, o: cl, h, l, c: cl, v: 1 }));
    const pts = hourPath(model, m1, { hs, c0: c.c0, thr: c.thr, pBig: c.p0b, pUp: c.p0d }, hs + 30 * MIN)!;
    expect(pts.length).toBe(31);
    expect(pts[0]).toMatchObject({ m: 0, pBig: c.p0b, pUp: c.p0d });
    const e = c.exp.find((x) => x.m === 30)!;
    expect(Math.abs(pts[30].pBig - e.p.big)).toBeLessThan(1e-4);
  });
});
