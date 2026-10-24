import type { IndicatorBar } from '../core/indicators';

/**
 * Rysunki na wykresie: narzędzia, punkty zakotwiczone w czasie (ms) i cenie (USD), geometria ekranu,
 * poziomy Fibonacciego, statystyki pomiaru i pozycji oraz zapis w przeglądarce. Czyste funkcje — bez płótna.
 * Punkt w czasie, nie w indeksie świecy, więc rysunek zostaje na swoim miejscu po zmianie interwału.
 */

export type ToolKind =
  | 'trend'
  | 'ray'
  | 'extended'
  | 'hline'
  | 'hray'
  | 'vline'
  | 'channel'
  | 'fib'
  | 'fibext'
  | 'rect'
  | 'arrow'
  | 'brush'
  | 'measure'
  | 'long'
  | 'short'
  | 'text'
  | 'note'
  | 'profile'
  | 'avwap';

export type ToolGroup = 'lines' | 'fib' | 'shapes' | 'measure' | 'text' | 'orderflow';

export interface ToolDef {
  kind: ToolKind;
  group: ToolGroup;
  label: string;
  /** Liczba punktów stawianych kliknięciem (pędzel: rysowany przeciągnięciem). */
  points: number;
  /** Skrót klawiszowy (z Alt), jak w TradingView. */
  hotkey?: string;
}

export const TOOLS: readonly ToolDef[] = [
  {
    kind: 'trend',
    group: 'lines',
    label: 'Linia trendu',
    points: 2,
    hotkey: 'T',
  },
  { kind: 'ray', group: 'lines', label: 'Promień', points: 2 },
  { kind: 'extended', group: 'lines', label: 'Linia rozszerzona', points: 2 },
  {
    kind: 'hline',
    group: 'lines',
    label: 'Linia pozioma',
    points: 1,
    hotkey: 'H',
  },
  {
    kind: 'hray',
    group: 'lines',
    label: 'Promień poziomy',
    points: 1,
    hotkey: 'J',
  },
  {
    kind: 'vline',
    group: 'lines',
    label: 'Linia pionowa',
    points: 1,
    hotkey: 'V',
  },
  { kind: 'channel', group: 'lines', label: 'Kanał równoległy', points: 3 },
  {
    kind: 'fib',
    group: 'fib',
    label: 'Zniesienie Fibonacciego',
    points: 2,
    hotkey: 'F',
  },
  {
    kind: 'fibext',
    group: 'fib',
    label: 'Rozszerzenie Fibonacciego od trendu',
    points: 3,
  },
  { kind: 'rect', group: 'shapes', label: 'Prostokąt', points: 2, hotkey: 'R' },
  { kind: 'arrow', group: 'shapes', label: 'Strzałka', points: 2 },
  { kind: 'brush', group: 'shapes', label: 'Pędzel', points: 0 },
  {
    kind: 'measure',
    group: 'measure',
    label: 'Pomiar: cena, czas, wolumen i delta',
    points: 2,
    hotkey: 'M',
  },
  { kind: 'long', group: 'measure', label: 'Pozycja długa (long)', points: 1 },
  {
    kind: 'short',
    group: 'measure',
    label: 'Pozycja krótka (short)',
    points: 1,
  },
  { kind: 'text', group: 'text', label: 'Tekst', points: 1 },
  { kind: 'note', group: 'text', label: 'Notatka przy cenie', points: 1 },
  {
    kind: 'profile',
    group: 'orderflow',
    label: 'Profil wolumenu zakresu',
    points: 2,
    hotkey: 'P',
  },
  {
    kind: 'avwap',
    group: 'orderflow',
    label: 'VWAP zakotwiczony',
    points: 1,
    hotkey: 'A',
  },
];

export const toolDef = (kind: ToolKind): ToolDef => TOOLS.find((t) => t.kind === kind)!;

export interface Pt {
  /** Czas (ms, zegar giełdy). */
  t: number;
  /** Cena (USD). */
  p: number;
}

export type Dash = 'solid' | 'dashed' | 'dotted';

export interface DrawStyle {
  color: string;
  width: number;
  dash: Dash;
}

export interface Drawing {
  id: string;
  kind: ToolKind;
  /** Pozycja: [wejście, cel, stop] — wejście i stop w czasie początku, cel w czasie końca. */
  pts: Pt[];
  style: DrawStyle;
  text?: string;
}

/** Kolory rysunków: jasne na ciemnym płótnie, pierwszy domyślny. */
export const DRAW_COLORS = ['#f2c94c', '#e4e6ea', '#2fd8c8', '#4cc38a', '#9085e9', '#e66aa8', '#f5620f', '#4a9eff'] as const;
export const DRAW_WIDTHS = [1, 2, 3, 4] as const;

export const defaultStyle = (kind: ToolKind): DrawStyle => ({
  color: kind === 'measure' || kind === 'profile' ? DRAW_COLORS[1] : kind === 'avwap' ? DRAW_COLORS[2] : DRAW_COLORS[0],
  width: kind === 'brush' ? 2 : 1,
  dash: 'solid',
});

// ───────────────────────── geometria ekranu ─────────────────────────

export interface XY {
  x: number;
  y: number;
}

/** Odległość punktu od odcinka AB (px). */
export function distToSegment(x: number, y: number, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const u = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
  return Math.hypot(x - (a.x + u * dx), y - (a.y + u * dy));
}

/** Punkt daleko za B na prostej AB (promień); płótno i tak przycina do panelu. */
export function farPoint(a: XY, b: XY, reach = 1e5): XY {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return b;
  return { x: b.x + (dx / len) * reach, y: b.y + (dy / len) * reach };
}

// ───────────────────────── oś czasu ─────────────────────────

/** Odwrotność `logicalOfTime`: chwila dla pozycji logicznej (przed danymi i za nimi co `ms`). */
export function timeOfLogical(bars: readonly { t: number }[], logical: number, ms: number): number {
  const n = bars.length;
  if (n === 0 || !Number.isFinite(logical)) return Number.NaN;
  if (logical <= 0) return bars[0].t + logical * ms;
  if (logical >= n - 1) return bars[n - 1].t + (logical - (n - 1)) * ms;
  const i = Math.floor(logical);
  return bars[i].t + (logical - i) * Math.min(ms, bars[i + 1].t - bars[i].t);
}

/** Indeks świecy, w której wypada chwila `t` (−1 przed danymi, n − 1 za nimi). */
export function barIndexAt(bars: readonly { t: number }[], t: number): number {
  let lo = 0;
  let hi = bars.length - 1;
  if (hi < 0 || t < bars[0].t) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bars[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Magnes: cena najbliższego z open, high, low, close świecy, jeśli leży bliżej niż `maxPx` na ekranie;
 * inaczej cena bez zmian.
 */
export function snapToOhlc(c: { o: number; h: number; l: number; c: number }, price: number, pxPerUsd: number, maxPx: number): number {
  let best = price;
  let bestPx = maxPx;
  for (const v of [c.o, c.h, c.l, c.c]) {
    const d = Math.abs(v - price) * pxPerUsd;
    if (d <= bestPx) {
      bestPx = d;
      best = v;
    }
  }
  return best;
}

// ───────────────────────── Fibonacci ─────────────────────────

export const FIB_RETRACE = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;
export const FIB_EXTENSION = [0, 0.618, 1, 1.272, 1.618, 2, 2.618] as const;

/** Zniesienie: poziom 0 na końcu ruchu (B), 1 na jego początku (A), jak w TradingView. */
export const fibRetrace = (a: number, b: number, level: number): number => b + (a - b) * level;

/** Rozszerzenie od trendu: ruch A→B odłożony od punktu C. */
export const fibExtension = (a: number, b: number, c: number, level: number): number => c + (b - a) * level;

// ───────────────────────── pomiar i pozycja ─────────────────────────

export interface MeasureStats {
  dp: number;
  pct: number;
  bars: number;
  ms: number;
  /** Wolumen świec w zakresie (BTC). */
  vol: number;
  /** Delta agresorów z taśmy (BTC); null, gdy żadna świeca zakresu nie ma footprintu. */
  delta: number | null;
  /** Część świec zakresu z footprintem (0..1). */
  tape: number;
}

/** Pomiar między punktami A i B: zmiana ceny, liczba świec i czas oraz wolumen i delta świec, których początek leży w zakresie. */
export function measureStats(bars: readonly IndicatorBar[], intervalMs: number, a: Pt, b: Pt): MeasureStats {
  const t0 = Math.min(a.t, b.t);
  const t1 = Math.max(a.t, b.t);
  let vol = 0;
  let delta = 0;
  let n = 0;
  let withFp = 0;
  const from = Math.max(0, barIndexAt(bars, t0));
  for (let i = from; i < bars.length && bars[i].t <= t1; i++) {
    if (bars[i].t < t0) continue;
    n++;
    vol += bars[i].candle.v;
    const fp = bars[i].fp;
    if (fp) {
      withFp++;
      delta += fp.delta;
    }
  }
  return {
    dp: b.p - a.p,
    pct: a.p !== 0 ? ((b.p - a.p) / a.p) * 100 : 0,
    bars: Math.round((t1 - t0) / intervalMs),
    ms: t1 - t0,
    vol,
    delta: withFp > 0 ? delta : null,
    tape: n > 0 ? withFp / n : 0,
  };
}

export interface PositionStats {
  reward: number;
  risk: number;
  /** Stosunek zysku do ryzyka; NaN przy zerowym ryzyku. */
  rr: number;
  rewardPct: number;
  riskPct: number;
}

export function positionStats(entry: number, target: number, stop: number): PositionStats {
  const reward = Math.abs(target - entry);
  const risk = Math.abs(entry - stop);
  return {
    reward,
    risk,
    rr: risk > 0 ? reward / risk : Number.NaN,
    rewardPct: entry !== 0 ? (reward / entry) * 100 : 0,
    riskPct: entry !== 0 ? (risk / entry) * 100 : 0,
  };
}

/** Czas trwania zwięźle: „45 s”, „12 min”, „3 h 05 min”, „2 d 4 h”. */
export function fmtDuration(ms: number): string {
  const s = Math.round(Math.abs(ms) / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${String(m % 60).padStart(2, '0')} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

// ───────────────────────── edycja ─────────────────────────

/** Nowa pozycja z jednego kliknięcia: stop o `risk` USD od wejścia, cel 2R dalej, szerokość `bars` świec. */
export function newPosition(kind: 'long' | 'short', entry: Pt, risk: number, ms: number, bars = 20): Pt[] {
  const dir = kind === 'long' ? 1 : -1;
  return [entry, { t: entry.t + bars * ms, p: entry.p + dir * 2 * risk }, { t: entry.t, p: entry.p - dir * risk }];
}

/** Przesunięcie całego rysunku o `dt` ms i `dp` USD. */
export function moveDrawing(pts: readonly Pt[], dt: number, dp: number): Pt[] {
  return pts.map((q) => ({ t: q.t + dt, p: q.p + dp }));
}

/**
 * Przeciągnięcie uchwytu `h` do punktu `q`. Prostokąt ma cztery narożniki (2 i 3 mieszają współrzędne punktów),
 * pozycja: 0 wejście (z czasem stopu), 1 cena celu, 2 cena stopu, 3 czas końca; linia pionowa zmienia tylko czas.
 */
export function dragHandle(kind: ToolKind, pts: readonly Pt[], h: number, q: Pt): Pt[] {
  const out = pts.map((x) => ({ ...x }));
  if (kind === 'rect' && h >= 2) {
    const [a, b] = h === 2 ? [0, 1] : [1, 0];
    out[a].t = q.t;
    out[b].p = q.p;
  } else if (kind === 'long' || kind === 'short') {
    if (h === 0) {
      out[0] = { ...q };
      out[2].t = q.t;
    } else if (h === 1 || h === 2) out[h].p = q.p;
    else out[1].t = q.t;
  } else if (kind === 'vline') out[0].t = q.t;
  else if (h >= 0 && h < out.length) out[h] = { ...q };
  return out;
}

// ───────────────────────── zapis ─────────────────────────

const KINDS = new Set<string>(TOOLS.map((t) => t.kind));
const DASHES = new Set<string>(['solid', 'dashed', 'dotted']);
/** Najwięcej rysunków i punktów pędzla w zapisie (ochrona pamięci przeglądarki). */
export const MAX_DRAWINGS = 500;
export const MAX_BRUSH_POINTS = 2000;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Rysunki z zapisu: tylko poprawne pozycje, reszta pominięta (stary albo uszkodzony zapis nie psuje wykresu). */
export function parseDrawings(raw: unknown): Drawing[] {
  if (!Array.isArray(raw)) return [];
  const out: Drawing[] = [];
  for (const r of raw.slice(0, MAX_DRAWINGS)) {
    if (!r || typeof r !== 'object') continue;
    const d = r as Record<string, unknown>;
    if (typeof d.id !== 'string' || typeof d.kind !== 'string' || !KINDS.has(d.kind) || !Array.isArray(d.pts)) continue;
    const pts = (d.pts as unknown[])
      .slice(0, MAX_BRUSH_POINTS)
      .filter((p): p is Pt => !!p && typeof p === 'object' && finite((p as Pt).t) && finite((p as Pt).p))
      .map((p) => ({ t: p.t, p: p.p }));
    const kind = d.kind as ToolKind;
    const need = kind === 'long' || kind === 'short' ? 3 : kind === 'brush' ? 2 : toolDef(kind).points;
    if (pts.length < need) continue;
    const st = (d.style ?? {}) as Record<string, unknown>;
    const def = defaultStyle(kind);
    out.push({
      id: d.id,
      kind,
      pts,
      style: {
        color: typeof st.color === 'string' && /^#[0-9a-f]{6}$/i.test(st.color) ? st.color : def.color,
        width: finite(st.width) ? Math.min(4, Math.max(1, Math.round(st.width))) : def.width,
        dash: typeof st.dash === 'string' && DASHES.has(st.dash) ? (st.dash as Dash) : def.dash,
      },
      ...(typeof d.text === 'string' ? { text: d.text.slice(0, 280) } : {}),
    });
  }
  return out;
}
