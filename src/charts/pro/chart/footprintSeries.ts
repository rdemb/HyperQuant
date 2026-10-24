import { customSeriesDefaultOptions } from 'lightweight-charts';
import type {
  CustomData,
  CustomSeriesOptions,
  CustomSeriesPricePlotValues,
  CustomSeriesWhitespaceData,
  ICustomSeriesPaneRenderer,
  ICustomSeriesPaneView,
  PaneRendererCustomData,
  PriceToCoordinateConverter,
  Time,
} from 'lightweight-charts';
import { IMB_BUY, IMB_SELL, fmtVol } from '../../orderflow/footprint';
import { FootprintBar, FootprintRows, aggregateRows, hlTick, stackedRuns } from '../core/footprintBar';
import type { ProBar } from '../store/proStore';
import {
  CELL_MIN_ROW_PX,
  Detail,
  FootprintStyle,
  PROFILE_MIN_ROW_PX,
  autoRowStep,
  cellFontPx,
  cellMinSpacing,
  pickDetail,
} from './layout';
import { MONO, PRO, rgba } from './theme';

/**
 * Seria footprintu dla Lightweight Charts: jedna seria rysuje świecę, a przy zbliżeniu także footprint
 * z taśmy — profil wolumenu w świecy, a przy większym zbliżeniu komórki z liczbami (sprzedaż × kupno,
 * delta albo wolumen wiersza). POC w ramce, value area 70% przy krawędzi, nierównowagi diagonalne
 * wyróżnione, serie nierównowag („stacked”) zaznaczone pionowym paskiem. Świeca z niepełną taśmą
 * jest przygaszona i oznaczona nad szczytem.
 */

export type ChartView = 'candles' | 'footprint';

export interface FootprintPoint extends CustomData<Time> {
  open: number;
  high: number;
  low: number;
  close: number;
  bar: ProBar;
}

export interface FootprintOptions extends CustomSeriesOptions {
  view: ChartView;
  fpStyle: FootprintStyle;
  /** Wysokość wiersza (USD); 0 = automatycznie wg zbliżenia. */
  rowStep: number;
  imbalanceRatio: number;
  imbalanceMinVol: number;
  /** Minimalna liczba kolejnych wierszy z nierównowagą tworzących strefę „stacked”. */
  stackedMin: number;
}

/** Stan ostatniej klatki (dla legendy: ten sam wiersz, który widać na wykresie). */
export interface FootprintFrame {
  detail: Detail;
  step: number;
}

const LEVELS = 16;
const ramp = (hex: string, a0: number, a1: number) => Array.from({ length: LEVELS + 1 }, (_, i) => rgba(hex, a0 + ((a1 - a0) * i) / LEVELS));
// Tło komórek najwyżej 40% krycia — liczby (także wyróżnione kolorem nierównowagi) zachowują kontrast
const BUY_BG = ramp(PRO.buy, 0.05, 0.4);
const SELL_BG = ramp(PRO.sell, 0.05, 0.4);
const VOL_BG = ramp(PRO.accent, 0.05, 0.42);
const BUY_BAR = ramp(PRO.buy, 0.28, 0.9);
const SELL_BAR = ramp(PRO.sell, 0.28, 0.9);
const lvl = (x: number) => (x >= 1 ? LEVELS : x > 0 ? Math.round(x * LEVELS) : 0);

const DIM_ALPHA = 0.5;
/** Od tej szerokości obszaru wierszy (px) styl Bid × Ask dostaje kolumny delty i wolumenu wiersza. */
const WIDE_MIN_PX = 128;

interface RowsCacheEntry {
  key: string;
  rows: FootprintRows;
}

export class FootprintSeries implements ICustomSeriesPaneView<Time, FootprintPoint, FootprintOptions> {
  private data: PaneRendererCustomData<Time, FootprintPoint> | null = null;
  private opts: FootprintOptions = FootprintSeries.defaults();
  private readonly cache = new WeakMap<FootprintBar, RowsCacheEntry>();
  frame: FootprintFrame = { detail: 'candle', step: 0 };

  static defaults(): FootprintOptions {
    return {
      ...customSeriesDefaultOptions,
      color: PRO.accent,
      view: 'footprint',
      fpStyle: 'bidask',
      rowStep: 0,
      imbalanceRatio: 3,
      imbalanceMinVol: 0.05,
      stackedMin: 3,
    };
  }

  defaultOptions(): FootprintOptions {
    return FootprintSeries.defaults();
  }

  priceValueBuilder(d: FootprintPoint): CustomSeriesPricePlotValues {
    return [d.low, d.high, d.close];
  }

  isWhitespace(d: FootprintPoint | CustomSeriesWhitespaceData<Time>): d is CustomSeriesWhitespaceData<Time> {
    return (d as Partial<FootprintPoint>).close === undefined;
  }

  update(data: PaneRendererCustomData<Time, FootprintPoint>, options: FootprintOptions): void {
    this.data = data;
    this.opts = options;
  }

  renderer(): ICustomSeriesPaneRenderer {
    return { draw: (target, priceToY) => this.draw(target, priceToY) };
  }

  /** Wiersze footprintu na siatce `step` (pamięć podręczna na obiekt świecy — świeca z nowymi transakcjami to nowy obiekt). */
  rowsFor(fp: FootprintBar, step: number): FootprintRows {
    const o = this.opts;
    const key = `${step}|${o.imbalanceRatio}|${o.imbalanceMinVol}`;
    const hit = this.cache.get(fp);
    if (hit && hit.key === key) return hit.rows;
    const rows = aggregateRows(fp, step, { ratio: o.imbalanceRatio, minVol: o.imbalanceMinVol });
    this.cache.set(fp, { key, rows });
    return rows;
  }

  private draw(target: Parameters<ICustomSeriesPaneRenderer['draw']>[0], priceToY: PriceToCoordinateConverter): void {
    const data = this.data;
    const range = data?.visibleRange;
    if (!data || !range || data.bars.length === 0) return;
    const from = Math.max(0, Math.floor(range.from));
    const to = Math.min(data.bars.length, Math.ceil(range.to));
    if (to <= from) return;
    const o = this.opts;
    const spacing = data.barSpacing * (data.conflationFactor || 1);

    // Skala ceny (px/USD) z dwóch punktów przy ostatniej widocznej cenie — skala liniowa
    const ref = data.bars[to - 1].originalData.close;
    const ya = priceToY(ref);
    const yb = priceToY(ref + 100);
    const pxPerUsd = ya !== null && yb !== null ? Math.abs(ya - yb) / 100 : 0;

    let tick = Number.NaN;
    for (let i = from; i < to && Number.isNaN(tick); i++) tick = data.bars[i].originalData.bar.fp?.tick ?? Number.NaN;
    if (Number.isNaN(tick)) tick = hlTick(ref * 0.95);

    let detail: Detail = 'candle';
    let step = 0;
    if (o.view === 'footprint' && pxPerUsd > 0) {
      const wantCells = spacing >= cellMinSpacing(o.fpStyle);
      step = o.rowStep > 0 ? Math.max(o.rowStep, tick) : autoRowStep(pxPerUsd, tick, wantCells ? CELL_MIN_ROW_PX : PROFILE_MIN_ROW_PX);
      detail = pickDetail(spacing, step * pxPerUsd, o.fpStyle);
    }
    this.frame = { detail, step };

    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }) => {
      const H = bitmapSize.height;
      const toY = (p: number) => {
        const y = priceToY(p);
        return y === null ? Number.NaN : y * vr;
      };
      const fontPx = Math.round(cellFontPx(step * pxPerUsd) * vr);
      const fonts = { normal: `${fontPx}px ${MONO}`, bold: `600 ${fontPx}px ${MONO}` };
      if (detail === 'cells') ctx.textBaseline = 'middle';
      for (let i = from; i < to; i++) {
        const item = data.bars[i];
        const d = item.originalData;
        const fp = detail !== 'candle' ? d.bar.fp : null;
        if (!fp) {
          drawCandle(ctx, item.x * hr, spacing * hr, d, toY, hr);
          continue;
        }
        const rows = this.rowsFor(fp, step);
        drawFootprint(ctx, item.x * hr, spacing * hr, d, fp, rows, detail, o, toY, hr, vr, H, fonts);
      }
    });
  }
}

type ToY = (p: number) => number;

interface Fonts {
  normal: string;
  bold: string;
}

/** Zwykła świeca (wartości z API: pełny wolumen giełdy). */
function drawCandle(ctx: CanvasRenderingContext2D, cx: number, slot: number, d: FootprintPoint, toY: ToY, hr: number): void {
  const up = d.close >= d.open;
  const yh = toY(d.high);
  const yl = toY(d.low);
  const yo = toY(d.open);
  const yc = toY(d.close);
  if (Number.isNaN(yh) || Number.isNaN(yl)) return;
  const body = Math.max(1, Math.round(slot * 0.72));
  const bodyW = body >= 3 && body % 2 === 0 ? body - 1 : body;
  const wick = Math.max(1, Math.floor(hr));
  const left = Math.round(cx - bodyW / 2);
  ctx.fillStyle = up ? PRO.buyWick : PRO.sellWick;
  ctx.fillRect(Math.round(cx - wick / 2), Math.round(yh), wick, Math.max(1, Math.round(yl - yh)));
  const top = Math.round(Math.min(yo, yc));
  const h = Math.max(1, Math.round(Math.abs(yc - yo)));
  ctx.fillStyle = up ? PRO.buy : PRO.sell;
  ctx.fillRect(left, top, bodyW, h);
}

/**
 * Footprint jednej świecy. Układ szczeliny: wąska świeca po lewej, obok obszar wierszy.
 * Wiersz ceny P (krok = tick) rysujemy od P − tick/2 do P + tick/2, więc knot świecy kończy się
 * w środku skrajnego wiersza; wiersz zagregowany obejmuje ceny [k·step, (k+1)·step).
 */
function drawFootprint(
  ctx: CanvasRenderingContext2D,
  cx: number,
  slot: number,
  d: FootprintPoint,
  fp: FootprintBar,
  rows: FootprintRows,
  detail: Detail,
  o: FootprintOptions,
  toY: ToY,
  hr: number,
  vr: number,
  H: number,
  fonts: Fonts
): void {
  const half = slot * 0.46;
  const x0 = Math.round(cx - half);
  const x1 = Math.round(cx + half);
  const strip = Math.max(Math.round(3 * hr), Math.min(Math.round(7 * hr), Math.round(slot * 0.1)));
  const gap = Math.max(1, Math.round(2 * hr));
  const ax0 = x0 + strip + gap;
  const aw = x1 - ax0;
  if (aw < 2) {
    drawCandle(ctx, cx, slot, d, toY, hr);
    return;
  }
  const dim = !d.bar.complete;
  if (dim) ctx.globalAlpha = DIM_ALPHA;

  // Świeca w pasku po lewej
  drawCandle(ctx, x0 + strip / 2, strip / 0.72, d, toY, hr);

  // Szeroka świeca w stylu Bid × Ask: trzy kolumny — delta wiersza, komórki, wolumen wiersza
  const wide = detail === 'cells' && o.fpStyle === 'bidask' && aw >= Math.round(WIDE_MIN_PX * hr);
  const side = wide ? Math.round(aw * 0.17) : 0;
  const cx0 = wide ? ax0 + side + gap : ax0;
  const cw = wide ? aw - 2 * (side + gap) : aw;

  const halfTick = fp.tick / 2;
  const rowGap = detail === 'cells' ? Math.max(1, Math.round(vr)) : 0;
  let pocTop = Number.NaN;
  let pocBot = Number.NaN;
  let vaTop = Number.NaN;
  let vaBot = Number.NaN;
  let maxAbsDelta = 0;
  if (o.fpStyle === 'delta' || wide) for (let r = 0; r < rows.n; r++) maxAbsDelta = Math.max(maxAbsDelta, Math.abs(rows.buy[r] - rows.sell[r]));

  for (let r = 0; r < rows.n; r++) {
    const pLo = (rows.lo + r) * rows.step - halfTick;
    const yTop = Math.round(toY(pLo + rows.step));
    const yBot = Math.round(toY(pLo));
    if (yBot < 0 || yTop > H || Number.isNaN(yTop)) continue;
    if (r === rows.poc) {
      pocTop = yTop;
      pocBot = yBot;
    }
    if (r === rows.vaHi) vaTop = yTop;
    if (r === rows.vaLo) vaBot = yBot;
    const vol = rows.vol[r];
    if (vol <= 0) continue;
    const h = Math.max(1, yBot - yTop - rowGap);
    const buy = rows.buy[r];
    const sell = rows.sell[r];
    if (detail === 'profile') drawProfileRow(ctx, ax0, aw, yTop, h, buy, sell, rows, r, o.fpStyle);
    else drawCellRow(ctx, cx0, cw, yTop, h, buy, sell, rows, r, o.fpStyle, maxAbsDelta, vr, fonts);
    if (wide) {
      // Delta rośnie od komórek w lewo, wolumen od komórek w prawo
      const dlt = buy - sell;
      const dl = maxAbsDelta > 0 ? Math.max(1, Math.round((side * Math.abs(dlt)) / maxAbsDelta)) : 0;
      ctx.fillStyle = dlt >= 0 ? BUY_BAR[LEVELS - 4] : SELL_BAR[LEVELS - 4];
      if (dlt !== 0) ctx.fillRect(ax0 + side - dl, yTop, dl, h);
      ctx.fillStyle = r === rows.poc ? PRO.profilePoc : PRO.profile;
      ctx.fillRect(ax0 + aw - side, yTop, Math.max(1, Math.round((side * vol) / rows.maxVol)), h);
    }
  }

  // POC w ramce, value area przy prawej krawędzi
  const lw = Math.max(1, Math.round(hr));
  if (!Number.isNaN(pocTop)) {
    ctx.strokeStyle = PRO.poc;
    ctx.lineWidth = lw;
    ctx.strokeRect(cx0 + lw / 2, pocTop + lw / 2, cw - lw, Math.max(1, pocBot - pocTop - lw));
  }
  if (!Number.isNaN(vaTop) && !Number.isNaN(vaBot) && detail === 'cells') {
    ctx.fillStyle = PRO.va;
    ctx.fillRect(x1 + lw, vaTop, Math.max(1, Math.round(2 * hr)), Math.max(1, vaBot - vaTop));
  }

  // Strefy „stacked”: pionowy pasek po stronie przewagi (kupno — prawa krawędź, sprzedaż — lewa)
  if (o.stackedMin > 1) {
    const bw = Math.max(2, Math.round(2 * hr));
    for (const run of stackedRuns(rows.imb, rows.n, o.stackedMin)) {
      const yTop = Math.round(toY((rows.lo + run.to + 1) * rows.step - halfTick));
      const yBot = Math.round(toY((rows.lo + run.from) * rows.step - halfTick));
      ctx.fillStyle = run.side === 1 ? PRO.buyInk : PRO.sellInk;
      ctx.fillRect(run.side === 1 ? cx0 + cw - bw : cx0, yTop, bw, Math.max(1, yBot - yTop));
    }
  }

  if (dim) {
    ctx.globalAlpha = 1;
    // Znacznik niepełnej taśmy nad szczytem świecy
    const yh = toY(d.high);
    if (!Number.isNaN(yh)) {
      ctx.fillStyle = PRO.partial;
      ctx.fillRect(ax0, Math.round(yh - 8 * vr), aw, Math.max(1, Math.round(2 * vr)));
    }
  }
}

/** Profil wolumenu w świecy: długość = wolumen wiersza względem maksimum świecy. */
function drawProfileRow(
  ctx: CanvasRenderingContext2D,
  x: number,
  w: number,
  y: number,
  h: number,
  buy: number,
  sell: number,
  rows: FootprintRows,
  r: number,
  style: FootprintStyle
): void {
  const vol = buy + sell;
  const len = Math.max(1, Math.round((w * vol) / rows.maxVol));
  if (style === 'bidask') {
    const ls = Math.round((len * sell) / vol);
    ctx.fillStyle = SELL_BAR[LEVELS - 4];
    ctx.fillRect(x, y, ls, h);
    ctx.fillStyle = BUY_BAR[LEVELS - 4];
    ctx.fillRect(x + ls, y, len - ls, h);
  } else if (style === 'delta') {
    const dlt = buy - sell;
    ctx.fillStyle = (dlt >= 0 ? BUY_BAR : SELL_BAR)[lvl(Math.abs(dlt) / vol)];
    ctx.fillRect(x, y, len, h);
  } else {
    ctx.fillStyle = r === rows.poc ? PRO.profilePoc : PRO.profile;
    ctx.fillRect(x, y, len, h);
  }
}

/** Komórka z liczbami: sprzedaż × kupno (tło wg przewagi strony), delta albo wolumen wiersza. */
function drawCellRow(
  ctx: CanvasRenderingContext2D,
  x: number,
  w: number,
  y: number,
  h: number,
  buy: number,
  sell: number,
  rows: FootprintRows,
  r: number,
  style: FootprintStyle,
  maxAbsDelta: number,
  vr: number,
  fonts: Fonts
): void {
  const ym = y + h / 2;
  const pad = Math.round(4 * vr);
  const imb = rows.imb[r];
  if (style === 'bidask') {
    const mid = x + Math.round(w / 2);
    ctx.fillStyle = SELL_BG[lvl(sell / rows.maxSide)];
    ctx.fillRect(x, y, mid - x - 1, h);
    ctx.fillStyle = BUY_BG[lvl(buy / rows.maxSide)];
    ctx.fillRect(mid, y, x + w - mid, h);
    // Nierównowaga: kolor strony przewagi i pogrubienie (drugi kanał obok koloru)
    ctx.textAlign = 'right';
    ctx.font = imb & IMB_SELL ? fonts.bold : fonts.normal;
    ctx.fillStyle = imb & IMB_SELL ? PRO.sellInk : sell > 0 ? PRO.ink1 : PRO.ink3;
    ctx.fillText(sell > 0 ? fmtVol(sell) : '0', mid - pad, ym);
    ctx.textAlign = 'left';
    ctx.font = imb & IMB_BUY ? fonts.bold : fonts.normal;
    ctx.fillStyle = imb & IMB_BUY ? PRO.buyInk : buy > 0 ? PRO.ink1 : PRO.ink3;
    ctx.fillText(buy > 0 ? fmtVol(buy) : '0', mid + pad, ym);
    return;
  }
  ctx.font = fonts.normal;
  const vol = buy + sell;
  if (style === 'delta') {
    const dlt = buy - sell;
    ctx.fillStyle = (dlt >= 0 ? BUY_BG : SELL_BG)[lvl(maxAbsDelta > 0 ? Math.abs(dlt) / maxAbsDelta : 0)];
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = PRO.ink1;
    ctx.textAlign = 'center';
    ctx.fillText(dlt === 0 ? '0' : `${dlt > 0 ? '+' : '−'}${fmtVol(Math.abs(dlt))}`, x + w / 2, ym);
  } else {
    ctx.fillStyle = VOL_BG[lvl(vol / rows.maxVol)];
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = r === rows.poc ? PRO.ink1 : PRO.ink2;
    ctx.textAlign = 'center';
    ctx.fillText(fmtVol(vol), x + w / 2, ym);
  }
  // Nierównowaga w stylach jednokolumnowych: znacznik przy krawędzi strony przewagi
  if (imb) {
    const mw = Math.max(2, Math.round(2 * vr));
    if (imb & IMB_BUY) {
      ctx.fillStyle = PRO.buyInk;
      ctx.fillRect(x + w - mw, y, mw, h);
    }
    if (imb & IMB_SELL) {
      ctx.fillStyle = PRO.sellInk;
      ctx.fillRect(x, y, mw, h);
    }
  }
}
