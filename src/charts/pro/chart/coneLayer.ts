import type { AutoscaleInfo, IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, SeriesType, Time } from 'lightweight-charts';
import { MONO, PRO, rgba } from './theme';

/** Prognoza rozkładu log-zwrotu z dziennika Desku: chwila wydania, cena wtedy i kwantyle na horyzontach (minuty, rosnąco). */
export interface ConeForecast {
  t: number;
  px0: number;
  horizons: readonly { h: number; taus: readonly number[]; q: readonly number[] }[];
}

/** Szanse dotknięcia poziomów (PDH, PDL, środek dnia) w horyzoncie `h` minut od chwili `t` — z dziennika, z gotowym podpisem. */
export interface ConeTouch {
  t: number;
  h: number;
  levels: readonly { px: number; text: string }[];
}

export interface ConeSource {
  forecast: ConeForecast;
  /** Podpisy kresek na horyzontach prognozy (np. „1 h”, na telefonie z pokryciem). */
  tickLabels: readonly string[];
  touch: ConeTouch | null;
  /** Pozycja chwili na osi czasu: indeks świecy z ułamkiem, za ostatnią świecą co interwał wykresu. */
  logical(t: number): number | null;
  color: string;
  alpha: number;
  width: number;
  /** Telefon: tylko przedział 60% i mediana, bez dotknięć. */
  compact: boolean;
}

/** Przedziały stożka (jak w dzienniku: 90% i 60%) i mediana. */
const OUTER: readonly [number, number] = [0.05, 0.95];
const INNER: readonly [number, number] = [0.2, 0.8];
const MEDIAN = 0.5;
const MIN = 60_000;
/** Punkty krzywej na horyzont (gładka krzywa przy każdym zbliżeniu). */
const STEPS = 96;
/** Tło podpisu (świeca pod tekstem nie miesza się z literami). */
const LABEL_BG = rgba(PRO.bg, 0.85);
const LABEL_H = 12;

/**
 * Kwantyl log-zwrotu po `s` minutach od wydania: dokładny na horyzontach dziennika, między nimi (i od zera do pierwszego)
 * liniowo w pierwiastku czasu, jak rozrzut błądzenia losowego. Poza ostatnim horyzontem i bez tego kwantyla — null.
 */
export function coneQuantile(f: ConeForecast, tau: number, s: number): number | null {
  let s0 = 0;
  let q0 = 0;
  for (const hz of f.horizons) {
    const k = hz.taus.indexOf(tau);
    if (k < 0) return null;
    const q1 = hz.q[k];
    if (s <= hz.h) {
      const span = Math.sqrt(hz.h) - Math.sqrt(s0);
      return span > 0 ? q0 + ((q1 - q0) * (Math.sqrt(Math.max(s, s0)) - Math.sqrt(s0))) / span : q1;
    }
    s0 = hz.h;
    q0 = q1;
  }
  return null;
}

interface Drawn {
  outer: Path2D | null;
  inner: Path2D;
  median: Path2D;
  ticks: Path2D;
  texts: { x: number; y: number; text: string; align: CanvasTextAlign; baseline: CanvasTextBaseline }[];
  touch: Path2D;
  color: string;
  alpha: number;
  width: number;
}

/**
 * Stożek prognozy zakresu na wykresie ceny: przedziały 90% i 60% oraz mediana od chwili wydania prognozy do ostatniego
 * horyzontu, kreski na horyzontach dziennika (tam liczby są dokładne) i krótkie odcinki poziomów z szansą dotknięcia.
 * Pozycje z osi czasu z ułamkiem świecy, więc stożek zaczyna się w chwili wydania na każdym interwale; część za ostatnią
 * świecą rysuje się w odstępie od osi ceny.
 */
export class ConeLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private drawn: Drawn | null = null;
  private readonly views: readonly IPrimitivePaneView[];

  constructor(private readonly source: () => ConeSource | null) {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          const d = this.drawn;
          if (!d) return;
          if (d.outer) {
            ctx.fillStyle = rgba(d.color, 0.1 * d.alpha);
            ctx.fill(d.outer);
          }
          ctx.fillStyle = rgba(d.color, 0.18 * d.alpha);
          ctx.fill(d.inner);
          ctx.strokeStyle = rgba(d.color, 0.55 * d.alpha);
          ctx.lineWidth = 1;
          ctx.stroke(d.ticks);
          ctx.setLineDash([2, 3]);
          ctx.stroke(d.touch);
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = rgba(d.color, d.alpha);
          ctx.lineWidth = d.width;
          ctx.stroke(d.median);
          ctx.setLineDash([]);
        }),
    };
    // Podpisy nad świecami (pod nimi świeca potrafi zasłonić część tekstu)
    const labels: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          const d = this.drawn;
          if (!d) return;
          ctx.font = `10px ${MONO}`;
          const ink = rgba(d.color, Math.max(0.6, d.alpha));
          for (const t of d.texts) {
            const w = ctx.measureText(t.text).width;
            const x0 = t.align === 'right' ? t.x - w : t.align === 'center' ? t.x - w / 2 : t.x;
            const y0 = t.baseline === 'top' ? t.y - 1 : t.baseline === 'bottom' ? t.y - LABEL_H + 1 : t.y - LABEL_H / 2;
            ctx.fillStyle = LABEL_BG;
            ctx.fillRect(x0 - 2, y0, w + 4, LABEL_H);
            ctx.fillStyle = ink;
            ctx.textAlign = t.align;
            ctx.textBaseline = t.baseline;
            ctx.fillText(t.text, t.x, t.y);
          }
        }),
    };
    this.views = [
      { zOrder: () => 'bottom', renderer: () => renderer },
      { zOrder: () => 'top', renderer: () => labels },
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

  /** Nowa prognoza albo styl: przerysowanie. */
  update(): void {
    this.requestUpdate?.();
  }

  /** Skala ceny obejmuje rysowane przedziały, gdy stożek jest w widocznym zakresie świec. */
  autoscaleInfo(start: Logical, end: Logical): AutoscaleInfo | null {
    const src = this.source();
    if (!src) return null;
    const f = src.forecast;
    const last = f.horizons[f.horizons.length - 1];
    const a = src.logical(f.t);
    const b = last ? src.logical(f.t + last.h * MIN) : null;
    if (a === null || b === null || b < start || a > end) return null;
    const [lo, hi] = src.compact ? INNER : OUTER;
    const qs = f.horizons.flatMap((hz) => [hz.q[hz.taus.indexOf(lo)], hz.q[hz.taus.indexOf(hi)]]).filter((q) => Number.isFinite(q));
    if (qs.length === 0) return null;
    return { priceRange: { minValue: f.px0 * Math.exp(Math.min(0, ...qs)), maxValue: f.px0 * Math.exp(Math.max(0, ...qs)) } };
  }

  updateAllViews(): void {
    this.drawn = null;
    const src = this.source();
    const chart = this.chart;
    const series = this.series;
    if (!src || !chart || !series) return;
    const ts = chart.timeScale();
    const f = src.forecast;
    const last = f.horizons[f.horizons.length - 1];
    if (!last) return;
    // Biblioteka podaje współrzędne tylko całych indeksów (ułamek daje 0): między sąsiednimi liniowo
    const xOf = (t: number) => {
      const l = src.logical(t);
      if (l === null) return null;
      const i = Math.floor(l);
      const a = ts.logicalToCoordinate(i as Logical);
      const b = ts.logicalToCoordinate((i + 1) as Logical);
      return a === null || b === null ? null : a + (l - i) * (b - a);
    };
    const yOf = (lr: number) => series.priceToCoordinate(f.px0 * Math.exp(lr));
    // Krzywa kwantyla jako punkty (x, y) od chwili wydania do ostatniego horyzontu
    const curve = (tau: number) => {
      const pts: number[] = [];
      for (let k = 0; k <= STEPS; k++) {
        const s = (last.h * k) / STEPS;
        const q = coneQuantile(f, tau, s);
        const x = xOf(f.t + s * MIN);
        const y = q === null ? null : yOf(q);
        if (x === null || y === null) return null;
        pts.push(x, y);
      }
      return pts;
    };
    const band = ([lo, hi]: readonly [number, number]) => {
      const a = curve(hi);
      const b = curve(lo);
      if (!a || !b) return null;
      const p = new Path2D();
      p.moveTo(a[0], a[1]);
      for (let k = 2; k < a.length; k += 2) p.lineTo(a[k], a[k + 1]);
      for (let k = b.length - 2; k >= 0; k -= 2) p.lineTo(b[k], b[k + 1]);
      p.closePath();
      return p;
    };
    const inner = band(INNER);
    const mid = curve(MEDIAN);
    if (!inner || !mid) return;
    const outer = src.compact ? null : band(OUTER);
    const median = new Path2D();
    median.moveTo(mid[0], mid[1]);
    for (let k = 2; k < mid.length; k += 2) median.lineTo(mid[k], mid[k + 1]);
    // Kreski na horyzontach dziennika (liczby dokładne) z podpisem nad górną granicą (na telefonie pod dolną: górę zasłania legenda)
    const [lo, hi] = src.compact ? INNER : OUTER;
    const ticks = new Path2D();
    const texts: Drawn['texts'] = [];
    f.horizons.forEach((hz, k) => {
      const x = xOf(f.t + hz.h * MIN);
      const yHi = yOf(hz.q[hz.taus.indexOf(hi)]);
      const yLo = yOf(hz.q[hz.taus.indexOf(lo)]);
      if (x === null || yHi === null || yLo === null) return;
      ticks.moveTo(x, yHi);
      ticks.lineTo(x, yLo);
      const text = src.tickLabels[k] ?? '';
      // Na telefonie dłuższy podpis (z pokryciem) kończy się na kresce, żeby nie wchodził pod oś ceny
      texts.push(src.compact ? { x, y: yLo + 3, text, align: 'right', baseline: 'top' } : { x, y: yHi - 3, text, align: 'center', baseline: 'bottom' });
    });
    // Poziomy z szansą dotknięcia: odcinek od wydania do końca horyzontu, podpis za nim (poza panelem — bez rysowania)
    const touch = new Path2D();
    const height = chart.paneSize(0).height;
    if (src.touch && !src.compact) {
      const x0 = xOf(src.touch.t);
      const x1 = xOf(src.touch.t + src.touch.h * MIN);
      for (const lv of src.touch.levels) {
        const y = series.priceToCoordinate(lv.px);
        if (x0 === null || x1 === null || y === null || y < 0 || y > height) continue;
        touch.moveTo(x0, y);
        touch.lineTo(x1, y);
        texts.push({ x: x1 + 4, y, text: lv.text, align: 'left', baseline: 'middle' });
      }
    }
    this.drawn = { outer, inner, median, ticks, texts, touch, color: src.color, alpha: src.alpha, width: src.width };
  }
}
