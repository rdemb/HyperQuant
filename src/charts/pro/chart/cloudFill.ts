import type { IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, SeriesType, Time } from 'lightweight-charts';
import { HIST_DOWN, HIST_UP } from '../indicators/registry';
import { rgba } from './theme';

/** Granice chmury świeca po świecy wykresu (NaN = brak), liczba świec z wartościami i przesunięcie w świecach. */
export interface CloudSource {
  a: Float64Array;
  b: Float64Array;
  n: number;
  shift: number;
}

/** Krycie wypełnienia przy pełnym kryciu wskaźnika (jak chmura TradingView). */
const FILL_ALPHA = 0.12;

/**
 * Chmura Ichimoku: wypełnienie między dwiema granicami, turkusowe, gdy pierwsza jest wyżej, czerwone w przeciwnym razie;
 * odcinek, na którym granice się przecinają, dzieli się w punkcie przecięcia. Indeks logiczny osi czasu to indeks świecy
 * wykresu, więc część przesunięta za ostatnią świecę rysuje się na prawo od niej.
 */
export class CloudFill implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private up: Path2D | null = null;
  private down: Path2D | null = null;
  private readonly views: readonly IPrimitivePaneView[];

  constructor(
    private readonly source: () => CloudSource | null,
    private alpha: number
  ) {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          if (this.up) {
            ctx.fillStyle = rgba(HIST_UP, FILL_ALPHA * this.alpha);
            ctx.fill(this.up);
          }
          if (this.down) {
            ctx.fillStyle = rgba(HIST_DOWN, FILL_ALPHA * this.alpha);
            ctx.fill(this.down);
          }
        }),
    };
    this.views = [{ zOrder: () => 'bottom', renderer: () => renderer }];
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

  setAlpha(alpha: number): void {
    this.alpha = alpha;
    this.requestUpdate?.();
  }

  updateAllViews(): void {
    this.up = null;
    this.down = null;
    const src = this.source();
    const chart = this.chart;
    const series = this.series;
    if (!src || !chart || !series) return;
    const ts = chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return;
    const { a, b, n, shift } = src;
    const up = new Path2D();
    const down = new Path2D();
    // Świece widocznego zakresu (rysowane w indeksie j + shift) z sąsiadem po obu stronach
    const j1 = Math.min(n - 1, Math.ceil(range.to) - shift + 1);
    let prev: { x: number; ya: number; yb: number; d: number } | null = null;
    for (let j = Math.max(0, Math.floor(range.from) - shift - 1); j <= j1; j++) {
      const x = ts.logicalToCoordinate((j + shift) as Logical);
      const ya = Number.isNaN(a[j]) ? null : series.priceToCoordinate(a[j]);
      const yb = Number.isNaN(b[j]) ? null : series.priceToCoordinate(b[j]);
      if (x === null || ya === null || yb === null) {
        prev = null;
        continue;
      }
      const d = a[j] - b[j];
      if (prev && prev.d > 0 === d > 0) polygon(prev.d > 0 ? up : down, [prev.x, prev.ya, x, ya, x, yb, prev.x, prev.yb]);
      else if (prev) {
        // Przecięcie granic: do punktu przecięcia kolor poprzedniej świecy, dalej bieżącej
        const t = prev.d / (prev.d - d);
        const cx = prev.x + t * (x - prev.x);
        const cy = prev.ya + t * (ya - prev.ya);
        polygon(prev.d > 0 ? up : down, [prev.x, prev.ya, cx, cy, prev.x, prev.yb]);
        polygon(d > 0 ? up : down, [cx, cy, x, ya, x, yb]);
      }
      prev = { x, ya, yb, d };
    }
    this.up = up;
    this.down = down;
  }
}

/** Wielokąt z par współrzędnych x, y. */
function polygon(path: Path2D, xy: readonly number[]): void {
  path.moveTo(xy[0], xy[1]);
  for (let k = 2; k < xy.length; k += 2) path.lineTo(xy[k], xy[k + 1]);
  path.closePath();
}
