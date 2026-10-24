import type {
  AutoscaleInfo,
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  Logical,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import { fmtCompact } from '../../../ui/format';
import { spreadTags } from '../../orderflow/renderer';
import { hlTick } from '../core/footprintBar';
import {
  DayLevels,
  DevelopingLevels,
  IB_EXTENSIONS,
  IndicatorScope,
  InitialBalance,
  LiqLevel,
  VolumeProfile,
  VwapPoint,
  dayLevels,
  developingProfile,
  indicatorScope,
  initialBalances,
  nakedPocs,
  periodRanges,
  volumeProfile,
  vwapSeries,
} from '../core/indicators';
import { SESSION_LABEL, sessionsBetween } from '../core/sessions';
import { DAY } from '../core/time';
import { type WhaleLayer, groupWhaleOrders } from '../../../utils/whaleLayer';
import type { Candle } from '../hl/parse';
import type { ProBar } from '../store/proStore';
import { autoRowStep, fmtPx } from './layout';
import type { ChartSettings } from './settings';
import { MONO, PRO, rgba } from './theme';
import { lang, tr } from '../../../i18n';

/**
 * Warstwa wskaźników nad główną serią: VWAP z pasmami ±1σ i ±2σ, VWAP sesji, profil wolumenu widocznego
 * zakresu z POC i value area, profile sesji (albo dób) z nagimi POC, rozwijający się POC i value area, poziomy dnia (PDH, PDL, otwarcie),
 * otwarcia sesji, initial balance z rozszerzeniami, klastry likwidacji i wieloryby. Wypełnienia i profil leżą pod świecami, linie i etykiety nad nimi.
 * Geometria liczona w `updateAllViews` (współrzędne ekranu), rysowanie w pikselach urządzenia.
 */

export type IndicatorToggles = Pick<
  ChartSettings,
  | 'showVwap'
  | 'showVwapBands'
  | 'showSessionVwap'
  | 'showProfile'
  | 'showPeriodProfiles'
  | 'showDevPoc'
  | 'showLevels'
  | 'showSessions'
  | 'showIb'
  | 'showLiq'
  | 'showWhales'
>;

/** Wieloryby rynku z pliku skanera (pozycje i zlecenia od największych). */
export type WhaleView = Pick<WhaleLayer['markets'][string], 'positions' | 'orders'>;

/** Wartości wskaźników świecy pod krzyżem (legenda). */
export interface IndicatorValues {
  vwap: VwapPoint | null;
  svwap: VwapPoint | null;
  /** Okres głównego VWAP (doba albo tydzień). */
  anchor: IndicatorScope['vwapAnchor'];
}

const K = {
  vwap: PRO.vwap,
  vwapBand1: rgba(PRO.vwap, 0.06),
  vwapBand2: rgba(PRO.vwap, 0.03),
  vwapEdge1: rgba(PRO.vwap, 0.32),
  vwapEdge2: rgba(PRO.vwap, 0.18),
  svwap: PRO.svwap,
  level: PRO.level,
  dayOpen: rgba(PRO.ink2, 0.6),
  ib: PRO.series1,
  ibFill: rgba(PRO.series1, 0.08),
  ibLine: rgba(PRO.series1, 0.75),
  ibExt: rgba(PRO.series1, 0.5),
  session: rgba(PRO.ink3, 0.38),
  sessionText: rgba(PRO.ink3, 0.9),
  vpOut: rgba(PRO.profileOut, 0.5),
  vpVa: rgba(PRO.profileVa, 0.7),
  vpPoc: rgba(PRO.profilePoc, 0.85),
  pocLine: rgba(PRO.profilePoc, 0.5),
  vaLine: rgba(PRO.ink2, 0.4),
  spOut: rgba(PRO.profileOut, 0.42),
  spVa: rgba(PRO.profileVa, 0.6),
  spPocLine: PRO.profilePoc,
  nPocLine: PRO.nakedPoc,
  devPoc: rgba(PRO.pocFrame, 0.85),
  devVa: rgba(PRO.pocFrame, 0.4),
  liqLong: PRO.sellInk,
  liqShort: PRO.buyInk,
  liqLongLine: rgba(PRO.sellInk, 0.55),
  liqShortLine: rgba(PRO.buyInk, 0.55),
  whaleLong: PRO.buyInk,
  whaleShort: PRO.sellInk,
  whaleLongLine: rgba(PRO.buyInk, 0.45),
  whaleShortLine: rgba(PRO.sellInk, 0.45),
  whaleLiq: PRO.warn,
  whaleLiqLine: rgba(PRO.warn, 0.45),
  tagBg: rgba(PRO.bg, 0.88),
  axisText: PRO.page,
} as const;

const DASH = { none: [] as number[], level: [6, 4], dot: [2, 3], session: [3, 4], ext: [4, 4], liq: [1, 3], whale: [8, 3, 2, 3] };
/** Wieloryby: tyle największych pozycji i grup zleceń w widoku; zlecenie to kreska tej długości przy prawej krawędzi (px). */
const WHALE_POSITIONS = 4;
const WHALE_ORDERS = 6;
const WHALE_TICK_PX = 56;
/** Profil widocznego zakresu: szerokość jako ułamek panelu (z ograniczeniami w px) i minimalna wysokość wiersza. */
const PROFILE_WIDTH = 0.2;
const PROFILE_MIN_PX = 56;
const PROFILE_MAX_PX = 200;
const PROFILE_ROW_PX = 4;
/** Profil sesji: najwyżej taki ułamek szerokości okresu i tyle px (świece obok zostają czytelne); nagie POC — najwyżej tyle ostatnich. */
const PERIOD_PROFILE_WIDTH = 0.25;
const PERIOD_PROFILE_MAX_PX = 120;
const NAKED_POC_MAX = 8;
/** Od tylu widocznych świec VWAP wchodzi do autoskali. */
const AUTOSCALE_MIN_BARS = 40;
const TAG_H = 15;

/** Pozycja logiczna chwili `t` na osi świec co `ms`: indeks świecy plus ułamek jej trwania (także przed i za danymi). */
export function logicalOfTime(bars: readonly { t: number }[], t: number, ms: number): number {
  const n = bars.length;
  if (n === 0) return Number.NaN;
  if (t < bars[0].t) return (t - bars[0].t) / ms;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bars[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  const into = t - bars[lo].t;
  return lo + (lo === n - 1 ? into : Math.min(into, ms)) / ms;
}

// ───────────────────────── scena ─────────────────────────

interface HLine {
  x0: number;
  x1: number;
  y: number;
  color: string;
  dash: number[];
}
interface VLine {
  x: number;
  color: string;
  dash: number[];
}
interface Poly {
  /** Pary x, y. */
  pts: number[];
  color: string;
  width: number;
  dash?: number[];
}
interface Fill {
  pts: number[];
  color: string;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}
interface Text {
  x: number;
  y: number;
  text: string;
  color: string;
  align: CanvasTextAlign;
  /** Tło pod napisem (podpis na linii). */
  bg?: boolean;
}
interface Tag {
  y: number;
  text: string;
  color: string;
}

interface Scene {
  fills: Fill[];
  rects: Rect[];
  vlines: VLine[];
  hlines: HLine[];
  polys: Poly[];
  texts: Text[];
  tags: Tag[];
  /** Przesunięte etykiety (po rozsunięciu). */
  tagYs: number[];
  /** Prawa krawędź wskaźników (px CSS); 0 = krawędź panelu. */
  right: number;
}

const emptyScene = (): Scene => ({ fills: [], rects: [], vlines: [], hlines: [], polys: [], texts: [], tags: [], tagYs: [], right: 0 });

class AxisLabel implements ISeriesPrimitiveAxisView {
  y = 0;
  label = '';
  on = false;
  constructor(private readonly bg: string) {}
  coordinate(): number {
    return this.y;
  }
  text(): string {
    return this.label;
  }
  textColor(): string {
    return K.axisText;
  }
  backColor(): string {
    return this.bg;
  }
  visible(): boolean {
    return this.on;
  }
}

interface ProfileCache {
  key: string;
  profile: VolumeProfile | null;
}

/** Profil okresu z pamięci: przeliczany tylko, gdy zmieni się krok albo któraś świeca okresu. */
interface PeriodCache {
  step: number;
  refs: readonly ProBar[];
  profile: VolumeProfile | null;
}

/** Rozwijający się POC okresu z pamięci (te same zasady co profil okresu). */
interface DevCache {
  step: number;
  refs: readonly ProBar[];
  levels: (DevelopingLevels | null)[];
}

const sameRefs = (refs: readonly ProBar[], bars: readonly ProBar[], from: number, to: number): boolean => {
  if (refs.length !== to - from + 1) return false;
  for (let k = 0; k < refs.length; k++) if (refs[k] !== bars[from + k]) return false;
  return true;
};

export class IndicatorOverlay implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;

  private toggles: IndicatorToggles;
  private bars: readonly ProBar[] = [];
  private candles: Candle[] = [];
  private ms = 60_000;
  private scope: IndicatorScope = indicatorScope(60_000);
  private vwap: (VwapPoint | null)[] = [];
  private svwap: (VwapPoint | null)[] = [];
  private ibs: InitialBalance[] = [];
  private daily: readonly Candle[] = [];
  private days: DayLevels[] = [];
  private liq: LiqLevel[] = [];
  private whales: WhaleView | null = null;
  private profileCache: ProfileCache = { key: '', profile: null };
  private profileBars: readonly ProBar[] | null = null;
  private periodCache = new Map<number, PeriodCache>();
  private devCache = new Map<number, DevCache>();
  private rightInset = 0;
  /** Telefon: podpisy wielorybów tylko dotkniętej linii (klucz linii), reszta bez podpisu. */
  private compact = false;
  private whaleSel = '';
  private whaleHits: { y: number; key: string }[] = [];
  private scene: Scene = emptyScene();

  private readonly axisVwap = new AxisLabel(K.vwap);
  private readonly axisSvwap = new AxisLabel(K.svwap);
  private readonly axisPoc = new AxisLabel(rgba(PRO.ink2, 0.9));
  private readonly axisViews: readonly ISeriesPrimitiveAxisView[] = [this.axisPoc, this.axisSvwap, this.axisVwap];
  private readonly views: readonly IPrimitivePaneView[];

  constructor(toggles: IndicatorToggles) {
    this.toggles = toggles;
    const under: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => drawUnder(context, this.scene, hr, vr)),
    };
    const over: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }) =>
          drawOver(context, this.scene, hr, vr, bitmapSize.width, bitmapSize.height)
        ),
    };
    this.views = [
      { zOrder: () => 'bottom', renderer: () => under },
      { zOrder: () => 'normal', renderer: () => over },
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

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.axisViews;
  }

  setToggles(t: IndicatorToggles): void {
    this.toggles = t;
    this.requestUpdate?.();
  }

  /** Świece wykresu; wskaźniki z historii liczone od nowa tylko po zmianie którejś świecy z API. */
  setBars(bars: readonly ProBar[], intervalMs: number): void {
    this.bars = bars;
    let changed = intervalMs !== this.ms || bars.length !== this.candles.length;
    for (let i = bars.length - 1; i >= 0 && !changed; i--) changed = bars[i].candle !== this.candles[i];
    if (changed) {
      this.ms = intervalMs;
      this.scope = indicatorScope(intervalMs);
      this.candles = bars.map((b) => b.candle);
      this.vwap = vwapSeries(bars, this.scope.vwapAnchor);
      this.svwap = this.scope.sessionVwap ? vwapSeries(bars, 'session') : [];
      this.ibs = this.scope.ib ? initialBalances(bars, intervalMs) : [];
    }
    this.requestUpdate?.();
  }

  setDaily(daily: readonly Candle[]): void {
    if (daily === this.daily) return;
    this.daily = daily;
    this.days = dayLevels(daily);
    this.requestUpdate?.();
  }

  /** Pas przy prawej krawędzi panelu zajęty przez drabinę DOM (px). */
  setRightInset(px: number): void {
    this.rightInset = px;
    this.requestUpdate?.();
  }

  setCompact(on: boolean): void {
    this.compact = on;
    this.whaleSel = '';
    this.requestUpdate?.();
  }

  /** Telefon: dotknięcie przy linii wieloryba (±`tol` px) pokazuje jej podpis, kolejne dotknięcie obok go chowa. */
  pickWhale(y: number, tol = 12): boolean {
    if (!this.compact) return false;
    let best: { y: number; key: string } | null = null;
    for (const h of this.whaleHits) if (Math.abs(h.y - y) <= tol && (!best || Math.abs(h.y - y) < Math.abs(best.y - y))) best = h;
    const key = best && best.key !== this.whaleSel ? best.key : '';
    const changed = key !== this.whaleSel;
    this.whaleSel = key;
    if (changed) this.requestUpdate?.();
    return best !== null;
  }

  setLiq(levels: LiqLevel[]): void {
    this.liq = levels;
    this.requestUpdate?.();
  }

  setWhales(w: WhaleView | null): void {
    this.whales = w;
    this.requestUpdate?.();
  }

  valuesAt(i: number): IndicatorValues {
    const t = this.toggles;
    return {
      vwap: t.showVwap ? (this.vwap[i] ?? null) : null,
      svwap: t.showSessionVwap ? (this.svwap[i] ?? null) : null,
      anchor: this.scope.vwapAnchor,
    };
  }

  /**
   * VWAP mieści się w autoskali przy widoku przeglądowym; pasma nie — świece zachowują wysokość.
   * Przy zbliżeniu do footprintu (mało świec) skala należy do ceny, żeby komórki nie malały przez odległy VWAP.
   */
  autoscaleInfo(start: Logical, end: Logical): AutoscaleInfo | null {
    if (end - start < AUTOSCALE_MIN_BARS) return null;
    const t = this.toggles;
    const lines = [t.showVwap ? this.vwap : null, t.showSessionVwap ? this.svwap : null];
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    const a = Math.max(0, Math.ceil(start));
    for (const line of lines) {
      if (!line) continue;
      const b = Math.min(line.length - 1, Math.floor(end));
      for (let i = a; i <= b; i++) {
        const p = line[i];
        if (!p) continue;
        if (p.vwap < min) min = p.vwap;
        if (p.vwap > max) max = p.vwap;
      }
    }
    return min <= max ? { priceRange: { minValue: min, maxValue: max } } : null;
  }

  updateAllViews(): void {
    this.scene = this.buildScene();
  }

  // ───────────────────────── geometria ─────────────────────────

  private buildScene(): Scene {
    const s = emptyScene();
    this.axisVwap.on = this.axisSvwap.on = this.axisPoc.on = false;
    const chart = this.chart;
    const series = this.series;
    const bars = this.bars;
    const n = bars.length;
    if (!chart || !series || n === 0) return s;
    const ts = chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    const xa = ts.logicalToCoordinate(0 as Logical);
    const xb = ts.logicalToCoordinate(1 as Logical);
    if (!range || xa === null || xb === null) return s;
    const sp = xb - xa;
    const pane = chart.paneSize(0);
    // Przy prawej krawędzi może stać drabina DOM — wskaźniki kończą się przed nią
    const W = pane.width - this.rightInset;
    const H = pane.height;
    if (!(W > 0) || !(H > 0) || !(sp > 0)) return s;
    s.right = W;
    const X = (logical: number) => xa + logical * sp;
    const Y = (p: number) => series.priceToCoordinate(p) ?? Number.NaN;
    const ms = this.ms;
    const edge = (t: number) => X(logicalOfTime(bars, t, ms)) - sp / 2;
    const vf = Math.max(0, Math.ceil(range.from));
    const vt = Math.min(n - 1, Math.floor(range.to));
    if (vt < vf) return s;
    const from = Math.max(0, vf - 1);
    const to = Math.min(n - 1, vt + 1);
    const visFrom = bars[vf].t;
    const visTo = bars[vt].t + ms;
    const lastT = bars[n - 1].t;
    const t = this.toggles;
    const sc = this.scope;

    // Profil widocznego zakresu (pod świecami, przy prawej krawędzi) i profile sesji od ich początku
    const step = this.rowStep(bars, vt, Y);
    const pw = Math.round(Math.min(PROFILE_MAX_PX, Math.max(PROFILE_MIN_PX, W * PROFILE_WIDTH)));
    if (t.showProfile && step > 0) this.sceneProfile(s, bars, vf, vt, W, pw, step, Y);
    if (t.showPeriodProfiles && sc.periodProfile && step > 0) this.scenePeriods(s, bars, sc.periodProfile, step, visFrom, visTo, W, edge, Y);
    else this.periodCache.clear();
    if (t.showDevPoc && sc.periodProfile && step > 0) this.sceneDeveloping(s, bars, sc.periodProfile, step, visFrom, visTo, X, Y);
    else this.devCache.clear();

    // VWAP sesji pod VWAP dnia (w sesji azjatyckiej oba zaczynają się o 00:00 UTC i się pokrywają)
    if (t.showSessionVwap && sc.sessionVwap) {
      const last = this.sceneVwap(s, this.svwap, from, to, X, Y, K.svwap, 1.2, false);
      if (last) {
        this.axisSvwap.on = true;
        this.axisSvwap.y = Y(last.vwap);
        this.axisSvwap.label = fmtPx(last.vwap);
        s.tags.push({ y: Y(last.vwap), text: 'VWAP S', color: K.svwap });
      }
    }
    if (t.showVwap) {
      const last = this.sceneVwap(s, this.vwap, from, to, X, Y, K.vwap, 1.6, t.showVwapBands);
      if (last) {
        this.axisVwap.on = true;
        this.axisVwap.y = Y(last.vwap);
        this.axisVwap.label = fmtPx(last.vwap);
        s.tags.push({ y: Y(last.vwap), text: sc.vwapAnchor === 'week' ? tr('VWAP T', 'VWAP W') : 'VWAP', color: K.vwap });
      }
    }

    // Otwarcia sesji: pionowe linie z nazwą przy dolnej krawędzi
    if (t.showSessions && sc.sessions) {
      for (const ses of sessionsBetween(visFrom, visTo)) {
        if (ses.start < visFrom) continue;
        const x = edge(ses.start);
        if (x < 0 || x > W) continue;
        s.vlines.push({ x, color: K.session, dash: DASH.session });
        s.texts.push({ x: x + 4, y: H - 8, text: ses.id === 'ny' ? 'NY' : SESSION_LABEL[ses.id], color: K.sessionText, align: 'left' });
      }
    }

    // Poziomy dnia: odcinki w obrębie każdego dnia, bieżący dzień do prawej krawędzi z etykietami
    if (t.showLevels && sc.levels) {
      for (const d of this.days) {
        if (d.t + DAY <= visFrom || d.t >= visTo) continue;
        const current = d.t + DAY > lastT;
        const x0 = Math.max(0, edge(d.t));
        const x1 = current ? W : Math.min(W, edge(d.t + DAY));
        if (x1 <= x0) continue;
        const lv: [number, string, string, number[]][] = [
          [d.pdh, 'PDH', K.level, DASH.level],
          [d.pdl, 'PDL', K.level, DASH.level],
          [d.open, tr('Otwarcie dnia', 'Daily open'), K.dayOpen, DASH.dot],
        ];
        for (const [px, name, color, dash] of lv) {
          const y = Y(px);
          if (!Number.isFinite(y)) continue;
          s.hlines.push({ x0, x1, y, color, dash });
          if (current) s.tags.push({ y, text: `${name} ${fmtPx(px)}`, color: color === K.dayOpen ? PRO.ink2 : K.level });
        }
      }
    }

    // Initial balance: prostokąt pierwszej godziny, jego szczyt i dołek do końca sesji, rozszerzenia po zamknięciu IB
    if (t.showIb && sc.ib) {
      for (const ib of this.ibs) {
        const ses = ib.session;
        if (ses.end <= visFrom || ses.start >= visTo) continue;
        const current = ses.end > lastT;
        const x0 = edge(ses.start);
        const xi = edge(Math.min(ib.end, lastT + ms));
        const x1 = current ? W : edge(ses.end);
        const yh = Y(ib.hi);
        const yl = Y(ib.lo);
        if (!Number.isFinite(yh) || !Number.isFinite(yl)) continue;
        s.fills.push({ pts: [x0, yh, xi, yh, xi, yl, x0, yl], color: K.ibFill });
        s.hlines.push({ x0, x1, y: yh, color: K.ibLine, dash: DASH.none }, { x0, x1, y: yl, color: K.ibLine, dash: DASH.none });
        if (current) {
          s.tags.push({ y: yh, text: `IBH ${fmtPx(ib.hi)}`, color: K.ib }, { y: yl, text: `IBL ${fmtPx(ib.lo)}`, color: K.ib });
        }
        if (!ib.complete) continue;
        const r = ib.hi - ib.lo;
        for (const m of IB_EXTENSIONS) {
          const label = `IB ${lang === 'en' ? String(1 + m) : String(1 + m).replace('.', ',')}×`;
          for (const px of [ib.hi + m * r, ib.lo - m * r]) {
            const y = Y(px);
            s.hlines.push({ x0: xi, x1, y, color: K.ibExt, dash: DASH.ext });
            if (current) s.tags.push({ y, text: `${label} ${fmtPx(px)}`, color: K.ib });
          }
        }
      }
    }

    // Klastry likwidacji (stan bieżący ze skanera)
    if (t.showLiq) {
      for (const l of this.liq) {
        const y = Y(l.px);
        if (!(y >= 0 && y <= H)) continue;
        const long = l.side === 'long';
        s.hlines.push({ x0: 0, x1: W, y, color: long ? K.liqLongLine : K.liqShortLine, dash: DASH.liq });
        s.tags.push({ y, text: `${tr('Likw.', 'Liq.')} ${long ? 'L' : 'S'} ${fmtCompact(l.ntlUsd, '$')}`, color: long ? K.liqLong : K.liqShort });
      }
    }

    // Wieloryby: cena wejścia i likwidacji największych pozycji przez cały wykres, duże zlecenia — kreska przy prawej krawędzi
    this.whaleHits = [];
    if (t.showWhales && this.whales) {
      const inView = (y: number) => y >= 0 && y <= H;
      // Na telefonie podpis tylko dotkniętej linii — inaczej podpisy zasłaniają wąski wykres
      const tag = (key: string, y: number, text: string, color: string) => {
        this.whaleHits.push({ y, key });
        if (!this.compact || key === this.whaleSel) s.tags.push({ y, text, color });
      };
      const pos = this.whales.positions.filter((p) => inView(Y(p.entry)) || (p.liq !== null && inView(Y(p.liq)))).slice(0, WHALE_POSITIONS);
      for (const p of pos) {
        const long = p.side === 'long';
        const y = Y(p.entry);
        if (inView(y)) {
          s.hlines.push({ x0: 0, x1: W, y, color: long ? K.whaleLongLine : K.whaleShortLine, dash: DASH.whale });
          tag(`p:${p.id}:${p.side}`, y, `${p.id} ${long ? 'L' : 'S'} ${fmtCompact(p.usd, '$')} ×${Math.round(p.lev)}`, long ? K.whaleLong : K.whaleShort);
        }
        const yl = p.liq === null ? Number.NaN : Y(p.liq);
        if (inView(yl)) {
          s.hlines.push({ x0: 0, x1: W, y: yl, color: K.whaleLiqLine, dash: DASH.liq });
          tag(`l:${p.id}:${p.side}`, yl, `${p.id} ${tr('likw.', 'liq.')} ${long ? 'L' : 'S'}`, K.whaleLiq);
        }
      }
      // Zlecenia konta po jednej stronie i jednego rodzaju (drabinka) — kreska na każdej cenie, łącznik i jeden podpis z liczbą i sumą
      const orders = this.whales.orders.filter((x) => inView(Y(x.px)));
      for (const g of groupWhaleOrders(orders).slice(0, WHALE_ORDERS)) {
        const bid = g.side === 'bid';
        const color = bid ? K.whaleLong : K.whaleShort;
        const dash = g.kind === 'limit' ? DASH.none : DASH.dot;
        for (const o of orders) {
          if (o.id === g.id && o.side === g.side && o.kind === g.kind) s.hlines.push({ x0: W - WHALE_TICK_PX, x1: W, y: Y(o.px), color, dash });
        }
        if (g.n > 1) s.polys.push({ pts: [W - WHALE_TICK_PX, Y(g.hi), W - WHALE_TICK_PX, Y(g.lo)], color, width: 1 });
        const what = g.kind === 'stop' ? 'stop' : g.kind === 'tp' ? 'TP' : bid ? tr('kupno', 'buy') : tr('sprzedaż', 'sell');
        tag(`o:${g.id}:${g.side}:${g.kind}`, Y((g.lo + g.hi) / 2), `${g.id} ${what} ${g.n > 1 ? `${g.n}× ` : ''}${fmtCompact(g.usd, '$')}`, color);
      }
    }

    // Etykiety po prawej: tylko widoczne, rozsunięte, żeby się nie nakładały
    s.tags = s.tags.filter((g) => g.y >= 0 && g.y <= H).sort((a, b) => a.y - b.y);
    s.tagYs = spreadTags(
      s.tags.map((g) => g.y),
      TAG_H + 1,
      TAG_H / 2,
      H - TAG_H / 2
    );
    return s;
  }

  /** Linia VWAP (od nowa na początku okresu) i pasma ±1σ, ±2σ; zwraca ostatni punkt serii. */
  private sceneVwap(
    s: Scene,
    line: (VwapPoint | null)[],
    from: number,
    to: number,
    X: (l: number) => number,
    Y: (p: number) => number,
    color: string,
    width: number,
    bands: boolean
  ): VwapPoint | null {
    let seg: number[] = [];
    const segs: number[][] = [];
    for (let i = from; i <= to; i++) {
      const p = line[i];
      if (!p || p.start) {
        if (seg.length > 0) segs.push(seg);
        seg = [];
      }
      if (p) seg.push(i);
    }
    if (seg.length > 0) segs.push(seg);
    for (const idx of segs) {
      if (bands && idx.length > 1) {
        for (const [k, fill, edgeColor] of [
          [2, K.vwapBand2, K.vwapEdge2],
          [1, K.vwapBand1, K.vwapEdge1],
        ] as const) {
          const up: number[] = [];
          const dn: number[] = [];
          for (const i of idx) {
            const p = line[i]!;
            up.push(X(i), Y(p.vwap + k * p.sd));
            dn.push(X(i), Y(p.vwap - k * p.sd));
          }
          const back: number[] = [];
          for (let j = dn.length - 2; j >= 0; j -= 2) back.push(dn[j], dn[j + 1]);
          s.fills.push({ pts: [...up, ...back], color: fill });
          s.polys.push({ pts: up, color: edgeColor, width: 1 }, { pts: dn, color: edgeColor, width: 1 });
        }
      }
      const pts: number[] = [];
      for (const i of idx) pts.push(X(i), Y(line[i]!.vwap));
      s.polys.push({ pts, color, width });
    }
    return line[line.length - 1] ?? null;
  }

  /** Krok wiersza profili (USD): najmniejszy z drabiny o wysokości ≥ PROFILE_ROW_PX; 0 bez skali. */
  private rowStep(bars: readonly ProBar[], vt: number, Y: (p: number) => number): number {
    const ref = bars[vt].candle.c;
    const pxPerUsd = Math.abs(Y(ref) - Y(ref + 100)) / 100;
    return pxPerUsd > 0 ? autoRowStep(pxPerUsd, hlTick(ref), PROFILE_ROW_PX) : 0;
  }

  /**
   * Profile sesji (albo dób): wiersze od początku okresu w prawo, POC na całą szerokość okresu,
   * a POC, którego cena później nie dotknęła (nagi), przedłużony cienką linią do prawej krawędzi.
   */
  private scenePeriods(
    s: Scene,
    bars: readonly ProBar[],
    mode: 'session' | 'day',
    step: number,
    visFrom: number,
    visTo: number,
    W: number,
    edge: (t: number) => number,
    Y: (p: number) => number
  ): void {
    const ms = this.ms;
    const cache = new Map<number, PeriodCache>();
    const items: { from: number; to: number; complete: boolean; pocPx: number; p: VolumeProfile }[] = [];
    for (const r of periodRanges(bars, mode)) {
      const hit = this.periodCache.get(r.start);
      const entry =
        hit && hit.step === step && sameRefs(hit.refs, bars, r.from, r.to)
          ? hit
          : { step, refs: bars.slice(r.from, r.to + 1), profile: volumeProfile(bars, r.from, r.to, step) };
      cache.set(r.start, entry);
      const p = entry.profile;
      if (p && p.max > 0) items.push({ from: r.from, to: r.to, complete: r.complete, pocPx: (p.lo + p.poc + 0.5) * p.step, p });
    }
    this.periodCache = cache;
    const naked = nakedPocs(bars, items);
    let shown = 0;
    for (let k = items.length - 1; k >= 0; k--) {
      const { from, to, pocPx, p } = items[k];
      const x0 = edge(bars[from].t);
      const x1 = edge(bars[to].t + ms);
      const yPoc = Y(pocPx);
      if (naked[k] && shown < NAKED_POC_MAX && x1 < W) {
        shown++;
        s.hlines.push({ x0: Math.max(0, x1), x1: W, y: yPoc, color: K.nPocLine, dash: DASH.none });
      }
      if (bars[to].t + ms <= visFrom || bars[from].t >= visTo) continue;
      const pw = Math.min(PERIOD_PROFILE_MAX_PX, (x1 - x0) * PERIOD_PROFILE_WIDTH);
      const gap = Math.abs(Y(pocPx) - Y(pocPx + step)) >= 3 ? 1 : 0;
      for (let r = 0; r < p.vol.length; r++) {
        const v = p.vol[r];
        if (!(v > 0)) continue;
        const ya = Y((p.lo + r + 1) * p.step);
        const yb = Y((p.lo + r) * p.step);
        const color = r >= p.vaLo && r <= p.vaHi ? K.spVa : K.spOut;
        s.rects.push({ x: x0, y: ya, w: Math.max(1, (v / p.max) * pw), h: Math.max(1, yb - ya - gap), color });
      }
      s.hlines.push({ x0, x1, y: yPoc, color: K.spPocLine, dash: DASH.none });
    }
  }

  /** Rozwijający się POC (linia schodkowa) i value area (kropkowane) każdej widocznej sesji albo doby, świeca po świecy. */
  private sceneDeveloping(
    s: Scene,
    bars: readonly ProBar[],
    mode: 'session' | 'day',
    step: number,
    visFrom: number,
    visTo: number,
    X: (logical: number) => number,
    Y: (p: number) => number
  ): void {
    const ms = this.ms;
    const half = (X(1) - X(0)) / 2;
    const cache = new Map<number, DevCache>();
    for (const r of periodRanges(bars, mode)) {
      if (bars[r.to].t + ms <= visFrom || bars[r.from].t >= visTo) continue;
      const hit = this.devCache.get(r.start);
      const entry =
        hit && hit.step === step && sameRefs(hit.refs, bars, r.from, r.to)
          ? hit
          : { step, refs: bars.slice(r.from, r.to + 1), levels: developingProfile(bars, r.from, r.to, step) };
      cache.set(r.start, entry);
      const lines: [keyof DevelopingLevels, string, number, number[] | undefined][] = [
        ['vah', K.devVa, 1, DASH.dot],
        ['val', K.devVa, 1, DASH.dot],
        ['poc', K.devPoc, 1.5, undefined],
      ];
      for (const [key, color, width, dash] of lines) {
        let pts: number[] = [];
        const flush = () => {
          if (pts.length >= 4) s.polys.push({ pts, color, width, dash });
          pts = [];
        };
        entry.levels.forEach((lv, k) => {
          if (!lv) return flush();
          const x = X(r.from + k);
          const y = Y(lv[key]);
          pts.push(x - half, y, x + half, y);
        });
        flush();
      }
    }
    this.devCache = cache;
  }

  private sceneProfile(s: Scene, bars: readonly ProBar[], vf: number, vt: number, W: number, pw: number, step: number, Y: (p: number) => number): void {
    const ref = bars[vt].candle.c;
    const pxPerUsd = Math.abs(Y(ref) - Y(ref + 100)) / 100;
    const key = `${vf}|${vt}|${step}`;
    // Ta sama tablica świec i ten sam zakres → profil z pamięci (przeliczenie przy każdej zmianie danych)
    if (this.profileCache.key !== key || this.profileBars !== bars) {
      this.profileCache = { key, profile: volumeProfile(bars, vf, vt, step) };
      this.profileBars = bars;
    }
    const p = this.profileCache.profile;
    if (!p || !(p.max > 0)) return;
    const gap = step * pxPerUsd >= 3 ? 1 : 0;
    for (let k = 0; k < p.vol.length; k++) {
      const v = p.vol[k];
      if (!(v > 0)) continue;
      const y0 = Y((p.lo + k + 1) * p.step);
      const y1 = Y((p.lo + k) * p.step);
      const w = Math.max(1, (v / p.max) * pw);
      const color = k === p.poc ? K.vpPoc : k >= p.vaLo && k <= p.vaHi ? K.vpVa : K.vpOut;
      s.rects.push({ x: W - w, y: y0, w, h: Math.max(1, y1 - y0 - gap), color });
    }
    const pocPx = (p.lo + p.poc + 0.5) * p.step;
    const yPoc = Y(pocPx);
    s.hlines.push({ x0: 0, x1: W, y: yPoc, color: K.pocLine, dash: DASH.level });
    this.axisPoc.on = true;
    this.axisPoc.y = yPoc;
    this.axisPoc.label = fmtPx(pocPx);
    const vah = Y((p.lo + p.vaHi + 1) * p.step);
    const val = Y((p.lo + p.vaLo) * p.step);
    s.hlines.push({ x0: W - pw, x1: W, y: vah, color: K.vaLine, dash: DASH.dot }, { x0: W - pw, x1: W, y: val, color: K.vaLine, dash: DASH.dot });
    // Podpisy przy prawej krawędzi, na profilu: przed profilem zasłaniały komórki ostatnich świec
    s.texts.push(
      { x: W - 4, y: yPoc, text: 'POC', color: PRO.ink2, align: 'right', bg: true },
      { x: W - 4, y: vah, text: 'VAH', color: PRO.ink3, align: 'right', bg: true },
      { x: W - 4, y: val, text: 'VAL', color: PRO.ink3, align: 'right', bg: true }
    );
  }
}

// ───────────────────────── rysowanie ─────────────────────────

/** Linia pozioma ostra na granicy pikseli urządzenia. */
const crisp = (v: number, lw: number) => Math.round(v) + (lw % 2) / 2;

function drawUnder(ctx: CanvasRenderingContext2D, s: Scene, hr: number, vr: number): void {
  for (const r of s.rects) {
    ctx.fillStyle = r.color;
    const x = Math.round(r.x * hr);
    const y = Math.round(r.y * vr);
    ctx.fillRect(x, y, Math.max(1, Math.round((r.x + r.w) * hr) - x), Math.max(1, Math.round((r.y + r.h) * vr) - y));
  }
  for (const f of s.fills) {
    if (f.pts.length < 6) continue;
    ctx.beginPath();
    ctx.moveTo(f.pts[0] * hr, f.pts[1] * vr);
    for (let j = 2; j < f.pts.length; j += 2) ctx.lineTo(f.pts[j] * hr, f.pts[j + 1] * vr);
    ctx.closePath();
    ctx.fillStyle = f.color;
    ctx.fill();
  }
}

function drawOver(ctx: CanvasRenderingContext2D, s: Scene, hr: number, vr: number, bitmapW: number, bitmapH: number): void {
  const lw = Math.max(1, Math.floor(hr));
  ctx.lineWidth = lw;
  for (const v of s.vlines) {
    ctx.strokeStyle = v.color;
    ctx.setLineDash(v.dash.map((d) => d * hr));
    ctx.beginPath();
    const x = crisp(v.x * hr, lw);
    ctx.moveTo(x, 0);
    ctx.lineTo(x, bitmapH);
    ctx.stroke();
  }
  for (const l of s.hlines) {
    if (!Number.isFinite(l.y)) continue;
    ctx.strokeStyle = l.color;
    ctx.setLineDash(l.dash.map((d) => d * hr));
    ctx.beginPath();
    const y = crisp(l.y * vr, lw);
    ctx.moveTo(Math.round(l.x0 * hr), y);
    ctx.lineTo(Math.round(l.x1 * hr), y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.lineJoin = 'round';
  for (const p of s.polys) {
    if (p.pts.length < 4) continue;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = Math.max(1, p.width * hr);
    ctx.setLineDash(p.dash ? p.dash.map((d) => d * hr) : []);
    ctx.beginPath();
    ctx.moveTo(p.pts[0] * hr, p.pts[1] * vr);
    for (let j = 2; j < p.pts.length; j += 2) ctx.lineTo(p.pts[j] * hr, p.pts[j + 1] * vr);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  const font = Math.round(10 * vr);
  ctx.font = `${font}px ${MONO}`;
  ctx.textBaseline = 'middle';
  for (const t of s.texts) {
    if (!Number.isFinite(t.y)) continue;
    ctx.textAlign = t.align;
    const x = t.x * hr;
    const y = t.y * vr;
    if (t.bg) {
      const w = ctx.measureText(t.text).width + 4 * hr;
      ctx.fillStyle = K.tagBg;
      ctx.fillRect(t.align === 'right' ? x - w + 2 * hr : x - 2 * hr, y - font * 0.6, w, font * 1.2);
    }
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, x, y);
  }

  // Etykiety poziomów przy prawej krawędzi
  ctx.textAlign = 'right';
  const padX = Math.round(4 * hr);
  const h = Math.round(TAG_H * vr);
  s.tags.forEach((g, i) => {
    const y = Math.round(s.tagYs[i] * vr);
    const w = Math.ceil(ctx.measureText(g.text).width) + 2 * padX;
    const x = (s.right > 0 ? Math.round(s.right * hr) : bitmapW) - w - Math.round(2 * hr);
    ctx.fillStyle = K.tagBg;
    ctx.fillRect(x, y - h / 2, w, h);
    ctx.fillStyle = g.color;
    ctx.fillRect(x, y - h / 2, Math.max(1, Math.round(2 * hr)), h);
    ctx.fillText(g.text, x + w - padX, y + 0.5);
  });
}
