import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NYSE_CALENDAR, type NyseCalendar, isNyseCalendar, nyClock, wallStreetAt, wallStreetCell, wallStreetText } from '../wallStreet';

/** Chwila z czasu UTC (miesiąc od 1). */
const utc = (y: number, mo: number, d: number, h: number, mi: number) => Date.UTC(y, mo - 1, d, h, mi);
const cal = NYSE_CALENDAR!;

describe('kalendarz NYSE z repozytorium', () => {
  it('plik ma poprawny format, źródło NYSE, datę odczytu i lata 2026–2028', () => {
    expect(cal).not.toBeNull();
    expect(cal.source).toBe('https://www.nyse.com/markets/hours-calendars');
    expect(cal.readAt).toBe('2026-11-13');
    expect([cal.open, cal.close]).toEqual(['09:30', '16:00']);
    expect(Object.keys(cal.years)).toEqual(['2026', '2027', '2028']);
  });

  it('daty z oficjalnej strony: święta po 10 (2028 bez Nowego Roku, bo 1.01 to sobota), sesje skrócone o 13:00', () => {
    expect(cal.years['2026'].holidays).toHaveLength(10);
    expect(cal.years['2027'].holidays).toHaveLength(10);
    expect(cal.years['2028'].holidays).toHaveLength(9);
    expect(cal.years['2028'].holidays.some((h) => h.date.endsWith('-01-01'))).toBe(false);
    expect(cal.years['2026'].earlyCloses).toEqual([
      { date: '2026-11-27', close: '13:00' },
      { date: '2026-12-24', close: '13:00' },
    ]);
    expect(cal.years['2027'].earlyCloses).toEqual([{ date: '2027-11-26', close: '13:00' }]);
    expect(cal.years['2028'].earlyCloses.map((e) => e.date)).toEqual(['2028-07-03', '2028-11-24']);
    expect(cal.years['2027'].holidays.find((h) => h.date === '2027-12-24')?.name).toMatch(/Christmas/);
  });

  it('każda data to dzień roboczy, rosnąco, bez powtórzeń', () => {
    for (const y of Object.values(cal.years)) {
      const dates = [...y.holidays.map((h) => h.date), ...y.earlyCloses.map((e) => e.date)];
      expect(new Set(dates).size).toBe(dates.length);
      for (const list of [y.holidays.map((h) => h.date), y.earlyCloses.map((e) => e.date)]) expect([...list].sort()).toEqual(list);
      for (const d of dates) expect([1, 2, 3, 4, 5], d).toContain(new Date(`${d}T12:00:00Z`).getUTCDay());
    }
  });

  it('strażnik formatu: zła strefa, zła godzina albo data spoza roku → odrzucony', () => {
    const raw = JSON.parse(readFileSync(new URL('../../data/nyseCalendar.json', import.meta.url), 'utf8'));
    expect(isNyseCalendar(raw)).toBe(true);
    expect(isNyseCalendar({ ...raw, timeZone: 'Europe/Warsaw' })).toBe(false);
    expect(isNyseCalendar({ ...raw, close: '4pm' })).toBe(false);
    expect(isNyseCalendar({ ...raw, years: { 2026: { holidays: [{ date: '2025-12-25', name: 'x' }], earlyCloses: [] } } })).toBe(false);
    expect(isNyseCalendar(null)).toBe(false);
  });
});

describe('Wall Street otwarta / zamknięta: granice sesji', () => {
  it('09:29 i 09:30, 15:59 i 16:00 czasu Nowego Jorku (poniedziałek 16.11.2026, czas zimowy EST = UTC−5)', () => {
    expect(nyClock(utc(2026, 11, 16, 14, 29))).toEqual({ date: '2026-11-16', minute: 9 * 60 + 29, weekday: 1 });
    expect(wallStreetAt(utc(2026, 11, 16, 14, 29), cal)).toEqual({ state: 'closed', why: 'before-open' });
    expect(wallStreetAt(utc(2026, 11, 16, 14, 30), cal)).toEqual({ state: 'open', closesAt: '16:00', early: false });
    expect(wallStreetAt(utc(2026, 11, 16, 20, 59), cal).state).toBe('open');
    expect(wallStreetAt(utc(2026, 11, 16, 21, 0), cal)).toEqual({ state: 'closed', why: 'after-close' });
  });

  it('zmiana czasu w USA (8.03.2026) przed Europą (29.03.2026): w tygodniu 9–13.03 otwarcie o 13:30 UTC, tydzień wcześniej o 14:30 UTC', () => {
    // Piątek 6.03: EST (UTC−5)
    expect(wallStreetAt(utc(2026, 3, 6, 14, 29), cal).state).toBe('closed');
    expect(wallStreetAt(utc(2026, 3, 6, 14, 30), cal).state).toBe('open');
    // Poniedziałek 9.03: EDT (UTC−4), Warszawa jeszcze w czasie zimowym (różnica z Warszawą 5 h zamiast 6)
    expect(wallStreetAt(utc(2026, 3, 9, 13, 29), cal).state).toBe('closed');
    expect(wallStreetAt(utc(2026, 3, 9, 13, 30), cal).state).toBe('open');
    expect(wallStreetAt(utc(2026, 3, 9, 19, 59), cal).state).toBe('open');
    expect(wallStreetAt(utc(2026, 3, 9, 20, 0), cal).state).toBe('closed');
  });

  it('zmiana czasu w Europie (25.10.2026) przed USA (1.11.2026): w tygodniu 26–30.10 nadal 13:30–20:00 UTC, od 2.11 14:30–21:00 UTC', () => {
    expect(wallStreetAt(utc(2026, 10, 26, 13, 29), cal).state).toBe('closed');
    expect(wallStreetAt(utc(2026, 10, 26, 13, 30), cal).state).toBe('open');
    expect(wallStreetAt(utc(2026, 10, 26, 19, 59), cal).state).toBe('open');
    expect(wallStreetAt(utc(2026, 10, 26, 20, 0), cal).state).toBe('closed');
    expect(wallStreetAt(utc(2026, 11, 2, 14, 29), cal).state).toBe('closed');
    expect(wallStreetAt(utc(2026, 11, 2, 14, 30), cal).state).toBe('open');
    expect(wallStreetAt(utc(2026, 11, 2, 20, 59), cal).state).toBe('open');
    expect(wallStreetAt(utc(2026, 11, 2, 21, 0), cal).state).toBe('closed');
  });

  it('weekend: zamknięta (sobota 14.11.2026 w południe NY)', () => {
    expect(wallStreetAt(utc(2026, 11, 14, 17, 0), cal)).toEqual({ state: 'closed', why: 'weekend' });
  });

  it('święto: Thanksgiving 26.11.2026 w południe NY — zamknięta z nazwą święta', () => {
    expect(wallStreetAt(utc(2026, 11, 26, 17, 0), cal)).toEqual({ state: 'closed', why: 'holiday', holiday: 'Thanksgiving Day' });
    expect(wallStreetText(wallStreetAt(utc(2026, 11, 26, 17, 0), cal), cal)).toEqual({ label: 'zamknięta', note: 'święto: Thanksgiving Day' });
  });

  it('sesja skrócona: 27.11.2026 otwarta do 12:59 NY, od 13:00 zamknięta', () => {
    expect(wallStreetAt(utc(2026, 11, 27, 17, 59), cal)).toEqual({ state: 'open', closesAt: '13:00', early: true });
    expect(wallStreetAt(utc(2026, 11, 27, 18, 0), cal)).toEqual({ state: 'closed', why: 'after-close', closedAt: '13:00' });
    expect(wallStreetText(wallStreetAt(utc(2026, 11, 27, 17, 59), cal), cal).note).toBe('sesja skrócona do 13:00 czasu NY');
  });

  it('dzień w Nowym Jorku, nie w UTC: 1.01.2027 01:00 UTC to jeszcze 31.12.2026 wieczorem w NY (po zamknięciu)', () => {
    expect(nyClock(utc(2027, 1, 1, 1, 0)).date).toBe('2026-12-31');
    expect(wallStreetAt(utc(2027, 1, 1, 1, 0), cal)).toEqual({ state: 'closed', why: 'after-close' });
    expect(wallStreetAt(utc(2027, 1, 1, 17, 0), cal)).toEqual({ state: 'closed', why: 'holiday', holiday: "New Year's Day" });
  });

  it('komórka tabeli: etykieta tylko dla akcji i indeksów; krypto, inna klasa i rynek bez klasy — „—” z powodem', () => {
    const open = wallStreetAt(utc(2026, 11, 16, 15, 0), cal);
    expect(wallStreetCell({ dex: 'xyz', class: 'equity' }, open, cal)).toEqual({ label: 'otwarta', note: 'do 16:00 czasu NY', why: null });
    expect(wallStreetCell({ dex: 'xyz', class: 'index' }, open, cal).label).toBe('otwarta');
    expect(wallStreetCell({ dex: 'xyz', class: 'commodity' }, open, cal)).toEqual({ label: '—', note: null, why: 'etykieta tylko dla akcji i indeksów' });
    expect(wallStreetCell({ dex: '' }, open, cal).why).toBe('rynek krypto, bez giełdy bazowej');
    expect(wallStreetCell({ dex: 'xyz' }, open, cal).why).toMatch(/^rejestr nie podaje jeszcze klasy rynku/);
    const none = wallStreetAt(utc(2029, 1, 3, 15, 0), cal);
    expect(wallStreetCell({ dex: 'xyz', class: 'equity' }, none, cal)).toEqual({ label: '—', note: 'brak kalendarza NYSE na rok 2029', why: null });
  });

  it('brak kalendarza na rok: „—” z powodem, bez zgadywania (2029 poza plikiem, pusty plik)', () => {
    expect(wallStreetAt(utc(2029, 1, 3, 15, 0), cal)).toEqual({ state: 'unknown', why: 'no-calendar', year: '2029' });
    expect(wallStreetText(wallStreetAt(utc(2029, 1, 3, 15, 0), cal), cal)).toEqual({ label: '—', note: 'brak kalendarza NYSE na rok 2029' });
    const empty: NyseCalendar = { ...cal, years: {} };
    expect(wallStreetAt(utc(2026, 11, 16, 15, 0), empty).state).toBe('unknown');
    expect(wallStreetAt(utc(2026, 11, 16, 15, 0), null).state).toBe('unknown');
  });
});
