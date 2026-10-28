import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FEATURES, type Feature, type FeatureVec, type SchrodiModel, features, forecast, profile, scoreHead, stanceOf } from '../schrodi';
import { agg, synth } from './schrodiSynth';

/** Wektory kontrolne z kodu uczenia (Python): cechy na syntetycznych minutach i prognozy modelu dla wierszy z danych. */
const fix = JSON.parse(readFileSync(new URL('./fixtures/schrodi-v1.json', import.meta.url), 'utf8')) as {
  seed: number;
  start: string;
  days: number;
  events: number[];
  features: { t: number; x: Record<Feature, number | null> }[];
  model: Record<'dir' | 'big', { x: (number | null)[][]; p_lr: number[]; p_gb: number[] }>;
};
const model = JSON.parse(readFileSync(new URL('../../../public/schrodi/model-v1.json', import.meta.url), 'utf8')) as SchrodiModel;

const toVec = (row: (number | null)[]) => Object.fromEntries(FEATURES.map((f, i) => [f, row[i] ?? NaN])) as FeatureVec;

describe('schrodi', () => {
  const m1 = synth(fix.seed, Date.parse(fix.start), fix.days);
  const inp = { m1, m5: agg(m1, 300_000), h1: agg(m1, 3_600_000), d1: agg(m1, 86_400_000), events: fix.events };

  it('cechy są takie same jak w kodzie uczenia', () => {
    for (const g of fix.features) {
      const r = features(inp, g.t);
      expect(r).not.toBeNull();
      for (const f of FEATURES) {
        const want = g.x[f];
        const got = r!.x[f];
        if (want === null) expect(got, `${f} @ ${new Date(g.t).toISOString()}`).toBeNaN();
        else expect(got, `${f} @ ${new Date(g.t).toISOString()}`).toBeCloseTo(want, 6);
      }
    }
  });

  it('model daje te same prawdopodobieństwa co scikit-learn i LightGBM', () => {
    for (const head of ['dir', 'big'] as const) {
      const c = fix.model[head];
      c.x.forEach((row, i) => {
        const r = scoreHead(model[head], model.features, toVec(row));
        expect(r.pLr).toBeCloseTo(c.p_lr[i], 9);
        expect(r.pGb).toBeCloseTo(c.p_gb[i], 9);
      });
    }
  });

  it('wkład grup sumuje się w przybliżeniu do odchylenia od 50%', () => {
    const r = scoreHead(model.dir, model.features, toVec(fix.model.dir.x[0]));
    const sum = Object.values(r.why).reduce((s, v) => s + v, 0);
    expect(Number.isFinite(sum)).toBe(true);
    expect(Math.abs(sum)).toBeLessThan(50);
  });

  it('profil: POC w najgęstszym miejscu, VA obejmuje POC', () => {
    const day = m1.filter((b) => b.t >= Date.parse('2026-10-20T00:00:00Z') && b.t < Date.parse('2026-10-21T00:00:00Z'));
    const p = profile(day);
    expect(p.val).toBeLessThan(p.poc);
    expect(p.vah).toBeGreaterThan(p.poc);
  });

  it('prognoza: stan, próg dużego ruchu w USD i poziomy', () => {
    const t = fix.features[4].t;
    const f = forecast(model, inp, t)!;
    expect(f.pUp).toBeGreaterThan(0);
    expect(f.pUp).toBeLessThan(1);
    expect(f.stance).toBe(stanceOf(f.pUp));
    expect(f.bigUsd).toBeGreaterThan(0);
    expect(f.levels?.pdh).toBeGreaterThan(f.levels!.pdl);
  });

  it('strefa „Nie wiem” od 47 do 53%', () => {
    expect(stanceOf(0.5)).toBe('unsure');
    expect(stanceOf(0.53)).toBe('unsure');
    expect(stanceOf(0.531)).toBe('long');
    expect(stanceOf(0.469)).toBe('short');
  });
});
