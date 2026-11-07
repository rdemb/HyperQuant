import type { IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, SeriesType, Time } from 'lightweight-charts';
import type { BlogMap } from '../../../state/useBlogMaps';
import { type MapKind, type SettledLevel, mapWindow, settleLevels } from '../../../utils/mapSettlement';
import type { VBar } from '../../../utils/auction';
import { tr } from '../../../i18n';
import type { Candle } from '../hl/parse';
import { fmtDayTime, fmtHm } from '../core/time';
import { fmtPx } from './layout';
import { MONO, PRO, rgba } from './theme';

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

const KIND_NAME: Record<MapKind, string> = {
  dzien: tr('Mapa dnia', 'Day map'),
  ny: tr('Mapa przed NY', 'Pre-NY map'),
  otwarcie: tr('Otwarcie sesji', 'Session open'),
  aktualizacja: tr('Aktualizacja', 'Update'),
  inne: tr('Mapa z bloga', 'Blog map'),
};

/** Nazwa rodzaju mapy (etykieta na wykresie i lista map w ustawieniach). */
export const blogMapName = (kind: MapKind): string => KIND_NAME[kind];

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
  return { levels, tag: `${KIND_NAME[map.kind]} ${fmtDayTime(map.publishedAt, x.now)}${tr('', ' (PL blog)')}${note}` };
}

const MIN = 60_000;

/**
 * Rozliczenie poziomów mapy (tylko z `settle`, czyli w układzie Rozliczenie): dotknięcie w oknie ważności mapy na świecach 1m
 * (`candles1m(from)` — świece od początku okna). Mapa weekendu i tygodnia nie ma okna; świece, które jeszcze nie sięgają
 * wpisu, nie dają znaczników (brak ✓ nie może znaczyć „nie dotknięto”, gdy świec brakuje).
 */
export function blogMapMarks(map: BlogMap, candles1m: (from: number) => readonly Candle[], settle: boolean): BlogMarks {
  if (!settle) return { settled: null, note: null };
  const w = mapWindow(map.kind, map.publishedAt);
  if (!w) return { settled: null, note: tr('bez rozliczenia', 'not settled') };
  const c = candles1m(w.from);
  // Pierwsza potrzebna świeca to minuta po wpisie: świeca, w której wpis wyszedł, zaczęła się przed nim i się nie liczy
  if (c.length === 0 || c[0].t > Math.ceil(w.from / MIN) * MIN) return { settled: null, note: tr('czekam na świece 1m', 'waiting for 1m candles') };
  const bars: VBar[] = [];
  for (const k of c) if (k.t >= w.from && k.t < w.to) bars.push({ time: k.t, open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v });
  return { settled: settleLevels(map.levels, bars, w.from, w.to), note: null };
}

const FONT = `10px ${MONO}`;
const TAG_FONT = `600 10px ${MONO}`;
const LABEL_H = 13;
const PAD = 4;
const BAR_W = 2;
/** Odstęp podpisów od prawej krawędzi panelu (px). */
const EDGE = 6;
// Stałe tablice kreskowania i kolory z kryciem — bez budowania w pętli rysowania
const DASH = [5, 4];
const SOLID: number[] = [];
const K = {
  line: rgba(PRO.blogMap, 0.75),
  lineTouched: rgba(PRO.blogMap, 1),
  bar: PRO.blogMap,
  bg: rgba(PRO.bg, 0.85),
  text: PRO.ink2,
  textTouched: PRO.ink1,
  tag: PRO.ink1,
};

/**
 * Warstwa mapy z bloga (prymityw serii ceny). Model zmienia się najwyżej raz na minutę (`setModel`); w klatce tylko
 * położenia poziomów w tablicach liczb przygotowanych przy zmianie modelu, a szerokości podpisów mierzone raz. Skali ceny
 * nie rozciąga — poziomy poza widokiem nie są rysowane.
 */
export class BlogMapLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private model: BlogMapModel | null = null;
  /** y linii każdego poziomu (NaN — brak), y środka podpisu, szerokość podpisu (NaN — do zmierzenia). */
  private ys = new Float64Array(0);
  private labelYs = new Float64Array(0);
  private widths = new Float64Array(0);
  private tagW = Number.NaN;
  private tagY = Number.NaN;
  /** Prawa krawędź podpisów (px) z ostatniej klatki. */
  private right = 0;
  private rightInset = 0;
  private readonly views: readonly IPrimitivePaneView[];

  constructor() {
    const lines: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          const m = this.model;
          this.tagY = Number.NaN;
          if (!m) return;
          const w = mediaSize.width - this.rightInset;
          const h = mediaSize.height;
          this.right = w - EDGE;
          ctx.lineWidth = 1;
          ctx.setLineDash(DASH);
          // Podpis nad linią; kolejny co najmniej wysokość podpisu niżej od poprzedniego (poziomy od najwyższej ceny)
          let prev = Number.NEGATIVE_INFINITY;
          let first = Number.NaN;
          for (let i = 0; i < m.levels.length; i++) {
            const y = this.ys[i];
            if (!(y >= 0 && y <= h)) {
              this.labelYs[i] = Number.NaN;
              continue;
            }
            ctx.strokeStyle = m.levels[i].touched ? K.lineTouched : K.line;
            ctx.beginPath();
            ctx.moveTo(0, Math.round(y) + 0.5);
            ctx.lineTo(w, Math.round(y) + 0.5);
            ctx.stroke();
            const ly = Math.max(y - LABEL_H / 2 - 1, prev + LABEL_H + 1);
            this.labelYs[i] = ly;
            prev = ly;
            if (Number.isNaN(first)) first = ly;
          }
          ctx.setLineDash(SOLID);
          // Etykieta mapy raz: nad najwyższym podpisem, a bez miejsca nad nim — pod najniższym
          if (!Number.isNaN(first)) this.tagY = first - LABEL_H - 1 >= LABEL_H / 2 ? first - LABEL_H - 1 : prev + LABEL_H + 1;
        }),
    };
    const labels: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          const m = this.model;
          if (!m || Number.isNaN(this.tagY)) return;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.font = FONT;
          for (let i = 0; i < m.levels.length; i++) {
            const ly = this.labelYs[i];
            if (Number.isNaN(ly)) continue;
            const l = m.levels[i];
            if (Number.isNaN(this.widths[i])) this.widths[i] = Math.ceil(ctx.measureText(l.text).width) + 2 * PAD + BAR_W;
            this.box(ctx, this.widths[i], ly, l.touched ? K.textTouched : K.text, l.text);
          }
          ctx.font = TAG_FONT;
          if (Number.isNaN(this.tagW)) this.tagW = Math.ceil(ctx.measureText(m.tag).width) + 2 * PAD + BAR_W;
          this.box(ctx, this.tagW, this.tagY, K.tag, m.tag);
        }),
    };
    this.views = [
      { zOrder: () => 'bottom', renderer: () => lines },
      { zOrder: () => 'top', renderer: () => labels },
    ];
  }

  /** Podpis w ramce przy prawej krawędzi z paskiem w kolorze mapy (kolor niesie znacznik, tekst w kolorze tuszu). */
  private box(ctx: CanvasRenderingContext2D, w: number, y: number, color: string, text: string): void {
    const x = this.right - w;
    ctx.fillStyle = K.bg;
    ctx.fillRect(x, y - LABEL_H / 2, w, LABEL_H);
    ctx.fillStyle = K.bar;
    ctx.fillRect(x, y - LABEL_H / 2, BAR_W, LABEL_H);
    ctx.fillStyle = color;
    ctx.fillText(text, this.right - PAD, y + 0.5);
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
    const n = m ? m.levels.length : 0;
    if (this.ys.length !== n) {
      this.ys = new Float64Array(n);
      this.labelYs = new Float64Array(n);
      this.widths = new Float64Array(n);
    }
    this.ys.fill(Number.NaN);
    this.labelYs.fill(Number.NaN);
    this.widths.fill(Number.NaN);
    this.tagW = Number.NaN;
    this.requestUpdate?.();
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
