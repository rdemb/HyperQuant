import { describe, expect, it } from 'vitest';
import { periodStart, sessionAt, sessionOpens, sessionsBetween, tzOffsetMs, utcDayStart, utcWeekStart, zonedToUtc } from '../core/sessions';

const utc = (s: string) => Date.parse(s);

describe('zonedToUtc i tzOffsetMs', () => {
  it('Londyn: BST latem, GMT po 25.10.2026', () => {
    expect(zonedToUtc('Europe/London', 2026, 10, 23, 8, 0)).toBe(utc('2026-10-23T07:00:00Z'));
    expect(zonedToUtc('Europe/London', 2026, 10, 27, 8, 0)).toBe(utc('2026-10-27T08:00:00Z'));
    expect(tzOffsetMs('Europe/London', utc('2026-07-01T12:00:00Z'))).toBe(3_600_000);
  });

  it('Nowy Jork: EDT do 1.11.2026, potem EST', () => {
    expect(zonedToUtc('America/New_York', 2026, 10, 27, 9, 30)).toBe(utc('2026-10-27T13:30:00Z'));
    expect(zonedToUtc('America/New_York', 2026, 11, 3, 9, 30)).toBe(utc('2026-11-03T14:30:00Z'));
  });
});

describe('sesje', () => {
  it('otwarcia w tygodniu, w którym Europa zmieniła czas, a USA jeszcze nie', () => {
    expect(sessionOpens(utc('2026-10-27T00:00:00Z'))).toEqual([
      utc('2026-10-27T00:00:00Z'),
      utc('2026-10-27T08:00:00Z'),
      utc('2026-10-27T13:30:00Z'),
    ]);
  });

  it('sessionAt dzieli dobę UTC na Azję, Londyn i NY', () => {
    expect(sessionAt(utc('2026-01-15T03:00:00Z'))).toEqual({ id: 'asia', start: utc('2026-01-15T00:00:00Z'), end: utc('2026-01-15T08:00:00Z') });
    expect(sessionAt(utc('2026-01-15T08:00:00Z')).id).toBe('london');
    expect(sessionAt(utc('2026-01-15T14:29:59Z')).id).toBe('london');
    expect(sessionAt(utc('2026-01-15T14:30:00Z'))).toEqual({ id: 'ny', start: utc('2026-01-15T14:30:00Z'), end: utc('2026-01-16T00:00:00Z') });
    expect(sessionAt(utc('2026-07-15T07:00:00Z')).id).toBe('london');
  });

  it('sessionsBetween zwraca kolejne sąsiednie sesje', () => {
    const s = sessionsBetween(utc('2026-01-15T07:00:00Z'), utc('2026-01-16T01:00:00Z'));
    expect(s.map((x) => x.id)).toEqual(['asia', 'london', 'ny', 'asia']);
    for (let i = 1; i < s.length; i++) expect(s[i].start).toBe(s[i - 1].end);
  });
});

describe('okresy resetu', () => {
  it('doba i tydzień w UTC (tydzień od poniedziałku)', () => {
    const t = utc('2026-10-24T15:00:00Z'); // sobota
    expect(utcDayStart(t)).toBe(utc('2026-10-24T00:00:00Z'));
    expect(utcWeekStart(t)).toBe(utc('2026-10-19T00:00:00Z'));
    expect(periodStart(t, 'week')).toBe(utc('2026-10-19T00:00:00Z'));
    expect(periodStart(t, 'none')).toBe(Number.NEGATIVE_INFINITY);
    expect(periodStart(t, 'session')).toBe(utc('2026-10-24T13:30:00Z'));
  });
});
