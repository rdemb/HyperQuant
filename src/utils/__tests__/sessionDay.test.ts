import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  currentTradeSession,
  expectedRange,
  hourlyWindow,
  lastClosedSessions,
  nextTradeSession,
  previousSameSession,
  rangeBudget,
  tradeSessionOn,
} from '../sessionDay';
import { TRADE_SESSION_NAME } from '../sessionNames';
import type { VolModel } from '../volatility';
import type { VBar } from '../auction';

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

/** Model ze stałą wariancją godziny `v` (profil płaski, HAR = stała). */
function flatModel(v: number, nextHourStartMs: number, factors: number[] = Array(24).fill(1)): VolModel {
  return {
    builtAt: nextHourStartMs,
    profile: { factors, counts: Array(24).fill(0) },
    har: { coef: [Math.log(v), 0, 0, 0], smear: 1, smearByH: [], n: 0, r2: 0, oos: null, lastY: Array(168).fill(Math.log(v)) },
    residuals: new Float64Array(0),
    jump: null,
    lmJumps: { count: 0, days: 0, maxAbsMovePct: 0 },
    hourlyBars: 0,
    fiveMinBars: 0,
    nextHourStartMs,
  };
}

const K = Math.sqrt(8 / Math.PI);

describe('oczekiwany zakres sesji i budżet', () => {
  const ny = tradeSessionOn(at(2026, 11, 3, 0), 'ny'); // 14:30–24:00 UTC, 570 min
  const now = at(2026, 11, 3, 16, 10);

  it('rangeBudget(101, 99, 4) = 0,5; może przekroczyć 1; bez oczekiwanego zakresu NaN', () => {
    expect(rangeBudget(101, 99, 4)).toBe(0.5);
    expect(rangeBudget(110, 100, 4)).toBe(2.5);
    expect(rangeBudget(101, 99, 0)).toBeNaN();
    expect(rangeBudget(Number.NaN, 99, 4)).toBeNaN();
  });

  it('bez modelu i bez świec → null', () => {
    expect(expectedRange(null, [], ny, now, 100_000)).toBeNull();
  });

  it('HAR, profil płaski: sqrt(8/π) · σ_sesji · cena, σ_sesji² = v · długość sesji w godzinach', () => {
    const v = 1e-5;
    const r = expectedRange(flatModel(v, at(2026, 11, 3, 16)), [], ny, now, 100_000)!;
    expect(r.method).toBe('har');
    expect(r.usd).toBeCloseTo(K * Math.sqrt(v * 9.5) * 100_000, 6);
  });

  // Profil o znanych współczynnikach: 14:00 i 15:00 UTC ×2, 16:00 ×1,5, pozostałe ×1
  const f = Array.from({ length: 24 }, (_, h) => (h === 14 || h === 15 ? 2 : h === 16 ? 1.5 : 1));
  // NY 3.11 (14:30–24:00), płaski poziom HAR v: σ² = v · (0,5·2 + 2 + 1,5 + 7·1) = 11,5 v
  const SEASONAL = 11.5;

  it('HAR, minione godziny sesji (przed pierwszą godziną prognozy) z profilem sezonowym swojej godziny', () => {
    const v = 1e-5;
    // Prognoza od 20:00 — 14:30–20:00 już minęło; poprzednio te godziny dostawały wariancję godziny 20:00 (σ² = 9,5 v)
    const r = expectedRange(flatModel(v, at(2026, 11, 3, 20), f), [], ny, at(2026, 11, 3, 20, 10), 100_000)!;
    expect(r.usd).toBeCloseTo(K * Math.sqrt(SEASONAL * v) * 100_000, 6);
  });

  it('HAR, godziny prognozy zostają z prognozy (tu korekta Duana ×2 od drugiej godziny prognozy)', () => {
    const v = 1e-5;
    const m = flatModel(v, at(2026, 11, 3, 20), f);
    m.har.smearByH = [1, 2];
    // minione 14:30–20:00: v·(1 + 2 + 1,5 + 3) = 7,5 v; 20:00: v; 21:00–23:00: 3 · 2v = 6 v → 14,5 v
    expect(expectedRange(m, [], ny, at(2026, 11, 3, 20, 10), 100_000)!.usd).toBeCloseTo(K * Math.sqrt(14.5 * v) * 100_000, 6);
  });

  it('HAR: wynik nie skacze, gdy pierwsza godzina prognozy przesuwa się o godzinę (płaski poziom HAR)', () => {
    const v = 1e-5;
    const a = expectedRange(flatModel(v, at(2026, 11, 3, 16), f), [], ny, at(2026, 11, 3, 16, 59), 100_000)!.usd;
    const b = expectedRange(flatModel(v, at(2026, 11, 3, 17), f), [], ny, at(2026, 11, 3, 17, 1), 100_000)!.usd;
    expect(b).toBeCloseTo(a, 6);
    expect(a).toBeCloseTo(K * Math.sqrt(SEASONAL * v) * 100_000, 6);
  });

  it('HAR: sesja zamknięta przed pierwszą godziną prognozy (NY oglądana w Azji) — każda godzina z profilu', () => {
    const v = 1e-5;
    const r = expectedRange(flatModel(v, at(2026, 11, 4, 2), f), [], ny, at(2026, 11, 4, 2, 10), 100_000)!;
    expect(r.usd).toBeCloseTo(K * Math.sqrt(SEASONAL * v) * 100_000, 6);
  });

  /** `n` zamkniętych świec 5m kończących się `end` (ln(H/L) = x). */
  const fiveMin = (n: number, end: number, x = 0.002): VBar[] =>
    Array.from({ length: n }, (_, i) => ({ time: end - (n - i) * 5 * MIN, open: 100_000, high: 100_000 * Math.exp(x), low: 100_000, close: 100_000, volume: 1 }));

  it('bez modelu: σ Parkinsona ze świec 5m przeskalowane do długości sesji; świeca w toku pominięta', () => {
    const x = 0.002;
    const bars = fiveMin(60, now, x);
    bars.push({ time: now - 2 * MIN, open: 100_000, high: 120_000, low: 80_000, close: 100_000, volume: 1 }); // trwa jeszcze 3 min
    const r = expectedRange(null, bars, ny, now, 100_000)!;
    expect(r.method).toBe('parkinson');
    const sigma = Math.sqrt(((x * x) / (4 * Math.LN2)) * ((570 * 60) / 300));
    expect(r.usd).toBeCloseTo(K * sigma * 100_000, 6);
  });

  it('bez modelu: co najmniej 12 zamkniętych świec 5m z ostatnich 24 h, inaczej null', () => {
    expect(expectedRange(null, fiveMin(11, now), ny, now, 100_000)).toBeNull();
    expect(expectedRange(null, fiveMin(12, now), ny, now, 100_000)?.method).toBe('parkinson');
    // 12 świec sprzed ponad doby nie wystarcza
    expect(expectedRange(null, fiveMin(12, now - 25 * H), ny, now, 100_000)).toBeNull();
    // 11 świeżych + 1 trwająca → nadal za mało
    expect(expectedRange(null, [...fiveMin(11, now - 5 * MIN), ...fiveMin(1, now + 3 * MIN)], ny, now, 100_000)).toBeNull();
  });

  it('niepoprawna cena albo zerowa zmienność → null', () => {
    expect(expectedRange(flatModel(1e-5, now), [], ny, now, 0)).toBeNull();
    expect(expectedRange(flatModel(1e-5, now), [], ny, now, Number.NaN)).toBeNull();
    expect(expectedRange(null, fiveMin(20, now, 0), ny, now, 100_000)).toBeNull();
  });
});
