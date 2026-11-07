import type { IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, SeriesType, Time } from 'lightweight-charts';
import type { BlogMap } from '../../../state/useBlogMaps';
import { type SettledLevel, mapWindow, settleRange } from '../../../utils/mapSettlement';
import { toVBars } from '../../../utils/auction';
import { blogMapName } from '../../../utils/sessionText';
import { tr } from '../../../i18n';
import type { Candle } from '../hl/parse';
import { fmtDayTime, fmtHm } from '../core/time';
import { fmtPx } from './layout';
import type { EdgeTags } from './overlay';
import { PRO, rgba } from './theme';

/**
 * Mapa z bloga na wykresie ceny BTC: poziomy z wpisu autora (przerywana linia i podpis „etykieta cena” przy prawej
 * krawędzi) i raz rodzaj mapy z godziną wpisu. W układzie Rozliczenie poziom dotknięty w oknie mapy dostaje „✓ HH:MM”.
 * Podpisy zostają w brzmieniu autora (po angielsku z dopiskiem „(PL blog)” w etykiecie mapy).
 */

/** Znaczniki rozliczenia: poziomy z minutą dotknięcia (kolejność jak w mapie) albo brak i powód w etykiecie mapy. */
export interface BlogMarks {
  settled: SettledLevel[] | null;
  note: string | null;
}

export interface BlogLevelView {
  price: number;
  text: string;
  touched: boolean;
}

/** Co rysuje warstwa: poziomy od najwyższej ceny (na wykresie od góry) i etykieta mapy. */
export interface BlogMapModel {
  levels: BlogLevelView[];
  tag: string;
}

/** Nazwa rodzaju mapy (etykieta na wykresie i lista map w ustawieniach) — wspólna z utils/sessionText. */
export { blogMapName };

/** Podpisy poziomów i etykieta mapy w chwili `now` (godzina wpisu, z datą, gdy wpis nie jest z dzisiaj). */
export function blogMapModel(map: BlogMap, x: { now: number; marks: BlogMarks }): BlogMapModel {
  const settled = x.marks.settled && x.marks.settled.length === map.levels.length ? x.marks.settled : null;
  const levels = map.levels
    .map((l, i): BlogLevelView => {
      const at = settled ? settled[i].touchedAt : null;
      return { price: l.price, text: `${l.label} ${fmtPx(l.price)}${at === null ? '' : ` ✓ ${fmtHm(at)}`}`, touched: at !== null };
    })
    .sort((a, b) => b.price - a.price);
  const note = x.marks.note ? ` · ${x.marks.note}` : '';
  return { levels, tag: `${blogMapName(map.kind)} ${fmtDayTime(map.publishedAt, x.now)}${tr('', ' (PL blog)')}${note}` };
}

/**
 * Rozliczenie poziomów mapy (tylko z `settle`, czyli w układzie Rozliczenie) w chwili wykresu `now`: dotknięcie w oknie
 * ważności mapy na świecach 1m (`candles1m(from)` — świece od początku okna) do `now`, wspólną regułą `settleRange`
 * (ta sama w Rozliczeniu doby). Mapa weekendu i tygodnia nie ma okna; świece, które jeszcze nie sięgają wpisu, nie dają
 * znaczników. Przy luce w świecach dotknięcia znalezione zostają, reszta poziomów jest nierozliczona (brak ✓ nie znaczy
 * wtedy „nie dotknięto”), a etykieta mapy mówi o luce.
 */
export function blogMapMarks(map: BlogMap, candles1m: (from: number) => readonly Candle[], now: number, settle: boolean): BlogMarks {
  if (!settle) return { settled: null, note: null };
  const w = mapWindow(map.kind, map.publishedAt);
  if (!w) return { settled: null, note: tr('bez rozliczenia', 'not settled') };
  const r = settleRange(map.levels, toVBars(candles1m(w.from)), w.from, w.to, now);
  if (!r) return { settled: null, note: tr('czekam na świece 1m', 'waiting for 1m candles') };
  return { settled: r.levels, note: r.complete ? null : tr('luka w świecach 1m', 'gap in 1m candles') };
}

/**
 * Podpisy mapy przy prawej krawędzi dla nakładki wskaźników (rozsuwane razem z jej etykietami, ta sama geometria): pasek
 * w kolorze mapy, tekst w kolorze tuszu (dotknięty poziom i etykieta mapy jaśniej), nad najwyższym — etykieta mapy.
 */
export function blogEdgeTags(m: BlogMapModel): EdgeTags {
  return { color: PRO.blogMap, head: m.tag, headInk: PRO.ink1, items: m.levels.map((l) => ({ price: l.price, text: l.text, ink: l.touched ? PRO.ink1 : PRO.ink2 })) };
}

// Stałe tablice kreskowania i kolory z kryciem — bez budowania w pętli rysowania
const DASH = [5, 4];
const SOLID: number[] = [];
const LINE = rgba(PRO.blogMap, 0.75);
const LINE_TOUCHED = rgba(PRO.blogMap, 1);

/**
 * Warstwa mapy z bloga (prymityw serii ceny): przerywane linie poziomów. Podpisy rysuje nakładka wskaźników
 * (`edgeTags()`), żeby nie nachodziły na jej etykiety. Model zmienia się najwyżej raz na minutę (`setModel`); w klatce tylko
 * położenia poziomów w tablicy liczb przygotowanej przy zmianie modelu. Skali ceny nie rozciąga — poziomy poza widokiem nie
 * są rysowane.
 */
export class BlogMapLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private model: BlogMapModel | null = null;
  private edge: EdgeTags | null = null;
  /** y linii każdego poziomu (NaN — brak). */
  private ys = new Float64Array(0);
  private rightInset = 0;
  private readonly views: readonly IPrimitivePaneView[];

  constructor() {
    const lines: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          const m = this.model;
          if (!m) return;
          const w = mediaSize.width - this.rightInset;
          const h = mediaSize.height;
          ctx.lineWidth = 1;
          ctx.setLineDash(DASH);
          for (let i = 0; i < m.levels.length; i++) {
            const y = this.ys[i];
            if (!(y >= 0 && y <= h)) continue;
            ctx.strokeStyle = m.levels[i].touched ? LINE_TOUCHED : LINE;
            ctx.beginPath();
            ctx.moveTo(0, Math.round(y) + 0.5);
            ctx.lineTo(w, Math.round(y) + 0.5);
            ctx.stroke();
          }
          ctx.setLineDash(SOLID);
        }),
    };
    this.views = [{ zOrder: () => 'bottom', renderer: () => lines }];
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

  /** Nowa mapa albo nowe znaczniki (null — nic do narysowania). */
  setModel(m: BlogMapModel | null): void {
    this.model = m;
    this.edge = m ? blogEdgeTags(m) : null;
    const n = m ? m.levels.length : 0;
    if (this.ys.length !== n) this.ys = new Float64Array(n);
    this.ys.fill(Number.NaN);
    this.requestUpdate?.();
  }

  /** Podpisy dla nakładki wskaźników (ten sam obiekt do następnej zmiany modelu); bez mapy — null. */
  edgeTags(): EdgeTags | null {
    return this.edge;
  }

  /** Miejsce przy prawej krawędzi zajęte przez drabinę DOM (px). */
  setRightInset(px: number): void {
    if (px === this.rightInset) return;
    this.rightInset = px;
    this.requestUpdate?.();
  }

  updateAllViews(): void {
    const m = this.model;
    const series = this.series;
    if (!m || !series || !this.chart) return;
    for (let i = 0; i < m.levels.length; i++) {
      const y = series.priceToCoordinate(m.levels[i].price);
      this.ys[i] = y === null ? Number.NaN : y;
    }
  }
}
