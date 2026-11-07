import { describe, expect, it } from 'vitest';
import {
  auctionStats,
  extremeTouches,
  newcombeDiff,
  profile,
  sessionVwap,
  sessionsFromHourly,
  todayState,
  wilson,
  type Session,
  type VBar,
} from '../auction';

const H = 3_600_000;
const D = 24 * H;
const T0 = Date.UTC(2026, 9, 1);
const bar = (time: number, low: number, high: number, close = (low + high) / 2, volume = 1, open = close): VBar => ({ time, open, high, low, close, volume });

describe('przedziały ufności', () => {
  it('Wilson: 0/0 → null; 5/10 symetryczny wokół 0.5; granice w [0, 1]', () => {
    expect(wilson(0, 0)).toBeNull();
    const w = wilson(5, 10)!;
    expect(w.p).toBe(0.5);
    expect(w.lo).toBeCloseTo(0.2366, 3);
    expect(w.hi).toBeCloseTo(0.7634, 3);
    expect(wilson(0, 20)!.lo).toBe(0);
    expect(wilson(20, 20)!.hi).toBe(1);
  });
  it('Newcombe (metoda 10): przykład z literatury 56/70 vs 48/80 → [0.0524, 0.3339]', () => {
    const d = newcombeDiff(56, 70, 48, 80)!;
    expect(d.d).toBeCloseTo(0.2, 6);
    expect(d.lo).toBeCloseTo(0.0524, 3);
    expect(d.hi).toBeCloseTo(0.3339, 3);
  });
});

describe('poziomy sesji', () => {
  it('VWAP z ceny typowej ważonej wolumenem; σ ważone; brak wolumenu → null', () => {
    const v = sessionVwap([bar(0, 99, 101, 100, 1), bar(60_000, 101, 103, 102, 3)])!;
    expect(v.vwap).toBeCloseTo((100 * 1 + 102 * 3) / 4, 9);
    expect(v.sd).toBeCloseTo(Math.sqrt((1 * (100 - 101.5) ** 2 + 3 * (102 - 101.5) ** 2) / 4), 9);
    expect(sessionVwap([bar(0, 99, 101, 100, 0)])).toBeNull();
  });
  it('profil: wolumen rozłożony równomiernie w zakresie świecy; POC i VA 70%', () => {
    // 10 jednostek w 100–110, 1 jednostka w 110–150 → POC w 100–110, VA blisko dołu
    const p = profile([bar(0, 100, 110, 105, 10), bar(1, 110, 150, 130, 1)], 10)!;
    expect(p.poc).toBe(105);
    expect(p.val).toBe(100);
    expect(p.vah).toBe(110);
  });
  it('słabe ekstremum: liczba różnych okien z ekstremum w odległości ≤ 0,02%', () => {
    const bars = [bar(0, 99_000, 100_000), bar(H, 99_000, 99_990), bar(2 * H, 98_000, 99_500)];
    const t = extremeTouches(bars, H)!;
    expect(t.high).toBe(100_000);
    expect(t.hiTouches).toBe(2); // 99 990 ≥ 100 000 · (1 − 0,0002) = 99 980
    expect(t.loTouches).toBe(1);
  });
});

/** Sesja 24 świec 1h: zakres [lo, hi] wokół `mid`, z opcjonalną nadpisaną świecą. */
function day(d: number, mid: number, over: Partial<Record<number, Partial<VBar>>> = {}): VBar[] {
  return Array.from({ length: 24 }, (_, h) => ({ ...bar(T0 + d * D + h * H, mid - 50, mid + 50, mid, 10, mid), ...(over[h] ?? {}) }));
}

// 1.10.2026: Londyn w BST (08:00 = 07:00 UTC), NY w EDT (09:30 = 13:30 UTC)
const LON = 7 * H;
const NY = 13.5 * H;
const lonOf = (d: number) => ({ start: T0 + d * D + LON, end: T0 + d * D + NY });
const nyOf = (d: number) => ({ start: T0 + d * D + NY, end: T0 + (d + 1) * D });

describe('doba UTC (podsumowanie) ze świec 1h', () => {
  it('tylko pełne doby (24 świece); IB = pierwsza świeca doby; słabe szczyty z 1h', () => {
    const bars = [...day(0, 100_000, { 5: { high: 100_400 }, 9: { high: 100_395 } }), ...day(1, 100_000).slice(0, 20)];
    const s = sessionsFromHourly(bars, 'utc');
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ id: 'utc', day: T0, start: T0, ibHi: 100_050, ibLo: 99_950, high: 100_400, poorHigh: true, poorLow: true });
  });
});

describe('sesje Londynu i NY ze świec 1h', () => {
  it('świeca należy do sesji, w której się zaczyna; IB = pierwsza świeca sesji (NY: 10:00 czasu NY)', () => {
    const bars = day(0, 100_000, { 7: { high: 100_300 }, 13: { close: 100_020 }, 14: { low: 99_800 }, 23: { close: 99_990 } });
    const lon = sessionsFromHourly(bars, 'london');
    const ny = sessionsFromHourly(bars, 'ny');
    expect(lon).toHaveLength(1);
    expect(lon[0]).toMatchObject({ id: 'london', day: T0, start: T0 + LON, ibHi: 100_300, close: 100_020 });
    expect(lon[0].bars).toHaveLength(7); // 07:00–13:00; świeca 13:00 obejmuje pierwsze 30 min NY
    expect(ny[0]).toMatchObject({ id: 'ny', day: T0, start: T0 + 14 * H, ibLo: 99_800, close: 99_990 });
    expect(ny[0].bars).toHaveLength(10);
  });

  it('zimą (3.11.2026) Londyn 08:00–15:00 UTC, NY od 15:00 UTC (10:00 EST)', () => {
    const d = Date.UTC(2026, 10, 3);
    const bars = Array.from({ length: 24 }, (_, h) => bar(d + h * H, 99_950, 100_050));
    expect(sessionsFromHourly(bars, 'london')[0]).toMatchObject({ start: d + 8 * H });
    expect(sessionsFromHourly(bars, 'london')[0].bars).toHaveLength(7);
    expect(sessionsFromHourly(bars, 'ny')[0]).toMatchObject({ start: d + 15 * H });
    expect(sessionsFromHourly(bars, 'ny')[0].bars).toHaveLength(9);
  });

  it('niepełne okno sesji jest pomijane, pełne innej sesji tej doby zostaje', () => {
    const bars = day(0, 100_000).filter((b) => b.time !== T0 + 10 * H);
    expect(sessionsFromHourly(bars, 'london')).toHaveLength(0);
    expect(sessionsFromHourly(bars, 'ny')).toHaveLength(1);
    expect(sessionsFromHourly(bars, 'utc')).toHaveLength(0);
  });

  it('wybicia IB, reguła 80%, dotknięcia szczytu/dna wg otwarcia — pary tej samej sesji z kolejnych dni', () => {
    const s0 = day(0, 100_000); // Londyn: VA ≈ 99 950–100 050, szczyt 100 050, dno 99 950
    // Londyn dnia 1: otwarcie nad VA (100 200), dwie świece z zamknięciem w VA (09:00, 10:00), potem dotknięcie VAL (12:00)
    const s1 = day(1, 100_200, {
      9: { close: 100_000, low: 99_990, high: 100_210 },
      10: { close: 100_010, low: 99_990, high: 100_040 },
      12: { low: 99_900, high: 100_100, close: 100_000 },
    });
    const sessions = sessionsFromHourly([...s0, ...s1], 'london');
    const st = auctionStats(sessions);
    expect(st.n).toBe(1);
    expect(st.from).toBe(T0 + D);
    expect(st.rule80.all).toMatchObject({ k: 1, n: 1 });
    expect(st.ib.up.n).toBe(1);
    expect(st.pdTouch.above.pdh).toMatchObject({ k: 1, n: 1 });
    expect(st.pdTouch.above.pdl).toMatchObject({ k: 1, n: 1 });
  });

  it('Londyn i NY się nie mieszają: para z różnych sesji nie wchodzi do częstości', () => {
    const lon0 = sessionsFromHourly(day(0, 100_000), 'london')[0];
    const ny1 = sessionsFromHourly(day(1, 100_000), 'ny')[0];
    expect(auctionStats([lon0, ny1]).n).toBe(0);
  });

  it('stan bieżącej sesji: położenie otwarcia względem VA, IB ukończony po godzinie od otwarcia sesji', () => {
    const prev = sessionsFromHourly(day(0, 100_000), 'london')[0] as Session;
    const today = day(1, 100_200).slice(7, 10); // Londyn 07:00, 08:00, 09:00
    today[2] = { ...today[2], high: 100_400 };
    const st = todayState(prev, today, T0 + D + 10 * H, lonOf(1));
    expect(st).toMatchObject({ start: T0 + D + LON, openLoc: 'above', ibDone: true, ibBreak: { up: true, down: false } });
    // szczyt poprzedniej sesji = 100 050: przebity (>) i dotknięty (≥); dno nie
    expect(st).toMatchObject({ pdhBroken: true, pdhTouched: true, pdlBroken: false, pdlTouched: false });
    // przed końcem pierwszej godziny sesji IB nie jest zamknięty
    expect(todayState(prev, today.slice(0, 1), T0 + D + LON + 30 * 60_000, lonOf(1))?.ibDone).toBe(false);
  });

  it('reguła 80% w bieżącej sesji: niedomknięta godzina nie potwierdza powrotu do VA', () => {
    const prev = sessionsFromHourly(day(0, 100_000), 'london')[0] as Session;
    const t = day(1, 100_200).slice(7, 11); // 07:00–10:00
    t[2] = { ...t[2], close: 100_000 };
    t[3] = { ...t[3], close: 100_010 };
    // godzina 10:00 jeszcze trwa → tylko 'armed'
    expect(todayState(prev, t, T0 + D + 10 * H + 10 * 60_000, lonOf(1))?.rule80).toBe('armed');
    // po zamknięciu godziny 10:00 → potwierdzone (bez dotarcia)
    expect(todayState(prev, t, T0 + D + 11 * H, lonOf(1))?.rule80).toBe('triggered');
  });

  it('NY ze świec 1m: IB 13:30–14:30 UTC, godziny reguły 80% liczone od otwarcia sesji, nie od pełnych godzin UTC', () => {
    const prev = sessionsFromHourly(day(0, 100_000), 'ny')[0] as Session;
    const s = nyOf(1);
    const m = Array.from({ length: 120 }, (_, i) => bar(s.start + i * 60_000, 100_195, 100_205, 100_200, 1, 100_200));
    m[45] = { ...m[45], high: 100_260 }; // 14:15 — wciąż IB
    m[59] = { ...m[59], low: 99_995, close: 100_000 }; // 14:29 — zamknięcie 1. godziny sesji w VA
    m[119] = { ...m[119], low: 99_995, close: 100_010 }; // 15:29 — zamknięcie 2. godziny sesji w VA
    const st = todayState(prev, m, s.start + 2 * H, s)!;
    expect(st.ibHi).toBe(100_260);
    expect(st.rule80).toBe('triggered');
    expect(todayState(prev, m.slice(0, 50), s.start + 50 * 60_000, s)?.ibDone).toBe(false);
    expect(todayState(prev, m, s.start + 2 * H - 60_000, s)?.rule80).toBe('armed'); // 2. godzina sesji jeszcze trwa
  });

  it('zamknięta sesja: ostatnia, krótsza „godzina” kończy się z końcem sesji', () => {
    const prev = sessionsFromHourly(day(0, 100_000), 'ny')[0] as Session;
    const s = nyOf(1); // 13:30–24:00: ostatnie okno 23:30–24:00
    const m = Array.from({ length: 630 }, (_, i) => bar(s.start + i * 60_000, 100_195, 100_205, 100_200, 1, 100_200));
    m[599] = { ...m[599], low: 99_995, close: 100_000 }; // 23:29
    m[629] = { ...m[629], low: 99_995, close: 100_010 }; // 23:59
    expect(todayState(prev, m, s.end + 5 * 60_000, s)?.rule80).toBe('triggered');
  });
});
