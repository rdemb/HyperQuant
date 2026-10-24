import { CandlestickSeries, HistogramSeries, LineSeries, LineStyle, createChart } from 'lightweight-charts';
import type {
  CandlestickData,
  HistogramData,
  IChartApi,
  IPriceLine,
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
import { DEFAULT_THRESHOLD_USD, autoThreshold } from '../core/clashes';
import { Ohlc, cvdCandles, cvdLine, deltaCandle, oiChangeLine } from '../core/flow';
import { BarStat, barStat } from '../core/stats';
import { hlTick, rowAt } from '../core/footprintBar';
import type { LiqLevel } from '../core/indicators';
import type { ResetMode } from '../core/sessions';
import type { CandleSeries, ProBar, ProStore } from '../store/proStore';
import { requestHistory } from '../store/serverHistory';
import { DrawingLayer } from '../draw/layer';
import { DrawingTools } from '../draw/tools';
import { FootprintOptions, FootprintPoint, FootprintSeries } from './footprintSeries';
import { fmtPx } from './layout';
import { LiquidityLayer, LiquidityPick, LiquiditySource } from './liquidity';
import { IndicatorOverlay, IndicatorToggles, IndicatorValues, WhaleView } from './overlay';
import { LegendPart, PaneLegend } from './paneLegend';
import { STAT_PAD_PX, STAT_ROWS, STAT_ROW_PX, StatsTable } from './statsTable';
import { ZonesLayer } from './zonesLayer';
import { TpoLayer } from './tpoLayer';
import { tpoInterval } from '../core/tpo';
import type { ChartSettings } from './settings';
import { CountdownLabel } from './countdown';
import { BINANCE_OI_PERIOD, FlowVenue, OI_PERIOD_MS, OiVenue, per8h } from '../venues/parse';
import { VenueStore, acquireVenues, venueStoreFor } from '../venues/venueStore';
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

/** Liczby panelu przepływu: jednostki rynku ze znakiem. */
const FLOW_FORMAT: PriceFormat = { type: 'custom', minMove: 0.0001, formatter: fmtSignedVol };

const VOLUME_FORMAT: PriceFormat = { type: 'custom', minMove: 0.0001, formatter: (v: number) => fmtVol(v) };

const liqToggles = (s: ChartSettings) => ({ showHeatmap: s.showHeatmap, showBubbles: s.showBubbles, showClashes: s.showClashes, showLots: s.showLots });


/** TPO na interwale `ms` zajmuje miejsce profili sesji (oba rysują się od początku okresu w prawo). */
const tpoShown = (s: ChartSettings, ms: number) => s.showTpo && tpoInterval(ms);

const toggles = (s: ChartSettings, ms: number): IndicatorToggles => ({
  showVwap: s.showVwap,
  showVwapBands: s.showVwapBands,
  showSessionVwap: s.showSessionVwap,
  showProfile: s.showProfile,
  showPeriodProfiles: s.showPeriodProfiles && !tpoShown(s, ms),
  showDevPoc: s.showDevPoc,
  showLevels: s.showLevels,
  showSessions: s.showSessions,
  showIb: s.showIb,
  showLiq: s.showLiq,
  showWhales: s.showWhales,
});

/** Zmienionych świec powyżej tej liczby nie aktualizujemy pojedynczo, tylko podmieniamy całą serię. */
const MAX_POINT_UPDATES = 24;
/** Margines skali ceny bez legendy (ułamek wysokości panelu) — jak w motywie wykresu. */
const TOP_MARGIN = 0.06;
/** Doczytanie historii, gdy z lewej zostało mniej świec niż tyle. */
const LOAD_OLDER_MARGIN = 40;
/** Próg automatyczny dużego zlecenia: z zleceń ostatniej godziny, przeliczany co 5 s. */
const AUTO_WINDOW_MS = 3_600_000;
const AUTO_EVERY_MS = 5_000;
/** Statystyki świec przeliczane najwyżej co tyle ms (i po każdej pełnej podmianie danych). */
const STATS_EVERY_MS = 1_000;

/** Panele pod wykresem, które można ukryć krzyżykiem w ich rogu. */
export const PANE_KEYS = ['showVolume', 'showDelta', 'showCvd', 'showVenueCvd', 'showVenueOi', 'showStats'] as const;
export type PaneKey = (typeof PANE_KEYS)[number];

/** Autoskala ceny i wymiary rogu pod osią ceny (px), w którym stoi przycisk A. */
export interface ScaleState {
  auto: boolean;
  width: number;
  height: number;
}

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

/** Linie paneli giełd: Hyperliquid i giełdy CEX (spot przerywaną linią w kolorze swojej giełdy). */
type VenueLineId = 'hl' | FlowVenue;
const VENUE_LINE: Record<VenueLineId, { label: string; color: string; dashed: boolean }> = {
  hl: { label: 'HL', color: PRO.venueHl, dashed: false },
  binance: { label: 'Binance', color: PRO.venueBinance, dashed: false },
  binanceSpot: { label: 'spot', color: PRO.venueBinance, dashed: true },
  bybit: { label: 'Bybit', color: PRO.venueBybit, dashed: false },
};
const CVD_LINES: readonly VenueLineId[] = ['hl', 'binance', 'binanceSpot', 'bybit'];
const OI_LINES: readonly ('hl' | OiVenue)[] = ['hl', 'binance', 'bybit'];
/** Odczyt OI Hyperliquid (kanał na żywo, zapis serwera co minutę) starszy niż to nie liczy się jako stan świecy. */
const HL_OI_MAX_AGE = 3 * 60_000;
/** Węższy obszar wykresu (px) dostaje zwięzły opis paneli giełd. */
const COMPACT_LEGEND_PX = 480;

type VenueLines = Partial<Record<VenueLineId, (number | null)[]>>;

const fmtFunding = (r: number | null) => (r === null ? '—' : `${r >= 0 ? '+' : ''}${(r * 100).toFixed(4)}%`);

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

/** Wykresy na stronie (układ kilku paneli): chwila pod kursorem jednego pokazuje krzyż na pozostałych. */
const crossPeers = new Set<ProChartController>();
/** W trakcie ustawiania krzyża na innych panelach (ich zdarzenia krzyża nie są ruchem użytkownika). */
let crossSyncing = false;

export class ProChartController {
  readonly chart: IChartApi;
  readonly fpView = new FootprintSeries();
  private readonly main: ISeriesApi<'Custom', Time, FootprintPoint | WhitespaceData<Time>, FootprintOptions, SeriesPartialOptions<FootprintOptions>>;
  private volume: ISeriesApi<'Histogram'> | null = null;
  private delta: ISeriesApi<'Candlestick'> | null = null;
  private cvd: ISeriesApi<'Candlestick'> | null = null;
  /** Panel tabeli statystyk: niewidoczna seria (tylko oś czasu) z tabelą jako prymitywem. */
  private statsSeries: ISeriesApi<'Line'> | null = null;
  private readonly statsTable = new StatsTable();
  private stats: BarStat[] = [];
  private statsAt = 0;
  private readonly zones: ZonesLayer;
  private readonly tpo: TpoLayer;
  private priceTick = 1;
  /** Cena przeliczenia progu nierównowagi z USD na jednostki rynku (ustalana przy pełnym odświeżeniu danych). */
  private refPx = 0;
  private alertLines: IPriceLine[] = [];
  private readonly volumeLegend = new PaneLegend('showVolume');
  private readonly deltaLegend = new PaneLegend('showDelta');
  private readonly cvdLegend = new PaneLegend('showCvd');
  private readonly venueCvdLegend = new PaneLegend('showVenueCvd');
  private readonly venueOiLegend = new PaneLegend('showVenueOi');
  /** Linie paneli giełd i ich ostatnio wysłane wartości. */
  private venueCvd: Partial<Record<VenueLineId, ISeriesApi<'Line'>>> | null = null;
  private venueOi: Partial<Record<VenueLineId, ISeriesApi<'Line'>>> | null = null;
  private venueCvdData: VenueLines = {};
  private venueOiData: VenueLines = {};
  /** Przepływ Binance i Bybit tego rynku (tylko z włączonym panelem giełd) i zwolnienie jego połączeń. */
  private venue: VenueStore | null = null;
  private venueInterval: string | null = null;
  private releaseVenue: (() => void) | null = null;
  private unsubVenue: (() => void) | null = null;
  private readonly overlay: IndicatorOverlay;
  private readonly liquidity: LiquidityLayer;
  private readonly drawLayer = new DrawingLayer();
  private readonly countdown = new CountdownLabel();
  private countdownTimer = 0;
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
  /** Kursor użytkownika jest nad tym wykresem (nie krzyż z innego panelu). */
  private userHover = false;
  private horzLine = true;
  /** Po pierwszych danych nowej serii przewiń do bieżącej świecy. */
  private toNow = false;
  private autoUsd = DEFAULT_THRESHOLD_USD;
  private autoAt = 0;
  private readonly liqSource: LiquiditySource;
  private readonly unsubscribe: () => void;
  private readonly onHover: (h: Hover) => void;
  private readonly onPick: (p: LiquidityPick | null) => void;
  private readonly onHidePane: (key: PaneKey) => void;
  private readonly onScale: (s: ScaleState) => void;
  private scale: ScaleState = { auto: true, width: 0, height: 0 };
  private scaleFrame = 0;
  private readonly container: HTMLElement;

  constructor(
    container: HTMLElement,
    private readonly store: ProStore,
    private series: CandleSeries,
    settings: ChartSettings,
    onHover: (h: Hover) => void,
    onPick: (p: LiquidityPick | null) => void,
    onHidePane: (key: PaneKey) => void,
    onScale: (s: ScaleState) => void
  ) {
    this.settings = settings;
    this.onHover = onHover;
    this.onPick = onPick;
    this.onHidePane = onHidePane;
    this.onScale = onScale;
    this.container = container;
    this.liqSource = {
      near: null,
      far: null,
      orders: (from, to) => store.orders.range(from, to),
      walls: (from, to, t) => store.walls.walls(from, to, t),
    };
    this.chart = createChart(container, chartOptions());
    this.main = this.chart.addCustomSeries<FootprintPoint, FootprintOptions>(this.fpView, {
      priceFormat: { type: 'custom', minMove: 1, formatter: fmtPx },
      priceLineVisible: true,
      priceLineColor: PRO.priceLine,
      lastValueVisible: true,
    });
    // Mapa ciepła pod profilem i pasmami (kolejność dołączenia = kolejność rysowania w tej samej warstwie)
    this.liquidity = new LiquidityLayer(liqToggles(settings));
    this.main.attachPrimitive(this.liquidity);
    this.overlay = new IndicatorOverlay(toggles(settings, series.interval.ms));
    this.main.attachPrimitive(this.overlay);
    this.zones = new ZonesLayer({ showZones: settings.showZones, showAuctions: settings.showAuctions });
    this.main.attachPrimitive(this.zones);
    this.tpo = new TpoLayer(settings.showTpo);
    this.main.attachPrimitive(this.tpo);
    this.main.attachPrimitive(this.countdown);
    // Rysunki dołączone ostatnie — nad wskaźnikami i świecami
    this.drawLayer.setUnit(store.coin);
    this.main.attachPrimitive(this.drawLayer);
    this.draw = new DrawingTools(container, this.chart, this.drawLayer, store.coin);
    this.applySettings(settings, true);
    this.chart.subscribeCrosshairMove(this.onCrosshair);
    this.chart.subscribeClick(this.onClick);
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(this.onRange);
    // Przeciągnięcie osi albo panelu wyłącza autoskalę, dwuklik na osi ją włącza — stan sprawdzany po geście
    window.addEventListener('pointerup', this.checkScale);
    container.addEventListener('dblclick', this.checkScale);
    this.unsubscribe = store.subscribe(() => this.schedule());
    // Odliczanie do zamknięcia świecy biegnie co sekundę także bez nowych transakcji
    this.countdownTimer = window.setInterval(() => this.tickCountdown(), 1000);
    crossPeers.add(this);
    this.schedule();
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.marginFrame);
    cancelAnimationFrame(this.scaleFrame);
    clearInterval(this.countdownTimer);
    window.removeEventListener('pointerup', this.checkScale);
    this.container.removeEventListener('dblclick', this.checkScale);
    this.draw.destroy();
    crossPeers.delete(this);
    this.unsubscribe();
    this.releaseVenue?.();
    this.unsubVenue?.();
    this.chart.unsubscribeCrosshairMove(this.onCrosshair);
    this.chart.unsubscribeClick(this.onClick);
    this.chart.timeScale().unsubscribeVisibleLogicalRangeChange(this.onRange);
    this.chart.remove();
  }

  /** Próg nierównowagi w jednostkach rynku (3 cyfry znaczące, więc pamięć podręczna wierszy footprintu się nie unieważnia). */
  private minVol(s: ChartSettings): number {
    return this.refPx > 0 && s.imbalanceMinUsd > 0 ? Number((s.imbalanceMinUsd / this.refPx).toPrecision(3)) : 0;
  }

  private zoneParams(s: ChartSettings) {
    return { rowStep: s.rowStep, imbalance: { ratio: s.imbalanceRatio, minVol: this.minVol(s) }, stackedMin: s.stackedMin };
  }

  /** Inny interwał tego rynku: pełne odświeżenie danych wykresu z nowej serii. */
  setSeries(series: CandleSeries): void {
    if (series === this.series) return;
    this.series = series;
    this.bars = [];
    // Indeks świecy innego interwału to zupełnie inna chwila — zamiast przesuniętego widoku bieżąca świeca
    this.toNow = true;
    this.overlay.setToggles(toggles(this.settings, series.interval.ms));
    this.syncVenueLive();
    this.schedule();
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
      imbalanceMinVol: this.minVol(s),
      stackedMin: s.stackedMin,
    });
    this.overlay.setToggles(toggles(s, this.series.interval.ms));
    this.tpo.setOn(s.showTpo);
    this.liquidity.setToggles(liqToggles(s));
    this.zones.setToggles({ showZones: s.showZones, showAuctions: s.showAuctions });
    this.zones.setParams(this.zoneParams(s));
    if (prev.bigTradeUsd !== s.bigTradeUsd) this.schedule();
    if (force || prev.showHeatmap !== s.showHeatmap) {
      // Z mapą ciepła przy prawej krawędzi stoi drabina DOM: najnowsza świeca i wskaźniki kończą się przed nią
      this.overlay.setRightInset(s.showHeatmap ? DOM_W_PX : 0);
      this.zones.setRightInset(s.showHeatmap ? DOM_W_PX : 0);
      this.tpo.setRightInset(s.showHeatmap ? DOM_W_PX : 0);
      this.chart.timeScale().applyOptions({ rightOffsetPixels: this.rightGap() });
    }
    this.syncVenueLive();
    const panesChanged =
      force ||
      prev.showVolume !== s.showVolume ||
      prev.showDelta !== s.showDelta ||
      prev.showCvd !== s.showCvd ||
      prev.showVenueCvd !== s.showVenueCvd ||
      prev.showVenueOi !== s.showVenueOi ||
      prev.showStats !== s.showStats;
    if (panesChanged) this.rebuildPanes();
    else if (prev.cvdReset !== s.cvdReset) {
      this.cvdData = [];
      this.venueCvdData = {};
      this.venueOiData = {};
      this.pushCvd(true);
      this.pushVenues(true);
    }
    this.emitHover();
  }

  private rebuildPanes(): void {
    const s = this.settings;
    const venueSeries = [...Object.values(this.venueCvd ?? {}), ...Object.values(this.venueOi ?? {})];
    for (const sr of [this.volume, this.delta, this.cvd, this.statsSeries, ...venueSeries]) if (sr) this.chart.removeSeries(sr);
    this.volume = this.delta = this.cvd = this.statsSeries = null;
    this.venueCvd = this.venueOi = null;
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
    if (s.showVenueCvd) this.venueCvd = this.addVenueLines(CVD_LINES, pane++, this.venueCvdLegend);
    if (s.showVenueOi) this.venueOi = this.addVenueLines(OI_LINES, pane++, this.venueOiLegend);
    if (s.showStats) {
      this.statsSeries = this.chart.addSeries(
        LineSeries,
        {
          lineVisible: false,
          pointMarkersVisible: false,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
          // Oś panelu bez liczb (ukrycie skali w jednym panelu psuje układ wykresu)
          priceFormat: { type: 'custom', minMove: 1, formatter: () => '' },
        },
        pane++
      );
      this.statsSeries.attachPrimitive(this.statsTable);
    }
    // Opis najniższego panelu omija logo TradingView (tabela statystyk ma na nie własne miejsce)
    const lowest = s.showStats
      ? null
      : s.showVenueOi
        ? this.venueOiLegend
        : s.showVenueCvd
          ? this.venueCvdLegend
          : s.showCvd
            ? this.cvdLegend
            : s.showDelta
              ? this.deltaLegend
              : s.showVolume
                ? this.volumeLegend
                : null;
    for (const lg of [this.volumeLegend, this.deltaLegend, this.cvdLegend, this.venueCvdLegend, this.venueOiLegend]) lg.setBottom(lg === lowest);
    const panes = this.chart.panes();
    panes[0]?.setStretchFactor(1);
    const statsPane = this.statsSeries?.getPane();
    const venuePanes = new Set([this.venueCvd?.hl?.getPane(), this.venueOi?.hl?.getPane()]);
    // Panele giełd mają opis w dwóch wierszach (na telefonie także), więc są wyższe niż CVD
    for (let i = 1; i < panes.length; i++)
      if (panes[i] !== statsPane) panes[i].setStretchFactor(panes[i] === this.volume?.getPane() ? 0.14 : venuePanes.has(panes[i]) ? 0.3 : 0.22);
    // Tabela ma stałą wysokość wiersza: wysokość panelu ustawiamy po ułożeniu pozostałych
    // (panele mogły zostać przebudowane przed następną klatką — wtedy ten panel już nie istnieje)
    const stats = this.statsSeries;
    if (stats) requestAnimationFrame(() => this.statsSeries === stats && stats.getPane().setHeight(STAT_ROWS.length * STAT_ROW_PX + STAT_PAD_PX));
    this.setTopInset(this.topInset);
    // Nowe serie dostają pełne dane przy następnej synchronizacji
    this.bars = [];
    this.cvdData = [];
    this.venueCvdData = {};
    this.venueOiData = {};
    this.schedule();
  }

  /** Linie giełd w nowym panelu: zero jako linia odniesienia, opis panelu na pierwszej linii. */
  private addVenueLines(ids: readonly VenueLineId[], pane: number, legend: PaneLegend): Partial<Record<VenueLineId, ISeriesApi<'Line'>>> {
    const out: Partial<Record<VenueLineId, ISeriesApi<'Line'>>> = {};
    for (const id of ids) {
      const v = VENUE_LINE[id];
      out[id] = this.chart.addSeries(
        LineSeries,
        {
          color: v.color,
          lineWidth: 2,
          lineStyle: v.dashed ? LineStyle.Dashed : LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerRadius: 3,
          priceFormat: FLOW_FORMAT,
        },
        pane
      );
    }
    const first = out[ids[0]]!;
    first.createPriceLine({ price: 0, color: PRO.divider, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: false, title: '' });
    first.attachPrimitive(legend);
    return out;
  }

  /** Połączenia Binance i Bybit tylko z włączonym panelem giełd, dla bieżącego interwału wykresu. */
  private syncVenueLive(): void {
    const s = this.settings;
    const want = s.showVenueCvd || s.showVenueOi ? this.series.interval.id : null;
    if (want === this.venueInterval) return;
    this.venueInterval = want;
    this.releaseVenue?.();
    this.releaseVenue = null;
    if (want === null) {
      this.unsubVenue?.();
      this.unsubVenue = null;
      this.venue = null;
      return;
    }
    if (!this.venue) {
      this.venue = venueStoreFor(this.store.coin);
      this.unsubVenue = this.venue.subscribe(() => this.schedule());
    }
    this.releaseVenue = acquireVenues(this.store.coin, this.series.interval);
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

  /** Próg dużego zlecenia (USD): ręczny z ustawień albo automatyczny z rynku. */
  get bigTradeUsd(): number {
    return this.settings.bigTradeUsd > 0 ? this.settings.bigTradeUsd : this.autoUsd;
  }

  /** Zaznaczenie obiektu warstwy płynności (bąbel z taśmy, seria, ściana) i podświetlenie adresu biorcy. */
  select(p: LiquidityPick | null): void {
    this.liquidity.setSelected(p);
  }

  highlight(address: string): void {
    this.liquidity.setHighlight(address);
  }

  /** Pozycje i zlecenia największych kont na tym rynku (null = brak aktualnej warstwy). */
  setWhales(w: WhaleView | null): void {
    this.overlay.setWhales(w);
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

  /** Cena w punkcie panelu ceny (px od góry wykresu); null poza panelem. */
  priceAt(y: number): number | null {
    if (!(y >= 0 && y < this.chart.paneSize(0).height)) return null;
    const p = this.main.coordinateToPrice(y);
    return p !== null && p > 0 ? p : null;
  }

  /** Położenie ceny w panelu ceny (px od góry); null poza skalą. */
  yOf(price: number): number | null {
    return this.main.priceToCoordinate(price);
  }

  /** Poziomy alertów cenowych rynku jako przerywane linie z etykietą na osi. */
  setAlerts(prices: readonly number[]): void {
    for (const l of this.alertLines) this.main.removePriceLine(l);
    this.alertLines = prices.map((price) =>
      this.main.createPriceLine({ price, color: PRO.warn, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Alert' })
    );
  }

  /** Dopasowuje zakres ceny do widocznych świec (po ręcznym przeciągnięciu osi). */
  resetScales(): void {
    this.setAutoScale(true);
    this.scrollToNow();
  }

  /** Autoskala ceny (przycisk A w rogu osi): włączona dopasowuje zakres do widocznych świec, wyłączona go zamraża. */
  setAutoScale(on: boolean): void {
    this.chart.priceScale('right').applyOptions({ autoScale: on });
    this.emitScale();
  }

  private readonly checkScale = (): void => {
    cancelAnimationFrame(this.scaleFrame);
    this.scaleFrame = requestAnimationFrame(() => {
      this.scaleFrame = 0;
      this.emitScale();
    });
  };

  /** Stan autoskali i wymiary rogu pod osią ceny (szerokość osi ceny × wysokość osi czasu) — tylko przy zmianie. */
  private emitScale(): void {
    const ps = this.chart.priceScale('right');
    const next: ScaleState = { auto: ps.options().autoScale, width: ps.width(), height: this.chart.timeScale().height() };
    const s = this.scale;
    if (s.auto === next.auto && s.width === next.width && s.height === next.height) return;
    this.scale = next;
    this.onScale(next);
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
    const next = this.series.bars();
    const prev = this.bars;
    this.bars = next;
    const changed: number[] = [];
    let full = prev.length === 0 || next.length < prev.length || next[0]?.t !== prev[0]?.t;
    if (!full) {
      for (let i = 0; i < next.length && changed.length <= MAX_POINT_UPDATES; i++) if (next[i] !== prev[i]) changed.push(i);
      full = changed.length > MAX_POINT_UPDATES;
    }
    if (full) {
      // Krok osi ceny = tick rynku (BTC 1 USD, HYPE 0,001 USD)
      const tick = hlTick(next[next.length - 1]?.candle.c ?? 0);
      if (tick !== this.priceTick) {
        this.priceTick = tick;
        this.main.applyOptions({ priceFormat: { type: 'custom', minMove: tick, formatter: fmtPx } });
      }
      const px = next[next.length - 1]?.candle.c ?? 0;
      if (px > 0 && Math.abs(px / this.refPx - 1) > 0.05) {
        this.refPx = px;
        this.main.applyOptions({ imbalanceMinVol: this.minVol(this.settings) });
        this.zones.setParams(this.zoneParams(this.settings));
      }
      this.main.setData(next.map(toPoint));
      this.volume?.setData(next.map(toVolume));
      this.delta?.setData(next.map(toDelta));
      this.statsSeries?.setData(next.map((b) => ({ time: sec(b.t) })));
      if (this.toNow && next.length > 0) {
        this.toNow = false;
        this.scrollToNow();
      }
    } else {
      for (const i of changed) {
        const historical = i < prev.length - 1;
        const b = next[i];
        this.main.update(toPoint(b), historical);
        this.volume?.update(toVolume(b), historical);
        this.delta?.update(toDelta(b), historical);
        if (!historical) this.statsSeries?.update({ time: sec(b.t) });
      }
    }
    const ms = this.series.interval.ms;
    this.overlay.setBars(next, ms);
    this.overlay.setDaily(this.store.daily);
    this.drawLayer.setBars(next, ms);
    const st = this.store;
    const now = st.serverNow();
    if (now - this.autoAt >= AUTO_EVERY_MS) {
      this.autoAt = now;
      this.autoUsd = autoThreshold(st.orders.range(now - AUTO_WINDOW_MS, now + 1));
    }
    this.liqSource.near = st.book('near');
    this.liqSource.far = st.book('far');
    this.liquidity.setData(next, ms, this.liqSource, now, this.bigTradeUsd);
    this.zones.setData(next, ms, now);
    this.tpo.setData(next, ms);
    if (this.statsSeries && (full || now - this.statsAt >= STATS_EVERY_MS || next.length !== this.stats.length)) {
      this.statsAt = now;
      const predicted = st.ctx ? st.ctx.funding : null;
      this.stats = next.map((b) => barStat(b, ms, now, st.oi, st.funding, predicted));
      this.statsTable.setStats(this.stats);
    }
    this.pushCvd(full);
    this.pushVenues(full);
    this.emitHover();
    this.emitScale();
    this.tickCountdown();
  }

  private tickCountdown(): void {
    const last = this.bars[this.bars.length - 1];
    this.countdown.set(last?.candle.c ?? 0, last ? last.t + this.series.interval.ms - this.store.serverNow() : 0);
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

  /** Linie paneli giełd: CVD (delta świec Hyperliquid, Binance perp i spot, Bybit) i zmiana OI od początku okresu. */
  private pushVenues(full: boolean): void {
    const v = this.venue;
    const bars = this.bars;
    if (!v || (!this.venueCvd && !this.venueOi) || bars.length === 0) return;
    const iv = this.series.interval;
    const now = this.store.serverNow();
    const mode = this.settings.cvdReset;
    v.ensure(iv, bars[0].t);
    const times = bars.map((b) => b.t);
    if (this.venueCvd) {
      const next: VenueLines = {
        hl: cvdLine(times, (i) => bars[i].fp?.delta ?? null, mode),
        binance: cvdLine(times, (i) => v.delta('binance', iv, times[i], now), mode),
        binanceSpot: cvdLine(times, (i) => v.delta('binanceSpot', iv, times[i], now), mode),
        bybit: cvdLine(times, (i) => v.delta('bybit', iv, times[i], now), mode),
      };
      for (const id of CVD_LINES) this.pushLine(this.venueCvd[id]!, times, this.venueCvdData[id], next[id]!, full);
      this.venueCvdData = next;
    }
    if (this.venueOi) {
      // Historia OI giełd co 5 min i dłużej: odczyt do dwóch okresów wstecz nadal opisuje świecę
      const age = 2 * OI_PERIOD_MS[BINANCE_OI_PERIOD[iv.id]];
      const next: VenueLines = {
        hl: oiChangeLine(times, iv.ms, now, (t) => this.store.oi.atWithin(t, HL_OI_MAX_AGE), mode),
        binance: oiChangeLine(times, iv.ms, now, (t) => v.oi.binance.atWithin(t, age), mode),
        bybit: oiChangeLine(times, iv.ms, now, (t) => v.oi.bybit.atWithin(t, age), mode),
      };
      for (const id of OI_LINES) this.pushLine(this.venueOi[id]!, times, this.venueOiData[id], next[id]!, full);
      this.venueOiData = next;
    }
  }

  /** Linia panelu: pełna podmiana albo tylko zmienione punkty (zwykle bieżąca świeca). */
  private pushLine(series: ISeriesApi<'Line'>, times: readonly number[], prev: readonly (number | null)[] | undefined, next: readonly (number | null)[], full: boolean): void {
    const point = (i: number) => {
      const y = next[i];
      return y === null ? { time: sec(times[i]) } : { time: sec(times[i]), value: y };
    };
    if (full || !prev || prev.length === 0 || prev.length > next.length) {
      series.setData(next.map((_, i) => point(i)));
      return;
    }
    const changed: number[] = [];
    for (let i = 0; i < next.length && changed.length <= MAX_POINT_UPDATES; i++) if (i >= prev.length || prev[i] !== next[i]) changed.push(i);
    if (changed.length > MAX_POINT_UPDATES) {
      series.setData(next.map((_, i) => point(i)));
      return;
    }
    for (const i of changed) series.update(point(i), i < prev.length - 1);
  }

  /** Opis panelu giełd: nazwa i okres, potem znak linii, giełda i wartość pod krzyżem (albo bieżąca). */
  private venueLegend(title: string, ids: readonly VenueLineId[], data: VenueLines, i: number): LegendPart[] {
    const parts: LegendPart[] = [{ text: title, color: PRO.ink3 }];
    for (const id of ids) {
      const v = VENUE_LINE[id];
      const y = i >= 0 ? (data[id]?.[i] ?? null) : null;
      parts.push({ text: v.dashed ? '┅' : '━', color: v.color }, { text: v.label, color: PRO.ink3, glue: true });
      parts.push(y === null ? { text: '—', color: PRO.ink3, glue: true } : { text: fmtSignedVol(y), color: y >= 0 ? PRO.buyInk : PRO.sellInk, glue: true });
    }
    return parts;
  }

  // ───────────────────────── interakcja ─────────────────────────

  private readonly onRange = (range: LogicalRange | null): void => {
    if (!range || this.bars.length === 0) return;
    if (range.from < LOAD_OLDER_MARGIN) void this.series.loadOlder();
    // Historia taśmy i arkusza z serwera od lewej krawędzi widoku
    requestHistory(this.store, this.bars[Math.min(this.bars.length - 1, Math.max(0, Math.floor(range.from)))].t);
  };

  /** Kliknięcie: krzyżyk ukrycia panelu, obiekt warstwy płynności pod kursorem albo nic (zamyka kartę). */
  private readonly onClick = (p: MouseEventParams<Time>): void => {
    const hit = p.hoveredObjectId;
    if (typeof hit === 'string' && hit.startsWith('pane:')) {
      const key = hit.slice(5);
      if ((PANE_KEYS as readonly string[]).includes(key)) this.onHidePane(key as PaneKey);
      return;
    }
    const pick = p.point && p.paneIndex === 0 ? this.liquidity.pick(p.point.x, p.point.y) : null;
    this.liquidity.setSelected(pick);
    this.onPick(pick);
  };

  private readonly onCrosshair = (p: MouseEventParams<Time>): void => {
    if (p.sourceEvent) this.setHorzLine(true);
    this.hoverTime = p.time !== undefined && p.point ? (p.time as number) * 1000 : null;
    this.hoverPrice = p.point && p.paneIndex === 0 ? this.main.coordinateToPrice(p.point.y) : null;
    this.emitHover();
    // Krzyż ustawiony z innego panelu nie jest ruchem użytkownika — nie rozsyłamy go dalej
    if (crossSyncing) return;
    if (p.sourceEvent && p.point) this.userHover = true;
    else if (!p.point && this.userHover) this.userHover = false;
    else return;
    crossSyncing = true;
    try {
      for (const peer of crossPeers) if (peer !== this) peer.showCross(this.userHover ? this.hoverTime : null, this.store.coin, this.hoverPrice);
    } finally {
      crossSyncing = false;
    }
  };

  /** Krzyż z innego panelu: świeca tego interwału obejmująca chwilę `t`; cena tylko z tego samego rynku. */
  private showCross(t: number | null, coin: string, price: number | null): void {
    const ms = this.series.interval.ms;
    const i = t === null ? -1 : indexOfTime(this.bars, Math.floor(t / ms) * ms);
    if (i < 0) {
      this.chart.clearCrosshairPosition();
      return;
    }
    const bar = this.bars[i];
    const same = coin === this.store.coin && price !== null;
    this.setHorzLine(same);
    this.chart.setCrosshairPosition(same ? price : bar.candle.c, sec(bar.t), this.main);
  }

  /** Pozioma linia krzyża i jej etykieta — ukryte, gdy krzyż przychodzi z wykresu innego rynku (jego cena tu nic nie znaczy). */
  private setHorzLine(on: boolean): void {
    if (this.horzLine === on) return;
    this.horzLine = on;
    this.chart.applyOptions({ crosshair: { horzLine: { visible: on, labelVisible: on } } });
  }

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
    // Wąski wykres (telefon): bez okresu (ten sam co w opisie CVD) i bez wiersza finansowania — opis mieści się w dwóch wierszach
    const compact = this.chart.timeScale().width() < COMPACT_LEGEND_PX;
    const period = compact ? '' : ` · ${RESET_LABEL[this.settings.cvdReset]}`;
    if (this.venueCvd) this.venueCvdLegend.set(this.venueLegend(`CVD giełd${period}`, CVD_LINES, this.venueCvdData, i));
    if (this.venueOi) {
      const lines = this.venueLegend(`ΔOI giełd${period}`, OI_LINES, this.venueOiData, i);
      // Drugi wiersz: bieżące finansowanie giełd przeliczone na 8 h (Hyperliquid rozlicza co godzinę)
      const hlRate = this.store.ctx ? per8h(this.store.ctx.funding, 1) : null;
      const funding: LegendPart[] = [
        { text: '', color: PRO.ink3, br: true },
        { text: 'Funding 8 h teraz', color: PRO.ink3 },
        { text: 'HL', color: PRO.ink3 },
        { text: fmtFunding(hlRate), color: PRO.ink1, glue: true },
        { text: 'Binance', color: PRO.ink3 },
        { text: fmtFunding(this.venue?.funding.binance ?? null), color: PRO.ink1, glue: true },
        { text: 'Bybit', color: PRO.ink3 },
        { text: fmtFunding(this.venue?.funding.bybit ?? null), color: PRO.ink1, glue: true },
      ];
      this.venueOiLegend.set(compact ? lines : [...lines, ...funding]);
    }
    const ind = i >= 0 ? this.overlay.valuesAt(i) : null;
    this.statsTable.setHover(this.hoverTime === null ? -1 : i);
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
