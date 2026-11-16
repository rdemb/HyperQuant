import type { IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, SeriesType, Time } from 'lightweight-charts';
import { tr } from '../../../i18n';
import type { IndicatorBar } from '../core/indicators';
import { type IvbState, ivbAt, ivbObjects } from '../core/ivb';
import { fmtDayTime, fmtHm } from '../core/time';
import { logicalOfTime } from './overlay';
import { MONO, PRO, rgba } from './theme';

/**
 * Warstwa wskaźnika IVB (zakres otwarcia NY, `core/ivb`) na wykresie ceny: prostokąt okna z zamkniętych świec, a po oknie
 * linie szczytu i dołka od końca okna do końca sesji NY, z podpisem przy początku linii. Kolor instancji wskaźnika (inny niż
 * zieleń IB, żeby obu zakresów nie pomylić).
 */

export interface IvbStyle {
  color: string;
  alpha: number;
  width: number;
  minutes: number;
}

type LegendPart = { text: string; color: string };

/** Opis w legendzie: okno w czasie lokalnym, szczyt i dołek, „w budowie” do końca okna albo powód braku. */
export function ivbLegend(s: IvbState | null, now: number, fmt: (p: number) => string): LegendPart[] {
  if (!s || s.kind === 'noData') return [{ text: tr('czekam na świece…', 'waiting for candles…'), color: PRO.ink3 }];
  if (s.kind === 'interval') return [{ text: tr('—, interwał do 30m', '—, intervals up to 30m'), color: PRO.ink3 }];
  if (s.kind === 'outside')
    return [{ text: tr(`—, poza sesją NY (otwarcie ${fmtDayTime(s.next, now)})`, `—, outside the NY session (opens ${fmtDayTime(s.next, now)})`), color: PRO.ink3 }];
  if (s.kind === 'waiting')
    return [{ text: tr(`—, czekam na pierwszą zamkniętą świecę po otwarciu NY ${fmtHm(s.open)}`, `—, waiting for the first closed candle after the NY open ${fmtHm(s.open)}`), color: PRO.ink3 }];
  if (s.kind === 'gap')
    return [{ text: tr(`—, brak świec okna od otwarcia NY ${fmtHm(s.open)}`, `—, candles of the window since the NY open ${fmtHm(s.open)} are missing`), color: PRO.ink3 }];
  const v = s.ivb;
  const out: LegendPart[] = [
    { text: `NY ${fmtHm(v.start)}–${fmtHm(v.end)}`, color: PRO.ink2 },
    { text: tr(`szczyt ${fmt(v.hi)} · dołek ${fmt(v.lo)}`, `high ${fmt(v.hi)} · low ${fmt(v.lo)}`), color: PRO.ink1 },
  ];
  if (!v.complete) out.push({ text: tr(`· w budowie do ${fmtHm(v.end)}`, `· building until ${fmtHm(v.end)}`), color: PRO.ink3 });
  return out;
}

interface Scene {
  box: { x0: number; x1: number; y0: number; y1: number } | null;
  lines: { x0: number; x1: number; y: number; label: string }[];
}

export class IvbLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private style: IvbStyle | null = null;
  private bars: readonly IndicatorBar[] = [];
  private ms = 60_000;
  private now = 0;
  private rightInset = 0;
  private state: IvbState | null = null;
  /** Okno, dla którego policzono stan (null — wskaźnik ukryty). */
  private stateMinutes: number | null = null;
  private scene: Scene = { box: null, lines: [] };
  private readonly views: readonly IPrimitivePaneView[];
  /** Format ceny podpisów i legendy: tick rynku wykresu (ustawia kontroler). */
  fmtPx: (p: number) => string = (p) => String(p);
  /** Po każdym przeliczeniu: liczba obiektów na wykresie (pomiar układu czyta ją z wykresu). */
  onObjects: ((n: number) => void) | null = null;

  /** `styleOf` — styl pierwszego widocznego wskaźnika IVB (null — ukryty: bez liczenia i rysowania). */
  constructor(private readonly styleOf: () => IvbStyle | null) {
    const back: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          const st = this.style;
          const b = this.scene.box;
          if (!st || !b) return;
          ctx.fillStyle = rgba(st.color, 0.1 * st.alpha);
          ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
        }),
    };
    const front: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          const st = this.style;
          if (!st) return;
          const ink = rgba(st.color, Math.max(0.35, 0.9 * st.alpha));
          const crisp = (v: number, w: number) => Math.round(v) + (w % 2 ? 0.5 : 0);
          ctx.strokeStyle = ink;
          ctx.fillStyle = ink;
          ctx.font = `600 9px ${MONO}`;
          ctx.textBaseline = 'bottom';
          const b = this.scene.box;
          if (b) {
            ctx.lineWidth = 1;
            ctx.strokeRect(crisp(b.x0, 1), crisp(b.y0, 1), Math.round(b.x1 - b.x0), Math.round(b.y1 - b.y0));
          }
          for (const l of this.scene.lines) {
            ctx.lineWidth = st.width;
            ctx.beginPath();
            ctx.moveTo(Math.round(l.x0), crisp(l.y, st.width));
            ctx.lineTo(Math.round(l.x1), crisp(l.y, st.width));
            ctx.stroke();
            if (l.x1 - l.x0 > 60) ctx.fillText(l.label, Math.max(l.x0, 0) + 3, l.y - 2);
          }
        }),
    };
    this.views = [
      { zOrder: () => 'bottom', renderer: () => back },
      { zOrder: () => 'top', renderer: () => front },
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

  setRightInset(px: number): void {
    this.rightInset = px;
    this.requestUpdate?.();
  }

  /** Świece wykresu i chwila danych (`now`: świeca zamknięta, gdy jej koniec ≤ now; w powtórce chwila powtórki). */
  setData(bars: readonly IndicatorBar[], ms: number, now: number): void {
    this.bars = bars;
    this.ms = ms;
    this.now = now;
    this.recompute(this.styleOf());
    this.requestUpdate?.();
  }

  /** Stan IVB dla bieżących świec i stylu (włączenie wskaźnika albo zmiana okna też przeliczają). */
  private recompute(st: IvbStyle | null): void {
    this.state = st ? ivbAt(this.bars, this.ms, st.minutes, this.now) : null;
    this.stateMinutes = st ? st.minutes : null;
    this.onObjects?.(this.state ? ivbObjects(this.state) : 0);
  }

  updateAllViews(): void {
    this.scene = { box: null, lines: [] };
    this.style = this.styleOf();
    if ((this.style ? this.style.minutes : null) !== this.stateMinutes) this.recompute(this.style);
    const s = this.state;
    const chart = this.chart;
    const series = this.series;
    if (!this.style || !s || s.kind !== 'ok' || !chart || !series || this.bars.length === 0) return;
    const ts = chart.timeScale();
    const xa = ts.logicalToCoordinate(0 as Logical);
    const xb = ts.logicalToCoordinate(1 as Logical);
    if (xa === null || xb === null || !(xb > xa)) return;
    const sp = xb - xa;
    const right = chart.paneSize(0).width - this.rightInset;
    const x = (t: number) => Math.min(right, xa + (logicalOfTime(this.bars, t, this.ms) - 0.5) * sp);
    const v = s.ivb;
    const yh = series.priceToCoordinate(v.hi);
    const yl = series.priceToCoordinate(v.lo);
    if (yh === null || yl === null) return;
    const x0 = x(v.start);
    const x1 = x(v.through);
    if (x1 >= 0 && x0 < right) this.scene.box = { x0, x1, y0: Math.min(yh, yl), y1: Math.max(yh, yl) };
    if (!v.complete) return;
    // Linie dopiero od końca okna (zakres znany), do końca sesji NY albo prawej krawędzi
    const lx0 = x(v.end);
    const lx1 = Math.min(right, x(v.sessionEnd));
    if (lx1 < 0 || lx0 >= right) return;
    this.scene.lines.push({ x0: lx0, x1: lx1, y: yh, label: `IVB H ${this.fmtPx(v.hi)}` }, { x0: lx0, x1: lx1, y: yl, label: `IVB L ${this.fmtPx(v.lo)}` });
  }

  /** Opis w legendzie (z ostatniego przeliczenia). */
  legend(): LegendPart[] {
    return ivbLegend(this.state, this.now, this.fmtPx);
  }
}
