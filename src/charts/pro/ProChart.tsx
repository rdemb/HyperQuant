import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Bell, BellOff, BellPlus, Camera, ChevronDown, ChevronsRight, Columns2, Copy, Grid2x2, History, Keyboard, Layers, Link, ListOrdered, Maximize2, Minimize2, Minus, MoreHorizontal, PenTool, RotateCcw, SlidersHorizontal, Square, X } from 'lucide-react';
import { Badge, BadgeTone, Segmented, numLang } from '../../ui';
import { LiqMapState, useLiqMap } from '../../state/useLiqMap';
import { usePublished } from '../../state/usePublished';
import { type WhaleLayer, isWhaleLayer } from '../../utils/whaleLayer';
import { INTERVALS, fmtHm, fmtSince, intervalById } from './core/time';
import { DEFAULT_THRESHOLD_USD, classify } from './core/clashes';
import { hlTick } from './core/footprintBar';
import { indicatorScope, liqLevels } from './core/indicators';
import type { AggressorOrder } from './core/orders';
import type { ResetMode } from './core/sessions';
import { tpoInterval } from './core/tpo';
import { VENUE_GROUPS } from './core/stats';
import { type PaneKey, ProChartController, type ScaleState } from './chart/controller';
import { DomLadder, PickCard, TapePanel, compact } from './chart/FlowPanels';
import { HoverSignal, Legend } from './chart/Legend';
import { LOT_FLOOR, type LiquidityPick } from './chart/liquidity';
import { brandedScreenshot, downloadCanvas } from './chart/screenshot';
import { MAX_ALERTS, type PriceAlert, addAlert, alertBook, alertLog, askNotifications, lastSeen, lineLabel, markSeen, primeAlertSound, removeAlert } from './chart/alerts';
import { type LinkAlarm, linkAlerts, parseAlarmLink } from './chart/alarmLink';
import { AlarmLinkCard, type AlertDraft, AlertsMenu } from './chart/AlertsMenu';
import { onAlertEvents, startAlertWatch } from './chart/alertWatch';
import { DEFAULT_TTL_MS, defaultDir, eventText } from '../../utils/alertRules';
import { fmtPx, priceDigits } from './chart/layout';
import { ChartLayout, ChartSettings, NARROW_QUERY, PHONE_PANES, PhonePane, hashFor, isNarrow, loadSettings, phoneSettings, saveSettings, settingsFromHash } from './chart/settings';
import { STATIONS, Station, StationId, stationKey, stationPanel } from './chart/stations';
import { BUILT_IN_TEMPLATES, ChartTemplate, applyTemplate, loadTemplates, saveAs, saveTemplates } from './chart/templates';
import { NumbersCard, StatGroupPicker } from './chart/NumbersCard';
import { MarketStateBar } from './chart/MarketStateBar';
import { SchrodiLauncher } from '../../components/schrodi/SchrodiLauncher';
import { type ChartPalette, PALETTE, setPalette } from './chart/palette';
import type { ChartView } from './chart/footprintSeries';
import type { FootprintStyle } from './chart/layout';
import { DrawHint, DrawMenu, DrawStyleBar, DrawToolbar } from './draw/DrawToolbar';
import { TOOLS } from './draw/model';
import { type DrawingTools, isTyping } from './draw/tools';
import { CandleSeries, MARKETS, Market, ProStore, storeFor } from './store/proStore';
import { startRecording } from './store/recording';
import { ReplayBar } from './replay/ReplayBar';
import { type ReplayLink, linkPatch, parseReplayLink, replayHash } from './replay/link';
import { type ReplaySession, replayBase } from './replay/session';
import { lang, tr } from '../../i18n';

const MARKET_OPTIONS = MARKETS.map((m) => ({ value: m, label: m, title: `${m}-PERP · Hyperliquid` }));
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

/** Zmiana z linku albo przełącznika rynku; wysokość wiersza w USD nie pasuje do rynku o innej cenie — wtedy automatyczna. */
const withPatch = (s: ChartSettings, p: Partial<ChartSettings>): ChartSettings => ({ ...s, ...p, rowStep: p.coin && p.coin !== s.coin ? 0 : s.rowStep });

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

const LAYOUT_OPTIONS: { value: ChartLayout; label: React.ReactNode; title: string }[] = [
  { value: 1, label: <Square className="w-3.5 h-3.5" />, title: tr('Jeden wykres', 'One chart') },
  { value: 2, label: <Columns2 className="w-3.5 h-3.5" />, title: tr('Dwa wykresy obok siebie', 'Two charts side by side') },
  { value: 4, label: <Grid2x2 className="w-3.5 h-3.5" />, title: tr('Cztery wykresy (2 × 2)', 'Four charts (2 × 2)') },
];

const PALETTE_OPTIONS: { value: ChartPalette; label: string }[] = [
  { value: 'neon', label: 'Neon' },
  { value: 'desk', label: 'Desk' },
];

/** Zakładki menu Wskaźniki: linie i warstwy na wykresie ceny albo panele pod nim. */
type IndicatorsTab = 'price' | 'panes';
const INDICATOR_TABS: { id: IndicatorsTab; label: string }[] = [
  { id: 'price', label: tr('Na wykresie ceny', 'On the price chart') },
  { id: 'panes', label: tr('Pod wykresem', 'Below the chart') },
];

/** Karty na telefonie: jedna naraz, więc wykres ma cały ekran. */
type PhoneTab = 'chart' | 'tape' | 'dom' | 'numbers';
const PHONE_TABS: { id: PhoneTab; label: string }[] = [
  { id: 'chart', label: tr('Wykres', 'Chart') },
  { id: 'tape', label: tr('Taśma', 'Tape') },
  { id: 'dom', label: 'DOM' },
  { id: 'numbers', label: tr('Liczby', 'Numbers') },
];

/** Stacja na telefonie: lista w pasku wykresu zamiast osobnego rzędu nad nim, przywrócenie wzorca w menu „Więcej”. */
export interface PhoneStation {
  value: StationId;
  options: readonly { value: StationId; label: string }[];
  onChange: (id: StationId) => void;
  onRestore: () => void;
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

export const subscribeNarrow = (fn: () => void) => {
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
};

function initialSettings(panel: number, station: Station, coin: Market | null, fromLink: boolean): ChartSettings {
  const narrow = isNarrow();
  const pattern = stationPanel(station, panel, narrow);
  // Panel spoza wzorca stacji bez zapisu: wygląd pierwszego panelu, wyższy interwał, bez tablicy i taśmy (mniej miejsca)
  const base =
    panel < station.panels.length
      ? pattern
      : { ...loadSettings(stationKey(station.id, 0), stationPanel(station, 0, narrow)), interval: pattern.interval, showStats: false, showTape: false };
  let s = loadSettings(stationKey(station.id, panel), base);
  // Link do widoku (#charts?m=…&i=…&v=…) ma pierwszeństwo przed zapisanymi ustawieniami pierwszego panelu
  if (panel === 0 && fromLink) s = withPatch(s, settingsFromHash(window.location.hash));
  // Rynek zostaje przy zmianie stacji
  return coin ? withPatch(s, { coin }) : s;
}

/** Odświeżanie paska stanu i paska narzędzi z magazynu — najwyżej co `ms` (taśma bywa bardzo szybka). */
function useStoreVersion(store: ProStore, ms: number): number {
  const ref = useRef({ version: store.version, last: 0, timer: 0 as ReturnType<typeof setTimeout> | 0 });
  const subscribe = useCallback(
    (notify: () => void) => {
      const st = ref.current;
      const unsub = store.subscribe(() => {
        if (st.timer) return;
        const wait = Math.max(0, st.last + ms - Date.now());
        st.timer = setTimeout(() => {
          st.timer = 0;
          st.last = Date.now();
          st.version = store.version;
          notify();
        }, wait);
      });
      return () => {
        unsub();
        if (st.timer) clearTimeout(st.timer);
        st.timer = 0;
      };
    },
    [store, ms]
  );
  return useSyncExternalStore(subscribe, () => ref.current.version);
}

/**
 * Wykres Pro: Lightweight Charts (TradingView) z footprintem, wolumenem, Deltą i CVD z taśmy Hyperliquid.
 * `panel` — miejsce w układzie kilku wykresów: pierwszy prowadzi link do widoku, alerty i przełącznik układu.
 * `station` — stacja robocza (wzorzec i zapis ustawień), `coin` — rynek przeniesiony z poprzedniej stacji,
 * `fromLink` — pierwsze otwarcie wykresów, więc link do widoku w adresie strony ma pierwszeństwo.
 * `replay` — powtórka nagrania zamiast rynku na żywo: ustawienia nie są zapisywane, adres strony zostaje linkiem powtórki.
 * `layoutFs` — pełny ekran całego układu kilku wykresów (przycisk pełnego ekranu i klawisz F obejmują wtedy wszystkie panele).
 */
export const ProChart: React.FC<{
  panel?: number;
  layout?: ChartLayout;
  onLayout?: (l: ChartLayout) => void;
  station?: Station;
  coin?: Market | null;
  fromLink?: boolean;
  phoneStation?: PhoneStation;
  replay?: ProChartReplay;
  layoutFs?: { active: boolean; toggle: () => void };
}> = ({ panel = 0, layout = 1, onLayout, station = STATIONS[0], coin = null, fromLink = true, phoneStation, replay, layoutFs }) => {
  const [settings, setSettings] = useState<ChartSettings>(() => {
    if (!replay) return initialSettings(panel, station, coin, fromLink);
    // Link ze stacją (lekcja) — sam wzorzec stacji, bez zmian zapisanych przez oglądającego
    const base = replay.link.station ? stationPanel(station, panel, isNarrow()) : initialSettings(panel, station, coin, false);
    return withPatch(base, linkPatch(replay.link));
  });
  const inReplay = replay !== undefined;
  const store = replay ? replay.store : storeFor(settings.coin);
  const series = store.series(settings.interval);
  const [menu, setMenu] = useState<'settings' | 'indicators' | 'alerts' | 'keys' | 'more' | null>(null);
  const [indicatorsTab, setIndicatorsTab] = useState<IndicatorsTab>('price');
  const [fullscreen, setFullscreen] = useState(false);
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow);
  const [tab, setTab] = useState<PhoneTab>('chart');
  const [tools, setTools] = useState<DrawingTools | null>(null);
  // Kliknięty bąbel, seria albo ściana i podświetlony adres biorcy (tylko w pamięci strony)
  const [pick, setPick] = useState<LiquidityPick | null>(null);
  const [highlight, setHighlight] = useState('');
  // Pasek rysowania: na komputerze widoczny od razu, na telefonie po dotknięciu przycisku (więcej miejsca na wykres)
  const [drawOpen, setDrawOpen] = useState(() => window.innerWidth >= 640);
  // Menu pod prawym przyciskiem (punkt w pikselach wykresu i cena w tym punkcie), alerty cenowe, krótki komunikat
  const [ctxMenu, setCtxMenu] = useState<CtxMenuAt | null>(null);
  const alerts = useSyncExternalStore(alertBook.subscribe, alertBook.get);
  const log = useSyncExternalStore(alertLog.subscribe, alertLog.get);
  // Cena z wykresu dla formularza alarmu i chwila ostatniego obejrzenia historii (kropka na dzwonku)
  const [alertDraft, setAlertDraft] = useState<AlertDraft | null>(null);
  const [seen, setSeen] = useState(lastSeen);
  const freshAlert = log.some((e) => e.type === 'fire' && e.at > seen);
  // Zestaw alarmów z linku (czytany przed pierwszym przepisaniem adresu na link do widoku)
  const [linkSet, setLinkSet] = useState<LinkAlarm[] | null>(() => (panel === 0 && !inReplay ? parseAlarmLink(window.location.hash) : null));
  const [toast, setToast] = useState<string | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<ProChartController | null>(null);
  const [scale, setScale] = useState<ScaleState>({ auto: true, width: 0, height: 0 });
  const legendBottom = useRef(0);
  const signal = useMemo(() => new HoverSignal(), []);
  const liq = useLiqMap();
  const whalePub = usePublished('whales.json', isWhaleLayer);
  // Wieloryby i mapa likwidacji to stan na teraz — w powtórce ich nie ma
  const whales = !inReplay && whalePub.value && Date.now() - whalePub.value.asOf < WHALES_STALE_MS ? whalePub.value : null;
  useStoreVersion(store, 400);

  const update = useCallback((patch: Partial<ChartSettings>) => setSettings((s) => ({ ...s, ...patch })), []);
  const live = useRef({ replay, settings });
  live.current = { replay, settings };
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
    const ctrl = new ProChartController(host, store, series, shownSettings(settings, isNarrow(), layout, inReplay), signal.set, setPick, (key) => {
      update({ [key]: false });
      setToast(tr(`Ukryto panel: ${PANE_NAMES[key]} — włączysz go w menu Wskaźniki → Pod wykresem`, `Panel hidden: ${PANE_NAMES[key]} — turn it back on in Indicators → Below the chart`));
    }, setScale);
    ctrl.setPhone(isNarrow());
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
  }, [store, signal, update]);

  useEffect(() => {
    // Telefon i układ 2 × 2 chowają część paneli — zapisane ustawienia wracają na szerszym ekranie albo w mniejszym układzie
    ctrlRef.current?.setPhone(narrow);
    ctrlRef.current?.applySettings(shownSettings(settings, narrow, layout, inReplay));
    if (!inReplay) saveSettings(settings, stationKey(station.id, panel));
  }, [settings, panel, layout, station, narrow, inReplay]);

  useEffect(() => {
    ctrlRef.current?.highlight(highlight);
  }, [highlight]);

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

  // Alarmy działają na cenie na żywo — w powtórce bez ich linii
  useEffect(() => {
    ctrlRef.current?.setAlerts(store.replay ? [] : alerts.filter((a) => a.coin === store.coin && a.kind !== 'squeeze').map((a) => ({ price: a.price, title: lineLabel(a), armed: a.armed || a.streak > 0 })));
  }, [alerts, store]);

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

  // Klastry likwidacji tylko z aktualnej mapy skanera (jak w Desku: nieaktualna mapa nie jest pokazywana); skaner mapuje BTC
  useEffect(() => {
    const fresh = liq.map && (liq.status === 'ready' || liq.status === 'delayed') && store.coin === 'BTC' && !store.replay;
    ctrlRef.current?.setLiqLevels(fresh ? liqLevels(liq.map!) : []);
  }, [liq.map, liq.status, store]);

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

  const screenshot = () => {
    const ctrl = ctrlRef.current;
    const host = hostRef.current;
    if (!ctrl || !host) return;
    const iv = intervalById(settings.interval);
    const when = new Date();
    const mode = settings.view === 'footprint' ? 'Footprint' : tr('Świece', 'Candles');
    const img = brandedScreenshot(ctrl.chart.takeScreenshot(true), host.clientWidth, `${store.coin}-PERP · Hyperliquid · ${iv.label} · ${mode}`, when);
    const stamp = `${when.getFullYear()}${String(when.getMonth() + 1).padStart(2, '0')}${String(when.getDate()).padStart(2, '0')}-${fmtHm(when.getTime()).replace(':', '')}`;
    downloadCanvas(img, `hyperquant-${store.coin.toLowerCase()}-${iv.id}-${stamp}.png`);
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
  const twoRow = layout > 1;
  // Wykres pobiera dane Binance i Bybit (panele giełd albo ich grupa w tablicy) — tylko wtedy Stan rynku je porównuje
  const shown = shownSettings(settings, narrow, layout, inReplay);
  const venueOn = shown.showVenueCvd || shown.showVenueOi || (shown.showStats && shown.statGroups.some((g) => VENUE_GROUPS.includes(g)));
  const tapeSince = store.coverage.first();
  const bigUsd = ctrlRef.current?.bigTradeUsd ?? DEFAULT_THRESHOLD_USD;
  const tick = hlTick(store.lastPrice());

  // Skróty wykresu bez modyfikatorów: tylko w panelu, w którym ostatnio kliknięto, i nie w polu tekstowym
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  onKeyRef.current = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || !tools?.isFocused) return;
    const next = e.key.length === 1 ? INTERVALS['12345678'.indexOf(e.key)] : undefined;
    if (e.key === '?') setMenu((m) => (m === 'keys' ? null : 'keys'));
    else if (next) update({ interval: next.id });
    else if (e.key === 'End') ctrlRef.current?.scrollToNow();
    else {
      const k = e.key.toLowerCase();
      if (k === 'c') update({ view: settings.view === 'footprint' ? 'candles' : 'footprint' });
      else if (k === 't') update({ showTape: !settings.showTape });
      else if (k === 'm') setCoin(MARKETS[(MARKETS.indexOf(settings.coin) + 1) % MARKETS.length]);
      else if (k === 'r') ctrlRef.current?.resetScales();
      else if (k === 'a') ctrlRef.current?.setAutoScale(!scale.auto);
      else if (k === 'f') (layoutFs?.toggle ?? toggleFullscreen)();
      else return;
    }
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
      className={`relative flex flex-col bg-surface-1 border border-line-strong overflow-hidden ${
        fullscreen
          ? 'w-full h-full'
          : layoutFs?.active
            ? 'rounded-xl h-full min-h-0'
            : layout === 4
            ? 'rounded-xl h-[calc((100dvh-12.5rem)/2)] min-h-[380px]'
            : 'rounded-xl h-[calc(100dvh-11.75rem)] sm:h-[calc(100dvh-16.5rem)] lg:h-[calc(100dvh-12rem)] min-h-[440px]'
      }`}
    >
      {/* Pasek narzędzi: w układzie kilku wykresów przełączniki zawijane, narzędzia w drugim wierszu */}
      {!narrow && (
        <div className={`flex flex-wrap ${twoRow ? '' : 'sm:flex-nowrap'} items-center gap-x-2 gap-y-1 px-2 sm:px-3 py-1.5 border-b border-line min-h-11`}>
          {/* Przełączniki zawijają się, gdy wykres jest węższy (np. z taśmą obok) — wcześniej ostatni („Bid × Ask”) chował się za krawędzią */}
          <div className={`flex flex-wrap items-center gap-2 gap-y-1 w-full ${twoRow ? '' : 'sm:w-auto sm:flex-1'} min-w-0`}>
            <Segmented<Market> ariaLabel={tr('Rynek', 'Market')} value={settings.coin} onChange={setCoin} options={MARKET_OPTIONS} />
            <Segmented<string> ariaLabel={tr('Interwał wykresu', 'Chart timeframe')} value={settings.interval} onChange={(v) => update({ interval: v })} options={INTERVAL_OPTIONS} />
            <Segmented<ChartView> ariaLabel={tr('Rodzaj wykresu', 'Chart type')} value={settings.view} onChange={(v) => update({ view: v })} options={VIEW_OPTIONS} />
            {settings.view === 'footprint' && (
              <Segmented<FootprintStyle> ariaLabel={tr('Styl footprintu', 'Footprint style')} value={settings.fpStyle} onChange={(v) => update({ fpStyle: v })} options={STYLE_OPTIONS} />
            )}
          </div>
          <div className={`flex items-center justify-end gap-1 w-full ${twoRow ? '' : 'sm:w-auto'} shrink-0`}>
            <button
              type="button"
              data-menu-toggle
              aria-expanded={menu === 'indicators'}
              title={tr('Wskaźniki: na wykresie ceny i pod nim', 'Indicators: on the price chart and below it')}
              onClick={() => setMenu((m) => (m === 'indicators' ? null : 'indicators'))}
              className={`mr-auto ${twoRow ? '' : 'sm:mr-0'} inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg border text-xs font-medium transition-colors duration-150 ${
                menu === 'indicators' ? 'bg-surface-3 text-ink-1 border-line-strong' : 'text-ink-2 border-line hover:text-ink-1 hover:bg-surface-2'
              }`}
            >
              <Layers className="w-4 h-4" />
              {tr('Wskaźniki', 'Indicators')}
            </button>
            <ToolBtn label={drawOpen ? tr('Ukryj narzędzia rysowania', 'Hide drawing tools') : tr('Narzędzia rysowania', 'Drawing tools')} onClick={() => setDrawOpen((o) => !o)} active={drawOpen}>
              <PenTool className="w-4 h-4" />
            </ToolBtn>
            <ToolBtn
              label={settings.showTape ? tr('Ukryj taśmę zleceń', 'Hide order tape') : tr('Taśma zleceń', 'Order tape')}
              className="hidden sm:inline-flex"
              onClick={() => update({ showTape: !settings.showTape })}
              active={settings.showTape}
            >
              <ListOrdered className="w-4 h-4" />
            </ToolBtn>
            {!inReplay && (
              <ToolBtn label={tr('Alarmy cenowe', 'Price alerts')} onClick={() => (menu === 'alerts' ? setMenu(null) : openAlerts(null))} active={menu === 'alerts'} expanded={menu === 'alerts'}>
                <BellBadge count={alerts.length} fresh={freshAlert} />
              </ToolBtn>
            )}
            <ToolBtn label={tr('Ustawienia wykresu', 'Chart settings')} onClick={() => setMenu((m) => (m === 'settings' ? null : 'settings'))} active={menu === 'settings'} expanded={menu === 'settings'}>
              <SlidersHorizontal className="w-4 h-4" />
            </ToolBtn>
            {/* Układ kilku wykresów tylko na szerokim ekranie */}
            {onLayout && (
              <div className="hidden lg:inline-flex shrink-0 mr-1">
                <Segmented<ChartLayout> ariaLabel={tr('Układ wykresów', 'Chart layout')} value={layout} onChange={onLayout} options={LAYOUT_OPTIONS} />
              </div>
            )}
            <ToolBtn label={tr('Przewiń do bieżącej świecy', 'Scroll to the current candle')} onClick={() => ctrlRef.current?.scrollToNow()}>
              <ChevronsRight className="w-4 h-4" />
            </ToolBtn>
            <ToolBtn label={tr('Przywróć skalę', 'Reset scale')} onClick={() => ctrlRef.current?.resetScales()}>
              <RotateCcw className="w-4 h-4" />
            </ToolBtn>
            {canReplay && (
              <ToolBtn label={tr('Powtórka nagranej doby', 'Replay of the recorded day')} className="hidden sm:inline-flex" onClick={openReplay}>
                <History className="w-4 h-4" />
              </ToolBtn>
            )}
            <ToolBtn label={inReplay ? tr('Kopiuj link do tej chwili', 'Copy link to this moment') : tr('Kopiuj link do widoku', 'Copy view link')} className="hidden sm:inline-flex" onClick={copyLink}>
              <Link className="w-4 h-4" />
            </ToolBtn>
            <ToolBtn label={tr('Zrzut ekranu (PNG)', 'Screenshot (PNG)')} onClick={screenshot}>
              <Camera className="w-4 h-4" />
            </ToolBtn>
            <ToolBtn
              label={tr('Skróty klawiszowe (?)', 'Keyboard shortcuts (?)')}
              className="hidden lg:inline-flex"
              onClick={() => setMenu((m) => (m === 'keys' ? null : 'keys'))}
              active={menu === 'keys'}
              expanded={menu === 'keys'}
            >
              <Keyboard className="w-4 h-4" />
            </ToolBtn>
            {layoutFs ? (
              <ToolBtn
                label={layoutFs.active ? tr('Zamknij pełny ekran', 'Exit full screen') : tr('Pełny ekran układu: wszystkie wykresy (F)', 'Full screen layout: all charts (F)')}
                onClick={layoutFs.toggle}
              >
                {layoutFs.active ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </ToolBtn>
            ) : (
              <ToolBtn label={fullscreen ? tr('Zamknij pełny ekran', 'Exit full screen') : tr('Pełny ekran (F)', 'Full screen (F)')} onClick={toggleFullscreen}>
                {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </ToolBtn>
            )}
          </div>
        </div>
      )}

      {/* Telefon: dwa rzędy — stacja, rynek, interwał i rodzaj wykresu; karty, wskaźniki, ustawienia i „Więcej” */}
      {narrow && (
        <div className="flex flex-col gap-1.5 px-2 py-1.5 border-b border-line shrink-0">
          <div className="flex items-center gap-1 min-w-0 overflow-x-auto [scrollbar-width:none]">
            {phoneStation && <PhoneSelect<StationId> ariaLabel={tr('Stacja robocza', 'Workstation')} value={phoneStation.value} options={phoneStation.options} onChange={phoneStation.onChange} />}
            <PhoneSelect<Market> ariaLabel={tr('Rynek', 'Market')} value={settings.coin} options={MARKET_OPTIONS} onChange={setCoin} />
            <PhoneSelect<string> ariaLabel={tr('Interwał wykresu', 'Chart timeframe')} value={settings.interval} options={INTERVAL_OPTIONS} onChange={(v) => update({ interval: v })} />
            <PhoneSelect<ChartView> ariaLabel={tr('Rodzaj wykresu', 'Chart type')} value={settings.view} options={VIEW_OPTIONS} onChange={(v) => update({ view: v })} />
          </div>
          <div className="flex items-center gap-1">
            <div role="tablist" aria-label={tr('Widok wykresu', 'Chart view')} className="grid grid-cols-4 gap-0.5 flex-1 min-w-0 p-0.5 rounded-lg border border-line">
              {PHONE_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={`h-8 rounded-md text-xs font-medium transition-colors duration-150 ${
                    tab === t.id ? 'bg-surface-3 text-ink-1 shadow-[inset_0_0_0_1px_var(--color-line-strong)]' : 'text-ink-3 hover:text-ink-1'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <ToolBtn label={tr('Wskaźniki: na wykresie ceny i pod nim', 'Indicators: on the price chart and below it')} onClick={() => setMenu((m) => (m === 'indicators' ? null : 'indicators'))} active={menu === 'indicators'} expanded={menu === 'indicators'}>
              <Layers className="w-4 h-4" />
            </ToolBtn>
            {!inReplay && (
              <ToolBtn label={tr('Alarmy cenowe', 'Price alerts')} onClick={() => (menu === 'alerts' ? setMenu(null) : openAlerts(null))} active={menu === 'alerts'} expanded={menu === 'alerts'}>
                <BellBadge count={alerts.length} fresh={freshAlert} />
              </ToolBtn>
            )}
            <ToolBtn label={tr('Ustawienia wykresu', 'Chart settings')} onClick={() => setMenu((m) => (m === 'settings' ? null : 'settings'))} active={menu === 'settings'} expanded={menu === 'settings'}>
              <SlidersHorizontal className="w-4 h-4" />
            </ToolBtn>
            <ToolBtn label={tr('Więcej: rysowanie, skala, zrzut, link, pełny ekran', 'More: drawing, scale, screenshot, link, full screen')} onClick={() => setMenu((m) => (m === 'more' ? null : 'more'))} active={menu === 'more'} expanded={menu === 'more'}>
              <MoreHorizontal className="w-4 h-4" />
            </ToolBtn>
          </div>
        </div>
      )}

      {replay && <ReplayBar session={replay.session} narrow={narrow} onExit={replay.onExit} />}

      {/* Stan rynku: zdanie z faktów nad wykresem (w układzie 2 × 2 za mało miejsca) */}
      {settings.showState && layout !== 4 && (
        <MarketStateBar
          store={store}
          series={series}
          venueOn={venueOn}
          narrow={narrow}
          onClose={() => {
            update({ showState: false });
            setToast(tr('Ukryto Stan rynku — włączysz go w Ustawieniach wykresu → Nad wykresem', 'Market state hidden — turn it back on in Chart settings → Above the chart'));
          }}
        />
      )}

      {/* Wykres z paskiem rysowania po lewej i taśmą zleceń po prawej (na telefonie taśma, DOM i liczby to karty) */}
      <div className="relative flex flex-1 min-h-0">
        <DrawToolbar tools={tools} className={drawOpen ? 'flex' : 'hidden'} />
        <div className="relative flex-1 min-h-0 min-w-0" onContextMenu={onContextMenu}>
          <div ref={hostRef} className="absolute inset-0" />
          <AutoScaleBtn scale={scale} onToggle={() => ctrlRef.current?.setAutoScale(!scale.auto)} />
          <Legend signal={signal} intervalMs={iv.ms} intervalLabel={iv.label} tapeSince={tapeSince} coin={store.coin} onBottom={onLegendBottom} compact={narrow} multi={layout > 1} />
          <DrawStyleBar tools={tools} onAlert={drawAlert} />
          <DrawMenu tools={tools} onAlert={drawAlert} />
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
            <NumbersCard store={store} series={series} groups={settings.statGroups} onGroups={(g) => update({ statGroups: g })} className="absolute inset-0 z-20" />
          )}
          {ctxMenu && (
            <ChartMenu
              ref={ctxRef}
              at={ctxMenu}
              coin={store.coin}
              nearAlert={alerts.find((a) => a.coin === store.coin && a.kind !== 'squeeze' && Math.abs((ctrlRef.current?.yOf(a.price) ?? -1e9) - ctxMenu.y) <= 8) ?? null}
              onClose={() => setCtxMenu(null)}
              onAlert={addTouch}
              onAlertMore={(p) => openAlerts({ price: toTick(p), kind: 'close' })}
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
            <div ref={menuRef} className="absolute top-2 right-2 z-30 w-[min(340px,calc(100%-16px))] max-h-[calc(100%-16px)] overflow-y-auto">
              {menu === 'settings' ? (
                <SettingsMenu
                  settings={settings}
                  bigUsd={bigUsd}
                  tick={tick}
                  onChange={update}
                  onReset={() => setSettings({ ...stationPanel(station, panel, isNarrow()), coin: settings.coin, interval: settings.interval })}
                  narrow={narrow}
                />
              ) : menu === 'alerts' ? (
                <AlertsMenu key={alertDraft ? `${alertDraft.price}-${alertDraft.kind}` : 'new'} coin={store.coin} price={store.lastPrice()} draft={alertDraft} serverNow={() => store.serverNow()} />
              ) : menu === 'keys' ? (
                <KeysMenu />
              ) : menu === 'more' ? (
                <MoreMenu
                  items={[
                    { icon: PenTool, label: drawOpen ? tr('Ukryj narzędzia rysowania', 'Hide drawing tools') : tr('Narzędzia rysowania', 'Drawing tools'), on: () => setDrawOpen((o) => !o) },
                    { icon: ChevronsRight, label: tr('Przewiń do bieżącej świecy', 'Scroll to the current candle'), on: () => ctrlRef.current?.scrollToNow() },
                    { icon: RotateCcw, label: tr('Przywróć skalę', 'Reset scale'), on: () => ctrlRef.current?.resetScales() },
                    { icon: Camera, label: tr('Zrzut ekranu (PNG)', 'Screenshot (PNG)'), on: screenshot },
                    ...(canReplay ? [{ icon: History, label: tr('Powtórka nagranej doby', 'Replay of the recorded day'), on: openReplay }] : []),
                    { icon: Link, label: inReplay ? tr('Kopiuj link do tej chwili', 'Copy link to this moment') : tr('Kopiuj link do widoku', 'Copy view link'), on: copyLink },
                    { icon: fullscreen ? Minimize2 : Maximize2, label: fullscreen ? tr('Zamknij pełny ekran', 'Exit full screen') : tr('Pełny ekran', 'Full screen'), on: toggleFullscreen },
                    ...(phoneStation ? [{ icon: RotateCcw, label: tr(`Przywróć wzorzec stacji ${station.name}`, `Restore the ${station.name} workstation preset`), on: phoneStation.onRestore }] : []),
                  ]}
                  onClose={() => setMenu(null)}
                />
              ) : (
                <IndicatorsMenu
                  settings={settings}
                  intervalMs={iv.ms}
                  liq={liq}
                  whales={whales}
                  bigUsd={bigUsd}
                  tab={indicatorsTab}
                  onTab={setIndicatorsTab}
                  grid4={layout === 4}
                  narrow={narrow}
                  onChange={update}
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
      <StatusBar store={store} series={series} cat={panel === 0 && !inReplay ? <SchrodiLauncher className="shrink-0 pl-1 sm:pl-1.5" /> : null} />
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
          <Check label={tr('Wolumen', 'Volume')} checked={s.showVolume} onChange={(v) => onChange({ showVolume: v })} />
          <Check label={tr('Delta (świece delty)', 'Delta (delta candles)')} checked={s.showDelta} onChange={(v) => onChange({ showDelta: v })} />
          <Check label="CVD" checked={s.showCvd} onChange={(v) => onChange({ showCvd: v })} />
          <Check label={tr('CVD giełd: Hyperliquid, Binance, Bybit', 'Exchange CVD: Hyperliquid, Binance, Bybit')} checked={s.showVenueCvd} onChange={(v) => onChange({ showVenueCvd: v })} />
          <Check label={tr('ΔOI i funding giełd', 'Exchange ΔOI and funding')} checked={s.showVenueOi} onChange={(v) => onChange({ showVenueOi: v })} />
          <Check label={tr('Tablica liczb', 'Numbers table')} checked={s.showStats} onChange={(v) => onChange({ showStats: v })} />
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
}: {
  ariaLabel: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <span className="relative inline-flex shrink-0">
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="appearance-none h-8 pl-2 pr-5 rounded-md border border-line bg-surface-2 text-xs font-medium text-ink-1"
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

/** Menu „Więcej” na telefonie: rzadziej używane przyciski paska narzędzi. */
const MoreMenu: React.FC<{ items: { icon: React.ComponentType<{ className?: string }>; label: string; on: () => void }[]; onClose: () => void }> = ({ items, onClose }) => (
  <div role="menu" aria-label={tr('Więcej', 'More')} className="bg-surface-2 border border-line-strong rounded-xl p-1.5 shadow-2xl flex flex-col text-xs">
    {items.map(({ icon: Icon, label, on }) => (
      <button
        key={label}
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          on();
        }}
        className="flex items-center gap-2.5 min-h-10 px-2.5 rounded-lg text-left text-ink-1 hover:bg-surface-3 transition-colors duration-150"
      >
        <Icon className="w-4 h-4 text-ink-3 shrink-0" />
        {label}
      </button>
    ))}
  </div>
);

const ToolBtn: React.FC<{ label: string; onClick: () => void; children: React.ReactNode; active?: boolean; expanded?: boolean; className?: string }> = ({
  label,
  onClick,
  children,
  active,
  expanded,
  className = 'inline-flex',
}) => (
  <button
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

/** Dzwonek alarmów: liczba aktywnych i kropka przy zdarzeniu, którego jeszcze nie obejrzano. */
const BellBadge: React.FC<{ count: number; fresh: boolean }> = ({ count, fresh }) => (
  <span className="relative inline-flex">
    <Bell className={`w-4 h-4 ${fresh ? 'text-warn' : ''}`} />
    {count > 0 && (
      <span className="absolute -top-1.5 -right-2 min-w-3.5 h-3.5 px-0.5 rounded-full bg-warn text-page text-[9px] leading-[14px] font-semibold text-center tabular-nums">{count}</span>
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
    onClose: () => void;
    onAlert: (price: number) => void;
    onAlertMore: (price: number) => void;
    onRemoveAlert: (a: PriceAlert) => void;
    onLine: () => void;
    onCopyPrice: (price: number) => void;
    onCopyLink: () => void;
    onNow: () => void;
    onReset: () => void;
    onShot: () => void;
  }
>(({ at, coin, nearAlert, onClose, onAlert, onAlertMore, onRemoveAlert, onLine, onCopyPrice, onCopyLink, onNow, onReset, onShot }, ref) => {
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
}> = ({ settings: s, bigUsd, tick, onChange, onReset, narrow }) => (
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
    </Group>
    <Group title={tr('Kolory', 'Colours')}>
      <div className="flex flex-col items-start">
        <Segmented<ChartPalette> ariaLabel={tr('Paleta wykresów', 'Chart palette')} value={PALETTE} onChange={setPalette} options={PALETTE_OPTIONS} />
      </div>
      <p className="text-[11px] leading-snug text-ink-3">
        {tr(
          'Neon: zieleń i fiolet na grafitowym tle. Desk: morska zieleń i miedź na granatowym. Dla wszystkich wykresów; zmiana przeładowuje stronę.',
          'Neon: green and violet on graphite. Desk: sea green and copper on navy. For all charts; changing it reloads the page.'
        )}
      </p>
    </Group>
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
    </Group>
    <Templates settings={s} onApply={onChange} />
    <button
      type="button"
      onClick={onReset}
      title={tr('Ustawienia tego wykresu jak we wzorcu stacji; rynek i interwał zostają', "Sets this chart as in the workstation preset; market and timeframe stay")}
      className="self-start min-h-9 px-3 rounded-lg border border-line-strong text-ink-2 hover:text-ink-1 hover:bg-surface-3"
    >
      {tr('Przywróć wzorzec stacji', 'Restore workstation preset')}
    </button>
  </div>
);

type IndicatorKey =
  | 'showHeatmap'
  | 'showBubbles'
  | 'showClashes'
  | 'showLots'
  | 'showVwap'
  | 'showVwapBands'
  | 'showSessionVwap'
  | 'showProfile'
  | 'showPeriodProfiles'
  | 'showDevPoc'
  | 'showTpo'
  | 'showLevels'
  | 'showSessions'
  | 'showIb'
  | 'showLiq'
  | 'showWhales'
  | 'showZones'
  | 'showAuctions';

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

/** Plik wielorybów starszy niż tyle (ms) nie jest pokazywany. */
const WHALES_STALE_MS = 20 * 60_000;

function whaleHint(w: WhaleLayer | null, coin: string): string {
  const m = w?.markets[coin];
  if (!w || !m) return tr('Skaner nie publikuje teraz warstwy wielorybów — linie ukryte', 'The scanner is not publishing the whale layer right now — lines hidden');
  return tr(
    `${m.positions.length} pozycji od ${compact(w.minPositionUsd[coin] ?? 0)} USD i ${m.orders.length} zleceń od ${compact(w.minOrderUsd[coin] ?? 0)} USD · ${w.accounts} kont · stan z ${fmtHm(w.asOf)}`,
    `${m.positions.length} positions from ${compact(w.minPositionUsd[coin] ?? 0)} USD and ${m.orders.length} orders from ${compact(w.minOrderUsd[coin] ?? 0)} USD · ${w.accounts} accounts · as of ${fmtHm(w.asOf)}`
  );
}

/**
 * Wskaźniki w dwóch zakładkach: na wykresie ceny (przełączniki z kolorem linii — menu jest zarazem legendą — i zakresem
 * interwałów) oraz panele pod wykresem.
 */
const IndicatorsMenu: React.FC<{
  settings: ChartSettings;
  intervalMs: number;
  liq: LiqMapState;
  whales: WhaleLayer | null;
  bigUsd: number;
  tab: IndicatorsTab;
  onTab: (t: IndicatorsTab) => void;
  /** Układ 2 × 2: tabela statystyk ukryta. */
  grid4: boolean;
  narrow: boolean;
  onChange: (p: Partial<ChartSettings>) => void;
}> = ({
  settings: s,
  intervalMs,
  liq,
  whales,
  bigUsd,
  tab,
  onTab,
  grid4,
  narrow,
  onChange,
}) => {
  const big = `${compact(bigUsd)} USD${s.bigTradeUsd === 0 ? tr(' (próg automatyczny)', ' (automatic threshold)') : ''}`;
  const scope = indicatorScope(intervalMs);
  const items: { key: IndicatorKey; label: string; hint: string; swatch: string; off?: string }[] = [
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
        'Seria (przerywany pierścień): drobne zlecenia co najmniej 4 adresów po jednej stronie w 2 s, razem od progu. Ściana (belka): jeden maker na jednej cenie przyjął od progu z co najmniej 3 zleceń — od otwarcia strony, a z zapisem serwera z ostatniej doby',
        "Burst (dashed ring): small orders from at least 4 addresses on one side within 2 s, together above the threshold. Wall (bar): one maker at one price absorbed above the threshold from at least 3 orders — since the page opened, plus the server's recording of the last day"
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
    },
    {
      key: 'showVwapBands',
      label: tr('Pasma VWAP ±1σ i ±2σ', 'VWAP bands ±1σ and ±2σ'),
      hint: tr('Odchylenie standardowe ceny od VWAP ważone wolumenem', 'Volume-weighted standard deviation of price from VWAP'),
      swatch: 'bg-of-vwap/40',
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
      label: tr('TPO — profil czasowy doby', 'TPO — time profile of the day'),
      hint: tr(
        'Litery 30-minutowych okresów doby UTC w każdym wierszu ceny: POC, value area, initial balance (pasek turkusowy), pojedyncze wydruki i ogony; zastępuje profile sesji',
        'Letters of the 30-minute periods of the UTC day in every price row: POC, value area, initial balance (turquoise bar), single prints and tails; replaces session profiles'
      ),
      swatch: 'bg-of-svwap',
      off: tpoInterval(intervalMs) ? undefined : tr('Na interwałach do 30m', 'On timeframes up to 30m'),
    },
    {
      key: 'showLevels',
      label: tr('Poziomy dnia', 'Daily levels'),
      hint: tr('PDH i PDL — szczyt i dołek poprzedniego dnia UTC — oraz otwarcie dnia (00:00 UTC)', "PDH and PDL — the previous UTC day's high and low — and the daily open (00:00 UTC)"),
      swatch: 'bg-level',
      off: scope.levels ? undefined : tr('Na interwałach poniżej 1D', 'On timeframes below 1D'),
    },
    {
      key: 'showSessions',
      label: tr('Otwarcia sesji', 'Session opens'),
      hint: tr('Azja 00:00 UTC, Londyn 08:00 i Nowy Jork 09:30 czasu lokalnego giełd', 'Asia 00:00 UTC, London 08:00 and New York 09:30 exchange local time'),
      swatch: 'bg-ink-3/60',
      off: scope.sessions ? undefined : tr('Na interwałach do 1h', 'On timeframes up to 1h'),
    },
    {
      key: 'showIb',
      label: 'Initial balance',
      hint: tr('Zakres pierwszej godziny każdej sesji i rozszerzenia 1,5× i 2×', 'The range of the first hour of each session and its 1.5× and 2× extensions'),
      swatch: 'bg-series-1',
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
        `Seria co najmniej ${s.stackedMin || 3} wierszy z nierównowagą po jednej stronie, ciągnięta w prawo, aż cena przejdzie przez strefę — ze świec z taśmą`,
        `A run of at least ${s.stackedMin || 3} rows with an imbalance on one side, extended right until price trades through the zone — from candles with a tape`
      ),
      swatch: 'bg-gradient-to-r from-of-imb-buy to-of-imb-sell',
      off: s.stackedMin > 1 ? undefined : tr('Włącz strefy stacked w ustawieniach footprintu', 'Turn on stacked zones in the footprint settings'),
    },
    {
      key: 'showAuctions',
      label: tr('Niedokończone aukcje', 'Unfinished auctions'),
      hint: tr(
        'Szczyt albo dołek świecy z kupnem i sprzedażą agresorów (UA), do powrotu ceny — ze świec w całości nagranych',
        'A candle high or low with both aggressor buying and selling (UA), until price returns — from fully recorded candles'
      ),
      swatch: 'bg-warn',
    },
  ];
  const all = items.every((i) => s[i.key]);
  return (
    <div className="bg-surface-2 border border-line-strong rounded-xl p-3 shadow-2xl flex flex-col gap-1 text-xs">
      <div role="tablist" aria-label={tr('Wskaźniki', 'Indicators')} className="grid grid-cols-2 gap-0.5 p-0.5 mb-2 rounded-lg border border-line">
        {INDICATOR_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => onTab(t.id)}
            className={`h-8 rounded-md text-xs font-medium transition-colors duration-150 ${
              tab === t.id ? 'bg-surface-3 text-ink-1 shadow-[inset_0_0_0_1px_var(--color-line-strong)]' : 'text-ink-3 hover:text-ink-1'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'panes' ? (
        <PanesTab s={s} grid4={grid4} narrow={narrow} onChange={onChange} />
      ) : (
        <>
          <div className="flex justify-end mb-1">
            <button
              type="button"
              onClick={() => onChange(Object.fromEntries(items.map((i) => [i.key, !all])) as Partial<ChartSettings>)}
              className="min-h-8 px-2.5 rounded-md border border-line-strong text-ink-2 hover:text-ink-1 hover:bg-surface-3"
            >
              {all ? tr('Wyłącz wszystkie', 'Turn all off') : tr('Włącz wszystkie', 'Turn all on')}
            </button>
          </div>
          {items.map((i) => (
            <label key={i.key} className={`flex items-start gap-2.5 py-1.5 cursor-pointer ${i.off ? 'opacity-55' : ''}`}>
              <input type="checkbox" checked={s[i.key]} onChange={(e) => onChange({ [i.key]: e.target.checked })} className="mt-0.5 w-4 h-4 accent-accent shrink-0" />
              <span className="flex flex-col gap-0.5 min-w-0">
                <span className="flex items-center gap-2 text-ink-1">
                  <span className={`inline-block w-3.5 h-[3px] rounded-full ${i.swatch}`} aria-hidden="true" />
                  {i.label}
                </span>
                <span className="text-[11px] leading-snug text-ink-3">{i.off ?? i.hint}</span>
              </span>
            </label>
          ))}
        </>
      )}
    </div>
  );
};

/** Szablony: wbudowane i własne (z bieżących ustawień), nakładane bez zmiany rynku. */
const Templates: React.FC<{ settings: ChartSettings; onApply: (s: ChartSettings) => void }> = ({ settings, onApply }) => {
  const [own, setOwn] = useState<ChartTemplate[]>(loadTemplates);
  const [pick, setPick] = useState(BUILT_IN_TEMPLATES[0].id);
  const [name, setName] = useState('');
  const all = [...BUILT_IN_TEMPLATES, ...own];
  const chosen = all.find((t) => t.id === pick) ?? all[0];
  const store = (list: ChartTemplate[]) => {
    setOwn(list);
    saveTemplates(list);
  };
  const btn = 'inline-flex items-center h-9 px-2.5 rounded-lg border border-line-strong bg-surface-3 font-medium text-ink-1 disabled:opacity-40';
  return (
    <Group title={tr('Szablony', 'Templates')}>
      <div className="flex items-center gap-1.5">
        <select
          aria-label={tr('Szablon', 'Template')}
          value={chosen.id}
          onChange={(e) => setPick(e.target.value)}
          className="min-w-0 flex-1 h-9 bg-page border border-line rounded-md px-2 text-ink-1"
        >
          <optgroup label={tr('Wbudowane', 'Built-in')}>
            {BUILT_IN_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </optgroup>
          {own.length > 0 && (
            <optgroup label={tr('Własne', 'Your own')}>
              {own.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button type="button" className={btn} onClick={() => onApply(applyTemplate(settings, chosen.s))}>
          {tr('Zastosuj', 'Apply')}
        </button>
        {!chosen.builtIn && (
          <button
            type="button"
            aria-label={tr(`Usuń szablon ${chosen.name}`, `Delete template ${chosen.name}`)}
            onClick={() => {
              store(own.filter((t) => t.id !== chosen.id));
              setPick(BUILT_IN_TEMPLATES[0].id);
            }}
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-surface-3"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
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
      ['1 … 8', `${tr('Interwał', 'Timeframe')}: ${INTERVALS.map((i) => i.label).join(', ')}`],
      ['C', tr('Świece ↔ footprint', 'Candles ↔ footprint')],
      ['M', `${tr('Następny rynek', 'Next market')} (${MARKETS.join(', ')})`],
      ['T', tr('Taśma zleceń', 'Order tape')],
      ['R', tr('Przywróć skalę', 'Reset scale')],
      ['A', tr('Autoskala ceny: włącz / zamroź zakres', 'Price autoscale: on / freeze the range')],
      ['End', tr('Przewiń do bieżącej świecy', 'Scroll to the current candle')],
      ['F', tr('Pełny ekran (przy kilku wykresach: cały układ)', 'Full screen (with several charts: the whole layout)')],
      ['?', tr('Ta lista', 'This list')],
      ['Esc', tr('Zamknij menu, przerwij rysowanie', 'Close menu, cancel drawing')],
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

/** Pasek stanu: połączenie, zakres taśmy i luki, liczba transakcji, strefa czasu, źródła i licencja wykresu. */
const StatusBar: React.FC<{ store: ProStore; series: CandleSeries; cat?: React.ReactNode }> = ({ store, series, cat }) => {
  const st = store.replay ? REPLAY_STATUS : (STATUS[store.status] ?? STATUS.idle);
  const first = store.coverage.first();
  const gaps = Math.max(0, store.coverage.list().length - 1);
  return (
    // Kot poza przewijaną częścią: zawsze widoczny, a jego dymek nie jest przycinany
    <div className={`flex items-center shrink-0 border-t border-line ${cat ? 'h-8' : 'h-7'}`}>
      {cat}
      <div className="flex flex-1 min-w-0 items-center gap-x-3.5 px-2 sm:px-3 h-full font-mono text-[10px] text-ink-2 whitespace-nowrap overflow-x-auto [scrollbar-width:none]">
        <Badge tone={st.tone} title={st.title}>
          {st.text}
        </Badge>
        <span
          title={tr(
            'Footprint, Delta i CVD liczymy z taśmy transakcji Hyperliquid nagrywanej od otwarcia tej strony i z zapisu serwera z ostatniej doby — API nie udostępnia historii transakcji. Świece (OHLC i wolumen) pochodzą z pełnej historii API.',
            "Footprint, Delta and CVD are computed from the Hyperliquid trade tape recorded since this page opened and from the server's recording of the last day — the API does not provide trade history. Candles (OHLC and volume) come from the full API history."
          )}
        >
          {tr('Taśma', 'Tape')} {Number.isFinite(first) ? tr(`od ${fmtSince(first, Date.now())}`, `since ${fmtSince(first, Date.now())}`) : '—'}
          {gaps > 0 && (
            <span className="text-warn">
              {' '}
              · {tr('luki', 'gaps')}: {gaps}
            </span>
          )}
        </span>
        <span>
          {tr('Transakcje', 'Trades')}: {numLang(store.tape.count.toLocaleString('en-US'))}
        </span>
        {series.loadingOlder && <span>{tr('Historia: wczytywanie…', 'History: loading…')}</span>}
        {series.historyExhausted && (
          <span title={tr('Hyperliquid udostępnia najwyżej 5000 ostatnich świec każdego interwału', 'Hyperliquid provides at most the last 5000 candles of each timeframe')}>
            {tr('Historia: limit API', 'History: API limit')}
          </span>
        )}
        <span className="text-ink-3">{tzLabel(store.replay ? store.replay.now() : Date.now())}</span>
        <span className="ml-auto text-ink-3">
          {tr('Dane', 'Data')}: Hyperliquid · {tr('Wykres', 'Chart')}:{' '}
          <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer" className="underline decoration-line-strong hover:text-ink-1">
            TradingView Lightweight Charts™
          </a>
        </span>
      </div>
    </div>
  );
};
