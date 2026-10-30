import type {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  Logical,
  PrimitiveHoveredItem,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import { fmtVol } from '../../orderflow/footprint';
import { buildHeatLut } from '../../orderflow/heatColor';
import { fmtCompact } from '../../../ui/format';
import { type BookFrame, type BookHistory, type LargeLot, largeLots, lotThreshold } from '../core/book';
import { Burst, DEFAULT_THRESHOLD_USD, OrderClass, Wall, bursts, classify } from '../core/clashes';
import type { AggressorOrder } from '../core/orders';
import type { ProBar } from '../store/proStore';
import { logicalOfTime } from './overlay';
import { DOM_W_PX, LIQ_RAMP, MONO, PRO, rgba } from './theme';

/**
 * Warstwa płynności pod świecami i nad nimi: mapa ciepła arkusza zleceń w czasie (migawki l2Book,
 * każda obowiązuje do następnej; agregacja daleka (10 × większy krok) pod bliską), bąble zleceń
 * agresora (pole ∝ wartość USD; bitwa z jednym dużym makerem w podwójnym pierścieniu), serie małych
 * zleceń (przerywany pierścień), ściany makerów (pozioma belka na cenie), duże zlecenia oczekujące w arkuszu
 * (cienka linia przez czas ich trwania) i drabina DOM z bieżącym arkuszem przy prawej krawędzi. Wszystko powstaje
 * z danych na żywo od otwarcia strony.
 */

export interface LiquidityToggles {
  showHeatmap: boolean;
  showBubbles: boolean;
  showClashes: boolean;
  showLots: boolean;
}

/** Źródła danych warstwy (magazyn wykresu). */
export interface LiquiditySource {
  near: BookHistory | null;
  far: BookHistory | null;
  orders: (from: number, to: number) => AggressorOrder[];
  walls: (from: number, to: number, t: number) => Wall[];
}

/** Obiekt pod kliknięciem: zlecenie agresora (z klasą), seria albo ściana. */
export type LiquidityPick =
  | { kind: 'order'; order: AggressorOrder; cls: OrderClass | null }
  | { kind: 'burst'; burst: Burst }
  | { kind: 'wall'; wall: Wall };

/**
 * Bąble: w widoku zostaje najwyżej ~0,6 bąbla na świecę (największe), żeby przy zbliżeniu nie zasłaniały
 * liczb footprintu; zlecenia podświetlonego adresu są zawsze widoczne, także poniżej progu.
 */
const BUBBLE_PER_BAR = 0.6;
const BUBBLE_MIN_COUNT = 8;
const BUBBLE_MAX_COUNT = 400;
const BUBBLE_R_MIN = 3;
const BUBBLE_R_MAX = 22;
/** Podpis (wielkość w jednostkach rynku) od tego promienia (px). */
const BUBBLE_LABEL_R = 13;
/** Zasięg kliknięcia poza obrysem bąbla i od belki ściany (px). */
const PICK_PX = 3;
/**
 * Duże zlecenie w arkuszu: średnie zlecenie poziomu w 1% największych z ostatnich LOT_WINDOW_MS bliskiego arkusza
 * (próg względny dla każdego rynku), nie niżej niż LOT_FLOOR × próg dużego zlecenia agresora (cienki arkusz nie
 * zapala się w całości); w widoku najwyżej LOT_MAX największych.
 */
export const LOT_FLOOR = 0.25;
const LOT_WINDOW_MS = 30 * 60_000;
const LOT_MAX = 40;
/**
 * Podpis od takiego czasu w arkuszu (ms): zlecenie, które postało, a nie mignęło w jednej–dwóch migawkach; świeże linie
 * przy prawej krawędzi nie zasłaniają poziomów. Linia ma co najmniej LOT_MIN_W_PX, żeby nie ginęła między bąblami.
 */
const LOT_LABEL_MIN_MS = 30_000;
const LOT_MIN_W_PX = 6;
/** Ściana: grubość belki i najmniejsza długość (px). */
const WALL_H_PX = 3;
const WALL_MIN_W_PX = 8;
/**
 * Drabina DOM: najdłuższy słupek (px) przy percentylu DOM_Q wielkości migawki (większe ściany mają pełny słupek,
 * a wielkość mówi liczba; skala pierwiastkowa, żeby jedna ściana nie spłaszczała reszty), wiek migawki,
 * po którym znika (ms), i najmniejsza wysokość wiersza z liczbą (px).
 */
const DOM_BAR_PX = DOM_W_PX - 22;
const DOM_Q = 0.95;
const DOM_STALE_MS = 30_000;
const DOM_LABEL_ROW_PX = 9;
/** Najmniejszy odstęp między liczbami drabiny (px). */
const DOM_LABEL_GAP_PX = 11;
/**
 * Skala mapy ciepła, osobno dla każdej agregacji arkusza: od percentylu HEAT_LO_Q (próg dolny — większość poziomów
 * jest przezroczysta, świece zostają widoczne) do percentylu HEAT_Q wielkości w widocznych migawkach (pełne
 * nasycenie). Liniowa — jasne kolory dostają tylko skupiska i ściany z górnych kilku procent.
 */
const HEAT_LO_Q = 0.6;
const HEAT_Q = 0.995;
const HEAT_SAMPLE = 12_000;
/** Migawka arkusza obowiązuje do następnej, najwyżej tyle ms (luka w nagraniu nie jest zamalowana starą migawką). */
const FRAME_MAX_MS = 60_000;
/** Krycie dalekiej agregacji względem bliskiej. */
const FAR_ALPHA = 0.6;

/**
 * Kule z cieniowaniem: jaśniejszy środek przesunięty ku górze, ciemniejszy brzeg i jasny obrys 1 px
 * (kolory stron z palety wykresu). Półprzezroczyste, żeby liczby footprintu pod nimi dało się odczytać.
 */
const K = {
  buyCore: rgba(PRO.bubbleBuy[0], 0.7),
  buyEdge: rgba(PRO.bubbleBuy[1], 0.55),
  buyRim: rgba(PRO.bubbleBuy[2], 0.9),
  sellCore: rgba(PRO.bubbleSell[0], 0.7),
  sellEdge: rgba(PRO.bubbleSell[1], 0.55),
  sellRim: rgba(PRO.bubbleSell[2], 0.9),
  label: '#ffffff',
  mark: PRO.warn,
  selected: '#ffffff',
  domBid: rgba(PRO.domBid, 0.92),
  domAsk: rgba(PRO.domAsk, 0.92),
  domText: PRO.domText,
  labelBg: rgba(PRO.bg, 0.85),
  /** Góra lodowa: romb na końcu belki i podpis „ICE”. */
  ice: '#7fe7ff',
  lotBid: PRO.buyInk,
  lotAsk: PRO.sellInk,
};

interface Bubble {
  x: number;
  y: number;
  r: number;
  buy: boolean;
  label: string;
  /** Bitwa (podwójny pierścień), seria (przerywany obrys), zlecenie podświetlonego adresu, zaznaczenie. */
  clash: boolean;
  burst: boolean;
  mark: boolean;
  dim: boolean;
  selected: boolean;
  pick: LiquidityPick;
}

/** Wartość przy belce ściany albo linii dużego zlecenia [x0, x1] (`ink` — kolor tekstu). */
interface ValueLabel {
  x0: number;
  x1: number;
  y: number;
  bid: boolean;
  usd: number;
  label: string;
  ink: string;
  /**
   * Pierwszeństwo podpisu: 2 — góra lodowa (pierwsza i nad bąblami, z definicji leży pod wieloma zleceniami agresora),
   * 1 — duże zlecenie stojące co najmniej 30 s (nad bąblami, gdy przy linii nie ma wolnego miejsca; stoi tam, gdzie
   * handlują agresorzy), 0 — ściana (ustępuje bąblom, wartość pokazuje karta po kliknięciu belki).
   */
  rank: 0 | 1 | 2;
}

/** Ściana makera: belka od pierwszego do ostatniego wchłoniętego wypełnienia. */
interface WallMark extends ValueLabel {
  iceberg: boolean;
  selected: boolean;
  pick: LiquidityPick;
}

/** Duże zlecenie w arkuszu: linia od pojawienia się do zniknięcia (do teraz, gdy nadal jest). */
interface LotMark extends ValueLabel {
  open: boolean;
}

/** Poziom arkusza w drabinie (px CSS panelu): górna krawędź, wysokość, długość słupka. */
interface DomRow {
  y: number;
  h: number;
  w: number;
  bid: boolean;
  label: string;
}

interface Geometry {
  /** x środka świecy 0 i odstęp świec (px). */
  xa: number;
  sp: number;
  /** Cena → y: y = a + b·cena (skala liniowa). */
  a: number;
  b: number;
  tFrom: number;
  tTo: number;
}

export class LiquidityLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;

  private toggles: LiquidityToggles;
  private bars: readonly ProBar[] = [];
  private ms = 60_000;
  private src: LiquiditySource = { near: null, far: null, orders: () => [], walls: () => [] };
  private now = 0;
  private threshold = DEFAULT_THRESHOLD_USD;
  private highlight = '';
  private selected: LiquidityPick | null = null;
  private geo: Geometry | null = null;
  private bubbles: Bubble[] = [];
  private walls: WallMark[] = [];
  private lots: LotMark[] = [];
  private lotCache: { key: string; lots: LargeLot[] } = { key: '', lots: [] };
  private dom: DomRow[] = [];
  private domRight = 0;
  /** Drabina DOM przy prawej krawędzi (na telefonie jest osobną kartą). */
  private domOn = true;

  private readonly lut = buildHeatLut(LIQ_RAMP);
  /** Daleka agregacja przygaszona: tło dla szerszego widoku, bez ostrej granicy z dokładnym arkuszem przy cenie. */
  private readonly lutFar = buildHeatLut(LIQ_RAMP.map((s) => ({ ...s, alpha: s.alpha * FAR_ALPHA })));
  private readonly tex = document.createElement('canvas');
  private texKey = '';
  /** Piksele tekstury i ostatnie migawki warstw z pełnego malowania — upływ czasu domalowuje tylko nowe kolumny. */
  private texImg: ImageData | null = null;
  private tail: HeatTail[] = [];
  /** Historie arkusza z pełnego malowania (nowa historia, np. po przewinięciu powtórki, zaczyna wersje od zera). */
  private texSrc: readonly (BookHistory | null)[] = [];
  private readonly views: readonly IPrimitivePaneView[];

  constructor(toggles: LiquidityToggles) {
    this.toggles = toggles;
    const heat: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context, mediaSize }) => {
          if (!this.toggles.showHeatmap || !this.renderHeat(Math.ceil(mediaSize.width), Math.ceil(mediaSize.height))) return;
          context.imageSmoothingEnabled = false;
          context.drawImage(this.tex, 0, 0);
        }),
    };
    const bubbles: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
          drawLots(context, this.lots, hr, vr);
          drawWalls(context, this.walls, hr, vr);
          drawBubbles(context, this.bubbles, hr, vr);
        }),
    };
    // Podpisy nad poziomami wskaźników (IB, VWAP…), żeby napisu ICE nie przykrywała etykieta poziomu
    const labels: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useBitmapCoordinateSpace(({ context, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }) =>
          drawValueLabels(context, [...this.walls, ...this.lots], this.bubbles, bitmapSize.width, hr, vr)
        ),
    };
    const dom: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio: hr, verticalPixelRatio: vr }) =>
          drawDom(context, this.dom, this.domRight, hr, vr)
        ),
    };
    this.views = [
      { zOrder: () => 'bottom', renderer: () => heat },
      { zOrder: () => 'normal', renderer: () => bubbles },
      { zOrder: () => 'normal', renderer: () => dom },
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

  setToggles(t: LiquidityToggles): void {
    this.toggles = t;
    this.requestUpdate?.();
  }

  setDom(on: boolean): void {
    this.domOn = on;
    this.requestUpdate?.();
  }

  setData(bars: readonly ProBar[], intervalMs: number, src: LiquiditySource, now: number, threshold: number): void {
    this.bars = bars;
    this.ms = intervalMs;
    this.src = src;
    this.now = now;
    this.threshold = threshold;
    this.requestUpdate?.();
  }

  /** Podświetla wszystkie zlecenia agresora adresu ('' = bez podświetlenia); adres zostaje tylko w pamięci. */
  setHighlight(address: string): void {
    this.highlight = address;
    this.requestUpdate?.();
  }

  setSelected(p: LiquidityPick | null): void {
    this.selected = p;
    this.requestUpdate?.();
  }

  updateAllViews(): void {
    this.geo = this.geometry();
    this.bubbles = this.toggles.showBubbles && this.geo ? this.sceneBubbles(this.geo) : [];
    this.walls = this.toggles.showBubbles && this.toggles.showClashes && this.geo ? this.sceneWalls(this.geo) : [];
    this.lots = this.toggles.showLots && this.geo ? this.sceneLots(this.geo) : [];
    this.dom = this.toggles.showHeatmap && this.domOn && this.geo ? this.sceneDom(this.geo) : [];
  }

  /** Bąbel, seria albo ściana pod punktem (px CSS panelu); najpierw to, co narysowane na wierzchu. */
  pick(x: number, y: number): LiquidityPick | null {
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      if (Math.hypot(x - b.x, y - b.y) <= b.r + PICK_PX) return b.pick;
    }
    for (const w of this.walls) if (Math.abs(y - w.y) <= WALL_H_PX / 2 + PICK_PX && x >= w.x0 - PICK_PX && x <= w.x1 + PICK_PX) return w.pick;
    return null;
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    return this.pick(x, y) ? { externalId: 'liquidity', zOrder: 'normal', cursorStyle: 'pointer', hitTestPriority: 2 } : null;
  }

  private geometry(): Geometry | null {
    const chart = this.chart;
    const series = this.series;
    const bars = this.bars;
    if (!chart || !series || bars.length === 0) return null;
    const ts = chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    const xa = ts.logicalToCoordinate(0 as Logical);
    const xb = ts.logicalToCoordinate(1 as Logical);
    if (!range || xa === null || xb === null || !(xb > xa)) return null;
    const p0 = bars[bars.length - 1].candle.c;
    const y0 = series.priceToCoordinate(p0);
    const y1 = series.priceToCoordinate(p0 + 1000);
    if (y0 === null || y1 === null) return null;
    const b = (y1 - y0) / 1000;
    const vf = Math.max(0, Math.floor(range.from));
    const tFrom = vf < bars.length ? bars[vf].t : bars[bars.length - 1].t;
    return { xa, sp: xb - xa, a: y0 - b * p0, b, tFrom, tTo: this.now + 1 };
  }

  private x(t: number, g: Geometry): number {
    return g.xa + (logicalOfTime(this.bars, t, this.ms) - 0.5) * g.sp;
  }

  // ───────────────────────── mapa ciepła ─────────────────────────

  /**
   * Tekstura mapy ciepła w pikselach CSS panelu. Pełne malowanie tylko po zmianie widoku albo nowej migawce; między
   * migawkami upływ czasu wydłuża tylko ostatnią migawkę każdej warstwy, więc domalowane są same nowe kolumny
   * (z normą z pełnego malowania).
   */
  private renderHeat(W: number, H: number): boolean {
    const g = this.geo;
    const { near, far } = this.src;
    if (!g || !(W > 0) || !(H > 0) || (!near && !far)) return false;
    const ctx = this.tex.getContext('2d');
    if (!ctx) return false;
    // Daleka agregacja najpierw; bliska (dokładniejsza) zastępuje ją w całym swoim zakresie cen, także tam,
    // gdzie jej poziomy są przezroczyste — inaczej przez słabe poziomy prześwitywałyby grube pasy dalekiej
    const layers = [far, near].map((h) => (h ? h.range(g.tFrom, g.tTo) : []));
    // Ostatnia migawka w zakresie w kluczu: migawka z czasem giełdy chwilę przed zegarem strony wchodzi, gdy czas ją dogoni
    const key = `${W}|${H}|${g.xa.toFixed(2)}|${g.sp.toFixed(4)}|${g.a.toFixed(3)}|${g.b.toFixed(6)}|${near?.version}|${far?.version}|${layers.map((l) => l.at(-1)?.t).join('|')}`;
    if (key === this.texKey && this.texImg && this.texSrc[0] === near && this.texSrc[1] === far) {
      this.paintTail(ctx, this.texImg, W, H, g);
      return true;
    }
    this.texKey = key;
    this.texSrc = [near, far];
    this.tail = [];
    if (this.tex.width !== W || this.tex.height !== H) {
      this.tex.width = W;
      this.tex.height = H;
    }
    const img = ctx.createImageData(W, H);
    this.texImg = img;
    const px = new Uint32Array(img.data.buffer);
    for (let li = 0; li < 2; li++) {
      const frames = layers[li];
      if (frames.length === 0) continue;
      const isNear = li === 1;
      const norm = heatNorm(frames);
      const lut = isNear ? this.lut : this.lutFar;
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        const x0 = Math.max(0, Math.round(this.x(f.t, g)));
        const x1 = Math.min(W, Math.max(x0 + 1, Math.round(this.x(Math.min(frames[i + 1]?.t ?? this.now, f.t + FRAME_MAX_MS), g))));
        if (i === frames.length - 1) this.tail.push({ f, x0, x1, norm, lut, clear: isNear });
        if (x1 <= 0 || x0 >= W) continue;
        if (isNear) clearSpan(px, W, H, f, x0, x1, g);
        paintFrame(px, W, H, f, x0, x1, g, norm, lut);
      }
    }
    ctx.putImageData(img, 0, 0);
    return true;
  }

  /** Domalowanie kolumn od poprzedniej prawej krawędzi ostatniej migawki do bieżącej chwili (w tej samej kolejności warstw). */
  private paintTail(ctx: CanvasRenderingContext2D, img: ImageData, W: number, H: number, g: Geometry): void {
    const px = new Uint32Array(img.data.buffer);
    let lo = W;
    let hi = 0;
    for (const s of this.tail) {
      const x1 = Math.min(W, Math.max(s.x0 + 1, Math.round(this.x(Math.min(this.now, s.f.t + FRAME_MAX_MS), g))));
      const x0 = Math.max(0, s.x1);
      s.x1 = Math.max(s.x1, x1);
      if (x1 <= x0) continue;
      if (s.clear) clearSpan(px, W, H, s.f, x0, x1, g);
      paintFrame(px, W, H, s.f, x0, x1, g, s.norm, s.lut);
      lo = Math.min(lo, x0);
      hi = Math.max(hi, x1);
    }
    if (hi > lo) ctx.putImageData(img, 0, 0, lo, 0, hi - lo, H);
  }

  // ───────────────────────── bąble ─────────────────────────

  private sceneBubbles(g: Geometry): Bubble[] {
    const t = this.threshold;
    const all = this.src.orders(g.tFrom, g.tTo);
    let list = all.filter((o) => o.notional >= t);
    const bars = (g.tTo - g.tFrom) / this.ms;
    const cap = Math.round(Math.min(BUBBLE_MAX_COUNT, Math.max(BUBBLE_MIN_COUNT, bars * BUBBLE_PER_BAR)));
    if (list.length > cap) list = list.sort((p, q) => q.notional - p.notional).slice(0, cap);
    const hl = this.highlight;
    if (hl) {
      const shown = new Set(list);
      for (const o of all) if (o.taker === hl && !shown.has(o)) list.push(o);
    }
    const series = this.toggles.showClashes ? bursts(all, t) : [];
    if (list.length === 0 && series.length === 0) return [];
    let max = 0;
    for (const o of list) if (o.notional > max) max = o.notional;
    for (const b of series) if (b.usd > max) max = b.usd;
    // Pole koła proporcjonalne do wartości (USD)
    const radius = (usd: number) => Math.max(BUBBLE_R_MIN, BUBBLE_R_MAX * Math.sqrt(usd / max));
    const sel = this.selected;
    const out: Bubble[] = [];
    for (const o of list) {
      const r = radius(o.notional);
      const cls = classify(o, t);
      const mark = hl !== '' && o.taker === hl;
      out.push({
        x: this.x(o.time, g),
        y: g.a + g.b * o.vwap,
        r,
        buy: o.side === 1,
        label: r >= BUBBLE_LABEL_R ? fmtVol(o.sz) : '',
        clash: cls === 'clash',
        burst: false,
        mark,
        dim: hl !== '' && !mark,
        selected: sel?.kind === 'order' && sel.order === o,
        pick: { kind: 'order', order: o, cls },
      });
    }
    for (const b of series) {
      const r = radius(b.usd);
      out.push({
        x: this.x((b.from + b.to) / 2, g),
        y: g.a + g.b * b.vwap,
        r,
        buy: b.side === 1,
        label: r >= BUBBLE_LABEL_R ? fmtVol(b.sz) : '',
        clash: false,
        burst: true,
        mark: false,
        dim: hl !== '',
        selected: sel?.kind === 'burst' && sel.burst.from === b.from && sel.burst.side === b.side,
        pick: { kind: 'burst', burst: b },
      });
    }
    // Mniejsze na wierzchu — nie giną pod dużymi
    return out.sort((p, q) => q.r - p.r);
  }

  private sceneWalls(g: Geometry): WallMark[] {
    const sel = this.selected;
    return this.src.walls(g.tFrom, g.tTo, this.threshold).map((w) => {
      const x0 = this.x(w.from, g);
      return {
        x0,
        x1: Math.max(x0 + WALL_MIN_W_PX, this.x(w.to, g)),
        y: g.a + g.b * w.px,
        bid: w.side === 1,
        usd: w.usd,
        label: w.iceberg ? `ICE ${fmtCompact(w.usd)}` : fmtCompact(w.usd),
        ink: w.iceberg ? K.ice : K.domText,
        rank: w.iceberg ? 2 : 0,
        iceberg: w.iceberg,
        selected: sel?.kind === 'wall' && sel.wall.from === w.from && sel.wall.px === w.px && sel.wall.side === w.side,
        pick: { kind: 'wall', wall: w },
      };
    });
  }

  /** Duże zlecenia bliskiego arkusza w widocznym czasie (przeliczane po nowej migawce, zmianie zakresu albo progu). */
  private sceneLots(g: Geometry): LotMark[] {
    const near = this.src.near;
    if (!near) return [];
    const floor = this.threshold * LOT_FLOOR;
    const key = `${near.step}|${near.version}|${g.tFrom}|${floor}`;
    if (this.lotCache.key !== key) {
      const minUsd = lotThreshold(near.range(this.now - LOT_WINDOW_MS, this.now), floor);
      this.lotCache = { key, lots: largeLots(near.range(g.tFrom, g.tTo), minUsd) };
    }
    const W = this.chart?.paneSize(0).width ?? 0;
    const out: LotMark[] = [];
    for (const l of this.lotCache.lots) {
      const x0 = this.x(l.from, g);
      const x1 = this.x(l.open ? this.now : l.to, g);
      if (x1 < 0 || x0 > W) continue;
      out.push({
        x0,
        x1: Math.max(x0 + LOT_MIN_W_PX, x1),
        y: g.a + g.b * l.px,
        bid: l.bid,
        usd: l.usd,
        label: (l.open ? this.now : l.to) - l.from >= LOT_LABEL_MIN_MS ? `${l.orders}× ${fmtCompact(l.usd / l.orders)}` : '',
        ink: l.bid ? K.lotBid : K.lotAsk,
        rank: 1,
        open: l.open,
      });
    }
    return out.length > LOT_MAX ? out.sort((p, q) => q.usd - p.usd).slice(0, LOT_MAX) : out;
  }

  // ───────────────────────── drabina DOM ─────────────────────────

  /** Bieżący bliski arkusz: słupki od prawej krawędzi panelu w lewo, długość ∝ wielkość poziomu. */
  private sceneDom(g: Geometry): DomRow[] {
    const f = this.src.near?.latest();
    const W = this.chart?.paneSize(0).width ?? 0;
    if (!f || f.sz.length === 0 || this.now - f.t > DOM_STALE_MS || !(W > DOM_W_PX)) return [];
    const sorted = Array.from(f.sz).sort((p, q) => p - q);
    const norm = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * DOM_Q))];
    if (!(norm > 0)) return [];
    this.domRight = W;
    const half = f.step / 2;
    const out: DomRow[] = [];
    for (let i = 0; i < f.px.length; i++) {
      const ya = g.a + g.b * (f.px[i] + half);
      const yb = g.a + g.b * (f.px[i] - half);
      out.push({ y: Math.min(ya, yb), h: Math.abs(yb - ya), w: DOM_BAR_PX * Math.sqrt(Math.min(1, f.sz[i] / norm)), bid: i < f.nBids, label: fmtVol(f.sz[i]) });
    }
    return out;
  }
}

/** Wielkości (jednostki rynku) przy percentylach HEAT_LO_Q i HEAT_Q z próbki poziomów widocznych migawek. */
function heatNorm(frames: readonly BookFrame[]): HeatScale {
  let total = 0;
  for (const f of frames) total += f.sz.length;
  const stride = Math.max(1, Math.ceil(total / HEAT_SAMPLE));
  const sample: number[] = [];
  let k = 0;
  for (const f of frames) {
    for (let i = 0; i < f.sz.length; i++, k++) if (k % stride === 0) sample.push(f.sz[i]);
  }
  if (sample.length === 0) return { lo: 0, span: 0 };
  sample.sort((p, q) => p - q);
  const at = (q: number) => sample[Math.min(sample.length - 1, Math.floor(sample.length * q))];
  const lo = at(HEAT_LO_Q);
  return { lo, span: at(HEAT_Q) - lo };
}

interface HeatScale {
  lo: number;
  span: number;
}

/** Ostatnia migawka warstwy z pełnego malowania: kolumny [x0, x1) i to, czym je domalować. */
interface HeatTail {
  f: BookFrame;
  x0: number;
  x1: number;
  norm: HeatScale;
  lut: Uint32Array;
  /** Bliska agregacja czyści swój zakres cen (zastępuje daleką). */
  clear: boolean;
}

/** Czyści teksturę w zakresie cen migawki (od najniższego do najwyższego poziomu) i jej kolumnach. */
function clearSpan(px: Uint32Array, W: number, H: number, f: BookFrame, x0: number, x1: number, g: Geometry): void {
  if (f.px.length === 0) return;
  let lo = f.px[0];
  let hi = f.px[0];
  for (let i = 1; i < f.px.length; i++) {
    if (f.px[i] < lo) lo = f.px[i];
    else if (f.px[i] > hi) hi = f.px[i];
  }
  const half = f.step / 2;
  let ya = Math.round(g.a + g.b * (hi + half));
  let yb = Math.round(g.a + g.b * (lo - half));
  if (ya > yb) [ya, yb] = [yb, ya];
  ya = Math.max(0, ya);
  yb = Math.min(H, yb);
  for (let y = ya; y < yb; y++) px.fill(0, y * W + x0, y * W + x1);
}

function paintFrame(px: Uint32Array, W: number, H: number, f: BookFrame, x0: number, x1: number, g: Geometry, norm: HeatScale, lut: Uint32Array): void {
  const half = f.step / 2;
  for (let i = 0; i < f.px.length; i++) {
    const t = norm.span > 0 ? Math.min(1, (f.sz[i] - norm.lo) / norm.span) : 0;
    if (t <= 0.02) continue;
    const c = lut[Math.min(255, Math.round(t * 255))];
    let ya = Math.round(g.a + g.b * (f.px[i] + half));
    let yb = Math.round(g.a + g.b * (f.px[i] - half));
    if (ya > yb) [ya, yb] = [yb, ya];
    ya = Math.max(0, ya);
    yb = Math.min(H, Math.max(ya + 1, yb));
    for (let y = ya; y < yb; y++) px.fill(c, y * W + x0, y * W + x1);
  }
}

function drawBubbles(ctx: CanvasRenderingContext2D, list: readonly Bubble[], hr: number, vr: number): void {
  if (list.length === 0) return;
  const k = Math.min(hr, vr);
  const lw = Math.max(1, Math.round(k));
  ctx.font = `600 ${Math.round(10 * k)}px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const b of list) {
    const x = b.x * hr;
    const y = b.y * vr;
    const r = b.r * k;
    ctx.globalAlpha = b.dim ? 0.3 : 1;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (b.burst) {
      // Seria: pusty środek, przerywany obrys
      ctx.fillStyle = b.buy ? K.buyEdge : K.sellEdge;
      ctx.globalAlpha *= 0.45;
      ctx.fill();
      ctx.globalAlpha = b.dim ? 0.3 : 1;
      ctx.setLineDash([3 * k, 2.5 * k]);
      ctx.lineWidth = 1.5 * k;
    } else {
      const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
      grad.addColorStop(0, b.buy ? K.buyCore : K.sellCore);
      grad.addColorStop(1, b.buy ? K.buyEdge : K.sellEdge);
      ctx.fillStyle = grad;
      ctx.fill();
    }
    ctx.strokeStyle = b.buy ? K.buyRim : K.sellRim;
    ctx.stroke();
    ctx.setLineDash([]);
    if (b.clash) {
      // Bitwa: drugi pierścień
      ctx.beginPath();
      ctx.arc(x, y, r + 3 * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (b.mark || b.selected) {
      ctx.beginPath();
      ctx.arc(x, y, r + (b.clash ? 6 : 3) * k, 0, Math.PI * 2);
      ctx.strokeStyle = b.selected ? K.selected : K.mark;
      ctx.lineWidth = 2 * k;
      ctx.stroke();
    }
    if (b.label) {
      ctx.fillStyle = K.label;
      ctx.fillText(b.label, x, y);
    }
  }
  ctx.globalAlpha = 1;
}

/** Linie dużych zleceń: pełne, gdy zlecenie nadal jest w arkuszu, przygaszone po zniknięciu. */
function drawLots(ctx: CanvasRenderingContext2D, list: readonly LotMark[], hr: number, vr: number): void {
  const h = Math.max(1, Math.round(1.5 * vr));
  for (const l of list) {
    ctx.globalAlpha = l.open ? 1 : 0.55;
    ctx.fillStyle = l.bid ? K.lotBid : K.lotAsk;
    const x0 = Math.round(l.x0 * hr);
    ctx.fillRect(x0, Math.round(l.y * vr - h / 2), Math.round(l.x1 * hr) - x0, h);
  }
  ctx.globalAlpha = 1;
}

function drawWalls(ctx: CanvasRenderingContext2D, list: readonly WallMark[], hr: number, vr: number): void {
  if (list.length === 0) return;
  const h = Math.max(2, Math.round(WALL_H_PX * vr));
  for (const w of list) {
    const x0 = Math.round(w.x0 * hr);
    const x1 = Math.round(w.x1 * hr);
    const y = Math.round(w.y * vr - h / 2);
    if (w.selected) {
      ctx.fillStyle = K.selected;
      ctx.fillRect(x0 - 2, y - 2, x1 - x0 + 4, h + 4);
    }
    ctx.fillStyle = w.bid ? K.domBid : K.domAsk;
    ctx.fillRect(x0, y, x1 - x0, h);
    if (w.iceberg) {
      const r = Math.round(4 * vr);
      const cy = y + h / 2;
      ctx.fillStyle = K.ice;
      ctx.beginPath();
      ctx.moveTo(x1 + r, cy - r);
      ctx.lineTo(x1 + 2 * r, cy);
      ctx.lineTo(x1 + r, cy + r);
      ctx.lineTo(x1, cy);
      ctx.closePath();
      ctx.fill();
    }
  }
}

/**
 * Wartość ściany albo dużego zlecenia na tle przed jego początkiem (przy lewej krawędzi, gdy początek jest poza
 * widokiem), a gdy tam zajęte — za końcem belki. Najpierw góry lodowe, potem duże zlecenia, potem ściany, w każdej
 * grupie większe; podpis nigdy nie nachodzi na inny podpis, a na bąbel tylko z pierwszeństwem (`rank`).
 */
function drawValueLabels(ctx: CanvasRenderingContext2D, list: readonly ValueLabel[], bubbles: readonly Bubble[], width: number, hr: number, vr: number): void {
  if (list.length === 0) return;
  ctx.font = `600 ${Math.round(10 * vr)}px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const pad = Math.round(3 * hr);
  const gap = Math.round(4 * hr);
  const th = Math.round(13 * vr);
  const placed: Rect[] = [];
  const clear = (q: Rect) => !placed.some((p) => q.l < p.r && q.r > p.l && q.t < p.b && q.b > p.t);
  const open = (q: Rect) => !bubbles.some((b) => circleHitsRect(b, q));
  for (const w of [...list].sort((p, q) => q.rank - p.rank || q.usd - p.usd)) {
    if (!w.label) continue;
    const tw = Math.ceil(ctx.measureText(w.label).width);
    const y = Math.round(w.y * vr);
    // Prawa krawędź tekstu: przed belką albo za nią; prostokąt etykiety w px CSS (bąble też są w px CSS)
    const before = Math.max(tw + 2 * pad, Math.round(w.x0 * hr) - gap);
    const after = Math.round(w.x1 * hr) + gap + pad + tw;
    const rect = (xr: number): Rect => ({ l: (xr - tw - pad) / hr, r: (xr + pad) / hr, t: (y - th / 2) / vr, b: (y + th / 2) / vr });
    const spots = after + pad <= width ? [before, after] : [before];
    const xr =
      spots.find((x) => clear(rect(x)) && (w.rank === 2 || open(rect(x)))) ?? (w.rank === 1 ? spots.find((x) => clear(rect(x))) : undefined);
    if (xr === undefined) continue;
    placed.push(rect(xr));
    ctx.fillStyle = K.labelBg;
    ctx.fillRect(xr - tw - pad, y - th / 2, tw + 2 * pad, th);
    // Znacznik strony od strony belki
    const edge = Math.max(1, Math.round(hr));
    ctx.fillStyle = w.bid ? K.domBid : K.domAsk;
    ctx.fillRect(xr === before ? xr + pad - edge : xr - tw - pad, y - th / 2, edge, th);
    ctx.fillStyle = w.ink;
    ctx.fillText(w.label, xr, y);
  }
}

interface Rect {
  l: number;
  r: number;
  t: number;
  b: number;
}

function circleHitsRect(c: { x: number; y: number; r: number }, q: Rect): boolean {
  const dx = Math.max(q.l - c.x, 0, c.x - q.r);
  const dy = Math.max(q.t - c.y, 0, c.y - q.b);
  return dx * dx + dy * dy < (c.r + 1) ** 2;
}

function drawDom(ctx: CanvasRenderingContext2D, rows: readonly DomRow[], right: number, hr: number, vr: number): void {
  if (rows.length === 0) return;
  const xr = Math.round(right * hr);
  const gap = Math.max(1, Math.round(vr));
  ctx.font = `500 ${Math.round(10 * vr)}px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  // Liczba tylko wtedy, gdy nie nachodzi na poprzednią (gęsta drabina przy oddaleniu)
  let lastY = Number.NEGATIVE_INFINITY;
  const minGap = DOM_LABEL_GAP_PX * vr;
  for (const r of rows) {
    const y = Math.round(r.y * vr);
    const h = Math.max(1, Math.round(r.h * vr) - (r.h >= 4 ? gap : 0));
    const w = Math.max(1, Math.round(r.w * hr));
    ctx.fillStyle = r.bid ? K.domBid : K.domAsk;
    ctx.fillRect(xr - w, y, w, h);
    const ty = y + h / 2;
    if (r.h >= DOM_LABEL_ROW_PX && Math.abs(ty - lastY) >= minGap) {
      ctx.fillStyle = K.domText;
      ctx.fillText(r.label, xr - w - Math.round(3 * hr), ty);
      lastY = ty;
    }
  }
}
