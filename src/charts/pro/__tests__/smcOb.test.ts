import { describe, expect, it } from 'vitest';
import { DEFAULT_SMC_PARAMS, SMC_OB_LIFE_CANDLES, type SBar, type SmcOb, smcStructure } from '../core/smcStructure';
import { SMC_LIMITS, SMC_OB_OVERLAP, SMC_OBJECTS_MAX, SMC_PHONE_LIMITS, overlapShare, selectSmc, smcObjects } from '../chart/smcSelect';

/**
 * Bloki zleceń (OB, etap S1, smc-hl.md §1.5 i §7): ostatnia świeca przeciwna przed przełamaniem z impulsem ≥ 1,5 ATR,
 * `known` = zamknięcie świecy przełamania, stany „aktywny”, „dotknięty”, „zmitygowany” (zamknięciem albo knotem), życie
 * 200 świec, limity 3 na skalę i typ (telefon: najbliższy) i brak wglądu w przyszłość. Sztuczne świece ze znanymi odpowiedziami.
 */

const MS = 5 * 60_000;
const T0 = Date.UTC(2026, 10, 16, 0, 0);
type Row = [number, number, number, number];
const mk = (rows: readonly Row[]): SBar[] => rows.map(([o, h, l, c], i) => ({ t: T0 + i * MS, o, h, l, c }));
const flat = (n: number, p = 100): Row[] => Array.from({ length: n }, () => [p, p + 0.5, p - 0.5, p] as Row);
/** Noga od `from` do `to` krokami 0,5 (bez świecy startowej): korpus od poprzedniego zamknięcia, knoty po 0,1. */
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
const calm = (n: number, p: number): Row[] => Array.from({ length: n }, () => [p, p + 0.05, p - 0.05, p] as Row);
const closeAt = (bars: readonly SBar[], i: number) => bars[i].t + MS;
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

// Szczyt 105,1, cofnięcie do 102 (6 świec spadkowych), impuls do 108: zamknięcie 105,5 przełamuje 105,1
const A: Row[] = path([100, 105, 102, 108]);
/** Świeca spadkowa 102,5 → 102 (ostatnia przed impulsem) i świeca przełamania. */
const OB_IDX = 20 + 10 + 6 - 1;
const B_IDX = OB_IDX + 7;
const internalOb = (obs: readonly SmcOb[]) => obs.filter((o) => o.scale === 'internal');

describe('OB: definicja (§1.5)', () => {
  const bars = mk(A);
  const r = smcStructure(bars, MS);

  it('ostatnia świeca spadkowa przed impulsem, który zamknięciem przełamał szczyt; strefa = zakres tej świecy', () => {
    const [ob] = internalOb(r.obs);
    expect(ob).toMatchObject({ dir: 1, idx: OB_IDX, t: bars[OB_IDX].t, lo: 101.9, hi: 102.6, breakIdx: B_IDX, kind: 'BOS' });
    expect(bars[OB_IDX].c).toBeLessThan(bars[OB_IDX].o);
    // Wcześniejsze świece spadkowe nogi (105 → 102) nie są wybierane, a między OB a przełamaniem nie ma świecy spadkowej
    for (let k = OB_IDX + 1; k < B_IDX; k++) expect(bars[k].c).toBeGreaterThanOrEqual(bars[k].o);
    expect(bars[OB_IDX - 1].c).toBeLessThan(bars[OB_IDX - 1].o);
  });

  it('known = zamknięcie świecy przełamania (nigdy wcześniej), życie 200 świec od known', () => {
    for (const ob of r.obs) {
      const br = r.breaks.find((b) => b.id === ob.breakId);
      expect(br).toBeDefined();
      expect(ob.known).toBe(br?.known);
      expect(ob.known).toBe(closeAt(bars, ob.breakIdx));
      expect(ob.known).toBeGreaterThan(closeAt(bars, ob.idx));
      expect(ob.expiresAt - ob.known).toBe(SMC_OB_LIFE_CANDLES * MS);
    }
    expect(SMC_OB_LIFE_CANDLES).toBe(200);
    expect(DEFAULT_SMC_PARAMS.obMinAtr).toBe(1.5);
  });

  it('filtr impulsu: zakres od OB do przełamania ≥ 1,5 ATR świecy przełamania (próg sprawdzony z obu stron)', () => {
    const [ob] = internalOb(r.obs);
    let hi = Number.NEGATIVE_INFINITY;
    let lo = Number.POSITIVE_INFINITY;
    for (let k = ob.idx; k <= ob.breakIdx; k++) {
      hi = Math.max(hi, bars[k].h);
      lo = Math.min(lo, bars[k].l);
    }
    const ratio = (hi - lo) / r.atr[ob.breakIdx];
    expect(ob.impulse).toBeCloseTo(ratio, 9);
    expect(ratio).toBeGreaterThanOrEqual(1.5);
    const under = smcStructure(bars, MS, { ...DEFAULT_SMC_PARAMS, obMinAtr: ratio + 1e-6 });
    expect(internalOb(under.obs).filter((o) => o.breakIdx === B_IDX)).toEqual([]);
    const over = smcStructure(bars, MS, { ...DEFAULT_SMC_PARAMS, obMinAtr: ratio - 1e-6 });
    expect(internalOb(over.obs).map((o) => o.idx)).toContain(OB_IDX);
  });

  it('noga poniżej progu: przełamanie po płytkiej świecy spadkowej nie daje OB (bez cofania się do wcześniejszej świecy)', () => {
    // 105 → 102 → 104,5, jedna płytka świeca spadkowa i świeca przełamania 105,2: od niej do przełamania 0,9 < 1,5 ATR
    const rows: Row[] = [...path([100, 105, 102, 104.5]), [104.5, 104.55, 104.35, 104.4], [104.4, 105.25, 104.35, 105.2]];
    const b = mk(rows);
    const res = smcStructure(b, MS);
    const brk = res.breaks.filter((x) => x.idx === rows.length - 1);
    expect(brk.length).toBeGreaterThan(0);
    expect(0.9).toBeLessThan(1.5 * res.atr[rows.length - 1]);
    expect(res.obs).toEqual([]);
  });

  it('bez świecy przeciwnej między swingiem a przełamaniem nie ma OB', () => {
    // Cofnięcie samymi świecami wzrostowymi z luką w dół (zamknięcie ≥ otwarcie), potem przełamanie
    const rows: Row[] = [...path([100, 105])];
    for (let k = 0; k < 6; k++) {
      const o = 104.4 - k * 0.5;
      rows.push([o, o + 0.15, o - 0.05, o + 0.1]);
    }
    rows.push(...leg(101.9, 106));
    const b = mk(rows);
    const res = smcStructure(b, MS);
    expect(res.breaks.some((x) => x.dir === 1)).toBe(true);
    expect(res.obs).toEqual([]);
  });

  it('OB spadkowy lustrzanie: ostatnia świeca wzrostowa przed przełamaniem dołka w dół, strefa nad ceną', () => {
    const b = mk(path([110, 105, 108, 102]));
    const [ob] = internalOb(smcStructure(b, MS).obs);
    expect(ob).toMatchObject({ dir: -1, lo: 107.4, hi: 108.1 });
    expect(b[ob.idx].c).toBeGreaterThan(b[ob.idx].o);
  });
});

describe('OB: dotknięcie i mitygacja (zamknięciem albo knotem)', () => {
  const back = [...A, ...leg(108, 103)];
  const run = (extra: Row[]) => {
    const bars = mk([...back, ...extra]);
    const r = smcStructure(bars, MS);
    const ob = r.obs.find((o) => o.scale === 'swing' && o.idx === OB_IDX) as SmcOb;
    return { bars, r, ob, at: closeAt(bars, back.length) };
  };

  it('wejście knotem w strefę: „dotknięty”, bez mitygacji w obu trybach', () => {
    const { bars, r, ob, at } = run([[103, 103.1, 102.4, 102.9], ...calm(5, 103)]);
    expect([ob.touchedAt, ob.wickAt, ob.closeAt]).toEqual([at, null, null]);
    for (const mitigation of ['close', 'wick'] as const) {
      const s = selectSmc(r, bars, last(bars), { phone: false, history: false, mitigation });
      expect(s.obs.find((v) => v.o.id === ob.id)?.state).toBe('touched');
    }
    // Przed dotknięciem: aktywny
    const before = selectSmc(r, bars, at - MS, { phone: false, history: false });
    expect(before.obs.find((v) => v.o.id === ob.id)?.state).toBe('active');
  });

  it('knot za dalszą krawędzią, zamknięcie w strefie: zmitygowany tylko w trybie „knotem”', () => {
    const { bars, r, ob, at } = run([[103, 103.1, 101.7, 102.2], ...calm(5, 103)]);
    expect([ob.touchedAt, ob.wickAt, ob.closeAt]).toEqual([at, at, null]);
    const byClose = selectSmc(r, bars, last(bars), { phone: false, history: false, mitigation: 'close' });
    expect(byClose.obs.find((v) => v.o.id === ob.id)?.state).toBe('touched');
    const byWick = selectSmc(r, bars, last(bars), { phone: false, history: false, mitigation: 'wick' });
    // „bieżące”: zmitygowany znika; „historia”: zostaje przygaszony z chwilą końca
    expect(byWick.obs.find((v) => v.o.id === ob.id)).toBeUndefined();
    const hist = selectSmc(r, bars, last(bars), { phone: false, history: true, mitigation: 'wick' });
    expect(hist.obs.find((v) => v.o.id === ob.id)).toMatchObject({ state: 'mitigated', ended: true, endAt: at, endIdx: back.length });
  });

  it('zamknięcie za dalszą krawędzią: zmitygowany w obu trybach (domyślnie zamknięciem)', () => {
    const { bars, r, ob, at } = run([[103, 103.1, 101.3, 101.5], ...calm(5, 101.5)]);
    expect([ob.touchedAt, ob.wickAt, ob.closeAt, ob.closeIdx]).toEqual([at, at, at, back.length]);
    for (const mitigation of ['close', 'wick', undefined] as const) {
      const s = selectSmc(r, bars, last(bars), { phone: false, history: false, mitigation });
      expect(s.obs.find((v) => v.o.id === ob.id)).toBeUndefined();
      expect(s.mitigation).toBe(mitigation ?? 'close');
    }
    // Do chwili mitygacji (świeca wcześniej) jeszcze aktywny
    const before = selectSmc(r, bars, at - MS, { phone: false, history: false });
    expect(before.obs.find((v) => v.o.id === ob.id)?.state).toBe('active');
  });

  it('dotknięcie liczy się dopiero po świecy przełamania', () => {
    const { ob } = run(calm(3, 103));
    expect(ob.touchedAt).toBeNull();
  });
});

describe('OB: życie 200 świec', () => {
  const bars = mk([...A, ...calm(260, 107)]);
  const r = smcStructure(bars, MS);
  const ob = r.obs.find((o) => o.scale === 'swing' && o.idx === OB_IDX) as SmcOb;

  it('aktywny do 199 świec po przełamaniu, od 200. wygasa; w historii przygaszony jako wygasły', () => {
    expect([ob.touchedAt, ob.closeAt]).toEqual([null, null]);
    const alive = selectSmc(r, bars, ob.known + 199 * MS, { phone: false, history: false });
    expect(alive.obs.find((v) => v.o.id === ob.id)?.state).toBe('active');
    const gone = selectSmc(r, bars, ob.known + 200 * MS, { phone: false, history: false });
    expect(gone.obs.find((v) => v.o.id === ob.id)).toBeUndefined();
    expect(gone.active.ob).toBe(0);
    const hist = selectSmc(r, bars, ob.known + 200 * MS, { phone: false, history: true });
    expect(hist.obs.find((v) => v.o.id === ob.id)).toMatchObject({ state: 'expired', ended: true, endAt: ob.expiresAt });
  });

  it('po wygaśnięciu cena w strefie niczego nie zapisuje', () => {
    const late = mk([...A, ...calm(205, 107), [107, 107.1, 101.5, 101.6]]);
    const x = smcStructure(late, MS).obs.find((o) => o.scale === 'internal' && o.idx === OB_IDX) as SmcOb;
    expect([x.touchedAt, x.wickAt, x.closeAt]).toEqual([null, null, null]);
  });
});

describe('OB: wybór i limity', () => {
  const bars = walk(3000);
  const r = smcStructure(bars, MS);
  const asOfs = Array.from({ length: 60 }, (_, k) => bars[300 + k * 45].t + MS);

  it('ta sama świeca z obu skal: jeden OB (skala swingowa)', () => {
    const b = mk(A);
    const res = smcStructure(b, MS);
    expect(res.obs.filter((o) => o.idx === OB_IDX).map((o) => o.scale).sort()).toEqual(['internal', 'swing']);
    const s = selectSmc(res, b, last(b), { phone: false, history: false });
    expect(s.obs.map((v) => [v.o.idx, v.o.scale])).toEqual([[OB_IDX, 'swing']]);
    expect(s.active.ob).toBe(1);
  });

  it('najwyżej 2 aktywne na kierunek (obie skale razem), najbliższe cenie, bez wzajemnego pokrycia ≥ 50%; łącznie ≤ 25 obiektów', () => {
    expect(SMC_LIMITS.ob).toBe(2);
    let cut = 0;
    for (const asOf of asOfs) {
      for (const history of [false, true]) {
        for (const mitigation of ['close', 'wick'] as const) {
          const s = selectSmc(r, bars, asOf, { phone: false, history, mitigation });
          for (const dir of [1, -1] as const) {
            const g = s.obs.filter((v) => v.o.dir === dir);
            const act = g.filter((v) => !v.ended);
            expect(act.length).toBeLessThanOrEqual(2);
            expect(g.length).toBeLessThanOrEqual(history ? 3 : 2);
            // Aktywne najpierw, według bliskości ostatniego zamknięcia, i bez pokrycia z bliższym
            const d = act.map((v) => (s.close >= v.o.lo && s.close <= v.o.hi ? 0 : Math.min(Math.abs(s.close - v.o.lo), Math.abs(s.close - v.o.hi))));
            expect(d).toEqual([...d].sort((a, b) => a - b));
            for (let k = 1; k < act.length; k++) for (let j = 0; j < k; j++) expect(overlapShare(act[j].o, act[k].o)).toBeLessThan(SMC_OB_OVERLAP);
          }
          expect(smcObjects(s)).toBeLessThanOrEqual(SMC_OBJECTS_MAX);
          for (const v of s.obs) {
            expect(v.o.known).toBeLessThanOrEqual(asOf);
            if (!history) expect(v.ended).toBe(false);
          }
          if (s.active.ob > s.obs.filter((v) => !v.ended).length) cut++;
        }
      }
    }
    // Limit naprawdę tnie: aktywnych bywa więcej, niż jest rysowanych
    expect(cut).toBeGreaterThan(5);
  });

  it('telefon: tylko najbliższy OB (ten sam co pierwszy według bliskości na komputerze)', () => {
    expect(SMC_PHONE_LIMITS.ob).toBe(1);
    let seen = 0;
    for (const asOf of asOfs) {
      const s = selectSmc(r, bars, asOf, { phone: true, history: false });
      expect(s.obs.length).toBeLessThanOrEqual(1);
      const desk = selectSmc(r, bars, asOf, { phone: false, history: false });
      const dist = (v: (typeof desk.obs)[number]) => (desk.close >= v.o.lo && desk.close <= v.o.hi ? 0 : Math.min(Math.abs(desk.close - v.o.lo), Math.abs(desk.close - v.o.hi)));
      if (desk.obs.length > 0) {
        seen++;
        const best = Math.min(...desk.obs.map(dist));
        expect(dist(s.obs[0])).toBe(best);
      }
    }
    expect(seen).toBeGreaterThan(10);
  });
});

describe('OB bez wglądu w przyszłość', () => {
  const bars = walk(900, 5);
  const full = smcStructure(bars, MS);

  it('model: OB serii uciętej = OB pełnej serii znane do chwili cięcia, ze zdarzeniami tylko do niej', () => {
    expect(full.obs.length).toBeGreaterThan(5);
    for (let k = 40; k < bars.length; k += 11) {
      const asOf = closeAt(bars, k);
      const part = smcStructure(bars.slice(0, k + 1), MS);
      const upTo = (x: number | null) => (x !== null && x <= asOf ? x : null);
      const want = full.obs
        .filter((o) => o.known <= asOf)
        .map((o) => ({
          ...o,
          touchedAt: upTo(o.touchedAt),
          wickAt: upTo(o.wickAt),
          wickIdx: upTo(o.wickAt) === null ? null : o.wickIdx,
          closeAt: upTo(o.closeAt),
          closeIdx: upTo(o.closeAt) === null ? null : o.closeIdx,
        }));
      expect(part.obs, `k=${k}`).toEqual(want);
    }
  });

  it('wybór: ten sam z pełnej serii i z uciętej, w obu trybach mitygacji', () => {
    for (let k = 40; k < bars.length; k += 17) {
      const cut = bars.slice(0, k + 1);
      const asOf = closeAt(bars, k);
      const part = smcStructure(cut, MS);
      for (const mitigation of ['close', 'wick'] as const)
        for (const history of [false, true]) {
          const o = { phone: false, history, mitigation };
          expect(selectSmc(full, bars, asOf, o).obs, `k=${k} ${mitigation} ${history}`).toEqual(selectSmc(part, cut, asOf, o).obs);
        }
    }
  });
});
