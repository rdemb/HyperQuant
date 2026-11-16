import { describe, expect, it } from 'vitest';
import { DEFAULT_SMC_PARAMS, type SBar, smcStructure } from '../core/smcStructure';
import { SMC_LIMITS, SMC_OBJECTS_MAX, SMC_PHONE_LIMITS, selectSmc, smcObjects, smcWindowMs } from '../chart/smcSelect';

/** Wybór rysunku SMC: limity obiektów w trybach „bieżące” i „historia 24 h”, telefon, premium i discount, bez wglądu w przyszłość. */

const MS = 5 * 60_000;
const T0 = Date.UTC(2026, 10, 16, 0, 0);
type Row = [number, number, number, number];
const mk = (rows: readonly Row[]): SBar[] => rows.map(([o, h, l, c], i) => ({ t: T0 + i * MS, o, h, l, c }));
const flat = (n: number, p = 100): Row[] => Array.from({ length: n }, () => [p, p + 0.5, p - 0.5, p] as Row);
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
const path = (pts: number[]): Row[] => [...flat(20, pts[0]), ...pts.slice(1).flatMap((p, k) => leg(pts[k], p))];
const last = (bars: readonly SBar[]) => bars[bars.length - 1].t + MS;

/** Błądzenie losowe z ziarnem (mulberry32). */
function walk(n: number, seed = 11): SBar[] {
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
    out.push({ t: T0 + i * MS, o, h: Math.round((Math.max(o, c) + rnd() * 0.5) * 100) / 100, l: Math.round((Math.min(o, c) - rnd() * 0.5) * 100) / 100, c });
  }
  return out;
}

describe('premium, discount i równowaga (zakres swingowy)', () => {
  // Swing 110,1 → 99,9 (L = 10), potem odbicie do 105: 50% zakresu
  const base = path([100, 110, 100, 105]);

  it('połowy zakresu z pasem równowagi 47,5–52,5%; położenie ostatniego zamknięcia', () => {
    const bars = mk(base);
    const pd = selectSmc(smcStructure(bars, MS), bars, last(bars), { phone: false, history: false }).pd;
    expect(pd).not.toBeNull();
    expect(pd).toMatchObject({ hi: 110.1, lo: 99.9, zone: 'equilibrium' });
    expect(pd?.eqLo).toBeCloseTo(99.9 + 0.475 * 10.2, 9);
    expect(pd?.eqHi).toBeCloseTo(99.9 + 0.525 * 10.2, 9);
    expect(pd?.pct).toBeCloseTo((105 - 99.9) / 10.2, 9);
  });

  it('nad pasem premium, pod pasem discount; na telefonie bez pasa', () => {
    const up = mk([...base, ...leg(105, 106)]);
    const down = mk([...base, ...leg(105, 103)]);
    expect(selectSmc(smcStructure(up, MS), up, last(up), { phone: false, history: false }).pd?.zone).toBe('premium');
    expect(selectSmc(smcStructure(down, MS), down, last(down), { phone: false, history: false }).pd?.zone).toBe('discount');
    expect(selectSmc(smcStructure(up, MS), up, last(up), { phone: true, history: false }).pd).toBeNull();
  });

  it('bez dołka skali swingowej zakresu nie ma (pd null), nie przybliżamy', () => {
    const bars = mk(path([100, 110, 104]));
    expect(selectSmc(smcStructure(bars, MS), bars, last(bars), { phone: false, history: false }).pd).toBeNull();
  });
});

describe('limity obiektów', () => {
  const bars = walk(3000);
  const r = smcStructure(bars, MS);
  const asOfs = Array.from({ length: 60 }, (_, k) => bars[300 + k * 45].t + MS);

  it('limity z projektu: FVG 5, EQH i EQL po 2, etykiety 6, BOS i CHoCH 3, sweepy 2, OB 3 na skalę i typ; łącznie ≤ 25 w obu trybach', () => {
    expect(SMC_LIMITS).toEqual({ fvg: 5, eq: 2, labels: 6, breaks: 3, sweeps: 2, ob: 3 });
    let full = 0;
    for (const asOf of asOfs) {
      for (const history of [false, true]) {
        const s = selectSmc(r, bars, asOf, { phone: false, history });
        expect(s.fvgs.length).toBeLessThanOrEqual(5);
        expect(s.eqs.filter((x) => x.e.dir === 1).length).toBeLessThanOrEqual(2);
        expect(s.eqs.filter((x) => x.e.dir === -1).length).toBeLessThanOrEqual(2);
        expect(s.labels.length).toBeLessThanOrEqual(6);
        expect(s.breaks.length).toBeLessThanOrEqual(3);
        expect(s.sweeps.length).toBeLessThanOrEqual(2);
        expect(smcObjects(s)).toBeLessThanOrEqual(SMC_OBJECTS_MAX);
        if (s.fvgs.length === 5 && s.labels.length === 6) full++;
      }
    }
    // Limity naprawdę tną: w wielu chwilach FVG i etykiet jest więcej niż limit
    expect(full).toBeGreaterThan(5);
  });

  it('telefon: tylko struktura, BOS i CHoCH oraz najbliższa FVG', () => {
    expect(SMC_PHONE_LIMITS).toMatchObject({ fvg: 1, eq: 0, sweeps: 0, ob: 1 });
    for (const asOf of asOfs) {
      const s = selectSmc(r, bars, asOf, { phone: true, history: false });
      expect([s.eqs.length, s.sweeps.length, s.pd]).toEqual([0, 0, null]);
      expect(s.fvgs.length).toBeLessThanOrEqual(1);
      const desk = selectSmc(r, bars, asOf, { phone: false, history: false });
      if (desk.fvgs.length > 0) expect(s.fvgs[0].f.id).toBe(desk.fvgs[0].f.id);
    }
  });

  it('„bieżące”: tylko FVG otwarte i EQ aktywne, najbliższe cenie; „historia 24 h” dokłada zakończone (przygaszone)', () => {
    let endedSeen = 0;
    for (const asOf of asOfs) {
      const cur = selectSmc(r, bars, asOf, { phone: false, history: false });
      for (const f of cur.fvgs) expect([f.ended, f.endAt, f.f.known <= asOf, asOf < f.f.expiresAt]).toEqual([null, null, true, true]);
      for (const e of cur.eqs) expect([e.ended, e.e.endAt]).toEqual([false, null]);
      const d = cur.fvgs.map((f) => (cur.close >= f.f.lo && cur.close <= f.f.hi ? 0 : Math.min(Math.abs(cur.close - f.f.lo), Math.abs(cur.close - f.f.hi))));
      expect(d).toEqual([...d].sort((a, b) => a - b));
      const hist = selectSmc(r, bars, asOf, { phone: false, history: true });
      for (const f of hist.fvgs.filter((x) => x.ended)) {
        endedSeen++;
        expect(asOf - (f.endAt as number)).toBeLessThan(24 * 3_600_000);
      }
      // Otwarte idą pierwsze, więc historia zaczyna się od tych samych FVG co „bieżące”
      expect(hist.fvgs.slice(0, cur.fvgs.length).map((f) => f.f.id)).toEqual(cur.fvgs.map((f) => f.f.id));
    }
    expect(endedSeen).toBeGreaterThan(0);
  });

  it('etykiety: 6 ostatnich swingów, na tej samej świecy i typie jedna (skala swingowa)', () => {
    for (const asOf of asOfs) {
      const s = selectSmc(r, bars, asOf, { phone: false, history: false });
      const keys = s.labels.map((x) => `${x.idx}|${x.dir}`);
      expect(new Set(keys).size).toBe(keys.length);
      for (const x of s.labels) {
        expect(x.known).toBeLessThanOrEqual(asOf);
        const twin = r.swings.find((y) => y.scale === 'swing' && y.idx === x.idx && y.dir === x.dir && y.known <= asOf && (y.supersededAt === null || y.supersededAt > asOf) && y.label !== null);
        if (twin) expect(x.scale).toBe('swing');
      }
    }
  });
});

describe('wybór bez wglądu w przyszłość', () => {
  const bars = walk(900, 5);
  const full = smcStructure(bars, MS);

  it('ten sam rysunek z pełnej serii i z serii uciętej na chwili asOf (oba tryby, telefon)', () => {
    for (let k = 40; k < bars.length; k += 13) {
      const cut = bars.slice(0, k + 1);
      const asOf = cut[k].t + MS;
      const part = smcStructure(cut, MS);
      for (const o of [
        { phone: false, history: false },
        { phone: false, history: true },
        { phone: true, history: false },
      ]) {
        expect(selectSmc(full, bars, asOf, o), `k=${k} ${JSON.stringify(o)}`).toEqual(selectSmc(part, cut, asOf, o));
      }
    }
  });

  it('każdy wybrany element był znany do asOf; stan zdarzeń późniejszych nie przecieka', () => {
    for (let k = 40; k < bars.length; k += 29) {
      const asOf = bars[k].t + MS;
      const s = selectSmc(full, bars, asOf, { phone: false, history: true });
      for (const x of [...s.labels, ...s.breaks, ...s.sweeps, ...s.fvgs.map((f) => f.f), ...s.eqs.map((e) => e.e)]) expect(x.known).toBeLessThanOrEqual(asOf);
      for (const x of s.labels) for (const v of [x.brokenAt, x.sweptAt, x.supersededAt]) expect(v === null || v <= asOf).toBe(true);
      for (const f of s.fvgs) for (const v of [f.f.filledAt, f.f.ceAt]) expect(v === null || v <= asOf).toBe(true);
    }
  });

  it('okno pivota jako parametr (3, 5, 10, 20, 50): known zawsze po L świecach', () => {
    for (const [internalLen, swingLen] of [
      [5, 20],
      [10, 50],
    ]) {
      const r = smcStructure(bars, MS, { ...DEFAULT_SMC_PARAMS, internalLen, swingLen });
      expect(r.pivots.length).toBeGreaterThan(0);
      for (const p of r.pivots) expect(p.known).toBe(bars[p.idx + (p.scale === 'internal' ? internalLen : swingLen)].t + MS);
    }
  });
});

describe('SMC na wyższych interwałach: okna max(24 h, 24 świece), życie luki max(24 h, 100 świec)', () => {
  const H = 3_600_000;
  it('do 1 h okno 24 h bez zmian; 4H 4 doby; 1D 24 doby', () => {
    expect(smcWindowMs(5 * 60_000)).toBe(24 * H);
    expect(smcWindowMs(H)).toBe(24 * H);
    expect(smcWindowMs(4 * H)).toBe(96 * H);
    expect(smcWindowMs(24 * H)).toBe(24 * 24 * H);
  });

  it('luka FVG na 4H żyje 100 świec, na 5m 24 h', () => {
    const gap = (ms: number) => {
      const t0 = Date.UTC(2026, 9, 1);
      // trzy świece z luką w górę na trzeciej, potem spokojne świece nad luką
      const rows: [number, number, number, number][] = [];
      for (let i = 0; i < 30; i++) rows.push([100, 101, 99, 100]);
      rows.push([100, 101, 99.5, 100.8], [100.8, 104, 100.6, 103.8], [103.8, 106, 103, 105.5]);
      for (let i = 0; i < 5; i++) rows.push([105.5, 106.5, 105, 106]);
      const bars = rows.map(([o, h, l, c], i) => ({ t: t0 + i * ms, o, h, l, c }));
      const f = smcStructure(bars, ms).fvgs.find((x) => x.dir === 1);
      return f ? f.expiresAt - f.known : null;
    };
    expect(gap(4 * H)).toBe(100 * 4 * H);
    expect(gap(5 * 60_000)).toBe(24 * H);
  });
});
