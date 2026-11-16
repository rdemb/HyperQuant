import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pl as PL } from '../content/pl';
import { en as EN } from '../content/en';

/** Liczby w tekście ćwiczenia „Wybicie na otwarciu NY” muszą wynikać z danych wycinka (public/lessons/2026-10-20-ny.json). */
const slice = JSON.parse(readFileSync(path.join(process.cwd(), 'public/lessons/2026-10-20-ny.json'), 'utf8')) as {
  candles: [number, number, number, number, number, number, unknown, unknown][];
  levels: { pdh: number; pdl: number }[];
};
const at = (hhmm: string) => Date.UTC(2026, 9, 20, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3)));
const range = (from: string, to: string) => {
  const cs = slice.candles.filter((c) => c[0] >= at(from) && c[0] < at(to));
  return { lo: Math.min(...cs.map((c) => c[3])), hi: Math.max(...cs.map((c) => c[2])) };
};
const pl = (x: number) => x.toLocaleString('pl-PL').replace(/ /g, ' ');
const en = (x: number) => x.toLocaleString('en-US');

describe('lekcja ny-breakout: liczby z danych', () => {
  // Poranek od 08:00 UTC (10:00 czasu polskiego, CEST) do otwarcia NY 13:30 UTC (15:30)
  const r = range('08:00', '13:30');
  const ctxPl = PL.exercises['ny-breakout'].checkpoints[0].context;
  const ctxEn = EN.exercises['ny-breakout'].checkpoints[0].context;

  it('zakres poranka w tekście PL i EN jest zakresem świec wycinka', () => {
    expect(ctxPl).toContain(`między ${pl(r.lo)} a ${pl(r.hi)} USD`);
    expect(ctxEn).toContain(`between ${en(r.lo)} and ${en(r.hi)} USD`);
  });

  it('tekst nie twierdzi „od północy”, bo od północy zakres jest szerszy', () => {
    const all = range('00:00', '13:30');
    expect(all.lo).toBeLessThan(r.lo);
    expect(ctxPl).not.toMatch(/od północy/i);
    expect(ctxEn).not.toMatch(/since midnight/i);
  });

  it('PDH w odsłonie jest PDH wycinka', () => {
    const reveal = PL.exercises['ny-breakout'].checkpoints[0].reveal;
    expect(reveal).toContain(`PDH (${pl(slice.levels[0].pdh)})`);
  });
});
