import type { IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, SeriesType, Time } from 'lightweight-charts';
import { tr } from '../../../i18n';
import { numLang } from '../../../ui/format';
import { DEFAULT_EFFORT_PARAMS, type EffortResult, type Side, type VBar, effortZones } from '../core/effortZones';
import type { Candle } from '../hl/parse';
import { type EffortSelection, effortRects, selectEffort } from './effortSelect';
import { logicalOfTime } from './overlay';
import { MONO, PRO, rgba } from './theme';

/**
 * Warstwa wskaźnika „Strefy absorpcji i pudełka Effort” na wykresie ceny (interwały do 1 h, na żywo i w powtórce). Model
 * (`effortZones`) liczy wszystkie strefy i pudełka na zamkniętych świecach; rysowany jest wybór `selectEffort` na
 * ostatniej zamkniętej świecy: pasma stref aktywnych i uzbrojonych najbliższe cenie (od świecy powstania, ze
 * znacznikiem A, D, F w rogu i kreską na krańcu swingu), obrys przebitej przez 6 świec i ostatnia seria pudełek każdej
 * strony (wypełnienie na świecach serii, w prawo dwie linie krawędzi). Tryb „Historia” — wszystko obrysami. Kolory
 * stron stałe (popyt w kolorze kupna, podaż w kolorze sprzedaży).
 */

/** Styl widocznego wskaźnika: krycie wypełnień, grubość obrysów (kolory stron są stałe) i tryb „Historia”. */
export interface EffortStyle {
  alpha: number;
  width: number;
  history?: boolean;
}

/** Świeca wykresu z taśmą (ProBar): delta agresorów z footprintu i czy świeca jest w całości nagrana. */
export interface EffortSourceBar {
  t: number;
  candle: Candle;
  fp: { delta: number } | null;
  complete: boolean;
}

const MAX_TF = 3_600_000;
/** Wypełnienie pasma i świec serii pudełek (mnożone przez krycie stylu). */
const ZONE_FILL = 0.13;
const BOX_FILL = 0.3;

/** Kolory stron z kryciem `a`, zbudowane raz na rysowanie: popyt w kolorze kupna, podaż w kolorze sprzedaży. */
function sideInk(a: number): (s: Side) => string {
  const buy = rgba(PRO.buy, a);
  const sell = rgba(PRO.sell, a);
  return (s) => (s === 1 ? buy : sell);
}

interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

interface BandRect extends Rect {
  side: Side;
  mark: string;
  /** Wypełnione (pasmo aktywne); obrys sam — przebita albo tryb „Historia”. */
  fill: boolean;
  dim: boolean;
  /** Kreski krańców swingu: x od–do i y. */
  ticks: { x0: number; x1: number; y: number }[];
}

interface BoxRect extends Rect {
  side: Side;
  /** Świece serii (wypełnienie) i krawędzie w prawo (x końca), w trybie „Historia” bez nich. */
  cells: { x0: number; x1: number }[];
  edgeTo: number;
}

/** Liczba zamkniętych świec (koniec ≤ `now`) na początku listy rosnącej po czasie. */
function closedCount(bars: readonly EffortSourceBar[], ms: number, now: number): number {
  let n = bars.length;
  while (n > 0 && bars[n - 1].t + ms > now) n--;
  return n;
}

/** Świeca modelu: delta z footprintu tylko przy świecy w całości nagranej, inaczej null (model przybliża ją ze świecy). */
const toVBar = (b: EffortSourceBar): VBar => ({ t: b.t, o: b.candle.o, h: b.candle.h, l: b.candle.l, c: b.candle.c, v: b.candle.v, delta: b.complete && b.fp ? b.fp.delta : null });

/** Zamknięte świece wykresu (koniec ≤ `now`) jako świece modelu; świeca w trakcie nie wchodzi. */
export function closedBars(bars: readonly EffortSourceBar[], ms: number, now: number): VBar[] {
  return bars.slice(0, closedCount(bars, ms, now)).map(toVBar);
}

/** Odmiana polska liczebnika: 1 strefa, 2–4 strefy, 5 stref (12–14 — jak 5). */
function pl(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const d = n % 10;
  const dd = n % 100;
  return d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many;
}

/**
 * Opis w legendzie z wyboru: pasma po stronach z liczbą dalszych, ostatnia seria pudełek i świece z taśmą wśród 12
 * ostatnich; w trybie „Historia” liczby obrysów. Powyżej 1 h powód braku, bez zamkniętych świec — czekanie.
 */
export function effortLegend(sel: EffortSelection | null, ms: number, asOf: number): { text: string; color: string }[] {
  if (ms > MAX_TF) return [{ text: tr('—, interwał do 1 h', '—, intervals up to 1 h'), color: PRO.ink3 }];
  if (!sel) return [{ text: tr('czekam na świece…', 'waiting for candles…'), color: PRO.ink3 }];
  const tape = { text: tr(`· taśma ${numLang(String(sel.tapeLast12))} z 12`, `· tape ${sel.tapeLast12} of 12`), color: PRO.ink2 };
  if (sel.history) {
    const z = sel.bands.length;
    const b = sel.boxes.length;
    return [
      { text: tr(`historia: ${z} ${pl(z, 'strefa', 'strefy', 'stref')}`, `history: ${z} ${z === 1 ? 'zone' : 'zones'}`), color: z > 0 ? PRO.ink1 : PRO.ink2 },
      { text: tr(`· ${b} ${pl(b, 'seria', 'serie', 'serii')} pudełek`, `· ${b} box ${b === 1 ? 'series' : 'series'}`), color: PRO.ink2 },
      tape,
    ];
  }
  const demand = sel.bands.filter((x) => x.side === 1).length;
  const supply = sel.bands.length - demand;
  const far = sel.far.demand + sel.far.supply;
  const zones = {
    text: tr(`strefy: ${demand} popytu · ${supply} podaży${far > 0 ? ` (dalej ${far})` : ''}`, `zones: ${demand} demand · ${supply} supply${far > 0 ? ` (${far} farther)` : ''}`),
    color: demand + supply > 0 ? PRO.ink1 : PRO.ink2,
  };
  if (sel.tapeLast12 === 0) return [zones, { text: tr('· pudełka: —, brak taśmy', '· boxes: —, no tape'), color: PRO.ink3 }];
  const last = sel.boxes.reduce<EffortSelection['boxes'][number] | null>((a, b) => (!a || b.last > a.last ? b : a), null);
  let box = tr('· pudełko: —', '· box: —');
  if (last) {
    const ago = Math.max(0, Math.round((asOf - last.last) / ms));
    const side = last.side === 1 ? tr('kupno', 'buying') : tr('sprzedaż', 'selling');
    box =
      ago === 0
        ? tr(`· pudełko: ${side}, ostatnia świeca`, `· box: ${side}, the last candle`)
        : tr(`· pudełko: ${side}, ${ago} ${pl(ago, 'świeca', 'świece', 'świec')} temu`, `· box: ${side}, ${ago} ${ago === 1 ? 'candle' : 'candles'} ago`);
  }
  return [zones, { text: box, color: PRO.ink2 }, tape];
}

export class EffortLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private style: EffortStyle | null = null;
  private bars: readonly EffortSourceBar[] = [];
  private ms = 60_000;
  private now = 0;
  private rightInset = 0;
  private phone = false;
  /** Zamknięte świece ostatniego przeliczenia (te same obiekty — bez zmian), świece modelu i wynik. */
  private src: readonly EffortSourceBar[] = [];
  private srcMs = 0;
  private vbars: VBar[] = [];
  private result: EffortResult | null = null;
  /** Wybór do rysowania na ostatniej zamkniętej świecy i jego klucz (wynik, telefon, tryb). */
  private sel: EffortSelection | null = null;
  private selKey: readonly unknown[] = [];
  private bands: BandRect[] = [];
  private boxes: BoxRect[] = [];
  private readonly views: readonly IPrimitivePaneView[];
  /** Po każdym nowym wyborze: liczba prostokątów (pomiar układu czyta ją z wykresu). */
  onSelect: ((rects: number) => void) | null = null;

  /** `styleOf` — styl widocznego wskaźnika (null — ukryty: bez liczenia i rysowania). */
  constructor(private readonly styleOf: () => EffortStyle | null) {
    const back: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          const st = this.style;
          if (!st) return;
          const zone = sideInk(ZONE_FILL * st.alpha);
          const box = sideInk(BOX_FILL * st.alpha);
          for (const z of this.bands) {
            if (!z.fill) continue;
            ctx.fillStyle = zone(z.side);
            ctx.fillRect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0);
          }
          for (const b of this.boxes) {
            ctx.fillStyle = box(b.side);
            for (const c of b.cells) ctx.fillRect(c.x0, b.y0, c.x1 - c.x0, b.y1 - b.y0);
          }
        }),
    };
    const front: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          const st = this.style;
          if (!st) return;
          const a = Math.max(0.35, 0.85 * st.alpha);
          const live = sideInk(a);
          const dim = sideInk(0.4 * a);
          // Linia nieparzystej grubości na środku piksela (ostra krawędź)
          const crisp = (v: number, w: number) => Math.round(v) + (w % 2 ? 0.5 : 0);
          const rect = (r: Rect, w: number) => {
            ctx.lineWidth = w;
            ctx.strokeRect(crisp(r.x0, w), crisp(r.y0, w), Math.round(r.x1 - r.x0), Math.round(r.y1 - r.y0));
          };
          const hline = (x0: number, x1: number, y: number, w: number) => {
            ctx.lineWidth = w;
            ctx.beginPath();
            ctx.moveTo(Math.round(x0), crisp(y, w));
            ctx.lineTo(Math.round(x1), crisp(y, w));
            ctx.stroke();
          };
          ctx.font = `600 9px ${MONO}`;
          ctx.textBaseline = 'top';
          for (const z of this.bands) {
            const c = (z.dim ? dim : live)(z.side);
            ctx.strokeStyle = c;
            rect(z, st.width);
            // Kraniec swingu: krótka kreska na jego cenie i świecy, bez wypełnienia
            for (const t of z.ticks) hline(t.x0, t.x1, t.y, Math.max(1, st.width));
            // Znacznik rodzaju w lewym górnym rogu (przy paśmie zaczętym poza widokiem — przy lewej krawędzi)
            const lx = Math.max(z.x0, 0) + 3;
            if (z.x1 - lx < 8) continue;
            ctx.fillStyle = c;
            ctx.fillText(z.mark, lx, z.y0 + 2);
          }
          for (const b of this.boxes) {
            ctx.strokeStyle = live(b.side);
            rect(b, Math.max(1, st.width - 1));
            // W prawo od serii dwie cienkie linie krawędzi zamiast wypełnionego prostokąta
            if (b.edgeTo > b.x1) {
              hline(b.x1, b.edgeTo, b.y0, 1);
              hline(b.x1, b.edgeTo, b.y1, 1);
            }
          }
        }),
    };
    this.views = [
      { zOrder: () => 'bottom', renderer: () => back },
      // Obrysy i znaczniki nad świecami
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

  /** Telefon: 1 pasmo na stronę, bez obrysu przebitej, 1 seria pudełek. */
  setPhone(on: boolean): void {
    if (on === this.phone) return;
    this.phone = on;
    this.reselect();
    this.requestUpdate?.();
  }

  /** Świece wykresu; przeliczenie tylko po zmianie zamkniętych świec (nowa, doczytana historia, taśma starszej świecy). */
  setData(bars: readonly EffortSourceBar[], ms: number, now: number): void {
    this.bars = bars;
    this.ms = ms;
    this.now = now;
    if (!this.styleOf() || ms > MAX_TF) {
      this.src = [];
      this.srcMs = 0;
      this.vbars = [];
      this.result = null;
      this.reselect();
      this.requestUpdate?.();
      return;
    }
    const n = closedCount(bars, ms, now);
    const same = ms === this.srcMs && this.src.length === n && this.src.every((b, i) => b === bars[i]);
    if (!same) {
      this.src = bars.slice(0, n);
      this.srcMs = ms;
      this.vbars = this.src.map(toVBar);
      this.result = n > 0 ? effortZones(this.vbars, ms) : null;
    }
    this.reselect();
    this.requestUpdate?.();
  }

  /** Wybór na ostatniej zamkniętej świecy — tylko po zmianie wyniku, telefonu albo trybu „Historia”. */
  private reselect(): void {
    const history = this.styleOf()?.history === true;
    const key = [this.result, this.phone, history];
    if (key.every((v, i) => Object.is(v, this.selKey[i]))) return;
    this.selKey = key;
    const r = this.result;
    const last = this.vbars[this.vbars.length - 1];
    this.sel = r && last ? selectEffort(r, this.vbars, this.srcMs, last.t, { phone: this.phone, history }) : null;
    this.onSelect?.(this.sel ? effortRects(this.sel) : 0);
  }

  updateAllViews(): void {
    this.bands = [];
    this.boxes = [];
    this.style = this.styleOf();
    this.reselect();
    const sel = this.sel;
    const chart = this.chart;
    const series = this.series;
    const bars = this.bars;
    const ms = this.ms;
    if (!this.style || !sel || !chart || !series || bars.length === 0 || ms > MAX_TF) return;
    const ts = chart.timeScale();
    const xa = ts.logicalToCoordinate(0 as Logical);
    const xb = ts.logicalToCoordinate(1 as Logical);
    if (xa === null || xb === null || !(xb > xa)) return;
    const sp = xb - xa;
    const right = chart.paneSize(0).width - this.rightInset;
    const x = (t: number) => Math.min(right, xa + (logicalOfTime(bars, t, ms) - 0.5) * sp);
    const y = (p: number) => series.priceToCoordinate(p);
    const span = (x0: number, x1: number, hi: number, lo: number): Rect | null => {
      if (x1 < 0 || x0 >= right) return null;
      const ya = y(hi);
      const yb = y(lo);
      return ya === null || yb === null ? null : { x0, x1, y0: Math.min(ya, yb), y1: Math.max(ya, yb) };
    };
    const band = (z: EffortSelection['bands'][number], broken: boolean) => {
      const s = span(x(z.start), z.end === null ? right : x(z.end + ms), z.hi, z.lo);
      if (!s) return;
      const ticks = z.extremes.flatMap((e) => {
        const ty = y(e.p);
        return ty === null ? [] : [{ x0: x(e.t), x1: x(e.t + ms), y: ty }];
      });
      this.bands.push({ ...s, side: z.side, mark: z.mark, fill: !sel.history && !broken, dim: broken || (sel.history && z.end !== null), ticks });
    };
    for (const z of sel.bands) band(z, false);
    if (sel.broken) band(sel.broken, true);
    const ext = DEFAULT_EFFORT_PARAMS.boxExtend * ms;
    for (const b of sel.boxes) {
      const s = span(x(b.from), x(b.last + ms), b.hi, b.lo);
      if (!s) continue;
      this.boxes.push({ ...s, side: b.side, cells: sel.history ? [] : b.cells.map((t) => ({ x0: x(t), x1: x(t + ms) })), edgeTo: sel.history ? s.x1 : x(b.last + ext) });
    }
  }

  /** Opis w legendzie (z ostatniego wyboru). */
  legend(): { text: string; color: string }[] {
    const last = this.vbars[this.vbars.length - 1];
    return effortLegend(this.sel, this.ms, last ? last.t : this.now);
  }

  /** Wybór na ostatniej zamkniętej świecy (legenda, testy). */
  selection(): EffortSelection | null {
    return this.sel;
  }
}
