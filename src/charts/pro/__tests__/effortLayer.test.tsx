import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IndicatorSettings } from '../chart/IndicatorSettings';
import { closedBars, effortLegend } from '../chart/effortLayer';
import { type EffortBox, type EffortZone, effortZones } from '../core/effortZones';
import { IndicatorEngine } from '../indicators/engine';
import { indicatorDef, indicatorsFromLink, parseIndicators, tfAllowed, usesInstanceColor } from '../indicators/registry';
import type { EffortSelection } from '../chart/effortSelect';
import { guardHits } from '../../../utils/safeguards.mjs';

/** Wskaźnik „Strefy absorpcji i pudełka Effort”: świece do modelu, legenda z wyniku, wpis w rejestrze i okno ustawień. */

const MS = 5 * 60_000;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 4, 15, 0);

const bar = (i: number, fp: { delta: number } | null, complete: boolean) => ({
  t: T0 + i * MS,
  candle: { t: T0 + i * MS, o: 100, h: 101, l: 99, c: 100.5, v: 12, n: 3 },
  fp,
  complete,
});

describe('świece do modelu', () => {
  const bars = [bar(0, { delta: 4 }, true), bar(1, { delta: -2 }, false), bar(2, null, false), bar(3, { delta: 7 }, true)];

  it('tylko zamknięte świece (koniec ≤ teraz); świeca w trakcie nie wchodzi', () => {
    expect(closedBars(bars, MS, T0 + 4 * MS)).toHaveLength(4);
    expect(closedBars(bars, MS, T0 + 4 * MS - 1)).toHaveLength(3);
    expect(closedBars(bars, MS, T0 + MS - 1)).toEqual([]);
  });

  it('delta z footprintu tylko przy świecy w całości nagranej, inaczej null (przybliżenie ze świecy)', () => {
    expect(closedBars(bars, MS, T0 + 4 * MS)).toEqual([
      { t: T0, o: 100, h: 101, l: 99, c: 100.5, v: 12, delta: 4 },
      { t: T0 + MS, o: 100, h: 101, l: 99, c: 100.5, v: 12, delta: null },
      { t: T0 + 2 * MS, o: 100, h: 101, l: 99, c: 100.5, v: 12, delta: null },
      { t: T0 + 3 * MS, o: 100, h: 101, l: 99, c: 100.5, v: 12, delta: 7 },
    ]);
  });
});

describe('legenda', () => {
  const asOf = T0 + 24 * MS;
  const band = (side: 1 | -1) => ({ side, lo: 99, hi: 100, start: T0, end: null, mark: 'A', kinds: ['absorption' as const], extremes: [] });
  const sel: EffortSelection = {
    bands: [band(1), band(1), band(-1)],
    broken: null,
    boxes: [{ side: 1, from: asOf - 6 * MS, last: asOf - 4 * MS, lo: 99, hi: 100, cells: [asOf - 6 * MS, asOf - 4 * MS] }],
    far: { demand: 2, supply: 1 },
    tapeLast12: 12,
    history: false,
  };
  const text = (x: EffortSelection | null, ms = MS) =>
    effortLegend(x, ms, asOf)
      .map((p) => p.text)
      .join(' ');

  it('pasma po stronach z liczbą dalszych, ostatnia seria pudełek i świece z taśmą', () => {
    expect(text(sel)).toBe('strefy: 2 popytu · 1 podaży (dalej 3) · pudełko: kupno, 4 świece temu · taśma 12 z 12');
  });

  it('bez pudełka „—”; bez taśmy „pudełka: —, brak taśmy”; tryb Historia', () => {
    expect(text({ ...sel, boxes: [], far: { demand: 0, supply: 0 } })).toBe('strefy: 2 popytu · 1 podaży · pudełko: — · taśma 12 z 12');
    expect(text({ ...sel, boxes: [], tapeLast12: 0 })).toBe('strefy: 2 popytu · 1 podaży (dalej 3) · pudełka: —, brak taśmy');
    expect(text({ ...sel, history: true })).toBe('historia: 3 strefy · 1 seria pudełek · taśma 12 z 12');
  });

  it('powyżej 1 h bez rysowania, z powodem; bez zamkniętych świec — czekanie', () => {
    expect(text(sel, 4 * HOUR)).toBe('—, interwał do 1 h');
    expect(text(null)).toBe('czekam na świece…');
  });

  it('bez słów rady i kierunku (zabezpieczenia bloga)', () => {
    expect(guardHits(text(sel))).toEqual([]);
  });
});

describe('wpis w rejestrze', () => {
  const def = indicatorDef('effort');

  it('w „Więcej z HyperQuant”, na wykresie ceny, bez parametrów, plotów i interwału; kolory stron stałe', () => {
    expect(def).toMatchObject({ tier: 'second', short: 'Effort', group: 'hyperquant', pane: 'price', params: [], plots: [], format: 'price', effortZones: true });
    expect(def.name).toBe('Strefy absorpcji i pudełka Effort');
    expect(def.warmup({})).toBe(0);
    expect(tfAllowed(def)).toBe(false);
    expect(usesInstanceColor(def)).toBe(false);
    expect(indicatorsFromLink('effort()@1h')[0].tf).toBeUndefined();
  });

  it('opis z regułami i progami modelu, bez sygnałów', () => {
    for (const s of [
      'nie ma w TradingView',
      'Valentiniego',
      '5 świec po obu stronach',
      '1,5 × średnia z 20 świec',
      'od 0,15 do 1 ATR',
      'co najmniej 2 ATR',
      'value area 70%',
      'o 1 ATR',
      '12 h',
      'po złej stronie VWAP',
      'ponad połowę',
      '1,2 × średnia |delty|',
      '3 poprzednie świece',
      'tylko na świecy z deltą z taśmy',
      'najbliższe ostatniemu zamknięciu',
      'od świecy, na której zamknięciu strefa powstała',
      'w 52% przypadków, tak samo jak losowy poziom',
      'nie przewidują odbicia',
      'miejsca do obserwacji, nie sygnały',
    ])
      expect(def.convention, s).toContain(s);
    expect(indicatorDef('effort').convention).not.toContain('przybliżona ze świecy (wolumen');
    for (const lang of [def.convention, def.hint]) expect(guardHits(lang ?? '')).toEqual([]);
    expect(def.memoryNote).toMatch(/świeca w trakcie nie wchodzi.*do 1 h.*także w powtórce/);
  });

  it('silnik wskaźników: bez wartości świec, nigdy nie zgłasza zmiany', () => {
    const e = new IndicatorEngine();
    e.setInstances(indicatorsFromLink('effort()'));
    const c = { t: 0, o: 1, h: 1, l: 1, c: 1, v: 1, n: 1 };
    e.sync([{ candle: c }, { candle: { ...c, t: 60_000 } }], 60_000);
    expect(e.runs[0].from).toBe(Number.POSITIVE_INFINITY);
    expect(e.runs[0].out).toEqual([]);
  });

  it('okno ustawień: zakładka parametrów bez pól liczbowych i bez interwału, z przełącznikiem „Historia” (domyślnie wyłączony)', () => {
    const x = indicatorsFromLink('effort()')[0];
    const html = renderToStaticMarkup(<IndicatorSettings x={x} loaded={100} chart="5m" onChange={() => {}} onClose={() => {}} />);
    // Przełącznik „Historia” wyłączony (bez atrybutu checked) tuż przed swoim podpisem
    expect(html).toMatch(/<input type="checkbox"(?![^>]*checked)[^>]*\/>Historia/);
    expect(html).not.toContain('Interwał wskaźnika');
    expect(html).not.toContain('type="number"');
  });
});

describe('zapis wskaźnika: tryb Historia', () => {
  it('stary zapis bez pola ładuje się bez zmian (bez trybu Historia); włączony tryb zostaje', () => {
    const old = { iid: 'effort', id: 'effort', params: {}, color: '#E9548D', alpha: 1, width: 1, labels: true, visible: true };
    const [a] = parseIndicators([old]).list;
    expect('history' in a).toBe(false);
    expect(JSON.parse(JSON.stringify(a))).toEqual(old);
    expect(parseIndicators([{ ...old, history: true }]).list[0].history).toBe(true);
    expect('history' in parseIndicators([{ ...old, history: 'tak' }]).list[0]).toBe(false);
  });
});
