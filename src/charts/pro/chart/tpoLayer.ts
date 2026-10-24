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
import { hlTick } from '../core/footprintBar';
import { nakedPocs } from '../core/indicators';
import { DAY } from '../core/time';
import { TPO_LETTERS, TpoProfile, tpoInterval, tpoPocPx, tpoProfiles, tpoSingles } from '../core/tpo';
import type { ProBar } from '../store/proStore';
import { autoRowStep } from './layout';
import { logicalOfTime } from './overlay';
import { MONO, PRO, rgba } from './theme';

/**
 * Profil czasowy (TPO) każdej doby na wykresie ceny: litery 30-minutowych okresów od początku doby w prawo
 * (przy małym zbliżeniu kolorowe kratki), kolor litery od pory dnia. POC dnia linią przez całą dobę, nagi POC
 * do prawej krawędzi, z lewej pasek value area i initial balance, z prawej znacznik pojedynczych wydruków i ogonów.
 */

/** Docelowa wysokość wiersza TPO (px) — litery muszą być czytelne. */
const TPO_ROW_PX = 11;
/** Profil zajmuje najwyżej taki ułamek szerokości doby. */
const DAY_FILL = 0.92;
const NAKED_MAX = 6;
/** Poniżej tej wielkości czcionki litery zastępują kratki. */
const MIN_FONT_PX = 7;

const T = {
  poc: PRO.profilePoc,
  nakedPoc: PRO.nakedPoc,
  va: rgba(PRO.ink2, 0.7),
  ib: PRO.svwap,
  single: PRO.warn,
  tail: rgba(PRO.ink2, 0.55),
  outAlpha: 0.42,
  // Tło pod literami przygasza świece pod profilem, żeby litery były czytelne
  rowBg: rgba(PRO.bg, 0.8),
};

/** Kolor okresu: od chłodnego (noc UTC) przez zielony i żółty do czerwonego (koniec doby). */
const periodColor = (p: number): string => `hsl(${Math.round(205 - (p / (TPO_LETTERS.length - 1)) * 205)} 70% 62%)`;
const COLORS = Array.from({ length: TPO_LETTERS.length }, (_, p) => periodColor(p));

interface Cell {
  x: number;
  y: number;
  p: number;
  va: boolean;
  poc: boolean;
}

interface Mark {
  x: number;
  y0: number;
  y1: number;
  color: string;
  w: number;
}

interface Line {
  x0: number;
  x1: number;
  y: number;
  color: string;
  dash: boolean;
}

export class TpoLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;

  private on: boolean;
  private bars: readonly ProBar[] = [];
  private ms = 60_000;
  private rightInset = 0;
  private cache: { bars: readonly ProBar[]; step: number; list: TpoProfile[] } | null = null;

  private rowBgs: { x: number; y: number; w: number }[] = [];
  private cells: Cell[] = [];
  private marks: Mark[] = [];
  private lines: Line[] = [];
  private cw = 0;
  private rh = 0;
  private font = 0;
  private readonly views: readonly IPrimitivePaneView[];

  constructor(on: boolean) {
    this.on = on;
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          if (this.cells.length === 0 && this.lines.length === 0) return;
          ctx.fillStyle = T.rowBg;
          for (const b of this.rowBgs) ctx.fillRect(b.x, b.y, b.w, this.rh);
          const letters = this.font >= MIN_FONT_PX;
          if (letters) {
            ctx.font = `600 ${this.font}px ${MONO}`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
          }
          for (const c of this.cells) {
            ctx.globalAlpha = c.va ? 1 : T.outAlpha;
            ctx.fillStyle = c.poc ? PRO.pocFrame : COLORS[c.p];
            if (letters) ctx.fillText(TPO_LETTERS[c.p], c.x, c.y + this.rh / 2);
            else ctx.fillRect(c.x, c.y, Math.max(1, this.cw - 1), Math.max(1, this.rh - 1));
          }
          ctx.globalAlpha = 1;
          ctx.lineWidth = 1;
          for (const l of this.lines) {
            ctx.strokeStyle = l.color;
            ctx.setLineDash(l.dash ? [4, 3] : []);
            ctx.beginPath();
            const y = Math.round(l.y) + 0.5;
            ctx.moveTo(l.x0, y);
            ctx.lineTo(l.x1, y);
            ctx.stroke();
          }
          ctx.setLineDash([]);
          for (const m of this.marks) {
            ctx.fillStyle = m.color;
            ctx.fillRect(m.x, Math.min(m.y0, m.y1), m.w, Math.max(1, Math.abs(m.y1 - m.y0)));
          }
        }),
    };
    this.views = [{ zOrder: () => 'normal', renderer: () => renderer }];
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

  setOn(on: boolean): void {
    this.on = on;
    this.requestUpdate?.();
  }

  setRightInset(px: number): void {
    this.rightInset = px;
    this.requestUpdate?.();
  }

  setData(bars: readonly ProBar[], ms: number): void {
    this.bars = bars;
    this.ms = ms;
    this.requestUpdate?.();
  }

  updateAllViews(): void {
    this.rowBgs = [];
    this.cells = [];
    this.marks = [];
    this.lines = [];
    const chart = this.chart;
    const series = this.series;
    const bars = this.bars;
    if (!this.on || !chart || !series || bars.length === 0 || !tpoInterval(this.ms)) return;
    const ts = chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    const xa = ts.logicalToCoordinate(0 as Logical);
    const xb = ts.logicalToCoordinate(1 as Logical);
    if (!range || xa === null || xb === null || !(xb > xa)) return;
    const sp = xb - xa;
    const right = chart.paneSize(0).width - this.rightInset;
    const ref = bars[bars.length - 1].candle.c;
    const y = (p: number) => series.priceToCoordinate(p);
    const ya = y(ref);
    const yb = y(ref + 100);
    if (ya === null || yb === null) return;
    const pxPerUsd = Math.abs(ya - yb) / 100;
    const step = pxPerUsd > 0 ? autoRowStep(pxPerUsd, hlTick(ref), TPO_ROW_PX) : 0;
    if (!(step > 0)) return;
    if (!this.cache || this.cache.bars !== bars || this.cache.step !== step) this.cache = { bars, step, list: tpoProfiles(bars, step) };
    const list = this.cache.list;
    const rh = step * pxPerUsd;
    // Lewa krawędź świecy o początku t (także poza danymi)
    const x = (t: number) => xa + (logicalOfTime(bars, t, this.ms) - 0.5) * sp;
    const vf = bars[Math.max(0, Math.floor(range.from))]?.t ?? bars[0].t;
    const vt = bars[Math.min(bars.length - 1, Math.ceil(range.to))]?.t ?? bars[bars.length - 1].t;

    // Wspólna szerokość litery dla widocznych dób, żeby profile dało się porównać
    let maxCount = 1;
    for (const p of list) {
      if (p.day + DAY <= vf || p.day > vt) continue;
      for (const r of p.rows) maxCount = Math.max(maxCount, r.length);
    }
    const dayW = DAY / this.ms * sp;
    let font = Math.min(12, Math.floor(rh) - 1);
    let cw = Math.min(font * 0.62 + 2, (dayW * DAY_FILL) / maxCount);
    if (cw < font * 0.62 + 1) font = Math.floor((cw - 1) / 0.62);
    if (cw < 1) cw = 1;
    this.cw = cw;
    this.rh = rh;
    this.font = font;

    const naked = nakedPocs(bars, list.map((p) => ({ to: p.to, complete: p.complete, pocPx: tpoPocPx(p) })));
    let shownNaked = 0;
    for (let k = list.length - 1; k >= 0; k--) {
      const p = list[k];
      const x0 = x(p.day);
      const x1 = Math.min(right, x(p.day + DAY));
      const yPoc = y(tpoPocPx(p));
      if (naked[k] && shownNaked < NAKED_MAX && yPoc !== null && x1 < right) {
        shownNaked++;
        this.lines.push({ x0: Math.max(0, x1), x1: right, y: yPoc, color: T.nakedPoc, dash: true });
      }
      if (p.day + DAY <= vf || p.day > vt || x0 > right) continue;
      const { singles, tails } = tpoSingles(p);
      let widest = 0;
      for (let r = 0; r < p.rows.length; r++) {
        const yTop = y((p.lo + r + 1) * step);
        if (yTop === null) continue;
        const row = p.rows[r];
        const va = r >= p.vaLo && r <= p.vaHi;
        this.rowBgs.push({ x: x0 - 1, y: yTop, w: Math.max(0, Math.min(row.length * cw, x1 - x0)) + 2 });
        for (let i = 0; i < row.length; i++) {
          const cx = x0 + i * cw;
          if (cx >= x1) break;
          this.cells.push({ x: cx, y: yTop, p: row[i], va, poc: r === p.poc });
        }
        widest = Math.max(widest, row.length);
      }
      if (yPoc !== null) this.lines.push({ x0, x1, y: yPoc, color: T.poc, dash: false });
      // Pasek value area i initial balance z lewej strony profilu
      const yVah = y((p.lo + p.vaHi + 1) * step);
      const yVal = y((p.lo + p.vaLo) * step);
      if (yVah !== null && yVal !== null) this.marks.push({ x: x0 - 3, y0: yVah, y1: yVal, color: T.va, w: 2 });
      if (p.ib) {
        const yh = y(p.ib.hi);
        const yl = y(p.ib.lo);
        if (yh !== null && yl !== null) this.marks.push({ x: x0 - 7, y0: yh, y1: yl, color: T.ib, w: 2 });
      }
      // Pojedyncze wydruki i ogony: pasek za ostatnią literą wiersza
      for (let r = 0; r < p.rows.length; r++) {
        if (!singles[r] && !tails[r]) continue;
        const yTop = y((p.lo + r + 1) * step);
        if (yTop === null) continue;
        this.marks.push({ x: Math.min(x1, x0 + widest * cw + 2), y0: yTop, y1: yTop + rh, color: singles[r] ? T.single : T.tail, w: 2 });
      }
    }
  }
}
