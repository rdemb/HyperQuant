import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type FeatureVec, type TouchModel, TOUCH_MAX_R, touchCone, touchProb } from '../schrodi';

/** Wektory kontrolne z kodu uczenia (Python): cechy kota z chwili prognozy, mediana zakresu godziny, odległość i p z LightGBM. */
const fix = JSON.parse(readFileSync(new URL('./fixtures/schrodi-touch.json', import.meta.url), 'utf8')) as {
  cases: { x: Record<string, number | null>; med1h: number; d: number; p: number }[];
};
const model = JSON.parse(readFileSync(new URL('../../../public/schrodi/touch-v1.json', import.meta.url), 'utf8')) as TouchModel;
const vec = (x: Record<string, number | null>) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v ?? NaN])) as FeatureVec;

describe('schrodi: dotknięcia', () => {
  it('daje te same prawdopodobieństwa co LightGBM, także przy brakach cech', () => {
    for (const c of fix.cases) expect(touchProb(model, vec(c.x), c.med1h, c.d)).toBeCloseTo(c.p, 9);
  });

  it('poza zakresem uczenia i bez zmienności nie zgaduje', () => {
    const c = fix.cases[0];
    expect(touchProb(model, vec(c.x), c.med1h, 0)).toBeNaN();
    expect(touchProb(model, vec(c.x), c.med1h, (TOUCH_MAX_R + 0.1) * c.med1h)).toBeNaN();
    expect(touchProb(model, vec({ ...c.x, rv_1d: null }), c.med1h, c.d)).toBeNaN();
  });

  it('stożek: dalsze granice dla mniejszej szansy, na granicy szansa co najmniej q', () => {
    for (const c of fix.cases.slice(0, 10)) {
      const x = vec(c.x);
      const cone = touchCone(model, x, c.med1h);
      expect(cone.map((s) => s.q)).toEqual([0.8, 0.5, 0.2]);
      for (const side of ['up', 'dn'] as const) {
        const ds = cone.map((s) => s[side]);
        ds.forEach((d, i) => {
          if (d === null) return;
          const sgn = side === 'up' ? 1 : -1;
          // Zaokrąglenie do 0,01 pb w dół lub w górę: sprawdzamy tuż przed granicą
          expect(touchProb(model, x, c.med1h, sgn * (d - 0.01))).toBeGreaterThanOrEqual(cone[i].q);
          if (i > 0 && ds[i - 1] !== null) expect(d).toBeGreaterThanOrEqual(ds[i - 1]!);
        });
      }
    }
  });
});
