import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IndicatorSettings } from '../chart/IndicatorSettings';
import { closedBars, effortLegend } from '../chart/effortLayer';
import { type EffortBox, type EffortZone, effortZones } from '../core/effortZones';
import { IndicatorEngine } from '../indicators/engine';
import { indicatorDef, indicatorsFromLink, tfAllowed, usesInstanceColor } from '../indicators/registry';

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
  const now = T0 + 24 * MS;
  const zone = (side: 1 | -1, to: number | null): EffortZone => ({ id: 1, side, kind: 'absorption', from: T0, createdAt: T0 + 5 * MS, lo: 99, hi: 100, to, end: to === null ? null : 'broken', armedAt: null });
  const box = (t: number): EffortBox => ({ side: 1, t, lo: 99, hi: 100, stacked: false });
  const result = {
    ...effortZones([], MS),
    zones: [zone(1, null), zone(-1, null), zone(1, T0 + 9 * MS), zone(1, null)],
    // Zamknięte w ostatniej godzinie: świece od now − 1 h (koniec now − 55 min) do now − 5 min; wcześniejsza nie
    boxes: [box(now - HOUR - MS), box(now - HOUR), box(now - 30 * 60_000), box(now - MS)],
    proxyShare: 0.08,
  };

  it('aktywne strefy po stronach, pudełka z ostatniej godziny i udział delty z taśmy', () => {
    expect(
      effortLegend(result, MS, now)
        .map((p) => p.text)
        .join(' ')
    ).toBe('strefy: 2 popytu · 1 podaży · pudełka z ostatniej godziny: 3 · delta z taśmy 92%');
  });

  it('powyżej 1 h bez rysowania, z powodem; bez zamkniętych świec — czekanie', () => {
    expect(effortLegend(result, 4 * HOUR, now).map((p) => p.text)).toEqual(['—, interwał do 1 h']);
    expect(effortLegend(null, MS, now).map((p) => p.text)).toEqual(['czekam na świece…']);
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
      'przez 12 świec',
      'udział świec z taśmą widać w legendzie',
      'miejsca do obserwacji, nie sygnały',
    ])
      expect(def.convention, s).toContain(s);
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

  it('okno ustawień: zakładka parametrów bez pól i bez interwału, z opisem reguł', () => {
    const x = indicatorsFromLink('effort()')[0];
    const html = renderToStaticMarkup(<IndicatorSettings x={x} loaded={100} chart="5m" onChange={() => {}} onClose={() => {}} />);
    expect(html).toContain('Bez parametrów: reguły jak w opisie.');
    expect(html).not.toContain('Interwał wskaźnika');
    expect(html).not.toContain('type="number"');
  });
});
