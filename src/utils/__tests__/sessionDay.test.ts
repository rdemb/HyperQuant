import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  currentTradeSession,
  hourlyWindow,
  lastClosedSessions,
  nextTradeSession,
  previousSameSession,
  rangeBudget,
  tradeSessionOn,
} from '../sessionDay';
import { TRADE_SESSION_NAME } from '../sessionNames';

const MIN = 60_000;
const H = 60 * MIN;
const at = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);

describe('sesja handlowa: Londyn i NY z czasem letnim', () => {
  it('2026-11-03 14:31 UTC: po zmianie czasu w USA NY otwiera o 09:30 EST = 14:30 UTC', () => {
    expect(currentTradeSession(at(2026, 11, 3, 14, 31))).toEqual({
      id: 'ny',
      start: at(2026, 11, 3, 14, 30),
      end: at(2026, 11, 4, 0),
      ibEnd: at(2026, 11, 3, 15, 30),
    });
  });

  it('2026-10-27 13:31 UTC: NY jeszcze w EDT (09:30 = 13:30 UTC), choć Londyn już w GMT', () => {
    const s = currentTradeSession(at(2026, 10, 27, 13, 31));
    expect(s?.id).toBe('ny');
    expect(s?.start).toBe(at(2026, 10, 27, 13, 30));
  });

  it('granice w tygodniach rozjazdu czasu: 27.10 13:29 UTC to Londyn; 16.03 (USA już w EDT, Londyn w GMT) 13:29 Londyn, 13:31 NY', () => {
    expect(currentTradeSession(at(2026, 10, 27, 13, 29))?.id).toBe('london');
    expect(currentTradeSession(at(2026, 3, 16, 13, 29))).toMatchObject({ id: 'london', start: at(2026, 3, 16, 8), end: at(2026, 3, 16, 13, 30) });
    expect(currentTradeSession(at(2026, 3, 16, 13, 31))).toMatchObject({ id: 'ny', start: at(2026, 3, 16, 13, 30) });
  });

  it('Londyn od 08:00 czasu londyńskiego do otwarcia NY (zimą 08:00 UTC, latem 07:00 UTC)', () => {
    expect(currentTradeSession(at(2026, 11, 3, 14, 29))).toEqual({ id: 'london', start: at(2026, 11, 3, 8), end: at(2026, 11, 3, 14, 30), ibEnd: at(2026, 11, 3, 9) });
    expect(currentTradeSession(at(2026, 10, 22, 7, 0))).toMatchObject({ id: 'london', start: at(2026, 10, 22, 7), end: at(2026, 10, 22, 13, 30) });
  });

  it('jedna mapa nazw sesji dla panelu i pasa desku', () => {
    expect(TRADE_SESSION_NAME).toEqual({ london: 'Londyn', ny: 'NY' });
  });

  it('sesje i aukcja nie zależą od modułu pobierania danych (marketDataFeed)', () => {
    for (const f of ['../sessionDay.ts', '../auction.ts']) {
      expect(readFileSync(new URL(f, import.meta.url), 'utf8')).not.toMatch(/from '\.\/marketDataFeed'/);
    }
  });

  it('sesja azjatycka (00:00 UTC do otwarcia Londynu) → null', () => {
    expect(currentTradeSession(at(2026, 11, 3, 2))).toBeNull();
    expect(currentTradeSession(at(2026, 11, 3, 0))).toBeNull();
    expect(currentTradeSession(at(2026, 11, 3, 7, 59))).toBeNull();
  });

  it('IB = pierwsza godzina sesji: ibEnd = start + 3 600 000', () => {
    for (const t of [at(2026, 11, 3, 9), at(2026, 11, 3, 20), at(2026, 10, 27, 13, 31), at(2026, 7, 1, 7, 5)]) {
      const s = currentTradeSession(t)!;
      expect(s.ibEnd).toBe(s.start + 3_600_000);
    }
  });
});

describe('zamknięte i sąsiednie sesje', () => {
  it('w Azji: od najstarszej, ostatnia zamknięta = NY poprzedniej doby (także w dniu zmiany czasu w USA)', () => {
    const s = lastClosedSessions(at(2026, 11, 3, 2), 3);
    expect(s.map((x) => [x.id, x.start, x.end])).toEqual([
      ['ny', at(2026, 11, 1, 14, 30), at(2026, 11, 2, 0)],
      ['london', at(2026, 11, 2, 8), at(2026, 11, 2, 14, 30)],
      ['ny', at(2026, 11, 2, 14, 30), at(2026, 11, 3, 0)],
    ]);
  });

  it('sesja w toku się nie liczy; koniec sesji = teraz to sesja zamknięta', () => {
    expect(lastClosedSessions(at(2026, 11, 3, 15), 1).map((x) => [x.id, x.start])).toEqual([['london', at(2026, 11, 3, 8)]]);
    expect(lastClosedSessions(at(2026, 11, 3, 14, 30), 1)[0].id).toBe('london');
    expect(lastClosedSessions(at(2026, 11, 3, 14, 29), 1)[0]).toMatchObject({ id: 'ny', start: at(2026, 11, 2, 14, 30) });
    expect(lastClosedSessions(at(2026, 11, 3, 15), 0)).toEqual([]);
  });

  it('poprzednia sesja tego samego typu: Londyn ← Londyn wczoraj, także przez zmianę czasu w Europie', () => {
    const l = tradeSessionOn(at(2026, 10, 25, 0), 'london'); // 25.10 Londyn już w GMT
    expect(l.start).toBe(at(2026, 10, 25, 8));
    expect(previousSameSession(l)).toEqual({ id: 'london', start: at(2026, 10, 24, 7), end: at(2026, 10, 24, 13, 30), ibEnd: at(2026, 10, 24, 8) });
    expect(previousSameSession(tradeSessionOn(at(2026, 11, 3, 0), 'ny')).start).toBe(at(2026, 11, 2, 14, 30));
  });

  it('najbliższe otwarcie: w Azji Londyn tej doby, w Londynie NY, w NY Londyn jutro', () => {
    expect(nextTradeSession(at(2026, 11, 3, 2))).toMatchObject({ id: 'london', start: at(2026, 11, 3, 8) });
    expect(nextTradeSession(at(2026, 11, 3, 8))).toMatchObject({ id: 'ny', start: at(2026, 11, 3, 14, 30) });
    expect(nextTradeSession(at(2026, 11, 3, 20))).toMatchObject({ id: 'london', start: at(2026, 11, 4, 8) });
  });

  it('okno w świecach 1h: świeca należy do sesji, w której się zaczyna (IB NY = świeca od 10:00 czasu NY)', () => {
    expect(hourlyWindow(tradeSessionOn(at(2026, 11, 3, 0), 'ny'))).toEqual({ start: at(2026, 11, 3, 15), end: at(2026, 11, 4, 0) });
    expect(hourlyWindow(tradeSessionOn(at(2026, 11, 3, 0), 'london'))).toEqual({ start: at(2026, 11, 3, 8), end: at(2026, 11, 3, 15) });
    expect(hourlyWindow(tradeSessionOn(at(2026, 10, 27, 0), 'ny'))).toEqual({ start: at(2026, 10, 27, 14), end: at(2026, 10, 28, 0) });
    expect(hourlyWindow(tradeSessionOn(at(2026, 10, 27, 0), 'london'))).toEqual({ start: at(2026, 10, 27, 8), end: at(2026, 10, 27, 14) });
  });
});

describe('budżet zakresu', () => {
  it('rangeBudget(101, 99, 4) = 0,5; może przekroczyć 1; bez oczekiwanego zakresu NaN', () => {
    expect(rangeBudget(101, 99, 4)).toBe(0.5);
    expect(rangeBudget(110, 100, 4)).toBe(2.5);
    expect(rangeBudget(101, 99, 0)).toBeNaN();
    expect(rangeBudget(Number.NaN, 99, 4)).toBeNaN();
  });
});
