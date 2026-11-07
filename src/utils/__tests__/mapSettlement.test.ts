import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapKind } from '../../../scripts/blog/build.mjs';
import { mapWindow, settleLevels } from '../mapSettlement';
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
  it('wpis z Azji (inne rodzaje) obejmuje najbliższą sesję Londynu', () => {
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
