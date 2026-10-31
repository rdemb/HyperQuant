import { CandlestickSeries, HistogramSeries, LineSeries, LineStyle, LineType, PriceScaleMode, createChart } from 'lightweight-charts';
import type {
  AutoscaleInfo,
  CandlestickData,
  HistogramData,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  LineSeriesOptions,
  LineWidth,
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
import { Ohlc, cvdCandles, cvdLine, deltaCandle, flipsEmpty, oiChangeLine } from '../core/flow';
import { BarStat, VENUE_GROUPS, barStat } from '../core/stats';
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
import { STATS_BAR_SPACING, StatsTable, tableHeight } from './statsTable';
import { ZonesLayer } from './zonesLayer';
import { TpoLayer } from './tpoLayer';
import { tpoInterval } from '../core/tpo';
import { fmtHm } from '../core/time';
import type { ChartSettings } from './settings';
import { IndicatorEngine } from '../indicators/engine';
import { HIST_DOWN, HIST_UP, IndicatorDef, IndicatorInstance, PlotDef, indicatorDef, indicatorLabel, plotShift } from '../indicators/registry';
import { CloudFill, CloudSource } from './cloudFill';
import { ConeForecast, ConeLayer, ConeSource } from './coneLayer';
import { Hip4Layer, Hip4Source, outcomeLevels } from './hip4Layer';
import type { Hip4State } from '../../../state/useHip4';
import { CountdownLabel } from './countdown';
import { FlowVenue, OiVenue, oiMaxAge, per8h } from '../venues/parse';
import { VenueStore, acquireVenues, venueStoreFor } from '../venues/venueStore';
import { DOM_W_PX, PRO, RIGHT_GAP_PX, chartOptions, rgba } from './theme';
import { tr } from '../../../i18n';
import type { DeskLedgerSummary } from '../../../utils/deskLedger';
import { fmtCompact, fmtPrice, numLang } from '../../../ui/format';

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

/** Klasyczny wskaźnik na wykresie ceny w legendzie: podpis i wartości plotów pod krzyżem w ich kolorach. */
export interface IndicatorReadout {
  iid: string;
  label: string;
  values: { text: string; color: string }[];
}

/** Seria plotu wskaźnika: linia albo słupki (histogram MACD). */
type IndSeries = ISeriesApi<'Line'> | ISeriesApi<'Histogram'>;

export interface Hover {
  bar: ProBar | null;
  /** true = brak krzyża, pokazujemy ostatnią świecę. */
  live: boolean;
  /** Świeca jeszcze trwa (w powtórce ostatnia bywa już zamknięta). */
  open: boolean;
  row: HoverRow | null;
  cvd: Ohlc | null;
  ind: IndicatorValues | null;
  indicators: IndicatorReadout[];
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
/** Telefon: wolumen zajmuje dolną część wykresu ceny (ułamek wysokości). */
const PHONE_VOLUME_H = 0.16;
/** Statystyki świec przeliczane najwyżej co tyle ms (i po każdej pełnej podmianie danych). */
const STATS_EVERY_MS = 1_000;

/** Panele pod wykresem, które można ukryć krzyżykiem w ich rogu. */
export const PANE_KEYS = ['showVolume', 'showDelta', 'showCvd', 'showVenueCvd', 'showVenueOi', 'showStats'] as const;
export type PaneKey = (typeof PANE_KEYS)[number];
/** Krzyżyk w rogu panelu: panel z ustawień albo wskaźnik we własnym panelu (`ind:<iid>`). */
export type HideKey = PaneKey | `ind:${string}`;

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

const RESET_LABEL: Record<ResetMode, string> = {
  none: tr('ciągła', 'continuous'),
  session: tr('sesja', 'session'),
  day: tr('doba UTC', 'UTC day'),
  week: tr('tydzień', 'week'),
};

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
/** Stożek: prognoza z dziennika starsza niż to nie jest rysowana (jak przeterminowany dziennik w Planie). */
const CONE_MAX_AGE_MS = 3 * 3_600_000;
/** Dziennik: szanse dotknięcia poziomów w 2 h od początku horyzontu (jak w Planie). */
const CONE_TOUCH_MIN = 120;
/** Pokrycie przedziałów w legendzie stożka od tylu rozstrzygnięć (jak w Planie). */
const CONE_MIN_N = 20;
const horizonLabel = (h: number) => (h % 60 === 0 ? `${h / 60} h` : `${h} min`);
/** Notowania rynków HIP-4 starsze niż tyle nie są rysowane (pobierane co minutę). */
const HIP4_MAX_AGE_MS = 3 * 60_000;
const pctLabel = (v: number) => `${numLang(String(Math.round(v * 100)))}%`;
const CONE_LEVELS = [
  ['pdh', 'PDH'],
  ['deq', 'D-EQ'],
  ['pdl', 'PDL'],
] as const;

type VenueLines = Partial<Record<VenueLineId, (number | null)[]>>;

const fmtFunding = (r: number | null) => (r === null ? '—' : `${r >= 0 ? '+' : ''}${numLang((r * 100).toFixed(4))}%`);

function flowLegend(label: string, value: number | null): LegendPart[] {
  if (value === null) return [{ text: label, color: PRO.ink3 }];
  return [
    { text: label, color: PRO.ink3 },
    { text: fmtSignedVol(value), color: value >= 0 ? PRO.buyInk : PRO.sellInk },
  ];
}

/** Linie poziomów w panelu wskaźnika (RSI 70, 50, 30): widoczne, ale ciszej niż linia wskaźnika. */
const LEVEL_COLOR = rgba(PRO.ink3, 0.45);
/** Odcinek bez koloru: przerwa między poziomami kolejnych okresów. */
const CLEAR = 'rgba(0, 0, 0, 0)';

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

/** Chwila widoku przenoszona do wykresów karty otwieranej przy przełączeniu kart (ważna kilka sekund). */
let carried: { t: number; until: number } | null = null;
const CARRY_MS = 5000;
/** Najwięcej stron starszej historii doczytywanych, żeby wykres nowej karty objął przeniesioną chwilę. */
const CARRY_PAGES = 4;

/**
 * Przełączenie karty: środek widoku wykresu, w którym ostatnio kliknięto (inaczej pierwszego), przechodzi do wykresów
 * nowej karty. Widok przy bieżącej świecy nic nie przenosi — nowa karta też otworzy się przy bieżącej świecy.
 */
export function carryViewTime(): void {
  const peers = [...crossPeers];
  const from = peers.find((p) => p.draw.isFocused) ?? peers[0];
  const t = from?.viewTime() ?? null;
  carried = t === null ? null : { t, until: Date.now() + CARRY_MS };
}
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
  private zoneLines: IPriceLine[] = [];
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
  /** Klasyczne wskaźniki: przeliczanie, ich linie (po jednej na plot) i opisy własnych paneli, w kolejności instancji. */
  private readonly engine = new IndicatorEngine();
  private indSeries: IndSeries[][] = [];
  /** Plot bez wartości na ostatniej świecy (np. nieaktywna linia Supertrendu): bez starej liczby na osi ceny, jak w TradingView. */
  private indGap: boolean[][] = [];
  /** Liczba świec, których punkty wskaźników są już na wykresie. */
  private indPushed = 0;
  /** Czas świecy o indeksie 0 przy świecach co interwał od ostatniej: punkty przesunięte za ostatnią świecę liczą czas od niej. */
  private indAnchor = Number.NaN;
  /** Wypełnienie chmury instancji (Ichimoku). */
  private indClouds: (CloudFill | null)[] = [];
  /** Po zmianie listy wskaźników: przy najbliższym wysłaniu dopasować odstęp świec do chmury w przód. */
  private indFit = false;
  private indLegends: (PaneLegend | null)[] = [];
  /** Widoczne instancje ze stylem (kolor legendy); przeliczanie trzyma je w silniku. */
  private indShown: IndicatorInstance[] = [];
  private indKey = '';
  private indStyleKey = '';
  /** Kliknięcie opisu wskaźnika w jego panelu: okno ustawień instancji. */
  onEditIndicator: ((iid: string) => void) | null = null;
  /** Przepływ Binance i Bybit tego rynku (tylko z włączonym panelem giełd) i zwolnienie jego połączeń. */
  private venue: VenueStore | null = null;
  private venueInterval: string | null = null;
  private releaseVenue: (() => void) | null = null;
  private unsubVenue: (() => void) | null = null;
  private readonly overlay: IndicatorOverlay;
  private readonly liquidity: LiquidityLayer;
  private readonly drawLayer = new DrawingLayer();
  private readonly countdown = new CountdownLabel();
  /** Stożek prognozy zakresu z dziennika Desku (wskaźnik „Stożek”). */
  private readonly cone = new ConeLayer(() => this.coneSource());
  private ledger: DeskLedgerSummary | null = null;
  /** Rynki wynikowe HIP-4 z modelem Desku (wskaźnik „HIP-4”); null — niepobierane (inny rynek, powtórka, wskaźnik ukryty). */
  private readonly hip4 = new Hip4Layer(() => this.hip4Source());
  private outcomes: Hip4State | null = null;
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
  /** Telefon: wolumen na dole wykresu ceny, bez drabiny DOM przy prawej krawędzi, podpisy wielorybów po dotknięciu. */
  private phone = false;
  private hoverTime: number | null = null;
  private hoverPrice: number | null = null;
  /** Kursor użytkownika jest nad tym wykresem (nie krzyż z innego panelu). */
  private userHover = false;
  private horzLine = true;
  /** Po pierwszych danych nowej serii przewiń do bieżącej świecy. */
  private toNow = false;
  /** Chwila z poprzedniej karty: po pierwszych danych widok na niej zamiast na bieżącej świecy. */
  private focusT: number | null = null;
  private focusPages = 0;
  private autoUsd = DEFAULT_THRESHOLD_USD;
  private autoAt = 0;
  private readonly liqSource: LiquiditySource;
  private readonly unsubscribe: () => void;
  private readonly onHover: (h: Hover) => void;
  private readonly onPick: (p: LiquidityPick | null) => void;
  private readonly onHidePane: (key: HideKey) => void;
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
    onHidePane: (key: HideKey) => void,
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
    this.main.attachPrimitive(this.cone);
    this.main.attachPrimitive(this.hip4);
    this.main.attachPrimitive(this.countdown);
    // Rysunki dołączone ostatnie — nad wskaźnikami i świecami
    this.drawLayer.setUnit(store.coin);
    this.main.attachPrimitive(this.drawLayer);
    // Rysunki w powtórce osobno od rysunków wykresu na żywo
    this.draw = new DrawingTools(container, this.chart, this.drawLayer, store.replay ? `${store.coin}.replay` : store.coin);
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
    if (carried && Date.now() < carried.until) this.focusT = carried.t;
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
    // Klatka z fitStatsPane zaplanowana przed zamknięciem nie może sięgnąć do usuniętego wykresu
    this.statsSeries = null;
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
    if (force || prev.showHeatmap !== s.showHeatmap) this.applyDomInset();
    if (force || prev.statGroups !== s.statGroups) {
      this.statsTable.setGroups(s.statGroups);
      this.statsAt = 0;
      if (!force && s.showStats && prev.showStats) this.fitStatsPane();
      this.schedule();
    }
    this.syncVenueLive();
    // Lista, parametry i widoczność wskaźników przebudowują ich serie razem z panelami; sam styl zmienia opcje linii
    const indShown = s.indicators.filter((x) => x.visible);
    const indKey = JSON.stringify(indShown.map((x) => [x.iid, x.id, x.params, x.tf]));
    const indChanged = indKey !== this.indKey;
    this.indKey = indKey;
    if (force || indChanged) this.indFit = true;
    const indStyleKey = JSON.stringify(indShown);
    const indRestyle = indStyleKey !== this.indStyleKey;
    this.indStyleKey = indStyleKey;
    const panesChanged =
      force ||
      indChanged ||
      prev.showVolume !== s.showVolume ||
      prev.showDelta !== s.showDelta ||
      prev.showCvd !== s.showCvd ||
      prev.showVenueCvd !== s.showVenueCvd ||
      prev.showVenueOi !== s.showVenueOi ||
      prev.showStats !== s.showStats;
    if (s.showStats && (force || !prev.showStats)) {
      // Włączona tablica poszerza wąskie świece, żeby jej liczby było widać od razu
      const ts = this.chart.timeScale();
      if (ts.options().barSpacing < STATS_BAR_SPACING) {
        ts.applyOptions({ barSpacing: STATS_BAR_SPACING });
        this.toNow = true;
      }
    }
    if (panesChanged) this.rebuildPanes();
    else if (indRestyle) {
      this.indShown = indShown;
      indShown.forEach((x, k) => {
        const def = indicatorDef(x.id);
        this.indSeries[k].forEach((sr, p) => {
          sr.applyOptions(this.indStyle(x, def.plots[p], this.indGap[k][p]));
          // Kolor słupków jest w punktach — krycie zmienia się z nimi
          if (def.plots[p].hist) this.pushPlot(k, p, 0);
        });
        this.indClouds[k]?.setStyle(x.alpha, def.band && x.color);
      });
    }
    if (!panesChanged && prev.cvdReset !== s.cvdReset) {
      this.cvdData = [];
      this.venueCvdData = {};
      this.venueOiData = {};
      this.pushCvd(true);
      this.pushVenues(true);
    }
    this.emitHover();
  }

  /** Telefon (wąski ekran) albo szerszy: przebudowa paneli i miejsca przy prawej krawędzi. */
  setPhone(on: boolean): void {
    if (on === this.phone) return;
    this.phone = on;
    this.liquidity.setDom(!on);
    this.overlay.setCompact(on);
    this.applyDomInset();
    this.rebuildPanes();
  }

  /** Z mapą ciepła przy prawej krawędzi stoi drabina DOM (nie na telefonie): najnowsza świeca i wskaźniki kończą się przed nią. */
  private applyDomInset(): void {
    const px = this.domShown() ? DOM_W_PX : 0;
    this.overlay.setRightInset(px);
    this.zones.setRightInset(px);
    this.tpo.setRightInset(px);
    this.chart.timeScale().applyOptions({ rightOffsetPixels: this.rightGap() });
  }

  private domShown(): boolean {
    return this.settings.showHeatmap && !this.phone;
  }

  private rebuildPanes(): void {
    const s = this.settings;
    const venueSeries = [...Object.values(this.venueCvd ?? {}), ...Object.values(this.venueOi ?? {})];
    for (const sr of [this.volume, this.delta, this.cvd, this.statsSeries, ...venueSeries, ...this.indSeries.flat()]) if (sr) this.chart.removeSeries(sr);
    this.volume = this.delta = this.cvd = this.statsSeries = null;
    this.venueCvd = this.venueOi = null;
    let pane = 1;
    // Wolumen we własnym panelu — nie zasłania komórek footprintu; na telefonie na dole wykresu ceny (więcej miejsca na cenę)
    if (s.showVolume && this.phone) {
      this.volume = this.chart.addSeries(HistogramSeries, { priceFormat: VOLUME_FORMAT, priceLineVisible: false, lastValueVisible: false, priceScaleId: 'vol' }, 0);
      this.volume.priceScale().applyOptions({ scaleMargins: { top: 1 - PHONE_VOLUME_H, bottom: 0 } });
    } else if (s.showVolume) {
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
    // Wskaźniki: na wykresie ceny albo każdy we własnym panelu pod panelami przepływu (nad Tablicą liczb)
    const shown = s.indicators.filter((x) => x.visible);
    this.engine.setInstances(shown);
    this.indShown = shown;
    this.indLegends = [];
    this.indClouds = [];
    this.indSeries = shown.map((x, k) => {
      const def = indicatorDef(x.id);
      const own = def.pane === 'own';
      const lines = this.addIndicatorLines(def, x, own ? pane++ : 0);
      const legend = own ? new PaneLegend(`ind:${x.iid}`, `ind:${x.iid}`) : null;
      if (legend) lines[0].attachPrimitive(legend);
      this.indLegends.push(legend);
      // Pasmo przedziału w kolorze wskaźnika, przy jego linii (granice są ukryte)
      const cloud = def.cloud || def.band ? new CloudFill(() => this.cloudOf(k), x.alpha, def.band && x.color) : null;
      if (cloud) lines[def.cloud?.[0] ?? 0].attachPrimitive(cloud);
      this.indClouds.push(cloud);
      return lines;
    });
    this.indGap = this.indSeries.map((lines) => lines.map(() => false));
    this.indPushed = 0;
    // Nowy wskaźnik z oknem świec z taśmą może potrzebować starszej historii taśmy
    this.onRange(this.chart.timeScale().getVisibleLogicalRange());
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
    const own = this.indLegends.filter((lg) => lg !== null);
    const paneLegends = [
      s.showVolume && !this.phone ? this.volumeLegend : null,
      s.showDelta ? this.deltaLegend : null,
      s.showCvd ? this.cvdLegend : null,
      s.showVenueCvd ? this.venueCvdLegend : null,
      s.showVenueOi ? this.venueOiLegend : null,
      ...own,
    ].filter((lg) => lg !== null);
    const lowest = s.showStats ? null : (paneLegends[paneLegends.length - 1] ?? null);
    for (const lg of [this.volumeLegend, this.deltaLegend, this.cvdLegend, this.venueCvdLegend, this.venueOiLegend, ...own]) lg.setBottom(lg === lowest);
    const panes = this.chart.panes();
    panes[0]?.setStretchFactor(1);
    const statsPane = this.statsSeries?.getPane();
    const venuePanes = new Set([this.venueCvd?.hl?.getPane(), this.venueOi?.hl?.getPane()]);
    // Panele giełd mają opis w dwóch wierszach (na telefonie także), więc są wyższe niż CVD
    for (let i = 1; i < panes.length; i++)
      if (panes[i] !== statsPane) panes[i].setStretchFactor(panes[i] === this.volume?.getPane() ? 0.14 : venuePanes.has(panes[i]) ? 0.3 : 0.22);
    // Tabela ma stałą wysokość wiersza: wysokość panelu ustawiamy po ułożeniu pozostałych
    // (panele mogły zostać przebudowane przed następną klatką — wtedy ten panel już nie istnieje)
    this.fitStatsPane();
    this.setTopInset(this.topInset);
    // Nowe serie dostają pełne dane przy następnej synchronizacji
    this.bars = [];
    this.cvdData = [];
    this.venueCvdData = {};
    this.venueOiData = {};
    this.schedule();
  }

  /**
   * Wysokość panelu Tablicy liczb dla włączonych grup — po ułożeniu pozostałych paneli. Bez setHeight biblioteki: ta
   * odejmuje różnicę po równo od wszystkich paneli i zabiera miejsce cenie. Proporcje jako wysokości w px: tabela dostaje
   * swoją wysokość, pozostałe panele dzielą resztę w proporcjach z rebuildPanes.
   */
  private fitStatsPane(): void {
    // Panele mogły zostać przebudowane przed następną klatką — wtedy ten panel już nie istnieje
    const stats = this.statsSeries;
    if (!stats) return;
    requestAnimationFrame(() => {
      if (this.statsSeries !== stats) return;
      const panes = this.chart.panes();
      const table = stats.getPane();
      const rest = panes.filter((p) => p !== table);
      const total = panes.reduce((h, p) => h + p.getHeight(), 0);
      const sum = rest.reduce((f, p) => f + p.getStretchFactor(), 0);
      if (!(total > 0) || !(sum > 0)) return;
      const h = Math.min(tableHeight(this.settings.statGroups), total / 2);
      for (const p of rest) p.setStretchFactor(((total - h) * p.getStretchFactor()) / sum);
      table.setStretchFactor(h);
    });
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

  /**
   * Serie wskaźnika (po jednej na plot: linia albo słupki) w panelu `pane`; poziomy jako przerywane linie bez podpisów,
   * stały zakres skali. Wskaźnik z wyższego interwału stoi przez całą jego świecę, więc rysujemy go schodkami.
   */
  private addIndicatorLines(def: IndicatorDef, x: IndicatorInstance, pane: number): IndSeries[] {
    const range = def.range;
    const common = {
      priceLineVisible: false,
      priceFormat: { type: 'custom' as const, minMove: 0.0001, formatter: this.indFormat(def.format) },
      ...(range ? { autoscaleInfoProvider: () => ({ priceRange: { minValue: range[0], maxValue: range[1] } }) } : {}),
      ...(def.fromZero
        ? {
            autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
              const r = base();
              return r?.priceRange ? { ...r, priceRange: { minValue: Math.min(0, r.priceRange.minValue), maxValue: r.priceRange.maxValue } } : r;
            },
          }
        : {}),
    };
    const lines = def.plots.map(
      (p): IndSeries =>
        p.hist
          ? this.chart.addSeries(HistogramSeries, { ...common, ...this.indStyle(x, p) }, pane)
          : this.chart.addSeries(
              LineSeries,
              {
                ...common,
                ...this.indStyle(x, p),
                title: p.title ?? '',
                lineStyle: p.dashed ? LineStyle.Dashed : LineStyle.Solid,
                lineType: x.tf ? LineType.WithSteps : LineType.Simple,
                crosshairMarkerRadius: 3,
              },
              pane
            )
    );
    for (const price of def.levels ?? []) lines[0].createPriceLine({ price, color: LEVEL_COLOR, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
    if (def.log) lines[0].priceScale().applyOptions({ mode: PriceScaleMode.Logarithmic });
    return lines;
  }

  /**
   * Styl plotu instancji: kolor (instancji albo stały plotu) z kryciem, grubość i wartość na osi ceny (bez niej, gdy
   * ostatnia świeca nie ma wartości — `gap`); słupki mają kolor w punktach.
   */
  private indStyle(x: IndicatorInstance, p: PlotDef, gap = false): Partial<LineSeriesOptions> {
    // Plot tylko do legendy (delta przy zmianie OI): seria ukryta, poza skalą panelu
    if (p.hidden) return { visible: false };
    const lastValueVisible = x.labels && !gap;
    if (p.hist) return { lastValueVisible };
    const color = rgba(p.color ?? x.color, x.alpha);
    // Kropki (Parabolic SAR): sama linia niewidoczna, promień kropki rośnie z grubością
    if (p.dots) return { color, lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: x.width, lastValueVisible };
    return { color, lineWidth: x.width as LineWidth, lastValueVisible };
  }

  /** Kolor wartości plotu w legendzie: słupki w kolorze znaku (`sign` — wartość własna albo plotu `signOf`). */
  private plotColor(x: IndicatorInstance, p: PlotDef, sign: number): string {
    return p.hist ? (sign < 0 ? HIST_DOWN : HIST_UP) : (p.color ?? x.color);
  }

  /** Liczby wskaźnika: cena (tick rynku), odległość ceny (ATR: o miejsce dokładniej niż tick), dwa lub trzy miejsca (RSI, CMF) albo wolumen (OBV). */
  private indFormat(format: IndicatorDef['format']): (v: number) => string {
    if (format === 'price') return fmtPx;
    if (format === 'fixed1') return (v) => fmtPrice(v, 1);
    if (format === 'fixed2') return (v) => fmtPrice(v, 2);
    if (format === 'fixed3') return (v) => fmtPrice(v, 3);
    if (format === 'count') return (v) => fmtPrice(v, 0);
    if (format === 'volume') return fmtSignedVol;
    if (format === 'usd') return (v) => fmtCompact(v, '$');
    return (v) => fmtPrice(v, Math.max(0, -Math.floor(Math.log10(this.priceTick))) + 1);
  }

  /** Połączenia Binance i Bybit tylko z włączonym panelem giełd albo grupą giełdy w Tablicy liczb, dla bieżącego interwału. */
  private syncVenueLive(): void {
    const s = this.settings;
    const statsVenue = s.showStats && s.statGroups.some((g) => VENUE_GROUPS.includes(g));
    const want = s.showVenueCvd || s.showVenueOi || statsVenue ? this.series.interval.id : null;
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
      // Wolumen na dole wykresu ceny (telefon): świece kończą się nad nim
      const bottom = this.phone && this.settings.showVolume ? PHONE_VOLUME_H + 0.02 : TOP_MARGIN;
      this.main.priceScale().applyOptions({ scaleMargins: { top, bottom } });
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
    return RIGHT_GAP_PX + (this.domShown() ? DOM_W_PX : 0) + this.coneGap();
  }

  /** Miejsce na część stożka za ostatnią świecą przy bieżącym odstępie świec, najwyżej trzecia część szerokości wykresu. */
  private coneGap(): number {
    const f = this.coneShown() ? this.coneDrawn() : null;
    const last = this.bars[this.bars.length - 1];
    const h = f?.horizons[f.horizons.length - 1]?.h;
    if (!f || !last || h === undefined) return 0;
    const ts = this.chart.timeScale();
    const ahead = (f.t + h * 60_000 - last.t) / this.series.interval.ms;
    return Math.max(0, Math.min(ts.width() / 3, ahead * ts.options().barSpacing));
  }

  /** Podsumowanie dziennika prognoz Desku (null — brak albo powtórka): stożek i jego opis w legendzie. */
  setLedger(s: DeskLedgerSummary | null): void {
    this.ledger = s;
    this.cone.update();
    if (this.coneShown()) this.applyDomInset();
    this.emitHover();
  }

  /** Rynki wynikowe HIP-4 z prawdopodobieństwami modelu (null — niepobierane): poziomy i ich opis w legendzie. */
  setOutcomes(o: Hip4State | null): void {
    this.outcomes = o;
    this.hip4.update();
    this.emitHover();
  }

  /** Notowania HIP-4 z ostatnich minut (pobierane co minutę; starsze po błędach zapytań nie udają bieżących). */
  private hip4Fresh(): Hip4State | null {
    const o = this.outcomes;
    return o && o.status === 'ready' && o.asOf !== null && Date.now() - o.asOf <= HIP4_MAX_AGE_MS ? o : null;
  }

  private hip4Source(): Hip4Source | null {
    const x = this.indShown.find((y) => indicatorDef(y.id).outcomes);
    const o = this.hip4Fresh();
    const last = this.bars[this.bars.length - 1];
    if (!x || !o || this.store.coin !== 'BTC' || !last) return null;
    // Telefon: tylko poziom najbliższy ceny
    return { levels: outcomeLevels(o.rows, this.store.serverNow(), last.candle.c, this.phone), color: x.color, alpha: x.alpha, width: x.width };
  }

  /** Opis rynków HIP-4 w legendzie: ile płynnych i wynik Briera rynku i modelu z dziennika (rynki 15-minutowe). */
  private hip4Legend(): { text: string; color: string }[] {
    const o = this.outcomes;
    if (this.store.coin !== 'BTC') return [{ text: tr('tylko BTC', 'BTC only'), color: PRO.ink3 }];
    if (this.store.replay) return [{ text: tr('w powtórce bez rynków', 'no markets in replay'), color: PRO.ink3 }];
    if (!o || o.status === 'loading') return [{ text: tr('pobieram rynki…', 'loading markets…'), color: PRO.ink3 }];
    if (!this.hip4Fresh()) return [{ text: tr('rynki chwilowo niedostępne', 'markets temporarily unavailable'), color: PRO.ink3 }];
    const liquid = o.rows.filter((r) => r.quote?.liquid).length;
    const parts = [{ text: tr(`płynne ${liquid} z ${o.rows.length}`, `liquid ${liquid} of ${o.rows.length}`), color: PRO.ink2 }];
    const sc = this.ledger?.market?.scores;
    if (!this.phone && sc && sc.brierMarket !== null && sc.brierModel !== null) {
      const b = (v: number) => numLang(v.toFixed(3));
      parts.push({ text: `Brier 15 min (n ${sc.n}): ${tr('rynek', 'market')} ${b(sc.brierMarket)} · model ${b(sc.brierModel)}`, color: PRO.ink2 });
    }
    return parts;
  }

  private coneShown(): boolean {
    return this.indShown.some((x) => indicatorDef(x.id).forecast);
  }

  /**
   * Najnowsza prognoza dziennika dla stożka: rynek wykresu, horyzonty z tej samej chwili, nie starsza niż 3 h i nie
   * z przyszłości względem czasu wykresu (powtórka).
   */
  private coneForecast(): ConeForecast | null {
    const s = this.ledger;
    if (!s || s.coin !== this.store.coin || s.latest.ret.length === 0) return null;
    const t = Math.max(...s.latest.ret.map((r) => r.t));
    const now = this.store.serverNow();
    if (t > now || now - t > CONE_MAX_AGE_MS) return null;
    const rets = s.latest.ret.filter((r) => r.t === t).sort((a, b) => a.h - b.h);
    return { t, px0: rets[0].px0, horizons: rets.map((r) => ({ h: r.h, taus: r.taus, q: r.q })) };
  }

  /** Rysowana część prognozy: na telefonie tylko pierwszy horyzont (1 h), cały stożek nie mieści się w wąskim wykresie. */
  private coneDrawn(): ConeForecast | null {
    const f = this.coneForecast();
    return f && this.phone ? { ...f, horizons: f.horizons.slice(0, 1) } : f;
  }

  /** Pokrycie przedziałów prognoz 1 h z 30 dni (null — za mało rozstrzygnięć). */
  private coneScores(f: ConeForecast) {
    const sc = this.ledger?.scores.ret[String(f.horizons[0].h)];
    return sc && sc.n >= CONE_MIN_N && sc.cov90 && sc.cov60 ? { cov90: sc.cov90, cov60: sc.cov60 } : null;
  }

  private coneSource(): ConeSource | null {
    const x = this.indShown.find((y) => indicatorDef(y.id).forecast);
    const f = x ? this.coneDrawn() : null;
    if (!x || !f || this.bars.length === 0) return null;
    // Szanse dotknięcia z tej samej chwili; poziom już przekroczony przy wydaniu nie ma szansy (null)
    const touch = this.ledger?.latest.touch;
    const levels =
      touch && touch.t === f.t
        ? CONE_LEVELS.flatMap(([k, label]) => {
            const p = touch.p[k];
            return p === null ? [] : [{ px: touch.lv[k], text: `${label} ${numLang(String(Math.round(p * 100)))}%` }];
          })
        : [];
    // Telefon: legenda w jednym wierszu się nie mieści, więc pokrycie przy kresce 1 h
    const sc = this.coneScores(f);
    const tickLabels = f.horizons.map((hz, k) =>
      this.phone && k === 0 && sc ? `${horizonLabel(hz.h)} · ${tr('pokrycie', 'coverage')} ${pctLabel(sc.cov60.rate)} / 60%` : horizonLabel(hz.h)
    );
    return {
      forecast: f,
      tickLabels,
      touch: levels.length > 0 ? { t: f.t, h: CONE_TOUCH_MIN, levels } : null,
      logical: (t) => this.logicalOf(t),
      color: x.color,
      alpha: x.alpha,
      width: x.width,
      compact: this.phone,
    };
  }

  /** Pozycja chwili na osi czasu: indeks świecy, w której leży, z ułamkiem interwału; za ostatnią świecą co interwał. */
  private logicalOf(t: number): number | null {
    const bars = this.bars;
    const n = bars.length;
    const ms = this.series.interval.ms;
    if (n === 0 || t < bars[0].t) return null;
    if (t >= bars[n - 1].t) return n - 1 + (t - bars[n - 1].t) / ms;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (bars[m].t <= t) lo = m;
      else hi = m - 1;
    }
    return lo + Math.min(1, (t - bars[lo].t) / ms);
  }

  /** Opis stożka w legendzie: początek horyzontu, przedziały na horyzontach dziennika i pokrycie 1 h z 30 dni (telefon: 60%). */
  private coneLegend(color: string): { text: string; color: string }[] {
    const f = this.coneDrawn();
    if (!f)
      return [{ text: this.store.coin === 'BTC' ? tr('brak prognozy z ostatnich 3 h', 'no forecast from the last 3 h') : tr('tylko BTC', 'BTC only'), color: PRO.ink3 }];
    const [lo, hi, level] = this.phone ? [0.2, 0.8, '60%'] : [0.05, 0.95, '90%'];
    const px = (hz: ConeForecast['horizons'][number], tau: number) => fmtPx(f.px0 * Math.exp(hz.q[hz.taus.indexOf(tau)]));
    const parts: { text: string; color: string }[] = [{ text: `${tr('od', 'from')} ${fmtHm(f.t)}`, color: PRO.ink3 }];
    // Kropka między horyzontami: spacja tysięcy nie skleja ceny z następnym „4 h”
    f.horizons.forEach((hz, k) => parts.push({ text: `${k ? '· ' : ''}${horizonLabel(hz.h)} ${level} ${px(hz, lo)}–${px(hz, hi)}`, color }));
    const sc = this.coneScores(f);
    if (!sc) parts.push({ text: tr('pokrycie: za mało rozstrzygnięć', 'coverage: too few settlements'), color: PRO.ink3 });
    else if (this.phone) parts.push({ text: `${tr('pokrycie', 'coverage')} ${pctLabel(sc.cov60.rate)} / 60%`, color: PRO.ink2 });
    else {
      const kupiec = sc.cov90.kupiecP === null ? '' : ` · ${tr('test Kupca', 'Kupiec test')} p ${numLang(sc.cov90.kupiecP.toFixed(2))}`;
      parts.push({ text: `${tr('pokrycie 1 h z 30 dni', '1 h coverage over 30 days')} 90%: ${pctLabel(sc.cov90.rate)} · 60%: ${pctLabel(sc.cov60.rate)}${kupiec}`, color: PRO.ink2 });
    }
    return parts;
  }

  /** Środek widoku (ms) albo null, gdy widać bieżącą świecę lub nie ma jeszcze świec. */
  viewTime(): number | null {
    const r = this.chart.timeScale().getVisibleLogicalRange();
    const n = this.bars.length;
    if (!r || n === 0 || r.to >= n - 1) return null;
    const i = Math.max(0, Math.min(n - 1, Math.round((r.from + r.to) / 2)));
    return this.bars[i].t + this.series.interval.ms / 2;
  }

  /**
   * Widok na chwili `t` z poprzedniej karty (to samo zbliżenie, krzyż na świecy tej chwili). Chwila sprzed pierwszej
   * świecy: doczytanie starszej historii (najwyżej kilka stron), potem najstarsza dostępna świeca.
   */
  private focus(t: number): void {
    const bars = this.bars;
    if (t < bars[0].t && !this.series.historyExhausted && this.focusPages < CARRY_PAGES) {
      if (!this.series.loadingOlder) {
        this.focusPages++;
        void this.series.loadOlder();
      }
      return;
    }
    this.focusT = null;
    const ms = this.series.interval.ms;
    let i = indexOfTime(bars, Math.floor(t / ms) * ms);
    if (i < 0) i = t < bars[0].t ? 0 : bars.length - 1;
    const ts = this.chart.timeScale();
    const r = ts.getVisibleLogicalRange();
    const half = r ? (r.to - r.from) / 2 : 40;
    ts.setVisibleLogicalRange({ from: i - half, to: i + half });
    // Krzyż po przewinięciu (biblioteka stosuje nowy zakres przy najbliższym rysowaniu, a krzyż trzyma piksel)
    const bar = bars[i];
    requestAnimationFrame(() => {
      if (crossPeers.has(this)) this.chart.setCrosshairPosition(bar.candle.c, sec(bar.t), this.main);
    });
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

  /** Poziomy alarmów rynku: przerywana linia z opisem warunku i etykietą na osi; ciągła, gdy warunek jest w toku (powrót, seria). */
  setAlerts(lines: readonly { price: number; title: string; armed: boolean }[]): void {
    for (const l of this.alertLines) this.main.removePriceLine(l);
    this.alertLines = lines.map(({ price, title, armed }) =>
      this.main.createPriceLine({ price, color: PRO.warn, lineWidth: 1, lineStyle: armed ? LineStyle.Solid : LineStyle.Dashed, axisLabelVisible: true, title })
    );
  }

  /** Strefa ceny z linku powtórki: dwie przerywane linie z etykietą na osi. */
  setZone(zone: readonly [number, number] | null): void {
    for (const l of this.zoneLines) this.main.removePriceLine(l);
    this.zoneLines = (zone ?? []).map((price) =>
      this.main.createPriceLine({ price, color: PRO.zone, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: tr('Strefa', 'Zone') })
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
        if (this.focusT === null) this.scrollToNow();
      }
      if (this.focusT !== null && next.length > 0) this.focus(this.focusT);
    } else {
      const deltaReset = flipsEmpty(changed, prev.length, (i) => !prev[i].fp, (i) => !next[i].fp);
      for (const i of changed) {
        const historical = i < prev.length - 1;
        const b = next[i];
        this.main.update(toPoint(b), historical);
        this.volume?.update(toVolume(b), historical);
        if (!deltaReset) this.delta?.update(toDelta(b), historical);
        if (!historical) this.statsSeries?.update({ time: sec(b.t) });
      }
      if (deltaReset) this.delta?.setData(next.map(toDelta));
    }
    const ms = this.series.interval.ms;
    this.overlay.setBars(next, ms, this.store.vwapCandles(this.series.interval));
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
    // Historia giełd od pierwszej świecy (panele giełd i Tablica liczb)
    if (this.venue && next.length > 0) this.venue.ensure(this.series.interval, next[0].t);
    if (this.statsSeries && (full || now - this.statsAt >= STATS_EVERY_MS || next.length !== this.stats.length)) {
      this.statsAt = now;
      const predicted = st.ctx ? st.ctx.funding : null;
      const reads = this.venue && this.settings.statGroups.some((g) => VENUE_GROUPS.includes(g)) ? this.venue.reads(this.series.interval, now) : null;
      const players = this.settings.statGroups.includes('who') ? (t: number) => st.players.split(t, ms, now) : null;
      this.stats = next.map((b) => barStat(b, ms, now, st.oi, st.funding, predicted, reads, players));
      this.statsTable.setStats(this.stats);
    }
    this.pushCvd(full);
    this.pushVenues(full);
    this.pushIndicators();
    this.emitHover();
    this.emitScale();
    this.tickCountdown();
  }

  /** Wskaźniki: przeliczenie od pierwszej zmienionej świecy i wysłanie tylko jej punktów (zwykle bieżącej świecy). */
  private pushIndicators(): void {
    // Świece interwału wskaźnika sięgają do pierwszej świecy wykresu (bez świec wykresu — bez doczytywania)
    const first = this.bars[0]?.t ?? Number.POSITIVE_INFINITY;
    const n = this.bars.length;
    const ms = this.series.interval.ms;
    // Wskaźniki z taśmy, OI i arkusza: odczyt OI jak w panelu ΔOI (starszy niż kilka minut to przerwa w danych)
    const flow = {
      oiAt: (t: number) => this.store.oi.atWithin(t, HL_OI_MAX_AGE),
      book: () => this.store.book('near')?.list() ?? [],
      exactBook: () => this.store.exactBook()?.list() ?? [],
      orders: (from: number, to: number) => this.store.orders.range(from, to),
      orderCount: (from: number, to: number) => this.store.orders.count(from, to),
      identified: (from: number, to: number) => this.store.addressed.covers(from, to),
      zeroKnown: (from: number, to: number) => this.store.zeroKnown.covers(from, to),
      makers: (from: number, to: number) => this.store.makerSplit(from, to),
      now: this.store.serverNow(),
      later: () => this.schedule(),
    };
    if (this.engine.sync(this.bars, ms, (tf) => this.store.indicatorCandles(tf, first), flow) >= n) return;
    // Luka w świecach albo doczytana historia przesuwa czasy punktów za ostatnią świecą: te ploty idą w całości
    const anchor = this.bars[n - 1].t - (n - 1) * ms;
    const moved = anchor !== this.indAnchor;
    this.indAnchor = anchor;
    this.engine.runs.forEach((run, k) => {
      if (run.from >= n) return;
      // Zmiana przed ostatnią wysłaną świecą (wartości z innego interwału, kanał regresji): pełna podmiana, bo aktualizacja wstecz psuje puste punkty
      const start = run.from < this.indPushed - 1 ? 0 : run.from;
      const { plots } = indicatorDef(this.indShown[k].id);
      run.out.forEach((_, p) => this.pushPlot(k, p, moved && plotShift(this.indShown[k], plots[p]) > 0 ? 0 : start));
    });
    this.indPushed = n;
    if (this.indFit) {
      this.indFit = false;
      this.fitAhead();
    }
  }

  /** Chmura w przód (Ichimoku) zajmuje najwyżej trzecią część szerokości wykresu: na wąskim ekranie świece się zwężają. */
  private fitAhead(): void {
    // Stożek: miejsce na część za ostatnią świecą i przewinięcie do niej
    if (this.coneShown()) {
      this.applyDomInset();
      this.scrollToNow();
    }
    const ahead = Math.max(0, ...this.indShown.flatMap((x) => indicatorDef(x.id).plots.map((p) => plotShift(x, p))));
    const ts = this.chart.timeScale();
    const fit = ts.width() / (3 * ahead);
    if (ahead === 0 || !(fit > 0) || ts.options().barSpacing <= fit) return;
    ts.applyOptions({ barSpacing: fit });
    this.scrollToNow();
  }

  /**
   * Punkty plotu `p` instancji `k` od świecy `from` (słupki w kolorze znaku z kryciem instancji). Poziom okresu (pivot)
   * kończy się na ostatniej świecy okresu: odcinek do innej wartości następnej świecy jest przezroczysty. Linia przerywa się
   * na świecach bez wartości (biblioteka łączyłaby punkty po obu stronach przerwy): odcinek przed przerwą jest przezroczysty.
   */
  private pushPlot(k: number, p: number, from: number): void {
    const bars = this.bars;
    const n = Math.min(bars.length, this.engine.count);
    const x = this.indShown[k];
    const plot = indicatorDef(x.id).plots[p];
    const { hist, breaks } = plot;
    const ys = this.engine.runs[k].out[p];
    // Kolor słupka ze znaku wartości albo innego plotu (zmiana OI w kolorze delty)
    const signs = plot.signOf === undefined ? ys : this.engine.runs[k].out[plot.signOf];
    const series = this.indSeries[k][p] as ISeriesApi<'Line'>;
    // Przesunięcie (Ichimoku): wartość świecy i w miejscu świecy i + shift, za ostatnią świecą co interwał wykresu
    const shift = plotShift(x, plot);
    const ms = this.series.interval.ms;
    const point = (i: number) => {
      const j = i + shift;
      const time = sec(j < n ? bars[j].t : bars[n - 1].t + (j - n + 1) * ms);
      const v = ys[i];
      if (Number.isNaN(v)) return { time };
      if (hist) return { time, value: v, color: rgba(signs[i] < 0 ? HIST_DOWN : HIST_UP, 0.6 * x.alpha) };
      const cut = i + 1 < n && (Number.isNaN(ys[i + 1]) || (breaks && ys[i + 1] !== v));
      return cut ? { time, value: v, color: CLEAR } : { time, value: v };
    };
    // Ostatnia świeca zyskała albo straciła wartość: kolor odcinka przed nią się zmienia, więc pełna podmiana
    const gap = n > 0 && Number.isNaN(ys[n - 1]);
    const recolor = !hist && gap !== this.indGap[k][p];
    // Bez zmiany wcześniejszych punktów (przeliczenie od zera to pełna podmiana), więc bez aktualizacji wstecz.
    // Pełna podmiana bez pustych punktów przed pierwszą wartością (kanał regresji ma ich tysiące)
    if (from === 0 || n - from > MAX_POINT_UPDATES || recolor) {
      let s = Math.max(0, -shift);
      while (s < n && Number.isNaN(ys[s])) s++;
      series.setData(Array.from({ length: Math.max(0, n - s) }, (_, k) => point(s + k)));
    }
    else for (let i = Math.max(from, -shift); i < n; i++) series.update(point(i));
    if (gap !== this.indGap[k][p]) {
      this.indGap[k][p] = gap;
      // Bez wartości ostatniej świecy także bez podpisu plotu (sam podpis przy osi niczego nie mówi)
      series.applyOptions({ lastValueVisible: x.labels && !gap, ...(plot.title ? { title: gap ? '' : plot.title } : {}) });
    }
  }

  /** Granice chmury instancji `k` z bieżących wartości silnika. */
  private cloudOf(k: number): CloudSource | null {
    const x = this.indShown[k];
    const run = this.engine.runs[k];
    const cloud = x && (indicatorDef(x.id).cloud ?? indicatorDef(x.id).band);
    if (!cloud || !run) return null;
    const [a, b] = cloud;
    return { a: run.out[a], b: run.out[b], n: Math.min(this.bars.length, this.engine.count), shift: plotShift(x, indicatorDef(x.id).plots[a]) };
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
    if (changed.length > MAX_POINT_UPDATES || flipsEmpty(changed, prev.length, (i) => prev[i] === null, (i) => next[i] === null)) {
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
      const age = oiMaxAge(iv.id);
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
    if (changed.length > MAX_POINT_UPDATES || flipsEmpty(changed, prev.length, (i) => prev[i] === null, (i) => next[i] === null)) {
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
    // Historia taśmy i arkusza z serwera od lewej krawędzi widoku, a przy wskaźniku z oknem poprzednich świec (absorpcja,
    // OFI) o to okno wcześniej — inaczej na wąskim ekranie świece z lewej nie miałyby wartości
    const left = this.bars[Math.min(this.bars.length - 1, Math.max(0, Math.floor(range.from)))].t;
    const span = Math.max(0, ...this.indShown.map((x) => indicatorDef(x.id).lookback?.(x.params) ?? 0));
    requestHistory(this.store, left - span * this.series.interval.ms);
  };

  /** Kliknięcie: opis wskaźnika (jego ustawienia), krzyżyk ukrycia panelu, obiekt warstwy płynności pod kursorem albo nic (zamyka kartę). */
  private readonly onClick = (p: MouseEventParams<Time>): void => {
    const hit = p.hoveredObjectId;
    if (typeof hit === 'string' && hit.startsWith('edit:ind:')) {
      this.onEditIndicator?.(hit.slice(9));
      return;
    }
    if (typeof hit === 'string' && hit.startsWith('pane:')) {
      const key = hit.slice(5);
      if ((PANE_KEYS as readonly string[]).includes(key) || key.startsWith('ind:')) this.onHidePane(key as HideKey);
      return;
    }
    const pick = p.point && p.paneIndex === 0 ? this.liquidity.pick(p.point.x, p.point.y) : null;
    // Telefon: dotknięcie przy linii wieloryba pokazuje albo chowa jej podpis
    if (!pick && p.point && p.paneIndex === 0) this.overlay.pickWhale(p.point.y);
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
      this.onHover({ bar: null, live: true, open: false, row: null, cvd: null, ind: null, indicators: [] });
      return;
    }
    const i = this.hoverTime === null ? bars.length - 1 : indexOfTime(bars, this.hoverTime);
    const bar = i >= 0 ? bars[i] : null;
    const cvd = i >= 0 ? (this.cvdData[i] ?? null) : null;
    this.volumeLegend.set(
      bar ? [{ text: tr('Wolumen', 'Volume'), color: PRO.ink3 }, { text: fmtVol(bar.candle.v), color: PRO.ink1 }] : [{ text: tr('Wolumen', 'Volume'), color: PRO.ink3 }]
    );
    this.deltaLegend.set(flowLegend('Delta', bar?.fp ? bar.fp.delta : null));
    this.cvdLegend.set(flowLegend(`CVD · ${RESET_LABEL[this.settings.cvdReset]}`, cvd ? cvd.close : null));
    // Wąski wykres (telefon): bez okresu (ten sam co w opisie CVD) i bez wiersza finansowania — opis mieści się w dwóch wierszach
    const compact = this.chart.timeScale().width() < COMPACT_LEGEND_PX;
    const period = compact ? '' : ` · ${RESET_LABEL[this.settings.cvdReset]}`;
    if (this.venueCvd) this.venueCvdLegend.set(this.venueLegend(`${tr('CVD giełd', 'Exchange CVD')}${period}`, CVD_LINES, this.venueCvdData, i));
    if (this.venueOi) {
      const lines = this.venueLegend(`${tr('ΔOI giełd', 'Exchange ΔOI')}${period}`, OI_LINES, this.venueOiData, i);
      // Drugi wiersz: bieżące finansowanie giełd przeliczone na 8 h (Hyperliquid rozlicza co godzinę)
      const hlRate = this.store.ctx ? per8h(this.store.ctx.funding, 1) : null;
      const funding: LegendPart[] = [
        { text: '', color: PRO.ink3, br: true },
        { text: tr('Funding 8 h teraz', 'Funding 8 h now'), color: PRO.ink3 },
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
    // Wskaźniki: na wykresie ceny w legendzie wykresu, we własnym panelu w opisie panelu. Za ostatnią świecą (chmura
    // Ichimoku w przód) indeks świecy liczony od ostatniej co interwał wykresu
    const last = bars[bars.length - 1].t;
    const ms = this.series.interval.ms;
    const vi = i < 0 && this.hoverTime !== null && this.hoverTime > last ? bars.length - 1 + Math.round((this.hoverTime - last) / ms) : i;
    const indicators: IndicatorReadout[] = [];
    this.engine.runs.forEach((run, k) => {
      const x = this.indShown[k];
      const def = indicatorDef(x.id);
      const vs = run.out.map((ys, p) => {
        const j = vi - plotShift(x, def.plots[p]);
        return vi >= 0 && j >= 0 && j < this.engine.count ? ys[j] : Number.NaN;
      });
      const values = def.forecast
        ? this.coneLegend(x.color)
        : def.outcomes
          ? this.hip4Legend()
          : vs.flatMap((v, p) => {
              const plot = def.plots[p];
              if (def.band?.includes(p)) return [];
              // Podpis poziomu (pivoty: P, R1, S1…) także w legendzie; przedział w nawiasie za wartością
              const fmt = this.indFormat(plot.format ?? def.format);
              const text = Number.isNaN(v) ? '—' : fmt(v);
              const band = def.band && p === 0 && !Number.isNaN(v) ? ` (${fmt(vs[def.band[0]])}–${fmt(vs[def.band[1]])})` : '';
              return [{ text: plot.title ? `${plot.title} ${text}${band}` : `${text}${band}`, color: this.plotColor(x, plot, vs[plot.signOf ?? p]) }];
            });
      const legend = this.indLegends[k];
      // Pierwsza wartość przy nazwie, dalsze (OFI: Δp, R², oczekiwana) mogą przejść do następnego wiersza na wąskim panelu
      if (legend) legend.set([{ text: indicatorLabel(x), color: PRO.ink3 }, ...values.map((v, p) => ({ ...v, glue: p === 0 }))]);
      else indicators.push({ iid: x.iid, label: indicatorLabel(x), values });
    });
    this.statsTable.setHover(this.hoverTime === null ? -1 : i);
    const open = bar !== null && bar.t + this.series.interval.ms > this.store.serverNow();
    this.onHover({ bar, live: this.hoverTime === null, open, row: bar ? this.rowAt(bar, this.hoverPrice) : null, cvd, ind, indicators });
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
