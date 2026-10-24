import { describe, expect, it } from 'vitest';
import type { Candle } from '../hl/parse';
import { FootprintBuilder } from '../core/footprintBar';
import type { IndicatorBar } from '../core/indicators';
import { logicalOfTime } from '../chart/overlay';
import {
  MAX_DRAWINGS,
  barIndexAt,
  distToSegment,
  dragHandle,
  farPoint,
  fibExtension,
  fibRetrace,
  fmtDuration,
  measureStats,
  moveDrawing,
  newPosition,
  parseDrawings,
  positionStats,
  snapToOhlc,
  timeOfLogical,
} from '../draw/model';

const M1 = 60_000;

function c(t: number, o: number, h: number, l: number, cl: number, v: number): Candle {
  return { t, o, h, l, c: cl, v, n: 1 };
}

const bars = (n: number, t0 = 0, ms = M1): IndicatorBar[] => Array.from({ length: n }, (_, i) => ({ t: t0 + i * ms, candle: c(t0 + i * ms, 100, 101, 99, 100, 1) }));

describe('oś czasu rysunków', () => {
  it('timeOfLogical odwraca logicalOfTime w danych, przed nimi i za nimi', () => {
    const b = bars(10, 1_000_000);
    for (const logical of [-3, 0, 4, 9, 12]) {
      const t = timeOfLogical(b, logical, M1);
      expect(logicalOfTime(b, t, M1)).toBeCloseTo(logical, 9);
    }
    expect(timeOfLogical(b, 12, M1)).toBe(1_000_000 + 12 * M1);
    expect(timeOfLogical([], 3, M1)).toBeNaN();
  });

  it('barIndexAt: świeca zawierająca chwilę, −1 przed danymi', () => {
    const b = bars(5);
    expect(barIndexAt(b, -1)).toBe(-1);
    expect(barIndexAt(b, 0)).toBe(0);
    expect(barIndexAt(b, 2 * M1 + 30_000)).toBe(2);
    expect(barIndexAt(b, 99 * M1)).toBe(4);
  });
});

describe('geometria', () => {
  it('odległość od odcinka: rzut wewnątrz i za końcem', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(distToSegment(5, 3, a, b)).toBeCloseTo(3);
    expect(distToSegment(13, 4, a, b)).toBeCloseTo(5);
    expect(distToSegment(1, 1, a, a)).toBeCloseTo(Math.SQRT2);
  });

  it('promień przedłuża odcinek w kierunku B', () => {
    const p = farPoint({ x: 0, y: 0 }, { x: 3, y: 4 }, 10);
    expect(p.x).toBeCloseTo(9);
    expect(p.y).toBeCloseTo(12);
  });

  it('magnes przyciąga do najbliższego OHLC w zasięgu, poza nim zostawia cenę', () => {
    const k = { o: 100, h: 110, l: 95, c: 104 };
    expect(snapToOhlc(k, 108.5, 2, 24)).toBe(110);
    expect(snapToOhlc(k, 101.5, 2, 24)).toBe(100);
    expect(snapToOhlc(k, 200, 2, 24)).toBe(200);
  });
});

describe('Fibonacci', () => {
  it('zniesienie: 0 na końcu ruchu, 1 na początku', () => {
    expect(fibRetrace(100, 200, 0)).toBe(200);
    expect(fibRetrace(100, 200, 1)).toBe(100);
    expect(fibRetrace(100, 200, 0.618)).toBeCloseTo(138.2);
  });

  it('rozszerzenie odkłada ruch A→B od punktu C', () => {
    expect(fibExtension(100, 200, 150, 1)).toBe(250);
    expect(fibExtension(100, 200, 150, 1.618)).toBeCloseTo(311.8);
    expect(fibExtension(200, 100, 150, 1)).toBe(50);
  });
});

describe('pomiar', () => {
  it('zmiana ceny, świece, czas, wolumen i delta tylko ze świec z taśmą', () => {
    const b = bars(6);
    const fp = new FootprintBuilder(2 * M1, 1);
    fp.add(2 * M1 + 1, 100, 3, 1);
    fp.add(2 * M1 + 2, 100, 1, -1);
    b[2] = { ...b[2], fp: fp.build() };
    const m = measureStats(b, M1, { t: M1, p: 100 }, { t: 4 * M1, p: 102 });
    expect(m.dp).toBe(2);
    expect(m.pct).toBeCloseTo(2);
    expect(m.bars).toBe(3);
    expect(m.ms).toBe(3 * M1);
    // Świece 1..4 (początek w zakresie): wolumen 4 × 1 BTC, delta z jedynej świecy z taśmą
    expect(m.vol).toBe(4);
    expect(m.delta).toBeCloseTo(2);
    expect(m.tape).toBeCloseTo(0.25);
  });

  it('bez taśmy delta to null, kierunek pomiaru nie zmienia zakresu', () => {
    const b = bars(4);
    const m = measureStats(b, M1, { t: 3 * M1, p: 110 }, { t: 0, p: 100 });
    expect(m.delta).toBeNull();
    expect(m.vol).toBe(4);
    expect(m.dp).toBe(-10);
  });

  it('czas trwania po polsku', () => {
    expect(fmtDuration(45_000)).toBe('45 s');
    expect(fmtDuration(12 * M1)).toBe('12 min');
    expect(fmtDuration(185 * M1)).toBe('3 h 05 min');
    expect(fmtDuration(52 * 60 * M1)).toBe('2 d 4 h');
  });
});

describe('pozycja', () => {
  it('stosunek zysku do ryzyka i procenty od wejścia', () => {
    const s = positionStats(100, 110, 95);
    expect(s.reward).toBe(10);
    expect(s.risk).toBe(5);
    expect(s.rr).toBe(2);
    expect(s.rewardPct).toBeCloseTo(10);
    expect(s.riskPct).toBeCloseTo(5);
    expect(positionStats(100, 110, 100).rr).toBeNaN();
  });

  it('nowa pozycja: cel 2R, stop po drugiej stronie, short odwrotnie', () => {
    const e = { t: 0, p: 100 };
    expect(newPosition('long', e, 5, M1)).toEqual([e, { t: 20 * M1, p: 110 }, { t: 0, p: 95 }]);
    expect(newPosition('short', e, 5, M1)).toEqual([e, { t: 20 * M1, p: 90 }, { t: 0, p: 105 }]);
  });
});

describe('edycja', () => {
  it('przesunięcie całego rysunku', () => {
    expect(moveDrawing([{ t: 0, p: 1 }, { t: 5, p: 2 }], 10, -1)).toEqual([
      { t: 10, p: 0 },
      { t: 15, p: 1 },
    ]);
  });

  it('uchwyty prostokąta, pozycji i linii pionowej', () => {
    const r = [
      { t: 0, p: 10 },
      { t: 5, p: 20 },
    ];
    expect(dragHandle('rect', r, 2, { t: 1, p: 30 })).toEqual([
      { t: 1, p: 10 },
      { t: 5, p: 30 },
    ]);
    expect(dragHandle('rect', r, 3, { t: 7, p: 8 })).toEqual([
      { t: 0, p: 8 },
      { t: 7, p: 20 },
    ]);
    const pos = newPosition('long', { t: 0, p: 100 }, 5, M1);
    expect(dragHandle('long', pos, 1, { t: 999, p: 130 })[1]).toEqual({ t: 20 * M1, p: 130 });
    expect(dragHandle('long', pos, 3, { t: 40 * M1, p: 1 })[1]).toEqual({ t: 40 * M1, p: 110 });
    expect(dragHandle('long', pos, 0, { t: M1, p: 101 })[2]).toEqual({ t: M1, p: 95 });
    expect(dragHandle('vline', [{ t: 0, p: 5 }], 0, { t: 9, p: 50 })).toEqual([{ t: 9, p: 5 }]);
  });
});

describe('zapis rysunków', () => {
  it('pomija uszkodzone pozycje i poprawia styl', () => {
    const raw = [
      { id: 'a', kind: 'trend', pts: [{ t: 0, p: 1 }, { t: 1, p: 2 }], style: { color: '#ff0000', width: 9, dash: 'dashed' } },
      { id: 'b', kind: 'trend', pts: [{ t: 0, p: 1 }] },
      { id: 'c', kind: 'nieznane', pts: [{ t: 0, p: 1 }] },
      { id: 'd', kind: 'long', pts: [{ t: 0, p: 1 }] },
      { id: 'e', kind: 'text', pts: [{ t: 0, p: 1 }], style: { color: 'red' }, text: 'x'.repeat(400) },
      { id: 'f', kind: 'hline', pts: [{ t: 0, p: Number.NaN }] },
      null,
    ];
    const out = parseDrawings(raw);
    expect(out.map((d) => d.id)).toEqual(['a', 'e']);
    expect(out[0].style).toEqual({ color: '#ff0000', width: 4, dash: 'dashed' });
    expect(out[1].style.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(out[1].text).toHaveLength(280);
    expect(parseDrawings('zły zapis')).toEqual([]);
  });

  it('najwyżej MAX_DRAWINGS rysunków', () => {
    const raw = Array.from({ length: MAX_DRAWINGS + 20 }, (_, i) => ({ id: String(i), kind: 'hline', pts: [{ t: 0, p: i }] }));
    expect(parseDrawings(raw)).toHaveLength(MAX_DRAWINGS);
  });
});
