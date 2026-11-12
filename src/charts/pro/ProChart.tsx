import React, { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Bell, BellOff, BellPlus, Camera, ChevronDown, ChevronsRight, Columns2, Copy, Eye, EyeOff, Frame as FrameIcon, Grid2x2, History, Info, Keyboard, Layers, Link, ListOrdered, Maximize2, Minimize2, Minus, MoreHorizontal, PenTool, RotateCcw, SlidersHorizontal, Square, X } from 'lucide-react';
import { Badge, BadgeTone, LocalBoundary, Segmented, numLang } from '../../ui';
import { BAR_BTN, DropdownSelect, barBtnTone } from '../../ui/Dropdown';
import { scrollFadeRef } from '../../ui/scrollFade';
import { LiqMapState, useLiqMap } from '../../state/useLiqMap';
import { useDeskLedger } from '../../state/useDeskLedger';
import { useDesk } from '../../state/DeskContext';
import { useHip4 } from '../../state/useHip4';
import { useVolModel } from '../../state/useVolModel';
import { usePublished } from '../../state/usePublished';
import { type BlogMapsState, pickMap, useBlogMaps } from '../../state/useBlogMaps';
import { WHALES_STALE_MS, type WhaleLayer, isWhaleLayer } from '../../utils/whaleLayer';
import { DAY, INTERVALS, fmtDayTime, fmtHm, fmtSince, fromDaily, intervalById } from './core/time';
import { DEFAULT_THRESHOLD_USD, classify } from './core/clashes';
import { hlTick } from './core/footprintBar';
import { indicatorScope, liqLevels } from './core/indicators';
import type { AggressorOrder } from './core/orders';
import type { ResetMode } from './core/sessions';
import { tpoInterval } from './core/tpo';
import { VENUE_GROUPS } from './core/stats';
import { type HideKey, type PaneKey, ProChartController, type ScaleState } from './chart/controller';
import { DomLadder, PickCard, TapePanel, compact } from './chart/FlowPanels';
import { HoverSignal, Legend } from './chart/Legend';
import { LOT_FLOOR, type LiquidityPick } from './chart/liquidity';
import { type FrameQuality, IMAGE_FAILED, brandedScreenshot, downloadCanvas, fileStamp } from './chart/screenshot';
import { defaultFrameTitle, mapQuality, tapeQuality } from './chart/frame';
import { FrameDialog, type FrameSource } from './chart/FrameDialog';
import { MAX_ALERTS, type PriceAlert, addAlert, alertBook, alertLines, alertLog, askNotifications, hasLine, lastSeen, lineLabel, markSeen, newAlert, primeAlertSound, removeAlert } from './chart/alerts';
import { type LinkAlarm, linkAlerts, parseAlarmLink } from './chart/alarmLink';
import { AlarmLinkCard, type AlertDraft, AlertsMenu } from './chart/AlertsMenu';
import { onAlertEvents, startAlertWatch } from './chart/alertWatch';
import { DEFAULT_TTL_MS, defaultDir, eventText } from '../../utils/alertRules';
import { fmtPx, priceDigits } from './chart/layout';
import type { PbZone } from './chart/pbRangeLayer';
import { ChartLayout, ChartSettings, NARROW_QUERY, PHONE_PANES, PhonePane, DROPPED_NOTICE_KEY, hashFor, isNarrow, keepPanelSetIids, loadSettings, phoneSettings, saveSettings, settingsFromHash } from './chart/settings';
import { Station, activePanelSet, panelSetPanel, priceLayerCount, stationById, stationKey, stationPanel } from './chart/stations';
import { ChartTemplate, applyTemplate, loadTemplates, saveAs, saveTemplates } from './chart/templates';
import { NumbersCard, StatGroupPicker } from './chart/NumbersCard';
import { IndicatorsDialog, type IndicatorsSection, type ToggleItem } from './chart/IndicatorsDialog';
import { IndicatorSettings } from './chart/IndicatorSettings';
import { indicatorLabel, indicatorsLink } from './indicators/registry';
import { IB_EVIDENCE } from './chart/ibSelect';
import { LEVELS_EVIDENCE } from './chart/levelsSelect';
import { BURSTS_MAX, CLASHES_EVIDENCE, WALLS_DONE_MAX, WALLS_LIVE_MAX, WALL_MIN_MS } from './chart/clashSelect';
import { AUCTIONS_PER_SIDE, ZONES_EVIDENCE, ZONES_PER_SIDE } from './chart/zonesSelect';
import { MarketStateBar } from './chart/MarketStateBar';
import { LayoutHeader } from './chart/LayoutHeader';
import { type ChartKind, FAVOURITE_INTERVALS, INTERVAL_MENU, KIND_OPTIONS, LayersMenu, type MoreEntry, MoreMenu as BarMore, kindOf, kindPatch } from './chart/ChartBar';
import { type LayerChip, layerLabel } from './chart/layerSources';
import type { LayoutNumber } from './chart/layoutNumbers';
import { blogMapScan, legendChips, liqScan, tapeCoveragePct, whalesScan } from './chart/layerSources';
import { blogMapName, levelsInsteadOfMap, levelsLegend } from './chart/blogMapLayer';
import { CoverageLegend } from './chart/CoverageLegend';
import { type DataSource, needsOf } from './chart/coverageStrip';
import { SchrodiLauncher } from '../../components/schrodi/SchrodiLauncher';
import type { ChartView } from './chart/footprintSeries';
import type { FootprintStyle } from './chart/layout';
import { DrawHint, DrawMenu, DrawStyleBar, DrawToolbar } from './draw/DrawToolbar';
import { DrawSettings } from './draw/DrawSettings';
import { DrawList } from './draw/DrawList';
import { TOOLS } from './draw/model';
import { type DrawingTools, isTyping } from './draw/tools';
import { chartKeyAction } from './chart/shortcuts';
import { FocusExit, type PhoneTab, focusExitKey, focusOn } from './chart/focusMode';
import { CandleSeries, MARKETS, Market, ProStore, storeFor } from './store/proStore';
import { startRecording } from './store/recording';
import { useStoreVersion } from './store/useStoreVersion';
import { ReplayBar } from './replay/ReplayBar';
import { type ReplayLink, linkPatch, parseReplayLink, replayHash } from './replay/link';
import { type ReplaySession, replayBase } from './replay/session';
import { lang, tr } from '../../i18n';

const MARKET_OPTIONS = MARKETS.map((m) => ({ value: m, label: m, title: `${m}-PERP · Hyperliquid` }));
/** Warstwy przepływu zawsze na liście „Warstwy” (wyłączone — do włączenia jednym dotknięciem). */
const QUICK_LAYERS = ['showVwap', 'showHeatmap', 'showBubbles', 'showClashes', 'showLots'] as const;
const FAV_OPTIONS = FAVOURITE_INTERVALS.map((id) => ({ value: id as string, label: intervalById(id).label }));
const INTERVAL_OPTIONS = INTERVALS.map((i) => ({ value: i.id, label: i.label }));
const VIEW_OPTIONS: { value: ChartView; label: string; title: string }[] = [
  { value: 'candles', label: tr('Świece', 'Candles'), title: tr('Same świece (OHLC z API Hyperliquid)', 'Plain candles (OHLC from the Hyperliquid API)') },
  { value: 'footprint', label: 'Footprint', title: tr('Footprint z taśmy: profil w świecy, a po zbliżeniu liczby w każdym wierszu ceny', 'Footprint from the tape: a profile inside the candle and, zoomed in, numbers on every price row') },
];
const STYLE_OPTIONS: { value: FootprintStyle; label: string; title: string }[] = [
  { value: 'bidask', label: 'Bid × Ask', title: tr('Sprzedaż agresywna (uderza w bid) × kupno agresywne (zdejmuje ask) w każdym wierszu', 'Aggressive selling (hits the bid) × aggressive buying (lifts the ask) on every row') },
  { value: 'delta', label: 'Delta', title: tr('Delta wiersza: kupno − sprzedaż agresorów', 'Row delta: aggressor buys − sells') },
  { value: 'volume', label: tr('Wolumen', 'Volume'), title: tr('Łączny wolumen wiersza', 'Total row volume') },
];

/**
 * Zmiana z linku albo przełącznika rynku; wysokość wiersza w USD nie pasuje do rynku o innej cenie — wtedy automatyczna.
 * Wskaźniki z linku zastępują listę tylko wtedy, gdy różnią się od widocznych — odświeżenie strony zachowuje styl i ukryte.
 */
const withPatch = (s: ChartSettings, p: Partial<ChartSettings>): ChartSettings =>
  keepPanelSetIids({
    ...s,
    ...p,
    indicators: p.indicators && indicatorsLink(p.indicators) !== indicatorsLink(s.indicators) ? p.indicators : s.indicators,
    rowStep: p.coin && p.coin !== s.coin ? 0 : s.rowStep,
  });

/** Cena zaokrąglona do ticku rynku. */
const toTick = (p: number) => Number(p.toFixed(priceDigits(p)));

const PANE_NAMES: Record<PaneKey, string> = {
  showVolume: tr('Wolumen', 'Volume'),
  showDelta: 'Delta',
  showCvd: 'CVD',
  showVenueCvd: tr('CVD giełd', 'Exchange CVD'),
  showVenueOi: tr('ΔOI giełd', 'Exchange ΔOI'),
  showStats: tr('Tablica liczb', 'Numbers table'),
};

const LAYOUT_ICONS: Record<ChartLayout, React.ComponentType<{ className?: string }>> = { 1: Square, 2: Columns2, 4: Grid2x2 };
const LAYOUT_OPTIONS: { value: ChartLayout; label: React.ReactNode; title: string }[] = [
  { value: 1, label: <Square className="w-3.5 h-3.5" />, title: tr('Jeden wykres', 'One chart') },
  { value: 2, label: <Columns2 className="w-3.5 h-3.5" />, title: tr('Dwa wykresy obok siebie', 'Two charts side by side') },
  { value: 4, label: <Grid2x2 className="w-3.5 h-3.5" />, title: tr('Cztery wykresy (2 × 2)', 'Four charts (2 × 2)') },
];

/** Panele pod wykresem w wynikach wyszukiwania okna wskaźników i na liście sekcji „Pod wykresem” (komputer). */
const PANE_ITEMS: ToggleItem[] = [
  { key: 'showVolume', label: tr('Wolumen', 'Volume'), hint: tr('Wolumen świec z API Hyperliquid', 'Candle volume from the Hyperliquid API') },
  { key: 'showDelta', label: tr('Delta (świece delty)', 'Delta (delta candles)'), hint: tr('Kupno − sprzedaż agresorów w każdej świecy', 'Aggressor buys − sells in every candle') },
  {
    key: 'showCvd',
    label: 'CVD',
    hint: tr('Skumulowana delta od zerowania (sesja, dzień albo tydzień)', 'Cumulative delta since the reset (session, day or week)'),
    aliases: 'cumulative volume delta skumulowana',
  },
  { key: 'showVenueCvd', label: tr('CVD giełd: Hyperliquid, Binance, Bybit', 'Exchange CVD: Hyperliquid, Binance, Bybit'), hint: tr('Dane Binance i Bybit z Twojej przeglądarki', 'Binance and Bybit data from your browser') },
  {
    key: 'showVenueOi',
    label: tr('ΔOI i funding giełd', 'Exchange ΔOI and funding'),
    hint: tr('Dane Binance i Bybit z Twojej przeglądarki', 'Binance and Bybit data from your browser'),
    aliases: 'open interest otwarte pozycje oi funding finansowanie hyperliquid binance bybit',
  },
  { key: 'showStats', label: tr('Tablica liczb', 'Numbers table'), hint: tr('Liczby każdej świecy w wierszach pod wykresem', 'Numbers of every candle in rows below the chart') },
];

/** Karty na telefonie: jedna naraz, więc wykres ma cały ekran. */
const noticePending = (): boolean => {
  try {
    return localStorage.getItem(DROPPED_NOTICE_KEY) === 'pending';
  } catch {
    return false;
  }
};

const FRAME_LABEL = tr('Klatka: obraz 16:9 albo 1:1 z tytułem i paskiem jakości (PNG)', 'Frame: a 16:9 or 1:1 image with a title and the quality strip (PNG)');

const PHONE_TABS: { id: PhoneTab; label: string }[] = [
  { id: 'chart', label: tr('Wykres', 'Chart') },
  { id: 'tape', label: tr('Taśma', 'Tape') },
  { id: 'dom', label: 'DOM' },
  { id: 'numbers', label: tr('Liczby', 'Numbers') },
];

/**
 * Karty układów na telefonie: lista w pasku wykresu zamiast paska kart nad nim (ostatnia pozycja otwiera zarządzanie
 * kartami), przywrócenie wzorca karty w menu „Więcej” (karta własna nie ma wzorca — bez `onRestore`).
 */
export interface PhoneTabs {
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (id: string) => void;
  onRestore?: () => void;
}

/**
 * Ustawienia w użyciu: telefon — jeden panel pod wykresem, bez tablicy; układ 2 × 2 — bez tablicy (za niski panel);
 * powtórka — bez paneli i grup Binance i Bybit (ich dane są tylko na żywo).
 */
const shownSettings = (s: ChartSettings, narrow: boolean, layout: ChartLayout, replay = false): ChartSettings => {
  const out = narrow ? phoneSettings(s) : layout === 4 && s.showStats ? { ...s, showStats: false } : s;
  return replay ? { ...out, showVenueCvd: false, showVenueOi: false, statGroups: out.statGroups.filter((g) => !VENUE_GROUPS.includes(g)) } : out;
};

/** Powtórka nagrania na wykresie: sesja odtwarzania, jej bieżący magazyn, link, z którego weszliśmy, i powrót na żywo. */
export interface ProChartReplay {
  session: ReplaySession;
  store: ProStore;
  link: ReplayLink;
  onExit: () => void;
}

/** Telefon obrócony poziomo (niski ekran dotykowy): wykres na cały ekran. */
const LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 500px) and (pointer: coarse)';
const isLandscapePhone = () => typeof window !== 'undefined' && window.matchMedia(LANDSCAPE_QUERY).matches;
const subscribeLandscape = (fn: () => void) => {
  const mq = window.matchMedia(LANDSCAPE_QUERY);
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
};

export const subscribeNarrow = (fn: () => void) => {
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
};

function initialSettings(panel: number, station: Station, tabId: string, coin: Market | null, fromLink: boolean): ChartSettings {
  const narrow = isNarrow();
  const pattern = stationPanel(station, panel, narrow);
  // Panel spoza wzorca stacji bez zapisu: wygląd pierwszego panelu, wyższy interwał, bez tablicy i taśmy (mniej miejsca)
  const base =
    panel < station.panels.length
      ? pattern
      : { ...loadSettings(stationKey(tabId, 0), stationPanel(station, 0, narrow)), interval: pattern.interval, showStats: false, showTape: false };
  let s = loadSettings(stationKey(tabId, panel), base);
  // Link do widoku (#charts?m=…&i=…&v=…) ma pierwszeństwo przed zapisanymi ustawieniami pierwszego panelu
  if (panel === 0 && fromLink) s = withPatch(s, settingsFromHash(window.location.hash));
  // Rynek zostaje przy zmianie karty
  return coin ? withPatch(s, { coin }) : s;
}

/**
 * Wykres Pro: Lightweight Charts (TradingView) z footprintem, wolumenem, Deltą i CVD z taśmy Hyperliquid.
 * `panel` — miejsce w układzie kilku wykresów: pierwszy prowadzi link do widoku, alerty i przełącznik układu.
 * `station` — wzorzec karty (układ faz albo ustawienia startowe karty własnej), `tabId` — karta, pod którą zapisują się ustawienia
 * (domyślnie id stacji), `onSaved` — po zapisie ustawień (podpis karty), `coin` — rynek przeniesiony z poprzedniej karty,
 * `fromLink` — pierwsze otwarcie wykresów, więc link do widoku w adresie strony ma pierwszeństwo.
 * `replay` — powtórka nagrania zamiast rynku na żywo: ustawienia nie są zapisywane, adres strony zostaje linkiem powtórki.
 * `layoutFs` — pełny ekran miejsca pracy: pasek kart i wszystkie panele układu (przycisk pełnego ekranu i klawisz F).
 * `layoutHeader` — nad wykresem nagłówek układu: pytanie `station` i trzy liczby z plakietkami (pierwszy panel karty).
 */
export const ProChart: React.FC<{
  panel?: number;
  layout?: ChartLayout;
  onLayout?: (l: ChartLayout) => void;
  station?: Station;
  tabId?: string;
  onSaved?: () => void;
  coin?: Market | null;
  fromLink?: boolean;
  phoneTabs?: PhoneTabs;
  replay?: ProChartReplay;
  layoutFs?: { active: boolean; toggle: () => void };
  layoutHeader?: boolean;
  /** Początek i koniec paska (komputer): lista „Układ ▾” oraz przełączniki miejsca pracy (kolumna DOM, zestaw paneli). */
  barLead?: React.ReactNode;
  barTrail?: React.ReactNode;
  /** Przywrócenie wzorca karty (pozycja menu „⋯”); karta własna nie ma wzorca. */
  onRestore?: () => void;
  /** Telefon: nad tablicą w karcie „Liczby” (pięć liczb przepływu: Arkusz, Taśma, Kto, Ściany, TWAP). */
  phoneNumbersTop?: React.ReactNode;
}> = ({ panel = 0, layout = 1, onLayout, station = stationById('cockpit'), tabId = station.id, onSaved, coin = null, fromLink = true, phoneTabs, replay, layoutFs, layoutHeader = false, barLead, barTrail, onRestore, phoneNumbersTop }) => {
  const [settings, setSettings] = useState<ChartSettings>(() => {
    if (!replay) return initialSettings(panel, station, tabId, coin, fromLink);
    // Link z układem (lekcja, blog) — sam wzorzec układu, bez zmian zapisanych przez oglądającego
    const base = replay.link.station ? stationPanel(station, panel, isNarrow()) : initialSettings(panel, station, tabId, coin, false);
    return withPatch(base, linkPatch(replay.link));
  });
  const inReplay = replay !== undefined;
  const store = replay ? replay.store : storeFor(settings.coin);
  const series = store.series(settings.interval);
  const [menu, setMenu] = useState<'settings' | 'indicators' | 'alerts' | 'keys' | null>(null);
  const [indicatorsSection, setIndicatorsSection] = useState<IndicatorsSection>('hl');
  // Wskaźnik w oknie ustawień (identyfikator instancji)
  const [indEdit, setIndEdit] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow);
  const [tab, setTab] = useState<PhoneTab>('chart');
  // Telefon: tryb skupienia (dotknięcie pustego miejsca wykresu chowa wszystko poza wykresem i dolnym menu, drugie
  // przywraca) i telefon poziomo (sam wykres na cały ekran)
  const [focus, setFocus] = useState(false);
  const landscape = useSyncExternalStore(subscribeLandscape, isLandscapePhone);
  // Wykres na cały ekran poziomo, dopóki użytkownik go nie zamknie (do następnego obrotu)
  const [landscapeOff, setLandscapeOff] = useState(false);
  const chartOnly = narrow && (focus || (landscape && !landscapeOff));
  /** Wejście w skupienie zawsze na karcie „Wykres” (Liczby, DOM i Taśma leżą na polu wykresu, a paska z kartami nie ma). */
  const enterFocus = useCallback(() => {
    setTab((t) => focusOn(t).tab);
    setFocus(true);
  }, []);
  const exitFocus = useCallback(() => {
    setFocus(false);
    if (isLandscapePhone()) setLandscapeOff(true);
  }, []);
  // Źródła trzech liczb układu na telefonie (z menu „⋯”)
  const [numbersOpen, setNumbersOpen] = useState(false);
  const [tools, setTools] = useState<DrawingTools | null>(null);
  // Kliknięty bąbel, seria albo ściana i podświetlony adres biorcy (tylko w pamięci strony)
  const [pick, setPick] = useState<LiquidityPick | null>(null);
  const [highlight, setHighlight] = useState('');
  // Pasek rysowania: na komputerze widoczny od razu, na telefonie po dotknięciu przycisku (więcej miejsca na wykres)
  const [drawOpen, setDrawOpen] = useState(() => window.innerWidth >= 640);
  // Menu pod prawym przyciskiem (punkt w pikselach wykresu i cena w tym punkcie), alerty cenowe, krótki komunikat
  const [ctxMenu, setCtxMenu] = useState<CtxMenuAt | null>(null);
  const alerts = useSyncExternalStore(alertBook.subscribe, alertBook.get);
  const linesShown = useSyncExternalStore(alertLines.subscribe, alertLines.shown);
  const log = useSyncExternalStore(alertLog.subscribe, alertLog.get);
  // Cena z wykresu dla formularza alarmu i chwila ostatniego obejrzenia historii (kropka na dzwonku)
  const [alertDraft, setAlertDraft] = useState<AlertDraft | null>(null);
  const [seen, setSeen] = useState(lastSeen);
  const freshAlert = log.some((e) => e.type === 'fire' && e.at > seen);
  // Zestaw alarmów z linku (czytany przed pierwszym przepisaniem adresu na link do widoku)
  const [linkSet, setLinkSet] = useState<LinkAlarm[] | null>(() => (panel === 0 && !inReplay ? parseAlarmLink(window.location.hash) : null));
  const [toast, setToast] = useState<string | null>(null);
  // Jednorazowa informacja o usuniętych wskaźnikach wolumenu (klucz ustawiany po zamknięciu; tylko panel 1)
  const [droppedNote, setDroppedNote] = useState(() => panel === 0 && !inReplay && noticePending());
  // Zapis innego panelu mógł zostać wczytany po tym panelu; sprawdzane też przy zmianie ustawień
  useEffect(() => {
    if (panel === 0 && !inReplay && noticePending()) setDroppedNote(true);
  }, [panel, inReplay, settings]);
  const ctxRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // Warstwy ukryte okiem z listy „Warstwy” zostają na niej (do przywrócenia), dopóki wykres jest otwarty
  const [hiddenLayers, setHiddenLayers] = useState<ReadonlyMap<string, LayerChip>>(() => new Map());
  const stateId = useId();
  const hostRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<ProChartController | null>(null);
  const [scale, setScale] = useState<ScaleState>({ auto: true, width: 0, height: 0 });
  const legendBottom = useRef(0);
  const signal = useMemo(() => new HoverSignal(), []);
  const liq = useLiqMap();
  const { summary: ledger } = useDeskLedger();
  // Rynki HIP-4 (zapytania do Hyperliquid) i model zmienności Desku (w tym widoku liczony tylko dla nich) tylko z widocznym
  // wskaźnikiem, na BTC i na żywo
  const { feed } = useDesk();
  const hip4On = !inReplay && settings.coin === 'BTC' && settings.indicators.some((x) => x.visible && x.id === 'outcomes');
  const vol = useVolModel(hip4On);
  const hip4 = useHip4(vol.model, feed.currentPrice, hip4On);
  const whalePub = usePublished('whales.json', isWhaleLayer);
  // Wieloryby i mapa likwidacji to stan na teraz — w powtórce ich nie ma
  const whales = !inReplay && whalePub.value && Date.now() - whalePub.value.asOf < WHALES_STALE_MS ? whalePub.value : null;
  // Mapy z bloga (plik bloga z tej samej domeny) tylko z włączoną warstwą na BTC albo dla liczby „Mapa: dotknięte” w nagłówku
  // Rozliczenia; rozliczenie poziomów w układzie Rozliczenie
  const blogSettle = station.id === 'review';
  const blogMaps = useBlogMaps((settings.showBlogMap || (layoutHeader && blogSettle && !inReplay)) && settings.coin === 'BTC');
  useStoreVersion(store, 400);

  // Usunięty wskaźnik zestawu paneli wypada też z listy instancji zestawu (keepPanelSetIids)
  const update = useCallback((patch: Partial<ChartSettings>) => setSettings((s) => keepPanelSetIids({ ...s, ...patch })), []);
  // Okno ustawień wskaźnika (z legendy, opisu jego panelu albo listy „Na wykresie”) zamiast menu
  const editIndicator = useCallback((iid: string) => {
    setMenu(null);
    setIndEdit(iid);
  }, []);
  const live = useRef({ replay, settings, chartOnly });
  live.current = { replay, settings, chartOnly };
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const setCoin = useCallback((coin: Market) => {
    // Powtórka innego rynku to inne nagranie — nowy link (ta sama chwila, interwał i rodzaj wykresu)
    const { replay: r, settings: s } = live.current;
    if (r) {
      // Strefa ceny dotyczy rynku z linku — dla innego rynku jej nie przenosimy
      if (coin !== r.session.coin) window.location.hash = replayHash({ ...r.link, coin, interval: s.interval, view: s.view, t: r.session.t, zone: null });
      return;
    }
    setSettings((s) => (s.coin === coin ? s : withPatch(s, { coin })));
    setPick(null);
    setHighlight('');
  }, []);
  const onLegendBottom = useCallback((px: number) => {
    legendBottom.current = px;
    ctrlRef.current?.setTopInset(px);
  }, []);

  // Świece interwału przed startem strumieni — pierwsze świece od razu we właściwym interwale
  useEffect(() => {
    void series.load();
    if (!store.replay) startRecording(store);
    ctrlRef.current?.setSeries(series);
  }, [store, series]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ctrl = new ProChartController(host, store, series, shownSettings(settings, isNarrow(), layout, inReplay), signal.set, setPick, (key: HideKey) => {
      if (key.startsWith('ind:')) {
        const x = live.current.settings.indicators.find((y) => `ind:${y.iid}` === key);
        if (!x) return;
        setSettings((s) => ({ ...s, indicators: s.indicators.map((y) => (y.iid === x.iid ? { ...y, visible: false } : y)) }));
        setToast(tr(`Ukryto wskaźnik: ${indicatorLabel(x)} — włączysz go w menu Wskaźniki → Na wykresie`, `Indicator hidden: ${indicatorLabel(x)} — turn it back on in Indicators → On the chart`));
        return;
      }
      const pane = key as PaneKey;
      update({ [pane]: false });
      setToast(tr(`Ukryto panel: ${PANE_NAMES[pane]} — włączysz go w menu Wskaźniki → Pod wykresem`, `Panel hidden: ${PANE_NAMES[pane]} — turn it back on in Indicators → Below the chart`));
    }, setScale);
    ctrl.setPhone(isNarrow());
    ctrl.onEditIndicator = editIndicator;
    ctrl.onEmptyTap = () => {
      if (!isNarrow()) return;
      if (live.current.chartOnly) exitFocus();
      else enterFocus();
    };
    ctrlRef.current = ctrl;
    setTools(ctrl.draw);
    ctrl.setTopInset(legendBottom.current);
    // Zmiana wysokości wykresu zmienia ułamek skali zajęty przez legendę
    const ro = new ResizeObserver(() => ctrl.setTopInset(legendBottom.current));
    ro.observe(host);
    return () => {
      ro.disconnect();
      ctrl.destroy();
      ctrlRef.current = null;
      setTools(null);
    };
    // Wykres tworzymy raz; zmiany ustawień idą przez applySettings
  }, [store, signal, update, editIndicator]);

  useEffect(() => {
    // Telefon i układ 2 × 2 chowają część paneli — zapisane ustawienia wracają na szerszym ekranie albo w mniejszym układzie
    ctrlRef.current?.setPhone(narrow);
    ctrlRef.current?.applySettings(shownSettings(settings, narrow, layout, inReplay));
    if (!inReplay) {
      saveSettings(settings, stationKey(tabId, panel));
      onSavedRef.current?.();
    }
  }, [settings, panel, layout, tabId, narrow, inReplay]);

  useEffect(() => {
    ctrlRef.current?.highlight(highlight);
  }, [highlight]);

  // Telefon: panele pod ceną niższe, w trybie skupienia i poziomo — jeszcze niższe (cena ≥ 80% ekranu)
  useEffect(() => {
    ctrlRef.current?.setPaneScale(chartOnly ? 0.45 : narrow ? 0.85 : 1);
  }, [chartOnly, narrow, store]);
  useEffect(() => {
    if (!narrow) setFocus(false);
  }, [narrow]);
  useEffect(() => {
    if (!landscape) setLandscapeOff(false);
  }, [landscape]);
  // Escape kończy skupienie (wyjście z klawiatury; przycisk w rogu dla dotyku i czytnika ekranu)
  useEffect(() => {
    if (!chartOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (!focusExitKey(e.key, true)) return;
      e.preventDefault();
      exitFocus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chartOnly, exitFocus]);
  // Karta wykresu „fixed” nad stroną: przekształcenie widoku (animacja przejścia) nie może być jej blokiem odniesienia
  useEffect(() => {
    if (!chartOnly) return;
    const root = document.documentElement;
    root.dataset.hqFocus = landscape ? 'landscape' : 'focus';
    return () => {
      delete root.dataset.hqFocus;
    };
  }, [chartOnly, landscape]);

  // Adres strony zawsze prowadzi do bieżącego widoku — bez nowych wpisów w historii przeglądarki
  useEffect(() => {
    const h = hashFor(settings);
    const at = window.location.hash;
    if (panel === 0 && !inReplay && at.startsWith('#charts') && at !== h && !parseReplayLink(at)) history.replaceState(history.state, '', h);
  }, [settings, panel, inReplay]);

  // Wklejony link w tej samej karcie (link powtórki obsługuje widok wykresów)
  useEffect(() => {
    if (panel !== 0 || inReplay) return;
    const onHash = () => {
      if (parseReplayLink(window.location.hash)) return;
      const set = parseAlarmLink(window.location.hash);
      if (set) setLinkSet(set);
      const p = settingsFromHash(window.location.hash);
      if (Object.keys(p).length > 0) setSettings((s) => withPatch(s, p));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [panel, inReplay]);

  // Alarmy działają na cenie na żywo — w powtórce bez ich linii; ukryte linie nie wyłączają alarmów
  useEffect(() => {
    ctrlRef.current?.setAlerts(store.replay || !linesShown ? [] : alerts.filter((a) => a.coin === store.coin && hasLine(a)).map((a) => ({ price: a.price, title: lineLabel(a), armed: a.armed || a.streak > 0 })));
  }, [alerts, linesShown, store]);

  // Strefa ceny z linku powtórki (np. z lekcji)
  const zone = replay?.link.zone ?? null;
  const [zoneLo, zoneHi] = zone ?? [0, 0];
  useEffect(() => {
    ctrlRef.current?.setZone(zoneLo > 0 ? [zoneLo, zoneHi] : null);
  }, [zoneLo, zoneHi, store]);

  // Rynki z linku z alarmami nagrywają od razu, żeby kierunek dotknięcia wynikał z bieżącej ceny
  useEffect(() => {
    for (const c of new Set(linkSet?.map((e) => e.c))) storeFor(c as Market).start();
  }, [linkSet]);
  const linkPreview = linkSet ? linkAlerts(linkSet, (c) => storeFor(c as Market).lastPrice(), 0, Date.now()) : null;
  const addLinkSet = (replace: boolean) => {
    if (!linkSet) return;
    const made = linkAlerts(linkSet, (c) => storeFor(c as Market).lastPrice(), store.serverNow(), Date.now());
    alertBook.update((l) => [...(replace ? [] : l), ...made].slice(-MAX_ALERTS));
    primeAlertSound();
    void askNotifications();
    setLinkSet(null);
    setToast(tr(`Dodano alarmy z linku: ${made.length}`, `Alerts added from the link: ${made.length}`));
  };

  // Alarmy pilnuje moduł strony (każda transakcja rynku z alarmem, także po wyjściu z Wykresów); komunikat w pierwszym panelu
  useEffect(() => {
    startAlertWatch();
    if (panel !== 0) return;
    return onAlertEvents((events) => {
      const fired = events.find((e) => e.type === 'fire');
      if (fired) setToast(`🔔 ${eventText(fired, lang)}`);
    });
  }, [panel]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  // Menu pod prawym przyciskiem: Escape, kliknięcie obok i przewinięcie zamykają
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onDown = (e: PointerEvent) => {
      if (!ctxRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('wheel', close);
    };
  }, [ctxMenu]);

  const pickOrder = useCallback((o: AggressorOrder) => {
    const ctrl = ctrlRef.current;
    const p: LiquidityPick = { kind: 'order', order: o, cls: classify(o, ctrl?.bigTradeUsd ?? DEFAULT_THRESHOLD_USD) };
    ctrl?.select(p);
    setPick(p);
    // Na telefonie taśma jest kartą zamiast wykresu — po wyborze zlecenia wracamy do wykresu z kartą i bąblem
    if (isNarrow()) setTab('chart');
  }, []);

  const closePick = useCallback(() => {
    ctrlRef.current?.select(null);
    setPick(null);
  }, []);

  // Wieloryby tylko z aktualnego pliku skanera (starszy niż WHALES_STALE_MS jest ukryty, jak nieaktualna mapa likwidacji)
  useEffect(() => {
    ctrlRef.current?.setWhales(whales?.markets[store.coin] ?? null);
  }, [whales, store]);

  // Klastry likwidacji tylko z aktualnej mapy skanera (jak w Przed sesją: nieaktualna mapa nie jest pokazywana); skaner mapuje BTC
  useEffect(() => {
    const fresh = liq.map && (liq.status === 'ready' || liq.status === 'delayed') && store.coin === 'BTC' && !store.replay;
    ctrlRef.current?.setLiqLevels(fresh ? liqLevels(liq.map!) : []);
  }, [liq.map, liq.status, store]);

  // Stożek prognozy z dziennika Desku tylko na żywo: prognoza „teraz” nie pasuje do odtwarzanej chwili
  useEffect(() => {
    ctrlRef.current?.setLedger(store.replay ? null : ledger);
  }, [ledger, store]);

  useEffect(() => {
    ctrlRef.current?.setOutcomes(hip4On ? hip4 : null);
  }, [hip4, hip4On]);

  useEffect(() => {
    ctrlRef.current?.setBlogMaps(blogMaps, blogSettle);
  }, [blogMaps, blogSettle, store]);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === cardRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // Menu: Escape i kliknięcie poza menu (i poza jego przyciskiem) zamykają
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (menuRef.current?.contains(t) || t.closest?.('[data-menu-toggle]')) return;
      setMenu(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [menu]);

  const toggleFullscreen = () => {
    const el = cardRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  /** Rynek, giełda, interwał i rodzaj wykresu (podpis zrzutu i źródło Klatki). */
  const chartSource = () => `${store.coin}-PERP · Hyperliquid · ${intervalById(settings.interval).label} · ${settings.view === 'footprint' ? 'Footprint' : tr('Świece', 'Candles')}`;
  /** Pasek jakości: pokrycie widocznego zakresu taśmą i pokrycie open interest przez mapę skanera (chwila `now` magazynu). */
  const quality = (ctrl: ProChartController, now: number): FrameQuality => {
    const span = ctrl.visibleSpan(now);
    return { ...tapeQuality(span ? tapeCoveragePct(store.coverage, span.from, span.to) : Number.NaN), ...mapQuality(liq, store.coin, inReplay) };
  };

  const screenshot = () => {
    const ctrl = ctrlRef.current;
    const host = hostRef.current;
    if (!ctrl || !host) return;
    // Chwila danych (w powtórce — odtwarzana), w czasie lokalnym
    const now = store.serverNow();
    const img = brandedScreenshot(ctrl.chart.takeScreenshot(true), host.clientWidth, chartSource(), new Date(now), quality(ctrl, now));
    // Bez płótna nie ma paska jakości — zamiast obrazu bez niego komunikat
    if (!img) return setToast(IMAGE_FAILED);
    downloadCanvas(img, `hyperquant-${store.coin.toLowerCase()}-${intervalById(settings.interval).id}-${fileStamp(now)}.png`);
  };

  // Klatka: zrzut z chwili otwarcia, domyślny tytuł z pytania układu i trzech liczb nagłówka (pierwszy panel karty)
  const headerNums = useRef<LayoutNumber[] | null>(null);
  const onHeaderNumbers = useCallback((n: LayoutNumber[]) => {
    headerNums.current = n;
  }, []);
  const [frameSrc, setFrameSrc] = useState<FrameSource | null>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  /** Wzorzec tego panelu w układzie (z aktywnym zestawem paneli): ostrzeżenie Klatki tylko o warstwach ponad nim. */
  const presetPanel = (): ChartSettings => {
    const set = activePanelSet(station, settings);
    return set ? panelSetPanel(station, set.id, panel, narrow) : stationPanel(station, panel, narrow);
  };
  const openFrame = () => {
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    const now = store.serverNow();
    const shot = ctrl.chart.takeScreenshot(true);
    setMenu(null);
    setFrameSrc({
      layout: station.id,
      title: defaultFrameTitle(station.question, layoutHeader && !inReplay ? headerNums.current : null),
      source: chartSource(),
      time: now,
      quality: quality(ctrl, now),
      // Warstwy, które widać na tym wykresie, i we wzorcu tego panelu układu (z aktywnym zestawem paneli) — telefon i
      // układ 2 × 2 chowają część ustawień w obu
      layersShown: priceLayerCount(shownSettings(settings, narrow, layout, inReplay)),
      presetLayers: priceLayerCount(shownSettings(presetPanel(), narrow, layout, inReplay)),
      image: () => shot,
    });
  };

  const copy = (text: string, done: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => setToast(done),
      () => setToast(tr('Nie udało się skopiować — skopiuj adres strony z paska przeglądarki', 'Copy failed — copy the page address from the browser bar'))
    );
  };

  // Link do widoku, a w powtórce do bieżącej chwili nagrania (ten sam interwał i rodzaj wykresu)
  const copyLink = () => {
    if (!replay) return copy(window.location.href, tr('Skopiowano link do widoku', 'View link copied'));
    const { session, link } = replay;
    const h = replayHash({ ...link, interval: settings.interval, view: settings.view, from: session.from, to: session.to, t: Math.round(session.t / 1000) * 1000 });
    copy(`${window.location.origin}${window.location.pathname}${h}`, tr('Skopiowano link do tej chwili powtórki', 'Link to this replay moment copied'));
  };

  // Powtórka nagranej doby: link w adresie strony przełącza widok wykresów
  const canReplay = !inReplay && replayBase('history') !== '';
  const openReplay = () => {
    window.location.hash = replayHash({ source: 'history', coin: settings.coin, interval: settings.interval, view: settings.view });
  };

  const liveOnly = () => {
    if (inReplay) setToast(tr('Alarmy działają na wykresie na żywo — wróć do niego, aby ustawić alarm', 'Alerts work on the live chart — go back to it to set an alert'));
    return !inReplay;
  };
  // Szybki alarm z menu wykresu: dotknięcie poziomu, kierunek z położenia względem ceny
  const addTouch = (price: number) => {
    if (!liveOnly()) return;
    const now = store.serverNow();
    const dir = defaultDir('touch', price, store.lastPrice() || price);
    addAlert({ coin: store.coin, price, kind: 'touch', dir, iv: '15m', closes: 1, delta: false, from: now, until: now + DEFAULT_TTL_MS, pair: '', note: '', after: '' }, now);
    setToast(tr(`Alarm przy ${fmtPx(price)} (${store.coin}): dotknięcie poziomu`, `Alert at ${fmtPx(price)} (${store.coin}): level touch`));
  };
  // Alarmy aktywnej strefy P/b do końca jej życia: dotknięcie góry i dołu, zamknięcie 5m poza strefą, powrót do strefy
  const addZoneAlerts = (z: PbZone) => {
    if (!liveOnly()) return;
    const now = store.serverNow();
    const name = z.s > 0 ? 'P' : 'b';
    const base = { coin: store.coin, iv: '5m', closes: 1, delta: false, from: now, until: z.until, pair: '', after: '' };
    const made = (
      [
        [z.hi, 'touch', 1, tr(`Strefa ${name}: dotknięcie góry`, `Zone ${name}: top touch`)],
        [z.lo, 'touch', -1, tr(`Strefa ${name}: dotknięcie dołu`, `Zone ${name}: bottom touch`)],
        [z.hi, 'close', 1, tr(`Strefa ${name}: zamknięcie nad strefą`, `Zone ${name}: close above`)],
        [z.lo, 'close', -1, tr(`Strefa ${name}: zamknięcie pod strefą`, `Zone ${name}: close below`)],
        [z.hi, 'reclaim', -1, tr(`Strefa ${name}: powrót pod górę`, `Zone ${name}: back below the top`)],
        [z.lo, 'reclaim', 1, tr(`Strefa ${name}: powrót nad dół`, `Zone ${name}: back above the bottom`)],
      ] as const
    ).map(([price, kind, dir, note]) => newAlert({ ...base, price, kind, dir, note }, now));
    alertBook.update((l) => [...l, ...made].slice(-MAX_ALERTS));
    primeAlertSound();
    void askNotifications();
    setToast(
      tr(
        `Alarmy strefy ${name} ${fmtPx(z.lo)}–${fmtPx(z.hi)} (${store.coin}): ${made.length}, do ${fmtHm(z.until)}`,
        `Zone ${name} ${fmtPx(z.lo)}–${fmtPx(z.hi)} alerts (${store.coin}): ${made.length}, until ${fmtHm(z.until)}`
      )
    );
  };
  const openAlerts = (draft: AlertDraft | null) => {
    if (draft && !liveOnly()) return;
    setAlertDraft(draft);
    setMenu('alerts');
    const now = Date.now();
    markSeen(now);
    setSeen(now);
  };
  // Alarm na poziomie linii poziomej z paska i menu rysunku (w powtórce bez alarmów)
  const drawAlert = inReplay ? undefined : (p: number) => openAlerts({ price: toTick(p), kind: 'close' });

  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    // Tylko na samym wykresie (legenda, karty i menu mają własne zachowanie)
    if (!hostRef.current?.contains(e.target as Node)) return;
    e.preventDefault();
    // Na rysunku — menu rysunku zamiast menu wykresu
    if (tools?.openMenu(e.clientX, e.clientY)) {
      setCtxMenu(null);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const raw = ctrlRef.current?.priceAt(y) ?? null;
    // Menu otwiera się w lewo i w górę tylko wtedy, gdy nie mieści się przy prawej lub dolnej krawędzi
    setCtxMenu({ x, y, price: raw === null ? null : toTick(raw), left: x > r.width - 248, up: y > r.height - 340 });
  };

  const iv = intervalById(settings.interval);
  // Wykres pobiera dane Binance i Bybit (panele giełd albo ich grupa w tablicy) — tylko wtedy Stan rynku je porównuje
  const shown = shownSettings(settings, narrow, layout, inReplay);
  const venueOn = shown.showVenueCvd || shown.showVenueOi || (shown.showStats && shown.statGroups.some((g) => VENUE_GROUPS.includes(g)));
  const tapeSince = store.coverage.first();
  // Plakietki źródeł warstw w legendzie (w powtórce bez nich: nagranie, nie dane na żywo, i bez warstw skanera); stan
  // migawek skanera i powody ich braku te same co w nagłówku układu. Bez mapy z bloga na wykresie (weekend, rano przed
  // wpisem, inny rynek) panel z mapą zamiast poziomów dnia rysuje PDH i PDL — w legendzie ich plakietka, mapa z „—”
  const mapShown = store.coin === 'BTC' && iv.ms < DAY ? pickMap(blogMaps.maps, store.serverNow(), settings.blogMapId) : null;
  const levelsInstead = levelsInsteadOfMap(shown, store.coin, blogMaps.status, mapShown);
  const layerChips = legendChips(levelsLegend(shown, levelsInstead), {
        coin: store.coin,
        now: Date.now(),
        intervalMs: iv.ms,
        scan: {
          showLiq: liqScan(liq),
          showWhales: whalesScan(whales, store.coin, whalePub.configured),
          showBlogMap: blogMapScan(blogMaps, pickMap(blogMaps.maps, store.serverNow(), settings.blogMapId)),
        },
      });
  // Lista „Warstwy”: włączone warstwy i ukryte okiem w tej sesji; w powtórce plakietka „nagranie” zamiast źródła na żywo
  const menuChips: LayerChip[] = [
    ...(inReplay ? layerChips.map((c) => ({ ...c, tone: 'neutral' as const, text: tr('nagranie', 'recording'), hint: tr('Powtórka nagrania serwera', "Replay of the server's recording") })) : layerChips),
    ...[...hiddenLayers.values()].filter((c) => !layerChips.some((x) => x.key === c.key)),
  ];
  // Warstwy przepływu wyłączone we wzorcu (np. bąble i ściany na telefonie) — na liście do włączenia jednym dotknięciem
  const offChips: LayerChip[] = QUICK_LAYERS.filter((k) => !settings[k] && !menuChips.some((c) => c.key === k)).map((k) => ({
    key: k,
    label: layerLabel(k),
    tone: 'neutral',
    text: tr('wył.', 'off'),
    hint: tr('Warstwa wyłączona — dotknij, żeby ją włączyć', 'Layer off — tap to turn it on'),
  }));
  const layersMenu = (compact: boolean) => (
    <LayersMenu
      compact={compact}
      chips={[...menuChips, ...offChips]}
      hidden={new Set([...hiddenLayers.keys(), ...offChips.map((c) => c.key)])}
      onToggle={toggleLayer}
      onAll={() => {
        setIndicatorsSection('flow');
        setMenu('indicators');
      }}
    />
  );
  const toggleLayer = (c: LayerChip, show: boolean) => {
    if (c.key.startsWith('show')) update({ [c.key]: show } as Partial<ChartSettings>);
    else setSettings((s) => ({ ...s, indicators: s.indicators.map((x) => (x.id === c.key ? { ...x, visible: show } : x)) }));
    setHiddenLayers((m) => {
      const next = new Map(m);
      if (show) next.delete(c.key);
      else next.set(c.key, c);
      return next;
    });
  };
  const bigUsd = ctrlRef.current?.bigTradeUsd ?? DEFAULT_THRESHOLD_USD;
  const tick = hlTick(store.lastPrice());
  const editing = indEdit ? (settings.indicators.find((x) => x.iid === indEdit) ?? null) : null;

  // Stan rynku: przycisk „Stan” i linia pod paskiem (w układzie 2 × 2 za mało miejsca)
  const stateShown = settings.showState && layout !== 4;
  const fsOn = layoutFs ? layoutFs.active : fullscreen;
  const fsLabel = fsOn
    ? tr('Zamknij pełny ekran', 'Exit full screen')
    : layoutFs
      ? layout > 1
        ? tr('Pełny ekran z kartami: wszystkie wykresy układu', 'Full screen with tabs: all charts of the layout')
        : tr('Pełny ekran z kartami', 'Full screen with tabs')
      : tr('Pełny ekran', 'Full screen');
  // Układ kilku wykresów tylko na szerokim ekranie (od 1024 px)
  const layoutChoice = onLayout && typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
  /** Menu „⋯” paska (komputer): narzędzia, które wcześniej były ikonami; skróty klawiszowe w dopisku. */
  const moreEntries: MoreEntry[] = [
    { key: 'draw', label: tr('Narzędzia rysowania', 'Drawing tools'), icon: PenTool, kind: 'check', checked: drawOpen, on: () => setDrawOpen((o) => !o) },
    { key: 'tape', label: tr('Taśma zleceń', 'Order tape'), hint: 'T', icon: ListOrdered, kind: 'check', checked: settings.showTape, on: () => update({ showTape: !settings.showTape }) },
    ...(inReplay
      ? []
      : [{ key: 'alerts', label: linesShown ? tr('Alarmy cenowe', 'Price alerts') : tr('Alarmy cenowe (ukryte na wykresie)', 'Price alerts (hidden on the chart)'), icon: Bell, hint: alerts.length > 0 ? String(alerts.length) : undefined, on: () => openAlerts(null) }]),
    { key: 'settings', label: tr('Ustawienia wykresu', 'Chart settings'), icon: SlidersHorizontal, on: () => setMenu('settings') },
    ...(layoutChoice
      ? LAYOUT_OPTIONS.map(
          (o, k): MoreEntry => ({ key: `layout${o.value}`, section: k === 0 ? tr('Układ wykresów', 'Chart layout') : undefined, label: o.title, kind: 'radio', checked: layout === o.value, icon: LAYOUT_ICONS[o.value], on: () => onLayout!(o.value) })
        )
      : []),
    { key: 'now', section: tr('Widok', 'View'), label: tr('Przewiń do bieżącej świecy', 'Scroll to the current candle'), hint: 'End', icon: ChevronsRight, on: () => ctrlRef.current?.scrollToNow() },
    { key: 'scale', label: tr('Przywróć skalę', 'Reset scale'), hint: 'R', icon: RotateCcw, on: () => ctrlRef.current?.resetScales() },
    ...(canReplay ? [{ key: 'replay', label: tr('Powtórka nagranej doby', 'Replay of the recorded day'), icon: History, on: openReplay }] : []),
    { key: 'link', label: inReplay ? tr('Kopiuj link do tej chwili', 'Copy link to this moment') : tr('Kopiuj link do widoku', 'Copy view link'), icon: Link, on: copyLink },
    { key: 'shot', label: tr('Zrzut ekranu (PNG)', 'Screenshot (PNG)'), icon: Camera, on: screenshot },
    { key: 'frame', label: tr('Klatka (PNG 16:9 albo 1:1)', 'Frame (PNG 16:9 or 1:1)'), title: FRAME_LABEL, icon: FrameIcon, on: openFrame },
    { key: 'keys', label: tr('Skróty klawiszowe', 'Keyboard shortcuts'), hint: '?', icon: Keyboard, on: () => setMenu('keys') },
    { key: 'fs', label: fsLabel, hint: 'F', icon: fsOn ? Minimize2 : Maximize2, on: layoutFs?.toggle ?? toggleFullscreen },
    ...(onRestore ? [{ key: 'restore', label: tr(`Przywróć wzorzec karty: ${station.name}`, `Restore the tab preset: ${station.name}`), icon: RotateCcw, on: onRestore }] : []),
  ];

  /** Menu „⋯” na telefonie: wskaźniki, alarmy, ustawienia, źródła liczb układu i narzędzia. */
  const phoneEntries: MoreEntry[] = [
    { key: 'indicators', label: tr('Wskaźniki', 'Indicators'), icon: Layers, on: () => setMenu('indicators') },
    ...(inReplay ? [] : [moreEntries.find((e) => e.key === 'alerts')!]),
    { key: 'settings', label: tr('Ustawienia wykresu', 'Chart settings'), icon: SlidersHorizontal, on: () => setMenu('settings') },
    ...(layoutHeader && !inReplay ? [{ key: 'numbers', label: tr('Liczby układu: skąd?', 'Layout numbers: sources'), icon: Info, on: () => setNumbersOpen(true) }] : []),
    { key: 'draw', section: tr('Narzędzia', 'Tools'), label: tr('Narzędzia rysowania', 'Drawing tools'), icon: PenTool, kind: 'check', checked: drawOpen, on: () => setDrawOpen((o) => !o) },
    { key: 'focus', label: tr('Tryb skupienia (dotknięcie wykresu)', 'Focus mode (tap the chart)'), icon: Maximize2, kind: 'check', checked: focus, on: () => (focus ? exitFocus() : enterFocus()) },
    ...moreEntries.filter((e) => ['now', 'scale', 'replay', 'link', 'shot', 'frame'].includes(e.key)).map((e) => ({ ...e, section: undefined, hint: undefined })),
    { key: 'fs', label: fullscreen ? tr('Zamknij pełny ekran', 'Exit full screen') : tr('Pełny ekran', 'Full screen'), icon: fullscreen ? Minimize2 : Maximize2, on: toggleFullscreen },
    ...(phoneTabs?.onRestore ? [{ key: 'restore', label: tr(`Przywróć wzorzec karty: ${station.name}`, `Restore the tab preset: ${station.name}`), icon: RotateCcw, on: phoneTabs.onRestore }] : []),
  ];

  // Skróty wykresu bez modyfikatorów: tylko w panelu, w którym ostatnio kliknięto, i nie w polu tekstowym
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  onKeyRef.current = (e) => {
    if (isTyping(e.target) || !tools?.isFocused) return;
    const act = chartKeyAction(e);
    if (!act) return;
    if (act.kind === 'interval') {
      const next = INTERVALS[act.index];
      if (!next) return;
      update({ interval: next.id });
    } else if (act.kind === 'keys') setMenu((m) => (m === 'keys' ? null : 'keys'));
    else if (act.kind === 'indicators') setMenu('indicators');
    else if (act.kind === 'now') ctrlRef.current?.scrollToNow();
    else if (act.kind === 'view') update({ view: settings.view === 'footprint' ? 'candles' : 'footprint' });
    else if (act.kind === 'tape') update({ showTape: !settings.showTape });
    else if (act.kind === 'market') setCoin(MARKETS[(MARKETS.indexOf(settings.coin) + 1) % MARKETS.length]);
    else if (act.kind === 'reset') ctrlRef.current?.resetScales();
    else if (act.kind === 'autoscale') ctrlRef.current?.setAutoScale(!scale.auto);
    else (layoutFs?.toggle ?? toggleFullscreen)();
    e.preventDefault();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      ref={cardRef}
      data-focus={chartOnly ? (landscape ? 'landscape' : 'focus') : undefined}
      // Bez overflow-hidden na karcie: listy paska wychodzą poza kartę (niski wykres w układzie 2 i 4, telefon); przycina
      // samo pole wykresu
      className={`${chartOnly ? '' : 'relative '}flex flex-col bg-surface-1 border border-line-strong ${
        chartOnly
          ? // Nad przypiętym nagłówkiem (z-30); w trybie skupienia pod dolnym menu (z-40), poziomo na cały ekran
            landscape
            ? 'fixed inset-0 z-50'
            : 'fixed inset-x-0 top-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-[35]'
          : fullscreen
          ? 'w-full h-full'
          : layoutFs?.active
            ? 'rounded-xl h-full min-h-0'
            : layout === 4
            ? 'rounded-xl h-[calc((100dvh-5.5rem)/2)] min-h-[380px]'
            : // Nad kartą tylko nagłówek strony (na komputerze jeden rząd z liczbami rynku) i odstęp
              // Telefon: nagłówek w jednym rzędzie nad kartą, dolne menu pod nią
              'rounded-xl h-[calc(100dvh-8.75rem)] sm:h-[calc(100dvh-11rem)] lg:h-[calc(100dvh-5rem)] min-h-[440px]'
      }`}
    >
      {/* Pasek wykresu (komputer): jeden rząd list rozwijanych — układ, rynek, interwał, rodzaj, warstwy; z prawej liczby
          układu, „Stan”, przełączniki miejsca pracy, alarmy i „⋯” z resztą narzędzi */}
      {!narrow && (
        <div data-chart-bar className="@container flex flex-wrap min-[900px]:flex-nowrap items-center gap-1.5 px-2 py-1 border-b border-line min-h-11">
          {barLead}
          <DropdownSelect<Market> ariaLabel={tr(`Rynek: ${settings.coin}`, `Market: ${settings.coin}`)} title={tr('Rynek (M — następny)', 'Market (M — next)')} label={settings.coin} value={settings.coin} options={MARKET_OPTIONS} onChange={setCoin} width="w-44" />
          {/* Ulubione interwały jako przyciski tylko na bardzo szerokim ekranie */}
          <div className="hidden min-[1600px]:inline-flex">
            <Segmented<string> ariaLabel={tr('Ulubione interwały', 'Favourite timeframes')} value={settings.interval} onChange={(v) => update({ interval: v })} options={FAV_OPTIONS} />
          </div>
          <DropdownSelect<string>
            ariaLabel={tr(`Interwał wykresu: ${iv.label}`, `Chart timeframe: ${iv.label}`)}
            title={tr('Interwał wykresu (klawisze 1…9, 0)', 'Chart timeframe (keys 1…9, 0)')}
            label={<span className="font-mono">{iv.label}</span>}
            value={settings.interval}
            options={INTERVAL_MENU}
            onChange={(v) => update({ interval: v })}
            width="w-40"
          />
          <DropdownSelect
            ariaLabel={tr(`Rodzaj wykresu: ${KIND_OPTIONS.find((k) => k.value === kindOf(settings.view, settings.fpStyle))!.label}`, `Chart type: ${KIND_OPTIONS.find((k) => k.value === kindOf(settings.view, settings.fpStyle))!.label}`)}
            title={tr('Rodzaj wykresu: świece albo footprint (C — przełącz)', 'Chart type: candles or footprint (C — toggle)')}
            label={KIND_OPTIONS.find((k) => k.value === kindOf(settings.view, settings.fpStyle))!.short}
            value={kindOf(settings.view, settings.fpStyle)}
            options={KIND_OPTIONS}
            onChange={(k) => update(kindPatch(k))}
            width="w-56"
          />
          {layersMenu(false)}
          <button
            type="button"
            data-menu-toggle
            aria-expanded={menu === 'indicators'}
            title={tr('Wskaźniki: na wykresie ceny i pod nim (/)', 'Indicators: on the price chart and below it (/)')}
            onClick={() => setMenu((m) => (m === 'indicators' ? null : 'indicators'))}
            className={`${BAR_BTN} ${barBtnTone(menu === 'indicators')}`}
          >
            {tr('Wskaźniki', 'Indicators')}
          </button>
          <div className="ml-auto flex items-center gap-1.5 min-w-0">
            {/* Trzy liczby układu (pytanie układu jest podpowiedzią listy „Układ”); zły ładunek wygasza tylko je. W wąskim
                pasku (np. obok kolumny DOM) przewijają się w bok zamiast łamać pasek na dwa rzędy */}
            {layoutHeader && !inReplay && (
              <LocalBoundary what={tr('Nagłówek układu', 'Layout header')} inline>
                <LayoutHeader
                  variant="inline"
                  id={station.id}
                  question={station.question}
                  store={store}
                  model={store.coin === 'BTC' ? feed.vol.model : null}
                  volStatus={feed.vol.status}
                  liq={liq}
                  whales={whales}
                  whalesConfigured={whalePub.configured}
                  blogMaps={blogMaps}
                  blogMap={pickMap(blogMaps.maps, store.serverNow(), settings.blogMapId)}
                  narrow={false}
                  onNumbers={onHeaderNumbers}
                />
              </LocalBoundary>
            )}
            {stateShown && (
              <button
                type="button"
                aria-expanded={!!settings.stateOpen}
                aria-controls={settings.stateOpen ? stateId : undefined}
                title={tr('Stan rynku: zdanie z faktów pod paskiem (rozwiń albo zwiń)', 'Market state: a sentence of facts below the bar (expand or collapse)')}
                onClick={() => update({ stateOpen: !settings.stateOpen })}
                className={`${BAR_BTN} ${barBtnTone(!!settings.stateOpen)}`}
              >
                {tr('Stan', 'State')}
              </button>
            )}
            {barTrail}
            {!inReplay && (
              <ToolBtn label={linesShown ? tr('Alarmy cenowe', 'Price alerts') : tr('Alarmy cenowe (ukryte na wykresie)', 'Price alerts (hidden on the chart)')} onClick={() => (menu === 'alerts' ? setMenu(null) : openAlerts(null))} active={menu === 'alerts'} expanded={menu === 'alerts'}>
                <BellBadge count={alerts.length} fresh={freshAlert} hidden={!linesShown} />
              </ToolBtn>
            )}
            <BarMore entries={moreEntries} btnRef={moreBtnRef} />
          </div>
        </div>
      )}

      {/* Telefon: jeden rząd przewijany w bok — karta układu, rynek, interwał, rodzaj, karty Wykres / Taśma / DOM / Liczby
          i „Stan”; przypięte z prawej „Warstwy” i „⋯” (wskaźniki, alarmy, ustawienia, liczby układu i reszta narzędzi).
          W trybie skupienia i poziomo pasek znika (zostaje sam wykres). */}
      {narrow && !chartOnly && (
        <div data-chart-bar className="flex items-center gap-1 px-1.5 py-1 border-b border-line shrink-0">
          {/* Przewijany w bok: krawędź, za którą są jeszcze listy, wygasa (scrollFadeRef) */}
          <div ref={scrollFadeRef} className="hq-fade-x flex flex-1 items-center gap-1 min-w-0 overflow-x-auto [scrollbar-width:none]">
            {phoneTabs && (
              <PhoneSelect<string> ariaLabel={tr('Karta układu', 'Layout tab')} value={phoneTabs.value} options={phoneTabs.options} onChange={phoneTabs.onChange} className="max-w-[7.5rem] truncate" />
            )}
            <PhoneSelect<Market> ariaLabel={tr('Rynek', 'Market')} value={settings.coin} options={MARKET_OPTIONS} onChange={setCoin} />
            <PhoneSelect<string> ariaLabel={tr('Interwał wykresu', 'Chart timeframe')} value={settings.interval} options={INTERVAL_OPTIONS} onChange={(v) => update({ interval: v })} />
            <PhoneSelect<string>
              ariaLabel={tr('Rodzaj wykresu', 'Chart type')}
              value={kindOf(settings.view, settings.fpStyle)}
              options={KIND_OPTIONS.map((k) => ({ value: k.value, label: k.short }))}
              onChange={(v) => update(kindPatch(v as ChartKind))}
            />
            <div role="tablist" aria-label={tr('Widok wykresu', 'Chart view')} className="shrink-0 flex items-center gap-0.5">
              {PHONE_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={`h-11 px-2.5 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors duration-150 ${
                    tab === t.id ? 'bg-surface-3 text-ink-1 border-line-strong' : 'text-ink-3 border-transparent hover:text-ink-1'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {stateShown && (
              <button
                type="button"
                aria-expanded={!!settings.stateOpen}
                aria-controls={settings.stateOpen ? stateId : undefined}
                title={tr('Stan rynku: zdanie z faktów pod paskiem', 'Market state: a sentence of facts below the bar')}
                onClick={() => update({ stateOpen: !settings.stateOpen })}
                className={`${BAR_BTN} ${barBtnTone(!!settings.stateOpen)} shrink-0`}
              >
                {tr('Stan', 'State')}
              </button>
            )}
          </div>
          {layersMenu(true)}
          <BarMore
            entries={phoneEntries}
            btnRef={moreBtnRef}
            badge={freshAlert}
            ariaLabel={tr('Więcej: wskaźniki, alarmy, ustawienia, liczby układu, rysowanie, skala, zrzut, link, pełny ekran', 'More: indicators, alerts, settings, layout numbers, drawing, scale, screenshot, link, full screen')}
          />
        </div>
      )}

      {/* Klatka z menu „Więcej” na telefonie: po zamknięciu fokus na przycisk „Więcej” (pozycji menu już nie ma) */}
      {frameSrc && <FrameDialog src={frameSrc} onClose={() => setFrameSrc(null)} returnFocus={() => moreBtnRef.current} />}

      {replay && <ReplayBar session={replay.session} narrow={narrow} onExit={replay.onExit} />}

      {/* Stan rynku: zdanie z faktów pod paskiem (w układzie 2 × 2 za mało miejsca); na komputerze zwinięte do „Stan” */}
      {stateShown && settings.stateOpen && !chartOnly && (
        <div id={stateId}>
        <MarketStateBar
          store={store}
          series={series}
          venueOn={venueOn}
          narrow={narrow}
          onClose={() => update({ stateOpen: false })}
          collapse
        />
        </div>
      )}

      {/* Wykres z paskiem rysowania po lewej i taśmą zleceń po prawej (na telefonie taśma, DOM i liczby to karty) */}
      <div className="relative flex flex-1 min-h-0 overflow-hidden">
        <DrawToolbar tools={tools} className={drawOpen && !chartOnly ? 'flex' : 'hidden'} />
        <div className="relative flex-1 min-h-0 min-w-0" onContextMenu={onContextMenu}>
          {/* Własny kontekst warstw: uchwyt zmiany wysokości paneli wykresu (z-index 50) nie przykrywa pasków i okien rysunków */}
          <div ref={hostRef} className="absolute inset-0 isolate" />
          <AutoScaleBtn scale={scale} onToggle={() => ctrlRef.current?.setAutoScale(!scale.auto)} />
          {chartOnly && <FocusExit onExit={exitFocus} />}
          <Legend
            signal={signal}
            intervalMs={iv.ms}
            intervalLabel={iv.label}
            tapeSince={tapeSince}
            coin={store.coin}
            onBottom={onLegendBottom}
            compact={narrow}
            extra={
              narrow && layoutHeader && !inReplay ? (
                <LocalBoundary what={tr('Nagłówek układu', 'Layout header')} inline>
                  <LayoutHeader
                    variant="chips"
                    id={station.id}
                    question={station.question}
                    store={store}
                    model={store.coin === 'BTC' ? feed.vol.model : null}
                    volStatus={feed.vol.status}
                    liq={liq}
                    whales={whales}
                    whalesConfigured={whalePub.configured}
                    blogMaps={blogMaps}
                    blogMap={pickMap(blogMaps.maps, store.serverNow(), settings.blogMapId)}
                    narrow
                    onNumbers={onHeaderNumbers}
                    detailsOpen={numbersOpen}
                    onDetails={setNumbersOpen}
                  />
                </LocalBoundary>
              ) : undefined
            }
            multi={layout > 1}
            onEditIndicator={editIndicator}
          />
          <DrawStyleBar tools={tools} onAlert={drawAlert} />
          <DrawMenu tools={tools} onAlert={drawAlert} />
          <DrawSettings tools={tools} />
          {editing && (
            <IndicatorSettings
              key={editing.iid}
              x={editing}
              loaded={series.candles.length}
              chart={settings.interval}
              onChange={(x) => setSettings((s) => ({ ...s, indicators: s.indicators.map((y) => (y.iid === x.iid ? x : y)) }))}
              onClose={() => setIndEdit(null)}
            />
          )}
          <DrawList tools={tools} />
          <DrawHint tools={tools} />
          <LoadOverlay series={series} onRetry={() => void series.load(true)} />
          {narrow && tab === 'tape' && (
            <TapePanel
              store={store}
              settings={settings}
              bigUsd={bigUsd}
              selected={pick?.kind === 'order' ? pick.order : null}
              highlight={highlight}
              className="absolute inset-0 z-20 border-l-0"
              onPick={pickOrder}
              onChange={update}
              onClose={() => setTab('chart')}
            />
          )}
          {narrow && tab === 'dom' && <DomLadder store={store} className="absolute inset-0 z-20" />}
          {narrow && tab === 'numbers' && (
            <div className="absolute inset-0 z-20 flex flex-col bg-surface-1">
              {phoneNumbersTop && <div className="shrink-0 p-1.5 border-b border-line">{phoneNumbersTop}</div>}
              <NumbersCard store={store} series={series} groups={settings.statGroups} onGroups={(g) => update({ statGroups: g })} className="relative flex-1 min-h-0" />
            </div>
          )}
          {ctxMenu && (
            <ChartMenu
              ref={ctxRef}
              at={ctxMenu}
              coin={store.coin}
              nearAlert={(linesShown && alerts.find((a) => a.coin === store.coin && hasLine(a) && Math.abs((ctrlRef.current?.yOf(a.price) ?? -1e9) - ctxMenu.y) <= 8)) || null}
              pbZone={inReplay ? null : (ctrlRef.current?.pbZone() ?? null)}
              linesShown={!inReplay && alerts.some((a) => a.coin === store.coin && hasLine(a)) ? linesShown : null}
              onLines={() => {
                alertLines.set(!linesShown);
                setToast(linesShown ? tr('Alarmy ukryte na wykresie, dalej działają', 'Alerts hidden on the chart, still active') : tr('Alarmy znowu na wykresie', 'Alerts back on the chart'));
              }}
              onClose={() => setCtxMenu(null)}
              onAlert={addTouch}
              onAlertMore={(p) => openAlerts({ price: toTick(p), kind: 'close' })}
              onZoneAlerts={addZoneAlerts}
              onRemoveAlert={(a) => removeAlert(a.id)}
              onLine={() => tools?.addHorizontal(ctxMenu.x, ctxMenu.y)}
              onCopyPrice={(p) => copy(fmtPx(p).replace(/,/g, ''), tr(`Skopiowano cenę ${fmtPx(p)}`, `Price ${fmtPx(p)} copied`))}
              onCopyLink={copyLink}
              onNow={() => ctrlRef.current?.scrollToNow()}
              onReset={() => ctrlRef.current?.resetScales()}
              onShot={screenshot}
            />
          )}
          {linkPreview && (
            <div className="absolute left-2 top-2 z-40 w-[min(380px,calc(100%-16px))] max-h-[calc(100%-16px)] overflow-y-auto rounded-xl">
              <AlarmLinkCard list={linkPreview} existing={alerts.length} onAdd={addLinkSet} onClose={() => setLinkSet(null)} />
            </div>
          )}
          {droppedNote && (
            <div role="status" className="absolute left-1/2 -translate-x-1/2 top-2 z-40 flex items-start gap-2 max-w-[calc(100%-16px)] rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-xs text-ink-1 shadow-2xl">
              <span>
                {tr(
                  'Usunęliśmy wskaźniki OBV, CMF, MFI i Net Volume: HyperQuant liczy prawdziwą deltę z taśmy (panel Delta i CVD).',
                  'We removed the OBV, CMF, MFI and Net Volume indicators: HyperQuant computes true delta from the tape (Delta and CVD panes).'
                )}
              </span>
              <button
                type="button"
                className="shrink-0 text-ink-3 hover:text-ink-1"
                onClick={() => {
                  setDroppedNote(false);
                  try {
                    localStorage.setItem(DROPPED_NOTICE_KEY, 'done');
                  } catch {
                    // Zablokowana pamięć — informacja wróci przy następnym wejściu
                  }
                }}
              >
                {tr('Zamknij', 'Close')}
              </button>
            </div>
          )}
          {toast && (
            <div role="status" className="absolute left-1/2 -translate-x-1/2 top-2 z-40 max-w-[calc(100%-16px)] rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-xs text-ink-1 shadow-2xl">
              {toast}
            </div>
          )}
          {pick && (
            <div className="absolute left-2 bottom-2 z-30 w-[min(320px,calc(100%-16px))] max-h-[55%] sm:max-h-[calc(100%-16px)] overflow-y-auto rounded-xl">
              <PickCard pick={pick} store={store} bigUsd={bigUsd} highlight={highlight} onHighlight={setHighlight} onClose={closePick} />
            </div>
          )}
          {menu && (
            <div
              ref={menuRef}
              className={
                menu === 'indicators'
                  ? 'absolute z-30 inset-0 sm:inset-auto sm:top-2 sm:left-1/2 sm:-translate-x-1/2 sm:w-[min(720px,calc(100%-16px))] sm:h-[min(540px,calc(100%-16px))]'
                  : 'absolute top-2 right-2 z-30 w-[min(340px,calc(100%-16px))] max-h-[calc(100%-16px)] overflow-y-auto'
              }
            >
              {menu === 'settings' ? (
                <SettingsMenu
                  settings={settings}
                  bigUsd={bigUsd}
                  tick={tick}
                  onChange={update}
                  onReset={() => setSettings({ ...stationPanel(station, panel, isNarrow()), coin: settings.coin, interval: settings.interval })}
                  narrow={narrow}
                  blogMaps={blogMaps}
                  now={store.serverNow()}
                />
              ) : menu === 'alerts' ? (
                <AlertsMenu key={alertDraft ? `${alertDraft.price}-${alertDraft.kind}` : 'new'} coin={store.coin} price={store.lastPrice()} draft={alertDraft} serverNow={() => store.serverNow()} />
              ) : menu === 'keys' ? (
                <KeysMenu />
              ) : (
                <IndicatorsDialog
                  s={settings}
                  layers={flowLayers(settings, iv.ms, liq, whales, bigUsd)}
                  panes={narrow ? [] : PANE_ITEMS}
                  panesTab={<PanesTab s={settings} grid4={layout === 4} narrow={narrow} onChange={update} />}
                  section={indicatorsSection}
                  onSection={setIndicatorsSection}
                  narrow={narrow}
                  onChange={update}
                  onEdit={editIndicator}
                  onClose={() => setMenu(null)}
                />
              )}
            </div>
          )}
        </div>
        {settings.showTape && !narrow && (
          <TapePanel
            store={store}
            settings={settings}
            bigUsd={bigUsd}
            selected={pick?.kind === 'order' ? pick.order : null}
            highlight={highlight}
            className="absolute inset-y-0 right-0 z-30 w-[min(300px,88%)] shadow-2xl sm:static sm:z-auto sm:w-72 sm:shadow-none"
            onPick={pickOrder}
            onChange={update}
          />
        )}
      </div>

      {/* Schrödi (prognoza BTC na godzinę) w pasku stanu, tylko w pierwszym panelu i poza powtórką */}
      {!chartOnly && <StatusBar
        store={store}
        series={series}
        needs={needsOf(settings)}
        narrow={narrow}
        cat={panel === 0 && !inReplay ? <SchrodiLauncher className="shrink-0 pl-1 sm:pl-1.5" /> : null}
      />}
    </div>
  );
};

/** Przycisk A w rogu pod osią ceny: podświetlony, gdy skala dopasowuje się do widocznych świec. */
const AutoScaleBtn: React.FC<{ scale: ScaleState; onToggle: () => void }> = ({ scale, onToggle }) =>
  scale.width > 0 && scale.height > 0 ? (
    <button
      type="button"
      aria-pressed={scale.auto}
      aria-label={tr('Autoskala ceny', 'Price autoscale')}
      title={
        scale.auto
          ? tr('Autoskala ceny włączona: zakres dopasowuje się do widocznych świec. Kliknij, aby go zamrozić (A)', 'Price autoscale on: the range follows the visible candles. Click to freeze it (A)')
          : tr('Autoskala ceny wyłączona. Kliknij, aby dopasować zakres do widocznych świec (A, dwuklik na osi ceny)', 'Price autoscale off. Click to fit the range to the visible candles (A, double-click on the price axis)')
      }
      onClick={onToggle}
      className="group absolute right-0 bottom-0 z-10 grid place-items-center outline-none"
      style={{ width: scale.width, height: scale.height }}
    >
      <span
        className={`grid place-items-center w-5 h-5 rounded font-mono text-[11px] font-semibold transition-colors duration-150 group-focus-visible:ring-2 group-focus-visible:ring-accent ${
          scale.auto ? 'bg-accent/15 text-accent' : 'text-ink-3 group-hover:text-ink-1 group-hover:bg-surface-3'
        }`}
      >
        A
      </span>
    </button>
  ) : null;

const PHONE_PANE_OPTIONS: { value: PhonePane | 'none'; label: string }[] = [
  { value: 'showCvd', label: 'CVD' },
  { value: 'showDelta', label: tr('Delta (świece delty)', 'Delta (delta candles)') },
  { value: 'showVenueCvd', label: tr('CVD giełd: Hyperliquid, Binance, Bybit', 'Exchange CVD: Hyperliquid, Binance, Bybit') },
  { value: 'showVenueOi', label: tr('ΔOI i funding giełd', 'Exchange ΔOI and funding') },
  { value: 'none', label: tr('Brak', 'None') },
];

/**
 * Zakładka „Pod wykresem” menu Wskaźniki: panele pod wykresem ceny. Telefon: wolumen na dole wykresu ceny i jeden panel
 * pod nim (liczby są w karcie „Liczby”).
 */
const PanesTab: React.FC<{ s: ChartSettings; grid4: boolean; narrow: boolean; onChange: (p: Partial<ChartSettings>) => void }> = ({ s, grid4, narrow, onChange }) => {
  const pane = PHONE_PANES.find((k) => s[k]) ?? 'none';
  return (
    <div className="flex flex-col gap-2">
      {narrow ? (
        <>
          <Check label={tr('Wolumen (na dole wykresu ceny)', 'Volume (at the bottom of the price chart)')} checked={s.showVolume} onChange={(v) => onChange({ showVolume: v })} />
          <label className="flex flex-col items-start gap-1.5 text-ink-2">
            {tr('Panel pod wykresem', 'Pane below the chart')}
            <select
              value={pane}
              onChange={(e) => onChange(Object.fromEntries(PHONE_PANES.map((k) => [k, k === e.target.value])))}
              className="w-full h-9 rounded-lg border border-line bg-surface-1 px-2 text-xs text-ink-1"
            >
              {PHONE_PANE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[11px] leading-snug text-ink-3">
            {tr(
              'Na telefonie pod wykresem jest jeden panel, żeby cena miała większość ekranu. Liczby świec są w karcie „Liczby”.',
              'On a phone there is one pane below the chart so the price gets most of the screen. Candle numbers are in the “Numbers” tab.'
            )}
          </p>
          {(pane === 'showVenueCvd' || pane === 'showVenueOi') && (
            <p className="text-[11px] leading-snug text-ink-3">
              {tr(
                'Dane Binance i Bybit pobiera Twoja przeglądarka bezpośrednio z ich publicznych API — nic nie przechodzi przez serwer HyperQuant.',
                "Your browser fetches Binance and Bybit data directly from their public APIs — nothing goes through a HyperQuant server."
              )}
            </p>
          )}
        </>
      ) : (
        <>
          {PANE_ITEMS.map((i) => (
            <Check key={i.key} label={i.label} checked={s[i.key]} onChange={(v) => onChange({ [i.key]: v })} />
          ))}
          {s.showStats && <StatGroupPicker className="pl-6.5" value={s.statGroups} onChange={(g) => onChange({ statGroups: g })} />}
          {grid4 && s.showStats && <p className="text-[11px] leading-snug text-ink-3">{tr('W układzie 2 × 2 tablica jest ukryta — panel jest za niski.', 'In the 2 × 2 layout the table is hidden — the pane is too short.')}</p>}
          <p className="text-[11px] leading-snug text-ink-3">
            {tr(
              'Dane Binance i Bybit pobiera Twoja przeglądarka bezpośrednio z ich publicznych API — nic nie przechodzi przez serwer HyperQuant. Domyślnie wyłączone; nie publikuj zrzutów z tymi danymi bez sprawdzenia regulaminu giełdy.',
              "Your browser fetches Binance and Bybit data directly from their public APIs — nothing goes through a HyperQuant server. Off by default; do not publish screenshots with this data without checking the exchange's terms."
            )}
          </p>
        </>
      )}
      <div className="flex flex-col items-start gap-1.5">
        <span className="text-ink-2">{tr('Zerowanie CVD', 'CVD reset')}</span>
        <Segmented<ResetMode> ariaLabel={tr('Zerowanie CVD', 'CVD reset')} value={s.cvdReset} onChange={(v) => onChange({ cvdReset: v })} options={RESET_OPTIONS} size={narrow ? 'xs' : undefined} />
      </div>
    </div>
  );
};

/** Lista wyboru w pasku telefonu (systemowy wybór — wygodny palcem i zajmuje mało miejsca). */
function PhoneSelect<T extends string>({
  ariaLabel,
  value,
  options,
  onChange,
  className = '',
}: {
  ariaLabel: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <span className="relative inline-flex shrink-0">
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={`appearance-none h-11 pl-2.5 pr-6 rounded-lg border border-line bg-surface-2 text-xs font-medium text-ink-1 ${className}`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-3" />
    </span>
  );
}

const ToolBtn: React.FC<{
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  expanded?: boolean;
  className?: string;
  btnRef?: React.Ref<HTMLButtonElement>;
}> = ({ label, onClick, children, active, expanded, className = 'inline-flex', btnRef }) => (
  <button
    ref={btnRef}
    type="button"
    aria-label={label}
    title={label}
    aria-expanded={expanded}
    data-menu-toggle={expanded === undefined ? undefined : true}
    onClick={onClick}
    className={`${className} items-center justify-center w-9 h-9 rounded-lg border transition-colors duration-150 ${
      active ? 'bg-surface-3 text-ink-1 border-line-strong' : 'text-ink-2 border-transparent hover:text-ink-1 hover:bg-surface-2 hover:border-line'
    }`}
  >
    {children}
  </button>
);

/** Dzwonek alarmów: liczba aktywnych (szara, gdy linie są ukryte na wykresie) i kropka przy zdarzeniu, którego jeszcze nie obejrzano. */
const BellBadge: React.FC<{ count: number; fresh: boolean; hidden: boolean }> = ({ count, fresh, hidden }) => (
  <span className="relative inline-flex">
    <Bell className={`w-4 h-4 ${fresh ? 'text-warn' : ''}`} />
    {count > 0 && (
      <span className={`absolute -top-1.5 -right-2 min-w-3.5 h-3.5 px-0.5 rounded-full ${hidden ? 'bg-ink-3' : 'bg-warn'} text-page text-[9px] leading-[14px] font-semibold text-center tabular-nums`}>{count}</span>
    )}
    {fresh && <span className="absolute -top-1 -left-1 w-2 h-2 rounded-full bg-critical ring-2 ring-surface-1" />}
  </span>
);

/** Miejsce otwarcia menu wykresu i cena pod kursorem (null poza panelem ceny). */
interface CtxMenuAt {
  x: number;
  y: number;
  price: number | null;
  left: boolean;
  up: boolean;
}

/** Menu pod prawym przyciskiem (na telefonie przytrzymanie): alarm i linia przy cenie, kopiowanie, widok. */
const ChartMenu = React.forwardRef<
  HTMLDivElement,
  {
    at: CtxMenuAt;
    coin: string;
    nearAlert: PriceAlert | null;
    /** Aktywna strefa wskaźnika „Zakresy P/b” (null — wskaźnik ukryty albo brak ważnej strefy). */
    pbZone: PbZone | null;
    /** Linie alarmów tego rynku pokazane albo ukryte; null — rynek bez alarmów z linią. */
    linesShown: boolean | null;
    onLines: () => void;
    onClose: () => void;
    onAlert: (price: number) => void;
    onAlertMore: (price: number) => void;
    onZoneAlerts: (z: PbZone) => void;
    onRemoveAlert: (a: PriceAlert) => void;
    onLine: () => void;
    onCopyPrice: (price: number) => void;
    onCopyLink: () => void;
    onNow: () => void;
    onReset: () => void;
    onShot: () => void;
  }
>(({ at, coin, nearAlert, pbZone, linesShown, onLines, onClose, onAlert, onAlertMore, onZoneAlerts, onRemoveAlert, onLine, onCopyPrice, onCopyLink, onNow, onReset, onShot }, ref) => {
  const p = at.price;
  const item = (icon: React.ReactNode, label: string, run: () => void) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        run();
        onClose();
      }}
      className="flex items-center gap-2.5 w-full min-h-9 px-2.5 rounded-md text-left text-ink-1 hover:bg-surface-3"
    >
      <span className="text-ink-3">{icon}</span>
      {label}
    </button>
  );
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={tr('Menu wykresu', 'Chart menu')}
      style={{ left: at.x, top: at.y, transform: `translate(${at.left ? '-100%' : '0'}, ${at.up ? '-100%' : '0'})` }}
      className="absolute z-40 w-60 rounded-xl border border-line-strong bg-surface-2 p-1.5 text-xs shadow-2xl"
    >
      {p !== null && (
        <>
          <div className="px-2.5 pt-1 pb-1.5 font-mono text-[11px] text-ink-3">
            {coin} · {fmtPx(p)}
          </div>
          {item(<Bell className="w-4 h-4" />, tr(`Alarm: dotknięcie ${fmtPx(p)}`, `Alert: touch of ${fmtPx(p)}`), () => onAlert(p))}
          {item(<BellPlus className="w-4 h-4" />, tr(`Alarm z warunkiem przy ${fmtPx(p)}…`, `Alert with a condition at ${fmtPx(p)}…`), () => onAlertMore(p))}
          {nearAlert && item(<BellOff className="w-4 h-4" />, tr(`Usuń alarm ${fmtPx(nearAlert.price)}`, `Remove alert ${fmtPx(nearAlert.price)}`), () => onRemoveAlert(nearAlert))}
          {item(<Minus className="w-4 h-4" />, tr(`Linia pozioma przy ${fmtPx(p)}`, `Horizontal line at ${fmtPx(p)}`), onLine)}
          {item(<Copy className="w-4 h-4" />, tr(`Kopiuj cenę ${fmtPx(p)}`, `Copy price ${fmtPx(p)}`), () => onCopyPrice(p))}
          <div className="my-1 border-t border-line" />
        </>
      )}
      {pbZone && (
        <>
          {item(
            <Bell className="w-4 h-4" />,
            tr(
              `Alarmy strefy ${pbZone.s > 0 ? 'P' : 'b'} ${fmtPx(pbZone.lo)}–${fmtPx(pbZone.hi)} (6)`,
              `Zone ${pbZone.s > 0 ? 'P' : 'b'} ${fmtPx(pbZone.lo)}–${fmtPx(pbZone.hi)} alerts (6)`
            ),
            () => onZoneAlerts(pbZone)
          )}
          <div className="my-1 border-t border-line" />
        </>
      )}
      {linesShown !== null &&
        item(
          linesShown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />,
          linesShown ? tr('Ukryj alarmy na wykresie', 'Hide alerts on the chart') : tr('Pokaż alarmy na wykresie', 'Show alerts on the chart'),
          onLines
        )}
      {item(<Link className="w-4 h-4" />, tr('Kopiuj link do widoku', 'Copy view link'), onCopyLink)}
      {item(<ChevronsRight className="w-4 h-4" />, tr('Przewiń do bieżącej świecy', 'Scroll to the current candle'), onNow)}
      {item(<RotateCcw className="w-4 h-4" />, tr('Przywróć skalę', 'Reset scale'), onReset)}
      {item(<Camera className="w-4 h-4" />, tr('Zrzut ekranu (PNG)', 'Screenshot (PNG)'), onShot)}
    </div>
  );
});
ChartMenu.displayName = 'ChartMenu';

/** Stan wczytywania świec: komunikat zamiast pustego wykresu, przy błędzie — ponowienie. */
const LoadOverlay: React.FC<{ series: CandleSeries; onRetry: () => void }> = ({ series, onRetry }) => {
  if (series.candles.length > 0 || series.loadState === 'ready' || series.loadState === 'idle') return null;
  const error = series.loadState === 'error';
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
      <div className="pointer-events-auto max-w-sm rounded-xl border border-line-strong bg-surface-2 px-4 py-3 text-sm">
        <div className="font-medium text-ink-1">{error ? tr('Nie udało się pobrać świec z Hyperliquid', 'Could not load candles from Hyperliquid') : tr('Wczytywanie świec…', 'Loading candles…')}</div>
        {error && (
          <>
            <p className="mt-1 text-xs text-ink-3 leading-relaxed">
              {tr('Sprawdź połączenie lub rozszerzenia blokujące żądania do api.hyperliquid.xyz.', 'Check your connection or extensions that block requests to api.hyperliquid.xyz.')}
            </p>
            <button type="button" onClick={onRetry} className="mt-2 min-h-9 px-3 rounded-lg bg-surface-3 border border-line-strong text-xs font-medium hover:bg-surface-1">
              {tr('Spróbuj ponownie', 'Try again')}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

/** Wysokość wiersza jako wielokrotność ticku rynku (BTC przy 80 tys.: 1 USD). */
const ROW_TICKS = [0, 1, 2, 5, 10, 25, 50, 100];
const RATIO_OPTIONS = [1.5, 2, 2.5, 3, 4];
const MIN_USD_OPTIONS = [0, 1000, 2500, 10_000, 50_000, 250_000];
const STACKED_OPTIONS = [0, 2, 3, 4, 5];
const RESET_OPTIONS: { value: ResetMode; label: string }[] = [
  { value: 'session', label: tr('Sesja', 'Session') },
  { value: 'day', label: tr('Doba UTC', 'UTC day') },
  { value: 'week', label: tr('Tydzień', 'Week') },
  { value: 'none', label: tr('Ciągła', 'Continuous') },
];

const BIG_OPTIONS = [0, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];

const SettingsMenu: React.FC<{
  settings: ChartSettings;
  bigUsd: number;
  tick: number;
  onChange: (p: Partial<ChartSettings>) => void;
  onReset: () => void;
  /** Telefon: styl footprintu tutaj (nie w pasku). */
  narrow: boolean;
  /** Mapy z bloga do wyboru (z włączoną warstwą „Mapa z bloga”) i chwila wykresu. */
  blogMaps: BlogMapsState;
  now: number;
}> = ({ settings: s, bigUsd, tick, onChange, onReset, narrow, blogMaps, now }) => (
  <div className="bg-surface-2 border border-line-strong rounded-xl p-3 shadow-2xl flex flex-col gap-3 text-xs">
    <Group title="Footprint">
      {narrow && (
        <div className="flex flex-col items-start gap-1.5">
          <span className="text-ink-2">{tr('Styl', 'Style')}</span>
          <Segmented<FootprintStyle> ariaLabel={tr('Styl footprintu', 'Footprint style')} value={s.fpStyle} onChange={(v) => onChange({ fpStyle: v })} options={STYLE_OPTIONS} size="xs" />
        </div>
      )}
      <Select
        label={tr('Wysokość wiersza', 'Row height')}
        value={s.rowStep}
        options={ROW_TICKS.map((m) => Number((m * tick).toPrecision(6)))}
        format={(v) => (v === 0 ? 'Auto' : `${v} USD`)}
        onChange={(v) => onChange({ rowStep: v })}
      />
      <Select
        label={tr('Nierównowaga', 'Imbalance')}
        title={tr('Nierównowaga diagonalna: kupno w wierszu ≥ N × sprzedaż wiersz niżej (i odwrotnie)', 'Diagonal imbalance: buying in a row ≥ N × selling one row lower (and vice versa)')}
        value={s.imbalanceRatio}
        options={RATIO_OPTIONS}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => onChange({ imbalanceRatio: v })}
      />
      <Select
        label={tr('Min. wartość nierównowagi', 'Min. imbalance value')}
        title={tr(
          `Wiersz liczy się jako nierównowaga od tej wartości strony przewagi (przeliczane na ${s.coin} po cenie)`,
          `A row counts as an imbalance from this value of the dominant side (converted to ${s.coin} at the price)`
        )}
        value={s.imbalanceMinUsd}
        options={MIN_USD_OPTIONS}
        format={(v) => (v === 0 ? tr('Brak', 'None') : `${compact(v)} USD`)}
        onChange={(v) => onChange({ imbalanceMinUsd: v })}
      />
      <Select
        label={tr('Strefy stacked', 'Stacked zones')}
        title={tr('Co najmniej N kolejnych wierszy z nierównowagą po tej samej stronie', 'At least N consecutive rows with an imbalance on the same side')}
        value={s.stackedMin}
        options={STACKED_OPTIONS}
        format={(v) => (v === 0 ? tr('Wył.', 'Off') : tr(`od ${v} wierszy`, `${v}+ rows`))}
        onChange={(v) => onChange({ stackedMin: v })}
      />
    </Group>
    <Group title={tr('Nad wykresem', 'Above the chart')}>
      <Check label={tr('Stan rynku (zdanie z faktów)', 'Market state (a sentence of facts)')} checked={s.showState} onChange={(v) => onChange({ showState: v })} />
      {(s.showZones || s.showAuctions) && (
        <Check
          label={tr('Strefy i aukcje: Historia (wszystkie obrysami)', 'Zones and auctions: History (all as outlines)')}
          checked={s.zonesHistory === true}
          onChange={(v) => onChange({ zonesHistory: v ? true : undefined })}
        />
      )}
    </Group>
    {s.showBlogMap && <BlogMapPicker s={s} maps={blogMaps} now={now} onChange={onChange} />}
    <Group title={tr('Duże zlecenia', 'Large orders')}>
      <Select
        label={tr('Próg dużego zlecenia', 'Large order threshold')}
        title={tr(
          'Auto: kwantyl 98,5% wartości zleceń agresora z ostatniej godziny, zaokrąglony w górę (1, 2, 5 × 10^k)',
          'Auto: the 98.5% quantile of aggressor order values over the last hour, rounded up (1, 2, 5 × 10^k)'
        )}
        value={s.bigTradeUsd}
        options={BIG_OPTIONS}
        format={(v) => (v === 0 ? (s.bigTradeUsd === 0 ? `Auto (${compact(bigUsd)})` : 'Auto') : `${compact(v)} USD`)}
        onChange={(v) => onChange({ bigTradeUsd: v })}
      />
      <Check label={tr('Dźwięk dużych zleceń (taśma)', 'Large order sound (tape)')} checked={s.tapeSound} onChange={(v) => onChange({ tapeSound: v })} />
      <div className="flex flex-col items-start gap-1.5">
        <span className="text-ink-2" title={tr('Ile największych bąbli, ścian i dużych zleceń w widoku ma podpis z wartością; pozostałe po najechaniu albo dotknięciu', 'How many of the largest bubbles, walls and large orders in view get a value label; the rest on hover or tap')}>
          {tr('Gęstość etykiet', 'Label density')}
        </span>
        <Segmented<string>
          ariaLabel={tr('Gęstość etykiet', 'Label density')}
          size="xs"
          value={s.labelDensity === undefined ? 'auto' : String(s.labelDensity)}
          onChange={(v) => onChange({ labelDensity: v === 'auto' ? undefined : v === 'all' ? 'all' : (Number(v) as 0 | 3 | 5) })}
          options={[
            { value: 'auto', label: 'Auto', title: tr('5 na komputerze, 3 na telefonie', '5 on a computer, 3 on a phone') },
            { value: '0', label: '0' },
            { value: '3', label: '3' },
            { value: '5', label: '5' },
            { value: 'all', label: tr('Wszystkie', 'All') },
          ]}
        />
      </div>
    </Group>
    <Templates settings={s} onApply={onChange} />
    <button
      type="button"
      onClick={onReset}
      title={tr('Ustawienia tego wykresu jak we wzorcu karty; rynek i interwał zostają', "Sets this chart as in the tab preset; market and timeframe stay")}
      className="self-start min-h-9 px-3 rounded-lg border border-line-strong text-ink-2 hover:text-ink-1 hover:bg-surface-3"
    >
      {tr('Przywróć wzorzec karty', 'Restore tab preset')}
    </button>
  </div>
);

function liqHint(liq: LiqMapState): string {
  switch (liq.status) {
    case 'ready':
    case 'delayed':
      return tr(
        `3 największe po każdej stronie ceny · stan z ${fmtHm(liq.map!.asOf)}${liq.status === 'delayed' ? ' (część odczytów starsza niż 15 min)' : ''}`,
        `3 largest on each side of the price · as of ${fmtHm(liq.map!.asOf)}${liq.status === 'delayed' ? ' (some readings older than 15 min)' : ''}`
      );
    case 'loading':
      return tr('Wczytywanie mapy likwidacji…', 'Loading the liquidation map…');
    case 'unconfigured':
      return tr('Mapa likwidacji niedostępna w tej wersji strony', 'Liquidation map unavailable in this version of the site');
    case 'error':
      return tr('Nie udało się pobrać mapy likwidacji', 'Could not load the liquidation map');
    default:
      return tr('Skaner nie publikuje teraz aktualnej mapy — klastry ukryte', 'The scanner is not publishing a current map right now — clusters hidden');
  }
}

function whaleHint(w: WhaleLayer | null, coin: string): string {
  const m = w?.markets[coin];
  if (!w || !m) return tr('Skaner nie publikuje teraz warstwy wielorybów — linie ukryte', 'The scanner is not publishing the whale layer right now — lines hidden');
  return tr(
    `${m.positions.length} pozycji od ${compact(w.minPositionUsd[coin] ?? 0)} USD i ${m.orders.length} zleceń od ${compact(w.minOrderUsd[coin] ?? 0)} USD · ${w.accounts} kont · stan z ${fmtHm(w.asOf)}`,
    `${m.positions.length} positions from ${compact(w.minPositionUsd[coin] ?? 0)} USD and ${m.orders.length} orders from ${compact(w.minOrderUsd[coin] ?? 0)} USD · ${w.accounts} accounts · as of ${fmtHm(w.asOf)}`
  );
}

/** Warstwy orderflow na wykresie ceny (sekcja „Orderflow” okna wskaźników): opis z progami i powód, gdy nie działają. */
function flowLayers(s: ChartSettings, intervalMs: number, liq: LiqMapState, whales: WhaleLayer | null, bigUsd: number): ToggleItem[] {
  const big = `${compact(bigUsd)} USD${s.bigTradeUsd === 0 ? tr(' (próg automatyczny)', ' (automatic threshold)') : ''}`;
  const scope = indicatorScope(intervalMs);
  const vwapOff = fromDaily(intervalMs) ? tr('Na interwałach do 1D', 'On timeframes up to 1D') : undefined;
  return [
    {
      key: 'showHeatmap',
      label: tr('Mapa ciepła arkusza', 'Order book heatmap'),
      hint: tr(
        'Płynność zleceń oczekujących w czasie (l2Book Hyperliquid, kubełki BTC ~10 i ~100 USD, innych rynków proporcjonalnie do ceny) — od otwarcia strony, a z zapisem serwera z ostatniej doby',
        "Resting order liquidity over time (Hyperliquid l2Book, BTC buckets ~10 and ~100 USD, other markets in proportion to price) — since the page opened, plus the server's recording of the last day"
      ),
      swatch: 'bg-gradient-to-r from-of-heat-1 via-of-heat-2 to-of-heat-3',
    },
    {
      key: 'showBubbles',
      label: tr('Bąble zleceń agresora', 'Aggressor order bubbles'),
      hint: tr(
        `Zlecenia rynkowe od ${big} złożone z wypełnień; pole koła ∝ wartość, podwójny pierścień = bitwa z jednym dużym makerem; kliknij bąbel — od otwarcia strony, a z zapisem serwera z ostatniej doby`,
        `Market orders from ${big} assembled from fills; circle area ∝ value, double ring = a battle with one large maker; click a bubble — since the page opened, plus the server's recording of the last day`
      ),
      swatch: 'bg-gradient-to-r from-of-imb-buy to-of-imb-sell',
    },
    {
      key: 'showClashes',
      label: tr('Serie i ściany', 'Bursts and walls'),
      hint: tr(
        `Seria (przerywany pierścień): drobne zlecenia co najmniej 4 adresów po jednej stronie w 2 s, razem od progu. Ściana (belka): jeden maker na jednej cenie przyjął od progu z co najmniej 3 zleceń; na wykresie, gdy trwała co najmniej ${WALL_MIN_MS / 1000} s albo wchłonęła co najmniej 3 × próg (krótsze w panelu Ściany). Próg z chwili zdarzenia: z taśmy poprzedniej pełnej godziny, więc ściany i serie z przeszłości nie znikają przy zmianie progu. Na ekranie najwyżej ${WALLS_DONE_MAX} największych ścian zakończonych, ${WALLS_LIVE_MAX} trwające i ${BURSTS_MAX} serii — od otwarcia strony, a z zapisem serwera z ostatniej doby. ${CLASHES_EVIDENCE.pl}`,
        `Burst (dashed ring): small orders from at least 4 addresses on one side within 2 s, together above the threshold. Wall (bar): one maker at one price absorbed above the threshold from at least 3 orders; on the chart when it lasted at least ${WALL_MIN_MS / 1000} s or absorbed at least 3 × the threshold (shorter ones in the Walls panel). The threshold is the one in force when the event happened, from the tape of the previous full hour, so past walls and bursts do not vanish when the threshold changes. On screen at most ${WALLS_DONE_MAX} largest finished walls, ${WALLS_LIVE_MAX} ongoing and ${BURSTS_MAX} bursts — since the page opened, plus the server's recording of the last day. ${CLASHES_EVIDENCE.en}`
      ),
      swatch: 'bg-of-buy',
      off: s.showBubbles ? undefined : tr('Razem z bąblami zleceń agresora', 'Together with aggressor order bubbles'),
    },
    {
      key: 'showLots',
      label: tr('Duże zlecenia w arkuszu', 'Large orders in the book'),
      hint: tr(
        `Poziom arkusza, na którym średnie zlecenie jest w 1% największych z ostatnich 30 min tego rynku (co najmniej ${compact(bigUsd * LOT_FLOOR)} USD): linia przez czas, gdy jest w arkuszu (przygaszona po zniknięciu); po 30 s w arkuszu podpis „liczba zleceń × średnia wartość” — od otwarcia strony, a z zapisem serwera z ostatniej doby`,
        `A book level where the average order is in the top 1% of this market's last 30 min (at least ${compact(bigUsd * LOT_FLOOR)} USD): a line for as long as it rests in the book (dimmed after it disappears); after 30 s in the book a label “order count × average value” — since the page opened, plus the server's recording of the last day`
      ),
      swatch: 'bg-gradient-to-r from-of-buy-ink to-of-sell-ink',
    },
    {
      key: 'showVwap',
      label: scope.vwapAnchor === 'week' ? tr('VWAP tygodnia', 'Weekly VWAP') : tr('VWAP dnia', 'Daily VWAP'),
      hint:
        scope.vwapAnchor === 'week'
          ? tr('Od poniedziałku 00:00 UTC, ze świec 5m (na świecach dziennych)', 'From Monday 00:00 UTC, from 5m candles (on daily candles)')
          : tr('Od 00:00 UTC, ze świec 1m: cena typowa (H+L+C)/3 ważona wolumenem, ta sama na każdym interwale', 'From 00:00 UTC, from 1m candles: typical price (H+L+C)/3 weighted by volume, the same on every timeframe'),
      swatch: 'bg-of-vwap',
      off: vwapOff,
    },
    {
      key: 'showVwapBands',
      label: tr('Pasma VWAP ±1σ i ±2σ', 'VWAP bands ±1σ and ±2σ'),
      hint: tr('Odchylenie standardowe ceny od VWAP ważone wolumenem', 'Volume-weighted standard deviation of price from VWAP'),
      swatch: 'bg-of-vwap/40',
      off: vwapOff,
    },
    {
      key: 'showSessionVwap',
      label: tr('VWAP sesji', 'Session VWAP'),
      hint: tr('Od otwarcia sesji: Azja, Londyn, Nowy Jork', 'From the session open: Asia, London, New York'),
      swatch: 'bg-of-svwap',
      off: scope.sessionVwap ? undefined : tr('Na interwałach do 30m', 'On timeframes up to 30m'),
    },
    {
      key: 'showProfile',
      label: tr('Profil wolumenu', 'Volume profile'),
      hint: tr(
        'Widoczny zakres: POC, value area 70% (VAH, VAL); świece z pełnej taśmy dokładnie po cenach transakcji',
        'Visible range: POC, 70% value area (VAH, VAL); candles with a full tape exactly at trade prices'
      ),
      swatch: 'bg-ink-3',
    },
    {
      key: 'showPeriodProfiles',
      label: scope.periodProfile === 'day' ? tr('Profile dób i nagie POC', 'Day profiles and naked POCs') : tr('Profile sesji i nagie POC', 'Session profiles and naked POCs'),
      hint: tr(
        `Profil każdej ${scope.periodProfile === 'day' ? 'doby UTC' : 'sesji'} od jej początku; POC, którego cena potem nie dotknęła, ciągnie się do prawej krawędzi`,
        `A profile of every ${scope.periodProfile === 'day' ? 'UTC day' : 'session'} from its start; a POC that price has not touched since extends to the right edge`
      ),
      swatch: 'bg-of-vol',
      off: scope.periodProfile ? undefined : tr('Na interwałach do 4h', 'On timeframes up to 4h'),
    },
    {
      key: 'showDevPoc',
      label: tr('Rozwijający się POC i value area', 'Developing POC and value area'),
      hint: tr(
        `POC (linia schodkowa) oraz VAH i VAL (kropkowane) ${scope.periodProfile === 'day' ? 'doby UTC' : 'sesji'} świeca po świecy: gdzie był środek wolumenu od początku okresu w każdej chwili`,
        `The ${scope.periodProfile === 'day' ? 'UTC day' : 'session'} POC (step line) and VAH and VAL (dotted) candle by candle: where the volume centre was at every moment since the period began`
      ),
      swatch: 'bg-of-poc',
      off: scope.periodProfile ? undefined : tr('Na interwałach do 4h', 'On timeframes up to 4h'),
    },
    {
      key: 'showTpo',
      label: tr('Profil doby: wolumen, agresja, czas (TPO)', 'Day profile: volume, aggression, time (TPO)'),
      hint: tr(
        'Profil wolumenu każdej doby UTC; kolor wiersza to strona agresywna z taśmy (niebieski kupno, czerwony sprzedaż, szary bez przewagi albo bez taśmy; starsze doby z nagrania serwera, 7 dób), cienki obrys to czas (ile okresów 30 min dotknęło ceny). POC i value area z wolumenu, zakres pierwszej godziny doby UTC (pasek liliowy; to nie initial balance sesji), pojedyncze wydruki i ogony, delta doby pod profilem; liczby wiersza pod krzyżem; zastępuje profile sesji',
        'A volume profile of every UTC day; the row colour is the aggressive side from the tape (blue buy, red sell, grey no edge or no tape; older days from the server recording, 7 days), the thin outline is time (how many 30-minute periods touched the price). POC and value area from volume, the range of the first hour of the UTC day (lilac bar; not the session initial balance), single prints and tails, the day delta under the profile; row numbers under the crosshair; replaces session profiles'
      ),
      swatch: 'bg-of-svwap',
      off: tpoInterval(intervalMs) ? undefined : tr('Na interwałach do 30m', 'On timeframes up to 30m'),
    },
    {
      key: 'showTpoOi',
      label: tr('Profil doby: kolor pozycji (OI)', 'Day profile: positions colour (OI)'),
      hint: tr(
        'Kolor wiersza profilu doby ze zmiany otwartych pozycji (OI) zamiast agresji: pełny słupek, gdy OI na tej cenie rosło (niebieski przy przewadze kupna w minucie, umownie nowe longi; czerwony przy przewadze sprzedaży, nowe shorty), obrys, gdy spadało (niebieski: zamykanie shortów, czerwony: zamykanie longów); szary bez wyraźnej przewagi albo bez danych OI. OI jest minutowe, więc zmianę minuty dzielimy na ceny według jej wolumenu; Hyperliquid liczy OI obu stron. Starsze doby z nagrania serwera (7 dób), liczby wiersza pod krzyżem',
        'The day profile row colour from the change in open interest (OI) instead of aggression: a solid bar where OI rose at that price (blue when buying led the minute, by convention new longs; red when selling led, new shorts), an outline where it fell (blue: shorts closing, red: longs closing); grey with no clear lead or no OI data. OI is per minute, so a minute change is split across prices by its volume; Hyperliquid counts OI on both sides. Older days from the server recording (7 days), row numbers under the crosshair'
      ),
      swatch: 'bg-gradient-to-r from-of-buy-ink to-of-sell-ink',
      off: !tpoInterval(intervalMs) ? tr('Na interwałach do 30m', 'On timeframes up to 30m') : s.showTpo ? undefined : tr('Po włączeniu profilu doby', 'With the day profile on'),
    },
    {
      key: 'showLevels',
      label: tr('Poziomy dnia', 'Daily levels'),
      hint: tr(
        `PDH i PDL — szczyt i dołek poprzedniego dnia UTC — oraz otwarcie dnia (00:00 UTC), dla bieżącego i poprzedniego dnia (od 4h tylko bieżącego); etykiety bieżącego dnia. ${LEVELS_EVIDENCE.pl}`,
        `PDH and PDL — the previous UTC day's high and low — and the daily open (00:00 UTC), for the current and previous day (from 4h only the current one); labels for the current day. ${LEVELS_EVIDENCE.en}`
      ),
      swatch: 'bg-level',
      off: scope.levels ? undefined : tr('Na interwałach poniżej 1D', 'On timeframes below 1D'),
    },
    {
      key: 'showBlogMap',
      label: tr('Mapa z bloga', 'Blog map'),
      hint: tr(
        'Poziomy z mapy autora na blogu HyperQuant (tekst wpisu, nie model): domyślnie najnowsza Mapa dnia z bieżącej doby UTC, inną mapę z ostatnich 3 dni wybierzesz w Ustawieniach wykresu; w układzie Rozliczenie dotknięty poziom ma ✓ i godzinę',
        "Levels from the author's map on the HyperQuant blog (post text, not a model): by default the latest Day map of the current UTC day, pick another map from the last 3 days in Chart settings; in the Day review layout a touched level gets ✓ and the time"
      ),
      aliases: 'blog mapa dnia poziomy autora map levels',
      swatch: 'bg-of-blog',
      off: s.coin !== 'BTC' ? tr('Tylko BTC: blog opisuje BTC', 'BTC only: the blog covers BTC') : scope.levels ? undefined : tr('Na interwałach poniżej 1D', 'On timeframes below 1D'),
    },
    {
      key: 'showSessions',
      label: tr('Otwarcia sesji', 'Session opens'),
      hint: tr(
        'Azja 00:00 UTC, Londyn 08:00 i Nowy Jork 09:30 czasu lokalnego giełd; linie bieżącej i poprzedniej doby UTC, nazwa przy trzech ostatnich',
        'Asia 00:00 UTC, London 08:00 and New York 09:30 exchange local time; lines for the current and previous UTC day, names on the last three'
      ),
      swatch: 'bg-ink-3/60',
      off: scope.sessions ? undefined : tr('Na interwałach do 1h', 'On timeframes up to 1h'),
    },
    {
      key: 'showIb',
      label: 'Initial balance',
      hint: tr(
        `Zakres pierwszej godziny bieżącej sesji (prostokąt, szczyt i dołek), z poprzedniej sesji same linie szczytu i dołka. Rozszerzenia 1,5× i 2× dopiero po pierwszym zamknięciu półgodziny poza zakresem i tylko po tej stronie (ten sam wynik na każdym interwale). ${IB_EVIDENCE.pl}`,
        `The first-hour range of the current session (box, high and low); from the previous session only the high and low lines. The 1.5× and 2× extensions appear only after the first half-hour close outside the range, and only on that side (the same on every timeframe). ${IB_EVIDENCE.en}`
      ),
      swatch: 'bg-of-ib',
      off: scope.ib ? undefined : tr('Na interwałach do 30m', 'On timeframes up to 30m'),
    },
    {
      key: 'showLiq',
      label: tr('Klastry likwidacji', 'Liquidation clusters'),
      hint: liqHint(liq),
      swatch: 'bg-gradient-to-r from-of-sell to-of-buy',
      off: s.coin === 'BTC' ? undefined : tr('Tylko BTC: skaner mapuje pozycje na BTC', 'BTC only: the scanner maps BTC positions'),
    },
    {
      key: 'showWhales',
      label: tr('Wieloryby', 'Whales'),
      hint: tr(
        `Cena wejścia (L/S, wartość, dźwignia) i likwidacji największych pozycji oraz duże zlecenia oczekujące, także stop i TP, największych kont Hyperliquid z ich publicznego stanu; konto ma pseudonim na dobę, bez adresu · ${whaleHint(whales, s.coin)}`,
        `Entry price (L/S, value, leverage) and liquidation price of the largest positions plus large resting orders, including stops and TPs, of the largest Hyperliquid accounts from their public state; each account has a pseudonym for the day, no address · ${whaleHint(whales, s.coin)}`
      ),
      swatch: 'bg-gradient-to-r from-of-buy to-of-sell',
    },
    {
      key: 'showZones',
      label: tr('Strefy nierównowagi', 'Imbalance zones'),
      hint: tr(
        `Seria co najmniej ${s.stackedMin || 3} wierszy z nierównowagą po jednej stronie, ze świec zamkniętych i w całości nagranych, na siatce stałej przez dobę UTC (krok z poprzedniej doby). Na wykresie strefy otwarte, najwyżej ${ZONES_PER_SIDE} na stronę najbliższe ostatniemu zamknięciu; zamknięta znika (tryb „Historia” w ustawieniach: wszystkie obrysami). ${ZONES_EVIDENCE.pl}`,
        `A run of at least ${s.stackedMin || 3} rows with an imbalance on one side, from closed, fully recorded candles, on a grid fixed for the UTC day (step from the previous day). The chart shows open zones, at most ${ZONES_PER_SIDE} per side nearest the last close; a closed zone disappears (“History” mode in the settings: all as outlines). ${ZONES_EVIDENCE.en}`
      ),
      swatch: 'bg-gradient-to-r from-of-imb-buy to-of-imb-sell',
      off: s.stackedMin > 1 ? undefined : tr('Włącz strefy stacked w ustawieniach footprintu', 'Turn on stacked zones in the footprint settings'),
    },
    {
      key: 'showAuctions',
      label: tr('Niedokończone aukcje', 'Unfinished auctions'),
      hint: tr(
        `Szczyt albo dołek świecy z kupnem i sprzedażą agresorów (UA), do powrotu ceny — ze świec zamkniętych i w całości nagranych; na wykresie otwarte, najwyżej ${AUCTIONS_PER_SIDE} na stronę najbliższa cenie`,
        `A candle high or low with both aggressor buying and selling (UA), until price returns — from closed, fully recorded candles; the chart shows open ones, at most ${AUCTIONS_PER_SIDE} per side nearest the price`
      ),
      swatch: 'bg-warn',
    },
  ];
}

/** Szablony: własne (z bieżących ustawień), nakładane bez zmiany rynku. Gotowe wzorce to układy na pasku kart. */
const Templates: React.FC<{ settings: ChartSettings; onApply: (s: ChartSettings) => void }> = ({ settings, onApply }) => {
  const [own, setOwn] = useState<ChartTemplate[]>(loadTemplates);
  const [pick, setPick] = useState(() => own[0]?.id ?? '');
  const [name, setName] = useState('');
  const chosen = own.find((t) => t.id === pick) ?? own[0];
  const store = (list: ChartTemplate[]) => {
    setOwn(list);
    saveTemplates(list);
  };
  const btn = 'inline-flex items-center h-9 px-2.5 rounded-lg border border-line-strong bg-surface-3 font-medium text-ink-1 disabled:opacity-40';
  return (
    <Group title={tr('Moje szablony', 'My templates')}>
      {chosen ? (
        <div className="flex items-center gap-1.5">
          <select
            aria-label={tr('Szablon', 'Template')}
            value={chosen.id}
            onChange={(e) => setPick(e.target.value)}
            className="min-w-0 flex-1 h-9 bg-page border border-line rounded-md px-2 text-ink-1"
          >
            {own.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button type="button" className={btn} onClick={() => onApply(applyTemplate(settings, chosen.s))}>
            {tr('Zastosuj', 'Apply')}
          </button>
          <button
            type="button"
            aria-label={tr(`Usuń szablon ${chosen.name}`, `Delete template ${chosen.name}`)}
            onClick={() => {
              const rest = own.filter((t) => t.id !== chosen.id);
              store(rest);
              setPick(rest[0]?.id ?? '');
            }}
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-surface-3"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <p className="text-[11px] leading-snug text-ink-3">
          {tr(
            'Nie masz jeszcze własnych szablonów. Zapisz bieżące ustawienia wykresu pod nazwą, żeby nałożyć je jednym kliknięciem na innym wykresie.',
            'You have no templates of your own yet. Save the current chart settings under a name to apply them with one click on another chart.'
          )}
        </p>
      )}
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          const list = saveAs(own, name, settings);
          store(list);
          setPick(list[list.length - 1]?.id ?? pick);
          setName('');
        }}
      >
        <input
          type="text"
          aria-label={tr('Nazwa nowego szablonu', 'New template name')}
          placeholder={tr('Nazwa szablonu', 'Template name')}
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 h-9 px-2.5 rounded-lg bg-surface-1 border border-line text-ink-1 placeholder:text-ink-3 focus:outline-none focus:border-line-strong"
        />
        <button type="submit" disabled={!name.trim()} className={btn}>
          {tr('Zapisz bieżące', 'Save current')}
        </button>
      </form>
      <p className="text-[11px] leading-snug text-ink-3">{tr('Interwał, rodzaj wykresu, panele, wskaźniki i warstwy; rynek zostaje.', 'Timeframe, chart type, panes, indicators and layers; the market stays.')}</p>
    </Group>
  );
};

const KEY_GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: tr('Wykres', 'Chart'),
    keys: [
      ['1 … 9, 0', `${tr('Interwał', 'Timeframe')}: ${INTERVALS.map((i) => i.label).join(', ')}`],
      ['C', tr('Świece ↔ footprint', 'Candles ↔ footprint')],
      ['M', `${tr('Następny rynek', 'Next market')} (${MARKETS.join(', ')})`],
      ['T', tr('Taśma zleceń', 'Order tape')],
      ['R', tr('Przywróć skalę', 'Reset scale')],
      ['A', tr('Autoskala ceny: włącz / zamroź zakres', 'Price autoscale: on / freeze the range')],
      ['End', tr('Przewiń do bieżącej świecy', 'Scroll to the current candle')],
      ['F', tr('Pełny ekran (przy kilku wykresach: cały układ)', 'Full screen (with several charts: the whole layout)')],
      ['/', tr('Wskaźniki: szukaj i dodaj', 'Indicators: search and add')],
      ['?', tr('Ta lista', 'This list')],
      ['Esc', tr('Zamknij menu, przerwij rysowanie', 'Close menu, cancel drawing')],
    ],
  },
  {
    title: tr('Karty układów', 'Layout tabs'),
    keys: [
      ['Alt+1 … 6', tr('Układ w kolejności faz: Mapa dnia, Paliwo, Kokpit, Aukcja, Wielkie ręce, Rozliczenie', 'Layout in phase order: Day map, Fuel, Cockpit, Auction, Big hands, Day review')],
      ['Alt+7 … 9', tr('Pierwsze trzy karty własne', 'The first three tabs of your own')],
      ['Alt+↑ / Alt+↓', tr('Karta tej fazy z wyższym / niższym interwałem, ta sama chwila na wykresie', 'The tab of this phase with the higher / lower timeframe, same moment on the chart')],
      ['D', tr('Kolumna DOM i taśmy obok wykresu (W sesji, od 1280 px)', 'The DOM and tape column next to the chart (In session, from 1280 px)')],
      [tr('Dwuklik na karcie', 'Double-click a tab'), tr('Zmień nazwę', 'Rename')],
      [tr('Prawy przycisk na karcie', 'Right-click a tab'), tr('Kopia, wzorzec, zamknięcie', 'Copy, preset, close')],
      [tr('Przeciągnij kartę', 'Drag a tab'), tr('Zmień kolejność', 'Reorder')],
    ],
  },
  {
    title: tr('Rysowanie', 'Drawing'),
    keys: [
      ...TOOLS.filter((t) => t.hotkey).map((t): [string, string] => [`Alt+${t.hotkey}`, t.label]),
      [tr('Shift + przeciągnij', 'Shift + drag'), tr('Szybki pomiar', 'Quick measure')],
      ['Ctrl', tr('Odwraca magnes do OHLC', 'Inverts the OHLC magnet')],
      ['Delete', tr('Usuń zaznaczony rysunek', 'Delete the selected drawing')],
      ['Ctrl+C / Ctrl+V', tr('Kopiuj i wklej rysunek', 'Copy and paste a drawing')],
      ['Ctrl+Z / Ctrl+Y', tr('Cofnij i ponów', 'Undo and redo')],
    ],
  },
  {
    title: tr('Mysz', 'Mouse'),
    keys: [
      [tr('Kółko', 'Wheel'), tr('Zbliżenie w czasie', 'Zoom in time')],
      [tr('Przeciągnij oś ceny', 'Drag the price axis'), tr('Skala ceny (wyłącza autoskalę)', 'Price scale (turns autoscale off)')],
      [tr('Dwuklik na osi ceny', 'Double-click the price axis'), tr('Włącz autoskalę', 'Turn autoscale on')],
      [tr('Prawy przycisk', 'Right-click'), tr('Alarm, linia, cena, zrzut', 'Alert, line, price, screenshot')],
      [tr('Krzyżyk × przy panelu', 'The × on a pane'), tr('Ukryj panel pod wykresem', 'Hide the pane below the chart')],
    ],
  },
];

/** Lista skrótów: skróty bez modyfikatorów działają w panelu, w którym ostatnio kliknięto. */
const KeysMenu: React.FC = () => (
  <div className="bg-surface-2 border border-line-strong rounded-xl p-3 shadow-2xl flex flex-col gap-3 text-xs">
    {KEY_GROUPS.map((g) => (
      <Group key={g.title} title={g.title}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
          {g.keys.map(([k, what]) => (
            <React.Fragment key={k}>
              <dt>
                <kbd className="inline-block rounded border border-line-strong bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-ink-1 whitespace-nowrap">{k}</kbd>
              </dt>
              <dd className="text-ink-2 self-center">{what}</dd>
            </React.Fragment>
          ))}
        </dl>
      </Group>
    ))}
    <p className="text-[11px] leading-snug text-ink-3">{tr('W układzie kilku wykresów skróty trafiają do wykresu, w którym ostatnio kliknięto.', 'With several charts, shortcuts go to the chart you clicked last.')}</p>
  </div>
);

/**
 * Wybór mapy z bloga: domyślna (najnowsza Mapa dnia z bieżącej doby UTC) albo każda mapa z pliku (ostatnie 3 dni) z nazwą
 * rodzaju, godziną wpisu i tytułem. Mapa zapisana w ustawieniach, której już nie ma w pliku, wraca do domyślnej.
 */
const BlogMapPicker: React.FC<{ s: ChartSettings; maps: BlogMapsState; now: number; onChange: (p: Partial<ChartSettings>) => void }> = ({ s, maps, now, onChange }) => {
  const list = maps.maps.filter((m) => m.publishedAt <= now);
  const value = list.some((m) => m.id === s.blogMapId) ? s.blogMapId! : '';
  // Poza BTC i bez pliku map — powód zamiast listy (ten sam co w legendzie)
  const scan = s.coin !== 'BTC' ? { why: tr('Tylko BTC: blog opisuje BTC', 'BTC only: the blog covers BTC') } : maps.status === 'ready' ? null : blogMapScan(maps, null);
  const why = scan && 'why' in scan ? scan.why : null;
  return (
    <Group title={tr('Mapa z bloga', 'Blog map')}>
      {why ? (
        <p className="text-[11px] leading-snug text-ink-3">{why}</p>
      ) : (
        <label className="flex flex-col items-stretch gap-1.5">
          <span className="text-ink-2">{tr('Mapa na wykresie', 'Map on the chart')}</span>
          <select
            value={value}
            onChange={(e) => onChange({ blogMapId: e.target.value || undefined })}
            className="w-full h-9 bg-page border border-line rounded-md px-2 text-ink-1"
          >
            <option value="">{tr('Domyślnie: Mapa dnia z bieżącej doby UTC', 'Default: Day map of the current UTC day')}</option>
            {list.map((m) => (
              <option key={m.id} value={m.id}>
                {`${blogMapName(m.kind)} ${fmtDayTime(m.publishedAt, now)} · ${m.title}`}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="text-[11px] leading-snug text-ink-3">
        {tr(
          'Poziomy z tekstu wpisu autora, nie model HyperQuant. W układzie Rozliczenie poziom dotknięty w oknie mapy ma ✓ i godzinę.',
          "Levels from the author's post text, not a HyperQuant model; labels stay in Polish. In the Day review layout a level touched within the map's window gets ✓ and the time."
        )}
      </p>
    </Group>
  );
};

const Group: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <fieldset className="flex flex-col gap-2 min-w-0">
    <legend className="mb-1 text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">{title}</legend>
    {children}
  </fieldset>
);

function Select({
  label,
  value,
  options,
  format,
  onChange,
  title,
}: {
  label: string;
  value: number;
  options: number[];
  format: (v: number) => string;
  onChange: (v: number) => void;
  title?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2" title={title}>
      <span className="text-ink-2">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-9 min-w-28 bg-page border border-line rounded-md px-2 font-mono text-ink-1"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {format(o)}
          </option>
        ))}
      </select>
    </label>
  );
}

const Check: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({ label, checked, onChange }) => (
  <label className="flex items-center gap-2.5 min-h-9 cursor-pointer text-ink-1">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 accent-accent" />
    {label}
  </label>
);

const STATUS: Record<string, { text: string; tone: BadgeTone; title: string }> = {
  open: { text: 'LIVE', tone: 'live', title: tr('Na żywo: WebSocket Hyperliquid połączony', 'Live: Hyperliquid WebSocket connected') },
  connecting: { text: tr('Łączenie', 'Connecting'), tone: 'stale', title: tr('Łączenie z WebSocket Hyperliquid', 'Connecting to the Hyperliquid WebSocket') },
  reconnecting: {
    text: tr('Ponowne łączenie', 'Reconnecting'),
    tone: 'stale',
    title: tr('Połączenie zerwane — łączę ponownie; brakujący czas będzie luką w taśmie', 'Connection dropped — reconnecting; the missing time will be a gap in the tape'),
  },
  idle: { text: tr('Rozłączony', 'Disconnected'), tone: 'neutral', title: tr('Strumień nieaktywny', 'Stream inactive') },
};
const REPLAY_STATUS = {
  text: tr('Powtórka', 'Replay'),
  tone: 'model' as BadgeTone,
  title: tr('Powtórka nagrania serwera: taśma i arkusz z przeszłości, nie na żywo', "Replay of the server's recording: tape and book from the past, not live"),
};

/** Strefa i przesunięcie w chwili `at` — w powtórce chwila nagrania (czas letni i zimowy mają inne przesunięcie). */
function tzLabel(at: number): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const off = -new Date(at).getTimezoneOffset() / 60;
  return `${zone} (UTC${off >= 0 ? '+' : '−'}${Math.abs(off)})`;
}

/**
 * Pasek stanu pod wykresem: kot (jedna liczba), pokrycie taśmy, LIVE i liczba luk w taśmie. Początek taśmy, liczba
 * transakcji, stan historii, strefa czasu i źródła są w podpowiedzi liczby luk; źródła i licencja wykresu także w stopce
 * strony.
 */
const StatusBar: React.FC<{ store: ProStore; series: CandleSeries; needs: readonly DataSource[]; narrow: boolean; cat?: React.ReactNode }> = ({
  store,
  series,
  needs,
  narrow,
  cat,
}) => {
  const st = store.replay ? REPLAY_STATUS : (STATUS[store.status] ?? STATUS.idle);
  const first = store.coverage.first();
  const gaps = Math.max(0, store.coverage.list().length - 1);
  const details = [
    `${tr('Taśma', 'Tape')} ${Number.isFinite(first) ? tr(`od ${fmtSince(first, Date.now())}`, `since ${fmtSince(first, Date.now())}`) : '—'}`,
    `${tr('Transakcje', 'Trades')}: ${numLang(store.tape.count.toLocaleString('en-US'))}`,
    ...(series.loadingOlder ? [tr('Historia: wczytywanie…', 'History: loading…')] : []),
    ...(series.historyExhausted ? [tr('Historia: limit API (najwyżej 5000 ostatnich świec interwału)', 'History: API limit (at most the last 5000 candles of the timeframe)')] : []),
    tzLabel(store.replay ? store.replay.now() : Date.now()),
    `${tr('Dane', 'Data')}: Hyperliquid · ${tr('Wykres', 'Chart')}: TradingView Lightweight Charts™`,
    tr(
      'Footprint, Delta i CVD liczymy z taśmy transakcji Hyperliquid nagrywanej od otwarcia tej strony i z zapisu serwera z ostatniej doby — API nie udostępnia historii transakcji. Świece (OHLC i wolumen) pochodzą z pełnej historii API.',
      "Footprint, Delta and CVD are computed from the Hyperliquid trade tape recorded since this page opened and from the server's recording of the last day — the API does not provide trade history. Candles (OHLC and volume) come from the full API history."
    ),
  ].join('\n');
  return (
    // Kot poza przewijaną częścią: zawsze widoczny, a jego dymek nie jest przycinany
    <div className={`relative flex items-center shrink-0 border-t border-line ${cat ? 'h-8' : 'h-7'}`}>
      {cat}
      {/* Legenda pokrycia poza przewijaną częścią, żeby jej okienko nie było przycinane */}
      <CoverageLegend store={store} needs={needs} narrow={narrow} />
      <div className="flex flex-1 min-w-0 items-center gap-x-3 px-2 sm:px-3 h-full font-mono text-[10px] text-ink-2 whitespace-nowrap overflow-hidden">
        <Badge tone={st.tone} title={st.title}>
          {st.text}
        </Badge>
        <span tabIndex={0} title={details} aria-label={`${tr('luki', 'gaps')}: ${gaps}. ${details}`} className={`rounded px-0.5 outline-none focus-visible:ring-2 focus-visible:ring-accent ${gaps > 0 ? 'text-warn' : 'text-ink-3'}`}>
          {tr('luki', 'gaps')}: {gaps}
          {series.loadingOlder && <span className="text-ink-3"> · …</span>}
        </span>
      </div>
    </div>
  );
};
