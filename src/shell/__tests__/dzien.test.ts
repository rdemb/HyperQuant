import { describe, expect, it } from 'vitest';
import { dayPhase, fmtSpan, localDaySegments, sessionClock } from '../dzien';

const H = 3_600_000;
// Kilka chwil w roku (zima, lato, dzień zmiany czasu w Europie i USA), także tuż po północy i przed nią
const CHWILE = [Date.UTC(2026, 0, 15, 10, 0), Date.UTC(2026, 6, 1, 23, 30), Date.UTC(2026, 2, 8, 12, 0), Date.UTC(2026, 9, 25, 0, 15), Date.UTC(2026, 10, 14, 15, 7)];

describe('pasek dnia: sesje na osi doby lokalnej', () => {
  it('odcinki pokrywają całą dobę 0–1 bez luk i nakładania, w kolejności', () => {
    for (const t of CHWILE) {
      const s = localDaySegments(t);
      expect(s.length).toBeGreaterThanOrEqual(3);
      expect(s[0].from).toBeCloseTo(0, 9);
      expect(s.at(-1)!.to).toBeGreaterThan(0.95);
      for (let i = 1; i < s.length; i++) expect(s[i].from).toBeCloseTo(s[i - 1].to, 9);
      for (const x of s) {
        expect(x.to).toBeGreaterThan(x.from);
        expect(['asia', 'london', 'ny']).toContain(x.id);
      }
    }
  });

  it('każda sesja dnia jest na osi (Azja, Londyn, Nowy Jork)', () => {
    for (const t of CHWILE) expect(new Set(localDaySegments(t).map((x) => x.id))).toEqual(new Set(['asia', 'london', 'ny']));
  });
});

describe('zegar sesji i faza dnia', () => {
  it('Azja = przed sesją, Londyn = w sesji, Nowy Jork po 16:00 czasu NY = po sesji', () => {
    expect(dayPhase(Date.UTC(2026, 10, 14, 3, 0))).toEqual({ phase: 'before', session: 'asia' });
    expect(dayPhase(Date.UTC(2026, 10, 14, 10, 0))).toEqual({ phase: 'charts', session: 'london' });
    expect(dayPhase(Date.UTC(2026, 10, 14, 16, 0))).toEqual({ phase: 'charts', session: 'ny' });
    // 16:30 czasu NY (EST, UTC−5) = 21:30 UTC
    expect(dayPhase(Date.UTC(2026, 10, 14, 21, 30))).toEqual({ phase: 'after', session: 'ny' });
  });

  it('odliczanie do następnej sesji jest dodatnie i krótsze niż doba', () => {
    for (const t of CHWILE) {
      const c = sessionClock(t);
      expect(c.untilNext).toBeGreaterThan(0);
      expect(c.untilNext).toBeLessThan(24 * H);
      expect(c.next.id).not.toBe(c.current.id);
    }
  });

  it('czas trwania: minuty, potem godziny z minutami', () => {
    expect(fmtSpan(42 * 60_000)).toBe('42 min');
    expect(fmtSpan(86 * 60_000)).toBe('1 h 26 min');
    expect(fmtSpan(-5)).toBe('0 min');
  });
});
