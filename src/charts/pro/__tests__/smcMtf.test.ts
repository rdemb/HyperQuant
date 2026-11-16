import { describe, expect, it } from 'vitest';
import { SMC_HTF_AUTO, SMC_HTF_OFF, SMC_HTF_OPTIONS, autoHtfMs, closedHtfBars, htfLabel, pickHtf, smcMtf } from '../core/smcMtf';
import { DEFAULT_SMC_PARAMS, type SBar } from '../core/smcStructure';
import { SMC_MTF_LIMITS, SMC_MTF_PHONE_LIMITS, type SmcMtfZone, selectSmcMtf, smcMtfObjects } from '../chart/smcMtfSelect';
import { INTERVALS } from '../core/time';

/**
 * SMC z wyższego interwału (smc-hl.md §7.2): wybór interwału, tylko zamknięte świece wyższego interwału, element od
 * zamknięcia świecy, która go potwierdza (bez zaglądania w przyszłość), odtwarzanie świeca po świecy daje ten sam
 * rysunek (bez przemalowań), limity.
 */

const MIN = 60_000;
const H = 60 * MIN;
const M15 = 15 * MIN;
const H4 = 4 * H;
const DAY = 24 * H;
const T0 = Date.UTC(2026, 10, 16, 0, 0);
type Row = [number, number, number, number];

/** Świece wyższego interwału z wierszy OHLC. */
const htf = (rows: readonly Row[], ms = H4): SBar[] => rows.map(([o, h, l, c], i) => ({ t: T0 + i * ms, o, h, l, c }));

/** Świeca wyższego interwału rozpisana na `n` świec niższego: droga o → dołek → szczyt → c (spadkowa: o → szczyt → dołek → c). */
function expand(b: SBar, n: number, ms: number): SBar[] {
  const pts = b.c >= b.o ? [b.o, b.l, b.h, b.c] : [b.o, b.h, b.l, b.c];
  const at = [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n];
  const px = (k: number) => {
    let s = 0;
    while (s < 2 && k > at[s + 1]) s++;
    return pts[s] + ((pts[s + 1] - pts[s]) * (k - at[s])) / (at[s + 1] - at[s]);
  };
  return Array.from({ length: n }, (_, k) => {
    const o = px(k);
    const c = px(k + 1);
    return { t: b.t + k * ms, o, h: Math.max(o, c), l: Math.min(o, c), c };
  });
}

/** Świece wyższego interwału złożone ze świec niższego (ostatnia może być w toku — jak seria na żywo). */
function aggregate(ltf: readonly SBar[], ms: number): SBar[] {
  const out: SBar[] = [];
  for (const x of ltf) {
    const t = Math.floor(x.t / ms) * ms;
    const cur = out[out.length - 1];
    if (!cur || cur.t !== t) out.push({ ...x, t });
    else {
      cur.h = Math.max(cur.h, x.h);
      cur.l = Math.min(cur.l, x.l);
      cur.c = x.c;
    }
  }
  return out;
}

/** Błądzenie losowe z ziarnem (mulberry32) na świecach `ms`. */
function walk(n: number, ms: number, seed = 7): SBar[] {
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
    c = Math.round((o + (rnd() - 0.5) * 1.2) * 100) / 100;
    out.push({ t: T0 + i * ms, o, h: Math.round((Math.max(o, c) + rnd() * 0.3) * 100) / 100, l: Math.round((Math.min(o, c) - rnd() * 0.3) * 100) / 100, c });
  }
  return out;
}

const OPEN = { phone: false, room: 25 };

describe('wybór wyższego interwału', () => {
  it('automatycznie: 4H do 30m, 1D dla 1h–4h, brak od 1D', () => {
    const table = INTERVALS.map((iv) => [iv.id, autoHtfMs(iv.ms)]);
    expect(table).toEqual([
      ['1m', H4],
      ['3m', H4],
      ['5m', H4],
      ['15m', H4],
      ['30m', H4],
      ['1h', DAY],
      ['4h', DAY],
      ['1d', null],
      ['1w', null],
      ['1M', null],
    ]);
    expect(pickHtf(5 * MIN, SMC_HTF_AUTO)).toEqual({ kind: 'on', id: '4h', ms: H4, label: '4H', auto: true });
    expect(pickHtf(H, SMC_HTF_AUTO)).toEqual({ kind: 'on', id: '1d', ms: DAY, label: '1D', auto: true });
    expect(pickHtf(DAY, SMC_HTF_AUTO)).toEqual({ kind: 'none' });
  });

  it('ręcznie: interwał z listy, gdy wyższy od wykresu; wyłączony; nieznana wartość jak automatyczny', () => {
    expect(SMC_HTF_OPTIONS).toEqual([0, -1, 15, 30, 60, 240, 1440, 10080]);
    expect(pickHtf(5 * MIN, 60)).toEqual({ kind: 'on', id: '1h', ms: H, label: '1H', auto: false });
    expect(pickHtf(DAY, 10080)).toEqual({ kind: 'on', id: '1w', ms: 7 * DAY, label: '1W', auto: false });
    expect(pickHtf(H, 60)).toEqual({ kind: 'notHigher', label: '1H' });
    expect(pickHtf(H4, 15)).toEqual({ kind: 'notHigher', label: '15m' });
    expect(pickHtf(5 * MIN, SMC_HTF_OFF)).toEqual({ kind: 'off' });
    expect(pickHtf(5 * MIN, 7)).toEqual(pickHtf(5 * MIN, SMC_HTF_AUTO));
    expect([15 * MIN, 30 * MIN, H, H4, DAY, 7 * DAY, 30 * DAY].map(htfLabel)).toEqual(['15m', '30m', '1H', '4H', '1D', '1W', '1M']);
  });
});

// Luka 4H w górę: 20 płaskich świec, potem skok; trzecia świeca (indeks 21) ma dołek 102 nad szczytem 100,5 świecy 19
const GAP: Row[] = [...Array.from({ length: 20 }, () => [100, 100.5, 99.5, 100] as Row), [100, 102, 99.8, 101.8], [102.2, 103, 102, 102.8], [102.8, 103.2, 102.4, 103]];
const GAP_KNOWN = T0 + 22 * H4;

describe('bez zaglądania w przyszłość', () => {
  it('świeca wyższego interwału w toku nie wchodzi do modelu', () => {
    const bars = htf(GAP);
    expect(closedHtfBars(bars, H4, T0 + 22 * H4 - 1)).toHaveLength(21);
    expect(closedHtfBars(bars, H4, T0 + 22 * H4)).toHaveLength(22);
  });

  it('luka 4H pojawia się na wykresie 15m dokładnie przy zamknięciu świecy 4H, nie świecę 15m wcześniej', () => {
    const ltf = htf(GAP).flatMap((b) => expand(b, 16, M15));
    const at = (asOf: number) => {
      // Jak na żywo: seria 4H z bieżącą świecą złożoną z dotychczasowych świec 15m (kształt luki już widać)
      const seen = ltf.filter((b) => b.t + M15 <= asOf);
      const m = smcMtf(aggregate(seen, H4), H4, asOf);
      return selectSmcMtf(m, asOf, seen[seen.length - 1].c, OPEN);
    };
    const before = at(GAP_KNOWN - M15);
    expect(aggregate(ltf.filter((b) => b.t + M15 <= GAP_KNOWN - M15), H4)[21].l).toBeGreaterThan(100.5);
    expect(before.fvgs).toEqual([]);
    expect(before.active.fvg).toBe(0);
    const after = at(GAP_KNOWN);
    expect(after.fvgs.map((v) => [v.f.dir, v.f.lo, v.f.hi, v.f.known])).toEqual([[1, 100.5, 102, GAP_KNOWN]]);
    expect(after.label).toBe('4H');
  });
});

describe('bez przemalowań', () => {
  const ltf = walk(1600, M15);
  const params = { ...DEFAULT_SMC_PARAMS, internalLen: 3, swingLen: 5 };
  const full = smcMtf(aggregate(ltf, H4), H4, ltf[ltf.length - 1].t + M15, params);

  it('odtwarzanie świeca po świecy 15m (z bieżącą świecą 4H) daje ten sam wybór co liczenie na całości', () => {
    let fvgSteps = 0;
    let breakSteps = 0;
    let atClose = 0;
    const firstSeen = new Map<number, number>();
    for (let i = 0; i < ltf.length; i++) {
      const asOf = ltf[i].t + M15;
      const close = ltf[i].c;
      const step = selectSmcMtf(smcMtf(aggregate(ltf.slice(0, i + 1), H4), H4, asOf, params), asOf, close, OPEN);
      expect(step).toEqual(selectSmcMtf(full, asOf, close, OPEN));
      for (const v of step.fvgs) {
        expect(v.f.known).toBeLessThanOrEqual(asOf);
        expect((v.f.known - T0) % H4).toBe(0);
        if (!firstSeen.has(v.f.id)) {
          firstSeen.set(v.f.id, asOf);
          if (asOf === v.f.known) atClose++;
        }
      }
      for (const b of step.breaks) {
        expect(b.known).toBeLessThanOrEqual(asOf);
        expect((b.known - T0) % H4).toBe(0);
      }
      if (step.fvgs.length > 0) fvgSteps++;
      if (step.breaks.length > 0) breakSteps++;
    }
    // Próba nie jest pusta: luki i przełamania 4H są na wykresie, a większość luk pojawia się dokładnie przy zamknięciu 4H
    expect(fvgSteps).toBeGreaterThan(200);
    expect(breakSteps).toBeGreaterThan(200);
    expect(atClose).toBeGreaterThan(0);
    expect(atClose).toBeGreaterThanOrEqual(firstSeen.size / 2);
  });
});

describe('limity wyższego interwału', () => {
  const ltf = walk(1600, M15, 3);
  const params = { ...DEFAULT_SMC_PARAMS, internalLen: 3, swingLen: 5 };
  const m = smcMtf(aggregate(ltf, H4), H4, ltf[ltf.length - 1].t + M15, params);
  const asOfs = ltf.map((b) => b.t + M15);

  it('najwyżej 3 FVG najbliższe zamknięciu i 1 linia przełamania; telefon: tylko najbliższa FVG', () => {
    expect(SMC_MTF_LIMITS).toEqual({ fvg: 3, obPerDir: 2, breaks: 1 });
    expect(SMC_MTF_PHONE_LIMITS).toEqual({ fvg: 1, obPerDir: 0, breaks: 0 });
    let full = 0;
    for (let i = 0; i < ltf.length; i += 7) {
      const s = selectSmcMtf(m, asOfs[i], ltf[i].c, OPEN);
      expect(s.fvgs.length).toBeLessThanOrEqual(3);
      expect(s.breaks.length).toBeLessThanOrEqual(1);
      expect(s.fvgs.length).toBe(Math.min(3, s.active.fvg));
      if (s.fvgs.length === 3) full++;
      const p = selectSmcMtf(m, asOfs[i], ltf[i].c, { phone: true, room: 25 });
      expect(p.breaks).toEqual([]);
      expect(p.fvgs.map((v) => v.f.id)).toEqual(s.fvgs.slice(0, 1).map((v) => v.f.id));
    }
    expect(full).toBeGreaterThan(0);
  });

  it('łączny limit: przy braku miejsca najpierw odpadają dalsze FVG, potem linia, na końcu najbliższa FVG', () => {
    const i = asOfs.findIndex((t, k) => {
      const s = selectSmcMtf(m, t, ltf[k].c, OPEN);
      return s.fvgs.length === 3 && s.breaks.length === 1;
    });
    expect(i).toBeGreaterThan(0);
    const sel = (room: number) => selectSmcMtf(m, asOfs[i], ltf[i].c, { phone: false, room });
    const all = sel(25);
    expect(smcMtfObjects(all)).toBe(4);
    expect(smcMtfObjects(sel(3))).toBe(3);
    expect(sel(3).breaks).toEqual(all.breaks);
    expect(sel(2).fvgs.map((v) => v.f.id)).toEqual([all.fvgs[0].f.id]);
    expect(sel(2).breaks).toEqual(all.breaks);
    expect(sel(1).breaks).toEqual([]);
    expect(sel(1).fvgs).toHaveLength(1);
    expect(smcMtfObjects(sel(0))).toBe(0);
    expect(smcMtfObjects(sel(-3))).toBe(0);
  });

  it('OB (wejście gotowe na etap S1): po 2 aktywne najbliższe na typ, tylko znane do chwili wyboru', () => {
    const asOf = T0 + 10 * H4;
    const z = (id: number, dir: 1 | -1, lo: number, known = T0, endAt: number | null = null): SmcMtfZone => ({ id, dir, lo, hi: lo + 1, known, endAt });
    const obs = [z(1, 1, 90), z(2, 1, 95), z(3, 1, 97), z(4, -1, 110), z(5, -1, 104), z(6, -1, 102, asOf + 1), z(7, 1, 98, T0, asOf), z(8, -1, 103)];
    const s = selectSmcMtf(m, asOf, 100, OPEN, obs);
    expect(s.obs.map((x) => x.id)).toEqual([3, 8, 2, 5]);
    expect(s.active.ob).toBe(6);
    expect(selectSmcMtf(m, asOf, 100, { phone: true, room: 25 }, obs).obs).toEqual([]);
  });

  it('stan struktury dopiero od 3 × okna skali swingowej zamkniętych świec', () => {
    const early = selectSmcMtf(m, T0 + 14 * H4, 100, OPEN);
    expect(early).toMatchObject({ closed: 14, need: 15, enough: false });
    expect(selectSmcMtf(m, T0 + 15 * H4, 100, OPEN).enough).toBe(true);
  });
});
