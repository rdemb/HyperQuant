import { CandlestickSeries, HistogramSeries, LineStyle, createChart } from 'lightweight-charts';
import type {
  CandlestickData,
  HistogramData,
  IChartApi,
  ISeriesApi,
  LogicalRange,
  MouseEventParams,
  PriceFormat,
  SeriesPartialOptions,
  Time,
  UTCTimestamp,
  WhitespaceData,
} from 'lightweight-charts';
import { fmtVol } from '../../orderflow/footprint';
import { fmtSignedVol } from '../../orderflow/renderer';
import { fmtPrice } from '../../../ui/format';
import { Ohlc, cvdCandles, deltaCandle } from '../core/flow';
import { rowAt } from '../core/footprintBar';
import type { LiqLevel } from '../core/indicators';
import type { ResetMode } from '../core/sessions';
import type { ProBar, ProStore } from '../store/proStore';
import { DrawingLayer } from '../draw/layer';
import { DrawingTools } from '../draw/tools';
import { FootprintOptions, FootprintPoint, FootprintSeries } from './footprintSeries';
import { LiquidityLayer } from './liquidity';
import { IndicatorOverlay, IndicatorToggles, IndicatorValues } from './overlay';
import { LegendPart, PaneLegend } from './paneLegend';
import type { ChartSettings } from './settings';
import { DOM_W_PX, PRO, RIGHT_GAP_PX, chartOptions } from './theme';

/**
 * Sterownik wykresu Pro (bez Reacta): tworzy wykres Lightweight Charts z serią footprintu, wolumenem
 * i panelami Delta / CVD, synchronizuje dane z magazynem (najwyżej raz na klatkę, tylko zmienione
 * świece), doczytuje historię przy przewinięciu w lewo i raportuje świecę pod krzyżem do legendy.
 */

export interface HoverRow {
  /** Dolna i górna cena wiersza (USD). */
  lo: number;
  hi: number;
  buy: number;
  sell: number;
}

export interface Hover {
  bar: ProBar | null;
  /** true = brak krzyża, pokazujemy ostatnią świecę. */
  live: boolean;
  row: HoverRow | null;
  cvd: Ohlc | null;
  ind: IndicatorValues | null;
}

const sec = (t: number) => (t / 1000) as UTCTimestamp;

/** Liczby panelu przepływu: BTC ze znakiem. */
const FLOW_FORMAT: PriceFormat = { type: 'custom', minMove: 0.0001, formatter: fmtSignedVol };

const VOLUME_FORMAT: PriceFormat = { type: 'custom', minMove: 0.0001, formatter: (v: number) => fmtVol(v) };

const toggles = (s: ChartSettings): IndicatorToggles => ({
  showVwap: s.showVwap,
  showVwapBands: s.showVwapBands,
  showSessionVwap: s.showSessionVwap,
  showProfile: s.showProfile,
  showPeriodProfiles: s.showPeriodProfiles,
  showLevels: s.showLevels,
  showSessions: s.showSessions,
  showIb: s.showIb,
  showLiq: s.showLiq,
});

/** Zmienionych świec powyżej tej liczby nie aktualizujemy pojedynczo, tylko podmieniamy całą serię. */
const MAX_POINT_UPDATES = 24;
/** Margines skali ceny bez legendy (ułamek wysokości panelu) — jak w motywie wykresu. */
const TOP_MARGIN = 0.06;
/** Doczytanie historii, gdy z lewej zostało mniej świec niż tyle. */
const LOAD_OLDER_MARGIN = 40;

function toPoint(b: ProBar): FootprintPoint {
  const c = b.candle;
  return { time: sec(b.t), open: c.o, high: c.h, low: c.l, close: c.c, bar: b, color: c.c >= c.o ? PRO.buy : PRO.sell };
}

function toVolume(b: ProBar): HistogramData<Time> {
  const c = b.candle;
  return { time: sec(b.t), value: c.v, color: c.c >= c.o ? PRO.volBuy : PRO.volSell };
}

function toDelta(b: ProBar): CandlestickData<Time> | WhitespaceData<Time> {
  return b.fp ? { time: sec(b.t), ...deltaCandle(b.fp) } : { time: sec(b.t) };
}

function toCvd(t: number, c: Ohlc | null): CandlestickData<Time> | WhitespaceData<Time> {
  return c ? { time: sec(t), ...c } : { time: sec(t) };
}

const RESET_LABEL: Record<ResetMode, string> = { none: 'ciągła', session: 'sesja', day: 'doba UTC', week: 'tydzień' };

function flowLegend(label: string, value: number | null): LegendPart[] {
  if (value === null) return [{ text: label, color: PRO.ink3 }];
  return [
    { text: label, color: PRO.ink3 },
    { text: fmtSignedVol(value), color: value >= 0 ? PRO.buyInk : PRO.sellInk },
  ];
}

const sameOhlc = (a: Ohlc | null, b: Ohlc | null) =>
  a === b || (a !== null && b !== null && a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close);

const FLOW_CANDLE = {
  upColor: PRO.buy,
  downColor: PRO.sell,
  wickUpColor: PRO.buyWick,
  wickDownColor: PRO.sellWick,
  borderVisible: false,
  priceLineVisible: false,
  priceFormat: FLOW_FORMAT,
} as const;

export class ProChartController {
  readonly chart: IChartApi;
  readonly fpView = new FootprintSeries();
  private readonly main: ISeriesApi<'Custom', Time, FootprintPoint | WhitespaceData<Time>, FootprintOptions, SeriesPartialOptions<FootprintOptions>>;
  private volume: ISeriesApi<'Histogram'> | null = null;
  private delta: ISeriesApi<'Candlestick'> | null = null;
  private cvd: ISeriesApi<'Candlestick'> | null = null;
  private readonly volumeLegend = new PaneLegend();
  private readonly deltaLegend = new PaneLegend();
  private readonly cvdLegend = new PaneLegend();
  private readonly overlay: IndicatorOverlay;
  private readonly liquidity: LiquidityLayer;
  private readonly drawLayer = new DrawingLayer();
  /** Narzędzia rysowania (pasek narzędzi w ProChart). */
  readonly draw: DrawingTools;

  private settings: ChartSettings;
  private bars: ProBar[] = [];
  private cvdData: (Ohlc | null)[] = [];
  private frame = 0;
  private marginFrame = 0;
  /** Dolna krawędź legendy nad panelem ceny (px). */
  private topInset = 0;
  private hoverTime: number | null = null;
  private hoverPrice: number | null = null;
  private readonly unsubscribe: () => void;
  private readonly onHover: (h: Hover) => void;

  constructor(container: HTMLElement, private readonly store: ProStore, settings: ChartSettings, onHover: (h: Hover) => void) {
    this.settings = settings;
    this.onHover = onHover;
    this.chart = createChart(container, chartOptions());
    this.main = this.chart.addCustomSeries<FootprintPoint, FootprintOptions>(this.fpView, {
      priceFormat: { type: 'custom', minMove: 1, formatter: (p: number) => fmtPrice(p, 0) },
      priceLineVisible: true,
      priceLineColor: PRO.priceLine,
      lastValueVisible: true,
    });
    // Mapa ciepła pod profilem i pasmami (kolejność dołączenia = kolejność rysowania w tej samej warstwie)
    this.liquidity = new LiquidityLayer({ showHeatmap: settings.showHeatmap, showBubbles: settings.showBubbles });
    this.main.attachPrimitive(this.liquidity);
    this.overlay = new IndicatorOverlay(toggles(settings));
    this.main.attachPrimitive(this.overlay);
    // Rysunki dołączone ostatnie — nad wskaźnikami i świecami
    this.drawLayer.setUnit(store.coin);
    this.main.attachPrimitive(this.drawLayer);
    this.draw = new DrawingTools(container, this.chart, this.drawLayer, store.coin);
    this.applySettings(settings, true);
    this.chart.subscribeCrosshairMove(this.onCrosshair);
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(this.onRange);
    this.unsubscribe = store.subscribe(() => this.schedule());
    this.schedule();
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.marginFrame);
    this.draw.destroy();
    this.unsubscribe();
    this.chart.unsubscribeCrosshairMove(this.onCrosshair);
    this.chart.timeScale().unsubscribeVisibleLogicalRangeChange(this.onRange);
    this.chart.remove();
  }

  /** Nowe ustawienia: opcje serii footprintu, panele i ich dane. */
  applySettings(s: ChartSettings, force = false): void {
    const prev = this.settings;
    this.settings = s;
    this.main.applyOptions({
      view: s.view,
      fpStyle: s.fpStyle,
      rowStep: s.rowStep,
      imbalanceRatio: s.imbalanceRatio,
      imbalanceMinVol: s.imbalanceMinVol,
      stackedMin: s.stackedMin,
    });
    this.overlay.setToggles(toggles(s));
    this.liquidity.setToggles({ showHeatmap: s.showHeatmap, showBubbles: s.showBubbles });
    if (force || prev.showHeatmap !== s.showHeatmap) {
      // Z mapą ciepła przy prawej krawędzi stoi drabina DOM: najnowsza świeca i wskaźniki kończą się przed nią
      this.overlay.setRightInset(s.showHeatmap ? DOM_W_PX : 0);
      this.chart.timeScale().applyOptions({ rightOffsetPixels: this.rightGap() });
    }
    const panesChanged = force || prev.showVolume !== s.showVolume || prev.showDelta !== s.showDelta || prev.showCvd !== s.showCvd;
    if (panesChanged) this.rebuildPanes();
    else if (prev.cvdReset !== s.cvdReset) {
      this.cvdData = [];
      this.pushCvd(true);
    }
    this.emitHover();
  }

  private rebuildPanes(): void {
    const s = this.settings;
    for (const sr of [this.volume, this.delta, this.cvd]) if (sr) this.chart.removeSeries(sr);
    this.volume = this.delta = this.cvd = null;
    let pane = 1;
    // Wolumen we własnym panelu — nie zasłania komórek footprintu
    if (s.showVolume) {
      this.volume = this.chart.addSeries(HistogramSeries, { priceFormat: VOLUME_FORMAT, priceLineVisible: false, lastValueVisible: false }, pane++);
      this.volume.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0 } });
      this.volume.attachPrimitive(this.volumeLegend);
    }
    if (s.showDelta) {
      this.delta = this.chart.addSeries(CandlestickSeries, FLOW_CANDLE, pane++);
      this.delta.createPriceLine({ price: 0, color: PRO.divider, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: false, title: '' });
      this.delta.attachPrimitive(this.deltaLegend);
    }
    if (s.showCvd) {
      this.cvd = this.chart.addSeries(CandlestickSeries, FLOW_CANDLE, pane++);
      this.cvd.attachPrimitive(this.cvdLegend);
    }
    const panes = this.chart.panes();
    panes[0]?.setStretchFactor(1);
    for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(panes[i] === this.volume?.getPane() ? 0.14 : 0.22);
    this.setTopInset(this.topInset);
    // Nowe serie dostają pełne dane przy następnej synchronizacji
    this.bars = [];
    this.cvdData = [];
    this.schedule();
  }

  /**
   * Autoskala ceny zostawia nad świecami miejsce na legendę (px od góry panelu), żeby legenda nie zasłaniała
   * szczytów ani górnych wierszy footprintu. Liczone po ułożeniu paneli (wysokość panelu ceny zależy od pozostałych).
   */
  setTopInset(px: number): void {
    this.topInset = px;
    cancelAnimationFrame(this.marginFrame);
    this.marginFrame = requestAnimationFrame(() => {
      this.marginFrame = 0;
      const h = this.chart.paneSize(0).height;
      if (!(h > 0)) return;
      const top = Math.min(0.35, Math.max(TOP_MARGIN, (this.topInset + 6) / h));
      this.main.priceScale().applyOptions({ scaleMargins: { top, bottom: TOP_MARGIN } });
    });
  }

  /** Najsilniejsze klastry likwidacji ze skanera (pusta lista = brak aktualnej mapy). */
  setLiqLevels(levels: LiqLevel[]): void {
    this.overlay.setLiq(levels);
  }

  /** Odstęp najnowszej świecy od osi ceny (px): stały, a z mapą ciepła powiększony o drabinę DOM. */
  private rightGap(): number {
    return RIGHT_GAP_PX + (this.settings.showHeatmap ? DOM_W_PX : 0);
  }

  /** Przewija do bieżącej świecy (z zachowaniem zbliżenia); odstęp od osi ceny stały w pikselach. */
  scrollToNow(): void {
    const ts = this.chart.timeScale();
    // Bez animacji: animowane przewinięcie biblioteki kończy się klatkę przed celem (ostatnia świeca za krawędzią)
    ts.scrollToPosition(this.rightGap() / ts.options().barSpacing, false);
  }

  /** Dopasowuje zakres ceny do widocznych świec (po ręcznym przeciągnięciu osi). */
  resetScales(): void {
    this.chart.priceScale('right').applyOptions({ autoScale: true });
    this.scrollToNow();
  }

  // ───────────────────────── dane ─────────────────────────

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.sync();
    });
  }

  private sync(): void {
    const next = this.store.bars();
    const prev = this.bars;
    this.bars = next;
    const changed: number[] = [];
    let full = prev.length === 0 || next.length < prev.length || next[0]?.t !== prev[0]?.t;
    if (!full) {
      for (let i = 0; i < next.length && changed.length <= MAX_POINT_UPDATES; i++) if (next[i] !== prev[i]) changed.push(i);
      full = changed.length > MAX_POINT_UPDATES;
    }
    if (full) {
      this.main.setData(next.map(toPoint));
      this.volume?.setData(next.map(toVolume));
      this.delta?.setData(next.map(toDelta));
    } else {
      for (const i of changed) {
        const historical = i < prev.length - 1;
        const b = next[i];
        this.main.update(toPoint(b), historical);
        this.volume?.update(toVolume(b), historical);
        this.delta?.update(toDelta(b), historical);
      }
    }
    this.overlay.setBars(next, this.store.interval.ms);
    this.overlay.setDaily(this.store.daily);
    this.drawLayer.setBars(next, this.store.interval.ms);
    const st = this.store;
    this.liquidity.setData(next, st.interval.ms, st.book('near'), st.book('far'), (from, to) => st.orders.range(from, to), st.serverNow());
    this.pushCvd(full);
    this.emitHover();
  }

  /** CVD zależy od wszystkich wcześniejszych świec okresu — liczymy całość i wysyłamy tylko zmienione punkty. */
  private pushCvd(full: boolean): void {
    if (!this.cvd) return;
    const bars = this.bars;
    const next = cvdCandles(bars, this.settings.cvdReset);
    const prev = this.cvdData;
    this.cvdData = next;
    if (full || prev.length === 0 || prev.length > next.length) {
      this.cvd.setData(next.map((c, i) => toCvd(bars[i].t, c)));
      return;
    }
    const changed: number[] = [];
    for (let i = 0; i < next.length && changed.length <= MAX_POINT_UPDATES; i++) if (i >= prev.length || !sameOhlc(prev[i], next[i])) changed.push(i);
    if (changed.length > MAX_POINT_UPDATES) {
      this.cvd.setData(next.map((c, i) => toCvd(bars[i].t, c)));
      return;
    }
    for (const i of changed) this.cvd.update(toCvd(bars[i].t, next[i]), i < prev.length - 1);
  }

  // ───────────────────────── interakcja ─────────────────────────

  private readonly onRange = (range: LogicalRange | null): void => {
    if (range && range.from < LOAD_OLDER_MARGIN && this.bars.length > 0) void this.store.loadOlder();
  };

  private readonly onCrosshair = (p: MouseEventParams<Time>): void => {
    this.hoverTime = p.time !== undefined && p.point ? (p.time as number) * 1000 : null;
    this.hoverPrice = p.point && p.paneIndex === 0 ? this.main.coordinateToPrice(p.point.y) : null;
    this.emitHover();
  };

  private emitHover(): void {
    const bars = this.bars;
    if (bars.length === 0) {
      this.onHover({ bar: null, live: true, row: null, cvd: null, ind: null });
      return;
    }
    const i = this.hoverTime === null ? bars.length - 1 : indexOfTime(bars, this.hoverTime);
    const bar = i >= 0 ? bars[i] : null;
    const cvd = i >= 0 ? (this.cvdData[i] ?? null) : null;
    this.volumeLegend.set(
      bar ? [{ text: 'Wolumen', color: PRO.ink3 }, { text: fmtVol(bar.candle.v), color: PRO.ink1 }] : [{ text: 'Wolumen', color: PRO.ink3 }]
    );
    this.deltaLegend.set(flowLegend('Delta', bar?.fp ? bar.fp.delta : null));
    this.cvdLegend.set(flowLegend(`CVD · ${RESET_LABEL[this.settings.cvdReset]}`, cvd ? cvd.close : null));
    const ind = i >= 0 ? this.overlay.valuesAt(i) : null;
    this.onHover({ bar, live: this.hoverTime === null, row: bar ? this.rowAt(bar, this.hoverPrice) : null, cvd, ind });
  }

  /** Wiersz footprintu pod krzyżem — ta sama siatka co na wykresie (gdy widać footprint). */
  private rowAt(bar: ProBar, price: number | null): HoverRow | null {
    const fp = bar.fp;
    const { detail, step } = this.fpView.frame;
    if (!fp || price === null || detail === 'candle' || !(step > 0)) return null;
    const rows = this.fpView.rowsFor(fp, step);
    const r = rowAt(rows, fp.tick, price);
    if (r < 0) return null;
    const lo = (rows.lo + r) * rows.step;
    return { lo, hi: lo + rows.step - fp.tick, buy: rows.buy[r], sell: rows.sell[r] };
  }
}

/** Indeks świecy o początku `t` (wyszukiwanie binarne); −1 gdy brak. */
function indexOfTime(bars: readonly ProBar[], t: number): number {
  let lo = 0;
  let hi = bars.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = bars[mid].t;
    if (v === t) return mid;
    if (v < t) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
