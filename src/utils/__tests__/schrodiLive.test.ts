import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FEATURES, type Bar, type Group, type SchrodiModel, type Snap, features, liveBars, liveForecast, mindChange, snapOf } from '../schrodi';
import { agg, synth } from './schrodiSynth';

const MIN = 60_000;
const M5 = 5 * MIN;
const model = JSON.parse(readFileSync(new URL('../../../public/schrodi/model-v1.json', import.meta.url), 'utf8')) as SchrodiModel;

/** Świece z siatką przesuniętą o `off` (jak resample z offset w kodzie badania) */
function aggOff(m1: Bar[], ms: number, off: number): Bar[] {
  const out: Bar[] = [];
  for (const b of m1) {
    const t = Math.floor((b.t - off) / ms) * ms + off;
    const last = out[out.length - 1];
    if (last && last.t === t) {
      last.h = Math.max(last.h, b.h);
      last.l = Math.min(last.l, b.l);
      last.c = b.c;
      last.v += b.v;
    } else out.push({ ...b, t });
  }
  return out;
}

describe('schrodi na żywo', () => {
  const start = Date.parse('2026-09-20T00:00:00Z');
  const all = synth(11, start, 26);
  const end = all[all.length - 1].t + MIN;
  // Jak w przeglądarce: minuty tylko z ostatnich 5000 min, starsze świece 5m wyrównane
  const m1 = all.filter((b) => b.t >= end - 5000 * MIN);
  const base = { m5: agg(all, M5), h1: agg(all, 3_600_000), d1: agg(all, 86_400_000), events: [] as number[] };

  it('na pełnych 5 minutach świece z minut są takie jak wyrównane, a cechy identyczne', () => {
    const s = Math.floor(end / M5) * M5 - 2 * M5;
    const live = liveBars(m1, base.m5, s);
    const want = new Map(base.m5.map((b) => [b.t, b]));
    for (const b of live.slice(-900)) expect(b).toEqual(want.get(b.t));
    const a = features({ ...base, m1 }, s - M5)!;
    const b = features({ ...base, m1, m5: live }, s - M5)!;
    for (const f of FEATURES) expect(b.x[f], f).toBeCloseTo(a.x[f], 9);
  });

  it('w środku 5 minut cechy jak na świecach przesuniętych z pełnych minut (wolumen z 7 dni w przybliżeniu)', () => {
    for (const k of [1, 2, 3, 4]) {
      const s = Math.floor(end / M5) * M5 - 3 * M5 + k * MIN;
      const exact = features({ ...base, m1: all, m5: aggOff(all, M5, k * MIN) }, s - M5)!;
      const f = liveForecast(model, { ...base, m1 }, s)!;
      expect(f.t).toBe(s - M5);
      for (const name of FEATURES) {
        if (name === 'vol_z') expect(Math.abs(f.x.vol_z - exact.x.vol_z), `vol_z k=${k}`).toBeLessThan(0.03);
        else expect(f.x[name], `${name} k=${k}`).toBeCloseTo(exact.x[name], 9);
      }
    }
  });

  it('bez podanej chwili liczy do końca ostatniej minuty w danych (minuta w trakcie jak zamknięta)', () => {
    const f = liveForecast(model, { ...base, m1 })!;
    expect(f.t + M5).toBe(end);
    expect(f.price).toBe(m1[m1.length - 1].c);
    expect(f.pBig).toBeGreaterThan(0);
    expect(f.pBig).toBeLessThan(1);
    expect(liveForecast(model, { ...base, m1: [] })).toBeNull();
  });

  it('zmiana zdania: od 15 pp ruchu albo 4 pp kierunku względem chwili sprzed 10 min, z grupami cech', () => {
    const w = (o: Partial<Record<Group, number>>) => ({ move: 0, vol: 0, auction: 0, clock: 0, ...o });
    const snap = (s: number, pBig: number, pUp: number, wb = w({}), wd = w({})): Snap => ({ s, pBig, pUp, why: wd, whyBig: wb });
    const t0 = Date.parse('2026-10-28T12:00:00Z');
    const hist = [snap(t0, 0.38, 0.5, w({ vol: 2, move: 1 }))];
    expect(mindChange(hist, snap(t0 + 10 * MIN, 0.5, 0.53))).toBeNull();
    expect(mindChange(hist, snap(t0 + 9 * MIN, 0.9, 0.5))).toBeNull();
    const m = mindChange(hist, snap(t0 + 10 * MIN, 0.61, 0.51, w({ vol: 17, move: 7, clock: 1.5 })))!;
    expect(m).toMatchObject({ head: 'big', from: 0.38, to: 0.61 });
    expect(m.drivers).toEqual([
      { g: 'vol', pp: 15 },
      { g: 'move', pp: 6 },
    ]);
    const d = mindChange(hist, snap(t0 + 10 * MIN, 0.4, 0.45, w({}), w({ move: -4.5, clock: 0.5 })))!;
    expect(d).toMatchObject({ head: 'dir', from: 0.5, to: 0.45, drivers: [{ g: 'move', pp: -4.5 }] });
  });

  it('migawka: koniec minuty prognozy i oba rozkłady wkładu', () => {
    const f = liveForecast(model, { ...base, m1 })!;
    const s = snapOf(f);
    expect(s.s).toBe(end);
    expect(Object.keys(s.whyBig).sort()).toEqual(['auction', 'clock', 'move', 'vol']);
    expect(Object.values(s.whyBig).every(Number.isFinite)).toBe(true);
  });
});
