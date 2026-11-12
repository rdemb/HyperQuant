import { describe, expect, it } from 'vitest';
import type { VBar } from '../auction';
import { rvolHour, rvolSeries } from '../rvol';

const H = 3_600_000;
const DAY = 24 * H;
const T0 = Date.UTC(2026, 0, 1);

/** Typowo 100; `spike` — godzina 14 UTC ostatniej doby ma 2× wolumen. */
const hourly = (days: number, spike = true): VBar[] => {
  const out: VBar[] = [];
  for (let i = 0; i < days * 24; i++) out.push({ time: T0 + i * H, open: 1, high: 1, low: 1, close: 1, volume: spike && i === days * 24 - 10 ? 200 : 100 });
  return out;
};

describe('rvolSeries', () => {
  it('40 dni 1h: godzina 14 UTC ostatniej doby (dzień roboczy) daje 2, reszta 1', () => {
    const bars = hourly(40);
    const r = rvolSeries(bars, H);
    expect(r).toHaveLength(bars.length);
    const last = bars.length - 24;
    expect(r[last + 14]).toBe(2);
    expect(r[last + 3]).toBe(1);
  });
  it('mniej niż 10 dni próby daje null', () => {
    const r = rvolSeries(hourly(9), H);
    expect(r.every((x) => x === null)).toBe(true);
    // 05:00 UTC to północ w NY: 15.01 (czwartek) ma przed sobą 10 dni roboczych (1.01–14.01), 14.01 — dziewięć
    expect(rvolSeries(hourly(15), H)[14 * 24 + 5]).toBe(1);
    expect(rvolSeries(hourly(15), H)[13 * 24 + 5]).toBeNull();
  });
  it('mediana zera daje null', () => {
    const bars = hourly(12).map((b) => ({ ...b, volume: 0 }));
    expect(rvolSeries(bars, H)[11 * 24]).toBeNull();
  });
});

describe('rvolHour', () => {
  it('w połowie godziny z połową typowego wolumenu daje 1', () => {
    const bars = hourly(40, false);
    const start = T0 + 40 * DAY + 15 * H; // wtorek 10.02, 10:00 czasu NY (typowo 100)
    bars.push({ time: start, open: 1, high: 1, low: 1, close: 1, volume: 50 });
    const r = rvolHour(bars, start + H / 2);
    expect(r.n).toBe(20);
    expect(r.value).toBe(1);
  });
  it('za mało dni albo początek godziny — null', () => {
    const bars = hourly(8, false);
    const start = T0 + 8 * DAY;
    bars.push({ time: start, open: 1, high: 1, low: 1, close: 1, volume: 50 });
    expect(rvolHour(bars, start + H / 2).value).toBeNull();
    const b2 = hourly(40, false);
    const s2 = T0 + 40 * DAY + 15 * H;
    b2.push({ time: s2, open: 1, high: 1, low: 1, close: 1, volume: 5 });
    expect(rvolHour(b2, s2 + 60_000).value).toBeNull();
  });
});
