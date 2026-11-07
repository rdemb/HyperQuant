import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapKind } from '../../../scripts/blog/build.mjs';
import { mapWindow, minutesCovered, settleLevels, settleRange } from '../mapSettlement';
import { tradeSessionOn } from '../sessionDay';
import type { VBar } from '../auction';

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 6, 9, 0);
const bar = (i: number, low: number, high: number): VBar => ({ time: T0 + i * MIN, open: low, high, low, close: high, volume: 1 });

describe('settleLevels', () => {
  const levels = [
    { label: 'A', price: 100 },
    { label: 'B', price: 110 },
    { label: 'C', price: 150 },
  ];
  it('zwraca minutę pierwszego dotknięcia, a poziom poza zakresem null', () => {
    const bars = [bar(0, 90, 99), bar(1, 95, 101), bar(2, 105, 112), bar(3, 100, 111)];
    const r = settleLevels(levels, bars, T0, T0 + 10 * MIN);
    expect(r.map((x) => x.touchedAt)).toEqual([T0 + MIN, T0 + 2 * MIN, null]);
    expect(r[0]).toMatchObject({ label: 'A', price: 100 });
  });
  it('okno jest [from, to): świeca o `to` nie liczy się, o `from` tak', () => {
    const bars = [bar(0, 100, 100), bar(5, 110, 110)];
    const r = settleLevels(levels, bars, T0, T0 + 5 * MIN);
    expect(r.map((x) => x.touchedAt)).toEqual([T0, null, null]);
  });
  it('pusta lista świec daje same null', () => {
    expect(settleLevels(levels, [], T0, T0 + MIN).every((x) => x.touchedAt === null)).toBe(true);
  });
  it('świece niekolejne i z nieskończonością nie psują wyniku', () => {
    const bars = [bar(3, 100, 100), bar(1, 100, 100), { ...bar(0, 100, 100), low: NaN }];
    expect(settleLevels(levels, bars, T0, T0 + 10 * MIN)[0].touchedAt).toBe(T0 + MIN);
  });
});

describe('settleRange: wspólna uczciwa reguła wykresu i Rozliczenia doby', () => {
  const levels = [
    { label: 'A', price: 100 },
    { label: 'B', price: 150 },
  ];
  /** Minuty od T0 przez `n` minut w zakresie 90–101 (A dotknięty w pierwszej). */
  const run = (n: number, from = T0) => Array.from({ length: n }, (_, i): VBar => ({ time: from + i * MIN, open: 90, high: 101, low: 90, close: 95, volume: 1 }));

  it('świece każdej pełnej minuty do min(now, to): pełne rozliczenie; bieżąca niepełna minuta nie jest wymagana', () => {
    const r = settleRange(levels, run(30), T0, T0 + 60 * MIN, T0 + 29 * MIN + 20_000);
    expect(r).toEqual({ levels: [{ label: 'A', price: 100, touchedAt: T0 }, { label: 'B', price: 150, touchedAt: null }], complete: true });
  });

  it('luka w środku albo świece kończące się przed chwilą: dotknięcia znalezione zostają, rozliczenie niepełne', () => {
    const gap = run(30).filter((b) => b.time < T0 + 10 * MIN || b.time >= T0 + 12 * MIN);
    expect(settleRange(levels, gap, T0, T0 + 60 * MIN, T0 + 29 * MIN + 20_000)).toMatchObject({ complete: false, levels: [{ touchedAt: T0 }, { touchedAt: null }] });
    expect(settleRange(levels, run(10), T0, T0 + 60 * MIN, T0 + 29 * MIN)?.complete).toBe(false);
  });

  it('początek okresu w środku minuty (wpis o 09:00:20): pierwsza potrzebna świeca to 09:01; świece niesięgające jej — null', () => {
    const from = T0 + 20_000;
    expect(settleRange(levels, run(29, T0 + MIN), from, T0 + 60 * MIN, T0 + 30 * MIN)?.complete).toBe(true);
    // Świeca 09:00 zaczęła się przed wpisem: dotknięcie w niej się nie liczy
    expect(settleRange(levels, run(30), from, T0 + 60 * MIN, T0 + 30 * MIN)?.levels[0].touchedAt).toBe(T0 + MIN);
    expect(settleRange(levels, run(29, T0 + 2 * MIN), from, T0 + 60 * MIN, T0 + 30 * MIN)).toBeNull();
    expect(settleRange(levels, [], from, T0 + 60 * MIN, T0 + 30 * MIN)).toBeNull();
  });

  it('świece po chwili `now` (powtórka) i po końcu okresu się nie liczą', () => {
    const late = run(30).map((b) => (b.time === T0 + 20 * MIN ? { ...b, high: 160 } : b));
    expect(settleRange(levels, late, T0, T0 + 60 * MIN, T0 + 15 * MIN)?.levels[1].touchedAt).toBeNull();
    expect(settleRange(levels, late, T0, T0 + 20 * MIN, T0 + 30 * MIN)?.levels[1].touchedAt).toBeNull();
    expect(settleRange(levels, late, T0, T0 + 21 * MIN, T0 + 30 * MIN)?.levels[1].touchedAt).toBe(T0 + 20 * MIN);
  });

  it('minutesCovered: każda minuta od start do last włącznie', () => {
    expect(minutesCovered(run(5), T0, T0 + 4 * MIN)).toBe(true);
    expect(minutesCovered(run(5), T0, T0 + 5 * MIN)).toBe(false);
    expect(minutesCovered(run(5).filter((b) => b.time !== T0 + 2 * MIN), T0, T0 + 4 * MIN)).toBe(false);
    // Pusty przedział (last przed start) jest pokryty
    expect(minutesCovered([], T0, T0 - MIN)).toBe(true);
  });
});

describe('mapWindow', () => {
  const day = Date.UTC(2026, 10, 6);
  const london = tradeSessionOn(day, 'london');
  const ny = tradeSessionOn(day, 'ny');
  it('Mapa dnia opublikowana w Azji albo Londynie trwa do końca sesji NY tej doby', () => {
    const asia = day + 5 * 3600_000;
    expect(mapWindow('dzien', asia)).toEqual({ from: asia, to: ny.end });
    expect(mapWindow('dzien', london.start + 5 * MIN)).toEqual({ from: london.start + 5 * MIN, to: ny.end });
  });
  it('aktualizacja w Londynie kończy się z sesją Londynu, w NY z sesją NY', () => {
    expect(mapWindow('aktualizacja', london.start + 3600_000)?.to).toBe(london.end);
    expect(mapWindow('aktualizacja', ny.start + 3600_000)?.to).toBe(ny.end);
  });
  it('„Otwarcie” opublikowane w Azji obejmuje najbliższą sesję Londynu', () => {
    const asia = day + 2 * 3600_000;
    expect(mapWindow('otwarcie', asia)).toEqual({ from: asia, to: london.end });
  });
  it('Mapa przed NY trwa do końca sesji NY, opublikowana w Azji, Londynie albo NY', () => {
    for (const t of [day + 2 * 3600_000, london.start + 3600_000, ny.start + 3600_000]) expect(mapWindow('ny', t)).toEqual({ from: t, to: ny.end });
  });
});

describe('mapWindow: czas letni i inne', () => {
  it('tydzień po zmianie czasu w Europie, przed zmianą w USA (25.10–1.11): NY otwiera 13:30 UTC, Londyn kończy 13:30', () => {
    const day = Date.UTC(2026, 9, 28);
    const london = tradeSessionOn(day, 'london');
    expect(london.end).toBe(day + 13.5 * 3600_000);
    const t = london.start + 3600_000;
    expect(mapWindow('aktualizacja', t)).toEqual({ from: t, to: day + 13.5 * 3600_000 });
    expect(mapWindow('ny', t)).toEqual({ from: t, to: day + 24 * 3600_000 });
  });
  it('lato: Londyn 07:00 UTC, NY 13:30 UTC', () => {
    const day = Date.UTC(2026, 6, 15);
    const t = day + 8 * 3600_000;
    expect(mapWindow('otwarcie', t)).toEqual({ from: t, to: day + 13.5 * 3600_000 });
    expect(mapWindow('dzien', day + 7 * 3600_000)).toEqual({ from: day + 7 * 3600_000, to: day + 24 * 3600_000 });
  });
  it('mapy weekendu i tygodnia (inne) nie mają okna, więc się ich nie rozlicza', () => {
    expect(mapKind('Mapa na weekend', 'BTC w piątek wieczorem')).toBe('inne');
    expect(mapWindow(mapKind('Mapa tygodnia', 'Tydzień'), Date.UTC(2026, 10, 1, 20))).toBeNull();
  });
});

describe('czystość modułów rozliczenia', () => {
  it('mapSettlement.ts i sessionDay.ts nie importują i18n', () => {
    for (const f of ['../mapSettlement.ts', '../sessionDay.ts']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/from\s+['"][^'"]*i18n['"]/);
    }
  });
});
