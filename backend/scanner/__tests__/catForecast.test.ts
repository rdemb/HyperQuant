import { describe, expect, it } from 'vitest';
import { FEATURES, forecast } from '../../../src/utils/schrodi.ts';
import { agg, synth } from '../../../src/utils/__tests__/schrodiSynth.ts';
import {
  type CatForecast,
  type CatResolution,
  auc,
  catProbs,
  catScores,
  catTouch,
  catTouchScores,
  loadCatModel,
  makeCatForecast,
  parseBars,
  resolveCat,
  touchedLevel,
} from '../forecaster.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const SLOT = Date.UTC(2026, 9, 22, 21, 0, 0);

const cm = loadCatModel()!;
const m1 = synth(7, SLOT - 31 * DAY, 31);
const inp = { m1, m5: agg(m1, 5 * MIN), h1: agg(m1, HOUR), d1: agg(m1, DAY), events: [SLOT + 3 * HOUR] };
const tm = { slot: SLOT, ti: SLOT + 40_000, t: SLOT + MIN };

describe('Schrödi w dzienniku — wydanie', () => {
  it('model ze strony wczytany; hash = SHA-256 kanonicznego JSON', () => {
    expect(cm.model.version).toBe('schrodi-v1');
    expect(cm.mh).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cechy na świecy 5m kończącej się z początkiem slotu; p z zapisanych cech (przeliczalne bit w bit)', () => {
    const f = makeCatForecast(cm, inp, tm)!;
    expect(f).toMatchObject({ k: 'f', id: `${SLOT}-cat`, kind: 'cat', h: 60, slot: SLOT, ti: tm.ti, t: tm.t, bar: SLOT - 5 * MIN, model: 'schrodi-v1', mh: cm.mh });
    expect(f.x).toHaveLength(22);
    expect(catProbs(cm.model, f.x)).toEqual({ pUp: f.pUp, pBig: f.pBig });
    // Ta sama prognoza co kot na stronie (różnica tylko z zaokrąglenia cech do 6 miejsc)
    const web = forecast(cm.model, inp, SLOT - 5 * MIN)!;
    expect(f.pUp).toBeCloseTo(web.pUp, 3);
    expect(f.pBig).toBeCloseTo(web.pBig, 3);
    expect(f.px0).toBe(web.price);
    expect(f.thr).toBeGreaterThan(0);
  });

  it('dane po początku slotu nie zmieniają prognozy (bez podglądania)', () => {
    const extra = synth(9, SLOT, 1).map((b) => ({ ...b, c: b.c * 1.05, h: b.h * 1.05 }));
    const later = { ...inp, m1: [...m1, ...extra], m5: agg([...m1, ...extra], 5 * MIN), h1: agg([...m1, ...extra], HOUR) };
    expect(makeCatForecast(cm, later, tm)).toEqual(makeCatForecast(cm, inp, tm));
  });

  it('szanse dotknięcia poziomów i stożek: z zapisanych wartości, w zakresie uczenia, dalej = mniejsza szansa', () => {
    expect(cm.touch?.model.version).toBe('schrodi-touch-v1');
    expect(cm.touch?.th).toMatch(/^[0-9a-f]{64}$/);
    const f = makeCatForecast(cm, inp, tm)!;
    expect(f).toMatchObject({ tmodel: 'schrodi-touch-v1', th: cm.touch!.th });
    expect(f.tl!.length).toBeGreaterThan(0);
    for (const l of f.tl!) {
      expect(Math.abs(Math.log(l.px / f.px0) * 1e4)).toBeLessThanOrEqual(3 * f.thr);
      expect(l.p).toBeGreaterThan(0);
      expect(l.p).toBeLessThan(1);
    }
    // Przeliczenie z rekordu (ceny poziomów z 2 miejscami) daje to samo bit w bit
    const lv = Object.fromEntries(f.tl!.map((l) => [l.k, l.px]));
    expect(catTouch(cm.touch!.model, f.x, f.thr, f.px0, lv)).toEqual({ tl: f.tl, cone: f.cone });
    expect(f.cone!.map((c) => c.q)).toEqual([0.8, 0.5, 0.2]);
    for (const side of ['up', 'dn'] as const) {
      const ds = f.cone!.map((c) => c[side]).filter((d): d is number => d !== null);
      expect(ds).toEqual([...ds].sort((a, b) => a - b));
    }
  });

  it('bez pliku modelu dotknięć kot wydaje prognozę bez szans dotknięcia', () => {
    const noTouch = loadCatModel(undefined, new URL('file:///brak/touch.json'))!;
    expect(noTouch.touch).toBeNull();
    const f = makeCatForecast(noTouch, inp, tm)!;
    expect(f.tl).toBeUndefined();
    expect(f.pUp).toBe(makeCatForecast(cm, inp, tm)!.pUp);
  });

  it('brak świecy 5m przed slotem → brak prognozy', () => {
    expect(makeCatForecast(cm, { ...inp, m5: inp.m5.filter((b) => b.t !== SLOT - 5 * MIN) }, tm)).toBeNull();
  });

  it('parseBars: świece z wolumenem, rekordy z nieliczbami pominięte', () => {
    expect(parseBars([{ t: 1, o: '2', h: '3', l: '1', c: '2.5', v: '10' }, { t: 2, o: 'x' }])).toEqual([{ t: 1, o: 2, h: 3, l: 1, c: 2.5, v: 10 }]);
  });
});

describe('Schrödi w dzienniku — rozstrzygnięcie i wyniki', () => {
  const f = { kind: 'cat', id: 'c', t: SLOT, h: 60, thr: 40 } as CatForecast;
  const candles = (px: (i: number) => number, wick: number) =>
    Array.from({ length: 62 }, (_, i) => ({ time: SLOT - MIN + i * MIN, open: px(i), high: px(i) + wick, low: px(i) - wick, close: px(i) }));

  it('wzrost = c1 > c0; duży ruch = ln(max/min) okna > próg (pb)', () => {
    // Okno 60 świec od t: max 80 060 + 1, min 80 001 − 1 → ln ≈ 7,7 pb < 40 pb
    const r = resolveCat(f, candles((i) => 80_000 + i, 1), SLOT + 2 * HOUR)!;
    expect(r).toMatchObject({ c0: 80_000, c1: 80_060, yDir: 1, yBig: 0, hi: 80_061, lo: 80_000 });
    const big = resolveCat(f, candles((i) => 80_000 - 10 * i, 200), SLOT + 2 * HOUR)!;
    expect(big).toMatchObject({ yDir: 0, yBig: 1 });
  });

  it('brak świecy w oknie → brak rozstrzygnięcia', () => {
    expect(resolveCat(f, candles((i) => 80_000 + i, 1).filter((_, i) => i !== 30), SLOT + 2 * HOUR)).toBeNull();
  });

  it('AUC z remisami (średnia ranga); jedna klasa → null', () => {
    expect(auc([{ p: 0.2, y: 0 }, { p: 0.8, y: 1 }])).toBe(1);
    expect(auc([{ p: 0.5, y: 0 }, { p: 0.5, y: 1 }])).toBe(0.5);
    expect(auc([{ p: 0.3, y: 1 }, { p: 0.6, y: 0 }, { p: 0.6, y: 1 }])).toBe(0.25);
    expect(auc([{ p: 0.3, y: 1 }])).toBeNull();
  });

  it('wyniki: Brier vs klimatologia, stany Long/Short/nie wiem, prognozy rozłączne (pełne godziny)', () => {
    const pair = (slot: number, pUp: number, pBig: number, yDir: 0 | 1, yBig: 0 | 1) => ({
      f: { slot, pUp, pBig } as CatForecast,
      r: { yDir, yBig } as CatResolution,
    });
    const s = catScores([pair(SLOT, 0.6, 0.8, 1, 1), pair(SLOT + 15 * MIN, 0.4, 0.2, 1, 0), pair(SLOT + HOUR, 0.5, 0.3, 0, 0)]);
    expect(s).toMatchObject({ n: 3, nEff: 2 });
    expect(s.dir.long).toEqual({ n: 1, hit: 1 });
    expect(s.dir.short).toEqual({ n: 1, hit: 0 });
    expect(s.dir.unsure).toBe(1);
    expect(s.dir.brier).toBeCloseTo((0.16 + 0.36 + 0.25) / 3, 12);
    // Klimatologia okna: częstość wzrostów 2/3
    expect(s.dir.brierBase).toBeCloseTo((2 * (1 / 3) ** 2 + (2 / 3) ** 2) / 3, 12);
    expect(s.big.auc).toBe(1);
    expect(s.big.hit).toBe(1);
    expect(s.big.reliability).toHaveLength(10);
  });

  it('dotknięcie poziomu: nad ceną max okna, pod ceną min okna', () => {
    const r = { hi: 80_100, lo: 79_900 };
    expect(touchedLevel(80_100, 80_000, r)).toBe(1);
    expect(touchedLevel(80_100.5, 80_000, r)).toBe(0);
    expect(touchedLevel(79_900, 80_000, r)).toBe(1);
    expect(touchedLevel(79_899, 80_000, r)).toBe(0);
  });

  it('wyniki dotknięć: Brier wobec ruchu Browna, pokrycie stożka, pełne godziny', () => {
    const x = FEATURES.map((f) => (f === 'rv_1d' ? 240 : 0));
    const px0 = 80_000;
    const f = (slot: number) =>
      ({
        slot,
        px0,
        x,
        tl: [
          { k: 'pdh', px: 80_200, p: 0.3 },
          { k: 'pdl', px: 79_600, p: 0.1 },
        ],
        cone: [
          { q: 0.8, up: 5, dn: 5 },
          { q: 0.5, up: 20, dn: 20 },
          { q: 0.2, up: null, dn: 40 },
        ],
      }) as CatForecast;
    // Godzina 1: max 80 200 (PDH i granice w górę ≈ 80 040 i 80 160 dotknięte), min 79 970; godzina 2 (:15): min 79 950
    // dotyka tylko granicy 80% w dół (≈ 79 960)
    const s = catTouchScores([
      { f: f(SLOT), r: { hi: 80_200, lo: 79_970 } as CatResolution },
      { f: f(SLOT + 15 * MIN), r: { hi: 80_010, lo: 79_950 } as CatResolution },
      { f: { slot: SLOT + HOUR } as CatForecast, r: { hi: 1, lo: 1 } as CatResolution },
    ]);
    expect(s).toMatchObject({ n: 4, hours: 1 });
    expect(s.brier).toBeCloseTo((0.7 ** 2 + 0.1 ** 2 + 0.3 ** 2 + 0.1 ** 2) / 4, 12);
    expect(s.brierBm).not.toBeNull();
    expect(s.cone[0]).toEqual({ q: 0.8, n: 2, up: 0.5, dn: 0.5 });
    expect(s.cone[1]).toEqual({ q: 0.5, n: 2, up: 0.5, dn: 0 });
    // Granica poza zakresem uczenia (null) — godzina nieoceniana dla tej szansy
    expect(s.cone[2]).toEqual({ q: 0.2, n: 0, up: null, dn: null });
  });
});
