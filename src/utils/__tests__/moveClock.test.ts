import { describe, expect, it } from 'vitest';
import { clockHours, clockSeason, clockTerciles, moveLevelOf, nearestHour } from '../moveClock';

/**
 * Zegar ruchu przed awansem kalibracji: najbliższa godzina (okno prognozy kota) jako poziom bez procentu — tercyl `pBig`
 * w rozstrzygniętych prognozach z 14 dni; godziny 2–24 jako baza sezonowa (częstość dużego ruchu tej godziny UTC z 20
 * ostatnich dni tego samego typu).
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 12, 9, 20); // czwartek

describe('clockTerciles: tercyle pBig z rozstrzygniętych prognoz z 14 dni', () => {
  it('kwantyle 1/3 i 2/3 (interpolacja liniowa), tylko 14 dni, od 96 prognoz', () => {
    const rows = Array.from({ length: 301 }, (_, i) => ({ t: NOW - 13 * DAY + i * 15 * MIN, pBig: i / 300 }));
    const old = { t: NOW - 15 * DAY, pBig: 0.99 };
    const t = clockTerciles([...rows, old], NOW)!;
    expect(t.n).toBe(301);
    expect(t.q1).toBeCloseTo(1 / 3, 9);
    expect(t.q2).toBeCloseTo(2 / 3, 9);
    expect(clockTerciles(rows.slice(0, 95), NOW)).toBeNull();
  });

  it('poziom: dolny tercyl spokojny, środkowy zwykły, górny podwyższony', () => {
    const t = { q1: 0.3, q2: 0.6, n: 200 };
    expect([moveLevelOf(0.1, t), moveLevelOf(0.45, t), moveLevelOf(0.6, t)]).toEqual(['calm', 'typical', 'elevated']);
  });
});

describe('clockSeason: baza sezonowa z pełnych godzin kota', () => {
  it('20 ostatnich dni tego samego typu przed dzisiejszą dobą UTC, osobno dni robocze i weekend', () => {
    const hours = new Map<number, 0 | 1>();
    const today = Math.floor(NOW / DAY) * DAY;
    for (let d = 1; d <= 80; d++) {
      const day = today - d * DAY;
      const we = [0, 6].includes(new Date(day).getUTCDay());
      // Godzina 14 UTC: w dni robocze duży ruch zawsze, w weekend nigdy; godzina 3: co drugi dzień
      hours.set(day + 14 * HOUR, we ? 0 : 1);
      hours.set(day + 3 * HOUR, d % 2 ? 1 : 0);
    }
    hours.set(today + 14 * HOUR, 0); // dzisiejsza doba nie wchodzi
    const s = clockSeason(hours, NOW);
    expect(s.weekday[14]).toEqual({ k: 20, n: 20 });
    expect(s.weekend[14]).toEqual({ k: 0, n: 20 });
    expect(s.weekday[5]).toEqual({ k: 0, n: 0 });
    expect(s.weekday[3].n).toBe(20);
  });
});

describe('clockHours i nearestHour', () => {
  const season = { weekday: Array.from({ length: 24 }, (_, h) => ({ k: h, n: 20 })), weekend: Array.from({ length: 24 }, () => ({ k: 1, n: 20 })) };

  it('godziny 2–24: 23 pełne godziny po oknie najbliższej godziny, typ dnia według doby UTC tej godziny', () => {
    const hs = clockHours(season, NOW);
    expect(hs).toHaveLength(23);
    expect(hs[0]).toEqual({ hour: Date.UTC(2026, 10, 12, 11), weekend: false, k: 11, n: 20 });
    expect(hs[22].hour).toBe(Date.UTC(2026, 10, 13, 9));
    // Piątek po północy UTC jest dniem roboczym; sobota — weekend
    const fri = clockHours(season, Date.UTC(2026, 10, 13, 23, 10));
    expect(fri.find((h) => h.hour === Date.UTC(2026, 10, 14, 1))).toMatchObject({ weekend: true, k: 1 });
  });

  it('najbliższa godzina z ostatniej prognozy kota: poziom z tercyli, okno t do t + 60 min; za stara albo bez tercyli — brak z kodem powodu', () => {
    const terciles = { q1: 0.3, q2: 0.6, n: 400 };
    expect(nearestHour({ t: NOW - 10 * MIN, pBig: 0.7 }, terciles, NOW)).toEqual({ from: NOW - 10 * MIN, to: NOW + 50 * MIN, level: 'elevated', n: 400 });
    expect(nearestHour({ t: NOW - 50 * MIN, pBig: 0.7 }, terciles, NOW)).toEqual({ missing: 'stale' });
    expect(nearestHour(null, terciles, NOW)).toEqual({ missing: 'no-forecast' });
    expect(nearestHour({ t: NOW - 10 * MIN, pBig: 0.7 }, null, NOW)).toEqual({ missing: 'few' });
  });
});
