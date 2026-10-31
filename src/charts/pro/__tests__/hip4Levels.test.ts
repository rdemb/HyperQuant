import { describe, expect, it } from 'vitest';
import type { BtcOutcome, Hip4Row } from '../../../utils/hip4';
import { outcomeLevels } from '../chart/hip4Layer';
import { fmtPx } from '../chart/layout';
import { fmtDm, fmtHm } from '../core/time';
import { IndicatorEngine } from '../indicators/engine';
import { indicatorDef, indicatorLabel, indicatorsFromLink, tfAllowed } from '../indicators/registry';

const NOW = Date.UTC(2026, 9, 31, 10, 0);
const H = 3_600_000;

const row = (kind: BtcOutcome['kind'], K: number, expiry: number, mid: number | null, model: number | null): Hip4Row => ({
  q: { id: K, kind, K, expiry, source: 'mark', seconds: null, recurring: false, coin: `#${K}`, description: '' },
  bookOk: true,
  quote: mid === null ? { bid: 0.1, ask: 0.3, mid: 0.2, spread: 0.2, depthBid: 5, depthAsk: 5, liquid: false } : { bid: mid - 0.01, ask: mid + 0.01, mid, spread: 0.02, depthBid: 900, depthAsk: 900, liquid: true },
  model,
});

describe('rynki HIP-4 na wykresie', () => {
  const rows = [
    row('above', 82_000, NOW + H, 0.41, 0.36),
    row('touch', 84_500, NOW + 50 * H, 0.12, null),
    row('above', 81_000, NOW + 2 * H, null, 0.6),
  ];

  it('tylko płynne arkusze; podpis z progiem, terminem, rynkiem i modelem; nasycenie z różnicy', () => {
    const lv = outcomeLevels(rows, NOW, 81_500, false);
    expect(lv.map((l) => l.px)).toEqual([82_000, 84_500]);
    expect(lv[0].text).toBe(`> ${fmtPx(82_000)} · do ${fmtHm(NOW + H)} · rynek 41% · model 36%`);
    expect(lv[0].strength).toBeCloseTo(0.25, 12);
    // Termin innego dnia z datą; bez modelu (poza horyzontem) — kreska i kolor najsłabszy
    expect(lv[1].text).toBe(`dotknie ${fmtPx(84_500)} · do ${fmtDm(NOW + 50 * H)} ${fmtHm(NOW + 50 * H)} · rynek 12% · model —`);
    expect(lv[1].strength).toBe(0);
  });

  it('telefon: tylko poziom najbliższy ceny', () => {
    expect(outcomeLevels(rows, NOW, 84_000, true).map((l) => l.px)).toEqual([84_500]);
    expect(outcomeLevels(rows, NOW, 81_000, true).map((l) => l.px)).toEqual([82_000]);
    expect(outcomeLevels([], NOW, 81_000, true)).toEqual([]);
  });

  it('wskaźnik bez wartości świec, tylko w sekcji HyperQuant', () => {
    const def = indicatorDef('outcomes');
    expect(def.group).toBe('hyperquant');
    expect(def.outcomes).toBe(true);
    expect(tfAllowed(def)).toBe(false);
    const x = indicatorsFromLink('outcomes()')[0];
    expect(indicatorLabel(x)).toBe('HIP-4');
    const e = new IndicatorEngine();
    e.setInstances([x]);
    e.sync([{ candle: { t: 0, o: 1, h: 1, l: 1, c: 1, v: 1, n: 1 } }]);
    expect(e.runs[0].out).toEqual([]);
  });
});
