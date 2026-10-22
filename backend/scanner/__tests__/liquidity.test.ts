import { describe, expect, it } from 'vitest';
import { LiquidityRecorder, bookSnap, chooseAgg, liquidityProfile, minuteRows, type MinuteRow } from '../liquidity.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 9, 22, 10, 0);
const lv = (px: number, sz: number) => ({ px: String(px), sz: String(sz), n: 1 });

describe('dobór agregacji arkusza do ceny', () => {
  it('najmniejszy koszyk, przy którym 20 poziomów pokrywa ±20 bp (4/5 cyfr znaczących, mantysa 2/5)', () => {
    expect(chooseAgg(81_000)).toEqual({ nSigFigs: 4, bucket: 10 });
    expect(chooseAgg(99_950)).toEqual({ nSigFigs: 4, bucket: 10 });
    expect(chooseAgg(100_000)).toEqual({ nSigFigs: 5, bucket: 10 });
    expect(chooseAgg(120_000)).toEqual({ nSigFigs: 5, mantissa: 2, bucket: 20 });
    expect(chooseAgg(250_000)).toEqual({ nSigFigs: 5, mantissa: 5, bucket: 50 });
    expect(chooseAgg(40_000)).toEqual({ nSigFigs: 5, mantissa: 5, bucket: 5 });
  });
  it('histereza: obecna agregacja zostaje, póki pokrywa pasmo i koszyk ≤ 2× najlepszego', () => {
    expect(chooseAgg(82_000, { nSigFigs: 4 })).toEqual({ nSigFigs: 4, bucket: 10 });
    expect(chooseAgg(101_000, { nSigFigs: 4 })).toEqual({ nSigFigs: 5, mantissa: 2, bucket: 20 }); // $100 — zbyt grube
  });
});

describe('migawka płynności', () => {
  it('koszyk z danych; koszyk na granicy pasma liczony proporcjonalnie; pokrycie ±20 bp sprawdzane', () => {
    // koszyki 10 USD: bid zaokrąglony w dół, ask w górę; środek 100 005, ±10 bp ≈ ±100 USD → dolna granica 99 905
    const s = bookSnap(T0, [
      [lv(99_990, 1), lv(99_980, 0.5), lv(99_950, 2), lv(99_900, 4), lv(99_850, 8), lv(99_790, 16)],
      [lv(100_020, 1), lv(100_100, 3), lv(100_110, 5), lv(100_220, 7)],
    ])!;
    expect(s.bucket).toBe(10);
    expect(s.mid).toBe(100_005);
    const lo = 100_005 * (1 - 10 / 1e4);
    const hi = 100_005 * (1 + 10 / 1e4);
    // bid ±10 bp: 99 990, 99 980, 99 950 w całości; koszyk [99 900, 99 910) częściowo (granica ≈ 99 905)
    expect(s.b10).toBeCloseTo(99_990 + 0.5 * 99_980 + 2 * 99_950 + ((99_910 - lo) / 10) * 4 * 99_900, 6);
    // ask ±10 bp: 100 020, 100 100 w całości; koszyk (100 100, 100 110] częściowo (granica ≈ 100 105)
    expect(s.a10).toBeCloseTo(100_020 + 3 * 100_100 + ((hi - 100_100) / 10) * 5 * 100_110, 6);
    // pokrycie: najgłębszy bid 99 790 (21,5 bp), najwyższy ask 100 220 (21,5 bp) → ±20 bp wiarygodne
    expect(s.b20).not.toBeNull();
    // arkusz zbyt płytki dla ±20 bp → b20/a20 null (bez cichego obcięcia)
    const shallow = bookSnap(T0, [
      [lv(99_990, 1), lv(99_950, 1), lv(99_880, 1)],
      [lv(100_020, 1), lv(100_060, 1), lv(100_130, 1)],
    ])!; // pokrycie ~12,5 bp
    expect(shallow.b10).toBeGreaterThan(0);
    expect(shallow.b20).toBeNull();
    expect(shallow.a20).toBeNull();
    // poniżej 10 bp pokrycia migawka jest bezużyteczna
    expect(bookSnap(T0, [[lv(99_990, 1), lv(99_950, 1)], [lv(100_020, 1), lv(100_060, 1)]])).toBeNull();
    expect(bookSnap(T0, [[], [lv(1, 1)]])).toBeNull();
    expect(bookSnap(T0, [[lv(101, 1)], [lv(100, 1)]])).toBeNull();
  });

  it('wiersze minutowe = mediany migawek (USD w pełnych dolarach); minuta w toku pominięta', () => {
    const snaps = [0, 5_000, 10_000, 61_000].map((dt, i) => ({ t: T0 + dt, mid: 100_000 + i, bucket: 10, b10: 10.4 * (i + 1), a10: 1, b20: i === 1 ? null : 2, a20: 2 }));
    const rows = minuteRows(snaps, T0 + 90_000);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ t: T0, n: 3, b10: 21, mid: 100_001, b20: 2, bk: 10 });
  });
});

const row = (t: number, d10: number, mid = 100_000): MinuteRow => ({ t, n: 12, mid, bk: 10, b10: d10 / 2, a10: d10 / 2, b20: d10, a20: d10 });

describe('profil płynności', () => {
  it('mediana wg godziny UTC z liczbą dni; „teraz” tylko ze świeżej minuty; norma z ≥ 3 innych dni', () => {
    const rows: MinuteRow[] = [];
    for (let d = 3; d >= 1; d--) for (let i = 0; i < 60; i++) rows.push(row(T0 - d * DAY + i * MIN, 1_000_000));
    for (let i = 0; i < 30; i++) rows.push(row(T0 + i * MIN, 500_000));
    const p = liquidityProfile(rows, 'BTC', T0 + 30 * MIN + 30_000);
    expect(p.byHour[10]).toMatchObject({ h: 10, n: 210, days: 4 });
    expect(p.now).toMatchObject({ d10: 500_000, ratio10: 0.5 }); // norma z 3 poprzednich dni (bez dzisiejszego)
    expect(p.last).toBe(T0 + 29 * MIN);
    // rejestrator stoi od 10 min → „teraz” niedostępne (nie udaje bieżącej wartości)
    expect(liquidityProfile(rows, 'BTC', T0 + 40 * MIN).now).toBeNull();
    // za mało dni dla normy → ratio null
    expect(liquidityProfile(rows.slice(120), 'BTC', T0 + 30 * MIN + 30_000).now!.ratio10).toBeNull();
  });

  it('odporność: tylko ciągłe minuty; brak danych przed powrotem = cenzurowane; bez wycofania liczone osobno', () => {
    const base = Array.from({ length: 60 }, (_, i) => row(T0 + i * MIN, 1_000_000));
    const recovered = [...base, row(T0 + 60 * MIN, 200_000, 100_200), row(T0 + 61 * MIN, 300_000, 100_200), row(T0 + 62 * MIN, 900_000, 100_200), row(T0 + 63 * MIN, 900_000, 100_200)];
    expect(liquidityProfile(recovered, 'BTC', T0 + 64 * MIN).resilience).toEqual({ events: 1, medianMin: 2, unrecovered: 0, censored: 0, noDrop: 0 });
    // luka w danych zaraz po zdarzeniu → cenzurowane, nie „bez powrotu”
    const gap = [...base, row(T0 + 60 * MIN, 200_000, 100_200), row(T0 + 120 * MIN, 900_000, 100_200)];
    expect(liquidityProfile(gap, 'BTC', T0 + 121 * MIN).resilience).toMatchObject({ events: 0, censored: 1, unrecovered: 0 });
    // ruch bez wycofania płynności
    const noDrop = [...base, row(T0 + 60 * MIN, 1_000_000, 100_200), row(T0 + 61 * MIN, 1_000_000, 100_200)];
    expect(liquidityProfile(noDrop, 'BTC', T0 + 62 * MIN).resilience).toMatchObject({ events: 0, noDrop: 1, medianMin: null });
  });
});

describe('LiquidityRecorder', () => {
  const book = (mid: number, sz: number) => [[lv(mid - 5, sz), lv(mid - 205, sz)], [lv(mid + 5, sz), lv(mid + 205, sz)]];
  it('zamyka pełne minuty raz (bez duplikatów); minuta w toku czeka', () => {
    const r = new LiquidityRecorder('BTC');
    r.onBook(T0 + 1_000, book(100_000, 1));
    r.onBook(T0 + 30_000, book(100_000, 3));
    r.onBook(T0 + 61_000, book(100_000, 2));
    expect(r.flush(T0 + 90_000).map((x) => x.t)).toEqual([T0]);
    expect(r.flush(T0 + 95_000)).toEqual([]);
    expect(r.flush(T0 + 125_000).map((x) => x.t)).toEqual([T0 + MIN]);
  });
  it('wczytanie stanu: tylko okno 30 dni i poprawne wiersze; profil z datą początku historii', () => {
    const r = new LiquidityRecorder('BTC');
    const old = { ...row(T0 - 40 * DAY, 1), t: T0 - 40 * DAY };
    const recent = row(T0 - 5 * MIN, 20);
    const broken = { t: T0 - 4 * MIN, n: 1, mid: 1 } as unknown as MinuteRow;
    r.load([old, recent, broken], T0);
    const p = r.profile(T0);
    expect(p.minutes).toBe(1);
    expect(p.since).toBe(recent.t);
  });
});
