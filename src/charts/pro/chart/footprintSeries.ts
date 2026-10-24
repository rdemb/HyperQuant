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
import { IMB_BUY, IMB_SELL } from '../../orderflow/footprint';
import { FootprintBar, FootprintRows, aggregateRows, hlTick, stackedRuns } from '../core/footprintBar';
import type { ProBar } from '../store/proStore';
import {
  CELL_MIN_ROW_PX,
  Detail,
  FootprintStyle,
  PROFILE_MIN_ROW_PX,
  autoRowStep,
  cellAreaPx,
  cellFontPx,
  CELL_MIN_SPACING,
  fmtCell,
  pickDetail,
} from './layout';
import { MONO, PRO, luminance, mixRamp, rgba } from './theme';

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
// Kafle komórek: od szarości przy małym wolumenie do nasyconego koloru strony przy największym w świecy
const ASK_TILE = mixRamp(PRO.fpAskRamp, LEVELS);
const BID_TILE = mixRamp(PRO.fpBidRamp, LEVELS);
const POS_TILE = mixRamp(PRO.fpDeltaPosRamp, LEVELS);
const NEG_TILE = mixRamp(PRO.fpDeltaNegRamp, LEVELS);
// Liczby ciemne na jasnym kaflu, jasne na ciemnym (próg równego kontrastu obu wariantów)
const inkFor = (tiles: string[]) => tiles.map((c) => (luminance(c) > 0.18 ? PRO.fpText : PRO.fpTextLight));
const ASK_INK = inkFor(ASK_TILE);
const BID_INK = inkFor(BID_TILE);
const ramp = (hex: string, a0: number, a1: number) => Array.from({ length: LEVELS + 1 }, (_, i) => rgba(hex, a0 + ((a1 - a0) * i) / LEVELS));
const DPOS_BAR = ramp(PRO.deltaPosBar, 0.55, 1);
const DNEG_BAR = ramp(PRO.deltaNegBar, 0.55, 1);
const VOL_BAR = rgba(PRO.volBar, 0.62);
const TILE_EDGE = 'rgba(255,255,255,0.12)';
const lvl = (x: number) => (x >= 1 ? LEVELS : x > 0 ? Math.round(x * LEVELS) : 0);
/** Liczby w komórkach: bezszeryfowe, węższe od czcionki o stałej szerokości. */
const CELL_FONT = '"Plus Jakarta Sans", -apple-system, "Segoe UI", sans-serif';

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
      const wantCells = spacing >= CELL_MIN_SPACING;
      step = o.rowStep > 0 ? Math.max(o.rowStep, tick) : autoRowStep(pxPerUsd, tick, wantCells ? CELL_MIN_ROW_PX : PROFILE_MIN_ROW_PX);
      detail = pickDetail(spacing, step * pxPerUsd);
    }
    this.frame = { detail, step };

    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }) => {
      const H = bitmapSize.height;
      const toY = (p: number) => {
        const y = priceToY(p);
        return y === null ? Number.NaN : y * vr;
      };
      // Czcionka mieści się i w wierszu, i w kolumnie (dwie kolumny bid i ask, w szerokiej świecy Bid × Ask węższe o kolumny boczne)
      const area = cellAreaPx(spacing);
      const colPx = (o.fpStyle === 'bidask' && area >= WIDE_MIN_PX ? area * 0.66 - 4 : area) / 2;
      const fontPx = Math.round(cellFontPx(step * pxPerUsd, colPx) * vr);
      const fonts = { normal: `500 ${fontPx}px ${CELL_FONT}`, bold: `700 ${fontPx}px ${CELL_FONT}`, outline: Math.max(2, Math.round(2.5 * vr)) };
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
        drawFootprint(ctx, item.x * hr, spacing * hr, d, fp, rows, detail, o, toY, hr, vr, H, fonts, fontPx);
      }
    });
  }
}

type ToY = (p: number) => number;

interface Fonts {
  normal: string;
  bold: string;
  /** Grubość obrysu liczb nierównowagi (px urządzenia). */
  outline: number;
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
  fonts: Fonts,
  fontPx: number
): void {
  const half = slot * 0.46;
  const x0 = Math.round(cx - half);
  const x1 = Math.round(cx + half);
  // Smukła świeca obok komórek (nie pod nimi): korpus ~4 px przy 48 px na świecę, 3 px odstępu
  const strip = Math.max(Math.round(3 * hr), Math.min(Math.round(6 * hr), Math.round(slot * 0.085)));
  const gap = Math.max(1, Math.round(3 * hr));
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
  // Liczby na słupkach bocznych tylko gdy mieszczą się cztery znaki
  const sideText = wide && side >= Math.round(fontPx * 0.6 * 4 + 4 * hr);

  const halfTick = fp.tick / 2;
  const rowGap = detail === 'cells' ? Math.max(1, Math.round(vr)) : 0;
  let pocTop = Number.NaN;
  let pocBot = Number.NaN;
  let vaTop = Number.NaN;
  let vaBot = Number.NaN;
  let maxAbsDelta = 0;
  if (o.fpStyle === 'delta' || wide) for (let r = 0; r < rows.n; r++) maxAbsDelta = Math.max(maxAbsDelta, Math.abs(rows.buy[r] - rows.sell[r]));

  // Kafle Bid × Ask leżą na ciemnej siatce: przerwy między wierszami mają kolor linii, nie tła
  if (detail === 'cells' && o.fpStyle === 'bidask') {
    const yTop = Math.round(toY((rows.lo + rows.n) * rows.step - halfTick));
    const yBot = Math.round(toY(rows.lo * rows.step - halfTick));
    if (Number.isFinite(yTop) && Number.isFinite(yBot)) {
      ctx.fillStyle = PRO.fpRowLine;
      ctx.fillRect(cx0, Math.max(0, yTop), cw, Math.min(H, yBot) - Math.max(0, yTop));
    }
  }

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
    else drawCellRow(ctx, cx0, cw, yTop, h, buy, sell, rows, r, o.fpStyle, maxAbsDelta, hr, vr, fonts);
    if (wide) {
      // Delta rośnie od komórek w lewo, wolumen od komórek w prawo
      const dlt = buy - sell;
      const dl = maxAbsDelta > 0 ? Math.max(1, Math.round((side * Math.abs(dlt)) / maxAbsDelta)) : 0;
      ctx.fillStyle = (dlt >= 0 ? DPOS_BAR : DNEG_BAR)[lvl(maxAbsDelta > 0 ? Math.abs(dlt) / maxAbsDelta : 0)];
      if (dlt !== 0) ctx.fillRect(ax0 + side - dl, yTop, dl, h);
      ctx.fillStyle = r === rows.poc ? PRO.volBar : VOL_BAR;
      ctx.fillRect(ax0 + aw - side, yTop, Math.max(1, Math.round((side * vol) / rows.maxVol)), h);
      if (sideText) {
        const ym = yTop + h / 2;
        const pad = Math.round(2 * hr);
        ctx.font = fonts.normal;
        ctx.fillStyle = PRO.ink1;
        ctx.textAlign = 'right';
        ctx.fillText(dlt === 0 ? '0' : `${dlt > 0 ? '+' : '−'}${fmtCell(Math.abs(dlt))}`, ax0 + side - pad, ym);
        ctx.textAlign = 'left';
        ctx.fillText(fmtCell(vol), ax0 + aw - side + pad, ym);
      }
    }
  }

  // POC w ramce, value area przy prawej krawędzi
  const lw = Math.max(1, Math.round(hr));
  if (!Number.isNaN(pocTop)) {
    ctx.strokeStyle = PRO.pocFrame;
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
      ctx.fillStyle = run.side === 1 ? PRO.imbBuy : PRO.imbSell;
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
    ctx.fillStyle = BID_TILE[LEVELS - 4];
    ctx.fillRect(x, y, ls, h);
    ctx.fillStyle = ASK_TILE[LEVELS - 4];
    ctx.fillRect(x + ls, y, len - ls, h);
  } else if (style === 'delta') {
    const dlt = buy - sell;
    ctx.fillStyle = (dlt >= 0 ? POS_TILE : NEG_TILE)[Math.max(4, lvl(Math.abs(dlt) / vol))];
    ctx.fillRect(x, y, len, h);
  } else {
    ctx.fillStyle = (buy >= sell ? ASK_TILE : BID_TILE)[Math.max(4, lvl(vol / rows.maxVol))];
    ctx.fillRect(x, y, len, h);
  }
}

/** Kafel komórki z jaśniejszą krawędzią górną i lewą (wypukłość jak w terminalach orderflow). */
function tile(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, hr: number, vr: number): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  if (h < 8 * vr || w < 8 * hr) return;
  ctx.fillStyle = TILE_EDGE;
  ctx.fillRect(x, y, w, Math.max(1, Math.round(vr)));
  ctx.fillRect(x, y, Math.max(1, Math.round(hr)), h);
}

/**
 * Komórka z liczbami (wyśrodkowanymi): sprzedaż | kupno na kaflach cieniowanych wolumenem strony,
 * delta wiersza (dodatnia w kolorze kupna, ujemna w kolorze sprzedaży) albo wolumen wiersza jako pasek od lewej.
 */
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
  hr: number,
  vr: number,
  fonts: Fonts
): void {
  const ym = y + h / 2;
  const imb = rows.imb[r];
  const mid = x + Math.round(w / 2);
  const sellImb = (imb & IMB_SELL) !== 0;
  const buyImb = (imb & IMB_BUY) !== 0;
  ctx.textAlign = 'center';
  if (style === 'bidask') {
    const ls = lvl(sell / rows.maxSide);
    const lb = lvl(buy / rows.maxSide);
    tile(ctx, x, y, mid - x, h, BID_TILE[ls], hr, vr);
    tile(ctx, mid, y, x + w - mid, h, ASK_TILE[lb], hr, vr);
    // Nierównowaga: rozjaśniony kolor strony, pogrubione
    drawNumber(ctx, fmtCell(sell), (x + mid) / 2, ym, sellImb ? PRO.imbSell : BID_INK[ls], sellImb, sellImb, fonts);
    drawNumber(ctx, fmtCell(buy), (mid + x + w) / 2, ym, buyImb ? PRO.imbBuy : ASK_INK[lb], buyImb, buyImb, fonts);
    return;
  }
  // Profil w świecy: pasek od lewej krawędzi (delta: długość ∝ |delta|, kolor znaku; wolumen: długość ∝ wolumen,
  // kolor strony przewagi), na nim jasne liczby bid i ask z ciemnym obrysem
  const dlt = buy - sell;
  const frac = style === 'delta' ? (maxAbsDelta > 0 ? Math.abs(dlt) / maxAbsDelta : 0) : (buy + sell) / rows.maxVol;
  const tiles = style === 'delta' ? (dlt >= 0 ? POS_TILE : NEG_TILE) : buy >= sell ? ASK_TILE : BID_TILE;
  tile(ctx, x, y, Math.max(1, Math.round(w * frac)), h, tiles[Math.max(4, lvl(frac))], hr, vr);
  drawNumber(ctx, fmtCell(sell), (x + mid) / 2, ym, sellImb ? PRO.imbSell : PRO.fpTextProfile, sellImb, true, fonts);
  drawNumber(ctx, fmtCell(buy), (mid + x + w) / 2, ym, buyImb ? PRO.imbBuy : PRO.fpTextProfile, buyImb, true, fonts);
}

/** Liczba w komórce; ciemny obrys (nierównowaga, jasne liczby profilu), żeby kolor nie ginął na jasnym kaflu. */
function drawNumber(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  bold: boolean,
  outline: boolean,
  fonts: Fonts
): void {
  ctx.font = bold ? fonts.bold : fonts.normal;
  if (outline) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = fonts.outline;
    ctx.strokeStyle = PRO.fpText;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}
