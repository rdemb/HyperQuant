import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../../utils/pathEngine';
import { fmtPx } from '../chart/layout';
import { lvnLabel } from '../chart/lvnText';
import { lineText, weekLvnText } from '../chart/pbRangeLayer';
import { readFileSync } from 'node:fs';
import { type VBar, swingLvnTest, swingProfile } from '../core/effortZones';
import type { IndicatorBar } from '../core/indicators';
import { LVN_CALIBRATION, LVN_LOCATION_MIN, LVN_P_MAX, blockFor, lvnLocation, lvnNodes, minUnits, nullDepths, nullSpec, nullUnits, pValue, shownLvn, unitsBuilder } from '../core/lvn';
import { profileLevels } from '../core/pbRanges';
import { periodLvn } from '../core/periodLvn';
import { EFFORT_LVN, PB_LVN, PERIOD_LVN } from '../chart/lvnText';
import { SIM_SPECS, calibrate, normal } from './lvnSim';

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

/**
 * Swing z `n` świec 1m po `rows` wierszy co 0,05: środek świecy z `center(rnd)`, wolumen wiersza losowy, a cała świeca
 * skalowana przez exp(`sig` × N(0, 1)).
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

/** Dwa garby wolumenu (101–104 i 108–111) i rzadkie transakcje w dolinie 104–108. */
const bimodal = (rnd: () => number) => {
  const u = rnd();
  if (u < 0.04) return 104 + 4 * rnd();
  return u < 0.52 ? 101 + 3 * rnd() : 108 + 3 * rnd();
};

/** Świece 5m tygodnia (2016) ze środkami z `center` i zakresem 0,1%: tablice dołków, szczytów i wolumenów. */
function week(seed: number, center: (rnd: () => number) => number): { lo: number[]; hi: number[]; vol: number[] } {
  const rnd = mulberry32(seed);
  const lo: number[] = [];
  const hi: number[] = [];
  const vol: number[] = [];
  for (let i = 0; i < 2016; i++) {
    const c = 600 * center(rnd);
    lo.push(c);
    hi.push(c * 1.001);
    vol.push(1 + rnd());
  }
  return { lo, hi, vol };
}

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

describe('LVN: węzeł a obszar', () => {
  it('wąska dolina (do 5 koszyków) to węzeł LVN, linia', () => {
    const prof = [0, 0, 0, ...new Array(10).fill(100), 0, 0, 0, ...new Array(10).fill(100), 0, 0, 0];
    const [n] = lvnNodes(prof, 3, prof.length - 4, 8);
    expect(n).toMatchObject({ bin: 13, kind: 'node' });
    expect(n.hi - n.lo + 1).toBeLessThanOrEqual(5);
  });

  it('dolina na 38 koszyków to obszar LVA; położenie liczone jak strefa (LVN repliki gdziekolwiek w dolinie), p ≤ 0,05', () => {
    // Profil tygodnia: garby 101–104 i 108–111 (× 600), rzadki handel w dolinie 104–108, czyli ok. 38 koszyków 10 bp
    const w = week(11, bimodal);
    const lv = profileLevels(w.lo, w.hi, w.vol, 10, true)!;
    const area = lv.lvn![0];
    expect(area.kind).toBe('area');
    expect(area.hi - area.lo + 1).toBeGreaterThan(20);
    expect(area.pxLo).toBeLessThan(104.5 * 600);
    expect(area.pxHi).toBeGreaterThan(107.5 * 600);
    // Regułą węzła (±1 koszyk) położenie wynosiło 0,47; jako obszar dolina jest w każdej replice
    expect(area.location).toBe(1);
    expect(area.p).toBeLessThanOrEqual(LVN_P_MAX);
    expect(area.depth).toBeGreaterThan(0.8);
    // Próg ATR: ta sama dolina przy ATR szerszym niż dolina (0,25 ATR > szerokość) jest węzłem
    expect(lvnNodes([0, 0, 0, ...new Array(10).fill(100), ...new Array(8).fill(0), ...new Array(10).fill(100), 0, 0, 0], 3, 27, 8, 40)[0].kind).toBe('node');
  });

  it('wąska pusta dolina tygodnia (ok. 3 koszyki) to węzeł, który przechodzi oba kroki', () => {
    const w = week(11, (rnd) => (rnd() < 0.5 ? 100 + 4 * rnd() : 104.3 + 4 * rnd()));
    const lv = profileLevels(w.lo, w.hi, w.vol, 10, true)!;
    expect(lv.lvn![0]).toMatchObject({ kind: 'node' });
    expect(lv.lvn![0].px).toBeGreaterThan(104 * 600);
    expect(lv.lvn![0].px).toBeLessThan(104.4 * 600);
    expect(shownLvn(lv.lvn!)).toContain(lv.lvn![0]);
  });
});

describe('LVN: filtr położenia i test szumu pomiaru', () => {
  it('bloki ok. 15 min niezależnie od interwału; najmniej 20 świec i 4 bloki', () => {
    expect([60_000, 300_000, 900_000, 3_600_000].map(blockFor)).toEqual([15, 3, 1, 1]);
    expect([15, 3, 1].map(minUnits)).toEqual([60, 20, 20]);
  });

  it('wyraźny profil dwugarbny: LVN w dolinie przechodzi filtr położenia i ma p ≤ 0,05', () => {
    // Bez transakcji w dolinie: przy 15-minutowych skupiskach w hipotezie zerowej rzadki handel w dolinie (4% świec)
    // daje p ≈ 0,1, czyli w granicach szumu pomiaru
    const bars = swing(300, 20, 7, (rnd) => (rnd() < 0.5 ? 101 + 3 * rnd() : 108 + 3 * rnd()));
    const p = swingProfile(bars, 0, bars.length - 1, 24, 0.7)!;
    const top = p.lvn[0];
    expect(top.px).toBeGreaterThan(104);
    expect(top.px).toBeLessThan(108);
    const c = swingLvnTest(bars, p, 60_000);
    if (!('tests' in c)) throw new Error('za krótki swing');
    expect(c.tests[0].location).toBeGreaterThanOrEqual(LVN_LOCATION_MIN);
    expect(c.tests[0].p).toBeLessThanOrEqual(LVN_P_MAX);
  });

  it('swing krótszy niż 4 bloki: bez testu, z liczbą świec', () => {
    const bars = swing(40, 20, 3, bimodal);
    const p = swingProfile(bars, 0, bars.length - 1, 24, 0.7)!;
    expect(swingLvnTest(bars, p, 60_000)).toEqual({ short: { have: 40, need: 60 } });
    expect('tests' in swingLvnTest(bars, p, 300_000)).toBe(true);
  });

  it('to samo ziarno daje ten sam wynik', () => {
    const bars = swing(120, 20, 3, bimodal);
    const p = swingProfile(bars, 0, bars.length - 1, 24, 0.7)!;
    expect(swingLvnTest(bars, p, 60_000, { seed: 42 })).toEqual(swingLvnTest(bars, p, 60_000, { seed: 42 }));
    expect(swingLvnTest(bars, p, 60_000)).toEqual(swingLvnTest(bars, p, 60_000));
  });

  it('bootstrap kołowy: blok długości profilu daje obrót, czyli ten sam profil w każdej replice', () => {
    const ub = unitsBuilder(30);
    for (let i = 0; i < 30; i++) {
      ub.add(i < 12 ? 3 + (i % 8) : i < 18 ? 11 + (i % 2) : 18 + (i % 8), i >= 12 && i < 18 ? 0.01 : 1);
      ub.next();
    }
    const u = ub.done();
    expect(lvnLocation(u, 0.7, [])).toEqual([]);
    const c = lvnLocation(u, 0.7, [{ bin: 13, persistence: 1, depth: 1, lo: 13, hi: 15, kind: 'node' }], { block: 30 });
    expect(c[0] === 0 || c[0] === 1).toBe(true);
  });
});

describe('LVN: kalibracja testu (a) na SIM', () => {
  it('w każdej z 10 klas (po 200 płaskich profili) najwyżej 5% fałszywych LVN przechodzi filtr i p ≤ 0,05; zgodna z zapisem', () => {
    const c = calibrate(SIM_SPECS, LVN_CALIBRATION.profiles);
    expect(c).toEqual(LVN_CALIBRATION.classes);
    expect(c).toHaveLength(10);
    for (const k of c) {
      expect(k.lvn, k.name).toBeGreaterThan(0);
      expect(k.shown / k.lvn, k.name).toBeLessThanOrEqual(0.05);
    }
  }, 60_000);

  it('p: udział dolin zerowych co najmniej tak głębokich (z jedynką w liczniku i mianowniku); rozkład zerowy pamiętany', () => {
    const nul = Float64Array.from([0.1, 0.2, 0.3, 0.9]);
    expect(pValue(0.95, nul)).toBeCloseTo(1 / 5, 12);
    expect(pValue(0.3, nul)).toBeCloseTo(3 / 5, 12);
    expect(pValue(0, nul)).toBe(1);
    const spec = { n: 120, nb: 24, span: 2, volSig: 1, block: 15 };
    expect(nullDepths(spec, 0.7, 5)).toBe(nullDepths(spec, 0.7, 5));
    // Parametry SIM z profilu: rozpiętość świecy i rozrzut wolumenu wracają z jednostek
    expect(nullSpec(nullUnits({ ...spec, span: 3 }, 1), 15)).toMatchObject({ n: 120, nb: 24, span: 3, volSig: 1 });
  });
});

/** Świeca okresu z footprintem: wiersze co 1 od `lo` z wolumenem `v` na wierszu. */
function fpBar(t: number, lo: number, rows: number, v: number): IndicatorBar {
  const buy = new Float64Array(rows).fill(v / 2);
  const sell = new Float64Array(rows).fill(v / 2);
  const candle = { t, o: lo, h: lo + rows - 1, l: lo, c: lo + rows - 1, v: v * rows, n: rows };
  return { t, candle, complete: true, fp: { t, tick: 1, lo, buy, sell, delta: 0 } as unknown as IndicatorBar['fp'] };
}

describe('LVN profilu okresu (sesja, doba)', () => {
  it('sesja 1m z taśmy: LVN po testach w dolinie, okres w toku oznaczony; za krótka — bez LVN z liczbą świec', () => {
    const rnd = mulberry32(5);
    const bars = Array.from({ length: 480 }, (_, i) => fpBar(i * 60_000, rnd() < 0.5 ? 60_000 + Math.floor(150 * rnd()) : 60_300 + Math.floor(150 * rnd()), 20, 1 + rnd()));
    const r = periodLvn(bars, 0, bars.length - 1, 60_000, true)!;
    expect(r.building).toBe(true);
    const kept = shownLvn(r.lvn!);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept[0].pxLo).toBeGreaterThanOrEqual(60_150);
    expect(kept[0].pxHi).toBeLessThanOrEqual(60_330);
    expect(periodLvn(bars, 0, 39, 60_000, true)).toMatchObject({ lvn: null, have: 40, need: 60 });
  });
});

describe('LVN: podpisy', () => {
  it('P/b: linia LVN z głębokością i p, LVA z zakresem doliny, inne poziomy bez; legenda węzłów i obszarów', () => {
    const t = { depth: 0.62, p: 0.03 };
    expect(lineText({ px: 65_200, name: 'LVN', tag: 'tydz.', test: t }, false)).toBe(`tydz. LVN ${fmtPx(65_200)} · głęb. 62% · p = 0,03`);
    expect(lineText({ px: 65_200, name: 'LVA', tag: 'tydz.', test: { depth: 0.8, p: 0.004 }, lo: 65_100, hi: 65_300 }, false)).toBe(`tydz. LVA ${fmtPx(65_100)}–${fmtPx(65_300)} · głęb. 80% · p = 0,004`);
    expect(lineText({ px: 65_200, name: 'LVN', tag: 'tydz.', test: t }, true)).toBe('tydz. LVN p = 0,03');
    expect(lineText({ px: 65_200, name: 'VAH', tag: 'tydz.', test: null }, false)).toBe(`tydz. VAH ${fmtPx(65_200)}`);
    const lv = [
      { kind: 'node' as const, location: 1, p: 0.01 },
      { kind: 'area' as const, location: 0.9, p: 0.05 },
      { kind: 'node' as const, location: 1, p: 0.2 },
      { kind: 'node' as const, location: 0.3, p: 0.01 },
    ];
    expect(weekLvnText(lv)).toBe('LVN tyg. z p ≤ 0,05: 1 LVN (węzeł), 1 LVA (obszar) z 4 · test wobec losowych ścieżek: w przygotowaniu');
    expect(weekLvnText(null)).toBe('LVN tyg.: —, za mało świec do testu');
    expect(weekLvnText([])).toBeNull();
  });

  it('profil okresu: „LVN (węzeł)” i „LVA (obszar)” z głębokością i p, okres w toku „profil w budowie”', () => {
    const base = { px: 65_200, pxLo: 65_100, pxHi: 65_300, depth: 0.62, p: 0.0004 };
    const fmt = (p: number) => String(p);
    expect(lvnLabel({ ...base, kind: 'node' }, false, false, fmt)).toBe('LVN (węzeł) 65200 · głębokość 62% · p < 0,001');
    expect(lvnLabel({ ...base, kind: 'area', p: 0.03 }, true, false, fmt)).toBe('LVA (obszar) 65100–65300 · głębokość 62% · p = 0,03 · profil w budowie');
    expect(lvnLabel({ ...base, kind: 'node', p: 0.03 }, false, true, fmt)).toBe('LVN p = 0,03');
  });

  it('bez słowa „pewność” w tekstach LVN (liczba bootstrapu to filtr, nie miara istotności)', () => {
    for (const t of [PB_LVN, EFFORT_LVN, PERIOD_LVN]) {
      expect(t.pl).not.toMatch(/pewno/i);
      expect(t.en).not.toMatch(/confidence/i);
      expect(t.pl).toMatch(/test wobec losowych ścieżek/i);
    }
    const files = ['../chart/lvnText.ts', '../chart/effortLayer.ts', '../chart/pbRangeLayer.ts', '../chart/overlay.ts', '../chart/layerSources.ts', '../indicators/cards.ts', '../indicators/registry.ts'];
    for (const f of files) expect(readFileSync(new URL(f, import.meta.url), 'utf8'), f).not.toMatch(/pewno|confidence/i);
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
  it('200 replik: swing 300 × 40 wierszy (1m), tydzień 2016 świec 5m, sesja 480 świec 1m z taśmy', () => {
    const bars = swing(300, 40, 5, bimodal);
    const p = swingProfile(bars, 0, bars.length - 1, 24, 0.7)!;
    expect(p.lvn.length).toBeGreaterThan(0);
    const swingMs = medianMs(15, (i) => swingLvnTest(bars, p, 60_000, { seed: i + 1 }));
    const w = week(2, (rnd) => (rnd() < 0.5 ? 100 + 4 * rnd() : 104.5 + 4 * rnd()));
    expect(profileLevels(w.lo, w.hi, w.vol, 10, true)!.lvn!.length).toBeGreaterThan(0);
    const weekMs = medianMs(15, () => profileLevels(w.lo, w.hi, w.vol, 10, true));
    const rnd = mulberry32(9);
    const ses = Array.from({ length: 480 }, (_, i) => fpBar(i * 60_000, rnd() < 0.5 ? 60_000 + Math.floor(150 * rnd()) : 60_300 + Math.floor(150 * rnd()), 40, 1 + rnd()));
    expect(periodLvn(ses, 0, 479, 60_000, false)!.lvn!.length).toBeGreaterThan(0);
    const sesMs = medianMs(15, () => periodLvn(ses, 0, 479, 60_000, false));
    // Rozkład zerowy testu (a) na zimno (nowe parametry; potem z pamięci): 300 profili SIM
    const cold = (n: number, nb: number) => medianMs(5, (i) => nullDepths({ n, nb, span: 2, volSig: 1 + i / 1000, block: 3 }, 0.7, 5));
    const nullSwingMs = cold(300, 24);
    const nullWeekMs = cold(2016, 80);
    console.info(
      `LVN 200 replik i p (mediana z 15, rozkład zerowy z pamięci): swing 300×40 ${swingMs.toFixed(2)} ms, tydzień 2016 świec ${weekMs.toFixed(2)} ms, sesja 480×40 ${sesMs.toFixed(2)} ms; rozkład zerowy na zimno: swing ${nullSwingMs.toFixed(1)} ms, tydzień ${nullWeekMs.toFixed(1)} ms`
    );
    expect(nullWeekMs).toBeLessThan(500);
    // Luźny próg (CI bywa wolne)
    expect(swingMs).toBeLessThan(100);
    expect(weekMs).toBeLessThan(200);
    expect(sesMs).toBeLessThan(200);
  });
});
