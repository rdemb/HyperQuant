import { describe, expect, it } from 'vitest';
import type { DayLevels } from '../core/indicators';
import { DAY } from '../core/time';
import { LEVELS_EVIDENCE, LEVEL_LINES, SESSION_LABELS, SESSION_LINES_MAX, selectDays, selectSessions } from '../chart/levelsSelect';

const H = 3_600_000;
const M30 = 30 * 60_000;
const H4 = 4 * H;
// Piątek 23.10.2026 (Londyn 07:00 UTC, Nowy Jork 13:30 UTC)
const D0 = Date.UTC(2026, 9, 19);
const days: DayLevels[] = Array.from({ length: 5 }, (_, i) => ({ t: D0 + i * DAY, open: 100 + i, pdh: 110 + i, pdl: 90 + i }));
const LAST = D0 + 4 * DAY + 15 * H;

describe('poziomy dnia: które dni (selectDays)', () => {
  it('na interwałach poniżej 4h bieżący i poprzedni dzień; etykiety tylko bieżącego', () => {
    expect(selectDays(days, LAST, M30).map((d) => [d.day.t, d.current])).toEqual([
      [D0 + 3 * DAY, false],
      [D0 + 4 * DAY, true],
    ]);
  });

  it(`od 4h tylko bieżący dzień: ${LEVEL_LINES} linie`, () => {
    const s = selectDays(days, LAST, H4);
    expect(s.map((d) => d.day.t)).toEqual([D0 + 4 * DAY]);
    expect(s.length * LEVEL_LINES).toBe(3);
  });

  it('dzień bez poziomów (brak świecy dziennej) — nic; dni z przyszłości się nie liczą', () => {
    expect(selectDays(days.slice(0, 3), LAST, M30)).toEqual([]);
    const withNext = [...days, { t: D0 + 5 * DAY, open: 1, pdh: 2, pdl: 0 }];
    expect(selectDays(withNext, LAST, M30)).toEqual(selectDays(days, LAST, M30));
  });

  it('wynik nie zależy od głębokości historii', () => {
    expect(selectDays(days.slice(3), LAST, M30)).toEqual(selectDays(days, LAST, M30));
  });
});

describe('linie sesji: bieżąca i poprzednia doba (selectSessions)', () => {
  it(`najwyżej ${SESSION_LINES_MAX} linii, podpis przy ${SESSION_LABELS} ostatnich`, () => {
    const s = selectSessions(LAST);
    expect(s.map((x) => [new Date(x.session.start).toISOString().slice(5, 16), x.label])).toEqual([
      ['10-22T00:00', false],
      ['10-22T07:00', false],
      ['10-22T13:30', false],
      ['10-23T00:00', true],
      ['10-23T07:00', true],
      ['10-23T13:30', true],
    ]);
  });

  it('sesja, która jeszcze się nie zaczęła, nie ma linii', () => {
    const s = selectSessions(D0 + 4 * DAY + 10 * H);
    expect(s.map((x) => new Date(x.session.start).toISOString().slice(5, 16))).toEqual(['10-22T00:00', '10-22T07:00', '10-22T13:30', '10-23T00:00', '10-23T07:00']);
    expect(s.filter((x) => x.label)).toHaveLength(SESSION_LABELS);
  });

  it('opis: wynik sprawdzianu, PL i EN', () => {
    expect(LEVELS_EVIDENCE.pl).toBe('Po dotknięciu PDH albo PDL cena częściej idzie dalej, niż zawraca (odrzucenie 27–33% wobec 45% dla losowego poziomu, 2026 r.).');
    expect(LEVELS_EVIDENCE.en).toContain('27–33% vs 45%');
  });
});
