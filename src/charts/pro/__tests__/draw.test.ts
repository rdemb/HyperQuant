import { describe, expect, it } from 'vitest';
import type { Candle } from '../hl/parse';
import { FootprintBuilder } from '../core/footprintBar';
import type { IndicatorBar } from '../core/indicators';
import { logicalOfTime } from '../chart/overlay';
import {
  FIB_LEVELS,
  MAX_DRAWINGS,
  barIndexAt,
  distToSegment,
  dragHandle,
  extension,
  farPoint,
  fibExtension,
  fibLevels,
  fibRetrace,
  fmtDuration,
  PALETTE_ROWS,
  measureStats,
  mix,
  moveDrawing,
  newPosition,
  parseDrawings,
  parseProps,
  parseStyle,
  positionStats,
  reorder,
  snapToOhlc,
  styleCaps,
  textSize,
  timeOfLogical,
  visibleOn,
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

  it('kolejność warstw: na wierzch, do przodu, do tyłu, na spód', () => {
    const l = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
    const ids = (to: Parameters<typeof reorder>[2], id = 'b') => reorder(l, id, to).map((d) => d.id).join('');
    expect(ids('front')).toBe('acdb');
    expect(ids('forward')).toBe('acbd');
    expect(ids('backward')).toBe('bacd');
    expect(ids('back')).toBe('bacd');
    expect(ids('forward', 'd')).toBe('abcd');
    expect(ids('backward', 'a')).toBe('abcd');
    expect(ids('front', 'x')).toBe('abcd');
  });

  it('przedłużenie linii: domyślnie jak narzędzie, z ustawień w obie strony', () => {
    const pts = [{ t: 0, p: 1 }, { t: 1, p: 2 }];
    const style = { color: '#ffffff', width: 1, dash: 'solid' as const };
    expect(extension({ id: 'a', kind: 'trend', pts, style })).toEqual({ left: false, right: false });
    expect(extension({ id: 'a', kind: 'ray', pts, style })).toEqual({ left: false, right: true });
    expect(extension({ id: 'a', kind: 'extended', pts, style })).toEqual({ left: true, right: true });
    expect(extension({ id: 'a', kind: 'trend', pts, style, extL: true })).toEqual({ left: true, right: false });
    expect(extension({ id: 'a', kind: 'ray', pts, style, extR: false })).toEqual({ left: false, right: false });
    // Strzałka się nie przedłuża
    expect(extension({ id: 'a', kind: 'arrow', pts, style, extL: true, extR: true })).toEqual({ left: false, right: false });
  });

  it('poziomy Fibonacciego: domyślne albo wybrane, w kolejności od 0', () => {
    const pts = [{ t: 0, p: 1 }, { t: 1, p: 2 }];
    const d = { id: 'f', kind: 'fib' as const, pts, style: { color: '#ffffff', width: 1, dash: 'solid' as const } };
    expect(fibLevels(d).map((l) => l.v)).toEqual([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]);
    expect(fibLevels({ ...d, levels: [1.618, 0.5] }).map((l) => l.v)).toEqual([0.5, 1.618]);
    expect(fibLevels({ ...d, kind: 'fibext' }).map((l) => l.v)).toEqual([0, 0.618, 1, 1.272, 1.618, 2, 2.618]);
    expect(new Set(FIB_LEVELS.fib.map((l) => l.v)).size).toBe(FIB_LEVELS.fib.length);
  });

  it('widoczność na interwałach', () => {
    const d = { id: 'h', kind: 'hline' as const, pts: [{ t: 0, p: 1 }], style: { color: '#ffffff', width: 1, dash: 'solid' as const } };
    expect(visibleOn(d, M1)).toBe(true);
    expect(visibleOn({ ...d, hideIv: [M1] }, M1)).toBe(false);
    expect(visibleOn({ ...d, hideIv: [M1] }, 5 * M1)).toBe(true);
  });

  it('pasek pokazuje tylko ustawienia narzędzia', () => {
    expect(styleCaps('trend')).toEqual({ color: true, stroke: true, fill: false, size: false, text: false });
    expect(styleCaps('rect').fill).toBe(true);
    expect(styleCaps('text')).toEqual({ color: true, stroke: false, fill: false, size: true, text: true });
    expect(styleCaps('hline').text).toBe(true);
    expect(styleCaps('long')).toEqual({ color: false, stroke: false, fill: false, size: false, text: false });
  });
});

describe('kolory', () => {
  it('mieszanka kolorów i paleta 6 × 10 bez powtórzeń', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#ff4d5e', '#ffffff', 0)).toBe('#ff4d5e');
    expect(mix('#ff4d5e', '#000000', 1)).toBe('#000000');
    const all = PALETTE_ROWS.flat();
    expect(PALETTE_ROWS.every((r) => r.length === 10)).toBe(true);
    expect(new Set(all).size).toBe(all.length);
    expect(all.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
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

  it('krycie, tło, rozmiar tekstu i blokada: poprawne wartości zostają, złe są pomijane', () => {
    const pts = [{ t: 0, p: 1 }, { t: 1, p: 2 }];
    const [a, b] = parseDrawings([
      { id: 'a', kind: 'rect', pts, locked: true, style: { color: '#ff0000', width: 1, dash: 'solid', alpha: 0.5, fill: '#00ff00', fillAlpha: 3, size: 99 } },
      { id: 'b', kind: 'text', pts, locked: 'tak', style: { color: '#ff0000', width: 2, dash: 'solid', alpha: 'pół', fill: 'zielony' } },
    ]);
    expect(a.locked).toBe(true);
    expect(a.style).toEqual({ color: '#ff0000', width: 1, dash: 'solid', alpha: 0.5, fill: '#00ff00', fillAlpha: 1, size: 48 });
    expect(b.locked).toBeUndefined();
    expect(b.style).toEqual({ color: '#ff0000', width: 2, dash: 'solid' });
    // Stary zapis tekstu: rozmiar z grubości
    expect(textSize(b)).toBe(16);
    expect(textSize({ ...b, style: { ...b.style, size: 24 } })).toBe(24);
    expect(textSize({ ...b, kind: 'note' })).toBe(12);
  });

  it('ustawienia z okna: przedłużenie, opis, poziomy, widoczność i krój tekstu', () => {
    const pts = [{ t: 0, p: 1 }, { t: 1, p: 2 }];
    const [a, b, c] = parseDrawings([
      { id: 'a', kind: 'trend', pts, extL: true, extR: 'tak', labels: true, stats: 1, hideIv: [M1, 'x', 5 * M1], style: { bold: true, italic: 'tak' } },
      { id: 'b', kind: 'fib', pts, levels: [0.618, 7, 0, '1'] },
      { id: 'c', kind: 'rect', pts, levels: [0.5], hideIv: [] },
    ]);
    expect(a).toMatchObject({ extL: true, labels: true, hideIv: [M1, 5 * M1] });
    expect(a.extR).toBeUndefined();
    expect(a.stats).toBeUndefined();
    expect(a.style.bold).toBe(true);
    expect(a.style.italic).toBeUndefined();
    expect(b.levels).toEqual([0, 0.618]);
    expect(c.levels).toBeUndefined();
    expect(c.hideIv).toBeUndefined();
  });

  it('szablon narzędzia: styl i ustawienia bez punktów, tekstu i blokady', () => {
    expect(parseStyle('rect', { color: 'zły', width: 9, fillAlpha: 0.3 })).toEqual({ color: parseStyle('rect', null).color, width: 4, dash: 'solid', fillAlpha: 0.3 });
    expect(parseProps('ray', { extL: true, labels: true, text: 'x', locked: true, pts: [] })).toEqual({ extL: true, labels: true });
    expect(parseProps('fibext', { levels: [3.618, 0.236] })).toEqual({ levels: [3.618] });
  });

  it('najwyżej MAX_DRAWINGS rysunków', () => {
    const raw = Array.from({ length: MAX_DRAWINGS + 20 }, (_, i) => ({ id: String(i), kind: 'hline', pts: [{ t: 0, p: i }] }));
    expect(parseDrawings(raw)).toHaveLength(MAX_DRAWINGS);
  });
});
