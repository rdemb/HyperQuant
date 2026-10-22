import { describe, expect, it } from 'vitest';
import { Bocpd } from '../bocpd';
import { mulberry32 } from '../pathEngine';

function gaussSeq(seed: number, parts: { n: number; sd: number }[]): number[] {
  const rnd = mulberry32(seed);
  const g = () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
  return parts.flatMap((p) => Array.from({ length: p.n }, () => p.sd * g()));
}

describe('BOCPD (Adams & MacKay 2007) — zmienność o nieznanej precyzji, średnia 0', () => {
  it('rozkład długości przebiegu sumuje się do 1; bez zmiany długość rośnie razem z danymi', () => {
    const b = new Bocpd({ hazard: 1 / 200, alpha0: 2, beta0: 2 * 0.005 ** 2, rMax: 400 });
    for (const x of gaussSeq(1, [{ n: 300, sd: 0.005 }])) b.update(x);
    const s = b.state();
    expect(s.probs.reduce((a, p) => a + p, 0)).toBeCloseTo(1, 9);
    expect(s.mapRun).toBeGreaterThan(200);
    expect(s.pChange).toBeLessThan(0.05);
  });
  it('skok zmienności ×4 wykryty w ciągu kilkunastu obserwacji; σ reżimu bliska nowej', () => {
    const b = new Bocpd({ hazard: 1 / 200, alpha0: 2, beta0: 2 * 0.005 ** 2, rMax: 400 });
    const xs = gaussSeq(2, [
      { n: 300, sd: 0.005 },
      { n: 40, sd: 0.02 },
    ]);
    let detectedAt: number | null = null;
    xs.forEach((x, i) => {
      b.update(x);
      if (detectedAt === null && i >= 300 && b.state().mapRun < i - 300 + 5) detectedAt = i;
    });
    expect(detectedAt).not.toBeNull();
    expect(detectedAt! - 300).toBeLessThan(15);
    const s = b.state();
    expect(s.mapRun).toBeLessThan(60);
    expect(s.sigma).toBeGreaterThan(0.012);
    expect(s.sigma).toBeLessThan(0.03);
  });
  it('fałszywe alarmy rzadkie: przy stałym reżimie P(zmiana w ostatnich 5) rzadko > 0,5', () => {
    const b = new Bocpd({ hazard: 1 / 200, alpha0: 2, beta0: 2 * 0.005 ** 2, rMax: 400 });
    let alarms = 0;
    gaussSeq(3, [{ n: 2000, sd: 0.005 }]).forEach((x, i) => {
      b.update(x);
      if (i > 50 && b.state().pRecent5 > 0.5) alarms++;
    });
    expect(alarms / 1950).toBeLessThan(0.02);
  });
  it('obcięcie rMax: masa ogona scalana, rozkład nadal normalizowany; wartości nieskończone ignorowane', () => {
    const b = new Bocpd({ hazard: 1 / 50, alpha0: 2, beta0: 2e-5, rMax: 20 });
    for (const x of gaussSeq(4, [{ n: 100, sd: 0.003 }])) b.update(x);
    b.update(Number.NaN);
    const s = b.state();
    expect(s.probs).toHaveLength(21);
    expect(s.probs.reduce((a, p) => a + p, 0)).toBeCloseTo(1, 9);
    expect(s.n).toBe(100);
  });
});
