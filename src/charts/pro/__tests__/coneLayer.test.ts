import { describe, expect, it } from 'vitest';
import { ConeForecast, coneQuantile } from '../chart/coneLayer';
import { IndicatorEngine } from '../indicators/engine';
import { indicatorDef, indicatorLabel, indicatorsFromLink, tfAllowed } from '../indicators/registry';

const TAUS = [0.025, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.975];
/** Kwantyle normalne log-zwrotu (σ godziny 0,6%) jak w dzienniku: dryf −½σ², bez kierunku. */
const Z = [-1.96, -1.645, -1.2816, -0.8416, -0.5244, -0.2533, 0, 0.2533, 0.5244, 0.8416, 1.2816, 1.645, 1.96];
const qOf = (h: number) => {
  const s = 0.006 * Math.sqrt(h / 60);
  return Z.map((z) => -0.5 * s * s + s * z);
};
const f: ConeForecast = {
  t: Date.UTC(2026, 9, 30, 21, 16),
  px0: 80_000,
  horizons: [
    { h: 60, taus: TAUS, q: qOf(60) },
    { h: 240, taus: TAUS, q: qOf(240) },
  ],
};

describe('stożek prognozy z dziennika', () => {
  it('na horyzontach dziennika kwantyle dokładnie z zapisu; w chwili wydania zero', () => {
    TAUS.forEach((tau, k) => {
      expect(coneQuantile(f, tau, 60)).toBe(f.horizons[0].q[k]);
      expect(coneQuantile(f, tau, 240)).toBe(f.horizons[1].q[k]);
      expect(coneQuantile(f, tau, 0)).toBe(0);
    });
  });

  it('między horyzontami liniowo w pierwiastku czasu: przy rozrzucie dokładnie √t odtwarza go co do zaokrągleń', () => {
    // Bez dryfu −½σ² (rzędu 1e-5, liniowy w czasie, a nie w √t — tam przybliżenie odbiega o tyle)
    const pure: ConeForecast = { ...f, horizons: [60, 240].map((h) => ({ h, taus: TAUS, q: Z.map((z) => 0.006 * Math.sqrt(h / 60) * z) })) };
    for (const s of [5, 15, 30, 45, 90, 120, 180, 210]) {
      const s1 = 0.006 * Math.sqrt(s / 60);
      expect(coneQuantile(pure, 0.95, s)!).toBeCloseTo(1.645 * s1, 12);
      expect(coneQuantile(pure, 0.05, s)!).toBeCloseTo(-1.645 * s1, 12);
    }
    // Z dryfem różnica nie większa niż sam dryf na 4 h
    expect(Math.abs(coneQuantile(f, 0.95, 180)! - 1.645 * 0.006 * Math.sqrt(3))).toBeLessThan(0.5 * 0.012 ** 2);
  });

  it('kwantyle rosną z τ, przedział 90% obejmuje 60%, a oba poszerzają się z czasem', () => {
    let prev = { w90: 0, w60: 0 };
    for (let s = 1; s <= 240; s += 7) {
      const qs = TAUS.map((tau) => coneQuantile(f, tau, s)!);
      for (let k = 1; k < qs.length; k++) expect(qs[k]).toBeGreaterThan(qs[k - 1]);
      const w90 = coneQuantile(f, 0.95, s)! - coneQuantile(f, 0.05, s)!;
      const w60 = coneQuantile(f, 0.8, s)! - coneQuantile(f, 0.2, s)!;
      expect(w90).toBeGreaterThan(w60);
      expect(w90).toBeGreaterThan(prev.w90);
      expect(w60).toBeGreaterThan(prev.w60);
      prev = { w90, w60 };
    }
  });

  it('za ostatnim horyzontem i bez kwantyla w zapisie — brak (bez zgadywania)', () => {
    expect(coneQuantile(f, 0.5, 241)).toBeNull();
    expect(coneQuantile(f, 0.25, 30)).toBeNull();
    expect(coneQuantile({ ...f, horizons: [] }, 0.5, 10)).toBeNull();
  });

  it('wskaźnik bez wartości świec i bez parametru „Interwał”: silnik nigdy nie zgłasza zmiany', () => {
    const def = indicatorDef('cone');
    expect(def.forecast).toBe(true);
    expect(def.pane).toBe('price');
    expect(def.group).toBe('hyperquant');
    expect(def.plots).toEqual([]);
    expect(tfAllowed(def)).toBe(false);
    expect(indicatorLabel(indicatorsFromLink('cone()')[0])).toBe('Stożek');
    expect(indicatorsFromLink('cone()@1h')[0].tf).toBeUndefined();
    const e = new IndicatorEngine();
    e.setInstances(indicatorsFromLink('cone()'));
    const c = { t: 0, o: 1, h: 1, l: 1, c: 1, v: 1, n: 1 };
    const bs = [{ candle: c }, { candle: { ...c, t: 60_000 } }];
    e.sync(bs, 60_000);
    expect(e.runs[0].from).toBe(Number.POSITIVE_INFINITY);
    expect(e.runs[0].out).toEqual([]);
    expect(e.sync(bs, 60_000)).toBe(2);
  });
});
