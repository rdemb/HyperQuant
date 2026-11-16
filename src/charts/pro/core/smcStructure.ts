/**
 * Struktura i płynność (SMC+HL), etap S0 (szkielet) z projektu Pioniera (wskazniki-uklady/smc-hl.md §1): twarde
 * definicje elementów liczone tylko na zamkniętych świecach, każdy z chwilą `known`, od której był znany. Piszemy od
 * zera z publicznych pojęć (BOS, CHoCH, FVG, EQH i EQL to terminy branżowe); opis mierzy kształt ceny, nie mówi, kto
 * handlował ani co będzie dalej.
 *
 * - **ATR:** ATR(14) Wildera na interwale wykresu. Każdy próg w ATR bierze ATR świecy, na której zamknięciu reguła się
 *   rozstrzyga (potwierdzenie pivota, świeca FVG, świeca knota).
 * - **Pivot (okno L):** szczyt świecy j ściśle wyższy od L świec z lewej i nie niższy od L świec z prawej (remis na korzyść
 *   wcześniejszej); lustrzanie dołek. Znany od zamknięcia świecy j + L. Skale: wewnętrzna (domyślnie L = 3) i swingowa
 *   (domyślnie L = 10); L do wyboru z `SMC_LENS`.
 * - **Swing struktury:** pivot przeciwnego typu niż ostatni swing skali liczy się tylko przy różnicy ≥ 1 ATR do niego;
 *   kolejny pivot tego samego typu bez przeciwnego między nimi zastępuje ostatni swing, gdy jest skrajniejszy (inaczej
 *   odpada). Szczyt wobec poprzedniego szczytu skali: HH (wyższy) albo LH (nie wyższy); dołek: LL (niższy) albo HL.
 * - **Stan struktury:** „wzrostowa” przy HH i HL, „spadkowa” przy LH i LL, inaczej „mieszana”; CHoCH ustawia
 *   „mieszana” do następnego swingu skali.
 * - **Przełamanie:** zamknięcie świecy za ostatnim swingiem skali, który nie był jeszcze przełamany. BOS: zgodne ze
 *   stanem; CHoCH: przeciwne do stanu. W stanie „mieszana” odniesieniem jest kierunek poprzedniego przełamania skali,
 *   a bez niego przełamanie to BOS (zmiana wymaga punktu odniesienia). Sam knot za poziomem to kandydat na sweep.
 * - **Sweep:** knot za ostatnim nieprzełamanym swingiem (dowolnej skali) albo za aktywnym EQH/EQL o ≥ 0,05 ATR i zamknięcie
 *   z powrotem po stronie poziomu w tej samej świecy albo w ciągu ≤ 2 kolejnych; znany od zamknięcia świecy powrotu.
 *   Jeden sweep na poziom; zamknięcie za poziomem w świecy knota to też przełamanie (oba zdarzenia zostają).
 * - **FVG:** w świecy i low_i > high_{i−2} (luka [high_{i−2}, low_i] po ruchu w górę) albo lustrzanie, szerokość ≥ 0,1 ATR;
 *   wypełnienie od strony ceny, „wypełniona”, gdy cena przeszła całą lukę; osobno chwila pierwszego dotknięcia środka
 *   luki knotem (CE); wygasa po wypełnieniu albo 24 h od `known`.
 * - **EQH/EQL:** dwa pivoty skali wewnętrznej tego samego typu (także odrzucone filtrem amplitudy) z różnicą ≤ 0,1 ATR,
 *   oddalone o ≥ 5 świec, bez zamknięcia za poziomem (średnia obu) od pierwszego do potwierdzenia drugiego. Kończy się
 *   zamknięciem za poziomem albo sweepem. Nowy nie powstaje, gdy aktywny tego typu leży w tolerancji.
 * - **Premium, discount, równowaga** (wybór w `smcSelect`): połowy zakresu od ostatniego szczytu do ostatniego dołka
 *   skali swingowej, z pasem równowagi 47,5–52,5% zakresu.
 *
 * Bloki zleceń (OB) to etap S1, potwierdzenia z danych HL — S3, częstości bazowe — S2: tu ich nie ma. Wynik dla świecy
 * zależy tylko od świec do niej: pola stanu (`brokenAt`, `filledAt`, `endAt`…) to chwile zdarzeń, więc stan w dowolnej
 * chwili odczytuje się bez wglądu w przyszłość.
 */

export interface SBar {
  /** Otwarcie świecy (ms). */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export type Scale = 'internal' | 'swing';
export const SCALES: readonly Scale[] = ['internal', 'swing'];
/** 1 — szczyt (przełamanie, knot, luka w górę), −1 — dołek (w dół). */
export type Dir = 1 | -1;
export type SwingLabel = 'HH' | 'LH' | 'HL' | 'LL';
export type StructureState = 'up' | 'down' | 'mixed';
export type BreakKind = 'BOS' | 'CHoCH';

export interface SmcParams {
  internalLen: number;
  swingLen: number;
  atrLen: number;
  /** Filtr amplitudy swingu: różnica do poprzedniego swingu przeciwnego typu ≥ tyle ATR. */
  swingMinAtr: number;
  /** Sweep: knot za poziomem ≥ tyle ATR, powrót zamknięciem w świecy knota albo w tylu kolejnych. */
  sweepMinAtr: number;
  sweepBars: number;
  /** FVG: szerokość ≥ tyle ATR, życie od `known`. */
  fvgMinAtr: number;
  fvgLifeMs: number;
  /** EQH/EQL: różnica ≤ tyle ATR, odstęp ≥ tyle świec. */
  eqMaxAtr: number;
  eqMinBars: number;
  /** Równowaga zakresu swingowego: od … do … zakresu. */
  equilibriumLo: number;
  equilibriumHi: number;
}

/** Okna pivota do wyboru w parametrach wskaźnika (obie skale). */
export const SMC_LENS = [3, 5, 10, 20, 50] as const;

export const DEFAULT_SMC_PARAMS: SmcParams = {
  internalLen: 3,
  swingLen: 10,
  atrLen: 14,
  swingMinAtr: 1,
  sweepMinAtr: 0.05,
  sweepBars: 2,
  fvgMinAtr: 0.1,
  fvgLifeMs: 24 * 3_600_000,
  eqMaxAtr: 0.1,
  eqMinBars: 5,
  equilibriumLo: 0.475,
  equilibriumHi: 0.525,
};

/** Pivot (surowy, przed filtrem amplitudy). `t` — świeca krańca, `known` — zamknięcie świecy potwierdzenia. */
export interface SmcPivot {
  scale: Scale;
  dir: Dir;
  idx: number;
  t: number;
  price: number;
  known: number;
}

export interface SmcSwing extends SmcPivot {
  id: number;
  /** null — pierwszy swing tego typu w skali (bez poprzedniego do porównania). */
  label: SwingLabel | null;
  /** Chwila, od której skrajniejszy swing tego samego typu go zastąpił; null — nie zastąpiony. */
  supersededAt: number | null;
  /** Chwila przełamania zamknięciem (BOS albo CHoCH); null — nieprzełamany. */
  brokenAt: number | null;
  /** Chwila sweepu poziomu; null — bez sweepu. */
  sweptAt: number | null;
}

export interface SmcBreak {
  id: number;
  scale: Scale;
  dir: Dir;
  kind: BreakKind;
  level: number;
  swingId: number;
  /** Swing: świeca krańca i chwila, od której był znany (linia zaczyna się dopiero od niej). */
  swingT: number;
  swingKnown: number;
  /** Świeca przełamania (zamknięcie za poziomem) i chwila jej zamknięcia. */
  idx: number;
  t: number;
  known: number;
}

export type SweepSource = Scale | 'eq';

export interface SmcSweep {
  id: number;
  /** 1 — knot nad szczytem albo EQH, −1 — pod dołkiem albo EQL. */
  dir: Dir;
  level: number;
  /** Poziomy, które zebrał (skale swingów i EQ). */
  sources: SweepSource[];
  /** Świeca knota i świeca powrotu (zamknięcie po stronie poziomu). */
  idx: number;
  t: number;
  returnIdx: number;
  returnT: number;
  known: number;
}

export interface SmcFvg {
  id: number;
  /** 1 — luka po ruchu w górę (pod ceną), −1 — po ruchu w dół (nad ceną). */
  dir: Dir;
  lo: number;
  hi: number;
  /** Trzecia świeca (na jej zamknięciu luka jest znana). */
  idx: number;
  t: number;
  known: number;
  expiresAt: number;
  /** Chwila, w której cena przeszła całą lukę; null — niewypełniona przed wygaśnięciem. */
  filledAt: number | null;
  /** Chwila pierwszego dotknięcia środka luki (CE, consequent encroachment) knotem; null — bez dotknięcia przed wygaśnięciem. */
  ceAt: number | null;
}

/** Środek luki (CE). */
export const fvgMid = (f: Pick<SmcFvg, 'lo' | 'hi'>): number => (f.lo + f.hi) / 2;

export interface SmcEqPoint {
  idx: number;
  t: number;
  price: number;
}

export interface SmcEq {
  id: number;
  /** 1 — EQH, −1 — EQL. */
  dir: Dir;
  level: number;
  a: SmcEqPoint;
  b: SmcEqPoint;
  /** Świeca potwierdzenia drugiego pivota. */
  idx: number;
  t: number;
  known: number;
  endAt: number | null;
  end: 'broken' | 'swept' | null;
}

export interface SmcStateStep {
  scale: Scale;
  known: number;
  state: StructureState;
}

export interface SmcResult {
  ms: number;
  atr: Float64Array;
  pivots: SmcPivot[];
  swings: SmcSwing[];
  breaks: SmcBreak[];
  sweeps: SmcSweep[];
  fvgs: SmcFvg[];
  eqs: SmcEq[];
  /** Zmiany stanu struktury (rosnąco po chwili); przed pierwszą stan „mieszana”. */
  states: SmcStateStep[];
}

/** ATR Wildera; NaN, dopóki nie ma `n` świec (pierwsza świeca: H − L). */
export function wilderAtr(bars: readonly SBar[], n: number): Float64Array {
  const out = new Float64Array(bars.length).fill(Number.NaN);
  let a = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const tr = i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c));
    if (i < n) {
      a += tr;
      if (i === n - 1) out[i] = a / n;
    } else {
      out[i] = (out[i - 1] * (n - 1) + tr) / n;
    }
  }
  return out;
}

/**
 * Pivot typu `dir` w świecy j przy oknie L: ściśle skrajniejszy od L świec z lewej, nie mniej skrajny od L świec z prawej
 * (remis rozstrzyga na korzyść wcześniejszej świecy). Bez pełnego okna — false.
 */
export function isPivot(bars: readonly SBar[], j: number, len: number, dir: Dir): boolean {
  if (j - len < 0 || j + len >= bars.length) return false;
  const v = dir === 1 ? bars[j].h : bars[j].l;
  for (let k = j - len; k <= j + len; k++) {
    if (k === j) continue;
    const d = dir * (v - (dir === 1 ? bars[k].h : bars[k].l));
    if (k < j ? d <= 0 : d < 0) return false;
  }
  return true;
}

/** Stan z etykiet ostatniego szczytu i dołka skali. */
export function stateOf(high: SwingLabel | null | undefined, low: SwingLabel | null | undefined): StructureState {
  if (high === 'HH' && low === 'HL') return 'up';
  if (high === 'LH' && low === 'LL') return 'down';
  return 'mixed';
}

interface ScaleRun {
  scale: Scale;
  len: number;
  /** Swingi niezastąpione, w kolejności (ostatni przy końcu). */
  list: SmcSwing[];
  high: SmcSwing | null;
  low: SmcSwing | null;
  state: StructureState;
  /** Kierunek poprzedniego przełamania (0 — jeszcze żadnego). */
  lastBreak: Dir | 0;
}

/** Poziom do sweepu: cena, strona i obiekty, które oznacza (swingi obu skal na tej samej cenie i EQ). */
interface SweepLevel {
  dir: Dir;
  level: number;
  swings: SmcSwing[];
  eqs: SmcEq[];
}

interface SweepCandidate extends SweepLevel {
  start: number;
}

/** Elementy SMC na zamkniętych świecach `bars` (rosnąco, interwał `ms`); wynik dla świecy i zależy tylko od świec 0..i. */
export function smcStructure(bars: readonly SBar[], ms: number, params: SmcParams = DEFAULT_SMC_PARAMS): SmcResult {
  const p = params;
  const n = bars.length;
  const atr = wilderAtr(bars, p.atrLen);
  const res: SmcResult = { ms, atr, pivots: [], swings: [], breaks: [], sweeps: [], fvgs: [], eqs: [], states: [] };
  const runs: ScaleRun[] = [
    { scale: 'internal', len: p.internalLen, list: [], high: null, low: null, state: 'mixed', lastBreak: 0 },
    { scale: 'swing', len: p.swingLen, list: [], high: null, low: null, state: 'mixed', lastBreak: 0 },
  ];
  /** Surowe pivoty skali wewnętrznej (szczyty, dołki) do EQH i EQL. */
  const raw: Record<Dir, SmcPivot[]> = { 1: [], [-1]: [] } as Record<Dir, SmcPivot[]>;
  let openFvg: SmcFvg[] = [];
  let activeEq: SmcEq[] = [];
  let pending: SweepCandidate[] = [];
  let nextId = 1;

  const setState = (r: ScaleRun, state: StructureState, known: number) => {
    if (r.state === state) return;
    r.state = state;
    res.states.push({ scale: r.scale, known, state });
  };

  const addSweep = (c: SweepCandidate, i: number, known: number) => {
    const sources: SweepSource[] = [...new Set<SweepSource>([...c.swings.map((s) => s.scale), ...(c.eqs.length > 0 ? (['eq'] as const) : [])])];
    res.sweeps.push({ id: nextId++, dir: c.dir, level: c.level, sources, idx: c.start, t: bars[c.start].t, returnIdx: i, returnT: bars[i].t, known });
    for (const s of c.swings) if (s.sweptAt === null) s.sweptAt = known;
    for (const e of c.eqs) {
      if (e.endAt !== null) continue;
      e.endAt = known;
      e.end = 'swept';
    }
    if (c.eqs.length > 0) activeEq = activeEq.filter((e) => e.endAt === null);
  };

  /** Poziomy do sweepu znane przed świecą: ostatnie nieprzełamane swingi obu skal bez sweepu i aktywne EQ (te same ceny razem). */
  const sweepLevels = (): SweepLevel[] => {
    const out: SweepLevel[] = [];
    const at = (dir: Dir, level: number) => {
      let x = out.find((o) => o.dir === dir && o.level === level);
      if (!x) {
        x = { dir, level, swings: [], eqs: [] };
        out.push(x);
      }
      return x;
    };
    for (const r of runs) {
      for (const s of [r.high, r.low]) if (s && s.brokenAt === null && s.sweptAt === null) at(s.dir, s.price).swings.push(s);
    }
    for (const e of activeEq) at(e.dir, e.level).eqs.push(e);
    // Poziom z kandydatem w toku nie zaczyna drugiego
    return out.filter((o) => !pending.some((c) => c.dir === o.dir && c.level === o.level));
  };

  const accept = (r: ScaleRun, pv: SmcPivot, a: number) => {
    const last = r.list[r.list.length - 1];
    if (last && last.dir === pv.dir) {
      // Ten sam typ bez przeciwnego między nimi: zostaje skrajniejszy
      if (!(pv.dir * (pv.price - last.price) > 0)) return;
      last.supersededAt = pv.known;
      r.list.pop();
    } else if (last && !(Math.abs(pv.price - last.price) >= p.swingMinAtr * a)) {
      return;
    }
    let prev: SmcSwing | null = null;
    for (let k = r.list.length - 1; k >= 0 && !prev; k--) if (r.list[k].dir === pv.dir) prev = r.list[k];
    const label: SwingLabel | null = !prev ? null : pv.dir === 1 ? (pv.price > prev.price ? 'HH' : 'LH') : pv.price < prev.price ? 'LL' : 'HL';
    const s: SmcSwing = { ...pv, id: nextId++, label, supersededAt: null, brokenAt: null, sweptAt: null };
    res.swings.push(s);
    r.list.push(s);
    if (s.dir === 1) r.high = s;
    else r.low = s;
    setState(r, stateOf(r.high?.label, r.low?.label), pv.known);
  };

  /** EQH/EQL z nowym pivotem skali wewnętrznej `pv` (potwierdzonym na świecy i). */
  const equal = (pv: SmcPivot, i: number, a: number) => {
    const tol = p.eqMaxAtr * a;
    const dir = pv.dir;
    const same = raw[dir];
    if (activeEq.some((e) => e.dir === dir && Math.abs(e.level - pv.price) <= tol)) return;
    // Skrajne zamknięcie od świecy pivota do potwierdzenia, potem wstecz do kolejnych kandydatów
    let ext = dir === 1 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    for (let k = pv.idx; k <= i; k++) ext = dir === 1 ? Math.max(ext, bars[k].c) : Math.min(ext, bars[k].c);
    let k = pv.idx - 1;
    for (let q = same.length - 1; q >= 0; q--) {
      const qp = same[q];
      for (; k > qp.idx; k--) ext = dir === 1 ? Math.max(ext, bars[k].c) : Math.min(ext, bars[k].c);
      // Poziom to średnia, więc najwyżej pół tolerancji za pivotem: zamknięcie dalej wyklucza też starsze
      if (dir * (ext - pv.price) > tol / 2) return;
      if (pv.idx - qp.idx < p.eqMinBars || Math.abs(pv.price - qp.price) > tol) continue;
      const level = (pv.price + qp.price) / 2;
      if (dir * (ext - level) > 0) continue;
      const e: SmcEq = {
        id: nextId++,
        dir,
        level,
        a: { idx: qp.idx, t: qp.t, price: qp.price },
        b: { idx: pv.idx, t: pv.t, price: pv.price },
        idx: i,
        t: bars[i].t,
        known: pv.known,
        endAt: null,
        end: null,
      };
      res.eqs.push(e);
      activeEq.push(e);
      return;
    }
  };

  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const a = atr[i];
    const known = b.t + ms;

    // 1. Kandydaci na sweep z poprzednich świec: powrót zamknięciem albo koniec okna
    pending = pending.filter((c) => {
      if (c.dir * (b.c - c.level) <= 0) {
        addSweep(c, i, known);
        return false;
      }
      return i - c.start < p.sweepBars;
    });
    const levels = sweepLevels();

    // 2. Przełamania zamknięciem i koniec EQ zamknięciem za poziomem
    for (const r of runs) {
      for (const s of [r.high, r.low]) {
        if (!s || s.brokenAt !== null || !(s.dir * (b.c - s.price) > 0)) continue;
        s.brokenAt = known;
        const ref: Dir | 0 = r.state === 'up' ? 1 : r.state === 'down' ? -1 : r.lastBreak;
        const kind: BreakKind = ref === 0 || ref === s.dir ? 'BOS' : 'CHoCH';
        res.breaks.push({ id: nextId++, scale: r.scale, dir: s.dir, kind, level: s.price, swingId: s.id, swingT: s.t, swingKnown: s.known, idx: i, t: b.t, known });
        r.lastBreak = s.dir;
        if (kind === 'CHoCH') setState(r, 'mixed', known);
      }
    }
    let ended = false;
    for (const e of activeEq) {
      if (!(e.dir * (b.c - e.level) > 0)) continue;
      e.endAt = known;
      e.end = 'broken';
      ended = true;
    }
    if (ended) activeEq = activeEq.filter((e) => e.endAt === null);

    // 3. Nowi kandydaci na sweep: knot za poziomem o ≥ 0,05 ATR; powrót w tej samej świecy od razu
    if (a > 0) {
      for (const lv of levels) {
        const wick = lv.dir === 1 ? b.h - lv.level : lv.level - b.l;
        if (!(wick >= p.sweepMinAtr * a)) continue;
        const c: SweepCandidate = { ...lv, start: i };
        if (lv.dir * (b.c - lv.level) <= 0) addSweep(c, i, known);
        else if (p.sweepBars > 0) pending.push(c);
      }
    }

    // 4. FVG: wypełnienie i wygaśnięcie otwartych, potem nowa luka tej świecy
    openFvg = openFvg.filter((f) => {
      if (known >= f.expiresAt) return false;
      if (f.ceAt === null && (f.dir === 1 ? b.l <= fvgMid(f) : b.h >= fvgMid(f))) f.ceAt = known;
      if (f.dir === 1 ? b.l <= f.lo : b.h >= f.hi) {
        f.filledAt = known;
        return false;
      }
      return true;
    });
    if (i >= 2 && a > 0) {
      const p2 = bars[i - 2];
      const gaps: [Dir, number, number][] = [];
      if (b.l > p2.h && b.l - p2.h >= p.fvgMinAtr * a) gaps.push([1, p2.h, b.l]);
      if (b.h < p2.l && p2.l - b.h >= p.fvgMinAtr * a) gaps.push([-1, b.h, p2.l]);
      for (const [dir, lo, hi] of gaps) {
        const f: SmcFvg = { id: nextId++, dir, lo, hi, idx: i, t: b.t, known, expiresAt: known + p.fvgLifeMs, filledAt: null, ceAt: null };
        res.fvgs.push(f);
        openFvg.push(f);
      }
    }

    // 5. Pivoty potwierdzone na tej świecy: EQ (skala wewnętrzna, przed filtrem) i swingi struktury
    for (const r of runs) {
      const j = i - r.len;
      if (j < r.len) continue;
      for (const dir of [1, -1] as const) {
        if (!isPivot(bars, j, r.len, dir)) continue;
        const pv: SmcPivot = { scale: r.scale, dir, idx: j, t: bars[j].t, price: dir === 1 ? bars[j].h : bars[j].l, known };
        res.pivots.push(pv);
        if (!(a > 0)) continue;
        if (r.scale === 'internal') {
          equal(pv, i, a);
          raw[dir].push(pv);
        }
        accept(r, pv, a);
      }
    }
  }
  return res;
}

/** Stan struktury skali w chwili `asOf` (ostatnia zmiana znana do niej; wcześniej „mieszana”). */
export function stateAt(r: SmcResult, scale: Scale, asOf: number): StructureState {
  let s: StructureState = 'mixed';
  for (const x of r.states) {
    if (x.known > asOf) break;
    if (x.scale === scale) s = x.state;
  }
  return s;
}

/**
 * Wypełnienie FVG w chwili `asOf` (0–1): najgłębsze wejście ceny w lukę od jej strony na świecach po świecy luki,
 * zamkniętych do `asOf` i przed wygaśnięciem; wypełniona — 1.
 */
export function fvgFill(f: SmcFvg, bars: readonly SBar[], ms: number, asOf: number): number {
  if (f.filledAt !== null && f.filledAt <= asOf) return 1;
  const w = f.hi - f.lo;
  if (!(w > 0)) return 0;
  let depth = 0;
  for (let k = f.idx + 1; k < bars.length; k++) {
    const end = bars[k].t + ms;
    if (end > asOf || end >= f.expiresAt) break;
    depth = Math.max(depth, f.dir === 1 ? f.hi - bars[k].l : bars[k].h - f.lo);
  }
  return Math.min(1, Math.max(0, depth / w));
}
