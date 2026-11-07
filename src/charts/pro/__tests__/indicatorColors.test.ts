import { describe, expect, it } from 'vitest';
import {
  HIST_DOWN,
  HIST_UP,
  INDICATORS,
  INDICATOR_COLORS,
  LEGACY_INDICATOR_COLORS,
  type IndicatorId,
  type IndicatorInstance,
  type PlotDef,
  indicatorDef,
  legendColor,
  legendTitle,
  plotColor,
  usesInstanceColor,
} from '../indicators/registry';
import { PRO, colorDistance, luminance } from '../chart/theme';
import { STATIONS } from '../chart/stations';

/** Kontrast WCAG dwóch kolorów #rrggbb. */
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const inst = (id: IndicatorId, color: string): IndicatorInstance => ({ iid: `${id}1`, id, params: {}, color, alpha: 1, width: 1, labels: true, visible: true });

/** Linie rysowane na wykresie (bez słupków w kolorach znaku i bez wartości tylko do legendy). */
const lines = (plots: readonly PlotDef[]) => plots.filter((p) => !p.hidden && !p.hist);

const lower = (c: string) => c.toLowerCase();

describe('kolory serii wskaźników', () => {
  it('w każdym wskaźniku widoczne linie mają różne kolory — przy każdym kolorze z palety i z dawnych zapisów', () => {
    for (const def of INDICATORS)
      for (const c of [...INDICATOR_COLORS, ...LEGACY_INDICATOR_COLORS]) {
        // Poziomy jednej struktury na cenie (wstęgi kanału, pivoty) dzielą kolor instancji — osobny test niżej
        const own = lines(def.plots).filter((p) => !p.shareColor);
        const colors = own.map((p) => lower(plotColor(inst(def.id, c), p)));
        expect(new Set(colors).size, `${def.id} przy kolorze ${c}: ${colors.join(', ')}`).toBe(colors.length);
        if (own.length > 0 && def.plots.some((p) => p.shareColor)) expect(colors, def.id).not.toContain(lower(c));
      }
  });

  it('przy kolorach domyślnych linie jednego wskaźnika są wyraźnie różne (ΔE OKLab ≥ 10)', () => {
    for (const def of INDICATORS)
      for (const c of INDICATOR_COLORS) {
        const colors = lines(def.plots)
          .filter((p) => !p.shareColor)
          .map((p) => plotColor(inst(def.id, c), p));
        for (let i = 0; i < colors.length; i++)
          for (let j = i + 1; j < colors.length; j++)
            expect(colorDistance(colors[i], colors[j]), `${def.id} przy ${c}: ${colors[i]} i ${colors[j]}`).toBeGreaterThanOrEqual(10);
      }
  });

  it('wspólny kolor instancji tylko dla poziomów jednej struktury na wykresie ceny, odróżnianych położeniem, kreską albo podpisem', () => {
    const shared = INDICATORS.filter((d) => d.plots.some((p) => p.shareColor));
    expect(shared.map((d) => d.id).sort()).toEqual(['bb', 'donchian', 'keltner', 'linreg', 'pivots']);
    for (const d of shared) {
      expect(d.pane, d.id).toBe('price');
      // Wszystkie linie struktury w kolorze instancji (bez stałego koloru i bez znaczenia strony)
      for (const p of d.plots) expect([p.shareColor, p.color], d.id).toEqual([true, undefined]);
      // Środek kanału przerywany, poziomy pivotów podpisane na osi
      expect(d.id === 'pivots' ? d.plots.every((p) => p.title) : d.plots[0].dashed, d.id).toBe(true);
    }
  });

  it('serie strony w kolorach strony: kupno lazur, sprzedaż żar (linie i liczby w odcieniach ink)', () => {
    const SIDE: Partial<Record<IndicatorId, readonly (('buy' | 'sell') | null)[]>> = {
      breadth: ['buy', 'sell', null],
      dmi: [null, 'buy', 'sell'],
      supertrend: ['buy', 'sell'],
      ichimoku: [null, null, null, 'buy', 'sell'],
    };
    for (const [id, sides] of Object.entries(SIDE) as [IndicatorId, ('buy' | 'sell' | null)[]][]) {
      const def = indicatorDef(id);
      for (const c of [...INDICATOR_COLORS, ...LEGACY_INDICATOR_COLORS])
        sides.forEach((s, k) => {
          const color = plotColor(inst(id, c), def.plots[k]);
          if (s === 'buy') expect(color, `${id}[${k}]`).toBe(PRO.buyInk);
          else if (s === 'sell') expect(color, `${id}[${k}]`).toBe(PRO.sellInk);
          else expect([PRO.buyInk, PRO.sellInk], `${id}[${k}] bez strony`).not.toContain(color);
        });
    }
    // Każda linia z podpisem strony (kupno, sprzedaż) ma kolor tej strony
    for (const def of INDICATORS)
      for (const p of lines(def.plots)) {
        const t = p.title ?? '';
        if (/kupuj|kupno|buyer|buying/i.test(t)) expect(plotColor(inst(def.id, INDICATOR_COLORS[0]), p), `${def.id}: ${t}`).toBe(PRO.buyInk);
        if (/sprzedaj|sprzeda|seller|selling/i.test(t)) expect(plotColor(inst(def.id, INDICATOR_COLORS[0]), p), `${def.id}: ${t}`).toBe(PRO.sellInk);
      }
    // Kolory strony tylko na liniach, które są stroną (żadna inna stała linia ich nie bierze)
    const sideLines = new Set(Object.entries(SIDE).flatMap(([id, s]) => s.flatMap((x, k) => (x ? [`${id}:${k}`] : []))));
    for (const def of INDICATORS)
      def.plots.forEach((p, k) => {
        if ((p.color === PRO.buyInk || p.color === PRO.sellInk) && !sideLines.has(`${def.id}:${k}`) && !/kupuj|sprzedaj/i.test(p.title ?? ''))
          throw new Error(`${def.id}[${k}] ma kolor strony bez znaczenia strony`);
      });
  });

  it('słupki: dodatnie (kupno, wzrost) w kolorze kupna, ujemne w kolorze sprzedaży; liczby słupków w odcieniach ink', () => {
    expect([HIST_UP, HIST_DOWN]).toEqual([PRO.buy, PRO.sell]);
    const twap = inst('twap', INDICATOR_COLORS[0]);
    const [buy, sell] = indicatorDef('twap').plots;
    expect(legendColor(twap, buy, 12)).toBe(PRO.buyInk);
    expect(legendColor(twap, sell, -7)).toBe(PRO.sellInk);
    // Bez wartości (—) bez koloru znaku: „sprzedaż % —” nie może świecić kolorem kupna
    expect(legendColor(twap, sell, Number.NaN)).toBe(PRO.ink2);
    expect(legendColor(twap, buy, Number.NaN)).toBe(PRO.ink2);
  });

  it('Szerokość agresji w układzie Aukcja: kupujący i sprzedający w różnych kolorach stron, wyścig neutralny (zgłoszenie 7.11)', () => {
    const auction = STATIONS.find((s) => s.id === 'auction-open')!;
    const x = auction.panelSets![0].indicators.find((i) => i.id === 'breadth')!;
    const [buyers, sellers, race] = indicatorDef('breadth').plots;
    expect(legendColor(x, buyers, 2)).toBe(PRO.buyInk);
    expect(legendColor(x, sellers, 3.1)).toBe(PRO.sellInk);
    expect(legendColor(x, race, 3)).toBe(PRO.ink2);
    // Dawny zapis z kolorem pomarańczowym i z dawnym niebieskim też
    for (const c of LEGACY_INDICATOR_COLORS) expect(plotColor({ ...x, color: c }, buyers)).not.toBe(plotColor({ ...x, color: c }, sellers));
  });

  it('wartości tylko do legendy (bez linii) w neutralnym tuszu, nie w kolorze serii', () => {
    for (const def of INDICATORS)
      for (const p of def.plots.filter((q) => q.hidden && !q.hist)) expect(legendColor(inst(def.id, INDICATOR_COLORS[0]), p, 1), `${def.id}: ${p.title}`).toBe(PRO.ink2);
  });

  it('liczby w legendzie czytelne: kontrast ≥ 4,5:1 z tłem wykresu', () => {
    for (const def of INDICATORS)
      for (const c of INDICATOR_COLORS)
        for (const p of def.plots)
          for (const sign of [1, -1]) {
            const color = legendColor(inst(def.id, c), p, sign);
            expect(contrast(color, PRO.bg), `${def.id} ${p.title ?? ''} ${color}`).toBeGreaterThanOrEqual(4.5);
          }
  });

  it('paleta instancji: z dala od kolorów stron i warstw ceny, czytelna na tle', () => {
    const TAKEN = [PRO.buy, PRO.sell, PRO.buyInk, PRO.sellInk, PRO.vwap, PRO.svwap, PRO.profilePoc, PRO.level, PRO.blogMap, PRO.ib, PRO.priceLine, PRO.zone, PRO.indSecond, PRO.indThird, PRO.cohortMm, PRO.cohortRest];
    for (const c of INDICATOR_COLORS) {
      expect(contrast(c, PRO.bg), c).toBeGreaterThanOrEqual(4.5);
      for (const t of TAKEN) expect(colorDistance(c, t), `${c} i ${t}`).toBeGreaterThanOrEqual(9);
    }
    // Kolejne kolory palety różne od siebie
    for (let i = 0; i < INDICATOR_COLORS.length; i++)
      for (let j = i + 1; j < INDICATOR_COLORS.length; j++) expect(colorDistance(INDICATOR_COLORS[i], INDICATOR_COLORS[j])).toBeGreaterThanOrEqual(9);
  });

  it('kolor instancji w ustawieniach tylko tam, gdzie coś zmienia', () => {
    expect(usesInstanceColor(indicatorDef('ema'))).toBe(true);
    expect(usesInstanceColor(indicatorDef('cone'))).toBe(true);
    expect(usesInstanceColor(indicatorDef('hawkes'))).toBe(true);
    // Wszystkie linie w stałych kolorach albo same słupki w kolorach znaku
    for (const id of ['breadth', 'makers', 'supertrend', 'twap', 'oiflow'] as const) expect(usesInstanceColor(indicatorDef(id)), id).toBe(false);
  });

  it('podpis wartości w legendzie bez powtórzenia nazwy wskaźnika („RVOL RVOL —”)', () => {
    const rvol = indicatorDef('rvol');
    expect(legendTitle(rvol, rvol.plots[0])).toBe('');
    const breadth = indicatorDef('breadth');
    expect(legendTitle(breadth, breadth.plots[0])).toBe('kupujący');
    for (const def of INDICATORS) for (const p of def.plots) expect(legendTitle(def, p), def.id).not.toBe(def.short);
  });
});
