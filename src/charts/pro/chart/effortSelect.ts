import type { EffortResult, EffortZone, Side, VBar, ZoneKind } from '../core/effortZones';

/**
 * Co rysuje warstwa „Strefy absorpcji i pudełka Effort” w chwili `asOf` (ostatnia zamknięta świeca, w powtórce świeca
 * powtórki). Model stref (`effortZones`) liczy wszystko; tu tylko wybór, bez płótna i stanu, więc ten sam wynik służy
 * warstwie, legendzie i pomiarowi układu (`ui:check`).
 *
 * - Tylko strefy aktywne i uzbrojone w chwili `asOf`; strefy jednej strony, które się nakładają albo dzieli je mniej
 *   niż 0,25 ATR, to jedno pasmo (najwyżej 1,5 ATR wysokości), ze znacznikiem łączonym („A·D”).
 * - Na każdą stronę najwyżej 2 pasma najbliższe ostatniemu zamknięciu (telefon: 1); równa odległość — młodsze.
 * - Pasmo zaczyna się na świecy, na której zamknięciu strefa stała się znana (`createdAt`), kraniec swingu to znacznik.
 * - Przebita: sam obrys przez 6 świec od przebicia, najnowsza, tylko na komputerze, bez niej w miejscu strefy po zmianie roli.
 * - Pudełka: kolejne pudełka strony (najwyżej 3 świece odstępu) to jedna seria; rysowana ostatnia seria strony, gdy jej
 *   ostatnia świeca ma najwyżej 12 świec (telefon: nowsza z dwóch). Pudełko tylko na świecy z deltą z taśmy.
 * - Tryb „Historia”: wszystkie strefy znane w chwili `asOf` i wszystkie serie pudełek, samymi obrysami.
 *
 * Wybór zależy tylko od świec do `asOf`: ta sama chwila daje ten sam rysunek niezależnie od głębokości historii
 * i świec dopisanych później. Strefy nie broniły się częściej niż losowy poziom (52% wobec 52%, BTC 5m 2026), więc wybór
 * opiera się na bliskości i świeżości.
 */

/** Przebita strefa jako obrys przez tyle świec od przebicia. */
export const BROKEN_BARS = 6;
/** Pudełko starsze niż tyle świec nie jest rysowane; w prawo od serii krawędzie do tylu świec. */
export const BOX_RECENT = 12;
const MERGE_GAP_ATR = 0.25;
const MERGE_MAX_ATR = 1.5;
const SERIES_GAP = 3;
const MARK: Record<ZoneKind, string> = { absorption: 'A', discount: 'D', flip: 'F' };

export interface EffortBand {
  side: Side;
  lo: number;
  hi: number;
  /** Świeca powstania (najstarszej strefy pasma). */
  start: number;
  /** Świeca końca (przebita albo w trybie „Historia” zakończona); null — aktywna. */
  end: number | null;
  /** Znaczniki rodzajów stref pasma, np. „A·D”. */
  mark: string;
  kinds: ZoneKind[];
  /** Krańce swingów stref pasma: krótka kreska na cenie krańca i jego świecy. */
  extremes: { t: number; p: number }[];
}

export interface EffortBoxSeries {
  side: Side;
  from: number;
  last: number;
  lo: number;
  hi: number;
  /** Świece serii (wypełnienie tylko na nich). */
  cells: number[];
}

export interface EffortSelection {
  bands: EffortBand[];
  broken: EffortBand | null;
  boxes: EffortBoxSeries[];
  /** Pasma aktywne pominięte jako dalsze od ceny. */
  far: { demand: number; supply: number };
  /** Ile z ostatnich 12 zamkniętych świec ma deltę z taśmy. */
  tapeLast12: number;
  history: boolean;
}

export interface EffortSelectOptions {
  phone: boolean;
  history: boolean;
}

/** Liczba prostokątów do narysowania (pasma, przebita, serie pudełek). */
export const effortRects = (s: EffortSelection): number => s.bands.length + (s.broken ? 1 : 0) + s.boxes.length;

/** Indeks ostatniej świecy o czasie ≤ t (−1, gdy brak). */
function indexAt(bars: readonly VBar[], t: number): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

const extremeOf = (z: EffortZone) => ({ t: z.from, p: z.side === 1 ? z.lo : z.hi });

function bandOf(zs: readonly EffortZone[], end: number | null): EffortBand {
  const sorted = [...zs].sort((a, b) => a.lo - b.lo || a.id - b.id);
  const kinds = [...new Set(sorted.map((z) => z.kind))];
  return {
    side: sorted[0].side,
    lo: Math.min(...sorted.map((z) => z.lo)),
    hi: Math.max(...sorted.map((z) => z.hi)),
    start: Math.min(...sorted.map((z) => z.createdAt)),
    end,
    mark: kinds.map((k) => MARK[k]).join('·'),
    kinds,
    extremes: sorted.map(extremeOf),
  };
}

/** Pasma strony: łączenie stref nakładających się albo bliższych niż 0,25 ATR, o ile pasmo ma najwyżej 1,5 ATR. */
function merge(zs: readonly EffortZone[], atr: number): EffortBand[] {
  const sorted = [...zs].sort((a, b) => a.lo - b.lo || a.id - b.id);
  const groups: EffortZone[][] = [];
  let lo = 0;
  let hi = 0;
  for (const z of sorted) {
    const g = groups[groups.length - 1];
    if (g && atr > 0 && z.lo - hi < MERGE_GAP_ATR * atr && Math.max(hi, z.hi) - lo <= MERGE_MAX_ATR * atr) {
      g.push(z);
      hi = Math.max(hi, z.hi);
      continue;
    }
    groups.push([z]);
    lo = z.lo;
    hi = z.hi;
  }
  return groups.map((g) => bandOf(g, null));
}

const distance = (b: EffortBand, close: number) => (close >= b.lo && close <= b.hi ? 0 : Math.min(Math.abs(close - b.lo), Math.abs(close - b.hi)));

/** Serie pudełek z taśmą do chwili `asOf`, rosnąco po czasie, osobno dla stron. */
function boxSeries(r: EffortResult, bars: readonly VBar[], ms: number, asOf: number): EffortBoxSeries[] {
  const tape = new Set<number>();
  for (const b of bars) if (b.t <= asOf && b.delta !== null) tape.add(b.t);
  const out: EffortBoxSeries[] = [];
  const open = new Map<Side, EffortBoxSeries>();
  for (const b of [...r.boxes].sort((a, c) => a.t - c.t)) {
    if (b.t > asOf || !tape.has(b.t)) continue;
    const cur = open.get(b.side);
    if (cur && b.t - cur.last <= SERIES_GAP * ms) {
      cur.last = b.t;
      cur.lo = Math.min(cur.lo, b.lo);
      cur.hi = Math.max(cur.hi, b.hi);
      cur.cells.push(b.t);
      continue;
    }
    const s: EffortBoxSeries = { side: b.side, from: b.t, last: b.t, lo: b.lo, hi: b.hi, cells: [b.t] };
    out.push(s);
    open.set(b.side, s);
  }
  return out;
}

export function selectEffort(r: EffortResult, bars: readonly VBar[], ms: number, asOf: number, o: EffortSelectOptions): EffortSelection {
  const i = indexAt(bars, asOf);
  const empty: EffortSelection = { bands: [], broken: null, boxes: [], far: { demand: 0, supply: 0 }, tapeLast12: 0, history: o.history };
  if (i < 0) return empty;
  let tapeLast12 = 0;
  for (let k = Math.max(0, i - BOX_RECENT + 1); k <= i; k++) if (bars[k].delta !== null) tapeLast12++;
  const known = r.zones.filter((z) => z.createdAt <= asOf);
  const series = boxSeries(r, bars, ms, asOf);

  if (o.history) {
    return { ...empty, tapeLast12, bands: known.map((z) => bandOf([z], z.to !== null && z.to <= asOf ? z.to : null)), boxes: series };
  }

  const close = bars[i].c;
  const atr = r.series.atr[i];
  const active = known.filter((z) => z.armedAt !== null && z.armedAt <= asOf && (z.to === null || z.to > asOf));
  const k = o.phone ? 1 : 2;
  const bands: EffortBand[] = [];
  const far = { demand: 0, supply: 0 };
  for (const side of [1, -1] as const) {
    const list = merge(
      active.filter((z) => z.side === side),
      Number.isFinite(atr) ? atr : 0
    ).sort((a, b) => distance(a, close) - distance(b, close) || b.start - a.start);
    bands.push(...list.slice(0, k));
    if (side === 1) far.demand = Math.max(0, list.length - k);
    else far.supply = Math.max(0, list.length - k);
  }

  let broken: EffortBand | null = null;
  if (!o.phone) {
    const recent = known
      .filter((z) => z.end === 'broken' && z.to !== null && z.to <= asOf && asOf - z.to < BROKEN_BARS * ms)
      .sort((a, b) => (b.to as number) - (a.to as number) || b.id - a.id)[0];
    const flipHere = recent && bands.some((b) => b.kinds.includes('flip') && b.lo < recent.hi && b.hi > recent.lo);
    if (recent && !flipHere) broken = bandOf([recent], recent.to);
  }

  const recentBoxes = ([1, -1] as const)
    .map((side) => series.filter((s) => s.side === side).pop())
    .filter((s): s is EffortBoxSeries => !!s && asOf - s.last <= BOX_RECENT * ms);
  const boxes = o.phone && recentBoxes.length > 1 ? [recentBoxes.reduce((a, b) => (b.last > a.last ? b : a))] : recentBoxes;

  return { bands, broken, boxes, far, tapeLast12, history: false };
}
