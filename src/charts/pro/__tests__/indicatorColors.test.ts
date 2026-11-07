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
  addIndicator,
  axisTitle,
  plotColor,
  swatchColor,
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

/**
 * Jedyny wyjątek od ΔE ≥ 10: dawny kolor instancji #e66767 (zapis użytkownika z palety Neon/Desk) przy linii sprzedaży
 * sellInk #F68771 (ΔE 7,8; DMI −DI, Ichimoku Senkou B). Zapisanego koloru nie przepisujemy, a kolor strony zostaje.
 */
const NEAR_OK = [['#e66767', PRO.sellInk]].map(([a, b]) => `${lower(a)}|${lower(b)}`);
const nearOk = (a: string, b: string) => NEAR_OK.includes(`${lower(a)}|${lower(b)}`) || NEAR_OK.includes(`${lower(b)}|${lower(a)}`);

describe('kolory serii wskaźników', () => {
  it('w każdym wskaźniku widoczne linie mają różne kolory — przy każdym kolorze z palety i z dawnych zapisów', () => {
    for (const def of INDICATORS)
      for (const c of [...INDICATOR_COLORS, ...LEGACY_INDICATOR_COLORS]) {
        // Poziomy jednej struktury na cenie (wstęgi kanału, pivoty) dzielą kolor instancji — osobny test niżej
        const own = lines(def.plots).filter((p) => !p.shareColor);
        const colors = own.map((p) => lower(plotColor(inst(def.id, c), p)));
        expect(new Set(colors).size, `${def.id} przy kolorze ${c}: ${colors.join(', ')}`).toBe(colors.length);
      }
  });

  it('linie jednego wskaźnika są wyraźnie różne (ΔE OKLab ≥ 10) — przy kolorach palety i dawnych zapisów, z jednym nazwanym wyjątkiem', () => {
    const exceptions = new Set<string>();
    for (const def of INDICATORS)
      for (const c of [...INDICATOR_COLORS, ...LEGACY_INDICATOR_COLORS]) {
        const colors = lines(def.plots)
          .filter((p) => !p.shareColor)
          .map((p) => plotColor(inst(def.id, c), p));
        for (let i = 0; i < colors.length; i++)
          for (let j = i + 1; j < colors.length; j++) {
            if (nearOk(colors[i], colors[j])) {
              exceptions.add(def.id);
              continue;
            }
            expect(colorDistance(colors[i], colors[j]), `${def.id} przy ${c}: ${colors[i]} i ${colors[j]}`).toBeGreaterThanOrEqual(10);
          }
      }
    // Wyjątek dotyczy tylko wskaźników z linią sprzedaży obok koloru instancji
    expect([...exceptions].sort()).toEqual(['dmi', 'ichimoku']);
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

  it('wartości tylko do legendy (bez linii) w neutralnym tuszu; kolor znaku tylko tam, gdzie znak to strona albo kierunek ceny', () => {
    // Delta (strona agresji) oraz zmiana środka arkusza i oczekiwana zmiana ceny w OFI (w górę / w dół)
    const SIGNED = ['oiflow:1', 'absorption:1', 'ofi:1', 'ofi:3'];
    for (const def of INDICATORS)
      def.plots.forEach((p, k) => {
        if (!p.hidden) return;
        const x = inst(def.id, INDICATOR_COLORS[0]);
        if (SIGNED.includes(`${def.id}:${k}`)) expect([legendColor(x, p, 1), legendColor(x, p, -1)], `${def.id}:${k}`).toEqual([PRO.buyInk, PRO.sellInk]);
        else for (const sign of [1, -1]) expect(legendColor(x, p, sign), `${def.id}: ${p.title}`).toBe(PRO.ink2);
      });
    // KS (przesunięcie rozkładu kwot) nie jest stroną
    const ks = indicatorDef('ordersize').plots[4];
    expect([ks.title, legendColor(inst('ordersize', INDICATOR_COLORS[0]), ks, 0.4)]).toEqual(['KS', PRO.ink2]);
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
    // Sześć kolorów: ≥ 10 od stałych linii wskaźników i od siebie, ≥ 9 od kolorów warstw wykresu ceny, kontrast ≥ 4,5:1 (liczby legendy)
    expect(INDICATOR_COLORS.length).toBe(6);
    const FIXED = [PRO.buy, PRO.sell, PRO.buyInk, PRO.sellInk, PRO.indSecond, PRO.indThird, PRO.cohortRest];
    const LAYERS = [PRO.vwap, PRO.svwap, PRO.profilePoc, PRO.level, PRO.blogMap, PRO.ib, PRO.priceLine, PRO.zone];
    for (const c of INDICATOR_COLORS) {
      expect(contrast(c, PRO.bg), c).toBeGreaterThanOrEqual(4.5);
      for (const t of FIXED) expect(colorDistance(c, t), `${c} i ${t}`).toBeGreaterThanOrEqual(10);
      for (const t of LAYERS) expect(colorDistance(c, t), `${c} i ${t}`).toBeGreaterThanOrEqual(9);
    }
    for (let i = 0; i < INDICATOR_COLORS.length; i++)
      for (let j = i + 1; j < INDICATOR_COLORS.length; j++) expect(colorDistance(INDICATOR_COLORS[i], INDICATOR_COLORS[j])).toBeGreaterThanOrEqual(10);
    // Stałe linie z dala od dawnych kolorów instancji (poza nazwanym wyjątkiem), kontrast linii ≥ 3:1
    for (const t of [PRO.buyInk, PRO.sellInk, PRO.indSecond, PRO.indThird, PRO.cohortRest]) {
      expect(contrast(t, PRO.bg), t).toBeGreaterThanOrEqual(3);
      for (const l of LEGACY_INDICATOR_COLORS) if (!nearOk(l, t)) expect(colorDistance(l, t), `${l} i ${t}`).toBeGreaterThanOrEqual(10);
    }
    // Sześć wskaźników po kolei: sześć różnych kolorów (piąty i szósty się nie powtarzają)
    let list: IndicatorInstance[] = [];
    for (let k = 0; k < 6; k++) list = addIndicator(list, 'ema');
    expect(new Set(list.map((x) => x.color)).size).toBe(6);
  });

  it('znacznik na liście: to, co rysowane — przy samych słupkach kolory kupna i sprzedaży, nie nieużywany kolor instancji', () => {
    for (const id of ['twap', 'oiflow', 'ofi', 'absorption'] as const) {
      const sw = swatchColor(inst(id, INDICATOR_COLORS[0]));
      expect(sw, id).toContain(PRO.buy);
      expect(sw, id).toContain(PRO.sell);
      expect(sw, id).not.toContain(INDICATOR_COLORS[0]);
    }
    expect(swatchColor(inst('breadth', INDICATOR_COLORS[0]))).toBe(PRO.buyInk);
    expect(swatchColor(inst('ema', INDICATOR_COLORS[2]))).toBe(INDICATOR_COLORS[2]);
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

  it('podpisy linii na osi ceny: na wąskim ekranie bez długich podpisów na wykresie ceny (Ichimoku zasłaniał świece), pivoty zostają', () => {
    const ichi = indicatorDef('ichimoku');
    expect(ichi.plots.map((p) => axisTitle(ichi, p, false))).toEqual(['Tenkan', 'Kijun', 'Chikou', 'Senkou A', 'Senkou B']);
    expect(ichi.plots.map((p) => axisTitle(ichi, p, true))).toEqual(['', '', '', '', '']);
    const piv = indicatorDef('pivots');
    expect(piv.plots.map((p) => axisTitle(piv, p, true))).toEqual(['P', 'R1', 'S1', 'R2', 'S2', 'R3', 'S3']);
    // Własny panel (np. Szerokość agresji) zostaje z podpisami także na telefonie
    const br = indicatorDef('breadth');
    expect(axisTitle(br, br.plots[0], true)).toBe('kupujący');
  });
});
