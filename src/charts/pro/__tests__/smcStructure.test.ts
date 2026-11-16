import { describe, expect, it } from 'vitest';
import { DEFAULT_SMC_PARAMS, type SBar, type SmcResult, fvgFill, isPivot, smcStructure, stateAt, wilderAtr } from '../core/smcStructure';

/**
 * Szkielet SMC (S0): swingi z filtrem amplitudy, struktura, BOS i CHoCH tylko zamknięciem, sweep z oknem powrotu, FVG
 * z wypełnieniem, CE i wygaśnięciem, EQH i EQL oraz brak wglądu w przyszłość. Sztuczne świece ze znanymi odpowiedziami.
 */

const MS = 5 * 60_000;
const T0 = Date.UTC(2026, 10, 16, 0, 0);
type Row = [number, number, number, number];

const mk = (rows: readonly Row[]): SBar[] => rows.map(([o, h, l, c], i) => ({ t: T0 + i * MS, o, h, l, c }));
/** Płaskie świece (H − L = 1, bez pivotów: remisy z lewej): ATR po 14 świecach równe 1. */
const flat = (n: number, p = 100): Row[] => Array.from({ length: n }, () => [p, p + 0.5, p - 0.5, p] as Row);
/** Noga od `from` do `to` krokami `step` (bez świecy startowej): korpus od poprzedniego zamknięcia, knoty po 0,1. */
function leg(from: number, to: number, step = 0.5): Row[] {
  const out: Row[] = [];
  const n = Math.round(Math.abs(to - from) / step);
  let o = from;
  for (let k = 1; k <= n; k++) {
    const c = from + ((to - from) * k) / n;
    out.push([o, Math.max(o, c) + 0.1, Math.min(o, c) - 0.1, c]);
    o = c;
  }
  return out;
}
/** Ścieżka zamknięć przez kolejne punkty (po płaskim rozbiegu przy pierwszym punkcie). */
const path = (pts: number[], warm = 20, step = 0.5): Row[] => [...flat(warm, pts[0]), ...pts.slice(1).flatMap((p, k) => leg(pts[k], p, step))];
const closeAt = (bars: readonly SBar[], i: number) => bars[i].t + MS;
/** Spokojne świece (zakres 0,1) przy cenie p: bez knotów sięgających poziomów testu. */
const calm = (n: number, p: number): Row[] => Array.from({ length: n }, () => [p, p + 0.05, p - 0.05, p] as Row);

describe('pivoty (okno L)', () => {
  const hs = (h: number[]): SBar[] => h.map((x, i) => ({ t: T0 + i * MS, o: x - 0.5, h: x, l: x - 1, c: x - 0.5 }));

  it('szczyt ściśle wyższy z lewej, nie niższy z prawej: remis wygrywa wcześniejsza świeca', () => {
    const b = hs([1, 2, 3, 5, 5, 4, 3, 2, 1]);
    expect(isPivot(b, 3, 3, 1)).toBe(true);
    expect(isPivot(b, 4, 3, 1)).toBe(false);
    // Wyższa świeca z prawej odbiera pivot; bez pełnego okna — brak
    expect(isPivot(hs([1, 2, 3, 5, 4, 6, 3, 2, 1]), 3, 3, 1)).toBe(false);
    expect(isPivot(b, 2, 3, 1)).toBe(false);
    expect(isPivot(hs([1, 2, 3, 5, 4, 3]), 3, 3, 1)).toBe(false);
  });

  it('dołek lustrzanie', () => {
    const b = [9, 8, 7, 5, 5, 6, 7, 8, 9].map((x, i) => ({ t: T0 + i * MS, o: x + 0.5, h: x + 1, l: x, c: x + 0.5 }));
    expect(isPivot(b, 3, 3, -1)).toBe(true);
    expect(isPivot(b, 4, 3, -1)).toBe(false);
  });

  it('pivot znany od zamknięcia świecy j + L (skala wewnętrzna 3, swingowa 10)', () => {
    const bars = mk(path([100, 105, 99]));
    const r = smcStructure(bars, MS);
    const top = r.pivots.filter((p) => p.dir === 1);
    expect(top.map((p) => [p.scale, p.price])).toEqual([
      ['internal', 105.1],
      ['swing', 105.1],
    ]);
    for (const p of top) expect(p.known).toBe(closeAt(bars, p.idx + (p.scale === 'internal' ? 3 : 10)));
    expect(DEFAULT_SMC_PARAMS).toMatchObject({ internalLen: 3, swingLen: 10, atrLen: 14 });
  });

  it('ATR Wildera(14): NaN przed 14 świecami, przy stałym zakresie równy zakresowi', () => {
    const a = wilderAtr(mk(flat(20)), 14);
    expect(Number.isNaN(a[12])).toBe(true);
    expect(a[13]).toBe(1);
    expect(a[19]).toBe(1);
  });
});

describe('swingi, filtr amplitudy i struktura', () => {
  // Wewnętrzna skala: szczyty 105,1 → 108,1 → 110,1, dołki 101,9 → 103,9, potem spadek pod 103,9
  const bars = mk(path([100, 105, 102, 108, 104, 110, 100, 103]));
  const r = smcStructure(bars, MS);
  const internal = r.swings.filter((s) => s.scale === 'internal');

  it('HH i HL w kolejności, pierwsze swingi bez etykiety; stan „wzrostowa” po HH i HL', () => {
    expect(internal.map((s) => [s.price, s.label])).toEqual([
      [105.1, null],
      [101.9, null],
      [108.1, 'HH'],
      [103.9, 'HL'],
      [110.1, 'HH'],
      [99.9, 'LL'],
    ]);
    const hl = internal[3];
    expect(stateAt(r, 'internal', hl.known - 1)).toBe('mixed');
    expect(stateAt(r, 'internal', hl.known)).toBe('up');
  });

  it('BOS przy przełamaniu zgodnym ze stanem, CHoCH przy przeciwnym (zmienia stan na „mieszana”); tylko zamknięciem', () => {
    const br = r.breaks.filter((b) => b.scale === 'internal');
    expect(br.map((b) => [b.kind, b.dir, b.level])).toEqual([
      ['BOS', 1, 105.1],
      ['BOS', 1, 108.1],
      ['CHoCH', -1, 103.9],
    ]);
    for (const b of br) {
      expect(b.dir * (bars[b.idx].c - b.level)).toBeGreaterThan(0);
      // Pierwsze zamknięcie za poziomem, wcześniej żadnego
      for (let k = b.idx - 1; k >= 0 && bars[k].t + MS > b.swingKnown; k--) expect(b.dir * (bars[k].c - b.level)).toBeLessThanOrEqual(0);
      expect(b.known).toBe(closeAt(bars, b.idx));
      expect(b.known).toBeGreaterThan(b.swingKnown);
    }
    const choch = br[2];
    expect(stateAt(r, 'internal', choch.known - 1)).toBe('up');
    expect(stateAt(r, 'internal', choch.known)).toBe('mixed');
  });

  it('filtr amplitudy: drobne wahnięcie (< 1 ATR) nie jest swingiem, a szczyt po nim zastępuje poprzedni (zostaje skrajniejszy)', () => {
    // 100 → 105, cofka 0,5 do dołka 104,6 (pivot wewnętrzny), potem 106 i spadek do 100
    const dip: Row[] = [
      [105, 105.05, 104.9, 105],
      [105, 105.05, 104.85, 104.9],
      [104.9, 104.95, 104.7, 104.75],
      [104.75, 104.8, 104.6, 104.65],
      [104.65, 104.9, 104.62, 104.85],
      [104.85, 105, 104.75, 104.95],
      [104.95, 105.05, 104.85, 105],
    ];
    const b2 = mk([...path([100, 105]), ...dip, ...leg(105, 106), ...leg(106, 100)]);
    const r2 = smcStructure(b2, MS);
    const sw = r2.swings.filter((s) => s.scale === 'internal');
    expect(r2.pivots.some((p) => p.scale === 'internal' && p.dir === -1 && p.price === 104.6)).toBe(true);
    expect(sw.filter((s) => s.dir === -1).map((s) => s.price)).not.toContain(104.6);
    const highs = sw.filter((s) => s.dir === 1);
    expect(highs.map((s) => s.price)).toEqual([105.1, 106.1]);
    expect(highs[0].supersededAt).toBe(highs[1].known);
    // Zastąpiony szczyt nie ma następcy w etykiecie: 106,1 jest pierwszym szczytem po zastąpieniu
    expect(highs[1].label).toBeNull();
  });

  it('remis: równy szczyt to LH, równy dołek to HL (nie „wyższy” ani „niższy”)', () => {
    const b3 = mk(path([100, 105, 102, 105, 102, 104]));
    const sw = smcStructure(b3, MS).swings.filter((s) => s.scale === 'internal');
    expect(sw.map((s) => [s.price, s.label])).toEqual([
      [105.1, null],
      [101.9, null],
      [105.1, 'LH'],
      [101.9, 'HL'],
    ]);
  });
});

describe('sweep i przełamanie', () => {
  // Szczyt wewnętrzny 103,1 (nieprzełamany), dołek 100,9, odbicie do 102,5
  const base = path([100, 103, 101, 102.5]);
  const level = 103.1;
  const run = (extra: Row[]) => {
    const bars = mk([...base, ...extra]);
    return { bars, r: smcStructure(bars, MS), s: base.length };
  };

  it('knot za szczytem (≥ 0,05 ATR) z zamknięciem z powrotem: sweep, nie BOS', () => {
    const { bars, r, s } = run([[102.5, 103.6, 102.4, 102.8], ...calm(4, 102.8)]);
    const up = r.sweeps.filter((x) => x.dir === 1);
    expect(up).toHaveLength(1);
    expect(up[0]).toMatchObject({ level, idx: s, returnIdx: s, known: closeAt(bars, s), sources: ['internal'] });
    expect(r.breaks.filter((b) => b.dir === 1 && b.level === level)).toEqual([]);
  });

  it('knot poniżej progu 0,05 ATR to nie sweep', () => {
    const { r } = run([[102.5, level + 0.02, 102.4, 102.8], ...calm(4, 102.8)]);
    expect(r.sweeps.filter((x) => x.dir === 1)).toEqual([]);
  });

  it('zamknięcie za szczytem to BOS; powrót w ciągu 2 świec dopisuje sweep znany od zamknięcia świecy powrotu', () => {
    const { bars, r, s } = run([
      [102.5, 103.6, 102.4, 103.3],
      [103.3, 103.5, 103.15, 103.2],
      [103.2, 103.3, 102.6, 102.7],
      ...calm(4, 102.7),
    ]);
    expect(r.breaks.filter((b) => b.dir === 1).map((b) => [b.level, b.idx])).toEqual([[level, s]]);
    expect(r.sweeps.filter((x) => x.dir === 1)).toEqual([expect.objectContaining({ level, idx: s, returnIdx: s + 2, known: closeAt(bars, s + 2) })]);
  });

  it('powrót dopiero w trzeciej świecy po knocie: bez sweepu', () => {
    const { r } = run([[102.5, 103.6, 102.4, 103.3], [103.3, 103.5, 103.15, 103.2], [103.2, 103.4, 103.15, 103.25], [103.25, 103.3, 102.6, 102.7], ...calm(4, 102.7)]);
    expect(r.sweeps.filter((x) => x.dir === 1)).toEqual([]);
    expect(r.breaks.filter((b) => b.dir === 1)).toHaveLength(1);
  });
});

describe('FVG', () => {
  const pre = flat(20);
  // Luka w górę [100,5; 100,8] (szerokość 0,3 ≈ 0,27 ATR)
  const gap: Row[] = [
    [100, 100.5, 99.5, 100.2],
    [100.2, 102, 100.1, 101.8],
    [101.8, 102.5, 100.8, 102.3],
  ];
  const gi = pre.length + 2;
  const hold = (n: number) => flat(n, 102.3).map(([o, h, , c]) => [o, h, 101.5, c] as Row);

  it('wykrycie: low trzeciej > high pierwszej, znana od zamknięcia trzeciej', () => {
    const bars = mk([...pre, ...gap, ...hold(3)]);
    const f = smcStructure(bars, MS).fvgs;
    expect(f).toEqual([expect.objectContaining({ dir: 1, lo: 100.5, hi: 100.8, idx: gi, known: closeAt(bars, gi), filledAt: null, ceAt: null })]);
  });

  it('próg 0,1 ATR: luka 0,05 nie powstaje', () => {
    const narrow: Row[] = [gap[0], gap[1], [101.8, 102.5, 100.55, 102.3]];
    expect(smcStructure(mk([...pre, ...narrow, ...hold(3)]), MS).fvgs).toEqual([]);
  });

  it('luka w dół lustrzanie', () => {
    const down: Row[] = [
      [100, 100.5, 99.5, 99.8],
      [99.8, 99.9, 98, 98.2],
      [98.2, 99.2, 97.5, 97.7],
    ];
    expect(smcStructure(mk([...pre, ...down]), MS).fvgs).toEqual([expect.objectContaining({ dir: -1, lo: 99.2, hi: 99.5 })]);
  });

  it('wypełnienie w procentach od strony ceny, CE przy dotknięciu środka, „wypełniona” po przejściu całej luki', () => {
    const dips: Row[] = [
      [102.3, 102.4, 100.7, 102],
      [102, 102.2, 100.65, 102],
      [102, 102.2, 100.5, 102],
    ];
    const bars = mk([...pre, ...gap, ...dips]);
    const r = smcStructure(bars, MS);
    const f = r.fvgs[0];
    expect(fvgFill(f, bars, MS, closeAt(bars, gi))).toBe(0);
    expect(fvgFill(f, bars, MS, closeAt(bars, gi + 1))).toBeCloseTo(1 / 3, 9);
    expect(f.ceAt).toBe(closeAt(bars, gi + 2));
    expect(fvgFill(f, bars, MS, closeAt(bars, gi + 2))).toBeCloseTo(0.5, 9);
    expect(f.filledAt).toBe(closeAt(bars, gi + 3));
    expect(fvgFill(f, bars, MS, closeAt(bars, gi + 3))).toBe(1);
  });

  it('wygasa 24 h od chwili, gdy była znana: późniejsze wejście ceny nie liczy się', () => {
    const life = DEFAULT_SMC_PARAMS.fvgLifeMs / MS;
    const bars = mk([...pre, ...gap, ...hold(life), [102.3, 102.4, 100.4, 102]]);
    const f = smcStructure(bars, MS).fvgs[0];
    expect(f.expiresAt).toBe(f.known + DEFAULT_SMC_PARAMS.fvgLifeMs);
    expect([f.filledAt, f.ceAt]).toEqual([null, null]);
    expect(fvgFill(f, bars, MS, closeAt(bars, bars.length - 1))).toBe(0);
    // Ta sama świeca godzinę wcześniej wypełnia lukę
    const early = mk([...pre, ...gap, ...hold(life - 12), [102.3, 102.4, 100.4, 102]]);
    expect(smcStructure(early, MS).fvgs[0].filledAt).toBe(closeAt(early, early.length - 1));
  });
});

describe('EQH i EQL', () => {
  // Dwa szczyty 102,1 i 102,14 (różnica 0,04 ≤ 0,1 ATR), odstęp `gapBars` świec, bez zamknięcia nad poziomem między nimi
  const twin = (second: number, depth = 1.5): SBar[] => mk([...path([100, 102, 102 - depth, second, 100])]);

  it('dwa pivoty wewnętrzne w tolerancji, ≥ 5 świec, poziom to średnia; znany od potwierdzenia drugiego', () => {
    const bars = twin(102.04);
    const r = smcStructure(bars, MS);
    expect(r.eqs).toHaveLength(1);
    const e = r.eqs[0];
    expect(e.dir).toBe(1);
    expect(e.level).toBeCloseTo((102.1 + 102.14) / 2, 9);
    expect(e.b.idx - e.a.idx).toBe(6);
    expect(e.known).toBe(closeAt(bars, e.b.idx + 3));
  });

  it('za duża różnica (> 0,1 ATR) albo za mały odstęp (< 5 świec): brak', () => {
    expect(smcStructure(twin(102.3), MS).eqs).toEqual([]);
    const near = mk(path([100, 102, 101, 102.04, 100]));
    const r = smcStructure(near, MS);
    const tops = r.pivots.filter((p) => p.scale === 'internal' && p.dir === 1);
    expect(tops.map((p) => p.idx)).toHaveLength(2);
    expect(tops[1].idx - tops[0].idx).toBe(4);
    expect(r.eqs).toEqual([]);
  });

  it('EQH z surowych pivotów: bez dołka ≥ 1 ATR między szczytami struktura zostawia tylko skrajniejszy, a EQH i tak powstaje', () => {
    const bars = mk(path([100, 102, 101.5, 102, 101.5, 102.04, 100], 20, 0.25));
    const r = smcStructure(bars, MS);
    const highs = r.swings.filter((s) => s.scale === 'internal' && s.dir === 1);
    expect(highs.map((s) => [s.price, s.supersededAt !== null])).toEqual([
      [102.1, true],
      [102.14, false],
    ]);
    expect(r.eqs.map((e) => [e.a.price, e.b.price])).toEqual([[102.1, 102.14]]);
  });

  it('kończy się zamknięciem nad poziomem (przełamanie) albo sweepem (knot i powrót)', () => {
    const tail = (row: Row): SBar[] => mk([...path([100, 102, 100.5, 102.04, 100.5]), row, ...calm(3, 101.8)]);
    const broken = smcStructure(tail([100.5, 102.4, 100.4, 102.3]), MS).eqs[0];
    expect(broken.end).toBe('broken');
    const sb = tail([100.5, 102.4, 100.4, 101.9]);
    const rs = smcStructure(sb, MS);
    expect(rs.eqs[0]).toMatchObject({ end: 'swept', endAt: closeAt(sb, sb.length - 4) });
    expect(rs.sweeps.some((s) => s.sources.includes('eq'))).toBe(true);
  });
});

/** Stan wyniku w chwili `asOf`: elementy znane do niej, chwile zdarzeń późniejszych wyzerowane. */
function view(r: SmcResult, asOf: number) {
  const at = (x: number | null) => (x !== null && x <= asOf ? x : null);
  return {
    pivots: r.pivots.filter((p) => p.known <= asOf),
    swings: r.swings.filter((s) => s.known <= asOf).map((s) => ({ ...s, supersededAt: at(s.supersededAt), brokenAt: at(s.brokenAt), sweptAt: at(s.sweptAt) })),
    breaks: r.breaks.filter((b) => b.known <= asOf),
    sweeps: r.sweeps.filter((s) => s.known <= asOf),
    fvgs: r.fvgs.filter((f) => f.known <= asOf).map((f) => ({ ...f, filledAt: at(f.filledAt), ceAt: at(f.ceAt) })),
    eqs: r.eqs.filter((e) => e.known <= asOf).map((e) => ({ ...e, endAt: at(e.endAt), end: at(e.endAt) === null ? null : e.end })),
    states: r.states.filter((s) => s.known <= asOf),
  };
}

/** Błądzenie losowe z ziarnem (mulberry32): świece z korpusem i knotami. */
export function walk(n: number, seed = 7): SBar[] {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: SBar[] = [];
  let c = 100;
  for (let i = 0; i < n; i++) {
    const o = c;
    c = Math.round((o + (rnd() - 0.5) * 1.6) * 100) / 100;
    const h = Math.round((Math.max(o, c) + rnd() * 0.5) * 100) / 100;
    const l = Math.round((Math.min(o, c) - rnd() * 0.5) * 100) / 100;
    out.push({ t: T0 + i * MS, o, h, l, c });
  }
  return out;
}

describe('bez wglądu w przyszłość', () => {
  const bars = walk(700);
  const full = smcStructure(bars, MS);

  it('na losowych świecach są wszystkie rodzaje elementów', () => {
    for (const k of ['swings', 'breaks', 'sweeps', 'fvgs', 'eqs'] as const) expect(full[k].length, k).toBeGreaterThan(0);
    expect(full.breaks.some((b) => b.kind === 'CHoCH')).toBe(true);
    expect(full.fvgs.some((f) => f.ceAt !== null)).toBe(true);
  });

  it('known ≥ zamknięcie ostatniej świecy, której reguła użyła', () => {
    for (const p of full.pivots) expect(p.known).toBe(closeAt(bars, p.idx + (p.scale === 'internal' ? 3 : 10)));
    for (const b of full.breaks) expect(b.known).toBe(closeAt(bars, b.idx));
    for (const s of full.sweeps) expect([s.known, s.returnIdx - s.idx <= 2, s.returnIdx >= s.idx]).toEqual([closeAt(bars, s.returnIdx), true, true]);
    for (const f of full.fvgs) expect(f.known).toBe(closeAt(bars, f.idx));
    for (const e of full.eqs) expect(e.known).toBe(closeAt(bars, e.b.idx + 3));
  });

  it('obcięcie serii na dowolnej świecy nie zmienia niczego, co było znane do niej', () => {
    for (let k = 30; k < bars.length; k += 7) {
      const asOf = closeAt(bars, k);
      expect(view(smcStructure(bars.slice(0, k + 1), MS), asOf), `k=${k}`).toEqual(view(full, asOf));
    }
  });
});
