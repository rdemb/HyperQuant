import { describe, expect, it } from 'vitest';
import type { Candle } from '../hl/parse';
import { type IndicatorBar, IB_EXTENSIONS, initialBalances } from '../core/indicators';
import { IB_EVIDENCE, IB_OBJECTS_MAX, ibObjects, selectIbs } from '../chart/ibSelect';

const M5 = 300_000;
const utc = (s: string) => Date.parse(s);
// 23.10.2026: Azja 00:00 UTC, Londyn 07:00 UTC (BST), Nowy Jork 13:30 UTC (EDT)
const ASIA = utc('2026-10-23T00:00:00Z');
const LONDON = utc('2026-10-23T07:00:00Z');
const NY = utc('2026-10-23T13:30:00Z');

const bar = (t: number, o: number, h: number, l: number, c: number): IndicatorBar => ({ t, candle: { t, o, h, l, c, v: 1, n: 1 } as Candle });

/** Świece 5m od `from` do `to` (bez `to`): w pierwszej godzinie sesji zakres 95–105, potem zamknięcia `close(t)`. */
function bars(from: number, to: number, close: (t: number) => number = () => 100): IndicatorBar[] {
  const out: IndicatorBar[] = [];
  for (let t = from; t < to; t += M5) {
    const c = close(t);
    out.push(bar(t, 100, Math.max(c, 105), Math.min(c, 95), c));
  }
  return out;
}

const pick = (b: IndicatorBar[], now = Number.POSITIVE_INFINITY) => selectIbs(initialBalances(b, M5), b, M5, now);

describe('zakres początkowy sesji: co rysujemy (selectIbs)', () => {
  it('pełny rysunek tylko dla bieżącej sesji, z poprzedniej same linie szczytu i dołka, starsze — nic', () => {
    const b = bars(ASIA, NY + 3 * 3_600_000);
    expect(initialBalances(b, M5)).toHaveLength(3);
    const s = pick(b);
    expect(s.map((d) => [d.ib.session.id, d.current])).toEqual([
      ['london', false],
      ['ny', true],
    ]);
    expect(s.map(ibObjects)).toEqual([2, 3]);
  });

  it('bez rozszerzeń, dopóki cena zamyka się w zakresie (knoty poza zakresem się nie liczą)', () => {
    const b = bars(NY, NY + 3 * 3_600_000).map((x) => (x.t >= NY + 3_600_000 ? bar(x.t, 100, 140, 60, 104) : x));
    expect(pick(b).at(-1)!.breakout).toBeNull();
  });

  it('rozszerzenia po pierwszym zamknięciu świecy poza zakresem i tylko po tej stronie', () => {
    const up = NY + 3_600_000 + 20 * 60_000;
    const down = up + 30 * 60_000;
    const b = bars(NY, NY + 3 * 3_600_000, (t) => (t === up ? 107 : t === down ? 90 : 100));
    const cur = pick(b).at(-1)!;
    // Wybicie znane na zamknięciu świecy (początek + 5 min); późniejsze zamknięcie pod dołkiem nie dokłada strony
    expect(cur.breakout).toEqual({ side: 1, t: up + M5 });
    expect(ibObjects(cur)).toBe(3 + IB_EXTENSIONS.length);
  });

  it('świeca w trakcie nie wybija zakresu; po jej zamknięciu — tak', () => {
    const last = NY + 2 * 3_600_000;
    const b = bars(NY, last + M5, (t) => (t === last ? 80 : 100));
    expect(pick(b, last + 60_000).at(-1)!.breakout).toBeNull();
    expect(pick(b, last + M5).at(-1)!.breakout).toEqual({ side: -1, t: last + M5 });
  });

  it(`najwyżej ${IB_OBJECTS_MAX} obiektów: bieżąca sesja z wybiciem i linie poprzedniej`, () => {
    const b = bars(LONDON, NY + 4 * 3_600_000, (t) => (t >= NY + 2 * 3_600_000 ? 120 : t >= LONDON + 2 * 3_600_000 && t < NY ? 80 : 100));
    const s = pick(b);
    expect(s.reduce((n, d) => n + ibObjects(d), 0)).toBe(IB_OBJECTS_MAX);
  });

  it('wybicie z przeszłości nie zmienia się po dojściu kolejnych świec i od głębokości historii', () => {
    const up = NY + 3_600_000 + 10 * 60_000;
    const close = (t: number) => (t === up ? 110 : t > up + 3_600_000 ? 50 : 100);
    const early = pick(bars(NY, up + 30 * 60_000, close)).at(-1)!.breakout;
    expect(pick(bars(NY, NY + 6 * 3_600_000, close)).at(-1)!.breakout).toEqual(early);
    expect(pick(bars(ASIA, NY + 6 * 3_600_000, close)).at(-1)!.breakout).toEqual(early);
  });

  it('opis: wynik sprawdzianu, PL i EN', () => {
    expect(IB_EVIDENCE.pl).toBe('Szczyt i dołek pierwszej godziny pękają częściej niż losowy poziom obok (odrzucenie 40% wobec 47%, n 1 239).');
    expect(IB_EVIDENCE.en).toContain('40% vs 47%, n 1,239');
  });
});
