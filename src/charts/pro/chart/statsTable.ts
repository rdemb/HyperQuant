import type { IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, Logical, SeriesAttachedParameter, Time } from 'lightweight-charts';
import { fmtVol } from '../../orderflow/footprint';
import { fmtSignedVol } from '../../orderflow/renderer';
import type { BarStat, StatKey } from '../core/stats';
import { MONO, PRO, rgba } from './theme';

/**
 * Tabela statystyk świec we własnym panelu pod wykresem: kolumna na świecę, wiersz na statystykę, tło komórki
 * nasycone wg wartości względem widocznych świec (kupno / wzrost zielone, sprzedaż / spadek fioletowe, wielkości
 * bez znaku pomarańczowe). Liczby, gdy świeca jest dość szeroka; nazwy wierszy w stałej kolumnie z lewej.
 */

export const STAT_ROWS: { key: StatKey; label: string; signed: boolean; fmt: (v: number) => string }[] = [
  { key: 'vol', label: 'Wolumen', signed: false, fmt: fmtVol },
  { key: 'delta', label: 'Delta', signed: true, fmt: fmtSignedVol },
  { key: 'deltaPct', label: 'Delta %', signed: true, fmt: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(0)}%` },
  { key: 'maxDelta', label: 'Max Δ', signed: true, fmt: fmtSignedVol },
  { key: 'minDelta', label: 'Min Δ', signed: true, fmt: fmtSignedVol },
  { key: 'trades', label: 'Transakcje', signed: false, fmt: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(Math.round(v))) },
  { key: 'speed', label: 'Tempo /s', signed: false, fmt: (v) => (v >= 10 ? v.toFixed(0) : v.toFixed(1)) },
  { key: 'doi', label: 'ΔOI', signed: true, fmt: fmtSignedVol },
  { key: 'funding', label: 'Funding', signed: true, fmt: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%` },
];

/** Wysokość wiersza (px) i wolne miejsce pod tabelą na logo TradingView (px; panel jest najniższy). */
export const STAT_ROW_PX = 15;
export const STAT_PAD_PX = 26;
/** Liczby od takiej szerokości świecy (px). */
const TEXT_MIN_SPACING = 34;
const LABEL_W = 74;
/** Nasycenie: |wartość| przy percentylu 90 widocznych świec = pełny kolor. */
const NORM_Q = 0.9;

const C = {
  pos: '#10ff21',
  neg: '#8a2be2',
  size: '#d08a10',
  text: '#eef0f2',
  dim: PRO.ink3,
  grid: rgba(PRO.ink3, 0.18),
  hover: rgba('#ffffff', 0.55),
  label: PRO.ink2,
};

export class StatsTable implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private stats: readonly BarStat[] = [];
  private hover = -1;
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

  setHover(i: number): void {
    if (i === this.hover) return;
    this.hover = i;
    this.requestUpdate?.();
  }

  private draw(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const chart = this.chart;
    const stats = this.stats;
    if (!chart || stats.length === 0 || !(H > 0)) return;
    const ts = chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    const xa = ts.logicalToCoordinate(0 as Logical);
    const xb = ts.logicalToCoordinate(1 as Logical);
    if (!range || xa === null || xb === null || !(xb > xa)) return;
    const sp = xb - xa;
    const from = Math.max(0, Math.floor(range.from));
    const to = Math.min(stats.length - 1, Math.ceil(range.to));
    const rows = STAT_ROWS.length;
    const rh = Math.max(1, H - STAT_PAD_PX) / rows;
    const TH = rh * rows;
    const text = sp >= TEXT_MIN_SPACING && rh >= 11;

    // Normy wierszy z widocznych świec
    const norm = STAT_ROWS.map((r) => {
      const v: number[] = [];
      for (let i = from; i <= to; i++) {
        const x = stats[i][r.key];
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
      for (let r = 0; r < rows; r++) {
        const row = STAT_ROWS[r];
        const v = s[row.key];
        const y = r * rh;
        if (v === null || !Number.isFinite(v)) {
          if (text) {
            ctx.fillStyle = C.dim;
            ctx.fillText('—', cx, y + rh / 2);
          }
          continue;
        }
        const k = norm[r] > 0 ? Math.min(1, Math.abs(v) / norm[r]) : 0;
        ctx.fillStyle = rgba(row.signed ? (v >= 0 ? C.pos : C.neg) : C.size, 0.08 + 0.5 * k);
        ctx.fillRect(cx - cw / 2, y + 0.5, cw, rh - 1);
        if (text) {
          ctx.fillStyle = C.text;
          ctx.fillText(row.fmt(v), cx, y + rh / 2);
        }
      }
    }
    if (this.hover >= from && this.hover <= to) {
      ctx.strokeStyle = C.hover;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(xa + this.hover * sp - sp / 2) + 0.5, 0.5, Math.max(1, Math.round(sp) - 1), TH - 1);
    }
    // Siatka wierszy i kolumna nazw
    ctx.fillStyle = C.grid;
    for (let r = 1; r <= rows; r++) ctx.fillRect(0, Math.round(r * rh), W, 1);
    ctx.fillStyle = rgba(PRO.bg, 0.94);
    ctx.fillRect(0, 0, LABEL_W, TH);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.label;
    for (let r = 0; r < rows; r++) ctx.fillText(STAT_ROWS[r].label, 8, r * rh + rh / 2);
  }
}
