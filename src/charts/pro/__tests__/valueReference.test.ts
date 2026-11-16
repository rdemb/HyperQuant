import { describe, expect, it } from 'vitest';
import { profileLevels } from '../core/pbRanges';
import { type DayTape, TAPE_MIN_SHARE, type ValueBar, valueBadge, valueNote, valuePeriod, valueReference } from '../core/valueReference';

const M5 = 5 * 60_000;
const DAY = 86_400_000;
/** Doba UTC 15.11.2026 (niedziela) i chwila następnego dnia. */
const D = Date.UTC(2026, 10, 15);
const NOW = D + DAY + 3_600_000;

/** Świece 5m doby od `from`: zamknięcie wędruje 100 000 ± 300, zakres 60, wolumen zależny od świecy. */
const day5 = (from = D, n = 288): ValueBar[] =>
  Array.from({ length: n }, (_, i) => {
    const c = 100_000 + 300 * Math.sin(i / 20);
    return { t: from + i * M5, l: c - 30, h: c + 30, v: 1 + (i % 7) };
  });

/** Wiersze taśmy całego wolumenu świecy na jednej cenie `px` (tick 1). */
const rowsAt = (px: number, v: number) => ({ tick: 1, lo: px, buy: [v / 2], sell: [v / 2] });

describe('valueReference: jedno źródło wartości doby i sesji', () => {
  it('bez taśmy: świece 5m rozłożone równo, te same VAH, VAL i POC co profil P/b (`profileLevels`, 5 pb)', () => {
    const b = day5();
    const r = valueReference('day', D, { bars: b, ms: M5 }, NOW)!;
    const p = profileLevels(
      b.map((x) => x.l),
      b.map((x) => x.h),
      b.map((x) => x.v),
      5,
      false
    )!;
    expect(r).toMatchObject({ kind: 'day', from: D, to: D + DAY, source: 'candles', tapeShare: 0, bars: 288, complete: true });
    expect(r.vah).toBeCloseTo(p.vah, 9);
    expect(r.val).toBeCloseTo(p.val, 9);
    expect(r.poc).toBeCloseTo(p.poc, 9);
  });

  it('taśma ≥ 90% wolumenu: profil z cen transakcji (POC na cenie z taśmy), plakietka LIVE', () => {
    // Cały wolumen świec nagrany na jednej cenie 99 900 — świece nie mają tam przewagi
    const b = day5().map((x) => ({ ...x, tape: rowsAt(99_900, x.v) }));
    const r = valueReference('day', D, { bars: b, ms: M5 }, NOW)!;
    expect(r.source).toBe('tape');
    expect(r.tapeShare).toBeCloseTo(1, 9);
    expect(Math.abs(r.poc / 99_900 - 1)).toBeLessThan(5e-4);
    expect(valueBadge(r)).toBe('LIVE');
    expect(valueNote(r)).toBe('taśma 100%');
  });

  it('taśma poniżej 90% wolumenu: przybliżenie ze świec (taśma pominięta), MODEL z udziałem taśmy', () => {
    const plain = day5();
    const b = plain.map((x, i) => (i < 200 ? { ...x, tape: rowsAt(99_900, x.v) } : x));
    const r = valueReference('day', D, { bars: b, ms: M5 }, NOW)!;
    const c = valueReference('day', D, { bars: plain, ms: M5 }, NOW)!;
    expect(r.tapeShare).toBeLessThan(TAPE_MIN_SHARE);
    expect(r.tapeShare).toBeGreaterThan(0.6);
    expect(r).toMatchObject({ source: 'candles', vah: c.vah, val: c.val, poc: c.poc });
    expect(valueBadge(r)).toBe('MODEL');
    expect(valueNote(r)).toMatch(/^przybliżenie, taśma \d+%$/);
  });

  it('zamknięta doba z plikiem taśmy serwera: pokrycie z minut pliku, wiersze z pliku, reszta świecy ze świec', () => {
    const b = day5();
    const minuteVol = new Float64Array(1440);
    // Taśma pokrywa wszystkie minuty poza ostatnią godziną (ok. 96% wolumenu)
    b.forEach((x) => {
      if (x.t < D + 23 * 3_600_000) for (let m = 0; m < 5; m++) minuteVol[(x.t - D) / 60_000 + m] = x.v / 5;
    });
    const covered = b.filter((x) => x.t < D + 23 * 3_600_000).reduce((s, x) => s + x.v, 0);
    const file: DayTape = { day: D, tick: 1, lo: 100_200, buy: [covered / 2], sell: [covered / 2], minuteVol };
    const r = valueReference('day', D, { bars: b, ms: M5, dayTape: (d) => (d === D ? file : null) }, NOW)!;
    expect(r.source).toBe('tape');
    expect(r.tapeShare).toBeGreaterThan(0.9);
    expect(Math.abs(r.poc / 100_200 - 1)).toBeLessThan(5e-4);
    // Doba w toku nie bierze pliku (plik jest tylko dla dób zamkniętych)
    const live = valueReference('day', D, { bars: b, ms: M5, dayTape: () => file }, D + 12 * 3_600_000)!;
    expect(live).toMatchObject({ source: 'candles', complete: false, through: D + 12 * 3_600_000 });
  });

  it('mniej niż 90% świec okresu: null; doba w toku — tylko świece zamknięte do teraz', () => {
    expect(valueReference('day', D, { bars: day5(D, 250), ms: M5 }, NOW)).toBeNull();
    const b = day5(D, 100);
    const now = D + 99 * M5 + 60_000; // setna świeca jeszcze w trakcie
    const r = valueReference('day', now, { bars: b, ms: M5 }, now)!;
    expect(r).toMatchObject({ bars: 99, through: D + 99 * M5, complete: false });
    expect(valueReference('day', D, { bars: b, ms: M5 }, D + 60_000)).toBeNull();
  });

  it('sesja: okres z kalendarza sesji (Londyn od 08:00 czasu Londynu, NY od 09:30 czasu NY), także w tygodniu rozjazdu czasu', () => {
    // Zima: Londyn 08:00 UTC (9:00 w Polsce), NY 14:30 UTC (15:30 w Polsce)
    expect(valuePeriod('session', Date.UTC(2026, 10, 16, 10))).toEqual({ kind: 'session', from: Date.UTC(2026, 10, 16, 8), to: Date.UTC(2026, 10, 16, 14, 30), session: 'london' });
    // 10.03.2026: USA już na czasie letnim, Europa jeszcze nie — NY 13:30 UTC (14:30 w Polsce)
    expect(valuePeriod('session', Date.UTC(2026, 2, 10, 15))).toEqual({ kind: 'session', from: Date.UTC(2026, 2, 10, 13, 30), to: Date.UTC(2026, 2, 11), session: 'ny' });
    // Lato: Londyn 07:00 UTC (9:00 w Polsce)
    expect(valuePeriod('session', Date.UTC(2026, 6, 1, 9)).from).toBe(Date.UTC(2026, 6, 1, 7));
    const ny = valuePeriod('session', Date.UTC(2026, 10, 15, 20));
    const b = day5(ny.from, (ny.to - ny.from) / M5);
    const r = valueReference('session', Date.UTC(2026, 10, 15, 20), { bars: [...day5(D, 100), ...b], ms: M5 }, NOW)!;
    expect(r).toMatchObject({ kind: 'session', session: 'ny', from: ny.from, to: ny.to, bars: b.length });
  });

  it('plakietka: LIVE tylko, gdy wszystkie liczby są z taśmy', () => {
    expect(valueBadge({ source: 'tape' }, { source: 'tape' })).toBe('LIVE');
    expect(valueBadge({ source: 'tape' }, { source: 'candles' })).toBe('MODEL');
    expect(valueBadge()).toBe('MODEL');
  });
});
