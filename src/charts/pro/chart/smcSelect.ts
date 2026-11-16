import {
  DEFAULT_SMC_PARAMS,
  type Dir,
  type SBar,
  type Scale,
  type SmcBreak,
  type SmcEq,
  type SmcFvg,
  type SmcOb,
  type SmcResult,
  type SmcSweep,
  type SmcSwing,
  type StructureState,
  SCALES,
  fvgFill,
  stateAt,
} from '../core/smcStructure';
import { tr } from '../../../i18n';

/**
 * Co rysuje warstwa „Struktura i płynność (SMC+HL)” w chwili `asOf` (zamknięcie ostatniej zamkniętej świecy, w powtórce
 * świecy powtórki). Model (`smcStructure`) liczy wszystko; tu tylko wybór, bez płótna i stanu, więc ten sam wynik służy
 * warstwie, legendzie i testom. Element jest brany tylko wtedy, gdy jego `known` ≤ `asOf`, a jego stan (przełamany,
 * wypełniona, zakończony) — tylko ze zdarzeń znanych do `asOf`.
 *
 * - **Tryb „bieżące”:** FVG otwarte (także częściowo wypełnione), 5 najbliższych ostatniemu zamknięciu; EQH i EQL
 *   aktywne, po 2 najbliższe; etykiety 6 ostatnich swingów (obu skal; na tej samej świecy i typie zostaje skala
 *   swingowa); linie BOS i CHoCH: 3 ostatnie z 24 h; sweepy: 2 ostatnie z 24 h; pas równowagi zakresu swingowego.
 * - **Tryb „historia 24 h”:** jak „bieżące” i do tego FVG oraz EQ zakończone w ostatnich 24 h (przygaszone), w tych
 *   samych limitach: najpierw aktywne według bliskości, potem zakończone od najnowszych.
 * - **OB (S1):** aktywne i dotknięte, po 3 najbliższe ostatniemu zamknięciu na skalę i typ (ta sama świeca i strona z obu
 *   skal — jeden, skali swingowej); zmitygowany (tryb `mitigation`: zamknięciem — domyślnie — albo knotem) i wygasły
 *   znikają, w „historii” zostają przygaszone (zakończone w oknie, od najnowszych). OB idą do rysunku ostatnie: gdy reszta
 *   zajmuje dużo, łączny limit 25 obiektów obcina najdalsze OB (najpierw zakończone).
 * - **Telefon:** tylko struktura (etykiety), BOS, CHoCH, najbliższa FVG i najbliższy OB.
 *
 * Bez OB najwięcej obiektów: 5 + 2 + 2 + 6 + 3 + 2 + 1 = 21; z OB łącznie najwyżej 25 (projekt). Bez częstości bazowych (etap S2).
 */

export const SMC_LIMITS = { fvg: 5, eq: 2, labels: 6, breaks: 3, sweeps: 2, ob: 3 } as const;
export const SMC_PHONE_LIMITS = { fvg: 1, eq: 0, labels: 6, breaks: 3, sweeps: 0, ob: 1 } as const;
/** Łączny limit obiektów rysunku (projekt Pioniera: „najwyżej ok. 25”). */
export const SMC_OBJECTS_MAX = 25;
/** Łączny limit obiektów na telefonie (6 etykiet, 3 linie, 1 luka; pilnuje go też pomiar układu `ui:check`). */
export const SMC_PHONE_OBJECTS_MAX = 10;
/** Okno trybu „historia” oraz zdarzeń (przełamania, sweepy) w trybie „bieżące”. */
export const SMC_WINDOW_MS = 24 * 3_600_000;
/** Okno w świecach dla wyższych interwałów: 24 h to na 4H tylko 6 świec, więc okno rośnie do 24 świec interwału. */
export const SMC_WINDOW_CANDLES = 24;
/** Okno elementów (BOS, CHoCH, sweepy, historia FVG i EQ): max(24 h, 24 świece) — do 1 h bez zmian. */
export const smcWindowMs = (ms: number): number => Math.max(SMC_WINDOW_MS, SMC_WINDOW_CANDLES * ms);
/** Podpis okna: „24 h” do 1 h, wyżej liczba świec. */
export const smcWindowText = (ms: number): string => (smcWindowMs(ms) === SMC_WINDOW_MS ? tr('24 h', '24 h') : tr(`${SMC_WINDOW_CANDLES} świece`, `${SMC_WINDOW_CANDLES} candles`));

export interface SmcFvgView {
  f: SmcFvg;
  /** Wypełnienie 0–1 w chwili `asOf`. */
  fill: number;
  /** Czy cena dotknęła środka luki (CE) do `asOf`. */
  ce: boolean;
  /** Zakończona do `asOf` (tylko w trybie „historia”): wypełniona albo wygasła. */
  ended: 'filled' | 'expired' | null;
  /** Koniec rysunku (chwila zakończenia; null — otwarta). */
  endAt: number | null;
}

export interface SmcEqView {
  e: SmcEq;
  ended: boolean;
}

export type ObMitigation = 'close' | 'wick';
export type ObState = 'active' | 'touched' | 'mitigated' | 'expired';

export interface SmcObView {
  o: SmcOb;
  /** Stan w chwili `asOf` w wybranym trybie mitygacji. */
  state: ObState;
  /** Zakończony do `asOf` (tylko w trybie „historia”): zmitygowany albo wygasły. */
  ended: boolean;
  /** Koniec rysunku i świeca mitygacji (null — trwa albo wygasł). */
  endAt: number | null;
  endIdx: number | null;
}

export interface SmcPremium {
  hi: number;
  lo: number;
  /** Pas równowagi (cena). */
  eqLo: number;
  eqHi: number;
  /** Położenie ostatniego zamknięcia w zakresie (0 — dołek, 1 — szczyt; poza zakresem < 0 albo > 1). */
  pct: number;
  zone: 'premium' | 'equilibrium' | 'discount';
  /** Chwila, od której zakres jest znany (późniejszy z dwóch swingów), i świeca tej chwili. */
  known: number;
  t: number;
}

export interface SmcSelection {
  history: boolean;
  labels: SmcSwing[];
  breaks: SmcBreak[];
  sweeps: SmcSweep[];
  fvgs: SmcFvgView[];
  eqs: SmcEqView[];
  obs: SmcObView[];
  pd: SmcPremium | null;
  state: Record<Scale, StructureState>;
  /** Aktywne w chwili `asOf` przed limitami (legenda); OB — aktywne i dotknięte. */
  active: { fvg: number; eqh: number; eql: number; ob: number };
  mitigation: ObMitigation;
  close: number;
  atr: number;
  asOf: number;
}

export interface SmcSelectOptions {
  phone: boolean;
  history: boolean;
  /** Mitygacja OB: zamknięciem za dalszą krawędzią (domyślnie) albo knotem. */
  mitigation?: ObMitigation;
}

/** Liczba obiektów do narysowania. */
export const smcObjects = (s: SmcSelection): number => s.labels.length + s.breaks.length + s.sweeps.length + s.fvgs.length + s.eqs.length + s.obs.length + (s.pd ? 1 : 0);

/** Indeks ostatniej świecy zamkniętej do `asOf` (−1, gdy brak). */
function indexAt(bars: readonly SBar[], ms: number, asOf: number): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t + ms <= asOf) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** Chwila zdarzenia tylko, gdy znana do `asOf` (wybór nie niesie stanu z przyszłości). */
const upTo = (x: number | null, asOf: number) => (x !== null && x <= asOf ? x : null);
const swingAt = (s: SmcSwing, asOf: number): SmcSwing => ({ ...s, supersededAt: upTo(s.supersededAt, asOf), brokenAt: upTo(s.brokenAt, asOf), sweptAt: upTo(s.sweptAt, asOf) });
const fvgAt = (f: SmcFvg, asOf: number): SmcFvg => ({ ...f, filledAt: upTo(f.filledAt, asOf), ceAt: upTo(f.ceAt, asOf) });
const eqAt = (e: SmcEq, asOf: number): SmcEq => {
  const endAt = upTo(e.endAt, asOf);
  return { ...e, endAt, end: endAt === null ? null : e.end };
};

/** OB z chwilami zdarzeń tylko do `asOf`. */
const obAt = (o: SmcOb, asOf: number): SmcOb => {
  const wickAt = upTo(o.wickAt, asOf);
  const closeAt = upTo(o.closeAt, asOf);
  return { ...o, touchedAt: upTo(o.touchedAt, asOf), wickAt, wickIdx: wickAt === null ? null : o.wickIdx, closeAt, closeIdx: closeAt === null ? null : o.closeIdx };
};

/** Koniec OB do `asOf` w trybie mitygacji (mitygacja albo wygaśnięcie); null — trwa. */
function obEnd(o: SmcOb, asOf: number, mode: ObMitigation): { at: number; idx: number | null; kind: 'mitigated' | 'expired' } | null {
  const at = mode === 'wick' ? o.wickAt : o.closeAt;
  if (at !== null && at <= asOf) return { at, idx: mode === 'wick' ? o.wickIdx : o.closeIdx, kind: 'mitigated' };
  if (o.expiresAt <= asOf) return { at: o.expiresAt, idx: null, kind: 'expired' };
  return null;
}

const gapDistance = (lo: number, hi: number, close: number) => (close >= lo && close <= hi ? 0 : Math.min(Math.abs(close - lo), Math.abs(close - hi)));

/** Chwila końca FVG do `asOf` (wypełnienie albo wygaśnięcie); null — otwarta. */
function fvgEnd(f: SmcFvg, asOf: number): { at: number; kind: 'filled' | 'expired' } | null {
  if (f.filledAt !== null && f.filledAt <= asOf) return { at: f.filledAt, kind: 'filled' };
  if (f.expiresAt <= asOf) return { at: f.expiresAt, kind: 'expired' };
  return null;
}

export function selectSmc(r: SmcResult, bars: readonly SBar[], asOf: number, o: SmcSelectOptions): SmcSelection {
  const ms = r.ms;
  const lim = o.phone ? SMC_PHONE_LIMITS : SMC_LIMITS;
  const i = indexAt(bars, ms, asOf);
  const state = { internal: stateAt(r, 'internal', asOf), swing: stateAt(r, 'swing', asOf) };
  const mode: ObMitigation = o.mitigation ?? 'close';
  const out: SmcSelection = { history: o.history, labels: [], breaks: [], sweeps: [], fvgs: [], eqs: [], obs: [], pd: null, state, active: { fvg: 0, eqh: 0, eql: 0, ob: 0 }, mitigation: mode, close: Number.NaN, atr: Number.NaN, asOf };
  if (i < 0) return out;
  const close = bars[i].c;
  out.close = close;
  out.atr = r.atr[i];
  const win = smcWindowMs(ms);
  const recent = (t: number) => t <= asOf && asOf - t < win;

  // Etykiety: swingi znane i niezastąpione w chwili asOf, od najnowszych; ta sama świeca i typ — jedna (skala swingowa)
  const live = r.swings.filter((s) => s.known <= asOf && (s.supersededAt === null || s.supersededAt > asOf) && s.label !== null);
  const bySpot = new Map<string, SmcSwing>();
  for (const s of live) {
    const key = `${s.idx}|${s.dir}`;
    const was = bySpot.get(key);
    if (!was || (s.scale === 'swing' && was.scale !== 'swing')) bySpot.set(key, s);
  }
  out.labels = [...bySpot.values()].sort((a, b) => b.known - a.known || b.idx - a.idx).slice(0, lim.labels)
    .map((s) => swingAt(s, asOf));

  out.breaks = r.breaks.filter((b) => recent(b.known)).sort((a, b) => b.known - a.known || b.id - a.id).slice(0, lim.breaks);
  out.sweeps = r.sweeps.filter((s) => recent(s.known)).sort((a, b) => b.known - a.known || b.id - a.id).slice(0, lim.sweeps);

  // FVG: otwarte według bliskości (remis — nowsza), w historii potem zakończone w 24 h od najnowszych
  const knownFvg = r.fvgs.filter((f) => f.known <= asOf);
  const open = knownFvg.filter((f) => fvgEnd(f, asOf) === null);
  out.active.fvg = open.length;
  const fvgList: SmcFvg[] = open.sort((a, b) => gapDistance(a.lo, a.hi, close) - gapDistance(b.lo, b.hi, close) || b.known - a.known);
  if (o.history) {
    const ended = knownFvg
      .map((f) => ({ f, end: fvgEnd(f, asOf) }))
      .filter((x) => x.end !== null && recent(x.end.at))
      .sort((a, b) => (b.end?.at ?? 0) - (a.end?.at ?? 0) || b.f.id - a.f.id)
      .map((x) => x.f);
    fvgList.push(...ended);
  }
  out.fvgs = fvgList.slice(0, lim.fvg).map((f) => {
    const end = fvgEnd(f, asOf);
    return { f: fvgAt(f, asOf), fill: fvgFill(f, bars, ms, asOf), ce: f.ceAt !== null && f.ceAt <= asOf, ended: end ? end.kind : null, endAt: end ? end.at : null };
  });

  // EQH i EQL: aktywne według bliskości, w historii potem zakończone w 24 h
  const knownEq = r.eqs.filter((e) => e.known <= asOf);
  const activeEq = (e: SmcEq) => e.endAt === null || e.endAt > asOf;
  for (const dir of [1, -1] as Dir[]) {
    const act = knownEq.filter((e) => e.dir === dir && activeEq(e)).sort((a, b) => Math.abs(a.level - close) - Math.abs(b.level - close) || b.known - a.known);
    if (dir === 1) out.active.eqh = act.length;
    else out.active.eql = act.length;
    const list: SmcEqView[] = act.map((e) => ({ e: eqAt(e, asOf), ended: false }));
    if (o.history) {
      const ended = knownEq.filter((e) => e.dir === dir && !activeEq(e) && recent(e.endAt as number)).sort((a, b) => (b.endAt as number) - (a.endAt as number) || b.id - a.id);
      list.push(...ended.map((e) => ({ e: eqAt(e, asOf), ended: true })));
    }
    out.eqs.push(...list.slice(0, lim.eq));
  }

  // Premium i discount: ostatni szczyt i dołek skali swingowej znane do asOf
  if (!o.phone) {
    let hi: SmcSwing | null = null;
    let lo: SmcSwing | null = null;
    for (const s of r.swings) {
      if (s.scale !== 'swing' || s.known > asOf) continue;
      if (s.dir === 1 && (!hi || s.known >= hi.known)) hi = s;
      if (s.dir === -1 && (!lo || s.known >= lo.known)) lo = s;
    }
    if (hi && lo && hi.price > lo.price) {
      const w = hi.price - lo.price;
      const pct = (close - lo.price) / w;
      const p = DEFAULT_SMC_PARAMS;
      const zone = pct > p.equilibriumHi ? 'premium' : pct < p.equilibriumLo ? 'discount' : 'equilibrium';
      const known = Math.max(hi.known, lo.known);
      out.pd = { hi: hi.price, lo: lo.price, eqLo: lo.price + p.equilibriumLo * w, eqHi: lo.price + p.equilibriumHi * w, pct, zone, known, t: known };
    }
  }

  // OB: ta sama świeca i strona z obu skal — jeden (skala swingowa); aktywne według bliskości, w historii potem zakończone
  const byCandle = new Map<string, SmcOb>();
  for (const x of r.obs) {
    if (x.known > asOf) continue;
    const key = `${x.idx}|${x.dir}`;
    const was = byCandle.get(key);
    if (!was || (x.scale === 'swing' && was.scale !== 'swing')) byCandle.set(key, x);
  }
  const obs = [...byCandle.values()].map((x) => ({ x, end: obEnd(x, asOf, mode), d: gapDistance(x.lo, x.hi, close) }));
  out.active.ob = obs.filter((v) => v.end === null).length;
  type Cand = (typeof obs)[number];
  const pick = (list: Cand[], n: number): Cand[] => {
    const act = list.filter((v) => v.end === null).sort((a, b) => a.d - b.d || b.x.known - a.x.known);
    const ended = o.history
      ? list.filter((v) => v.end !== null && recent(v.end.at)).sort((a, b) => (b.end?.at ?? 0) - (a.end?.at ?? 0) || b.x.id - a.x.id)
      : [];
    return [...act, ...ended].slice(0, n);
  };
  const chosen: Cand[] = o.phone ? pick(obs, lim.ob) : SCALES.flatMap((sc) => ([1, -1] as Dir[]).flatMap((dir) => pick(obs.filter((v) => v.x.scale === sc && v.x.dir === dir), lim.ob)));
  // Łączny limit obiektów: najdalsze OB odpadają pierwsze (najpierw zakończone)
  const room = Math.max(0, SMC_OBJECTS_MAX - smcObjects(out));
  const kept = new Set(
    [...chosen]
      .sort((a, b) => Number(a.end !== null) - Number(b.end !== null) || a.d - b.d)
      .slice(0, room)
  );
  out.obs = chosen
    .filter((v) => kept.has(v))
    .map(({ x, end }): SmcObView => ({
      o: obAt(x, asOf),
      state: end ? end.kind : x.touchedAt !== null && x.touchedAt <= asOf ? 'touched' : 'active',
      ended: end !== null,
      endAt: end ? end.at : null,
      endIdx: end ? end.idx : null,
    }));
  trimSmc(out, o.phone ? SMC_PHONE_OBJECTS_MAX : SMC_OBJECTS_MAX);
  return out;
}

/** Wspólny budżet: najpierw pomijamy etykiety swingów, zachowując najbliższy OB. */
export function trimSmc(sel: SmcSelection, cap: number): void {
  while (smcObjects(sel) > cap) {
    if (sel.labels.length) sel.labels.pop();
    else if (sel.sweeps.length) sel.sweeps.pop();
    else if (sel.eqs.length) sel.eqs.pop();
    else if (sel.breaks.length) sel.breaks.pop();
    else if (sel.fvgs.length) sel.fvgs.pop();
    else if (sel.obs.length) sel.obs.pop();
    else sel.pd = null;
  }
}
