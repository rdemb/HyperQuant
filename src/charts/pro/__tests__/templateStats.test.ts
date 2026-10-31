import { describe, expect, it } from 'vitest';
import type { Candle } from '../hl/parse';
import { DAY } from '../core/time';
import { sessionOpens } from '../core/sessions';
import { MIN_CASES, honestyCard, honestyStats, ibStats, rateText, squeezeStats, statsRowStep, vaStats } from '../chart/templateStats';
import { wilson } from '../../../utils/auction';

const M30 = 30 * 60_000;
const M15 = 15 * 60_000;
const c = (t: number, o: number, h: number, l: number, cl: number): Candle => ({
  t,
  o,
  h,
  l,
  c: cl,
  v: 1,
  n: 1,
});
/** Doba 30m: podane okresy od 00:00 UTC, reszta do 48 płasko przy `rest`. */
const day = (d: number, periods: [number, number, number, number][], rest: number): Candle[] =>
  Array.from({ length: 48 }, (_, i) => {
    const p = periods[i];
    return p ? c(d + i * M30, ...p) : c(d + i * M30, rest, rest + 0.2, rest - 0.2, rest);
  });

// Doba wzorcowa przy wierszu 1 USD: 40 okresów 100–100,9 i 8 okresów 100–104,9 → VA = wiersze 100–101, czyli 100–102
const prevDay = (d: number) =>
  day(
    d,
    Array.from({ length: 48 }, (_, i) => (i < 8 ? [100.5, 104.9, 100, 100.5] : [100.5, 100.9, 100, 100.5])),
    100.5
  );

describe('karta uczciwości: VA doby (reguła Daltona na TPO)', () => {
  // Pary (wzorcowa, badana) przedzielone brakującą dobą, żeby badana nie była poprzednią dla następnej pary
  const cases: [number, number, number, number][][] = [
    // 1. Otwarcie nad VA, powrót (zamknięcia 101,5 i 101), potem dołek 99,5 ≤ VAL → doszło
    [
      [103, 103.5, 102.5, 103],
      [103, 103, 101, 101.5],
      [101.5, 101.8, 100.8, 101],
      [101, 101.2, 99.5, 100],
    ],
    // 2. Nad VA, powrót, bez dojścia do 100
    [
      [103, 103.5, 102.5, 103],
      [103, 103, 101, 101.5],
      [101.5, 101.8, 100.8, 101],
    ],
    // 3. Pod VA, powrót, potem szczyt 102,5 ≥ VAH → doszło
    [
      [99, 99.5, 98.5, 99],
      [99, 100.8, 99, 100.5],
      [100.5, 101, 100.2, 101],
      [101, 102.5, 100.8, 102],
    ],
    // 4. Nad VA bez powrotu (cała doba przy 103)
    [[103, 103.5, 102.5, 103]],
    // 5. Otwarcie w VA
    [[101, 101.2, 100.8, 101]],
    // 6. Nad VA, dołek 99,9 tylko w okresie potwierdzenia, później nie → nie liczy się (bez podglądania)
    [
      [103, 103.5, 102.5, 103],
      [103, 103, 101, 101.5],
      [101.5, 101.8, 99.9, 101],
    ],
  ];
  const rests = [100.5, 101.2, 101.2, 103, 101, 101.2];
  const bars: Candle[] = [];
  let d = 20_000 * DAY;
  cases.forEach((p, i) => {
    bars.push(...prevDay(d), ...day(d + DAY, p, rests[i]));
    d += 3 * DAY;
  });
  // 7. Powrót dopiero w dwóch ostatnich okresach doby: brak czasu po potwierdzeniu
  const late = day(d + DAY, [[103, 103.5, 102.5, 103]], 103);
  late[46] = c(late[46].t, 103, 103, 101, 101.5);
  late[47] = c(late[47].t, 101.5, 101.8, 99, 101);
  bars.push(...prevDay(d), ...late);
  // Świeca bieżąca (niezamknięta) — nie wchodzi do wyniku
  bars.push(c(d + 2 * DAY, 101, 101, 101, 101));

  it('liczy doby, otwarcia poza VA, powroty i dojścia do drugiej krawędzi', () => {
    const s = vaStats(bars, 1);
    expect(s.days).toBe(7);
    expect(s.outside).toBe(6);
    expect(s.filled.n).toBe(4);
    expect(s.filled.k).toBe(2);
  });

  it('pomija dobę poprzednią bez początku o 00:00 UTC i świecę bieżącą', () => {
    const d0 = 20_000 * DAY;
    const prev = prevDay(d0).slice(1);
    const cur = day(d0 + DAY, cases[0], 100.5);
    expect(vaStats([...prev, ...cur, c(d0 + 2 * DAY, 1, 1, 1, 1)], 1).days).toBe(0);
    // Bez świecy następnej doby ostatnia świeca badanej doby jest bieżąca: doba niepełna
    expect(vaStats([...prevDay(d0), ...cur], 1).days).toBe(0);
  });

  it('wiersz z drabiny ticków wykresu: BTC przy 110 tys. → 50 USD', () => {
    expect(statsRowStep(110_000)).toBe(50);
    expect(statsRowStep(0)).toBe(0);
  });
});

describe('karta uczciwości: IB sesji Nowego Jorku', () => {
  // Poniedziałek 6.07.2026 (czas letni: otwarcie NY 13:30 UTC)
  const MON = Date.UTC(2026, 6, 6);
  /** Doba 30m: IB 100–110, potem po jednej świecy z ekstremami reszty sesji. */
  const ibDay = (d: number, restHi: number, restLo: number): Candle[] => {
    const ny = sessionOpens(d)[2];
    return Array.from({ length: 48 }, (_, i) => {
      const t = d + i * M30;
      if (t >= ny && t < ny + 3_600_000) return c(t, 105, 110, 100, 105);
      if (t === ny + 3_600_000) return c(t, 105, restHi, restLo, 105);
      return c(t, 105, 106, 104, 105);
    });
  };

  it('tylko w górę, tylko w dół, obie, wcale; weekend i sesja bieżąca pominięte; mediana wyjścia w zakresach IB', () => {
    const bars = [
      ...ibDay(MON, 115, 101), // w górę o 0,5 IB
      ...ibDay(MON + DAY, 109, 90), // w dół o 1 IB
      ...ibDay(MON + 2 * DAY, 120, 95), // obie, większe 1 IB
      ...ibDay(MON + 3 * DAY, 109, 101), // wcale
      ...ibDay(MON + 4 * DAY, 109, 101), // piątek: wcale
      ...ibDay(MON + 5 * DAY, 130, 101), // sobota: pominięta
      ...ibDay(MON + 6 * DAY, 101, 70), // niedziela: pominięta
      ...ibDay(MON + 7 * DAY, 200, 101).slice(0, 30), // poniedziałek w toku: pominięty
    ];
    const s = ibStats(bars);
    expect(s.sessions).toBe(5);
    expect([s.up.k, s.down.k, s.both.k, s.none.k]).toEqual([1, 1, 1, 2]);
    expect(s.up.n).toBe(5);
    // Wyjścia: 0,5, 1, 1, 0, 0 → mediana 0,5
    expect(s.medianExt).toBeCloseTo(0.5);
  });

  it('luka w sesji wyklucza ją z próby', () => {
    const bars = [...ibDay(MON, 115, 101), ...ibDay(MON + DAY, 115, 101), c(MON + 2 * DAY, 105, 105, 105, 105)];
    bars.splice(40, 1);
    expect(ibStats(bars).sessions).toBe(1);
  });
});

describe('karta uczciwości: ściśnięcie BB w KC', () => {
  /** Cykle: 40 świec ciszy (zamknięcia ±0,1 przy zakresie 2), potem 12 świec trendu (+5 na świecę). */
  const cycles = (k: number): Candle[] => {
    const out: Candle[] = [];
    let px = 1000;
    let t = 20_000 * DAY;
    for (let j = 0; j < k; j++) {
      for (let i = 0; i < 40; i++, t += M15) {
        const cl = px + (i % 2 ? 0.1 : -0.1);
        out.push(c(t, px, px + 1, px - 1, cl));
      }
      for (let i = 0; i < 12; i++, t += M15) {
        out.push(c(t, px, px + 6, px - 1, px + 5));
        px += 5;
      }
    }
    out.push(c(t, px, px, px, px));
    return out;
  };

  it('jedno wyjście na cykl, okno po wyjściu szersze niż typowe', () => {
    const s = squeezeStats(cycles(25));
    expect(s.wider.n).toBe(25);
    expect(s.wider.k).toBe(25);
    expect(s.ratio).toBeGreaterThan(2);
    expect(s.inSqueeze).toBeGreaterThan(0);
    expect(s.inSqueeze).toBeLessThan(s.bars);
  });

  it('brak danych: zera bez błędu', () => {
    const s = squeezeStats([]);
    expect(s.bars).toBe(0);
    expect(s.wider.n).toBe(0);
    expect(Number.isNaN(s.ratio)).toBe(true);
  });
});

describe('karta uczciwości: tekst', () => {
  it('przedział Wilsona 9 z 20 jak w tablicach (25,8–65,8%)', () => {
    const w = wilson(9, 20)!;
    expect(w.lo).toBeCloseTo(0.2582, 3);
    expect(w.hi).toBeCloseTo(0.6579, 3);
    expect(rateText({ k: 9, n: 20, ci: w })).toBe('9 z 20 = 45% (26–66%)');
  });

  it(`poniżej ${MIN_CASES} przypadków: bez odsetka`, () => {
    expect(rateText({ k: 9, n: 19, ci: wilson(9, 19) })).toBe('9 z 19: za mało przypadków');
    const card = honestyCard(honestyStats('ib', []));
    expect(card.rows).toHaveLength(1);
    expect(card.rows[0][1]).toContain('za mało');
  });

  it('brak świec: każda karta daje treść bez wyjątku', () => {
    for (const kind of ['va', 'ib', 'squeeze'] as const) {
      const card = honestyCard(honestyStats(kind, []));
      expect(card.intro.length).toBeGreaterThan(0);
      expect(card.rows.length).toBeGreaterThan(0);
    }
  });
});
