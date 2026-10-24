import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Camera, ChevronsRight, Layers, ListOrdered, Maximize2, Minimize2, PenTool, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { Badge, BadgeTone, Segmented } from '../../ui';
import { LiqMapState, useLiqMap } from '../../state/useLiqMap';
import { INTERVALS, fmtHm, fmtSince, intervalById } from './core/time';
import { DEFAULT_THRESHOLD_USD, classify } from './core/clashes';
import { indicatorScope, liqLevels } from './core/indicators';
import type { AggressorOrder } from './core/orders';
import type { ResetMode } from './core/sessions';
import { ProChartController } from './chart/controller';
import { PickCard, TapePanel, compact } from './chart/FlowPanels';
import { HoverSignal, Legend } from './chart/Legend';
import type { LiquidityPick } from './chart/liquidity';
import { brandedScreenshot, downloadCanvas } from './chart/screenshot';
import { ChartSettings, DEFAULT_SETTINGS, loadSettings, saveSettings } from './chart/settings';
import type { ChartView } from './chart/footprintSeries';
import type { FootprintStyle } from './chart/layout';
import { DrawHint, DrawStyleBar, DrawToolbar } from './draw/DrawToolbar';
import type { DrawingTools } from './draw/tools';
import { ProStore, proStore } from './store/proStore';
import { startRecording } from './store/recording';

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

/** Wykres Pro: Lightweight Charts (TradingView) z footprintem, wolumenem, Deltą i CVD z taśmy Hyperliquid. */
export const ProChart: React.FC = () => {
  const store = proStore;
  const [settings, setSettings] = useState<ChartSettings>(loadSettings);
  const [menu, setMenu] = useState<'settings' | 'indicators' | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [tools, setTools] = useState<DrawingTools | null>(null);
  // Kliknięty bąbel, seria albo ściana i podświetlony adres biorcy (tylko w pamięci strony)
  const [pick, setPick] = useState<LiquidityPick | null>(null);
  const [highlight, setHighlight] = useState('');
  // Pasek rysowania: na komputerze widoczny od razu, na telefonie po dotknięciu przycisku (więcej miejsca na wykres)
  const [drawOpen, setDrawOpen] = useState(() => window.innerWidth >= 640);
  const cardRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<ProChartController | null>(null);
  const legendBottom = useRef(0);
  const signal = useMemo(() => new HoverSignal(), []);
  const liq = useLiqMap();
  useStoreVersion(store, 400);

  const update = useCallback((patch: Partial<ChartSettings>) => setSettings((s) => ({ ...s, ...patch })), []);
  const onLegendBottom = useCallback((px: number) => {
    legendBottom.current = px;
    ctrlRef.current?.setTopInset(px);
  }, []);

  // Interwał przed startem strumieni — pierwsze świece od razu we właściwym interwale
  useEffect(() => {
    void store.setInterval(settings.interval);
    startRecording(store);
  }, [store, settings.interval]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ctrl = new ProChartController(host, store, settings, signal.set, setPick);
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
  }, [store, signal]);

  useEffect(() => {
    ctrlRef.current?.applySettings(settings);
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    ctrlRef.current?.highlight(highlight);
  }, [highlight]);

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

  // Klastry likwidacji tylko z aktualnej mapy skanera (jak w Desku: nieaktualna mapa nie jest pokazywana)
  useEffect(() => {
    const fresh = liq.map && (liq.status === 'ready' || liq.status === 'delayed');
    ctrlRef.current?.setLiqLevels(fresh ? liqLevels(liq.map!) : []);
  }, [liq.map, liq.status]);

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
    const img = brandedScreenshot(ctrl.chart.takeScreenshot(true), host.clientWidth, `BTC-PERP · Hyperliquid · ${iv.label} · ${mode}`, when);
    const stamp = `${when.getFullYear()}${String(when.getMonth() + 1).padStart(2, '0')}${String(when.getDate()).padStart(2, '0')}-${fmtHm(when.getTime()).replace(':', '')}`;
    downloadCanvas(img, `hyperquant-btc-${iv.id}-${stamp}.png`);
  };

  const iv = intervalById(settings.interval);
  const tapeSince = store.coverage.first();
  const bigUsd = ctrlRef.current?.bigTradeUsd ?? DEFAULT_THRESHOLD_USD;

  return (
    <div
      ref={cardRef}
      className={`relative flex flex-col bg-surface-1 border border-line-strong overflow-hidden ${
        fullscreen ? 'w-full h-full' : 'rounded-xl h-[calc(100dvh-14rem)] lg:h-[calc(100dvh-9.5rem)] min-h-[440px]'
      }`}
    >
      {/* Pasek narzędzi: na telefonie przełączniki przewijane w pierwszym wierszu, narzędzia zawsze widoczne w drugim */}
      <div className="flex flex-wrap sm:flex-nowrap items-center gap-x-2 gap-y-1 px-2 sm:px-3 py-1.5 border-b border-line min-h-11">
        <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-1 min-w-0 overflow-x-auto [scrollbar-width:none]">
          <Segmented<string> ariaLabel="Interwał wykresu" value={settings.interval} onChange={(v) => update({ interval: v })} options={INTERVAL_OPTIONS} />
          <Segmented<ChartView> ariaLabel="Rodzaj wykresu" value={settings.view} onChange={(v) => update({ view: v })} options={VIEW_OPTIONS} />
          {settings.view === 'footprint' && (
            <Segmented<FootprintStyle> ariaLabel="Styl footprintu" value={settings.fpStyle} onChange={(v) => update({ fpStyle: v })} options={STYLE_OPTIONS} />
          )}
        </div>
        <div className="flex items-center justify-end gap-1 w-full sm:w-auto shrink-0">
          <button
            type="button"
            data-menu-toggle
            aria-expanded={menu === 'indicators'}
            title="Wskaźniki na wykresie ceny"
            onClick={() => setMenu((m) => (m === 'indicators' ? null : 'indicators'))}
            className={`mr-auto sm:mr-0 inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg border text-xs font-medium transition-colors duration-150 ${
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
          <ToolBtn label="Przewiń do bieżącej świecy" onClick={() => ctrlRef.current?.scrollToNow()}>
            <ChevronsRight className="w-4 h-4" />
          </ToolBtn>
          <ToolBtn label="Przywróć skalę" onClick={() => ctrlRef.current?.resetScales()}>
            <RotateCcw className="w-4 h-4" />
          </ToolBtn>
          <ToolBtn label="Zrzut ekranu (PNG)" onClick={screenshot}>
            <Camera className="w-4 h-4" />
          </ToolBtn>
          <ToolBtn label={fullscreen ? 'Zamknij pełny ekran' : 'Pełny ekran'} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </ToolBtn>
        </div>
      </div>

      {/* Wykres z paskiem rysowania po lewej i taśmą zleceń po prawej (na telefonie taśma nad wykresem) */}
      <div className="relative flex flex-1 min-h-0">
        <DrawToolbar tools={tools} className={drawOpen ? 'flex' : 'hidden'} />
        <div className="relative flex-1 min-h-0 min-w-0">
          <div ref={hostRef} className="absolute inset-0" />
          <Legend signal={signal} intervalMs={iv.ms} intervalLabel={iv.label} tapeSince={tapeSince} onBottom={onLegendBottom} />
          <DrawStyleBar tools={tools} />
          <DrawHint tools={tools} />
          <LoadOverlay store={store} onRetry={() => void store.setInterval(settings.interval, true)} />
          {pick && (
            <div className="absolute left-2 bottom-2 z-30 w-[min(320px,calc(100%-16px))] max-h-[55%] sm:max-h-[calc(100%-16px)] overflow-y-auto rounded-xl">
              <PickCard pick={pick} store={store} bigUsd={bigUsd} highlight={highlight} onHighlight={setHighlight} onClose={closePick} />
            </div>
          )}
          {menu && (
            <div ref={menuRef} className="absolute top-2 right-2 z-30 w-[min(340px,calc(100%-16px))] max-h-[calc(100%-16px)] overflow-y-auto">
              {menu === 'settings' ? (
                <SettingsMenu settings={settings} bigUsd={bigUsd} onChange={update} onReset={() => setSettings({ ...DEFAULT_SETTINGS, interval: settings.interval })} />
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

      <StatusBar store={store} />
    </div>
  );
};

const ToolBtn: React.FC<{ label: string; onClick: () => void; children: React.ReactNode; active?: boolean; expanded?: boolean }> = ({
  label,
  onClick,
  children,
  active,
  expanded,
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    aria-expanded={expanded}
    data-menu-toggle={expanded === undefined ? undefined : true}
    onClick={onClick}
    className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border transition-colors duration-150 ${
      active ? 'bg-surface-3 text-ink-1 border-line-strong' : 'text-ink-2 border-transparent hover:text-ink-1 hover:bg-surface-2 hover:border-line'
    }`}
  >
    {children}
  </button>
);

/** Stan wczytywania świec: komunikat zamiast pustego wykresu, przy błędzie — ponowienie. */
const LoadOverlay: React.FC<{ store: ProStore; onRetry: () => void }> = ({ store, onRetry }) => {
  if (store.candles.length > 0 || store.loadState === 'ready' || store.loadState === 'idle') return null;
  const error = store.loadState === 'error';
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

const ROW_OPTIONS = [0, 1, 2, 5, 10, 25, 50, 100];
const RATIO_OPTIONS = [1.5, 2, 2.5, 3, 4];
const MIN_VOL_OPTIONS = [0, 0.05, 0.25, 1, 5];
const STACKED_OPTIONS = [0, 2, 3, 4, 5];
const RESET_OPTIONS: { value: ResetMode; label: string }[] = [
  { value: 'session', label: 'Sesja' },
  { value: 'day', label: 'Doba UTC' },
  { value: 'week', label: 'Tydzień' },
  { value: 'none', label: 'Ciągła' },
];

const BIG_OPTIONS = [0, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];

const SettingsMenu: React.FC<{ settings: ChartSettings; bigUsd: number; onChange: (p: Partial<ChartSettings>) => void; onReset: () => void }> = ({
  settings: s,
  bigUsd,
  onChange,
  onReset,
}) => (
  <div className="bg-surface-2 border border-line-strong rounded-xl p-3 shadow-2xl flex flex-col gap-3 text-xs">
    <Group title="Footprint">
      <Select label="Wysokość wiersza" value={s.rowStep} options={ROW_OPTIONS} format={(v) => (v === 0 ? 'Auto' : `${v} USD`)} onChange={(v) => onChange({ rowStep: v })} />
      <Select
        label="Nierównowaga"
        title="Nierównowaga diagonalna: kupno w wierszu ≥ N × sprzedaż wiersz niżej (i odwrotnie)"
        value={s.imbalanceRatio}
        options={RATIO_OPTIONS}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => onChange({ imbalanceRatio: v })}
      />
      <Select
        label="Min. wolumen nierównowagi"
        value={s.imbalanceMinVol}
        options={MIN_VOL_OPTIONS}
        format={(v) => (v === 0 ? 'Brak' : `${v} BTC`)}
        onChange={(v) => onChange({ imbalanceMinVol: v })}
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
    <button type="button" onClick={onReset} className="self-start min-h-9 px-3 rounded-lg border border-line-strong text-ink-2 hover:text-ink-1 hover:bg-surface-3">
      Przywróć domyślne
    </button>
  </div>
);

type IndicatorKey =
  | 'showHeatmap'
  | 'showBubbles'
  | 'showClashes'
  | 'showVwap'
  | 'showVwapBands'
  | 'showSessionVwap'
  | 'showProfile'
  | 'showPeriodProfiles'
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
      hint: 'Płynność zleceń oczekujących w czasie (l2Book Hyperliquid, kubełki ~10 i ~100 USD) — od otwarcia strony',
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
    { key: 'showLiq', label: 'Klastry likwidacji', hint: liqHint(liq), swatch: 'bg-gradient-to-r from-of-sell to-of-buy' },
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

const Group: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <fieldset className="flex flex-col gap-2">
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
const StatusBar: React.FC<{ store: ProStore }> = ({ store }) => {
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
      {store.loadingOlder && <span>Historia: wczytywanie…</span>}
      {store.historyExhausted && <span title="Hyperliquid udostępnia najwyżej 5000 ostatnich świec każdego interwału">Historia: limit API</span>}
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
