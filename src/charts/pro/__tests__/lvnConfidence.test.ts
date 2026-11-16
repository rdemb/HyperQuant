import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../../utils/pathEngine';
import { type VBar, swingLvnConfidence, swingProfile } from '../core/effortZones';
import { LVN_MIN_CONFIDENCE, confidentLvn, lvnConfidence, lvnNodes, unitsBuilder } from '../core/lvnConfidence';
import { profileLevels } from '../core/pbRanges';
import { fmtPx } from '../chart/layout';
import { lineText, weekLvnText } from '../chart/pbRangeLayer';

/** Świeca z taśmą: `rows` wierszy co `tick` od ceny `from`, wolumen wiersza z `vol(cena)`. */
function tapeBar(t: number, from: number, rows: number, tick: number, vol: (px: number) => number): VBar {
  const buy = new Float64Array(rows);
  const sell = new Float64Array(rows);
  for (let r = 0; r < rows; r++) {
    const v = vol(from + r * tick);
    buy[r] = v / 2;
    sell[r] = v / 2;
  }
  const lo = Math.round(from / tick);
  const l = lo * tick;
  const h = (lo + rows - 1) * tick;
  return { t, o: l, h, l, c: h, v: buy.reduce((s, x) => s + x, 0) * 2, delta: 0, tape: { tick, lo, buy, sell } };
}

/** Liczba z rozkładu normalnego N(0, 1) (Box–Muller). */
const normal = (rnd: () => number) => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

/**
 * Swing z `n` świec po `rows` wierszy co 0,05: środek świecy z `center(rnd)`, wolumen wiersza losowy, a cała świeca
 * skalowana przez exp(`sig` × N(0, 1)) (gruby ogon wolumenu świec przy `sig` > 0).
 */
function swing(n: number, rows: number, seed: number, center: (rnd: () => number) => number, sig = 0): VBar[] {
  const rnd = mulberry32(seed);
  const tick = 0.05;
  const out: VBar[] = [];
  for (let i = 0; i < n; i++) {
    const c = center(rnd);
    const scale = Math.exp(sig * normal(rnd));
    out.push(tapeBar(i * 60_000, c - (rows / 2) * tick, rows, tick, () => scale * (0.5 + rnd())));
  }
  return out;
}

/** Udział ziaren danych 1–20 bez LVN o pewności ≥ 70% i udział takich LVN wśród wszystkich (`all` — ich liczba). */
function noiseRun(center: (rnd: () => number) => number, rows: number, sig: number): { seeds: number; low: number; all: number } {
  let quiet = 0;
  let all = 0;
  let low = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const bars = swing(300, rows, seed, center, sig);
    const p = swingProfile(bars, 0, bars.length - 1, 24, 0.7)!;
    const conf = swingLvnConfidence(bars, p, { seed: 1000 + seed });
    all += conf.length;
    low += conf.filter((c) => c < LVN_MIN_CONFIDENCE).length;
    if (conf.every((c) => c < LVN_MIN_CONFIDENCE)) quiet++;
  }
  return { seeds: quiet / 20, low: all > 0 ? low / all : 1, all };
}

/** Dwa garby wolumenu (101–104 i 108–111) i rzadkie transakcje w dolinie 104–108. */
const bimodal = (rnd: () => number) => {
  const u = rnd();
  if (u < 0.04) return 104 + 4 * rnd();
  return u < 0.52 ? 101 + 3 * rnd() : 108 + 3 * rnd();
};

describe('LVN: ranking według trwałości topologicznej', () => {
  // Płaskowyże po 5–10 koszyków (wygładzanie oknem 5 zostawia środki): garby H1..H5 i doliny V1..V4
  const seg: [number, number][] = [
    [5, 0],
    [10, 100],
    [5, 40], // V1 (środek 17): między garbami 100 i 100 — trwałość 60
    [10, 100],
    [5, 20], // V2 (32): po prawej tylko garb 30, potem niżej — trwałość 10
    [5, 30],
    [5, 10], // V3 (42): między 100 (po lewej aż do zer) i 90 — trwałość 80
    [10, 90],
    [5, 5], // V4 (57): najgłębsza, ale po prawej tylko garb 8 — trwałość 3
    [5, 8],
    [5, 0],
  ];
  const prof = seg.flatMap(([n, v]) => new Array<number>(n).fill(v));

  it('kolejność według głębokości wobec niższego z otaczających maksimów, nie według wartości minimum', () => {
    const got = lvnNodes(prof, 5, 64, 10);
    expect(got.map((x) => x.bin)).toEqual([42, 17, 32]);
    expect(got.map((x) => x.persistence)).toEqual([0.8, 0.6, 0.1].map((p) => expect.closeTo(p, 12)));
    // Najgłębsze minimum (V4, 5) o trwałości 3 nie mieści się w 3 najtrwalszych
    expect(got.some((x) => x.bin === 57)).toBe(false);
  });
});

describe('LVN: pewność bootstrapowa', () => {
  it('wyraźny profil dwugarbny: LVN w dolinie z pewnością ≥ 0,9', () => {
    const bars = swing(300, 40, 7, bimodal);
    const p = swingProfile(bars, 0, bars.length - 1, 24, 0.7)!;
    expect(p.lvn.length).toBeGreaterThan(0);
    const top = p.lvn[0];
    expect(top.px).toBeGreaterThan(104);
    expect(top.px).toBeLessThan(108);
    const conf = swingLvnConfidence(bars, p);
    expect(conf[0]).toBeGreaterThanOrEqual(0.9);
  });

  it('zaszumiony profil jednogarbny: LVN z szumu mają pewność < 0,7 w większości ziaren', () => {
    // Środki świec z N(106, 2), wąskie świece (4 wiersze) o wolumenie z grubym ogonem: minima z samego szumu
    const g = noiseRun((rnd) => 106 + 2 * normal(rnd), 4, 2.5);
    expect(g.all).toBeGreaterThan(0);
    expect(g.seeds).toBeGreaterThanOrEqual(0.8);
    expect(g.low).toBeGreaterThanOrEqual(0.8);
    // Profil płaski (środki jednostajnie w 100–112) z tym samym szumem: też w większości ziaren bez pewnego LVN
    const f = noiseRun((rnd) => 100 + 12 * rnd(), 8, 2);
    expect(f.all).toBeGreaterThan(0);
    expect(f.seeds).toBeGreaterThanOrEqual(0.8);
    expect(f.low).toBeGreaterThanOrEqual(0.8);
    console.info(`szum: jednogarbny ${g.all} LVN, ${g.low * 100}% < 70%; płaski ${f.all} LVN, ${Math.round(f.low * f.all)} < 70%`);
  });

  it('to samo ziarno daje ten sam wynik; inne ziarno najwyżej trochę inny', () => {
    const bars = swing(120, 20, 3, bimodal);
    const p = swingProfile(bars, 0, bars.length - 1, 24, 0.7)!;
    const a = swingLvnConfidence(bars, p, { seed: 42 });
    expect(swingLvnConfidence(bars, p, { seed: 42 })).toEqual(a);
    expect(swingLvnConfidence(bars, p)).toEqual(swingLvnConfidence(bars, p));
    const b = swingLvnConfidence(bars, p, { seed: 43 });
    b.forEach((x, i) => expect(Math.abs(x - a[i])).toBeLessThan(0.15));
  });

  it('jednostki z jedną świecą każda: bez LVN pewność pusta, bootstrap blokami tej samej długości co profil', () => {
    const ub = unitsBuilder(10);
    for (let i = 0; i < 10; i++) {
      ub.add(i, 1);
      ub.next();
    }
    const u = ub.done();
    expect(lvnConfidence(u, 0.7, [])).toEqual([]);
    // Blok = cały profil: każda replika to ten sam profil, więc pewność 0 albo 1
    const c = lvnConfidence(u, 0.7, [5], { block: 10 });
    expect(c[0] === 0 || c[0] === 1).toBe(true);
  });

  it('profil tygodnia ze świec: LVN z pewnością i filtr progu 70%', () => {
    const rnd = mulberry32(11);
    const lo: number[] = [];
    const hi: number[] = [];
    const vol: number[] = [];
    // Dwa garby po 4% i pusta dolina 0,5% (ok. 5 koszyków 10 bp, tyle co okno wygładzania)
    for (let i = 0; i < 2016; i++) {
      const c = 600 * (rnd() < 0.5 ? 100 + 4 * rnd() : 104.5 + 4 * rnd());
      lo.push(c);
      hi.push(c * 1.001);
      vol.push(1 + rnd());
    }
    const lv = profileLevels(lo, hi, vol, 10, true)!;
    expect(lv.lvn.length).toBeGreaterThan(0);
    expect(lv.lvn[0].px).toBeGreaterThan(104 * 600);
    expect(lv.lvn[0].px).toBeLessThan(104.6 * 600);
    expect(lv.lvn[0].confidence).toBeGreaterThanOrEqual(0.9);
    expect(confidentLvn([{ confidence: 0.69 }, { confidence: 0.7 }])).toEqual([{ confidence: 0.7 }]);
  });
});

describe('LVN: podpisy P/b', () => {
  it('linia LVN z pewnością, inne poziomy bez; legenda z liczbą LVN ponad progiem', () => {
    expect(lineText({ px: 65_200, name: 'LVN', tag: 'tydz.', conf: 0.84 }, false)).toBe(`tydz. LVN ${fmtPx(65_200)} · pewność 84%`);
    expect(lineText({ px: 65_200, name: 'LVN', tag: 'tydz.', conf: 0.84 }, true)).toBe('tydz. LVN 84%');
    expect(lineText({ px: 65_200, name: 'VAH', tag: 'tydz.', conf: null }, false)).toBe(`tydz. VAH ${fmtPx(65_200)}`);
    expect(weekLvnText(1, 3)).toBe('LVN tyg. z pewnością ≥ 70%: 1 z 3');
  });
});

/** Mediana czasu `runs` wywołań (ms) po jednym rozgrzewającym. */
function medianMs(runs: number, f: (i: number) => void): number {
  f(0);
  const ms: number[] = [];
  for (let i = 1; i <= runs; i++) {
    const t0 = performance.now();
    f(i);
    ms.push(performance.now() - t0);
  }
  ms.sort((a, b) => a - b);
  return ms[runs >> 1];
}

describe('LVN: koszt bootstrapu', () => {
  it('200 replik na swingu 300 świec × 40 wierszy i na tygodniu 2016 świec 5m', () => {
    const bars = swing(300, 40, 5, bimodal);
    const p = swingProfile(bars, 0, bars.length - 1, 24, 0.7)!;
    expect(p.lvn.length).toBeGreaterThan(0);
    const swingMs = medianMs(15, (i) => swingLvnConfidence(bars, p, { seed: i + 1 }));
    const rnd = mulberry32(2);
    const lo: number[] = [];
    const hi: number[] = [];
    const vol: number[] = [];
    for (let i = 0; i < 2016; i++) {
      const c = 600 * (rnd() < 0.5 ? 100 + 4 * rnd() : 104.5 + 4 * rnd());
      lo.push(c);
      hi.push(c * (1 + 0.002 * rnd()));
      vol.push(1 + rnd());
    }
    expect(profileLevels(lo, hi, vol, 10, true)!.lvn.length).toBeGreaterThan(0);
    const weekMs = medianMs(15, () => profileLevels(lo, hi, vol, 10, true));
    console.info(`LVN bootstrap 200 replik (mediana z 15): swing 300×40 ${swingMs.toFixed(2)} ms, tydzień 2016 świec ${weekMs.toFixed(2)} ms`);
    // Luźny próg (CI bywa wolne): oba poniżej klatki 60 Hz z zapasem na wolną maszynę
    expect(swingMs).toBeLessThan(100);
    expect(weekMs).toBeLessThan(200);
  });
});
