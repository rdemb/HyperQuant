import type { IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, Logical, PrimitiveHoveredItem, SeriesAttachedParameter, Time } from 'lightweight-charts';
import { fmtVol } from '../../orderflow/footprint';
import { fmtSignedVol } from '../../orderflow/renderer';
import { type BarStat, type StatGroup, STAT_GROUPS, type StatKey, VENUE_GROUPS } from '../core/stats';
import { type CloseBox, closeHit, drawClose, inBox } from './paneLegend';
import { MONO, PRO, rgba } from './theme';
import { tr } from '../../../i18n';
import { numLang } from '../../../ui/format';

/**
 * Tablica liczb we własnym panelu pod wykresem: kolumna na świecę, wiersz na miarę, tło komórki nasycone wg wartości
 * względem widocznych świec (kupno / wzrost w kolorze kupna, sprzedaż / spadek w kolorze sprzedaży, wielkości bez
 * znaku w kolorze wolumenu). Wiersze w grupach (Hyperliquid, taśma, Kto handluje, Binance, Bybit); z grupą giełdy albo
 * Kto handluje każda grupa ma nagłówek z nazwą. Liczby, gdy świeca jest dość szeroka; nazwy wierszy w stałej kolumnie z lewej.
 */

export interface StatRowDef {
  key: StatKey;
  group: StatGroup;
  label: string;
  signed: boolean;
  fmt: (v: number) => string;
  /** Stała skala nasycenia (|wartość| = pełny kolor) zamiast percentyla widocznych świec. */
  scale?: number;
}

const fmtCount = (v: number) => (v >= 1000 ? numLang(`${(v / 1000).toFixed(1)}K`) : String(Math.round(v)));
// % na 8 h bez znaku „+” i „%” (mieści się w kolumnie); stała skala — stały funding nie daje pełnego koloru
const fmtFunding = (v: number) => `${v < 0 ? '−' : ''}${numLang(Math.abs(v).toFixed(4))}`;
const FUNDING_SCALE = 0.05;

export const STAT_ROWS: readonly StatRowDef[] = [
  { key: 'vol', group: 'hl', label: tr('Wolumen', 'Volume'), signed: false, fmt: fmtVol },
  { key: 'delta', group: 'hl', label: 'Delta', signed: true, fmt: fmtSignedVol },
  { key: 'doi', group: 'hl', label: 'ΔOI', signed: true, fmt: fmtSignedVol },
  { key: 'funding', group: 'hl', label: 'Funding 8 h', signed: true, fmt: fmtFunding, scale: FUNDING_SCALE },
  { key: 'deltaPct', group: 'tape', label: 'Delta %', signed: true, fmt: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(0)}%` },
  { key: 'maxDelta', group: 'tape', label: 'Max Δ', signed: true, fmt: fmtSignedVol },
  { key: 'minDelta', group: 'tape', label: 'Min Δ', signed: true, fmt: fmtSignedVol },
  { key: 'trades', group: 'tape', label: tr('Transakcje', 'Trades'), signed: false, fmt: fmtCount },
  { key: 'speed', group: 'tape', label: tr('Tempo /s', 'Speed /s'), signed: false, fmt: (v) => (v >= 10 ? v.toFixed(0) : numLang(v.toFixed(1))) },
  { key: 'bigDelta', group: 'who', label: tr('Delta dużych', 'Large delta'), signed: true, fmt: fmtSignedVol },
  { key: 'restDelta', group: 'who', label: tr('Delta reszty', 'Rest delta'), signed: true, fmt: fmtSignedVol },
  { key: 'bigShare', group: 'who', label: tr('Udział dużych', 'Large share'), signed: false, fmt: (v) => `${v.toFixed(0)}%`, scale: 100 },
  { key: 'bnDelta', group: 'binance', label: 'Delta perp', signed: true, fmt: fmtSignedVol },
  { key: 'bnSpotDelta', group: 'binance', label: 'Delta spot', signed: true, fmt: fmtSignedVol },
  { key: 'bnDoi', group: 'binance', label: 'ΔOI', signed: true, fmt: fmtSignedVol },
  { key: 'bnFunding', group: 'binance', label: 'Funding 8 h', signed: true, fmt: fmtFunding, scale: FUNDING_SCALE },
  { key: 'byDelta', group: 'bybit', label: 'Delta', signed: true, fmt: fmtSignedVol },
  { key: 'byDoi', group: 'bybit', label: 'ΔOI', signed: true, fmt: fmtSignedVol },
];

/** Nazwa grupy (nagłówek i przełącznik) i kolor jej giełdy. */
export const STAT_GROUP_INFO: Record<StatGroup, { label: string; short: string; color: string }> = {
  hl: { label: 'Hyperliquid', short: 'Hyperliquid', color: PRO.venueHl },
  tape: { label: tr('Hyperliquid · taśma', 'Hyperliquid · tape'), short: tr('Taśma', 'Tape'), color: PRO.venueHl },
  who: { label: tr('Kto handluje', 'Who is trading'), short: tr('Kto handluje', 'Who is trading'), color: PRO.players },
  binance: { label: 'Binance', short: 'Binance', color: PRO.venueBinance },
  bybit: { label: 'Bybit', short: 'Bybit', color: PRO.venueBybit },
};

/** Linia tablicy: nagłówek grupy (`row` = null) albo wiersz miary. */
export interface TableLine {
  group: StatGroup;
  row: StatRowDef | null;
}

/** Linie tablicy dla włączonych grup; nagłówki grup tylko z grupą giełdy albo Kto handluje (inaczej nazwy są jednoznaczne). */
export function tableLines(groups: readonly StatGroup[]): TableLine[] {
  const heads = groups.some((g) => g === 'who' || VENUE_GROUPS.includes(g));
  const out: TableLine[] = [];
  for (const g of STAT_GROUPS) {
    if (!groups.includes(g)) continue;
    if (heads) out.push({ group: g, row: null });
    for (const row of STAT_ROWS) if (row.group === g) out.push({ group: g, row });
  }
  return out;
}

/** Wysokość wiersza i nagłówka grupy (px) oraz wolne miejsce pod tabelą na logo TradingView (px; panel jest najniższy). */
export const STAT_ROW_PX = 15;
export const STAT_HEAD_PX = 12;
export const STAT_PAD_PX = 32;

/** Wysokość panelu tablicy (px) dla włączonych grup. */
export function tableHeight(groups: readonly StatGroup[]): number {
  return tableLines(groups).reduce((h, l) => h + (l.row ? STAT_ROW_PX : STAT_HEAD_PX), STAT_PAD_PX);
}

/** Liczby od takiej szerokości świecy (px). */
const TEXT_MIN_SPACING = 34;
/** Szerokość świecy po włączeniu tablicy (px): liczby widać od razu, bez zbliżania wykresu. */
export const STATS_BAR_SPACING = 50;
const LABEL_W = 96;
/** Nasycenie: |wartość| przy percentylu 90 widocznych świec = pełny kolor. */
const NORM_Q = 0.9;

const C = {
  pos: PRO.buyInk,
  neg: PRO.sellInk,
  size: PRO.volBar,
  text: '#eef0f2',
  dim: PRO.ink3,
  grid: rgba(PRO.ink3, 0.18),
  hover: rgba('#ffffff', 0.55),
  label: PRO.ink2,
  partial: PRO.partial,
};

export class StatsTable implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private stats: readonly BarStat[] = [];
  private lines: TableLine[] = tableLines(['hl', 'tape']);
  private hover = -1;
  private close: CloseBox | null = null;
  private readonly view: IPrimitivePaneView;

  constructor() {
    const renderer: IPrimitivePaneRenderer = { draw: (target) => target.useMediaCoordinateSpace(({ context, mediaSize }) => this.draw(context, mediaSize.width, mediaSize.height)) };
    this.view = { zOrder: () => 'top', renderer: () => renderer };
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.chart = p.chart;
    this.requestUpdate = p.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  /** Statystyki w kolejności świec wykresu (indeks = indeks logiczny świecy). */
  setStats(stats: readonly BarStat[]): void {
    this.stats = stats;
    this.requestUpdate?.();
  }

  /** Włączone grupy wierszy. */
  setGroups(groups: readonly StatGroup[]): void {
    this.lines = tableLines(groups);
    this.requestUpdate?.();
  }

  setHover(i: number): void {
    if (i === this.hover) return;
    this.hover = i;
    this.requestUpdate?.();
  }

  private draw(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const chart = this.chart;
    const stats = this.stats;
    const lines = this.lines;
    this.close = null;
    if (!chart || stats.length === 0 || lines.length === 0 || !(H > 0)) return;
    const ts = chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    const xa = ts.logicalToCoordinate(0 as Logical);
    const xb = ts.logicalToCoordinate(1 as Logical);
    if (!range || xa === null || xb === null || !(xb > xa)) return;
    const sp = xb - xa;
    const from = Math.max(0, Math.floor(range.from));
    const to = Math.min(stats.length - 1, Math.ceil(range.to));
    // Wiersze i nagłówki rozciągnięte na wysokość panelu w stałej proporcji
    const k = Math.max(1, H - STAT_PAD_PX) / lines.reduce((h, l) => h + (l.row ? STAT_ROW_PX : STAT_HEAD_PX), 0);
    const rh = STAT_ROW_PX * k;
    const ys: number[] = [];
    let TH = 0;
    for (const l of lines) {
      ys.push(TH);
      TH += l.row ? rh : STAT_HEAD_PX * k;
    }
    const text = sp >= TEXT_MIN_SPACING && rh >= 11;

    // Normy wierszy z widocznych świec
    const norm = lines.map(({ row }) => {
      if (!row) return 0;
      if (row.scale) return row.scale;
      const v: number[] = [];
      for (let i = from; i <= to; i++) {
        const x = stats[i][row.key];
        if (x !== null && Number.isFinite(x)) v.push(Math.abs(x));
      }
      v.sort((a, b) => a - b);
      return v.length > 0 ? v[Math.min(v.length - 1, Math.floor(v.length * NORM_Q))] : 0;
    });

    ctx.font = `500 10px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cw = Math.max(1, sp - (sp >= 6 ? 1 : 0));
    for (let i = from; i <= to; i++) {
      const cx = xa + i * sp;
      if (cx + sp / 2 < LABEL_W || cx - sp / 2 > W) continue;
      const s = stats[i];
      for (let r = 0; r < lines.length; r++) {
        const row = lines[r].row;
        if (!row) continue;
        const v = s[row.key];
        const y = ys[r];
        if (v === null || !Number.isFinite(v)) {
          if (text && cx - 4 >= LABEL_W) {
            ctx.fillStyle = C.dim;
            ctx.fillText('—', cx, y + rh / 2);
          }
          continue;
        }
        const k = norm[r] > 0 ? Math.min(1, Math.abs(v) / norm[r]) : 0;
        ctx.fillStyle = rgba(row.signed ? (v >= 0 ? C.pos : C.neg) : C.size, 0.08 + 0.5 * k);
        ctx.fillRect(cx - cw / 2, y + 0.5, cw, rh - 1);
        if (text) {
          // Liczba tylko w całości: mieści się w kolumnie i nie wchodzi pod kolumnę nazw
          const t = row.fmt(v);
          const tw = ctx.measureText(t).width;
          if (tw <= sp - 4 && cx - tw / 2 >= LABEL_W + 2) {
            ctx.fillStyle = C.text;
            ctx.fillText(t, cx, y + rh / 2);
          }
        }
      }
    }
    if (this.hover >= from && this.hover <= to) {
      ctx.strokeStyle = C.hover;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(xa + this.hover * sp - sp / 2) + 0.5, 0.5, Math.max(1, Math.round(sp) - 1), TH - 1);
    }
    // Siatka wierszy, kolumna nazw i nagłówki grup na całą szerokość
    ctx.fillStyle = C.grid;
    for (let r = 1; r <= lines.length; r++) ctx.fillRect(0, Math.round(r < lines.length ? ys[r] : TH), W, 1);
    ctx.fillStyle = rgba(PRO.bg, 0.94);
    ctx.fillRect(0, 0, LABEL_W, TH);
    for (let r = 0; r < lines.length; r++) if (!lines[r].row) ctx.fillRect(LABEL_W, ys[r], W - LABEL_W, STAT_HEAD_PX * k);
    // Świeca częściowa (znacznik jak nad świecą footprintu): liczby z taśmy tylko z jej części
    ctx.fillStyle = C.partial;
    for (let i = from; i <= to; i++) {
      const x0 = Math.max(LABEL_W, xa + i * sp - cw / 2);
      const x1 = Math.min(W, xa + i * sp + cw / 2);
      if (stats[i].partial && x1 > x0) ctx.fillRect(x0, 0, x1 - x0, 2);
    }
    // Niski panel (np. układ 2 × 2): same kolory, bez nachodzących na siebie nazw
    if (rh < 9) return;
    ctx.textAlign = 'left';
    let headW = 0;
    for (let r = 0; r < lines.length; r++) {
      const { row, group } = lines[r];
      if (row) {
        ctx.font = `500 11px ${MONO}`;
        ctx.fillStyle = C.label;
        ctx.fillText(row.label, 8, ys[r] + rh / 2);
      } else {
        const g = STAT_GROUP_INFO[group];
        const t = g.label.toUpperCase();
        ctx.font = `600 10px ${MONO}`;
        ctx.fillStyle = g.color;
        ctx.fillText(t, 8, ys[r] + (STAT_HEAD_PX * k) / 2 + 0.5);
        if (r === 0) headW = ctx.measureText(t).width;
      }
    }
    // Krzyżyk ukrycia tabeli w pierwszej linii: w kolumnie nazw albo za nazwą pierwszej grupy
    const h0 = lines[0].row ? rh : STAT_HEAD_PX * k;
    this.close = { x: lines[0].row ? LABEL_W - 16 : 8 + headW + 4, y: Math.max(0, h0 / 2 - 8), size: 16 };
    drawClose(ctx, this.close);
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    return inBox(this.close, x, y) ? closeHit('showStats') : null;
  }
}
