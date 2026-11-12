import { describe, expect, it } from 'vitest';
import type { BtcOutcome, Hip4Row } from '../../../utils/hip4';
import { outcomeLevels } from '../chart/hip4Layer';
import { fmtPx } from '../chart/layout';
import { fmtDayTime } from '../core/time';
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

  it('tylko płynne arkusze; podpis skrócony: próg, termin (różne terminy), rynek i model; nasycenie z różnicy', () => {
    const { levels: lv, rest } = outcomeLevels(rows, 81_500, false, NOW);
    expect(lv.map((l) => l.px)).toEqual([82_000, 84_500]);
    expect(rest).toBe(0);
    expect(lv[0].text).toBe(`> ${fmtPx(82_000)} do ${fmtDayTime(NOW + H, NOW)} · rynek 41% · model 36%`);
    expect(lv[0].strength).toBeCloseTo(0.25, 12);
    // Bez modelu (poza horyzontem) — kreska i kolor najsłabszy
    expect(lv[1].text).toBe(`dotknie ${fmtPx(84_500)} do ${fmtDayTime(NOW + 50 * H, NOW)} · rynek 12% · model —`);
    expect(lv[1].strength).toBe(0);
  });

  it('telefon: tylko poziom najbliższy ceny, reszta jako liczba', () => {
    expect(outcomeLevels(rows, 84_000, true, NOW).levels.map((l) => l.px)).toEqual([84_500]);
    expect(outcomeLevels(rows, 84_000, true, NOW).rest).toBe(1);
    expect(outcomeLevels(rows, 81_000, true, NOW).levels.map((l) => l.px)).toEqual([82_000]);
    expect(outcomeLevels([], 81_000, true, NOW)).toEqual({ levels: [], rest: 0 });
  });

  // Jak na żywo (11.2026): kilka rynków na tym samym progu z różnymi terminami (73 500 ×2, 74 000 ×3)
  const live = [
    row('above', 73_500, NOW + 6 * H, 0.52, 0.5),
    row('above', 73_500, NOW + H, 0.55, 0.5),
    row('above', 74_000, NOW + 30 * H, 0.31, null),
    row('above', 74_000, NOW + 2 * H, 0.22, 0.2),
    row('above', 74_000, NOW + 6 * H, 0.28, null),
    row('above', 73_000, NOW + 2 * H, 0.7, 0.66),
  ];

  it('kilka rynków na jednym progu: jedna linia, rynek z najbliższym terminem; różne terminy w podpisie', () => {
    const { levels: lv, rest } = outcomeLevels(live, 73_600, false, NOW);
    expect(lv.map((l) => l.px)).toEqual([73_000, 73_500, 74_000]);
    expect(rest).toBe(0);
    expect(lv[1].text).toBe(`> ${fmtPx(73_500)} do ${fmtDayTime(NOW + H, NOW)} · rynek 55% · model 50%`);
    expect(lv[2].text).toBe(`> ${fmtPx(74_000)} do ${fmtDayTime(NOW + 2 * H, NOW)} · rynek 22% · model 20%`);
  });

  it('wybrane rynki z jednym terminem: podpis bez terminu; telefon: jedna linia bez terminu', () => {
    const same = live.filter((r) => r.q.expiry === NOW + 6 * H || r.q.K === 73_000).map((r) => ({ ...r, q: { ...r.q, expiry: NOW + 6 * H } }));
    const { levels: lv } = outcomeLevels(same, 73_600, false, NOW);
    expect(lv.map((l) => l.text)).toEqual([`> ${fmtPx(73_000)} · rynek 70% · model 66%`, `> ${fmtPx(73_500)} · rynek 52% · model 50%`, `> ${fmtPx(74_000)} · rynek 28% · model —`]);
    expect(outcomeLevels(live, 73_600, true, NOW).levels.map((l) => l.text)).toEqual([`> ${fmtPx(73_500)} · rynek 55% · model 50%`]);
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
