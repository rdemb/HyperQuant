import { describe, expect, it } from 'vitest';
import {
  MACRO_EVENTS,
  MacroEvent,
  etToUtcMs,
  eventVolMultiplier,
  eventsBetween,
  mergeEvents,
  nextEvent,
} from '../macroCalendar';

const byId = (id: string) => MACRO_EVENTS.find((e) => e.id === id);

describe('etToUtcMs — czas wschodni USA → UTC z poprawnym DST', () => {
  it('EDT (UTC−4) do 1.11.2026 i od 14.03.2027, EST (UTC−5) pomiędzy', () => {
    expect(etToUtcMs(2026, 10, 28, 14, 0)).toBe(Date.UTC(2026, 9, 28, 18, 0));
    expect(etToUtcMs(2026, 10, 31, 8, 30)).toBe(Date.UTC(2026, 9, 31, 12, 30));
    expect(etToUtcMs(2026, 11, 1, 8, 30)).toBe(Date.UTC(2026, 10, 1, 13, 30));
    expect(etToUtcMs(2027, 3, 13, 8, 30)).toBe(Date.UTC(2027, 2, 13, 13, 30));
    expect(etToUtcMs(2027, 3, 14, 8, 30)).toBe(Date.UTC(2027, 2, 14, 12, 30));
  });
});

describe('MACRO_EVENTS — oficjalne daty (Fed, BLS, BEA)', () => {
  it('kluczowe publikacje mają poprawny czas UTC', () => {
    expect(byId('FOMC-2026-10-28')?.timeUtcMs).toBe(Date.UTC(2026, 9, 28, 18, 0));
    expect(byId('CPI-2026-11-10')?.timeUtcMs).toBe(Date.UTC(2026, 10, 10, 13, 30));
    expect(byId('CPI-2027-03-10')?.timeUtcMs).toBe(Date.UTC(2027, 2, 10, 13, 30));
    expect(byId('CPI-2027-04-13')?.timeUtcMs).toBe(Date.UTC(2027, 3, 13, 12, 30));
    expect(byId('NFP-2026-11-06')?.timeUtcMs).toBe(Date.UTC(2026, 10, 6, 13, 30));
    // Zgodne z BEA release_dates.json: "2026-10-29T12:30:00+00:00", "2026-11-25T13:30:00+00:00"
    expect(byId('GDP_PCE-2026-10-29')?.timeUtcMs).toBe(Date.UTC(2026, 9, 29, 12, 30));
    expect(byId('GDP_PCE-2026-11-25')?.timeUtcMs).toBe(Date.UTC(2026, 10, 25, 13, 30));
    expect(byId('FOMC_MIN-2026-12-30')?.timeUtcMs).toBe(Date.UTC(2026, 11, 30, 19, 0));
    expect(byId('FOMC-2027-12-08')?.timeUtcMs).toBe(Date.UTC(2027, 11, 8, 19, 0));
  });

  it('pełny zestaw: 10 decyzji FOMC + minutes, po 8 CPI/NFP/PPI, 9 BEA', () => {
    const count = (k: MacroEvent['kind']) => MACRO_EVENTS.filter((e) => e.kind === k).length;
    expect(count('FOMC')).toBe(11);
    expect(count('CPI')).toBe(8);
    expect(count('NFP')).toBe(8);
    expect(count('PPI')).toBe(8);
    expect(count('GDP_PCE')).toBe(9);
  });

  it('posortowane, unikalne id, każde ze źródłem i linkiem https do oficjalnej strony', () => {
    const ids = new Set(MACRO_EVENTS.map((e) => e.id));
    expect(ids.size).toBe(MACRO_EVENTS.length);
    for (let i = 1; i < MACRO_EVENTS.length; i++) {
      expect(MACRO_EVENTS[i].timeUtcMs).toBeGreaterThanOrEqual(MACRO_EVENTS[i - 1].timeUtcMs);
    }
    for (const e of MACRO_EVENTS) {
      expect(e.source.length).toBeGreaterThan(0);
      expect(e.sourceUrl).toMatch(/^https:\/\/www\.(federalreserve|bls|bea)\.gov\//);
    }
  });
});

describe('nextEvent / eventsBetween', () => {
  it('nextEvent zwraca pierwsze zdarzenie ściśle po chwili „teraz”', () => {
    expect(nextEvent(Date.UTC(2026, 9, 21, 12))?.id).toBe('FOMC-2026-10-28');
    expect(nextEvent(Date.UTC(2026, 9, 28, 18, 0))?.id).toBe('GDP_PCE-2026-10-29');
    expect(nextEvent(Date.UTC(2030, 0, 1))).toBeNull();
  });

  it('eventsBetween zwraca zdarzenia z przedziału (włącznie) w kolejności czasu', () => {
    const ids = eventsBetween(Date.UTC(2026, 10, 1), Date.UTC(2026, 10, 15)).map((e) => e.id);
    expect(ids).toEqual(['NFP-2026-11-06', 'CPI-2026-11-10', 'PPI-2026-11-13']);
    const edge = eventsBetween(Date.UTC(2026, 9, 28, 18), Date.UTC(2026, 9, 28, 18));
    expect(edge.map((e) => e.id)).toEqual(['FOMC-2026-10-28']);
  });
});

describe('eventVolMultiplier — priory mnożnika wariancji', () => {
  it('zawsze ≥ 1 i uporządkowane FOMC > CPI > NFP > PPI', () => {
    const kinds: MacroEvent['kind'][] = ['FOMC', 'CPI', 'NFP', 'PPI', 'GDP_PCE'];
    for (const k of kinds) expect(eventVolMultiplier(k)).toBeGreaterThanOrEqual(1);
    expect(eventVolMultiplier('FOMC')).toBeGreaterThan(eventVolMultiplier('CPI'));
    expect(eventVolMultiplier('CPI')).toBeGreaterThan(eventVolMultiplier('NFP'));
    expect(eventVolMultiplier('NFP')).toBeGreaterThan(eventVolMultiplier('PPI'));
  });

  it('przyjmuje też zdarzenie: protokół FOMC ma własny, mniejszy mnożnik', () => {
    const minutes = byId('FOMC_MIN-2026-12-30')!;
    const decision = byId('FOMC-2026-12-09')!;
    expect(eventVolMultiplier(decision)).toBe(eventVolMultiplier('FOMC'));
    expect(eventVolMultiplier(minutes)).toBeLessThan(eventVolMultiplier('FOMC'));
    expect(eventVolMultiplier(minutes)).toBeGreaterThanOrEqual(1);
    expect(eventVolMultiplier({ ...minutes, volMultiplier: 0.5 })).toBe(1);
  });
});

describe('mergeEvents — uzupełnienie tabeli statycznej datami z BEA', () => {
  it('nie dubluje zdarzeń tego samego rodzaju w tym samym dniu i dokłada nowe', () => {
    const dup: MacroEvent = { ...byId('GDP_PCE-2026-10-29')!, id: 'bea-x', name: 'BEA dup' };
    const july: MacroEvent = {
      id: 'GDP_PCE-2027-07-29',
      kind: 'GDP_PCE',
      name: 'PKB + PCE — BEA',
      timeUtcMs: Date.UTC(2027, 6, 29, 12, 30),
      importance: 'medium',
      source: 'BEA',
      sourceUrl: 'https://www.bea.gov/news/schedule',
    };
    const merged = mergeEvents(MACRO_EVENTS, [dup, july]);
    expect(merged.length).toBe(MACRO_EVENTS.length + 1);
    expect(merged.some((e) => e.id === 'bea-x')).toBe(false);
    expect(merged.some((e) => e.id === 'GDP_PCE-2027-07-29')).toBe(true);
    for (let i = 1; i < merged.length; i++) expect(merged[i].timeUtcMs).toBeGreaterThanOrEqual(merged[i - 1].timeUtcMs);
  });
});
