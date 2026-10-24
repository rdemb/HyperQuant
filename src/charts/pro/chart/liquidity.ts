import type {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  Logical,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import { fmtVol } from '../../orderflow/footprint';
import { buildHeatLut } from '../../orderflow/heatColor';
import type { BookFrame, BookHistory } from '../core/book';
import type { AggressorOrder } from '../core/orders';
import type { ProBar } from '../store/proStore';
import { fmtCell } from './layout';
import { logicalOfTime } from './overlay';
import { DOM_W_PX, LIQ_RAMP, MONO, PRO, rgba } from './theme';

/**
 * Warstwa płynności pod świecami i nad nimi: mapa ciepła arkusza zleceń w czasie (migawki l2Book,
 * każda obowiązuje do następnej; agregacja daleka ~100 USD pod bliską ~10 USD), bąble zleceń
 * agresora (pole ∝ wartość USD) i drabina DOM z bieżącym arkuszem przy prawej krawędzi.
 * Wszystko powstaje z danych na żywo od otwarcia strony.
 */

export interface LiquidityToggles {
  showHeatmap: boolean;
  showBubbles: boolean;
}

/**
 * Bąble: najmniejsza wartość zlecenia (USD); w widoku zostaje najwyżej ~0,6 bąbla na świecę (największe),
 * żeby przy zbliżeniu nie zasłaniały liczb footprintu.
 */
const BUBBLE_MIN_USD = 100_000;
const BUBBLE_PER_BAR = 0.6;
const BUBBLE_MIN_COUNT = 8;
const BUBBLE_MAX_COUNT = 400;
const BUBBLE_R_MIN = 3;
const BUBBLE_R_MAX = 22;
/** Podpis (wielkość w BTC) od tego promienia (px). */
const BUBBLE_LABEL_R = 13;
/**
 * Drabina DOM: najdłuższy słupek (px) przy percentylu DOM_Q wielkości migawki (większe ściany mają pełny słupek,
 * a wielkość mówi liczba; skala pierwiastkowa, żeby jedna ściana nie spłaszczała reszty), wiek migawki,
 * po którym znika (ms), i najmniejsza wysokość wiersza z liczbą (px).
 */
const DOM_BAR_PX = DOM_W_PX - 22;
const DOM_Q = 0.95;
const DOM_STALE_MS = 30_000;
const DOM_LABEL_ROW_PX = 9;
/**
 * Nasycenie mapy ciepła: percentyl wielkości w widocznych migawkach. Skala liniowa — typowe poziomy zostają
 * ciemne, a jasne pasy i ściany wyróżniają się tylko przy dużej płynności.
 */
const HEAT_Q = 0.97;
const HEAT_SAMPLE = 12_000;

/**
 * Kule z cieniowaniem: jaśniejszy środek przesunięty ku górze, ciemniejszy brzeg i jasny obrys 1 px
 * (kupno morskie, sprzedaż magenta). Półprzezroczyste, żeby liczby footprintu pod nimi dało się odczytać.
 */
const K = {
  buyCore: 'rgba(47,216,200,0.7)',
  buyEdge: 'rgba(11,110,102,0.55)',
  buyRim: 'rgba(120,240,228,0.9)',
  sellCore: 'rgba(226,59,233,0.7)',
  sellEdge: 'rgba(122,18,128,0.55)',
  sellRim: 'rgba(246,140,250,0.9)',
  label: '#ffffff',
  domBid: rgba(PRO.domBid, 0.92),
  domAsk: rgba(PRO.domAsk, 0.92),
  domText: PRO.domText,
};

interface Bubble {
  x: number;
  y: number;
  r: number;
  buy: boolean;
  label: string;
}

/** Poziom arkusza w drabinie (px CSS panelu): górna krawędź, wysokość, długość słupka. */
interface DomRow {
  y: number;
  h: number;
  w: number;
  bid: boolean;
  label: string;
}

interface Geometry {
  /** x środka świecy 0 i odstęp świec (px). */
  xa: number;
  sp: number;
  /** Cena → y: y = a + b·cena (skala liniowa). */
  a: number;
  b: number;
  tFrom: number;
  tTo: number;
}

export class LiquidityLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;

  private toggles: LiquidityToggles;
  private bars: readonly ProBar[] = [];
  private ms = 60_000;
  private near: BookHistory | null = null;
  private far: BookHistory | null = null;
  private orders: (from: number, to: number) => AggressorOrder[] = () => [];
  private now = 0;
  private geo: Geometry | null = null;
  private bubbles: Bubble[] = [];
  private dom: DomRow[] = [];
  private domRight = 0;

  private readonly lut = buildHeatLut(LIQ_RAMP);
  private readonly tex = document.createElement('canvas');
  private texKey = '';
  private readonly views: readonly IPrimitivePaneView[];

  constructor(toggles: LiquidityToggles) {
    this.toggles = toggles;
    const heat: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context, mediaSize }) => {
          if (!this.toggles.showHeatmap || !this.renderHeat(Math.ceil(mediaSize.width), Math.ceil(mediaSize.height))) return;
          context.imageSmoothingEnabled = false;
          context.drawImage(this.tex, 0, 0);
        }),
    };
    const bubbles: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => drawBubbles(context, this.bubbles, hr, vr)),
    };
    const dom: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio: hr, verticalPixelRatio: vr }) =>
          drawDom(context, this.dom, this.domRight, hr, vr)
        ),
    };
    this.views = [
      { zOrder: () => 'bottom', renderer: () => heat },
      { zOrder: () => 'normal', renderer: () => bubbles },
      { zOrder: () => 'normal', renderer: () => dom },
    ];
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

  setToggles(t: LiquidityToggles): void {
    this.toggles = t;
    this.requestUpdate?.();
  }

  setData(
    bars: readonly ProBar[],
    intervalMs: number,
    near: BookHistory | null,
    far: BookHistory | null,
    orders: (from: number, to: number) => AggressorOrder[],
    now: number
  ): void {
    this.bars = bars;
    this.ms = intervalMs;
    this.near = near;
    this.far = far;
    this.orders = orders;
    this.now = now;
    this.requestUpdate?.();
  }

  updateAllViews(): void {
    this.geo = this.geometry();
    this.bubbles = this.toggles.showBubbles && this.geo ? this.sceneBubbles(this.geo) : [];
    this.dom = this.toggles.showHeatmap && this.geo ? this.sceneDom(this.geo) : [];
  }

  private geometry(): Geometry | null {
    const chart = this.chart;
    const series = this.series;
    const bars = this.bars;
    if (!chart || !series || bars.length === 0) return null;
    const ts = chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    const xa = ts.logicalToCoordinate(0 as Logical);
    const xb = ts.logicalToCoordinate(1 as Logical);
    if (!range || xa === null || xb === null || !(xb > xa)) return null;
    const p0 = bars[bars.length - 1].candle.c;
    const y0 = series.priceToCoordinate(p0);
    const y1 = series.priceToCoordinate(p0 + 1000);
    if (y0 === null || y1 === null) return null;
    const b = (y1 - y0) / 1000;
    const vf = Math.max(0, Math.floor(range.from));
    const tFrom = vf < bars.length ? bars[vf].t : bars[bars.length - 1].t;
    return { xa, sp: xb - xa, a: y0 - b * p0, b, tFrom, tTo: this.now + 1 };
  }

  private x(t: number, g: Geometry): number {
    return g.xa + (logicalOfTime(this.bars, t, this.ms) - 0.5) * g.sp;
  }

  // ───────────────────────── mapa ciepła ─────────────────────────

  /** Tekstura mapy ciepła w pikselach CSS panelu; przemalowanie tylko po zmianie widoku albo nowej migawce. */
  private renderHeat(W: number, H: number): boolean {
    const g = this.geo;
    if (!g || !(W > 0) || !(H > 0) || (!this.near && !this.far)) return false;
    const key = `${W}|${H}|${g.xa.toFixed(2)}|${g.sp.toFixed(4)}|${g.a.toFixed(3)}|${g.b.toFixed(6)}|${this.near?.version}|${this.far?.version}|${Math.floor(this.now / 1000)}`;
    if (key === this.texKey) return true;
    this.texKey = key;
    if (this.tex.width !== W || this.tex.height !== H) {
      this.tex.width = W;
      this.tex.height = H;
    }
    const ctx = this.tex.getContext('2d');
    if (!ctx) return false;
    const img = ctx.createImageData(W, H);
    const px = new Uint32Array(img.data.buffer);
    // Daleka agregacja najpierw, bliska (dokładniejsza) nadpisuje ją wokół ceny
    for (const layer of [this.far, this.near]) {
      if (!layer) continue;
      const frames = layer.range(g.tFrom, g.tTo);
      if (frames.length === 0) continue;
      const norm = heatNorm(frames);
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        const x0 = Math.max(0, Math.round(this.x(f.t, g)));
        const x1 = Math.min(W, Math.max(x0 + 1, Math.round(this.x(frames[i + 1]?.t ?? this.now, g))));
        if (x1 <= 0 || x0 >= W) continue;
        paintFrame(px, W, H, f, x0, x1, g, norm, this.lut);
      }
    }
    ctx.putImageData(img, 0, 0);
    return true;
  }

  // ───────────────────────── bąble ─────────────────────────

  private sceneBubbles(g: Geometry): Bubble[] {
    let list = this.orders(g.tFrom, g.tTo).filter((o) => o.notional >= BUBBLE_MIN_USD);
    if (list.length === 0) return [];
    const bars = (g.tTo - g.tFrom) / this.ms;
    const cap = Math.round(Math.min(BUBBLE_MAX_COUNT, Math.max(BUBBLE_MIN_COUNT, bars * BUBBLE_PER_BAR)));
    if (list.length > cap) list = list.sort((p, q) => q.notional - p.notional).slice(0, cap);
    let max = 0;
    for (const o of list) if (o.notional > max) max = o.notional;
    const out: Bubble[] = [];
    for (const o of list) {
      // Pole koła proporcjonalne do wartości zlecenia
      const r = Math.max(BUBBLE_R_MIN, BUBBLE_R_MAX * Math.sqrt(o.notional / max));
      out.push({ x: this.x(o.time, g), y: g.a + g.b * o.vwap, r, buy: o.side === 1, label: r >= BUBBLE_LABEL_R ? fmtVol(o.sz) : '' });
    }
    // Mniejsze na wierzchu — nie giną pod dużymi
    return out.sort((p, q) => q.r - p.r);
  }

  // ───────────────────────── drabina DOM ─────────────────────────

  /** Bieżący bliski arkusz: słupki od prawej krawędzi panelu w lewo, długość ∝ wielkość poziomu. */
  private sceneDom(g: Geometry): DomRow[] {
    const f = this.near?.latest();
    const W = this.chart?.paneSize(0).width ?? 0;
    if (!f || f.sz.length === 0 || this.now - f.t > DOM_STALE_MS || !(W > DOM_W_PX)) return [];
    const sorted = Array.from(f.sz).sort((p, q) => p - q);
    const norm = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * DOM_Q))];
    if (!(norm > 0)) return [];
    this.domRight = W;
    const half = f.step / 2;
    const out: DomRow[] = [];
    for (let i = 0; i < f.px.length; i++) {
      const ya = g.a + g.b * (f.px[i] + half);
      const yb = g.a + g.b * (f.px[i] - half);
      out.push({ y: Math.min(ya, yb), h: Math.abs(yb - ya), w: DOM_BAR_PX * Math.sqrt(Math.min(1, f.sz[i] / norm)), bid: i < f.nBids, label: fmtCell(f.sz[i]) });
    }
    return out;
  }
}

/** Wielkość (BTC) przy percentylu HEAT_Q z próbki poziomów widocznych migawek. */
function heatNorm(frames: readonly BookFrame[]): number {
  let total = 0;
  for (const f of frames) total += f.sz.length;
  const stride = Math.max(1, Math.ceil(total / HEAT_SAMPLE));
  const sample: number[] = [];
  let k = 0;
  for (const f of frames) {
    for (let i = 0; i < f.sz.length; i++, k++) if (k % stride === 0) sample.push(f.sz[i]);
  }
  if (sample.length === 0) return 0;
  sample.sort((p, q) => p - q);
  return sample[Math.min(sample.length - 1, Math.floor(sample.length * HEAT_Q))];
}

function paintFrame(px: Uint32Array, W: number, H: number, f: BookFrame, x0: number, x1: number, g: Geometry, norm: number, lut: Uint32Array): void {
  const half = f.step / 2;
  for (let i = 0; i < f.px.length; i++) {
    const t = norm > 0 ? Math.min(1, f.sz[i] / norm) : 0;
    if (t <= 0.02) continue;
    const c = lut[Math.min(255, Math.round(t * 255))];
    let ya = Math.round(g.a + g.b * (f.px[i] + half));
    let yb = Math.round(g.a + g.b * (f.px[i] - half));
    if (ya > yb) [ya, yb] = [yb, ya];
    ya = Math.max(0, ya);
    yb = Math.min(H, Math.max(ya + 1, yb));
    for (let y = ya; y < yb; y++) px.fill(c, y * W + x0, y * W + x1);
  }
}

function drawBubbles(ctx: CanvasRenderingContext2D, list: readonly Bubble[], hr: number, vr: number): void {
  if (list.length === 0) return;
  const k = Math.min(hr, vr);
  ctx.font = `600 ${Math.round(10 * k)}px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(1, Math.round(k));
  for (const b of list) {
    const x = b.x * hr;
    const y = b.y * vr;
    const r = b.r * k;
    const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    grad.addColorStop(0, b.buy ? K.buyCore : K.sellCore);
    grad.addColorStop(1, b.buy ? K.buyEdge : K.sellEdge);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = b.buy ? K.buyRim : K.sellRim;
    ctx.stroke();
    if (b.label) {
      ctx.fillStyle = K.label;
      ctx.fillText(b.label, x, y);
    }
  }
}

function drawDom(ctx: CanvasRenderingContext2D, rows: readonly DomRow[], right: number, hr: number, vr: number): void {
  if (rows.length === 0) return;
  const xr = Math.round(right * hr);
  const gap = Math.max(1, Math.round(vr));
  ctx.font = `500 ${Math.round(10 * vr)}px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const r of rows) {
    const y = Math.round(r.y * vr);
    const h = Math.max(1, Math.round(r.h * vr) - (r.h >= 4 ? gap : 0));
    const w = Math.max(1, Math.round(r.w * hr));
    ctx.fillStyle = r.bid ? K.domBid : K.domAsk;
    ctx.fillRect(xr - w, y, w, h);
    if (r.h >= DOM_LABEL_ROW_PX) {
      ctx.fillStyle = K.domText;
      ctx.fillText(r.label, xr - w - Math.round(3 * hr), y + h / 2);
    }
  }
}
