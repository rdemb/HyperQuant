import type { IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, SeriesType, Time } from 'lightweight-charts';
import { tr } from '../../../i18n';
import { numLang } from '../../../ui/format';
import { fmtSignedVol } from '../../orderflow/renderer';
import { DEFAULT_SMC_PARAMS, SMC_OB_LIFE_CANDLES, type SBar, type Scale, type SmcParams, type SmcResult, type StructureState, fvgMid, smcStructure } from '../core/smcStructure';
import { type HtfPick, type SmcMtf, htfLabel, pickHtf, smcMtf } from '../core/smcMtf';
import { fmtDayTime } from '../core/time';
import { PREV_NAMES, prevHighLow, prevPeriodsOf } from '../core/prevPeriods';
import type { Candle } from '../hl/parse';
import { effortResult } from '../indicators/registry';
import { logicalOfTime } from './overlay';
import { type SmcRateElement, loadSmcRates, smcRatesHover, smcRatesLine } from './smcRates';
import { SMC_ACCEPT_BARS, type BreakFlow, type FvgFlow, type ObFlow, type SmcFootprint, breakFlow, dirArrow, fvgFlow, obFlow } from './smcFlow';
import { SMC_OBJECTS_MAX, SMC_PHONE_OBJECTS_MAX, type ObMitigation, type SmcObView, type SmcSelection, overlapShare, selectSmc, trimSmc, smcObjects, smcWindowText } from './smcSelect';
import { type SmcMtfSelection, selectSmcMtf, smcMtfObjects } from './smcMtfSelect';
import { MONO, PRO, rgba } from './theme';
import { type ValueRef, valueBadge } from '../core/valueReference';

/** Wartość doby względem potwierdzonego zakresu swingowego. */
export function smcValueContext(pd: NonNullable<SmcSelection['pd']>, ref: ValueRef | null): string {
  if (!ref) return tr('VA / POC dnia: —, brak pełnego źródła 5m', 'Day VA / POC: —, incomplete 5m source');
  const zone = (lo: number, hi: number): string => {
    if (lo < pd.lo || hi > pd.hi) return tr('poza zakresem swingu', 'outside the swing range');
    if (hi < pd.eqLo) return 'discount';
    if (lo > pd.eqHi) return 'premium';
    if (lo >= pd.eqLo && hi <= pd.eqHi) return tr('równowaga', 'equilibrium');
    return tr('przecina strefy', 'crosses zones');
  };
  return `VA (${tr('wolumen', 'volume')}): ${zone(ref.val, ref.vah)} · POC: ${zone(ref.poc, ref.poc)} · ${valueBadge(ref)}`;
}

/**
 * Warstwa wskaźnika „Struktura i płynność (SMC+HL)” na wykresie ceny (każdy interwał, na żywo i w powtórce). Model
 * (`smcStructure`) liczy elementy na zamkniętych świecach, rysowany jest wybór `selectSmc` na ostatniej zamkniętej
 * świecy. Kolory neutralne według rodzaju elementu, nie strony transakcji: struktura (etykiety swingów, linie BOS
 * i CHoCH, sweepy, pas równowagi) szara, FVG w bursztynie poziomów, EQH i EQL w jego jaśniejszym odcieniu, OB w złocie
 * kategorii. Nic nie zaczyna się przed chwilą, od której było znane: FVG od świecy luki, EQ od potwierdzenia drugiego
 * pivota, linia przełamania od chwili, w której swing był znany, strefa OB od świecy przełamania; etykieta i kreska sweepu
 * stoją na świecy krańca albo knota, a przerywany obrys świecy OB na niej samej — jako znaczniki.
 */

/** Styl widocznego wskaźnika: krycie, grubość linii, tryb „historia 24 h”, okna pivota obu skal i mitygacja OB. */
export interface SmcStyle {
  alpha: number;
  width: number;
  history?: boolean;
  internalLen: number;
  swingLen: number;
  mitigation?: ObMitigation;
  /** Parametr „Wyższy interwał” (`SMC_HTF_OPTIONS`: 0 automatycznie, −1 wyłączony, inaczej minuty). */
  higher?: number;
  periods?: number;
}

/** Świece wyższego interwału `ms` z magazynu: lista (może kończyć się świecą w toku), powód braku albo undefined (w drodze). */
export interface SmcHigherFeed {
  ms: number;
  candles: readonly SBar[] | { why: string } | undefined;
}

const isHigherAbsent = (c: readonly SBar[] | { why: string }): c is { why: string } => 'why' in c;

/** Wyższy interwał w legendzie: wybór, wybór elementów albo powód braku świec (null — są albo niepotrzebne). */
export interface SmcHigherView {
  pick: HtfPick;
  sel: SmcMtfSelection | null;
  why: string | null;
}

/** Świeca wykresu (ProBar): czas, świeca i taśma (delta agresorów; `complete` — świeca w całości nagrana). */
export interface SmcSourceBar {
  t: number;
  candle: Candle;
  fp?: SmcFootprint | null;
  complete?: boolean;
}

/** Okno F-C1 (wysiłek a wynik): tyle wcześniejszych świec z pełną taśmą, co domyślna „Długość” wskaźnika W/W. */
export const SMC_FC1_LEN = 60;
/** Percentyl wolumenu świecy wobec tylu poprzednich świec (od 20). */
export const SMC_VOL_LEN = 100;

/** Taśma świecy: delta (LIVE), wynik wobec wysiłku F-C1 (MODEL) z powodem braku i percentyl wolumenu (MODEL). */
export interface SmcCandleTape {
  delta: number | null;
  fc1: number | null;
  /** Powód braku F-C1 przy delcie: za mało świec z taśmą albo wpływ nieodróżnialny od szumu. */
  fc1Why: 'few' | 'noise' | null;
  volPct: number | null;
}

/** Punkt F-C1 świecy (jak wskaźnik W/W): x — delta razy zamknięcie w mln USD, y — zwrot w pb; tylko świeca w całości nagrana. */
function fc1Point(b: SmcSourceBar): [number, number] | null {
  const fp = b.complete ? b.fp : null;
  if (!fp || !(b.candle.o > 0)) return null;
  return [(fp.delta * b.candle.c) / 1e6, ((b.candle.c - b.candle.o) / b.candle.o) * 1e4];
}

/**
 * Taśma świecy `idx` z zamkniętych świec `bars`: delta tylko przy świecy w całości nagranej; F-C1 jak wskaźnik W/W —
 * prosta z ostatnich `SMC_FC1_LEN` wcześniejszych świec z pełną taśmą (świece z luką pomijane); percentyl wolumenu
 * (udział wcześniejszych świec z mniejszym wolumenem) wobec `SMC_VOL_LEN` poprzednich, od 20 świec.
 */
export function candleTape(bars: readonly SmcSourceBar[], idx: number): SmcCandleTape {
  const out: SmcCandleTape = { delta: null, fc1: null, fc1Why: null, volPct: null };
  const b = bars[idx];
  if (!b) return out;
  const prev = bars.slice(Math.max(0, idx - SMC_VOL_LEN), idx).filter((x) => Number.isFinite(x.candle.v));
  if (prev.length >= 20 && Number.isFinite(b.candle.v)) out.volPct = prev.filter((x) => x.candle.v < b.candle.v).length / prev.length;
  const pt = fc1Point(b);
  if (!pt || !b.fp) return out;
  out.delta = b.fp.delta;
  const xs = new Float64Array(SMC_FC1_LEN);
  const ys = new Float64Array(SMC_FC1_LEN);
  let k = 0;
  for (let j = idx - 1; j >= 0 && k < SMC_FC1_LEN; j--) {
    const q = fc1Point(bars[j]);
    if (!q) continue;
    xs[k] = q[0];
    ys[k++] = q[1];
  }
  if (k < SMC_FC1_LEN) {
    out.fc1Why = 'few';
    return out;
  }
  const f = effortResult(pt[0], pt[1], xs, ys, SMC_FC1_LEN);
  if (f) out.fc1 = f.z;
  else out.fc1Why = 'noise';
  return out;
}

const NO_TAPE = (): SmcCandleTape => ({ delta: null, fc1: null, fc1Why: null, volPct: null });

/** Bez górnej granicy interwału: okna liczone są w max(24 h, 24 świece) (`smcWindowMs`). */
export const SMC_MAX_TF = Number.POSITIVE_INFINITY;
/**
 * Kolory rodzajów elementów (bez kolorów kupna i sprzedaży, żeby nie sugerować strony): struktura szara, OB fiolet,
 * FVG bursztyn, płynność (EQH, EQL, sweepy) morski, połowy zakresu: premium różane, discount oliwkowe. Rodzaj widać od
 * razu po kolorze, kierunek ruchu, po którym element powstał, mówi strzałka w podpisie.
 */
export const SMC_INK = {
  structure: PRO.nakedPoc,
  fvg: PRO.level,
  eq: PRO.smcLiquidity,
  ob: PRO.smcOb,
  premium: PRO.smcPremium,
  discount: PRO.smcDiscount,
} as const;

/** Potwierdzenia z taśmy dla wybranych elementów (klucz: id elementu; null — brak pełnej taśmy albo za wcześnie). */
export interface SmcFlowView {
  ob: Map<number, ObFlow>;
  fvg: Map<number, FvgFlow | null>;
  brk: Map<number, BreakFlow | null>;
}

type LegendPart = { text: string; color: string };

const pct = (x: number) => numLang(String(Math.round(x * 100)));

function stateText(s: StructureState): string {
  if (s === 'up') return tr('wzrostowa (HH i HL)', 'rising (HH and HL)');
  if (s === 'down') return tr('spadkowa (LH i LL)', 'falling (LH and LL)');
  return tr('mieszana', 'mixed');
}

const scaleText = (s: Scale) => (s === 'internal' ? tr('skala wewn.', 'internal scale') : tr('skala swing.', 'swing scale'));
const sigma = (z: number) => `${z > 0 ? '+' : z < 0 ? '−' : ''}${numLang(Math.abs(z).toFixed(1))} σ`;
const mitigationText = (m: ObMitigation): string => (m === 'wick' ? tr('knotem', 'by wick') : tr('zamknięciem', 'by close'));

/** Taśma świecy w opisie: (wolumen MODEL), delta LIVE i F-C1 MODEL; bez taśmy „—” z powodem. */
function tapeText(x: SmcCandleTape, withVol: boolean): string {
  const vol =
    withVol && x.volPct !== null ? tr(`wolumen p${pct(x.volPct)} wobec ${SMC_VOL_LEN} poprzednich świec MODEL, `, `volume p${pct(x.volPct)} against the previous ${SMC_VOL_LEN} candles MODEL, `) : '';
  if (x.delta === null) return `${vol}${tr('taśma —: brak taśmy', 'tape —: no tape')}`;
  const fc1 =
    x.fc1 !== null
      ? tr(`wynik wobec wysiłku (F-C1) ${sigma(x.fc1)} MODEL`, `effort vs result (F-C1) ${sigma(x.fc1)} MODEL`)
      : x.fc1Why === 'few'
        ? tr(`wynik wobec wysiłku (F-C1) —: mniej niż ${SMC_FC1_LEN} świec z taśmą`, `effort vs result (F-C1) —: fewer than ${SMC_FC1_LEN} candles with tape`)
        : tr('wynik wobec wysiłku (F-C1) —: brak mierzalnego wpływu', 'effort vs result (F-C1) —: no measurable impact');
  return `${vol}delta ${fmtSignedVol(x.delta)} LIVE, ${fc1}`;
}

/** Opis OB pod krzyżem: kształt, strefa, „znany od”, stan, tryb mitygacji, taśma świecy OB (i świecy mitygacji). */
function obText(v: SmcObView, mode: ObMitigation, at: (t: number) => string, fmt: (p: number) => string, tape: (idx: number) => SmcCandleTape): LegendPart[] {
  const o = v.o;
  const what =
    o.dir === 1 ? tr(`ostatnia świeca spadkowa przed ${o.kind} w górę`, `the last down candle before a ${o.kind} up`) : tr(`ostatnia świeca wzrostowa przed ${o.kind} w dół`, `the last up candle before a ${o.kind} down`);
  const impulse = numLang(o.impulse.toFixed(1));
  const state =
    v.state === 'active'
      ? tr('aktywny', 'active')
      : v.state === 'touched'
        ? tr(`dotknięty od ${at(o.touchedAt as number)}`, `touched since ${at(o.touchedAt as number)}`)
        : v.state === 'mitigated'
          ? tr(`zmitygowany ${at(v.endAt as number)}`, `mitigated ${at(v.endAt as number)}`)
          : tr(`wygasł po ${SMC_OB_LIFE_CANDLES} świecach`, `expired after ${SMC_OB_LIFE_CANDLES} candles`);
  const ink = PRO.ink2;
  const out: LegendPart[] = [
    {
      text: tr(
        `· OB (${what}, ${scaleText(o.scale)}): strefa ${fmt(o.lo)}–${fmt(o.hi)}, impuls ${impulse} ATR, znany od ${at(o.known)}, stan: ${state}, mitygacja: ${mitigationText(mode)}`,
        `· OB (${what}, ${scaleText(o.scale)}): zone ${fmt(o.lo)}–${fmt(o.hi)}, impulse ${impulse} ATR, known from ${at(o.known)}, state: ${state}, mitigation: ${mitigationText(mode)}`
      ),
      color: ink,
    },
    { text: tr(`· świeca OB: ${tapeText(tape(o.idx), false)}`, `· OB candle: ${tapeText(tape(o.idx), false)}`), color: ink },
  ];
  if (v.state === 'mitigated' && v.endIdx !== null) {
    out.push({ text: tr(`· świeca mitygacji: ${tapeText(tape(v.endIdx), true)}`, `· mitigation candle: ${tapeText(tape(v.endIdx), true)}`), color: ink });
  }
  return out;
}

/** Taśma przy OB: absorpcja w świecy OB i POC tej świecy z taśmy. */
function obFlowText(x: ObFlow, fmt: (p: number) => string): string {
  const abs =
    x.absorption === null
      ? tr('absorpcja —: brak delty albo F-C1', 'absorption —: no delta or F-C1')
      : x.absorption
        ? tr('absorpcja: tak (delta przeciw impulsowi, cena ruszyła mniej, niż „kupiła” agresja)', 'absorption: yes (delta against the impulse, price moved less than the aggression paid for)')
        : tr('absorpcja: nie', 'absorption: no');
  const poc = x.poc === null ? tr('POC świecy —: brak pełnej taśmy', 'candle POC —: no full tape') : tr(`POC świecy z taśmy ${fmt(x.poc)} LIVE (kreska w strefie)`, `candle POC from the tape ${fmt(x.poc)} LIVE (line in the zone)`);
  return tr(`· potwierdzenie z taśmy (eksperymentalne): ${abs} · ${poc}`, `· tape confirmation (experimental): ${abs} · ${poc}`);
}

/** Taśma w luce FVG: udział i gęstość wolumenu środkowej świecy w luce. */
function fvgFlowText(x: FvgFlow | null): string {
  if (!x) return tr('· taśma w luce: —, brak pełnej taśmy świecy luki', '· tape in the gap: —, no full tape for the gap candle');
  const d = numLang(x.density.toFixed(2));
  return x.thin
    ? tr(`· taśma w luce: ${pct(x.share)}% wolumenu świecy, gęstość ${d}× średniej LIVE: pusta (eksperymentalne)`, `· tape in the gap: ${pct(x.share)}% of the candle volume, density ${d}× average LIVE: thin (experimental)`)
    : tr(`· taśma w luce: ${pct(x.share)}% wolumenu świecy, gęstość ${d}× średniej LIVE`, `· tape in the gap: ${pct(x.share)}% of the candle volume, density ${d}× average LIVE`);
}

/** Przyjęcie przełamania: zamknięcia i wolumen taśmy za poziomem w świecach po przełamaniu. */
function acceptText(x: BreakFlow | null): string {
  const n = SMC_ACCEPT_BARS;
  if (!x) return tr(`· przyjęcie: —, ${n} świece po przełamaniu jeszcze się nie zamknęły`, `· acceptance: —, the ${n} candles after the break have not closed yet`);
  const closes = tr(`${x.closes} z ${n} zamknięć za poziomem`, `${x.closes} of ${n} closes beyond the level`);
  const vol = x.share === null ? tr('wolumen —: brak pełnej taśmy', 'volume —: no full tape') : tr(`${pct(x.share)}% wolumenu taśmy za poziomem LIVE`, `${pct(x.share)}% of tape volume beyond the level LIVE`);
  const verdict = x.accepted === null ? '' : x.accepted ? tr(': z przyjęciem ✓', ': accepted ✓') : tr(': bez przyjęcia', ': not accepted');
  return `· ${tr('przyjęcie', 'acceptance')}: ${closes}, ${vol}${verdict}`;
}

/** Element pod krzyżem: opis z chwilą „znany od”. Kolejność: etykieta, sweep, przełamanie, EQ, OB, FVG. */
function hoverText(sel: SmcSelection, hover: { t: number; p: number }, ms: number, fmt: (p: number) => string, coin: string, tape: (idx: number) => SmcCandleTape, flow: SmcFlowView | null): LegendPart[] {
  const rates = (el: SmcRateElement) => smcRatesHover(ms, coin, el);
  const atr = Number.isFinite(sel.atr) && sel.atr > 0 ? sel.atr : 0;
  const near = (p: number, k: number) => Math.abs(hover.p - p) <= k * atr;
  const at = (t: number) => fmtDayTime(t, sel.asOf);
  const ink = PRO.ink2;
  for (const s of sel.labels) {
    if (hover.t < s.t || hover.t >= s.t + ms || !near(s.price, 0.5)) continue;
    const lag = Math.round((s.known - s.t - ms) / ms);
    const what = s.dir === 1 ? tr('szczyt', 'high') : tr('dołek', 'low');
    return [{ text: tr(`· ${s.label} (${scaleText(s.scale)}): ${what} ${fmt(s.price)}, znany od ${at(s.known)}, ${lag} świec po krańcu`, `· ${s.label} (${scaleText(s.scale)}): ${what} ${fmt(s.price)}, known from ${at(s.known)}, ${lag} candles after the extreme`), color: ink }];
  }
  for (const s of sel.sweeps) {
    if (hover.t < s.t || hover.t >= s.returnT + ms || !near(s.level, 0.3)) continue;
    const n = s.returnIdx - s.idx;
    const where = s.dir === 1 ? tr('nad poziomem', 'above the level') : tr('pod poziomem', 'below the level');
    return [{ text: tr(`· sweep: knot ${where} ${fmt(s.level)}, powrót zamknięciem po ${n} świecach, znany od ${at(s.known)}`, `· sweep: wick ${where} ${fmt(s.level)}, close back after ${n} candles, known from ${at(s.known)}`), color: ink }, ...rates('sweep')];
  }
  for (const b of sel.breaks) {
    if (hover.t < b.swingKnown - ms || hover.t >= b.t + ms || !near(b.level, 0.15)) continue;
    const where = b.dir === 1 ? tr('nad szczytem', 'above the high') : tr('pod dołkiem', 'below the low');
    const acc = flow ? [{ text: acceptText(flow.brk.get(b.id) ?? null), color: ink }] : [];
    return [{ text: tr(`· ${b.kind} (${scaleText(b.scale)}): zamknięcie ${where} ${fmt(b.level)}, znany od ${at(b.known)}`, `· ${b.kind} (${scaleText(b.scale)}): close ${where} ${fmt(b.level)}, known from ${at(b.known)}`), color: ink }, ...acc, ...rates(`${b.kind}_${b.scale}`)];
  }
  for (const { e } of sel.eqs) {
    if (hover.t < e.t || (e.endAt !== null && hover.t >= e.endAt) || !near(e.level, 0.15)) continue;
    const name = e.dir === 1 ? 'EQH' : 'EQL';
    const gap = e.b.idx - e.a.idx;
    return [{ text: tr(`· ${name} ${fmt(e.level)}: dwa pivoty z różnicą ${fmt(Math.abs(e.b.price - e.a.price))}, ${gap} świec od siebie, znany od ${at(e.known)}`, `· ${name} ${fmt(e.level)}: two pivots ${fmt(Math.abs(e.b.price - e.a.price))} apart, ${gap} candles apart, known from ${at(e.known)}`), color: ink }, ...rates('EQH_EQL')];
  }
  for (const v of sel.obs) {
    const o = v.o;
    if (hover.t < o.t || (v.endAt !== null && hover.t >= v.endAt) || hover.p < o.lo || hover.p > o.hi) continue;
    // Świeca OB (znacznik) albo strefa od świecy przełamania
    if (hover.t >= o.t + ms && hover.t < o.breakT) continue;
    const own = flow?.ob.get(o.id);
    return [...obText(v, sel.mitigation, at, fmt, tape), ...(own ? [{ text: obFlowText(own, fmt), color: ink }] : [])];
  }
  for (const v of sel.fvgs) {
    const f = v.f;
    if (hover.t < f.t || (v.endAt !== null && hover.t >= v.endAt) || hover.p < f.lo || hover.p > f.hi) continue;
    const kind = f.dir === 1 ? tr('luka po ruchu w górę', 'gap after a move up') : tr('luka po ruchu w dół', 'gap after a move down');
    const ce = v.ce ? tr('dotknięcie środka luki (CE)', 'gap midpoint touched (CE)') : tr('bez dotknięcia środka luki (CE)', 'gap midpoint not touched (CE)');
    const thin = flow ? [{ text: fvgFlowText(flow.fvg.get(f.id) ?? null), color: ink }] : [];
    return [{ text: tr(`· FVG (${kind}) ${fmt(f.lo)}–${fmt(f.hi)}: wypełnienie ${pct(v.fill)}%, ${ce}, znana od ${at(f.known)}`, `· FVG (${kind}) ${fmt(f.lo)}–${fmt(f.hi)}: ${pct(v.fill)}% filled, ${ce}, known from ${at(f.known)}`), color: ink }, ...thin, ...rates('FVG')];
  }
  return [];
}

/** Wiersz wyższego interwału: interwał i stan struktury obu skal z liczbą otwartych FVG albo „—” z powodem. */
function higherText(h: SmcHigherView, ms: number): LegendPart {
  const p = h.pick;
  const dash = (why: [string, string]): LegendPart => ({ text: tr(`· wyższy interwał: —, ${why[0]}`, `· higher timeframe: —, ${why[1]}`), color: PRO.ink3 });
  if (p.kind === 'off') return dash(['wyłączony w parametrach', 'turned off in the inputs']);
  if (p.kind === 'none') return dash([`brak wyższego interwału dla ${htfLabel(ms)}`, `no higher timeframe for ${htfLabel(ms)}`]);
  if (p.kind === 'notHigher') return dash([`${p.label} nie jest wyższy od interwału wykresu ${htfLabel(ms)}`, `${p.label} is not above the chart timeframe ${htfLabel(ms)}`]);
  const head = p.auto ? tr(`· wyższy interwał ${p.label} (auto)`, `· higher timeframe ${p.label} (auto)`) : tr(`· wyższy interwał ${p.label}`, `· higher timeframe ${p.label}`);
  if (h.why !== null) return { text: `${head}: —, ${h.why}`, color: PRO.ink3 };
  const s = h.sel;
  if (!s) return { text: tr(`${head}: czekam na świece ${p.label}…`, `${head}: waiting for ${p.label} candles…`), color: PRO.ink3 };
  const count = ` · FVG ${numLang(String(s.active.fvg))}${s.active.ob > 0 ? ` · OB ${numLang(String(s.active.ob))}` : ''}`;
  if (!s.enough) {
    const few = tr(`za mało zamkniętych świec ${p.label} do struktury (${s.closed} z ${s.need})`, `too few closed ${p.label} candles for the structure (${s.closed} of ${s.need})`);
    return { text: `${head}: —, ${few}${count}`, color: PRO.ink3 };
  }
  return {
    text: tr(`${head}: wewn. ${stateText(s.state.internal)} · swing. ${stateText(s.state.swing)}${count}`, `${head}: internal ${stateText(s.state.internal)} · swing ${stateText(s.state.swing)}${count}`),
    color: PRO.ink2,
  };
}

/** Element wyższego interwału pod krzyżem (od chwili `known`): przełamanie, OB, FVG. */
function higherHover(s: SmcMtfSelection, atr: number, hover: { t: number; p: number }, fmt: (p: number) => string): LegendPart[] {
  const at = (t: number) => fmtDayTime(t, s.asOf);
  const ink = PRO.ink2;
  const L = s.label;
  for (const b of s.breaks) {
    if (hover.t < b.known || Math.abs(hover.p - b.level) > 0.15 * atr) continue;
    const where = b.dir === 1 ? tr('nad szczytem', 'above the high') : tr('pod dołkiem', 'below the low');
    return [{ text: tr(`· ${L} ${b.kind} (${scaleText(b.scale)}): zamknięcie świecy ${L} ${where} ${fmt(b.level)}, znany od ${at(b.known)}`, `· ${L} ${b.kind} (${scaleText(b.scale)}): ${L} candle close ${where} ${fmt(b.level)}, known from ${at(b.known)}`), color: ink }];
  }
  for (const z of s.obs) {
    if (hover.t < z.known || hover.p < z.lo || hover.p > z.hi) continue;
    return [{ text: tr(`· ${L} OB ${fmt(z.lo)}–${fmt(z.hi)}, znany od ${at(z.known)}`, `· ${L} OB ${fmt(z.lo)}–${fmt(z.hi)}, known from ${at(z.known)}`), color: ink }];
  }
  for (const v of s.fvgs) {
    const f = v.f;
    if (hover.t < f.known || hover.p < f.lo || hover.p > f.hi) continue;
    const kind = f.dir === 1 ? tr('luka po ruchu w górę', 'gap after a move up') : tr('luka po ruchu w dół', 'gap after a move down');
    const ce = v.ce ? tr('dotknięcie środka luki (CE)', 'gap midpoint touched (CE)') : tr('bez dotknięcia środka luki (CE)', 'gap midpoint not touched (CE)');
    return [{ text: tr(`· ${L} FVG (${kind}) ${fmt(f.lo)}–${fmt(f.hi)}: wypełnienie ${pct(v.fill)}% na zamkniętych świecach ${L}, ${ce}, znana od ${at(f.known)}`, `· ${L} FVG (${kind}) ${fmt(f.lo)}–${fmt(f.hi)}: ${pct(v.fill)}% filled on closed ${L} candles, ${ce}, known from ${at(f.known)}`), color: ink }];
  }
  return [];
}

/**
 * Opis w legendzie: etykieta „eksperymentalny”, stan struktury obu skal, liczby aktywnych FVG, EQH, EQL i OB, położenie
 * ceny w połowach zakresu swingowego i częstości bazowe interwału wykresu (`smcRates`); krzyż nad elementem dopisuje,
 * od kiedy był znany, i częstości bazowe jego typu (przy OB taśmę świecy OB z `tape`; bez niej „brak taśmy”).
 * Częstości są z historii BTC, więc na innym rynku legenda podaje tylko powód braku, a krzyż ich nie dopisuje.
 */
export function smcLegend(
  sel: SmcSelection | null,
  ms: number,
  coin: string,
  hover: { t: number; p: number } | null = null,
  fmt: (p: number) => string = (p) => numLang(String(p)),
  tape: (idx: number) => SmcCandleTape = NO_TAPE,
  higher: SmcHigherView | null = null,
  flow: SmcFlowView | null = null
): LegendPart[] {
  if (ms > SMC_MAX_TF) return [{ text: tr('—, interwał do 1 h', '—, intervals up to 1 h'), color: PRO.ink3 }];
  if (!sel || !Number.isFinite(sel.close)) return [{ text: tr('czekam na świece…', 'waiting for candles…'), color: PRO.ink3 }];
  const out: LegendPart[] = [{ text: tr('eksperymentalny', 'experimental'), color: PRO.ink3 }];
  if (sel.history) out.push({ text: tr(`historia ${smcWindowText(ms)}`, `${smcWindowText(ms)} history`), color: PRO.ink2 });
  out.push({
    text: tr(`· struktura: wewn. ${stateText(sel.state.internal)} · swing. ${stateText(sel.state.swing)}`, `· structure: internal ${stateText(sel.state.internal)} · swing ${stateText(sel.state.swing)}`),
    color: PRO.ink1,
  });
  out.push({ text: `· FVG ${numLang(String(sel.active.fvg))} · EQH ${numLang(String(sel.active.eqh))} · EQL ${numLang(String(sel.active.eql))} · OB ${numLang(String(sel.active.ob))}`, color: PRO.ink2 });
  const pd = sel.pd;
  if (pd) {
    const zone = pd.zone === 'premium' ? 'premium' : pd.zone === 'discount' ? 'discount' : tr('równowaga', 'equilibrium');
    out.push({ text: tr(`· połowy zakresu swingowego: ${zone}, ${pct(pd.pct)}% zakresu`, `· halves of the swing range: ${zone}, ${pct(pd.pct)}% of the range`), color: PRO.ink2 });
  } else {
    out.push({ text: tr('· zakres swingowy: —, brak szczytu i dołka skali swingowej', '· swing range: —, no swing-scale high and low yet'), color: PRO.ink3 });
  }
  if (higher) out.push(higherText(higher, ms));
  out.push(...smcRatesLine(ms, coin));
  if (hover) {
    const own = hoverText(sel, hover, ms, fmt, coin, tape, flow);
    const atr = Number.isFinite(sel.atr) && sel.atr > 0 ? sel.atr : 0;
    out.push(...(own.length > 0 || !higher?.sel ? own : higherHover(higher.sel, atr, hover, fmt)));
  }
  return out;
}

/** Klucz podpisów: strzałka i potwierdzenia z taśmy (eksperymentalne, bez częstości bazowych). */
export const SMC_KEY = (): string =>
  tr(
    '· klucz: ↑ ↓ ruch, po którym element powstał (opis przeszłości) · absorpcja, pusta, ✓ przyjęcie: potwierdzenia z taśmy HL, eksperymentalne, bez częstości bazowych · kreska w OB: POC świecy z taśmy · linijka przy osi: premium, równowaga, discount',
    '· key: ↑ ↓ the move that created the element (describes the past) · absorption, thin, ✓ acceptance: HL tape confirmations, experimental, no base rates · line in an OB: candle POC from the tape · ruler at the axis: premium, equilibrium, discount'
  );

interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Strefa (OB, FVG, wyższy interwał): wypełnienie, obrys, kreska w środku (CE albo POC z taśmy) i znacznik świecy OB. */
interface Zone extends Rect {
  ink: string;
  /** Krycie wypełnienia (0 — bez wypełnienia). */
  fill: number;
  border: 'solid' | 'dashed' | null;
  dim: boolean;
  /** Cała luka FVG, gdy część jest już wypełniona: cienki obrys kropkowany. */
  ghost: Rect | null;
  mid: { y: number; dash: number[] } | null;
  mark: Rect | null;
}

/** Linia poziomu; `text` — podpis nad środkiem linii (BOS, CHoCH, sweep). */
interface Line {
  x0: number;
  x1: number;
  y: number;
  ink: string;
  alpha: number;
  width: number;
  dash: number[];
  text: string | null;
  bold: boolean;
  /** Podpis pod linią (sweep dołka), inaczej nad nią. */
  below?: boolean;
}

/** Podpis w kolumnie przy osi ceny (na wysokości elementu, bez nakładania się). */
interface Tag {
  y: number;
  text: string;
  ink: string;
  dim: boolean;
}

interface Scene {
  zones: Zone[];
  lines: Line[];
  ticks: { x0: number; x1: number; y: number; ink: string }[];
  labels: { x: number; y: number; text: string; above: boolean; bold: boolean }[];
  tags: Tag[];
  /** Prawa krawędź kolumny podpisów. */
  tagX: number;
  /** Linijka zakresu swingowego przy osi: odcinki premium, równowaga, discount i znacznik ostatniego zamknięcia. */
  ruler: { x: number; segs: { y0: number; y1: number; ink: string; on: boolean }[]; at: number | null } | null;
}

const emptyScene = (): Scene => ({ zones: [], lines: [], ticks: [], labels: [], tags: [], tagX: 0, ruler: null });
const EMPTY: Scene = emptyScene();

/** Miejsce za ostatnią świecą na kolumnę podpisów (kontroler dodaje je do odstępu osi czasu, gdy SMC jest widoczny). */
export const SMC_TAG_GAP_PX = 72;

/** Linijka premium i discount: szerokość i odstęp od stref. */
const RULER_W = 5;
const RULER_GAP = 4;
/** Podpis w kolumnie: wysokość pigułki i odstęp. */
export const TAG_H = 14;
const TAG_GAP = 2;

/**
 * Układ kolumny podpisów: od góry w kolejności wysokości, każdy co najmniej `TAG_H + TAG_GAP` pod poprzednim, a gdy
 * dół wychodzi poza panel — cofnięcie w górę od dołu. Zwraca środki pigułek (ta sama kolejność co `ys`).
 */
export function layoutTags(ys: readonly number[], height: number): number[] {
  const step = TAG_H + TAG_GAP;
  const order = ys.map((y, i) => [y, i] as const).sort((a, b) => a[0] - b[0]);
  const placed = order.map(([y]) => y);
  for (let k = 0; k < placed.length; k++) placed[k] = Math.max(placed[k], k > 0 ? placed[k - 1] + step : TAG_H / 2);
  let limit = height - TAG_H / 2;
  for (let k = placed.length - 1; k >= 0; k--) {
    if (placed[k] > limit) placed[k] = limit;
    limit = placed[k] - step;
  }
  const out = new Array<number>(ys.length);
  order.forEach(([, i], k) => (out[i] = placed[k]));
  return out;
}

/** Liczba zamkniętych świec (koniec ≤ `now`). */
function closedCount(bars: readonly SmcSourceBar[], ms: number, now: number): number {
  let n = bars.length;
  while (n > 0 && bars[n - 1].t + ms > now) n--;
  return n;
}

const toSBar = (b: SmcSourceBar): SBar => ({ t: b.t, o: b.candle.o, h: b.candle.h, l: b.candle.l, c: b.candle.c });

/** Potwierdzenia z taśmy dla elementów wyboru (tylko wybranych; zawsze ze świec zamkniętych do `asOf`). */
export function smcFlowOf(sel: SmcSelection, bars: readonly SmcSourceBar[], ms: number): SmcFlowView {
  const out: SmcFlowView = { ob: new Map(), fvg: new Map(), brk: new Map() };
  for (const v of sel.obs) out.ob.set(v.o.id, obFlow(bars, v.o, candleTape(bars, v.o.idx)));
  for (const v of sel.fvgs) out.fvg.set(v.f.id, fvgFlow(bars, v.f));
  for (const b of sel.breaks) out.brk.set(b.id, breakFlow(bars, b, ms, sel.asOf));
  return out;
}

export class SmcLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private style: SmcStyle | null = null;
  private bars: readonly SmcSourceBar[] = [];
  private ms = 60_000;
  private now = 0;
  private rightInset = 0;
  private phone = false;
  /** Zamknięte świece ostatniego przeliczenia (te same obiekty — bez zmian), okna pivota, świece modelu i wynik. */
  private src: readonly SmcSourceBar[] = [];
  private srcMs = 0;
  private srcLens = '';
  private sbars: SBar[] = [];
  private result: SmcResult | null = null;
  private sel: SmcSelection | null = null;
  /** Potwierdzenia z taśmy dla elementów wyboru (liczone raz na wybór). */
  private flow: SmcFlowView | null = null;
  /** Wyższy interwał: świece z magazynu, wybór, model (przeliczany tylko po zmianie zamkniętych świec) i wybór elementów. */
  private feed: SmcHigherFeed | null = null;
  private pick: HtfPick | null = null;
  private mtf: SmcMtf | null = null;
  private mtfKey = '';
  private hsel: SmcMtfSelection | null = null;
  private selKey: readonly unknown[] = [];
  private scene: Scene = EMPTY;
  private readonly views: readonly IPrimitivePaneView[];
  fmtPx: (p: number) => string = (p) => String(p);
  /** Po każdym nowym wyborze: liczba obiektów rysunku (pomiar układu czyta ją z atrybutu wykresu). */
  onObjects: ((n: number) => void) | null = null;

  /** `styleOf` — styl pierwszego widocznego wskaźnika (null — ukryty: bez liczenia i rysowania). */
  constructor(private readonly styleOf: () => SmcStyle | null) {
    const back: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          const st = this.style;
          if (!st) return;
          for (const z of this.scene.zones) {
            if (!(z.fill > 0)) continue;
            ctx.fillStyle = rgba(z.ink, z.fill * st.alpha);
            ctx.fillRect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0);
          }
        }),
    };
    const front: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          const st = this.style;
          if (!st) return;
          const sc = this.scene;
          const a = Math.max(0.35, 0.9 * st.alpha);
          const crisp = (v: number, w: number) => Math.round(v) + (Math.round(w) % 2 ? 0.5 : 0);
          const hline = (x0: number, x1: number, y: number, w: number) => {
            ctx.lineWidth = w;
            ctx.beginPath();
            ctx.moveTo(Math.round(x0), crisp(y, w));
            ctx.lineTo(Math.round(x1), crisp(y, w));
            ctx.stroke();
          };
          const box = (r: Rect) => ctx.strokeRect(crisp(r.x0, 1), crisp(r.y0, 1), Math.round(r.x1 - r.x0), Math.round(r.y1 - r.y0));
          // Strefy: obrys, cała luka, kreska środka, znacznik świecy OB
          for (const z of sc.zones) {
            const k = z.dim ? 0.4 * a : a;
            ctx.lineWidth = 1;
            if (z.border) {
              ctx.strokeStyle = rgba(z.ink, 0.75 * k);
              ctx.setLineDash(z.border === 'dashed' ? [4, 3] : []);
              box(z);
            }
            if (z.ghost) {
              ctx.strokeStyle = rgba(z.ink, 0.35 * k);
              ctx.setLineDash([1, 3]);
              box(z.ghost);
            }
            if (z.mid) {
              ctx.strokeStyle = rgba(z.ink, 0.85 * k);
              ctx.setLineDash(z.mid.dash);
              hline(z.x0, z.x1, z.mid.y, 1);
            }
            if (z.mark) {
              ctx.strokeStyle = rgba(z.ink, 0.6 * k);
              ctx.setLineDash([2, 2]);
              ctx.lineWidth = 1;
              box(z.mark);
            }
            ctx.setLineDash([]);
          }
          // Linie: przełamania, sweepy, EQ, zakres, poziomy D/W/M, wyższy interwał
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          for (const l of sc.lines) {
            ctx.strokeStyle = rgba(l.ink, l.alpha * a);
            ctx.setLineDash(l.dash);
            hline(l.x0, l.x1, l.y, l.width);
            ctx.setLineDash([]);
            if (l.text && l.x1 - Math.max(l.x0, 0) > 24) {
              ctx.font = `${l.bold ? 700 : 600} 9px ${MONO}`;
              ctx.fillStyle = rgba(l.ink, Math.min(1, l.alpha * a + 0.1));
              ctx.textBaseline = l.below ? 'top' : 'bottom';
              ctx.fillText(l.text, (Math.max(l.x0, 0) + l.x1) / 2, l.below ? l.y + 3 : l.y - 2);
            }
          }
          for (const t of sc.ticks) {
            ctx.strokeStyle = rgba(t.ink, a);
            hline(t.x0, t.x1, t.y, 2);
          }
          // Etykiety swingów (skala swingowa wyraźniej)
          for (const l of sc.labels) {
            ctx.font = `${l.bold ? 700 : 500} ${l.bold ? 10 : 8}px ${MONO}`;
            ctx.fillStyle = rgba(SMC_INK.structure, l.bold ? a : 0.6 * a);
            ctx.textBaseline = l.above ? 'bottom' : 'top';
            ctx.fillText(l.text, l.x, l.above ? l.y - 3 : l.y + 3);
          }
          ctx.textAlign = 'left';
          // Linijka premium i discount przy osi ceny i znacznik ostatniego zamknięcia
          const rl = sc.ruler;
          if (rl) {
            for (const g of rl.segs) {
              ctx.fillStyle = rgba(g.ink, (g.on ? 0.95 : 0.45) * a);
              ctx.fillRect(rl.x, g.y0, RULER_W, Math.max(1, g.y1 - g.y0));
            }
            if (rl.at !== null) {
              ctx.fillStyle = rgba(PRO.ink1, a);
              ctx.beginPath();
              ctx.moveTo(rl.x - 1, rl.at);
              ctx.lineTo(rl.x - 6, rl.at - 4);
              ctx.lineTo(rl.x - 6, rl.at + 4);
              ctx.closePath();
              ctx.fill();
            }
          }
          // Kolumna podpisów: pigułki na tle wykresu, bez nakładania się
          if (sc.tags.length) {
            ctx.font = `600 9.5px ${MONO}`;
            ctx.textBaseline = 'middle';
            const ys = layoutTags(
              sc.tags.map((t) => t.y),
              mediaSize.height
            );
            sc.tags.forEach((t, i) => {
              const w = Math.ceil(ctx.measureText(t.text).width) + 9;
              const x0 = sc.tagX - w;
              const y0 = Math.round(ys[i] - TAG_H / 2);
              const k = t.dim ? 0.45 : 1;
              ctx.fillStyle = rgba(PRO.bg, 0.82);
              ctx.fillRect(x0, y0, w, TAG_H);
              ctx.fillStyle = rgba(t.ink, 0.95 * k * a);
              ctx.fillRect(x0, y0, 2, TAG_H);
              // Podpis przesunięty z wysokości elementu: kreska do niej przy krawędzi kolumny
              if (Math.abs(ys[i] - t.y) > 3) {
                ctx.strokeStyle = rgba(t.ink, 0.5 * k * a);
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(sc.tagX + 1.5, Math.round(ys[i]) + 0.5);
                ctx.lineTo(sc.tagX + 1.5, Math.round(t.y) + 0.5);
                ctx.stroke();
              }
              ctx.fillText(t.text, x0 + 5, y0 + TAG_H / 2 + 0.5);
            });
          }
        }),
    };
    this.views = [
      { zOrder: () => 'bottom', renderer: () => back },
      { zOrder: () => 'top', renderer: () => front },
    ];
    // Częstości bazowe (osobny kawałek paczki): po wczytaniu odświeżenie, żeby legenda je pokazała
    loadSmcRates().then(
      () => this.requestUpdate?.(),
      () => this.requestUpdate?.()
    );
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.chart = p.chart;
    this.series = p.series;
    this.requestUpdate = p.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  setRightInset(px: number): void {
    this.rightInset = px;
    this.requestUpdate?.();
  }

  /** Telefon: tylko struktura, BOS i CHoCH oraz najbliższa FVG. */
  setPhone(on: boolean): void {
    if (on === this.phone) return;
    this.phone = on;
    this.reselect();
    this.requestUpdate?.();
  }

  /**
   * Świece wykresu i świece wyższego interwału z magazynu (`higher`, null — niepotrzebne: ukryty, wyłączony albo brak
   * wyższego); przeliczenie modeli tylko po zmianie zamkniętych świec albo okien pivota.
   */
  private daily: readonly Candle[] = [];

  setData(bars: readonly SmcSourceBar[], ms: number, now: number, higher: SmcHigherFeed | null = null, daily: readonly Candle[] = []): void {
    this.daily = daily;
    this.bars = bars;
    this.ms = ms;
    this.now = now;
    this.feed = higher;
    const st = this.styleOf();
    this.recompute(st);
    this.recomputeHigher(st);
    this.reselect();
    this.requestUpdate?.();
  }

  private recompute(st: SmcStyle | null): void {
    if (!st || this.ms > SMC_MAX_TF) {
      this.src = [];
      this.srcMs = 0;
      this.srcLens = '';
      this.sbars = [];
      this.result = null;
      return;
    }
    const n = closedCount(this.bars, this.ms, this.now);
    const lens = `${st.internalLen}|${st.swingLen}`;
    const same = this.ms === this.srcMs && lens === this.srcLens && this.src.length === n && this.src.every((b, i) => b === this.bars[i]);
    if (same) return;
    this.src = this.bars.slice(0, n);
    this.srcMs = this.ms;
    this.srcLens = lens;
    this.sbars = this.src.map(toSBar);
    const params: SmcParams = { ...DEFAULT_SMC_PARAMS, internalLen: st.internalLen, swingLen: st.swingLen };
    this.result = n > 0 ? smcStructure(this.sbars, this.ms, params) : null;
  }

  /** Model wyższego interwału — tylko po zmianie interwału, okien pivota albo zamkniętych świec wyższego interwału. */
  private recomputeHigher(st: SmcStyle | null): void {
    this.pick = st ? pickHtf(this.ms, st.higher ?? 0) : null;
    const p = this.pick;
    // Świece innego interwału (parametr zmieniony przed kolejnym wczytaniem) nie wchodzą do modelu
    const got = p?.kind === 'on' && this.feed?.ms === p.ms ? this.feed.candles : undefined;
    if (!st || p?.kind !== 'on' || got === undefined || isHigherAbsent(got)) {
      this.mtf = null;
      this.mtfKey = '';
      return;
    }
    const bars = got;
    let n = 0;
    while (n < bars.length && bars[n].t + p.ms <= this.now) n++;
    const lastBar = bars[n - 1];
    const key = [p.ms, st.internalLen, st.swingLen, n, bars[0]?.t, lastBar ? [lastBar.t, lastBar.o, lastBar.h, lastBar.l, lastBar.c].join(',') : ''].join('|');
    if (key === this.mtfKey && this.mtf) return;
    this.mtfKey = key;
    this.mtf = smcMtf(bars.slice(0, n), p.ms, this.now, { ...DEFAULT_SMC_PARAMS, internalLen: st.internalLen, swingLen: st.swingLen });
  }

  /** Wybór na ostatniej zamkniętej świecy — tylko po zmianie wyników, telefonu albo trybu „historia”. */
  private reselect(): void {
    const st = this.styleOf();
    const history = st?.history === true;
    const mitigation: ObMitigation = st?.mitigation ?? 'close';
    const key = [this.result, this.mtf, this.phone, history, mitigation, st?.periods];
    if (key.every((v, i) => Object.is(v, this.selKey[i]))) return;
    this.selKey = key;
    const r = this.result;
    const last = this.sbars[this.sbars.length - 1];
    const asOf = last ? last.t + this.srcMs : 0;
    this.sel = r && last ? selectSmc(r, this.sbars, asOf, { phone: this.phone, history, mitigation }) : null;
    const reserved = prevPeriodsOf(st?.periods ?? 0, this.ms).length * 2;
    const cap = (this.phone ? SMC_PHONE_OBJECTS_MAX : SMC_OBJECTS_MAX) - reserved;
    if (this.sel) trimSmc(this.sel, cap);
    if (this.phone && this.mtf && this.sel) {
      const candidate = selectSmcMtf(this.mtf, asOf, this.sel.close, { phone: true, room: 1 });
      if (candidate.fvgs.length) trimSmc(this.sel, cap - 1);
    }
    this.flow = this.sel ? smcFlowOf(this.sel, this.src, this.srcMs) : null;
    const base = this.sel ? smcObjects(this.sel) : 0;
    // Wyższy interwał w tej samej chwili, w tym, co zostaje z łącznego limitu obiektów
    this.hsel = this.mtf && this.sel ? selectSmcMtf(this.mtf, asOf, this.sel.close, { phone: this.phone, room: cap - base }) : null;
    this.onObjects?.(base + (this.hsel ? smcMtfObjects(this.hsel) : 0));
  }

  updateAllViews(): void {
    this.scene = emptyScene();
    const st = this.styleOf();
    this.style = st;
    const lens = st ? `${st.internalLen}|${st.swingLen}` : '';
    if (st && lens !== this.srcLens) this.recompute(st);
    this.recomputeHigher(st);
    this.reselect();
    const sel = this.sel;
    const chart = this.chart;
    const series = this.series;
    const bars = this.bars;
    const ms = this.ms;
    if (!st || !sel || !chart || !series || bars.length === 0 || ms > SMC_MAX_TF) return;
    const ts = chart.timeScale();
    const xa = ts.logicalToCoordinate(0 as Logical);
    const xb = ts.logicalToCoordinate(1 as Logical);
    if (xa === null || xb === null || !(xb > xa)) return;
    const sp = xb - xa;
    const pane = chart.paneSize(0);
    const right = pane.width - this.rightInset;
    const sc = this.scene;
    // Linijka premium i discount zajmuje skraj przy osi; strefy i linie kończą się przed nią
    const zr = sel.pd ? right - RULER_W - RULER_GAP : right;
    sc.tagX = zr - 3;
    const x = (t: number) => Math.min(zr, xa + (logicalOfTime(bars, t, ms) - 0.5) * sp);
    const y = (p: number) => series.priceToCoordinate(p);
    const rect = (x0: number, x1: number, hi: number, lo: number): Rect | null => {
      if (x1 < 0 || x0 >= zr) return null;
      const ya = y(hi);
      const yb = y(lo);
      return ya === null || yb === null ? null : { x0, x1, y0: Math.min(ya, yb), y1: Math.max(ya, yb) };
    };
    const tag = (yy: number | null, text: string, ink: string, dim = false) => {
      if (yy !== null && yy >= 0 && yy <= pane.height) sc.tags.push({ y: yy, text, ink, dim });
    };
    const flow = this.flow;
    const hs = this.hsel;
    const label = hs?.label ?? '';
    // Strefa wykresu w strefie wyższego interwału (≥ 50% wspólnej wysokości): dopisek „+4H” zamiast osobnego podpisu
    const htfZones: { lo: number; hi: number }[] = hs ? [...hs.obs, ...hs.fvgs.map((v) => v.f)] : [];
    const claimed = new Set<number>();
    const inHtf = (z: { lo: number; hi: number }): string => {
      const k = htfZones.findIndex((h) => overlapShare(h, z) >= 0.5);
      if (k < 0) return '';
      claimed.add(k);
      return ` +${label}`;
    };

    // FVG połączona z OB (≥ 50% wspólnej wysokości, ten sam kierunek): jedna strefa OB z dopiskiem „+FVG”
    const merged = new Map<number, number>();
    for (const v of sel.fvgs) {
      if (v.ended) continue;
      const ob = sel.obs.find((w) => !w.ended && w.o.dir === v.f.dir && overlapShare(w.o, v.f) >= 0.5);
      if (ob) merged.set(v.f.id, ob.o.id);
    }
    const withFvg = new Set(merged.values());

    for (const v of sel.obs) {
      const o = v.o;
      // Strefa od świecy przełamania (od niej OB jest znany), obrys samej świecy OB jako znacznik
      const r = rect(x(o.breakT), v.endAt === null ? zr : x(v.endAt), o.hi, o.lo);
      if (!r) continue;
      const touched = v.state === 'touched';
      const swing = o.scale === 'swing';
      const fl = flow?.ob.get(o.id);
      const poc = fl?.poc ?? null;
      const yPoc = poc !== null && poc >= o.lo && poc <= o.hi ? y(poc) : null;
      sc.zones.push({
        ...r,
        ink: SMC_INK.ob,
        fill: v.ended ? 0 : touched ? 0.08 : swing ? 0.2 : 0.14,
        border: v.ended || touched ? 'dashed' : swing ? 'solid' : null,
        dim: v.ended,
        ghost: null,
        mid: yPoc === null ? null : { y: yPoc, dash: [] },
        mark: rect(x(o.t), x(o.t + ms), o.hi, o.lo),
      });
      const extra = `${fl?.absorption ? tr(' absorpcja', ' absorption') : ''}${withFvg.has(o.id) ? ' +FVG' : ''}${inHtf(o)}`;
      tag((r.y0 + r.y1) / 2, `OB${dirArrow(o.dir)}${extra}`, SMC_INK.ob, v.ended || touched);
    }
    for (const v of sel.fvgs) {
      const f = v.f;
      if (merged.has(f.id)) continue;
      // Rysujemy to, co z luki zostało: wypełnienie idzie od strony ceny
      const w = f.hi - f.lo;
      const left = v.ended ? { lo: f.lo, hi: f.hi } : f.dir === 1 ? { lo: f.lo, hi: f.hi - v.fill * w } : { lo: f.lo + v.fill * w, hi: f.hi };
      const x1 = v.endAt === null ? zr : x(v.endAt);
      const r = rect(x(f.t), x1, left.hi, left.lo);
      if (!r) continue;
      const ym = y(fvgMid(f));
      sc.zones.push({
        ...r,
        ink: SMC_INK.fvg,
        fill: v.ended ? 0 : 0.15,
        border: v.ended ? 'dashed' : null,
        dim: v.ended !== null,
        ghost: v.fill > 0.02 && !v.ended ? rect(x(f.t), x1, f.hi, f.lo) : null,
        // Środek luki (CE), dopóki cena go nie dotknęła
        mid: !v.ce && ym !== null ? { y: ym, dash: [2, 3] } : null,
        mark: null,
      });
      const thin = flow?.fvg.get(f.id)?.thin ? tr(' pusta', ' thin') : '';
      tag((r.y0 + r.y1) / 2, `FVG${dirArrow(f.dir)}${thin}${inHtf(f)}`, SMC_INK.fvg, v.ended !== null);
    }
    for (const v of sel.eqs) {
      const e = v.e;
      const ye = y(e.level);
      const x0 = x(e.t);
      const x1 = e.endAt === null ? zr : x(e.endAt);
      if (ye === null || x1 < 0 || x0 >= zr) continue;
      sc.lines.push({ x0, x1, y: ye, ink: SMC_INK.eq, alpha: v.ended ? 0.4 : 0.9, width: Math.max(1, st.width), dash: [1, 3], text: null, bold: false });
      for (const q of [e.a, e.b]) {
        const yq = y(q.price);
        if (yq !== null) sc.ticks.push({ x0: x(q.t), x1: x(q.t + ms), y: yq, ink: SMC_INK.eq });
      }
      tag(ye, e.dir === 1 ? 'EQH' : 'EQL', SMC_INK.eq, v.ended);
    }
    for (const b of sel.breaks) {
      const yb = y(b.level);
      // Od świecy, na której zamknięciu swing był znany, do świecy przełamania
      const x0 = x(b.swingKnown - ms);
      const x1 = x(b.t + ms);
      if (yb === null || x1 < 0 || x0 >= zr) continue;
      const swing = b.scale === 'swing';
      const ok = flow?.brk.get(b.id)?.accepted ? ' ✓' : '';
      sc.lines.push({
        x0,
        x1,
        y: yb,
        ink: SMC_INK.structure,
        alpha: swing ? 0.95 : 0.65,
        width: swing ? 2 : 1,
        dash: b.kind === 'CHoCH' ? [5, 3] : swing ? [] : [2, 3],
        text: `${b.kind}${ok}`,
        bold: b.kind === 'CHoCH',
      });
    }
    for (const s of sel.sweeps) {
      const ys = y(s.level);
      const x0 = x(s.t);
      const x1 = x(s.returnT + ms);
      if (ys === null || x1 < 0 || x0 >= zr) continue;
      sc.lines.push({ x0, x1, y: ys, ink: SMC_INK.eq, alpha: 0.95, width: 2, dash: [], text: 'sweep', bold: false, below: s.dir === -1 });
    }
    for (const s of sel.labels) {
      const yl = y(s.price);
      const xc = x(s.t) + sp / 2;
      if (yl === null || xc < 0 || xc >= zr) continue;
      sc.labels.push({ x: xc, y: yl, text: s.label ?? '', above: s.dir === 1, bold: s.scale === 'swing' });
    }
    const available = Math.max(0, (this.phone ? SMC_PHONE_OBJECTS_MAX : SMC_OBJECTS_MAX) - smcObjects(sel) - (hs ? smcMtfObjects(hs) : 0));
    let extra = 0;
    for (const period of prevPeriodsOf(st.periods ?? 0, ms)) {
      const level = prevHighLow(this.daily, period, sel.asOf);
      if ('why' in level || extra + 2 > available) continue;
      const names = PREV_NAMES[period];
      for (const [price, text] of [[level.hi, names[0]], [level.lo, names[1]]] as const) {
        const yp = y(price);
        if (yp === null) continue;
        sc.lines.push({ x0: x(level.to), x1: zr, y: yp, ink: PRO.ink2, alpha: 0.55, width: 1, dash: [6, 4], text: null, bold: false });
        tag(yp, text, PRO.ink2);
      }
      extra += 2;
    }
    this.onObjects?.(smcObjects(sel) + (hs ? smcMtfObjects(hs) : 0) + extra);
    // Zakres swingowy: linijka przy osi, szczyt i dołek z oceną (słaby — ten, który trend ma przełamać), linia równowagi
    if (sel.pd) {
      const pd = sel.pd;
      const yh = y(pd.hi);
      const yl = y(pd.lo);
      const ye1 = y(pd.eqHi);
      const ye0 = y(pd.eqLo);
      if (yh !== null && yl !== null && ye1 !== null && ye0 !== null) {
        const yc = y(sel.close);
        sc.ruler = {
          x: right - RULER_W - 1,
          segs: [
            { y0: yh, y1: ye1, ink: SMC_INK.premium, on: pd.zone === 'premium' },
            { y0: ye1, y1: ye0, ink: SMC_INK.structure, on: pd.zone === 'equilibrium' },
            { y0: ye0, y1: yl, ink: SMC_INK.discount, on: pd.zone === 'discount' },
          ],
          at: yc !== null && pd.pct >= 0 && pd.pct <= 1 ? yc : null,
        };
        const trend = sel.state.swing;
        const hiText = trend === 'up' ? tr('słaby szczyt', 'weak high') : trend === 'down' ? tr('mocny szczyt', 'strong high') : tr('szczyt zakresu', 'range high');
        const loText = trend === 'down' ? tr('słaby dołek', 'weak low') : trend === 'up' ? tr('mocny dołek', 'strong low') : tr('dołek zakresu', 'range low');
        sc.lines.push({ x0: x(pd.hiT), x1: zr, y: yh, ink: SMC_INK.premium, alpha: 0.6, width: 1, dash: [1, 2], text: null, bold: false });
        sc.lines.push({ x0: x(pd.loT), x1: zr, y: yl, ink: SMC_INK.discount, alpha: 0.6, width: 1, dash: [1, 2], text: null, bold: false });
        const yEq = y((pd.eqHi + pd.eqLo) / 2);
        if (yEq !== null) sc.lines.push({ x0: x(pd.known), x1: zr, y: yEq, ink: SMC_INK.structure, alpha: 0.45, width: 1, dash: [6, 4], text: null, bold: false });
        tag(yh, hiText, SMC_INK.premium);
        tag((yh + ye1) / 2, 'Premium', SMC_INK.premium, pd.zone !== 'premium');
        tag((ye0 + yl) / 2, 'Discount', SMC_INK.discount, pd.zone !== 'discount');
        tag(yl, loText, SMC_INK.discount);
      }
    }
    // Wyższy interwał: od zamknięcia świecy wyższego interwału, która element potwierdza (`known`), nigdy wcześniej;
    // obrys przerywany bez wypełnienia; podpis tylko, gdy żadna strefa wykresu go nie przejęła („+4H”)
    if (!hs) return;
    const hz = (lo: number, hi: number, known: number, ink: string, mid: number | null, text: string, k: number) => {
      const r = rect(x(known), zr, hi, lo);
      if (!r) return;
      sc.zones.push({ ...r, ink, fill: 0, border: 'dashed', dim: false, ghost: null, mid: mid === null ? null : { y: mid, dash: [2, 4] }, mark: null });
      if (!claimed.has(k)) tag((r.y0 + r.y1) / 2, text, ink);
    };
    hs.obs.forEach((z, k) => hz(z.lo, z.hi, z.known, SMC_INK.ob, null, `${label} OB${dirArrow(z.dir)}`, k));
    hs.fvgs.forEach((v, k) => hz(v.f.lo, v.f.hi, v.f.known, SMC_INK.fvg, v.ce ? null : y(fvgMid(v.f)), `${label} FVG${dirArrow(v.f.dir)}`, hs.obs.length + k));
    for (const b of hs.breaks) {
      const yb = y(b.level);
      const x0 = x(b.known);
      if (yb === null || x0 >= zr) continue;
      sc.lines.push({ x0, x1: zr, y: yb, ink: SMC_INK.structure, alpha: 0.6, width: Math.max(1, st.width - 1), dash: [6, 4], text: null, bold: false });
      tag(yb, `${label} ${b.kind}`, SMC_INK.structure);
    }
  }

  /** Wyższy interwał w legendzie: wybór interwału, elementy albo powód braku (null — wskaźnik ukryty). */
  higher(): SmcHigherView | null {
    const p = this.pick;
    if (!p) return null;
    const c = p.kind === 'on' && this.feed?.ms === p.ms ? this.feed.candles : undefined;
    return { pick: p, sel: this.hsel, why: c !== undefined && isHigherAbsent(c) ? c.why : null };
  }

  /** Opis w legendzie (z ostatniego wyboru); krzyż nad elementem dopisuje, od kiedy był znany. */
  legend(hover: { t: number; p: number } | null, fmt: (p: number) => string, coin: string): LegendPart[] {
    const src = this.src;
    const out = smcLegend(this.sel, this.ms, coin, hover, fmt, (idx) => candleTape(src, idx), this.higher(), this.flow);
    if (this.sel) out.push({ text: SMC_KEY(), color: PRO.ink3 });
    if (this.sel?.pd) out.push({ text: `· ${smcValueContext(this.sel.pd, this.valueOf?.(this.sel.asOf - 1) ?? null)}`, color: PRO.ink2 });
    if (this.sel) for (const period of prevPeriodsOf(this.styleOf()?.periods ?? 0, this.ms)) {
      const level = prevHighLow(this.daily, period, this.sel.asOf);
      const names = PREV_NAMES[period].join('/');
      out.push({ text: 'why' in level ? tr(`· ${names}: —, niepełna historia dzienna`, `· ${names}: —, incomplete daily history`) : `· ${names}: ${fmt(level.hi)} / ${fmt(level.lo)} LIVE`, color: PRO.ink2 });
    }
    return out;
  }

  /** Wybór na ostatniej zamkniętej świecy (legenda, testy). */
  selection(): SmcSelection | null {
    return this.sel;
  }

  valueOf: ((at: number) => ValueRef | null) | null = null;
}
