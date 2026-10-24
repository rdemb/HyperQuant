import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Camera, ChevronsRight, Maximize2, Minimize2, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { Badge, BadgeTone, Segmented } from '../../ui';
import { INTERVALS, fmtHm, fmtSince, intervalById } from './core/time';
import type { ResetMode } from './core/sessions';
import { ProChartController } from './chart/controller';
import { HoverSignal, Legend } from './chart/Legend';
import { brandedScreenshot, downloadCanvas } from './chart/screenshot';
import { ChartSettings, DEFAULT_SETTINGS, loadSettings, saveSettings } from './chart/settings';
import type { ChartView } from './chart/footprintSeries';
import type { FootprintStyle } from './chart/layout';
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<ProChartController | null>(null);
  const signal = useMemo(() => new HoverSignal(), []);
  useStoreVersion(store, 400);

  const update = useCallback((patch: Partial<ChartSettings>) => setSettings((s) => ({ ...s, ...patch })), []);

  // Interwał przed startem strumieni — pierwsze świece od razu we właściwym interwale
  useEffect(() => {
    void store.setInterval(settings.interval);
    startRecording(store);
  }, [store, settings.interval]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ctrl = new ProChartController(host, store, settings, signal.set);
    ctrlRef.current = ctrl;
    return () => {
      ctrl.destroy();
      ctrlRef.current = null;
    };
    // Wykres tworzymy raz; zmiany ustawień idą przez applySettings
  }, [store, signal]);

  useEffect(() => {
    ctrlRef.current?.applySettings(settings);
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === cardRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // Menu ustawień: Escape i kliknięcie poza menu zamykają
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [menuOpen]);

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

  return (
    <div
      ref={cardRef}
      className={`relative flex flex-col bg-surface-1 border border-line-strong overflow-hidden ${
        fullscreen ? 'w-full h-full' : 'rounded-xl h-[calc(100dvh-14rem)] lg:h-[calc(100dvh-9.5rem)] min-h-[440px]'
      }`}
    >
      {/* Pasek narzędzi */}
      <div className="flex items-center gap-2 px-2 sm:px-3 py-1.5 border-b border-line min-h-11 overflow-x-auto [scrollbar-width:none]">
        <Segmented<string> ariaLabel="Interwał wykresu" value={settings.interval} onChange={(v) => update({ interval: v })} options={INTERVAL_OPTIONS} />
        <Segmented<ChartView> ariaLabel="Rodzaj wykresu" value={settings.view} onChange={(v) => update({ view: v })} options={VIEW_OPTIONS} />
        {settings.view === 'footprint' && (
          <Segmented<FootprintStyle> ariaLabel="Styl footprintu" value={settings.fpStyle} onChange={(v) => update({ fpStyle: v })} options={STYLE_OPTIONS} />
        )}
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <ToolBtn label="Ustawienia wykresu" onClick={() => setMenuOpen((o) => !o)} active={menuOpen} expanded={menuOpen}>
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

      {/* Wykres */}
      <div className="relative flex-1 min-h-0">
        <div ref={hostRef} className="absolute inset-0" />
        <Legend signal={signal} intervalMs={iv.ms} intervalLabel={iv.label} tapeSince={tapeSince} />
        <LoadOverlay store={store} onRetry={() => void store.setInterval(settings.interval, true)} />
        {menuOpen && (
          <div ref={menuRef} className="absolute top-2 right-2 z-30 w-[min(320px,calc(100%-16px))] max-h-[calc(100%-16px)] overflow-y-auto">
            <SettingsMenu settings={settings} onChange={update} onReset={() => setSettings({ ...DEFAULT_SETTINGS, interval: settings.interval })} />
          </div>
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

const SettingsMenu: React.FC<{ settings: ChartSettings; onChange: (p: Partial<ChartSettings>) => void; onReset: () => void }> = ({
  settings: s,
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
      <div className="flex flex-col items-start gap-1.5">
        <span className="text-ink-2">Zerowanie CVD</span>
        <Segmented<ResetMode> ariaLabel="Zerowanie CVD" value={s.cvdReset} onChange={(v) => onChange({ cvdReset: v })} options={RESET_OPTIONS} />
      </div>
    </Group>
    <button type="button" onClick={onReset} className="self-start min-h-9 px-3 rounded-lg border border-line-strong text-ink-2 hover:text-ink-1 hover:bg-surface-3">
      Przywróć domyślne
    </button>
  </div>
);

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
