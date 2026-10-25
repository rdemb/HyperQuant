import type {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  Logical,
  PrimitiveHoveredItem,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import { fmtVol } from '../../orderflow/footprint';
import { fmtSignedVol } from '../../orderflow/renderer';
import { fmtPct, fmtSigned, numLang } from '../../../ui/format';
import { hlTick } from '../core/footprintBar';
import { volumeProfile, vwapSeries } from '../core/indicators';
import type { VolumeProfile, VwapPoint } from '../core/indicators';
import type { ProBar } from '../store/proStore';
import { autoRowStep, fmtPx, priceDigits } from '../chart/layout';
import { logicalOfTime } from '../chart/overlay';
import { MONO, PRO, crosshairTimeFormatter, luminance, rgba } from '../chart/theme';
import {
  Drawing,
  DrawStyle,
  FIB_EXTENSION,
  FIB_RETRACE,
  Pt,
  XY,
  barIndexAt,
  distToSegment,
  farPoint,
  fibExtension,
  fibRetrace,
  fmtDuration,
  measureStats,
  positionStats,
  timeOfLogical,
} from './model';
import { tr } from '../../../i18n';

/**
 * Warstwa rysunków nad wykresem (prymityw głównej serii, dołączany ostatni, więc rysuje nad wszystkim):
 * geometria każdego rysunku w pikselach ekranu, jego malowanie, uchwyty zaznaczonego rysunku, etykiety
 * cen i czasu na osiach oraz trafienie kursorem. Stan (lista rysunków, zaznaczenie, podgląd) ustawia obsługa myszy.
 */

export interface LayerState {
  drawings: readonly Drawing[];
  /** Rysunek w trakcie stawiania (ostatni punkt idzie za kursorem). */
  pending: Drawing | null;
  selectedId: string | null;
  hidden: boolean;
}

export interface Hit {
  id: string;
  /** Indeks uchwytu albo −1 (cały rysunek). */
  handle: number;
}

interface Item {
  id: string;
  /** Łamane do trafienia (pary x, y). */
  lines: number[][];
  /** Obszary do trafienia: x, y, w, h. */
  boxes: number[][];
  handles: XY[];
  paint: (c: CanvasRenderingContext2D) => void;
}

interface View {
  W: number;
  H: number;
  sp: number;
  X: (t: number) => number;
  Y: (p: number) => number;
}

interface AxisMark {
  at: number;
  text: string;
  color: string;
}

const HIT_PX = 6;
const HANDLE_R = 4.5;
const LABEL_FONT = `11px ${MONO}`;
const LABEL_H = 16;
const TEXT_FAMILY = '"Plus Jakarta Sans", system-ui, sans-serif';
const DASH: Record<DrawStyle['dash'], number[]> = {
  solid: [],
  dashed: [6, 4],
  dotted: [1.5, 3],
};
/** Poziomy Fibonacciego: od szarego 0 przez ciepłe do chłodnych i szarego 1. */
const FIB_COLORS = ['#8a8f98', '#ff4d5e', '#f5a524', '#2fd8c8', '#4cc38a', '#4a9eff', '#8a8f98'];
const PROFIT = PRO.buyInk;
const LOSS = PRO.sellInk;
const MEASURE_UP = '#4a9eff';
const MEASURE_DOWN = '#ff4d5e';
/** Profil zakresu: najdłuższy wiersz jako ułamek szerokości zakresu, minimalna wysokość wiersza (px). */
const RANGE_PROFILE_FRAC = 0.6;
const RANGE_PROFILE_ROW_PX = 4;


const inkOn = (bg: string) => (luminance(bg) > 0.4 ? '#0b0b12' : '#ffffff');

class AxisLabel implements ISeriesPrimitiveAxisView {
  at = 0;
  label = '';
  bg = '#000';
  coordinate(): number {
    return this.at;
  }
  text(): string {
    return this.label;
  }
  textColor(): string {
    return inkOn(this.bg);
  }
  backColor(): string {
    return this.bg;
  }
  visible(): boolean {
    return true;
  }
}

// ───────────────────────── malowanie ─────────────────────────

function trace(c: CanvasRenderingContext2D, xy: readonly number[], close = false): void {
  c.beginPath();
  c.moveTo(xy[0], xy[1]);
  for (let i = 2; i < xy.length; i += 2) c.lineTo(xy[i], xy[i + 1]);
  if (close) c.closePath();
}

function stroke(c: CanvasRenderingContext2D, xy: readonly number[], color: string, width: number, dash: readonly number[] = []): void {
  c.strokeStyle = color;
  c.lineWidth = width;
  c.setLineDash(dash as number[]);
  trace(c, xy);
  c.stroke();
}

function fill(c: CanvasRenderingContext2D, xy: readonly number[], color: string): void {
  c.fillStyle = color;
  trace(c, xy, true);
  c.fill();
}

const rectXY = (x: number, y: number, w: number, h: number) => [x, y, x + w, y, x + w, y + h, x, y + h];

function arrowHead(c: CanvasRenderingContext2D, a: XY, b: XY, color: string, size: number): void {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(b.x, b.y);
  c.lineTo(b.x - size * Math.cos(ang - 0.45), b.y - size * Math.sin(ang - 0.45));
  c.lineTo(b.x - size * Math.cos(ang + 0.45), b.y - size * Math.sin(ang + 0.45));
  c.closePath();
  c.fill();
}

/** Ramka z wierszami tekstu wyśrodkowana na `cx`; `y` to górna krawędź. */
function textBox(c: CanvasRenderingContext2D, rows: readonly { text: string; color: string }[], cx: number, y: number, bg: string, border?: string): void {
  c.font = LABEL_FONT;
  const w = Math.max(...rows.map((r) => c.measureText(r.text).width)) + 12;
  const h = rows.length * 15 + 6;
  const x = Math.round(cx - w / 2);
  c.fillStyle = bg;
  c.beginPath();
  c.roundRect(x, Math.round(y), w, h, 3);
  c.fill();
  if (border) {
    c.strokeStyle = border;
    c.lineWidth = 1;
    c.setLineDash([]);
    c.stroke();
  }
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  rows.forEach((r, i) => {
    c.fillStyle = r.color;
    c.fillText(r.text, cx, y + 3 + 15 * i + 7.5);
  });
}

const boxHeight = (rows: number) => rows * 15 + 6;

/** Napis na tle (etykieta poziomu). */
function tag(c: CanvasRenderingContext2D, text: string, x: number, y: number, align: CanvasTextAlign, color: string): void {
  c.font = LABEL_FONT;
  const w = c.measureText(text).width + 8;
  const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  c.fillStyle = rgba(PRO.bg, 0.85);
  c.fillRect(Math.round(x0), Math.round(y - LABEL_H / 2), w, LABEL_H);
  c.fillStyle = color;
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  c.fillText(text, x0 + 4, y + 0.5);
}

function handleDot(c: CanvasRenderingContext2D, h: XY, color: string): void {
  c.setLineDash([]);
  c.beginPath();
  c.arc(h.x, h.y, HANDLE_R, 0, Math.PI * 2);
  c.fillStyle = PRO.bg;
  c.fill();
  c.lineWidth = 1.5;
  c.strokeStyle = color;
  c.stroke();
}

// ───────────────────────── warstwa ─────────────────────────

interface ProfileCache {
  bars: readonly ProBar[];
  from: number;
  to: number;
  step: number;
  profile: VolumeProfile | null;
}

interface VwapCache {
  bars: readonly ProBar[];
  from: number;
  line: (VwapPoint | null)[];
}

export class DrawingLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;

  private bars: readonly ProBar[] = [];
  private ms = 60_000;
  private unit = 'BTC';
  private state: LayerState = {
    drawings: [],
    pending: null,
    selectedId: null,
    hidden: false,
  };
  private items: Item[] = [];
  private selectedItem: Item | null = null;
  private selectedColor = '#ffffff';
  private profiles = new Map<string, ProfileCache>();
  private vwaps = new Map<string, VwapCache>();
  private measureCtx: CanvasRenderingContext2D | null = null;

  private priceViews: AxisLabel[] = [];
  private timeViews: AxisLabel[] = [];
  private priceMarks: AxisMark[] = [];
  private timeMarks: AxisMark[] = [];
  private readonly views: readonly IPrimitivePaneView[];

  constructor() {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) => target.useMediaCoordinateSpace(({ context }) => this.paint(context)),
    };
    this.views = [{ zOrder: () => 'top', renderer: () => renderer }];
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

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.priceViews;
  }

  timeAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.timeViews;
  }

  setBars(bars: readonly ProBar[], intervalMs: number): void {
    this.bars = bars;
    this.ms = intervalMs;
    this.requestUpdate?.();
  }

  /** Jednostka wolumenu w opisach (moneta rynku). */
  setUnit(unit: string): void {
    this.unit = unit;
  }

  setState(s: LayerState): void {
    this.state = s;
    const ids = new Set(s.drawings.map((d) => d.id));
    for (const id of this.profiles.keys()) if (!ids.has(id)) this.profiles.delete(id);
    for (const id of this.vwaps.keys()) if (!ids.has(id)) this.vwaps.delete(id);
    this.requestUpdate?.();
  }

  get intervalMs(): number {
    return this.ms;
  }

  // ───────────────────────── przeliczenia ekran ↔ wykres ─────────────────────────

  private view(): View | null {
    const chart = this.chart;
    const series = this.series;
    const bars = this.bars;
    if (!chart || !series || bars.length === 0) return null;
    const ts = chart.timeScale();
    const xa = ts.logicalToCoordinate(0 as Logical);
    const xb = ts.logicalToCoordinate(1 as Logical);
    if (xa === null || xb === null) return null;
    const sp = xb - xa;
    const pane = chart.paneSize(0);
    if (!(sp > 0) || !(pane.width > 0) || !(pane.height > 0)) return null;
    const ms = this.ms;
    return {
      W: pane.width,
      H: pane.height,
      sp,
      X: (t) => xa + logicalOfTime(bars, t, ms) * sp,
      Y: (p) => series.priceToCoordinate(p) ?? Number.NaN,
    };
  }

  /** Punkt wykresu pod pikselem: czas dociągnięty do środka świecy (także przed danymi i za nimi). */
  toPt(x: number, y: number): Pt | null {
    const chart = this.chart;
    const series = this.series;
    if (!chart || !series || this.bars.length === 0) return null;
    const ts = chart.timeScale();
    const xa = ts.logicalToCoordinate(0 as Logical);
    const xb = ts.logicalToCoordinate(1 as Logical);
    const p = series.coordinateToPrice(y);
    if (xa === null || xb === null || p === null || !(xb - xa > 0)) return null;
    const t = timeOfLogical(this.bars, Math.round((x - xa) / (xb - xa)), this.ms);
    return Number.isFinite(t) && Number.isFinite(p) ? { t, p } : null;
  }

  /** Piksele na 1 USD przy cenie `p`. */
  pxPerUsd(p: number): number {
    const s = this.series;
    if (!s) return 0;
    const a = s.priceToCoordinate(p);
    const b = s.priceToCoordinate(p + 100);
    return a === null || b === null ? 0 : Math.abs(a - b) / 100;
  }

  /** Świeca zaczynająca się dokładnie w `t` (magnes). */
  barAt(t: number): ProBar | null {
    const i = barIndexAt(this.bars, t);
    return i >= 0 && this.bars[i].t === t ? this.bars[i] : null;
  }

  // ───────────────────────── trafienie ─────────────────────────

  /** Rysunek pod kursorem: najpierw uchwyty zaznaczonego, potem rysunki od najwyższego. */
  hit(x: number, y: number): Hit | null {
    if (this.state.hidden) return null;
    const sel = this.selectedItem;
    if (sel) {
      for (let i = 0; i < sel.handles.length; i++) {
        const h = sel.handles[i];
        if (Math.hypot(h.x - x, h.y - y) <= HANDLE_R + 4) return { id: sel.id, handle: i };
      }
    }
    for (let k = this.items.length - 1; k >= 0; k--) {
      const it = this.items[k];
      if (hitsItem(it, x, y)) return { id: it.id, handle: -1 };
    }
    return null;
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const h = this.hit(x, y);
    if (!h) return null;
    return {
      externalId: `draw:${h.id}`,
      zOrder: 'top',
      cursorStyle: h.handle >= 0 ? 'grab' : 'move',
      hitTestPriority: h.handle >= 0 ? 2 : 1,
    };
  }

  // ───────────────────────── scena ─────────────────────────

  updateAllViews(): void {
    this.items = [];
    this.selectedItem = null;
    this.priceMarks = [];
    this.timeMarks = [];
    const v = this.view();
    const st = this.state;
    if (v && !st.hidden) {
      for (const d of st.drawings) {
        const it = this.build(d, v, d.id === st.selectedId);
        if (!it) continue;
        this.items.push(it);
        if (d.id === st.selectedId) {
          this.selectedItem = it;
          this.selectedColor = d.style.color;
        }
      }
    }
    if (v && st.pending) {
      const it = this.build(st.pending, v, true);
      if (it) {
        this.selectedItem = it;
        this.selectedColor = st.pending.style.color;
        this.items.push(it);
      }
    }
    this.priceViews = syncLabels(this.priceViews, this.priceMarks);
    this.timeViews = syncLabels(this.timeViews, this.timeMarks);
  }

  private paint(c: CanvasRenderingContext2D): void {
    c.save();
    for (const it of this.items) {
      c.save();
      it.paint(c);
      c.restore();
    }
    const sel = this.selectedItem;
    if (sel) for (const h of sel.handles) handleDot(c, h, this.selectedColor);
    c.restore();
  }

  private priceMark(p: number, color: string, y: number): void {
    if (Number.isFinite(y)) this.priceMarks.push({ at: y, text: fmtPx(p), color });
  }

  private timeMark(t: number, color: string, x: number): void {
    if (Number.isFinite(x))
      this.timeMarks.push({
        at: x,
        text: crosshairTimeFormatter((t / 1000) as Time),
        color,
      });
  }

  private textWidth(text: string, font: string): number {
    if (!this.measureCtx) this.measureCtx = document.createElement('canvas').getContext('2d');
    const m = this.measureCtx;
    if (!m) return text.length * 7;
    m.font = font;
    return m.measureText(text).width;
  }

  /** Geometria i malowanie jednego rysunku; `marked` = zaznaczony albo stawiany (etykiety punktów na osiach). */
  private build(d: Drawing, v: View, marked: boolean): Item | null {
    const P = d.pts.map((q) => ({ x: v.X(q.t), y: v.Y(q.p) }));
    if (P.length === 0 || P.some((q) => !Number.isFinite(q.x) || !Number.isFinite(q.y))) return null;
    const s = d.style;
    const dash = DASH[s.dash];
    const it: Item = {
      id: d.id,
      lines: [],
      boxes: [],
      handles: [],
      paint: () => {},
    };
    if (marked && d.kind !== 'brush' && d.kind !== 'text' && d.kind !== 'profile' && d.kind !== 'avwap') {
      // Pozycja: wejście szare, cel w kolorze kupna, stop w kolorze sprzedaży; reszta w kolorze rysunku
      const pos = d.kind === 'long' || d.kind === 'short';
      d.pts.forEach((q, i) => {
        if (d.kind !== 'vline') this.priceMark(q.p, pos ? [PRO.ink2, PROFIT, LOSS][i] : s.color, P[i].y);
        if (d.kind !== 'hline' && d.kind !== 'hray' && d.kind !== 'note' && !(pos && i === 2)) this.timeMark(q.t, s.color, P[i].x);
      });
    }
    const [a, b] = P;
    switch (d.kind) {
      case 'trend':
      case 'ray':
      case 'extended':
      case 'arrow': {
        if (!b) return null;
        const ends = d.kind === 'ray' ? [a, farPoint(a, b)] : d.kind === 'extended' ? [farPoint(b, a), farPoint(a, b)] : [a, b];
        const xy = [ends[0].x, ends[0].y, ends[1].x, ends[1].y];
        it.lines.push(xy);
        it.handles = [a, b];
        it.paint = (c) => {
          stroke(c, xy, s.color, s.width, dash);
          if (d.kind === 'arrow') arrowHead(c, a, b, s.color, 8 + 2 * s.width);
        };
        return it;
      }
      case 'hline':
      case 'hray': {
        const y = a.y;
        const x0 = d.kind === 'hline' ? 0 : a.x;
        const xy = [x0, y, v.W, y];
        it.lines.push(xy);
        it.handles = [
          {
            x: d.kind === 'hline' ? Math.min(v.W - 12, Math.max(12, a.x)) : a.x,
            y,
          },
        ];
        if (!marked) this.priceMark(d.pts[0].p, s.color, y);
        it.paint = (c) => {
          stroke(c, xy, s.color, s.width, dash);
          if (d.text) {
            c.font = `600 12px ${TEXT_FAMILY}`;
            c.fillStyle = s.color;
            c.textAlign = 'left';
            c.textBaseline = 'bottom';
            c.fillText(d.text, x0 + 6, y - 3);
          }
        };
        return it;
      }
      case 'vline': {
        const x = a.x;
        const xy = [x, 0, x, v.H];
        it.lines.push(xy);
        it.handles = [{ x, y: v.H / 2 }];
        if (!marked) this.timeMark(d.pts[0].t, s.color, x);
        it.paint = (c) => stroke(c, xy, s.color, s.width, dash);
        return it;
      }
      case 'channel': {
        if (!b) return null;
        const c3 = P[2];
        const l1 = [a.x, a.y, b.x, b.y];
        it.lines.push(l1);
        it.handles = c3 ? [a, b, c3] : [a, b];
        if (!c3) {
          it.paint = (c) => stroke(c, l1, s.color, s.width, dash);
          return it;
        }
        const k = b.x !== a.x ? (b.y - a.y) / (b.x - a.x) : 0;
        const dy = c3.y - (a.y + k * (c3.x - a.x));
        const l2 = [a.x, a.y + dy, b.x, b.y + dy];
        const mid = [a.x, a.y + dy / 2, b.x, b.y + dy / 2];
        it.lines.push(l2);
        it.paint = (c) => {
          fill(c, [a.x, a.y, b.x, b.y, b.x, b.y + dy, a.x, a.y + dy], rgba(s.color, 0.08));
          stroke(c, l1, s.color, s.width, dash);
          stroke(c, l2, s.color, s.width, dash);
          stroke(c, mid, rgba(s.color, 0.55), 1, DASH.dashed);
        };
        return it;
      }
      case 'fib':
      case 'fibext': {
        if (!b) return null;
        const ext = d.kind === 'fibext';
        const c3 = P[2];
        it.handles = P.slice();
        const guide = [a.x, a.y, b.x, b.y, ...(c3 ? [c3.x, c3.y] : [])];
        it.lines.push(guide);
        if (ext && !c3) {
          it.paint = (c) => stroke(c, guide, rgba(s.color, 0.7), 1, DASH.dashed);
          return it;
        }
        const [pa, pb, pc] = d.pts;
        const levels = (ext ? FIB_EXTENSION : FIB_RETRACE).map((L, i) => {
          const p = ext ? fibExtension(pa.p, pb.p, pc.p, L) : fibRetrace(pa.p, pb.p, L);
          return { L, p, y: v.Y(p), color: FIB_COLORS[i % FIB_COLORS.length] };
        });
        const x0 = ext ? c3.x : Math.min(a.x, b.x);
        const x1 = ext ? c3.x + Math.max(40, Math.abs(b.x - a.x)) : Math.max(a.x, b.x, x0 + 40);
        for (const l of levels) it.lines.push([x0, l.y, x1, l.y]);
        const labelsLeft = x0 > 110;
        it.paint = (c) => {
          for (let i = 1; i < levels.length; i++) {
            const y0 = levels[i - 1].y;
            const y1 = levels[i].y;
            fill(c, rectXY(x0, Math.min(y0, y1), x1 - x0, Math.abs(y1 - y0)), rgba(levels[i].color, 0.07));
          }
          stroke(c, guide, rgba(s.color, 0.7), 1, DASH.dashed);
          c.font = LABEL_FONT;
          c.textBaseline = 'middle';
          for (const l of levels) {
            if (!Number.isFinite(l.y)) continue;
            stroke(c, [x0, l.y, x1, l.y], l.color, s.width, dash);
            c.fillStyle = l.color;
            const text = `${l.L} (${fmtPx(l.p)})`;
            if (labelsLeft) {
              c.textAlign = 'right';
              c.fillText(text, x0 - 6, l.y);
            } else {
              c.textAlign = 'left';
              c.fillText(text, x0 + 4, l.y - 7);
            }
          }
        };
        return it;
      }
      case 'rect': {
        if (!b) return null;
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const w = Math.abs(b.x - a.x);
        const h = Math.abs(b.y - a.y);
        const xy = rectXY(x, y, w, h);
        it.lines.push([...xy, x, y]);
        it.boxes.push([x, y, w, h]);
        it.handles = [a, b, { x: a.x, y: b.y }, { x: b.x, y: a.y }];
        it.paint = (c) => {
          fill(c, xy, rgba(s.color, 0.12));
          stroke(c, [...xy, x, y], s.color, s.width, dash);
        };
        return it;
      }
      case 'brush': {
        const xy = P.flatMap((q) => [q.x, q.y]);
        it.lines.push(xy);
        it.paint = (c) => {
          c.lineJoin = 'round';
          c.lineCap = 'round';
          stroke(c, xy, s.color, s.width, dash);
        };
        return it;
      }
      case 'measure':
        return b ? this.buildMeasure(d, it, a, b) : null;
      case 'long':
      case 'short':
        return P.length >= 3 ? this.buildPosition(d, it, P) : null;
      case 'text': {
        const size = 12 + 2 * s.width;
        const font = `600 ${size}px ${TEXT_FAMILY}`;
        const rows = (d.text || tr('Tekst', 'Text')).split('\n').slice(0, 8);
        const w = Math.max(...rows.map((r) => this.textWidth(r, font)));
        const lh = size + 4;
        const box = [a.x - 4, a.y - lh / 2 - 3, w + 8, lh * rows.length + 6];
        it.boxes.push(box);
        it.paint = (c) => {
          c.font = font;
          c.fillStyle = s.color;
          c.textAlign = 'left';
          c.textBaseline = 'middle';
          rows.forEach((r, i) => c.fillText(r, a.x, a.y + i * lh));
          if (marked) stroke(c, [...rectXY(box[0], box[1], box[2], box[3]), box[0], box[1]], rgba(s.color, 0.6), 1, DASH.dashed);
        };
        return it;
      }
      case 'note': {
        const font = `500 12px ${TEXT_FAMILY}`;
        const rows = (d.text || tr('Notatka', 'Note')).split('\n').slice(0, 8);
        const w = Math.max(...rows.map((r) => this.textWidth(r, font))) + 14;
        const h = rows.length * 16 + 8;
        const bx = a.x + 8;
        const by = a.y - 10 - h;
        const ray = [a.x, a.y, v.W, a.y];
        it.lines.push(ray);
        it.boxes.push([bx, by, w, h]);
        it.handles = [a];
        if (!marked) this.priceMark(d.pts[0].p, s.color, a.y);
        it.paint = (c) => {
          stroke(c, ray, rgba(s.color, 0.5), 1, DASH.dashed);
          stroke(c, [a.x, a.y, bx + 6, by + h], s.color, 1);
          c.fillStyle = rgba(PRO.bg, 0.94);
          c.beginPath();
          c.roundRect(bx, by, w, h, 4);
          c.fill();
          c.strokeStyle = s.color;
          c.lineWidth = s.width;
          c.setLineDash([]);
          c.stroke();
          c.font = font;
          c.fillStyle = PRO.ink1;
          c.textAlign = 'left';
          c.textBaseline = 'middle';
          rows.forEach((r, i) => c.fillText(r, bx + 7, by + 4 + 8 + i * 16));
          c.beginPath();
          c.arc(a.x, a.y, 3, 0, Math.PI * 2);
          c.fillStyle = s.color;
          c.fill();
        };
        return it;
      }
      case 'profile':
        return b ? this.buildProfile(d, it, v) : null;
      case 'avwap':
        return this.buildAvwap(d, it, v);
    }
  }

  private buildMeasure(d: Drawing, it: Item, a: XY, b: XY): Item {
    const m = measureStats(this.bars, this.ms, d.pts[0], d.pts[1]);
    const up = m.dp >= 0;
    const color = up ? MEASURE_UP : MEASURE_DOWN;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    const xm = x + w / 2;
    const ym = y + h / 2;
    it.boxes.push([x, y, w, h]);
    it.handles = [a, b];
    const digits = priceDigits(d.pts[0].p);
    const rows = [
      {
        text: numLang(`${fmtSigned(m.dp, digits)} (${fmtPct(m.pct)})`),
        color: PRO.ink1,
      },
      {
        text: `${m.bars} ${m.bars === 1 ? tr('świeca', 'candle') : tr('świec', 'candles')} · ${fmtDuration(m.ms)}`,
        color: PRO.ink2,
      },
      {
        text:
          `${tr('Wol', 'Vol')} ${fmtVol(m.vol)} ${this.unit}` +
          (m.delta === null
            ? tr(' · Δ brak taśmy', ' · Δ no tape')
            : ` · Δ ${fmtSignedVol(m.delta)}${m.tape < 1 ? ` (${tr('taśma', 'tape')} ${Math.round(m.tape * 100)}%)` : ''}`),
        color: m.delta === null ? PRO.ink3 : m.delta >= 0 ? PRO.buyInk : PRO.sellInk,
      },
    ];
    const by = up ? y - 6 - boxHeight(rows.length) : y + h + 6;
    it.paint = (c) => {
      fill(c, rectXY(x, y, w, h), rgba(color, 0.14));
      stroke(c, [xm, a.y, xm, b.y], color, 1);
      stroke(c, [a.x, ym, b.x, ym], color, 1);
      if (h > 10) arrowHead(c, { x: xm, y: a.y }, { x: xm, y: b.y }, color, 7);
      if (w > 10) arrowHead(c, { x: a.x, y: ym }, { x: b.x, y: ym }, color, 7);
      textBox(c, rows, xm, by, rgba(PRO.bg, 0.94), color);
    };
    return it;
  }

  private buildPosition(d: Drawing, it: Item, P: XY[]): Item {
    const [E, T, S] = P;
    const [pe, pt, ps] = d.pts;
    const x0 = Math.min(E.x, T.x);
    const x1 = Math.max(E.x, T.x, x0 + 8);
    const w = x1 - x0;
    const ps0 = positionStats(pe.p, pt.p, ps.p);
    const tBox = [x0, Math.min(E.y, T.y), w, Math.abs(T.y - E.y)];
    const sBox = [x0, Math.min(E.y, S.y), w, Math.abs(S.y - E.y)];
    it.boxes.push(tBox, sBox);
    it.handles = [
      { x: x0, y: E.y },
      { x: x0, y: T.y },
      { x: x0, y: S.y },
      { x: x1, y: E.y },
    ];
    const cx = x0 + w / 2;
    const tUp = T.y < E.y;
    const sUp = S.y < E.y;
    const rr = Number.isFinite(ps0.rr) ? numLang(ps0.rr.toFixed(2)) : '—';
    it.paint = (c) => {
      fill(c, rectXY(tBox[0], tBox[1], tBox[2], tBox[3]), rgba(PROFIT, 0.16));
      fill(c, rectXY(sBox[0], sBox[1], sBox[2], sBox[3]), rgba(LOSS, 0.16));
      stroke(c, [x0, E.y, x1, E.y], PRO.ink2, 1);
      stroke(c, [x0, T.y, x1, T.y], rgba(PROFIT, 0.7), 1);
      stroke(c, [x0, S.y, x1, S.y], rgba(LOSS, 0.7), 1);
      const tRows = [
        {
          text: `${tr('Cel', 'Target')} ${fmtPx(pt.p)} · ${numLang(fmtPct(tUp ? ps0.rewardPct : -ps0.rewardPct))}`,
          color: '#0b0b12',
        },
      ];
      const sRows = [
        {
          text: `Stop ${fmtPx(ps.p)} · ${numLang(fmtPct(sUp ? ps0.riskPct : -ps0.riskPct))}`,
          color: '#ffffff',
        },
      ];
      textBox(c, tRows, cx, tUp ? T.y - 4 - boxHeight(1) : T.y + 4, PROFIT);
      textBox(c, sRows, cx, sUp ? S.y - 4 - boxHeight(1) : S.y + 4, LOSS);
      textBox(
        c,
        [
          {
            text: `${d.kind === 'long' ? 'Long' : 'Short'} ${fmtPx(pe.p)} · R:R ${rr}`,
            color: PRO.ink1,
          },
        ],
        cx,
        E.y - boxHeight(1) / 2,
        rgba(PRO.bg, 0.92),
        PRO.ink3
      );
    };
    return it;
  }

  private buildProfile(d: Drawing, it: Item, v: View): Item | null {
    const bars = this.bars;
    const n = bars.length;
    const ta = Math.min(d.pts[0].t, d.pts[1].t);
    const tb = Math.max(d.pts[0].t, d.pts[1].t);
    const ia = Math.max(0, barIndexAt(bars, ta));
    const ib = Math.min(n - 1, barIndexAt(bars, tb));
    const xL = v.X(ta) - v.sp / 2;
    const xR = v.X(tb) + v.sp / 2;
    const s = d.style;
    const ref = bars[Math.max(0, ib)].candle.c;
    const ppu = this.pxPerUsd(ref);
    const step = ppu > 0 ? autoRowStep(ppu, hlTick(ref), RANGE_PROFILE_ROW_PX) : 0;
    const prof = ib >= ia && step > 0 ? this.rangeProfile(d.id, ia, ib, step) : null;
    const ym = (v.Y(d.pts[0].p) + v.Y(d.pts[1].p)) / 2;
    it.handles = d.pts.map((q) => ({ x: q.t === ta ? xL : xR, y: ym }));
    if (!prof) {
      const box = [xL, ym - 20, xR - xL, 40];
      it.boxes.push(box);
      it.paint = (c) => stroke(c, [...rectXY(box[0], box[1], box[2], box[3]), box[0], box[1]], rgba(s.color, 0.5), 1, DASH.dashed);
      return it;
    }
    const rows = prof.vol.length;
    const yTop = v.Y((prof.lo + rows) * prof.step);
    const yBot = v.Y(prof.lo * prof.step);
    const wMax = (xR - xL) * RANGE_PROFILE_FRAC;
    it.boxes.push([xL, yTop, xR - xL, yBot - yTop]);
    for (const h of it.handles) h.y = (yTop + yBot) / 2;
    const pocY = v.Y((prof.lo + prof.poc + 0.5) * prof.step);
    const vahY = v.Y((prof.lo + prof.vaHi + 1) * prof.step);
    const valY = v.Y((prof.lo + prof.vaLo) * prof.step);
    const pocPrice = (prof.lo + prof.poc + 0.5) * prof.step;
    it.paint = (c) => {
      fill(c, rectXY(xL, yTop, xR - xL, yBot - yTop), rgba(s.color, 0.04));
      const rowPx = Math.abs(v.Y(prof.step) - v.Y(0));
      const gap = rowPx >= 4 ? 1 : 0;
      for (let k = 0; k < rows; k++) {
        const vol = prof.vol[k];
        if (!(vol > 0)) continue;
        const y0 = v.Y((prof.lo + k + 1) * prof.step);
        const y1 = v.Y((prof.lo + k) * prof.step);
        const color = k === prof.poc ? rgba(PRO.profilePoc, 0.85) : k >= prof.vaLo && k <= prof.vaHi ? rgba(PRO.profileVa, 0.75) : rgba(PRO.profileOut, 0.6);
        c.fillStyle = color;
        c.fillRect(xL, y0, Math.max(1, (vol / prof.max) * wMax), Math.max(1, y1 - y0 - gap));
      }
      stroke(c, [xL, pocY, xR, pocY], PRO.profilePoc, 1);
      stroke(c, [xL, vahY, xR, vahY], rgba(PRO.ink2, 0.45), 1, DASH.dashed);
      stroke(c, [xL, valY, xR, valY], rgba(PRO.ink2, 0.45), 1, DASH.dashed);
      stroke(c, [...rectXY(xL, yTop, xR - xL, yBot - yTop), xL, yTop], rgba(s.color, 0.35), 1);
      c.font = LABEL_FONT;
      c.fillStyle = PRO.ink2;
      c.textAlign = 'left';
      c.textBaseline = 'top';
      c.fillText(`Wol ${fmtVol(prof.total)} ${this.unit} · POC ${fmtPx(pocPrice)}`, xL + 2, yBot + 4);
    };
    return it;
  }

  private rangeProfile(id: string, from: number, to: number, step: number): VolumeProfile | null {
    const c = this.profiles.get(id);
    if (c && c.bars === this.bars && c.from === from && c.to === to && c.step === step) return c.profile;
    const profile = volumeProfile(this.bars, from, to, step);
    this.profiles.set(id, { bars: this.bars, from, to, step, profile });
    return profile;
  }

  private buildAvwap(d: Drawing, it: Item, v: View): Item | null {
    const bars = this.bars;
    const from = barIndexAt(bars, d.pts[0].t);
    if (from < 0) return null;
    let cache = this.vwaps.get(d.id);
    if (!cache || cache.bars !== bars || cache.from !== from) {
      cache = { bars, from, line: vwapSeries(bars.slice(from), 'none') };
      this.vwaps.set(d.id, cache);
    }
    const line = cache.line;
    const s = d.style;
    const range = this.chart?.timeScale().getVisibleLogicalRange();
    const i0 = Math.max(from, Math.floor(range?.from ?? 0) - 1);
    const i1 = Math.min(bars.length - 1, Math.ceil(range?.to ?? bars.length) + 1);
    const mid: number[] = [];
    const up: number[] = [];
    const dn: number[] = [];
    for (let i = i0; i <= i1; i++) {
      const q = line[i - from];
      if (!q) continue;
      const x = v.X(bars[i].t);
      mid.push(x, v.Y(q.vwap));
      up.push(x, v.Y(q.vwap + q.sd));
      dn.push(x, v.Y(q.vwap - q.sd));
    }
    const first = line.find((q) => q !== null) ?? null;
    const last = line[line.length - 1] ?? null;
    const anchor = {
      x: v.X(bars[from].t),
      y: first ? v.Y(first.vwap) : v.Y(d.pts[0].p),
    };
    it.handles = [anchor];
    if (mid.length >= 4) it.lines.push(mid);
    if (last) this.priceMark(last.vwap, s.color, v.Y(last.vwap));
    it.paint = (c) => {
      if (mid.length >= 4) {
        stroke(c, up, rgba(s.color, 0.4), 1, DASH.dashed);
        stroke(c, dn, rgba(s.color, 0.4), 1, DASH.dashed);
        stroke(c, mid, s.color, s.width + 0.5, DASH[s.dash]);
      }
      c.fillStyle = s.color;
      c.beginPath();
      c.moveTo(anchor.x, anchor.y + 6);
      c.lineTo(anchor.x - 5, anchor.y + 14);
      c.lineTo(anchor.x + 5, anchor.y + 14);
      c.closePath();
      c.fill();
      if (mid.length >= 4) tag(c, 'AVWAP', mid[mid.length - 2] + 6, mid[mid.length - 1], 'left', s.color);
    };
    return it;
  }
}

function hitsItem(it: Item, x: number, y: number): boolean {
  for (const b of it.boxes) if (x >= b[0] && x <= b[0] + b[2] && y >= b[1] && y <= b[1] + b[3]) return true;
  for (const l of it.lines) {
    for (let i = 2; i < l.length; i += 2) {
      if (distToSegment(x, y, { x: l[i - 2], y: l[i - 1] }, { x: l[i], y: l[i + 1] }) <= HIT_PX) return true;
    }
  }
  return false;
}

/** Etykiety osi z puli (bez tworzenia obiektów w każdej klatce). */
function syncLabels(pool: AxisLabel[], marks: readonly AxisMark[]): AxisLabel[] {
  while (pool.length < marks.length) pool.push(new AxisLabel());
  marks.forEach((m, i) => {
    pool[i].at = m.at;
    pool[i].label = m.text;
    pool[i].bg = m.color;
  });
  return pool.slice(0, marks.length);
}
