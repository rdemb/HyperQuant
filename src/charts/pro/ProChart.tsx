import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Bell, BellOff, Camera, ChevronsRight, Columns2, Copy, Grid2x2, Keyboard, Layers, Link, ListOrdered, Maximize2, Minimize2, Minus, PenTool, RotateCcw, SlidersHorizontal, Square, X } from 'lucide-react';
import { Badge, BadgeTone, Segmented } from '../../ui';
import { LiqMapState, useLiqMap } from '../../state/useLiqMap';
import { INTERVALS, fmtHm, fmtSince, intervalById } from './core/time';
import { DEFAULT_THRESHOLD_USD, classify } from './core/clashes';
import { hlTick } from './core/footprintBar';
import { indicatorScope, liqLevels } from './core/indicators';
import type { AggressorOrder } from './core/orders';
import type { ResetMode } from './core/sessions';
import { tpoInterval } from './core/tpo';
import { type PaneKey, ProChartController } from './chart/controller';
import { PickCard, TapePanel, compact } from './chart/FlowPanels';
import { HoverSignal, Legend } from './chart/Legend';
import { LOT_FLOOR, type LiquidityPick } from './chart/liquidity';
import { brandedScreenshot, downloadCanvas } from './chart/screenshot';
import { MAX_ALERTS, PriceAlert, alertBook, askNotifications, newAlert, notifyAlert, parsePriceInput, primeAlertSound, reached } from './chart/alerts';
import { fmtPx, priceDigits } from './chart/layout';
import { ChartLayout, ChartSettings, DEFAULT_SETTINGS, hashFor, loadSettings, panelKey, saveSettings, settingsFromHash } from './chart/settings';
import { BUILT_IN_TEMPLATES, ChartTemplate, applyTemplate, loadTemplates, saveAs, saveTemplates } from './chart/templates';
import type { ChartView } from './chart/footprintSeries';
import type { FootprintStyle } from './chart/layout';
import { DrawHint, DrawStyleBar, DrawToolbar } from './draw/DrawToolbar';
import { TOOLS } from './draw/model';
import { type DrawingTools, isTyping } from './draw/tools';
import { CandleSeries, MARKETS, Market, ProStore, openStores, storeFor } from './store/proStore';
import { startRecording } from './store/recording';

const MARKET_OPTIONS = MARKETS.map((m) => ({ value: m, label: m, title: `${m}-PERP · Hyperliquid` }));
const INTERVAL_OPTIONS = INTERVALS.map((i) => ({ value: i.id, label: i.label }));
const VIEW_OPTIONS: { value: ChartView; label: string; title: string }[] = [
  { value: 'candles', label: 'Świece', title: 'Same świece (OHLC z API Hyperliquid)' },
  { value: 'footprint', label: 'Footprint', title: 'Footprint z taśmy: profil w świecy, a po zbliżeniu liczby w każdym wierszu ceny' },
];
const STYLE_OPTIONS: { value: FootprintStyle; label: string; title: string }[] = [
  { value: 'bidask', label: 'Bid × Ask', title: 'Sprzedaż agresywna (uderza w bid) × kupno agresywne (zdejmuje ask) w każdym wierszu' },
  { value: 'delta', label: 'Delta', title: 'Delta wiersza: kupno − sprzedaż agresorów' },
  { value: 'volume', label: 'Wolumen', title: 'Łączny wolumen wiersza' },
];

/** Zmiana z linku albo przełącznika rynku; wysokość wiersza w USD nie pasuje do rynku o innej cenie — wtedy automatyczna. */
const withPatch = (s: ChartSettings, p: Partial<ChartSettings>): ChartSettings => ({ ...s, ...p, rowStep: p.coin && p.coin !== s.coin ? 0 : s.rowStep });

/** Cena zaokrąglona do ticku rynku. */
const toTick = (p: number) => Number(p.toFixed(priceDigits(p)));

/** Interwał nowego panelu układu (bez zapisanych ustawień): kolejne panele pokazują wyższe interwały. */
const PANEL_INTERVALS = ['5m', '15m', '1h', '4h'];
const PANE_NAMES: Record<PaneKey, string> = { showVolume: 'Wolumen', showDelta: 'Delta', showCvd: 'CVD', showStats: 'Statystyki świec' };

const LAYOUT_OPTIONS: { value: ChartLayout; label: React.ReactNode; title: string }[] = [
  { value: 1, label: <Square className="w-3.5 h-3.5" />, title: 'Jeden wykres' },
  { value: 2, label: <Columns2 className="w-3.5 h-3.5" />, title: 'Dwa wykresy obok siebie' },
  { value: 4, label: <Grid2x2 className="w-3.5 h-3.5" />, title: 'Cztery wykresy (2 × 2)' },
];

function initialSettings(panel: number): ChartSettings {
  // Link do widoku (#charts?m=…&i=…&v=…) ma pierwszeństwo przed zapisanymi ustawieniami pierwszego panelu
  if (panel === 0) return withPatch(loadSettings(), settingsFromHash(window.location.hash));
  // Nowy panel: wygląd pierwszego, wyższy interwał, bez tabeli i taśmy (mniej miejsca)
  const base = { ...loadSettings(), interval: PANEL_INTERVALS[panel] ?? '1h', showStats: false, showTape: false };
  return loadSettings(panelKey(panel), base);
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
 */
export const ProChart: React.FC<{ panel?: number; layout?: ChartLayout; onLayout?: (l: ChartLayout) => void }> = ({ panel = 0, layout = 1, onLayout }) => {
  const [settings, setSettings] = useState<ChartSettings>(() => initialSettings(panel));
  const store = storeFor(settings.coin);
  const series = store.series(settings.interval);
  const [menu, setMenu] = useState<'settings' | 'indicators' | 'keys' | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [tools, setTools] = useState<DrawingTools | null>(null);
  // Kliknięty bąbel, seria albo ściana i podświetlony adres biorcy (tylko w pamięci strony)
  const [pick, setPick] = useState<LiquidityPick | null>(null);
  const [highlight, setHighlight] = useState('');
  // Pasek rysowania: na komputerze widoczny od razu, na telefonie po dotknięciu przycisku (więcej miejsca na wykres)
  const [drawOpen, setDrawOpen] = useState(() => window.innerWidth >= 640);
  // Menu pod prawym przyciskiem (punkt w pikselach wykresu i cena w tym punkcie), alerty cenowe, krótki komunikat
  const [ctxMenu, setCtxMenu] = useState<CtxMenuAt | null>(null);
  const alerts = useSyncExternalStore(alertBook.subscribe, alertBook.get);
  const [toast, setToast] = useState<string | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<ProChartController | null>(null);
  const legendBottom = useRef(0);
  const signal = useMemo(() => new HoverSignal(), []);
  const liq = useLiqMap();
  useStoreVersion(store, 400);

  const update = useCallback((patch: Partial<ChartSettings>) => setSettings((s) => ({ ...s, ...patch })), []);
  const setCoin = useCallback((coin: Market) => {
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
    startRecording(store);
    ctrlRef.current?.setSeries(series);
  }, [store, series]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ctrl = new ProChartController(host, store, series, settings, signal.set, setPick, (key) => {
      update({ [key]: false });
      setToast(`Ukryto panel: ${PANE_NAMES[key]} — włączysz go w Ustawieniach wykresu → Panele`);
    });
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
    // W układzie 2 × 2 panel jest za niski na tabelę statystyk — zapisane ustawienie wraca w mniejszym układzie
    ctrlRef.current?.applySettings(layout === 4 && settings.showStats ? { ...settings, showStats: false } : settings);
    saveSettings(settings, panelKey(panel));
  }, [settings, panel, layout]);

  useEffect(() => {
    ctrlRef.current?.highlight(highlight);
  }, [highlight]);

  // Adres strony zawsze prowadzi do bieżącego widoku — bez nowych wpisów w historii przeglądarki
  useEffect(() => {
    const h = hashFor(settings);
    if (panel === 0 && window.location.hash.startsWith('#charts') && window.location.hash !== h) history.replaceState(history.state, '', h);
  }, [settings, panel]);

  // Wklejony link w tej samej karcie
  useEffect(() => {
    if (panel !== 0) return;
    const onHash = () => {
      const p = settingsFromHash(window.location.hash);
      if (Object.keys(p).length > 0) setSettings((s) => withPatch(s, p));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [panel]);

  useEffect(() => {
    ctrlRef.current?.setAlerts(alerts.filter((a) => a.coin === store.coin).map((a) => a.price));
  }, [alerts, store]);

  // Rynek z alertem ma własny strumień także wtedy, gdy na wykresie jest inny
  useEffect(() => {
    for (const m of MARKETS) if (alerts.some((a) => a.coin === m)) storeFor(m).start();
  }, [alerts]);

  // Alerty cenowe (sprawdza pierwszy panel): co sekundę cena bieżącej świecy każdego rynku otwartego na stronie
  useEffect(() => {
    if (panel !== 0) return;
    const id = setInterval(() => {
      const list = alertBook.get();
      if (list.length === 0) return;
      const fired: PriceAlert[] = [];
      for (const st of openStores()) {
        const px = st.lastPrice();
        if (px > 0) for (const a of list) if (a.coin === st.coin && reached(a, px)) fired.push(a);
      }
      if (fired.length === 0) return;
      alertBook.update((l) => l.filter((a) => !fired.includes(a)));
      for (const a of fired) notifyAlert(`Cena ${a.coin} doszła do ${fmtPx(a.price)}`, a.id);
      setToast(`Alert: cena ${fired[0].coin} doszła do ${fmtPx(fired[0].price)}`);
    }, 1000);
    return () => clearInterval(id);
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
    // Na telefonie taśma zasłania wykres — po wyborze zlecenia chowamy ją, żeby było widać kartę i bąbel
    if (window.innerWidth < 640) update({ showTape: false });
  }, [update]);

  const closePick = useCallback(() => {
    ctrlRef.current?.select(null);
    setPick(null);
  }, []);

  // Klastry likwidacji tylko z aktualnej mapy skanera (jak w Desku: nieaktualna mapa nie jest pokazywana); skaner mapuje BTC
  useEffect(() => {
    const fresh = liq.map && (liq.status === 'ready' || liq.status === 'delayed') && store.coin === 'BTC';
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
    const mode = settings.view === 'footprint' ? 'Footprint' : 'Świece';
    const img = brandedScreenshot(ctrl.chart.takeScreenshot(true), host.clientWidth, `${store.coin}-PERP · Hyperliquid · ${iv.label} · ${mode}`, when);
    const stamp = `${when.getFullYear()}${String(when.getMonth() + 1).padStart(2, '0')}${String(when.getDate()).padStart(2, '0')}-${fmtHm(when.getTime()).replace(':', '')}`;
    downloadCanvas(img, `hyperquant-${store.coin.toLowerCase()}-${iv.id}-${stamp}.png`);
  };

  const copy = (text: string, done: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => setToast(done),
      () => setToast('Nie udało się skopiować — skopiuj adres strony z paska przeglądarki')
    );
  };

  const addAlert = (price: number) => {
    const last = store.lastPrice() || price;
    alertBook.update((l) => [...l, newAlert(store.coin, price, last)].slice(-MAX_ALERTS));
    primeAlertSound();
    askNotifications();
    setToast(`Alert przy ${fmtPx(price)} (${store.coin}) — działa, gdy strona jest otwarta`);
  };

  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    // Tylko na samym wykresie (legenda, karty i menu mają własne zachowanie)
    if (!hostRef.current?.contains(e.target as Node)) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const raw = ctrlRef.current?.priceAt(y) ?? null;
    // Menu otwiera się w lewo i w górę tylko wtedy, gdy nie mieści się przy prawej lub dolnej krawędzi
    setCtxMenu({ x, y, price: raw === null ? null : toTick(raw), left: x > r.width - 248, up: y > r.height - 340 });
  };

  const iv = intervalById(settings.interval);
  const twoRow = layout > 1;
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
      else if (k === 'f') toggleFullscreen();
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
          : layout === 4
            ? 'rounded-xl h-[calc((100dvh-10rem)/2)] min-h-[380px]'
            : 'rounded-xl h-[calc(100dvh-14rem)] lg:h-[calc(100dvh-9.5rem)] min-h-[440px]'
      }`}
    >
      {/* Pasek narzędzi: na telefonie i w układzie kilku wykresów przełączniki przewijane w pierwszym wierszu, narzędzia w drugim */}
      <div className={`flex flex-wrap ${twoRow ? '' : 'sm:flex-nowrap'} items-center gap-x-2 gap-y-1 px-2 sm:px-3 py-1.5 border-b border-line min-h-11`}>
        <div className={`flex items-center gap-2 w-full ${twoRow ? '' : 'sm:w-auto sm:flex-1'} min-w-0 overflow-x-auto [scrollbar-width:none]`}>
          <Segmented<Market> ariaLabel="Rynek" value={settings.coin} onChange={setCoin} options={MARKET_OPTIONS} />
          <Segmented<string> ariaLabel="Interwał wykresu" value={settings.interval} onChange={(v) => update({ interval: v })} options={INTERVAL_OPTIONS} />
          <Segmented<ChartView> ariaLabel="Rodzaj wykresu" value={settings.view} onChange={(v) => update({ view: v })} options={VIEW_OPTIONS} />
          {settings.view === 'footprint' && (
            <Segmented<FootprintStyle> ariaLabel="Styl footprintu" value={settings.fpStyle} onChange={(v) => update({ fpStyle: v })} options={STYLE_OPTIONS} />
          )}
        </div>
        <div className={`flex items-center justify-end gap-1 w-full ${twoRow ? '' : 'sm:w-auto'} shrink-0`}>
          <button
            type="button"
            data-menu-toggle
            aria-expanded={menu === 'indicators'}
            title="Wskaźniki na wykresie ceny"
            onClick={() => setMenu((m) => (m === 'indicators' ? null : 'indicators'))}
            className={`mr-auto ${twoRow ? '' : 'sm:mr-0'} inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg border text-xs font-medium transition-colors duration-150 ${
              menu === 'indicators' ? 'bg-surface-3 text-ink-1 border-line-strong' : 'text-ink-2 border-line hover:text-ink-1 hover:bg-surface-2'
            }`}
          >
            <Layers className="w-4 h-4" />
            Wskaźniki
          </button>
          <ToolBtn label={drawOpen ? 'Ukryj narzędzia rysowania' : 'Narzędzia rysowania'} onClick={() => setDrawOpen((o) => !o)} active={drawOpen}>
            <PenTool className="w-4 h-4" />
          </ToolBtn>
          <ToolBtn label={settings.showTape ? 'Ukryj taśmę zleceń' : 'Taśma zleceń'} onClick={() => update({ showTape: !settings.showTape })} active={settings.showTape}>
            <ListOrdered className="w-4 h-4" />
          </ToolBtn>
          <ToolBtn label="Ustawienia wykresu" onClick={() => setMenu((m) => (m === 'settings' ? null : 'settings'))} active={menu === 'settings'} expanded={menu === 'settings'}>
            <SlidersHorizontal className="w-4 h-4" />
          </ToolBtn>
          {/* Układ kilku wykresów tylko na szerokim ekranie */}
          {onLayout && (
            <div className="hidden lg:inline-flex shrink-0 mr-1">
              <Segmented<ChartLayout> ariaLabel="Układ wykresów" value={layout} onChange={onLayout} options={LAYOUT_OPTIONS} />
            </div>
          )}
          <ToolBtn label="Przewiń do bieżącej świecy" onClick={() => ctrlRef.current?.scrollToNow()}>
            <ChevronsRight className="w-4 h-4" />
          </ToolBtn>
          <ToolBtn label="Przywróć skalę" onClick={() => ctrlRef.current?.resetScales()}>
            <RotateCcw className="w-4 h-4" />
          </ToolBtn>
          <ToolBtn label="Kopiuj link do widoku" className="hidden sm:inline-flex" onClick={() => copy(window.location.href, 'Skopiowano link do widoku')}>
            <Link className="w-4 h-4" />
          </ToolBtn>
          <ToolBtn label="Zrzut ekranu (PNG)" onClick={screenshot}>
            <Camera className="w-4 h-4" />
          </ToolBtn>
          <ToolBtn
            label="Skróty klawiszowe (?)"
            className="hidden lg:inline-flex"
            onClick={() => setMenu((m) => (m === 'keys' ? null : 'keys'))}
            active={menu === 'keys'}
            expanded={menu === 'keys'}
          >
            <Keyboard className="w-4 h-4" />
          </ToolBtn>
          <ToolBtn label={fullscreen ? 'Zamknij pełny ekran' : 'Pełny ekran'} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </ToolBtn>
        </div>
      </div>

      {/* Wykres z paskiem rysowania po lewej i taśmą zleceń po prawej (na telefonie taśma nad wykresem) */}
      <div className="relative flex flex-1 min-h-0">
        <DrawToolbar tools={tools} className={drawOpen ? 'flex' : 'hidden'} />
        <div className="relative flex-1 min-h-0 min-w-0" onContextMenu={onContextMenu}>
          <div ref={hostRef} className="absolute inset-0" />
          <Legend signal={signal} intervalMs={iv.ms} intervalLabel={iv.label} tapeSince={tapeSince} coin={store.coin} onBottom={onLegendBottom} />
          <DrawStyleBar tools={tools} />
          <DrawHint tools={tools} />
          <LoadOverlay series={series} onRetry={() => void series.load(true)} />
          {ctxMenu && (
            <ChartMenu
              ref={ctxRef}
              at={ctxMenu}
              coin={store.coin}
              nearAlert={alerts.find((a) => a.coin === store.coin && Math.abs((ctrlRef.current?.yOf(a.price) ?? -1e9) - ctxMenu.y) <= 8) ?? null}
              onClose={() => setCtxMenu(null)}
              onAlert={addAlert}
              onRemoveAlert={(a) => alertBook.update((l) => l.filter((x) => x !== a))}
              onLine={() => tools?.addHorizontal(ctxMenu.x, ctxMenu.y)}
              onCopyPrice={(p) => copy(fmtPx(p).replace(/,/g, ''), `Skopiowano cenę ${fmtPx(p)}`)}
              onCopyLink={() => copy(window.location.href, 'Skopiowano link do widoku')}
              onNow={() => ctrlRef.current?.scrollToNow()}
              onReset={() => ctrlRef.current?.resetScales()}
              onShot={screenshot}
            />
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
                  price={store.lastPrice()}
                  alerts={alerts}
                  onAddAlert={(p) => addAlert(toTick(p))}
                  onRemoveAlert={(a) => alertBook.update((l) => l.filter((x) => x !== a))}
                  onChange={update}
                  onReset={() => setSettings({ ...DEFAULT_SETTINGS, coin: settings.coin, interval: settings.interval })}
                  grid4={layout === 4}
                />
              ) : menu === 'keys' ? (
                <KeysMenu />
              ) : (
                <IndicatorsMenu settings={settings} intervalMs={iv.ms} liq={liq} bigUsd={bigUsd} onChange={update} />
              )}
            </div>
          )}
        </div>
        {settings.showTape && (
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

      <StatusBar store={store} series={series} />
    </div>
  );
};

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

/** Miejsce otwarcia menu wykresu i cena pod kursorem (null poza panelem ceny). */
interface CtxMenuAt {
  x: number;
  y: number;
  price: number | null;
  left: boolean;
  up: boolean;
}

/** Menu pod prawym przyciskiem (na telefonie przytrzymanie): alert i linia przy cenie, kopiowanie, widok. */
const ChartMenu = React.forwardRef<
  HTMLDivElement,
  {
    at: CtxMenuAt;
    coin: string;
    nearAlert: PriceAlert | null;
    onClose: () => void;
    onAlert: (price: number) => void;
    onRemoveAlert: (a: PriceAlert) => void;
    onLine: () => void;
    onCopyPrice: (price: number) => void;
    onCopyLink: () => void;
    onNow: () => void;
    onReset: () => void;
    onShot: () => void;
  }
>(({ at, coin, nearAlert, onClose, onAlert, onRemoveAlert, onLine, onCopyPrice, onCopyLink, onNow, onReset, onShot }, ref) => {
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
      aria-label="Menu wykresu"
      style={{ left: at.x, top: at.y, transform: `translate(${at.left ? '-100%' : '0'}, ${at.up ? '-100%' : '0'})` }}
      className="absolute z-40 w-60 rounded-xl border border-line-strong bg-surface-2 p-1.5 text-xs shadow-2xl"
    >
      {p !== null && (
        <>
          <div className="px-2.5 pt-1 pb-1.5 font-mono text-[11px] text-ink-3">
            {coin} · {fmtPx(p)}
          </div>
          {item(<Bell className="w-4 h-4" />, `Alert przy ${fmtPx(p)}`, () => onAlert(p))}
          {nearAlert && item(<BellOff className="w-4 h-4" />, `Usuń alert ${fmtPx(nearAlert.price)}`, () => onRemoveAlert(nearAlert))}
          {item(<Minus className="w-4 h-4" />, `Linia pozioma przy ${fmtPx(p)}`, onLine)}
          {item(<Copy className="w-4 h-4" />, `Kopiuj cenę ${fmtPx(p)}`, () => onCopyPrice(p))}
          <div className="my-1 border-t border-line" />
        </>
      )}
      {item(<Link className="w-4 h-4" />, 'Kopiuj link do widoku', onCopyLink)}
      {item(<ChevronsRight className="w-4 h-4" />, 'Przewiń do bieżącej świecy', onNow)}
      {item(<RotateCcw className="w-4 h-4" />, 'Przywróć skalę', onReset)}
      {item(<Camera className="w-4 h-4" />, 'Zrzut ekranu (PNG)', onShot)}
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
        <div className="font-medium text-ink-1">{error ? 'Nie udało się pobrać świec z Hyperliquid' : 'Wczytywanie świec…'}</div>
        {error && (
          <>
            <p className="mt-1 text-xs text-ink-3 leading-relaxed">Sprawdź połączenie lub rozszerzenia blokujące żądania do api.hyperliquid.xyz.</p>
            <button type="button" onClick={onRetry} className="mt-2 min-h-9 px-3 rounded-lg bg-surface-3 border border-line-strong text-xs font-medium hover:bg-surface-1">
              Spróbuj ponownie
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
  { value: 'session', label: 'Sesja' },
  { value: 'day', label: 'Doba UTC' },
  { value: 'week', label: 'Tydzień' },
  { value: 'none', label: 'Ciągła' },
];

const BIG_OPTIONS = [0, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];

const SettingsMenu: React.FC<{
  settings: ChartSettings;
  bigUsd: number;
  tick: number;
  price: number;
  alerts: readonly PriceAlert[];
  onAddAlert: (price: number) => void;
  onRemoveAlert: (a: PriceAlert) => void;
  onChange: (p: Partial<ChartSettings>) => void;
  onReset: () => void;
  /** Układ 2 × 2: tabela statystyk ukryta. */
  grid4: boolean;
}> = ({ settings: s, bigUsd, tick, price, alerts, onAddAlert, onRemoveAlert, onChange, onReset, grid4 }) => (
  <div className="bg-surface-2 border border-line-strong rounded-xl p-3 shadow-2xl flex flex-col gap-3 text-xs">
    <Group title="Footprint">
      <Select
        label="Wysokość wiersza"
        value={s.rowStep}
        options={ROW_TICKS.map((m) => Number((m * tick).toPrecision(6)))}
        format={(v) => (v === 0 ? 'Auto' : `${v} USD`)}
        onChange={(v) => onChange({ rowStep: v })}
      />
      <Select
        label="Nierównowaga"
        title="Nierównowaga diagonalna: kupno w wierszu ≥ N × sprzedaż wiersz niżej (i odwrotnie)"
        value={s.imbalanceRatio}
        options={RATIO_OPTIONS}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => onChange({ imbalanceRatio: v })}
      />
      <Select
        label="Min. wartość nierównowagi"
        title={`Wiersz liczy się jako nierównowaga od tej wartości strony przewagi (przeliczane na ${s.coin} po cenie)`}
        value={s.imbalanceMinUsd}
        options={MIN_USD_OPTIONS}
        format={(v) => (v === 0 ? 'Brak' : `${compact(v)} USD`)}
        onChange={(v) => onChange({ imbalanceMinUsd: v })}
      />
      <Select
        label="Strefy stacked"
        title="Co najmniej N kolejnych wierszy z nierównowagą po tej samej stronie"
        value={s.stackedMin}
        options={STACKED_OPTIONS}
        format={(v) => (v === 0 ? 'Wył.' : `od ${v} wierszy`)}
        onChange={(v) => onChange({ stackedMin: v })}
      />
    </Group>
    <Group title="Panele">
      <Check label="Wolumen" checked={s.showVolume} onChange={(v) => onChange({ showVolume: v })} />
      <Check label="Delta (świece delty)" checked={s.showDelta} onChange={(v) => onChange({ showDelta: v })} />
      <Check label="CVD" checked={s.showCvd} onChange={(v) => onChange({ showCvd: v })} />
      <Check label="Statystyki świec (tabela)" checked={s.showStats} onChange={(v) => onChange({ showStats: v })} />
      {grid4 && s.showStats && <p className="text-[11px] leading-snug text-ink-3">W układzie 2 × 2 tabela jest ukryta — panel jest za niski.</p>}
      <div className="flex flex-col items-start gap-1.5">
        <span className="text-ink-2">Zerowanie CVD</span>
        <Segmented<ResetMode> ariaLabel="Zerowanie CVD" value={s.cvdReset} onChange={(v) => onChange({ cvdReset: v })} options={RESET_OPTIONS} />
      </div>
    </Group>
    <Group title="Duże zlecenia">
      <Select
        label="Próg dużego zlecenia"
        title="Auto: kwantyl 98,5% wartości zleceń agresora z ostatniej godziny, zaokrąglony w górę (1, 2, 5 × 10^k)"
        value={s.bigTradeUsd}
        options={BIG_OPTIONS}
        format={(v) => (v === 0 ? (s.bigTradeUsd === 0 ? `Auto (${compact(bigUsd)})` : 'Auto') : `${compact(v)} USD`)}
        onChange={(v) => onChange({ bigTradeUsd: v })}
      />
      <Check label="Dźwięk dużych zleceń (taśma)" checked={s.tapeSound} onChange={(v) => onChange({ tapeSound: v })} />
    </Group>
    <Group title="Alerty cenowe">
      <AlertInput coin={s.coin} price={price} onAdd={onAddAlert} />
      {alerts.length === 0 ? (
        <p className="text-[11px] leading-snug text-ink-3">Albo prawy przycisk na wykresie → „Alert przy …”.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {alerts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 min-h-8">
              <span className="font-mono text-ink-1">
                {a.coin} · {a.dir === 1 ? 'wzrost do' : 'spadek do'} {fmtPx(a.price)}
              </span>
              <button
                type="button"
                aria-label={`Usuń alert ${a.coin} ${fmtPx(a.price)}`}
                onClick={() => onRemoveAlert(a)}
                className="inline-flex items-center justify-center w-8 h-8 rounded-md text-ink-3 hover:text-ink-1 hover:bg-surface-3"
              >
                <X className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] leading-snug text-ink-3">Jednorazowe; działają, gdy strona jest otwarta (dźwięk i powiadomienie przeglądarki po zgodzie).</p>
    </Group>
    <Templates settings={s} onApply={onChange} />
    <button type="button" onClick={onReset} className="self-start min-h-9 px-3 rounded-lg border border-line-strong text-ink-2 hover:text-ink-1 hover:bg-surface-3">
      Przywróć domyślne
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
  | 'showTpo'
  | 'showLevels'
  | 'showSessions'
  | 'showIb'
  | 'showLiq'
  | 'showZones'
  | 'showAuctions';

function liqHint(liq: LiqMapState): string {
  switch (liq.status) {
    case 'ready':
    case 'delayed':
      return `3 największe po każdej stronie ceny · stan z ${fmtHm(liq.map!.asOf)}${liq.status === 'delayed' ? ' (część odczytów starsza niż 15 min)' : ''}`;
    case 'loading':
      return 'Wczytywanie mapy likwidacji…';
    case 'unconfigured':
      return 'Mapa likwidacji niedostępna w tej wersji strony';
    case 'error':
      return 'Nie udało się pobrać mapy likwidacji';
    default:
      return 'Skaner nie publikuje teraz aktualnej mapy — klastry ukryte';
  }
}

/** Wskaźniki na wykresie ceny: przełączniki z kolorem linii (menu jest zarazem legendą) i zakresem interwałów. */
const IndicatorsMenu: React.FC<{ settings: ChartSettings; intervalMs: number; liq: LiqMapState; bigUsd: number; onChange: (p: Partial<ChartSettings>) => void }> = ({
  settings: s,
  intervalMs,
  liq,
  bigUsd,
  onChange,
}) => {
  const big = `${compact(bigUsd)} USD${s.bigTradeUsd === 0 ? ' (próg automatyczny)' : ''}`;
  const scope = indicatorScope(intervalMs);
  const items: { key: IndicatorKey; label: string; hint: string; swatch: string; off?: string }[] = [
    {
      key: 'showHeatmap',
      label: 'Mapa ciepła arkusza',
      hint: 'Płynność zleceń oczekujących w czasie (l2Book Hyperliquid, kubełki BTC ~10 i ~100 USD, innych rynków proporcjonalnie do ceny) — od otwarcia strony',
      swatch: 'bg-gradient-to-r from-of-heat-1 via-of-heat-2 to-of-heat-3',
    },
    {
      key: 'showBubbles',
      label: 'Bąble zleceń agresora',
      hint: `Zlecenia rynkowe od ${big} złożone z wypełnień; pole koła ∝ wartość, podwójny pierścień = bitwa z jednym dużym makerem; kliknij bąbel — od otwarcia strony`,
      swatch: 'bg-gradient-to-r from-of-imb-buy to-of-imb-sell',
    },
    {
      key: 'showClashes',
      label: 'Serie i ściany',
      hint: 'Seria (przerywany pierścień): drobne zlecenia co najmniej 4 adresów po jednej stronie w 2 s, razem od progu. Ściana (belka): jeden maker na jednej cenie przyjął od progu z co najmniej 3 zleceń — od otwarcia strony',
      swatch: 'bg-of-buy',
      off: s.showBubbles ? undefined : 'Razem z bąblami zleceń agresora',
    },
    {
      key: 'showLots',
      label: 'Duże zlecenia w arkuszu',
      hint: `Poziom arkusza, na którym średnie zlecenie jest w 1% największych z ostatnich 30 min tego rynku (co najmniej ${compact(bigUsd * LOT_FLOOR)} USD): linia przez czas, gdy jest w arkuszu (przygaszona po zniknięciu); po 30 s w arkuszu podpis „liczba zleceń × średnia wartość” — od otwarcia strony`,
      swatch: 'bg-gradient-to-r from-of-buy-ink to-of-sell-ink',
    },
    {
      key: 'showVwap',
      label: scope.vwapAnchor === 'week' ? 'VWAP tygodnia' : 'VWAP dnia',
      hint: scope.vwapAnchor === 'week' ? 'Od poniedziałku 00:00 UTC (na świecach dziennych)' : 'Od 00:00 UTC, cena typowa (H+L+C)/3 ważona wolumenem',
      swatch: 'bg-of-vwap',
    },
    { key: 'showVwapBands', label: 'Pasma VWAP ±1σ i ±2σ', hint: 'Odchylenie standardowe ceny od VWAP ważone wolumenem', swatch: 'bg-of-vwap/40' },
    {
      key: 'showSessionVwap',
      label: 'VWAP sesji',
      hint: 'Od otwarcia sesji: Azja, Londyn, Nowy Jork',
      swatch: 'bg-of-svwap',
      off: scope.sessionVwap ? undefined : 'Na interwałach do 30m',
    },
    {
      key: 'showProfile',
      label: 'Profil wolumenu',
      hint: 'Widoczny zakres: POC, value area 70% (VAH, VAL); świece z pełnej taśmy dokładnie po cenach transakcji',
      swatch: 'bg-ink-3',
    },
    {
      key: 'showPeriodProfiles',
      label: scope.periodProfile === 'day' ? 'Profile dób i nagie POC' : 'Profile sesji i nagie POC',
      hint: `Profil każdej ${scope.periodProfile === 'day' ? 'doby UTC' : 'sesji'} od jej początku; POC, którego cena potem nie dotknęła, ciągnie się do prawej krawędzi`,
      swatch: 'bg-of-vol',
      off: scope.periodProfile ? undefined : 'Na interwałach do 4h',
    },
    {
      key: 'showTpo',
      label: 'TPO — profil czasowy doby',
      hint: 'Litery 30-minutowych okresów doby UTC w każdym wierszu ceny: POC, value area, initial balance (pasek turkusowy), pojedyncze wydruki i ogony; zastępuje profile sesji',
      swatch: 'bg-of-svwap',
      off: tpoInterval(intervalMs) ? undefined : 'Na interwałach do 30m',
    },
    {
      key: 'showLevels',
      label: 'Poziomy dnia',
      hint: 'PDH i PDL — szczyt i dołek poprzedniego dnia UTC — oraz otwarcie dnia (00:00 UTC)',
      swatch: 'bg-level',
      off: scope.levels ? undefined : 'Na interwałach poniżej 1D',
    },
    {
      key: 'showSessions',
      label: 'Otwarcia sesji',
      hint: 'Azja 00:00 UTC, Londyn 08:00 i Nowy Jork 09:30 czasu lokalnego giełd',
      swatch: 'bg-ink-3/60',
      off: scope.sessions ? undefined : 'Na interwałach do 1h',
    },
    {
      key: 'showIb',
      label: 'Initial balance',
      hint: 'Zakres pierwszej godziny każdej sesji i rozszerzenia 1,5× i 2×',
      swatch: 'bg-series-1',
      off: scope.ib ? undefined : 'Na interwałach do 30m',
    },
    {
      key: 'showLiq',
      label: 'Klastry likwidacji',
      hint: liqHint(liq),
      swatch: 'bg-gradient-to-r from-of-sell to-of-buy',
      off: s.coin === 'BTC' ? undefined : 'Tylko BTC: skaner mapuje pozycje na BTC',
    },
    {
      key: 'showZones',
      label: 'Strefy nierównowagi',
      hint: `Seria co najmniej ${s.stackedMin || 3} wierszy z nierównowagą po jednej stronie, ciągnięta w prawo, aż cena przejdzie przez strefę — ze świec z taśmą`,
      swatch: 'bg-gradient-to-r from-of-imb-buy to-of-imb-sell',
      off: s.stackedMin > 1 ? undefined : 'Włącz strefy stacked w ustawieniach footprintu',
    },
    {
      key: 'showAuctions',
      label: 'Niedokończone aukcje',
      hint: 'Szczyt albo dołek świecy z kupnem i sprzedażą agresorów (UA), do powrotu ceny — ze świec w całości nagranych',
      swatch: 'bg-warn',
    },
  ];
  const all = items.every((i) => s[i.key]);
  return (
    <div className="bg-surface-2 border border-line-strong rounded-xl p-3 shadow-2xl flex flex-col gap-1 text-xs">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">Wskaźniki</span>
        <button
          type="button"
          onClick={() => onChange(Object.fromEntries(items.map((i) => [i.key, !all])) as Partial<ChartSettings>)}
          className="min-h-8 px-2.5 rounded-md border border-line-strong text-ink-2 hover:text-ink-1 hover:bg-surface-3"
        >
          {all ? 'Wyłącz wszystkie' : 'Włącz wszystkie'}
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
    </div>
  );
};

/** Alert z wpisanej ceny — także na telefonach, na których przytrzymanie nie otwiera menu wykresu. */
const AlertInput: React.FC<{ coin: string; price: number; onAdd: (price: number) => void }> = ({ coin, price, onAdd }) => {
  const [text, setText] = useState('');
  const value = parsePriceInput(text, price);
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (value === null) return;
        onAdd(value);
        setText('');
      }}
    >
      <input
        type="text"
        inputMode="decimal"
        aria-label={`Cena alertu ${coin}`}
        placeholder={price > 0 ? `${coin} · ${fmtPx(price)}` : `Cena ${coin}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-w-0 flex-1 h-9 px-2.5 rounded-lg bg-surface-1 border border-line font-mono text-ink-1 placeholder:text-ink-3 focus:outline-none focus:border-line-strong"
      />
      <button
        type="submit"
        disabled={value === null}
        className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg border border-line-strong bg-surface-3 font-medium text-ink-1 disabled:opacity-40"
      >
        <Bell className="w-3.5 h-3.5" />
        Dodaj
      </button>
    </form>
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
    <Group title="Szablony">
      <div className="flex items-center gap-1.5">
        <select
          aria-label="Szablon"
          value={chosen.id}
          onChange={(e) => setPick(e.target.value)}
          className="min-w-0 flex-1 h-9 bg-page border border-line rounded-md px-2 text-ink-1"
        >
          <optgroup label="Wbudowane">
            {BUILT_IN_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </optgroup>
          {own.length > 0 && (
            <optgroup label="Własne">
              {own.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button type="button" className={btn} onClick={() => onApply(applyTemplate(settings, chosen.s))}>
          Zastosuj
        </button>
        {!chosen.builtIn && (
          <button
            type="button"
            aria-label={`Usuń szablon ${chosen.name}`}
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
          aria-label="Nazwa nowego szablonu"
          placeholder="Nazwa szablonu"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 h-9 px-2.5 rounded-lg bg-surface-1 border border-line text-ink-1 placeholder:text-ink-3 focus:outline-none focus:border-line-strong"
        />
        <button type="submit" disabled={!name.trim()} className={btn}>
          Zapisz bieżące
        </button>
      </form>
      <p className="text-[11px] leading-snug text-ink-3">Interwał, rodzaj wykresu, panele, wskaźniki i warstwy; rynek zostaje.</p>
    </Group>
  );
};

const KEY_GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Wykres',
    keys: [
      ['1 … 8', `Interwał: ${INTERVALS.map((i) => i.label).join(', ')}`],
      ['C', 'Świece ↔ footprint'],
      ['M', `Następny rynek (${MARKETS.join(', ')})`],
      ['T', 'Taśma zleceń'],
      ['R', 'Przywróć skalę'],
      ['End', 'Przewiń do bieżącej świecy'],
      ['F', 'Pełny ekran'],
      ['?', 'Ta lista'],
      ['Esc', 'Zamknij menu, przerwij rysowanie'],
    ],
  },
  {
    title: 'Rysowanie',
    keys: [
      ...TOOLS.filter((t) => t.hotkey).map((t): [string, string] => [`Alt+${t.hotkey}`, t.label]),
      ['Shift + przeciągnij', 'Szybki pomiar'],
      ['Ctrl', 'Odwraca magnes do OHLC'],
      ['Delete', 'Usuń zaznaczony rysunek'],
      ['Ctrl+C / Ctrl+V', 'Kopiuj i wklej rysunek'],
      ['Ctrl+Z / Ctrl+Y', 'Cofnij i ponów'],
    ],
  },
  {
    title: 'Mysz',
    keys: [
      ['Kółko', 'Zbliżenie w czasie'],
      ['Przeciągnij oś ceny', 'Skala ceny'],
      ['Prawy przycisk', 'Alert, linia, cena, zrzut'],
      ['Krzyżyk × przy panelu', 'Ukryj panel pod wykresem'],
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
    <p className="text-[11px] leading-snug text-ink-3">W układzie kilku wykresów skróty trafiają do wykresu, w którym ostatnio kliknięto.</p>
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
  open: { text: 'LIVE', tone: 'live', title: 'Na żywo: WebSocket Hyperliquid połączony' },
  connecting: { text: 'Łączenie', tone: 'stale', title: 'Łączenie z WebSocket Hyperliquid' },
  reconnecting: { text: 'Ponowne łączenie', tone: 'stale', title: 'Połączenie zerwane — łączę ponownie; brakujący czas będzie luką w taśmie' },
  idle: { text: 'Rozłączony', tone: 'neutral', title: 'Strumień nieaktywny' },
};

function tzLabel(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const off = -new Date().getTimezoneOffset() / 60;
  return `${zone} (UTC${off >= 0 ? '+' : '−'}${Math.abs(off)})`;
}

/** Pasek stanu: połączenie, zakres taśmy i luki, liczba transakcji, strefa czasu, źródła i licencja wykresu. */
const StatusBar: React.FC<{ store: ProStore; series: CandleSeries }> = ({ store, series }) => {
  const st = STATUS[store.status] ?? STATUS.idle;
  const first = store.coverage.first();
  const gaps = Math.max(0, store.coverage.list().length - 1);
  return (
    <div className="flex items-center gap-x-3.5 px-2 sm:px-3 h-7 shrink-0 border-t border-line font-mono text-[10px] text-ink-2 whitespace-nowrap overflow-x-auto [scrollbar-width:none]">
      <Badge tone={st.tone} title={st.title}>
        {st.text}
      </Badge>
      <span title="Footprint, Delta i CVD liczymy z taśmy transakcji Hyperliquid nagrywanej od otwarcia tej strony — API nie udostępnia historii transakcji. Świece (OHLC i wolumen) pochodzą z pełnej historii API.">
        Taśma {Number.isFinite(first) ? `od ${fmtSince(first, Date.now())}` : '—'}
        {gaps > 0 && <span className="text-warn"> · luki: {gaps}</span>}
      </span>
      <span>Transakcje: {store.tape.count.toLocaleString('pl-PL')}</span>
      {series.loadingOlder && <span>Historia: wczytywanie…</span>}
      {series.historyExhausted && <span title="Hyperliquid udostępnia najwyżej 5000 ostatnich świec każdego interwału">Historia: limit API</span>}
      <span className="text-ink-3">{tzLabel()}</span>
      <span className="ml-auto text-ink-3">
        Dane: Hyperliquid · Wykres:{' '}
        <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer" className="underline decoration-line-strong hover:text-ink-1">
          TradingView Lightweight Charts™
        </a>
      </span>
    </div>
  );
};
