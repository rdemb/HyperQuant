import { type TradeSession, tradeSessionOn } from '../../../utils/sessionDay';
import { utcDayStart } from './sessions';

/**
 * Strefy absorpcji i dyskonta swingu oraz pudełka Effort z modelu intraday Fabio Valentiniego (film
 * https://youtu.be/HUYBdYnXUNc), odtworzone przez HyperQuant na świecach: jego wskaźnik „Nasdaq Effort” (Deepcharts) ma
 * zamknięty kod, więc reguły i progi są nasze. Opis rynku, nie sygnały.
 *
 * - **Strefa absorpcji:** dołek albo szczyt swingu (pivot) z dużym wolumenem albo deltą przeciwną do odrzucenia, od
 *   krańca do korpusu świecy, wysokość od 0,15 do 1 ATR.
 * - **Strefa dyskonta swingu:** po swingu co najmniej 2 ATR od jego krańca do VAL (swing wzrostowy) albo VAH (spadkowy)
 *   profilu wolumenu swingu.
 * - **Flip:** strefa przebita zamknięciem z agresją po złej stronie VWAP sesji zmienia rolę w tym samym miejscu.
 * - Strefa jest **uzbrojona**, gdy cena odeszła od niej o 1 ATR, i żyje 12 h albo do zamknięcia za nią.
 * - **Pudełko Effort:** świeca kierunkowa z agresją (delta z taśmy albo przybliżenie ze świecy), wybiciem szczytów
 *   (dołków) poprzednich świec i zamknięciem po właściwej stronie VWAP sesji.
 *
 * Wszystko liczy się tylko na zamkniętych świecach, kolejno: wynik dla świecy zależy tylko od świec do niej, więc
 * wykres nie przerysowuje historii.
 */

export type Side = 1 | -1;

export interface VBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  /** Delta z taśmy (kupno − sprzedaż agresywna); null, gdy świeca nie jest w całości nagrana. */
  delta: number | null;
}

export interface EffortParams {
  /** Okno pivota (świece po obu stronach); strefa powstaje dopiero po tylu świecach za krańcem. */
  pivotLen: number;
  /** Średnie wolumenu i |delty|. */
  smaLen: number;
  atrLen: number;
  /** Absorpcja: wolumen > mnożnik × średnia albo delta przeciwna > mnożnik × średnia |delty|. */
  absVolMult: number;
  absDeltaMult: number;
  /** Wysokość strefy: od … do … ATR. */
  zoneMinAtr: number;
  zoneMaxAtr: number;
  /** Strefa dyskonta: swing co najmniej tyle ATR, value area profilu swingu (udział wolumenu), liczba przedziałów profilu. */
  swingMinAtr: number;
  valueArea: number;
  profileBins: number;
  /** Strefa jest uzbrojona, gdy cena odeszła od niej o tyle ATR. */
  departAtr: number;
  /** Strefa wygasa po tym czasie od powstania. */
  zoneMaxAgeMs: number;
  /** Przebita z agresją strefa zmienia rolę. */
  flipZones: boolean;
  /** Pudełko Effort: delta > mnożnik × średnia |delty|; bez taśmy: zamknięcie w górnych/dolnych X zakresu i wolumen > mnożnik. */
  effortDeltaMult: number;
  effortVolMult: number;
  effortClv: number;
  /** Ścieżka najmniejszego oporu: szczyt (dołek) świecy wybija szczyty (dołki) tylu poprzednich świec. */
  effortBreakout: number;
  /** Pudełko rysuje się w prawo przez tyle świec. */
  boxExtend: number;
}

export const DEFAULT_EFFORT_PARAMS: EffortParams = {
  pivotLen: 5,
  smaLen: 20,
  atrLen: 14,
  absVolMult: 1.5,
  absDeltaMult: 1.5,
  zoneMinAtr: 0.15,
  zoneMaxAtr: 1,
  swingMinAtr: 2,
  valueArea: 0.7,
  profileBins: 24,
  departAtr: 1,
  zoneMaxAgeMs: 12 * 3_600_000,
  flipZones: true,
  effortDeltaMult: 1.2,
  effortVolMult: 1.2,
  effortClv: 0.7,
  effortBreakout: 3,
  boxExtend: 12,
};

export type ZoneKind = 'absorption' | 'discount' | 'flip';

export interface EffortZone {
  id: number;
  /** 1 — strefa popytu (pod ceną), −1 — podaży (nad ceną). */
  side: Side;
  kind: ZoneKind;
  /** Początek prostokąta (świeca krańca swingu albo przebicia). */
  from: number;
  /** Świeca, na której zamknięciu strefa powstała (bez wglądu w przyszłość). */
  createdAt: number;
  lo: number;
  hi: number;
  /** Świeca końca (przebicie albo wygaśnięcie); null — strefa aktywna. */
  to: number | null;
  end: 'broken' | 'expired' | null;
  /**
   * Świeca, na której zamknięciu strefa się uzbroiła (cena odeszła od niej o `departAtr` ATR); przy uzbrojeniu w chwili
   * powstania to `createdAt`. null — nieuzbrojona.
   */
  armedAt: number | null;
}

export interface EffortBox {
  side: Side;
  t: number;
  lo: number;
  hi: number;
  /** Drugie pudełko tej samej strony tuż po poprzednim (nałożone pudełka kontroli). */
  stacked: boolean;
}

/** Serie pośrednie dla każdej świecy: delta (z taśmy albo przybliżona), średnie wolumenu i |delty| oraz ATR Wildera. */
export interface EffortSeries {
  delta: Float64Array;
  smaV: Float64Array;
  smaD: Float64Array;
  atr: Float64Array;
}

export interface EffortResult {
  zones: EffortZone[];
  boxes: EffortBox[];
  /** VWAP sesji (Londyn, NY; w godzinach azjatyckich doby UTC) dla każdej świecy. */
  vwap: Float64Array;
  /** Udział świec z deltą przybliżoną ze świecy (bez pełnej taśmy). */
  proxyShare: number;
  series: EffortSeries;
}

/** Delta świecy: z taśmy albo przybliżenie (położenie zamknięcia w zakresie × wolumen). */
export function deltaOf(b: VBar): number {
  if (b.delta !== null && Number.isFinite(b.delta)) return b.delta;
  const range = b.h - b.l;
  if (!(range > 0)) return 0;
  return b.v * ((2 * (b.c - b.l)) / range - 1);
}

/** Sesja Londynu albo NY dla chwili `t`; w godzinach azjatyckich null (pamięć podręczna doby). */
function sessionFinder(): (t: number) => TradeSession | null {
  let day = Number.NaN;
  let both: TradeSession[] = [];
  return (t) => {
    const d = utcDayStart(t);
    if (d !== day) {
      day = d;
      both = [tradeSessionOn(d, 'london'), tradeSessionOn(d, 'ny')];
    }
    return both.find((s) => t >= s.start && t < s.end) ?? null;
  };
}

/** Średnia krocząca (z bieżącą wartością); NaN, dopóki nie ma `n` wartości. */
function sma(xs: Float64Array, n: number): Float64Array {
  const out = new Float64Array(xs.length).fill(Number.NaN);
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += xs[i];
    if (i >= n) sum -= xs[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** ATR Wildera; NaN, dopóki nie ma `n` świec. */
function atrOf(bars: readonly VBar[], n: number): Float64Array {
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
 * Value area profilu wolumenu świec `bars[a..b]` (wolumen świecy rozłożony równo na jej zakres): [VAL, VAH] obejmujące
 * udział `share` wolumenu wokół POC.
 */
export function valueArea(bars: readonly VBar[], a: number, b: number, bins: number, share: number): { val: number; vah: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = a; i <= b; i++) {
    lo = Math.min(lo, bars[i].l);
    hi = Math.max(hi, bars[i].h);
  }
  if (!(hi > lo)) return null;
  const step = (hi - lo) / bins;
  const vol = new Float64Array(bins);
  for (let i = a; i <= b; i++) {
    const x = bars[i];
    // Przedziały [dół, góra): szczyt dokładnie na granicy nie wpada do przedziału wyżej
    const i0 = Math.min(bins - 1, Math.floor((x.l - lo) / step));
    const i1 = Math.min(bins - 1, Math.max(i0, Math.ceil((x.h - lo) / step) - 1));
    const per = x.v / (i1 - i0 + 1);
    for (let k = i0; k <= i1; k++) vol[k] += per;
  }
  const total = vol.reduce((s, v) => s + v, 0);
  if (!(total > 0)) return null;
  let poc = 0;
  for (let k = 1; k < bins; k++) if (vol[k] > vol[poc]) poc = k;
  let lo2 = poc;
  let hi2 = poc;
  let acc = vol[poc];
  while (acc < share * total && (lo2 > 0 || hi2 < bins - 1)) {
    const down = lo2 > 0 ? vol[lo2 - 1] : -1;
    const up = hi2 < bins - 1 ? vol[hi2 + 1] : -1;
    if (up >= down) acc += vol[++hi2];
    else acc += vol[--lo2];
  }
  return { val: lo + lo2 * step, vah: lo + (hi2 + 1) * step };
}

/** Silna strona na świecy k: duży wolumen albo delta strony `dir` (1 kupno, −1 sprzedaż) ponad średnią |delty|. */
function strong(bars: readonly VBar[], s: EffortSeries, k: number, dir: Side, p: EffortParams): boolean {
  const big = bars[k].v > p.absVolMult * s.smaV[k];
  return dir === 1 ? big || s.delta[k] > p.absDeltaMult * s.smaD[k] : big || s.delta[k] < -p.absDeltaMult * s.smaD[k];
}

/**
 * Agresja strony na świecy i: delta z taśmy ponad `effortDeltaMult` × średnia |delty|; bez taśmy zamknięcie przy krańcu
 * (`effortClv` zakresu) i wolumen ponad `effortVolMult` × średnia.
 */
export function aggressionAt(bars: readonly VBar[], s: EffortSeries, i: number, side: Side, p: EffortParams): boolean {
  const b = bars[i];
  const range = b.h - b.l;
  if (!(range > 0) || !(s.smaV[i] > 0)) return false;
  if (b.delta !== null) return side * s.delta[i] > 0 && side * s.delta[i] > p.effortDeltaMult * s.smaD[i];
  const clv = (b.c - b.l) / range;
  return (side === 1 ? clv > p.effortClv : clv < 1 - p.effortClv) && b.v > p.effortVolMult * s.smaV[i];
}

/**
 * Absorpcja na świecy k, z następną świecą tylko do `upto`: dla side 1 absorpcja podaży (kupujący przyjęli sprzedaż:
 * duży wolumen albo ujemna delta i zamknięcie w górnej połowie albo następna świeca wzrostowa zamyka się nad szczytem),
 * dla −1 lustrzanie absorpcja popytu.
 */
export function absorbsAt(bars: readonly VBar[], s: EffortSeries, k: number, upto: number, side: Side, p: EffortParams): boolean {
  const b = bars[k];
  if (!strong(bars, s, k, side === 1 ? -1 : 1, p)) return false;
  const nx = k + 1 <= upto ? bars[k + 1] : null;
  if (side === 1) {
    if (b.c - b.l >= 0.5 * (b.h - b.l)) return true;
    return nx !== null && nx.c > nx.o && nx.c >= b.h;
  }
  if (b.h - b.c >= 0.5 * (b.h - b.l)) return true;
  return nx !== null && nx.c < nx.o && nx.c <= b.l;
}

/**
 * Strefy i pudełka na zamkniętych świecach `bars` (rosnąco po czasie, interwał `ms`). Wynik dla świecy i zależy tylko od
 * świec 0..i. Kolejno na każdej świecy: VWAP sesji, pudełko Effort, przebicie i wygaśnięcie stref, nowe strefy z pivota
 * potwierdzonego na tej świecy, uzbrojenie.
 */
export function effortZones(bars: readonly VBar[], ms: number, params: EffortParams = DEFAULT_EFFORT_PARAMS): EffortResult {
  const p = params;
  const n = bars.length;
  const delta = new Float64Array(n);
  const absD = new Float64Array(n);
  const vol = new Float64Array(n);
  let proxy = 0;
  for (let i = 0; i < n; i++) {
    delta[i] = deltaOf(bars[i]);
    absD[i] = Math.abs(delta[i]);
    vol[i] = bars[i].v;
    if (bars[i].delta === null) proxy++;
  }
  const series: EffortSeries = { delta, smaV: sma(vol, p.smaLen), smaD: sma(absD, p.smaLen), atr: atrOf(bars, p.atrLen) };
  const atr = series.atr;
  const vwap = new Float64Array(n).fill(Number.NaN);
  const sessionAt = sessionFinder();

  const zones: EffortZone[] = [];
  /** Strefy aktywne (bez końca) w kolejności powstania: pętle po świecach nie przechodzą po zakończonych. */
  let active: EffortZone[] = [];
  const boxes: EffortBox[] = [];
  let nextId = 1;
  let anchor = Number.NaN;
  let pv = 0;
  let vv = 0;
  let lastPivotLow = -1;
  let lastPivotHigh = -1;

  const clampZone = (side: Side, edge: number, inner: number, a: number) => {
    const min = p.zoneMinAtr * a;
    const max = p.zoneMaxAtr * a;
    const h = Math.min(max, Math.max(min, Math.abs(inner - edge)));
    return side === 1 ? { lo: edge, hi: edge + h } : { lo: edge - h, hi: edge };
  };
  /** Uzbrojenie po odejściu ceny na świecach a..b; czas uzbrojenia to świeca b, na której zamknięciu to widać. */
  const updateArmed = (z: EffortZone, a: number, b: number) => {
    for (let k = a; k <= b && z.armedAt === null; k++) {
      const atrK = atr[k];
      if (!(atrK > 0)) continue;
      if (z.side === 1 ? bars[k].h >= z.hi + p.departAtr * atrK : bars[k].l <= z.lo - p.departAtr * atrK) z.armedAt = bars[b].t;
    }
  };
  const addZone = (z: Omit<EffortZone, 'id' | 'to' | 'end' | 'armedAt'>, armedFrom: number, upto: number) => {
    // Ta sama strefa albo nakładająca się w ponad połowie (niższej z dwóch) na aktywną strefę tej strony: zostaje pierwsza
    const overlaps = (o: EffortZone) => {
      const inter = Math.min(o.hi, z.hi) - Math.max(o.lo, z.lo);
      return inter > 0.5 * Math.min(o.hi - o.lo, z.hi - z.lo);
    };
    if (active.some((o) => o.side === z.side && (o.from === z.from || overlaps(o)))) return;
    // Już przebita między krańcem a powstaniem: nie ma czego bronić
    for (let k = armedFrom; k <= upto; k++) if (z.side === 1 ? bars[k].c < z.lo : bars[k].c > z.hi) return;
    const zone: EffortZone = { ...z, id: nextId++, to: null, end: null, armedAt: null };
    updateArmed(zone, armedFrom, upto);
    zones.push(zone);
    active.push(zone);
  };

  /** Pudełko Effort (kontroli) na zamknięciu świecy i: agresja, świeca kierunkowa, wybicie ścieżki, strona VWAP. */
  const effortAt = (i: number): EffortBox | null => {
    const b = bars[i];
    if (i < p.effortBreakout || !Number.isFinite(vwap[i])) return null;
    let prevHi = -Infinity;
    let prevLo = Infinity;
    for (let k = i - p.effortBreakout; k < i; k++) {
      prevHi = Math.max(prevHi, bars[k].h);
      prevLo = Math.min(prevLo, bars[k].l);
    }
    const mid = (b.o + b.c) / 2;
    const last = boxes.length > 0 ? boxes[boxes.length - 1] : null;
    if (aggressionAt(bars, series, i, 1, p) && b.c > b.o && b.h > prevHi && b.c > vwap[i]) {
      return { side: 1, t: b.t, lo: b.l, hi: mid, stacked: last !== null && last.side === 1 && b.t - last.t <= 3 * ms };
    }
    if (aggressionAt(bars, series, i, -1, p) && b.c < b.o && b.l < prevLo && b.c < vwap[i]) {
      return { side: -1, t: b.t, lo: mid, hi: b.h, stacked: last !== null && last.side === -1 && b.t - last.t <= 3 * ms };
    }
    return null;
  };

  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const sess = sessionAt(b.t);
    // 1. VWAP sesji (w Azji VWAP doby UTC)
    const anc = sess ? sess.start : utcDayStart(b.t);
    if (anc !== anchor) {
      anchor = anc;
      pv = 0;
      vv = 0;
    }
    pv += ((b.h + b.l + b.c) / 3) * b.v;
    vv += b.v;
    vwap[i] = vv > 0 ? pv / vv : b.c;

    // 2. Pudełko Effort tej świecy
    const box = effortAt(i);
    if (box) boxes.push(box);

    // 3. Strefy: przebicie (z ewentualną zmianą roli) i wygaśnięcie na zamknięciu tej świecy
    const flips: EffortZone[] = [];
    let ended = false;
    for (const z of active) {
      if (b.t - z.createdAt > p.zoneMaxAgeMs) {
        z.to = b.t;
        z.end = 'expired';
        ended = true;
        continue;
      }
      const broken = z.side === 1 ? b.c < z.lo : b.c > z.hi;
      if (!broken) continue;
      z.to = b.t;
      z.end = 'broken';
      ended = true;
      const aggr = z.side === 1 ? strong(bars, series, i, -1, p) && b.c < vwap[i] : strong(bars, series, i, 1, p) && b.c > vwap[i];
      if (p.flipZones && aggr) {
        flips.push({ id: nextId++, side: (-z.side) as Side, kind: 'flip', from: b.t, createdAt: b.t, lo: z.lo, hi: z.hi, to: null, end: null, armedAt: null });
      }
    }
    if (ended) active = active.filter((z) => z.to === null);
    zones.push(...flips);
    active.push(...flips);

    // 4. Pivoty potwierdzone na tej świecy: nowe strefy absorpcji i dyskonta swingu
    const j = i - p.pivotLen;
    if (j >= p.pivotLen && atr[j] > 0) {
      let isLow = true;
      let isHigh = true;
      for (let k = j - p.pivotLen; k <= i; k++) {
        if (k === j) continue;
        if (k < j ? bars[k].l <= bars[j].l : bars[k].l < bars[j].l) isLow = false;
        if (k < j ? bars[k].h >= bars[j].h : bars[k].h > bars[j].h) isHigh = false;
      }
      if (isLow) {
        for (const k of [j, j - 1, j + 1]) {
          if (absorbsAt(bars, series, k, i, 1, p)) {
            const zz = clampZone(1, bars[j].l, Math.max(bars[k].o, bars[k].c), atr[j]);
            addZone({ side: 1, kind: 'absorption', from: bars[Math.min(j, k)].t, createdAt: b.t, ...zz }, j, i);
            break;
          }
        }
        // Swing spadkowy od ostatniego szczytu do tego dołka: strefa dyskonta sprzedających od VAH do szczytu
        if (lastPivotHigh >= 0 && lastPivotHigh < j && bars[lastPivotHigh].h - bars[j].l >= p.swingMinAtr * atr[j]) {
          const va = valueArea(bars, lastPivotHigh, j, p.profileBins, p.valueArea);
          if (va) {
            const a = lastPivotHigh;
            const zz = clampZone(-1, bars[a].h, va.vah, atr[a] > 0 ? atr[a] : atr[j]);
            addZone({ side: -1, kind: 'discount', from: bars[a].t, createdAt: b.t, ...zz }, a, i);
          }
        }
        lastPivotLow = j;
      }
      if (isHigh) {
        for (const k of [j, j - 1, j + 1]) {
          if (absorbsAt(bars, series, k, i, -1, p)) {
            const zz = clampZone(-1, bars[j].h, Math.min(bars[k].o, bars[k].c), atr[j]);
            addZone({ side: -1, kind: 'absorption', from: bars[Math.min(j, k)].t, createdAt: b.t, ...zz }, j, i);
            break;
          }
        }
        // Swing wzrostowy od ostatniego dołka do tego szczytu: strefa dyskonta kupujących od dołka do VAL
        if (lastPivotLow >= 0 && lastPivotLow < j && bars[j].h - bars[lastPivotLow].l >= p.swingMinAtr * atr[j]) {
          const va = valueArea(bars, lastPivotLow, j, p.profileBins, p.valueArea);
          if (va) {
            const a = lastPivotLow;
            const zz = clampZone(1, bars[a].l, va.val, atr[a] > 0 ? atr[a] : atr[j]);
            addZone({ side: 1, kind: 'discount', from: bars[a].t, createdAt: b.t, ...zz }, a, i);
          }
        }
        lastPivotHigh = j;
      }
    }

    // 5. Uzbrojenie stref z tą świecą
    for (const z of active) if (z.armedAt === null && z.createdAt <= b.t) updateArmed(z, i, i);
  }

  return { zones, boxes, vwap, proxyShare: n > 0 ? proxy / n : 0, series };
}
