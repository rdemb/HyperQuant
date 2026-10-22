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

describe('sesje i statystyki z 1h', () => {
  it('tylko pełne sesje (24 świece); IB = pierwsza świeca; słabe szczyty z 1h', () => {
    const bars = [...day(0, 100_000, { 5: { high: 100_400 }, 9: { high: 100_395 } }), ...day(1, 100_000).slice(0, 20)];
    const s = sessionsFromHourly(bars);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ day: T0, ibHi: 100_050, ibLo: 99_950, high: 100_400, poorHigh: true, poorLow: true });
  });

  it('wybicia IB, reguła 80%, dotknięcia PDH/PDL wg otwarcia — liczone z sesji', () => {
    const s0 = day(0, 100_000); // VA ≈ 99 950–100 050, PDH 100 050, PDL 99 950
    // Sesja 1: otwarcie nad VA (100 200), powrót: dwie świece z zamknięciem w VA (h 2, 3), potem dotknięcie VAL (h 6)
    const s1 = day(1, 100_200, {
      2: { close: 100_000, low: 99_990, high: 100_210 },
      3: { close: 100_010, low: 99_990, high: 100_040 },
      6: { low: 99_900, high: 100_100, close: 100_000 },
    });
    const sessions = sessionsFromHourly([...s0, ...s1]);
    const st = auctionStats(sessions);
    expect(st.n).toBe(1);
    expect(st.rule80.all).toMatchObject({ k: 1, n: 1 });
    expect(st.ib.up.n).toBe(1);
    expect(st.pdTouch.above.pdh).toMatchObject({ k: 1, n: 1 });
    expect(st.pdTouch.above.pdl).toMatchObject({ k: 1, n: 1 });
  });

  it('stan bieżącej sesji: położenie otwarcia względem VA, IB ukończony i wybity', () => {
    const prev = sessionsFromHourly(day(0, 100_000))[0] as Session;
    const today = day(1, 100_200).slice(0, 3);
    today[2] = { ...today[2], high: 100_400 };
    const st = todayState(prev, today, T0 + D + 3 * H);
    expect(st).toMatchObject({ openLoc: 'above', ibDone: true, ibBreak: { up: true, down: false } });
    // PDH = 100 050: przebity (>) i dotknięty (≥); PDL nie
    expect(st).toMatchObject({ pdhBroken: true, pdhTouched: true, pdlBroken: false, pdlTouched: false });
    // przed końcem pierwszej godziny IB nie jest zamknięty
    expect(todayState(prev, today.slice(0, 1), T0 + D + 30 * 60_000)?.ibDone).toBe(false);
  });

  it('reguła 80% w bieżącej sesji: niedomknięta godzina nie potwierdza powrotu do VA', () => {
    const prev = sessionsFromHourly(day(0, 100_000))[0] as Session;
    const t = day(1, 100_200).slice(0, 4);
    t[2] = { ...t[2], close: 100_000 };
    t[3] = { ...t[3], close: 100_010 };
    // godzina 3 jeszcze trwa → tylko 'armed'
    expect(todayState(prev, t, T0 + D + 3 * H + 10 * 60_000)?.rule80).toBe('armed');
    // po zamknięciu godziny 3 → potwierdzone (bez dotarcia)
    expect(todayState(prev, t, T0 + D + 4 * H)?.rule80).toBe('triggered');
  });
});
