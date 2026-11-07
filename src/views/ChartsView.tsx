import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PanelRightClose, PanelRightOpen, RotateCcw, X } from 'lucide-react';
import { ProChart, subscribeNarrow } from '../charts/pro/ProChart';
import { ChartLayout, isNarrow, loadSettings, saveSettings } from '../charts/pro/chart/settings';
import { PHASE_LAYOUTS, type PhaseId, activePanelSet, clearStation, saveStationLayout, stationKey, stationPanel, switchPanelSet } from '../charts/pro/chart/stations';
import { carryViewTime } from '../charts/pro/chart/controller';
import {
  ChartTab,
  MAX_TABS,
  TabSnapshot,
  TabsState,
  activeTab,
  addTab,
  blankName,
  canRestore,
  closeTab,
  dismissRestoreOffer,
  insertTab,
  ladderTab,
  loadPhaseActive,
  loadTabs,
  migrateTabsV2,
  moveTab,
  newTabId,
  openCoin,
  phaseTabs,
  presetName,
  renameTab,
  restoreLegacyStart,
  restoreTab,
  savePhaseActive,
  saveTabs,
  shortcutTab,
  snapshotTab,
  tabIntervals,
  tabLayout,
  tabName,
  tabPhase,
  tabStation,
  tabsFull,
} from '../charts/pro/chart/tabs';
import { NewTab, PanelSetSwitch, TabActions, TabsBar, TabsSheet, tfLabel } from '../charts/pro/chart/TabsBar';
import { isTyping } from '../charts/pro/draw/tools';
import { type Market, storeFor } from '../charts/pro/store/proStore';
import { HonestyButton, HonestyCard, honestyTemplate } from '../charts/pro/chart/HonestyCard';
import { parseReplayLink, replayHash } from '../charts/pro/replay/link';
import { ReplayView } from '../charts/pro/replay/ReplayView';
import { tr } from '../i18n';
import { FlowColumn } from './flow/FlowColumn';
import { DOCK_MIN_W, DOCK_W, DRAWER_MIN_W, columnAfterHash, dockMode, loadDock, saveDock } from './flow/flowColumnModel';
import { takeFlowAsk } from '../state/route';

const WIDE = '(min-width: 1024px)';

const subscribeWide = (fn: () => void) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
};

const isWide = () => window.matchMedia(WIDE).matches;

// Kolumna DOM i taśmy: przypięta od 1280 px, szuflada od 640 px (granice z `dockMode`)
const DOCK_QUERIES = [`(min-width: ${DOCK_MIN_W}px)`, `(min-width: ${DRAWER_MIN_W}px)`];
const subscribeDock = (fn: () => void) => {
  const mqs = DOCK_QUERIES.map((q) => window.matchMedia(q));
  for (const mq of mqs) mq.addEventListener('change', fn);
  return () => {
    for (const mq of mqs) mq.removeEventListener('change', fn);
  };
};
const dockModeNow = () => dockMode(window.innerWidth);

/** Karty na start: aktywna karta fazy `phase` (ostatnio wybrana w tej fazie albo jej pierwszy układ). */
function initialTabs(phase: PhaseId): TabsState {
  const st = loadTabs();
  const id = loadPhaseActive(st)[phase];
  if (id === st.active) return st;
  const next = { ...st, active: id };
  saveTabs(next);
  return next;
}

/**
 * Rynek dla wykresów innej fazy: karta innej fazy (Alt+1…6, nowa karta) przenosi do ekranu tej fazy z własnymi
 * Wykresami, a te biorą rynek stąd (jak przy przełączeniu karty na jednym ekranie). Ważny chwilę, jak chwila widoku.
 */
let handoff: { coin: Market | null; until: number } | null = null;
const HANDOFF_MS = 5000;
const takeHandoff = (): Market | null => {
  const h = handoff;
  handoff = null;
  return h && Date.now() < h.until ? h.coin : null;
};

/** Pozycja listy kart na telefonie, która otwiera arkusz zarządzania kartami. */
const MANAGE = '__tabs';
/** Jak długo widać „Cofnij” po zamknięciu karty. */
const UNDO_MS = 8000;

export interface ChartsViewProps {
  /** Faza dnia na ekranie: na pasku jej karty (`phaseTabs`), w sesji obok wykresu prawa kolumna DOM i taśmy. */
  phase: PhaseId;
  /**
   * Przejście do innej fazy (Alt+1…9 do karty innej fazy, nowa karta innej fazy): ekran tej fazy w aplikacji. Bez niego
   * Wykresy same pokazują karty tej fazy.
   */
  onPhase?: (phase: PhaseId) => void;
  /** Rynek pierwszego wykresu aktywnej karty (pasek Pulse nad wykresem na telefonie). */
  onMarket?: (coin: Market) => void;
}

/**
 * Wykresy: świece i footprint perpów (BTC, ETH, SOL, HYPE) na silniku TradingView Lightweight Charts z danymi Hyperliquid
 * na żywo. Nad wykresami karty układów fazy dnia (na telefonie lista w pasku wykresu): każda karta ma własny układ 1, 2
 * albo 4 wykresów, a każdy wykres własny interwał, wskaźniki i warstwy. Przełączenie karty przenosi rynek i chwilę widoku
 * (wykres przewinięty w historię otwiera się w nowej karcie w tym samym miejscu). Alt+1…6 otwiera układ (także innej
 * fazy), Alt+7…9 karty własne, Alt+↑/↓ kartę fazy z wyższym albo niższym interwałem. W sesji od 1280 px obok wykresu
 * stoi kolumna DOM i taśmy, a od 640 px ta sama kolumna jest szufladą nad wykresem (klawisz D chowa i pokazuje, Esc
 * zamyka szufladę). Link powtórki (#charts?replay=…) pokazuje nagranie z serwera.
 */
const ChartsView: React.FC<ChartsViewProps> = ({ phase, onPhase, onMarket }) => {
  // Migracja kart sprzed układów faz przed pierwszym odczytem kart; pasek przywrócenia dawnego Startu raz
  const [restoreOffer, setRestoreOffer] = useState(() => {
    try {
      return migrateTabsV2(localStorage).restoreStart;
    } catch {
      return false;
    }
  });
  // Faza na ekranie: z `phase`, a bez `onPhase` zmieniana tutaj (skróty do układu innej fazy)
  const [ownPhase, setOwnPhase] = useState<PhaseId>(phase);
  useEffect(() => setOwnPhase(phase), [phase]);
  const shown = onPhase ? phase : ownPhase;
  const [tabs, setTabsState] = useState<TabsState>(() => initialTabs(phase));
  const tab = activeTab(tabs);
  const station = tabStation(tab);
  const visible = phaseTabs(tabs, shown);
  const [layout, setLayoutState] = useState<ChartLayout>(() => tabLayout(tab));
  // Zmiana karty i przywrócenie wzorca tworzą wykresy od nowa; rynek bieżącego wykresu przechodzi do nowych
  const [gen, setGen] = useState(0);
  const [coin, setCoin] = useState<Market | null>(takeHandoff);
  // Zapis ustawień wykresu zmienia podpis karty (interwały)
  const [, setSaved] = useState(0);
  const onSaved = useCallback(() => setSaved((v) => v + 1), []);
  const [sheet, setSheet] = useState(false);
  const [undo, setUndo] = useState<{ tab: ChartTab; index: number; snap: TabSnapshot; active: boolean } | null>(null);
  const wide = useSyncExternalStore(subscribeWide, isWide);
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow);
  const [replay, setReplay] = useState(() => parseReplayLink(window.location.hash));
  // Szuflada DOM i taśmy (640–1279 px): zamknięta na start, bez zapisu; dawny adres #flow ją otwiera. Prośbę z adresu
  // odbierają tylko Wykresy W sesji (Wykresy znikającego ekranu Przed sesją jej nie zabierają)
  const [drawer, setDrawer] = useState(() => phase === 'session' && takeFlowAsk());
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useEffect(() => {
    const onHash = () => {
      setReplay(parseReplayLink(window.location.hash));
      // Dawny adres #flow na otwartym W sesji: kolumna z zapisu (także schowana wcześniej klawiszem D) i szuflada
      const c = columnAfterHash(phaseRef.current);
      setDock(c.dock);
      if (c.drawer) setDrawer(true);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  // Pełny ekran całego miejsca pracy: pasek kart i wszystkie panele układu (na telefonie wykres ma własny pełny ekran)
  const wsRef = useRef<HTMLDivElement>(null);
  const [fs, setFs] = useState(false);
  useEffect(() => {
    const onFs = () => setFs(document.fullscreenElement === wsRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const toggleFs = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wsRef.current?.requestFullscreen?.();
  }, []);
  const setLayout = useCallback(
    (l: ChartLayout) => {
      setLayoutState(l);
      saveStationLayout(tab.id, l);
    },
    [tab.id]
  );
  useEffect(() => {
    if (!undo) return;
    const id = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(id);
  }, [undo]);

  const n = wide ? layout : 1;
  // Ustawienia pierwszego wykresu karty z zapisu (wykres zapisuje je przy każdej zmianie i odświeża ten widok):
  // rynek kolumny DOM i taśmy, karta uczciwości szablonu i zestaw paneli
  const first = loadSettings(stationKey(tab.id, 0), stationPanel(station, 0, narrow));
  const honestyId = honestyTemplate(tab.preset);
  const panelSet = activePanelSet(station, first);
  /** Podpis karty: interwały jej wykresów widocznych na tym ekranie (aktywna — bieżący układ). */
  const tf = (t: ChartTab) => tfLabel(tabIntervals(t, wide ? (t.id === tab.id ? layout : tabLayout(t)) : 1, narrow));

  // Prawa kolumna DOM i taśmy w sesji: od 1280 px obok wykresu, dopóki użytkownik jej nie schowa (klawisz D, zapis);
  // od 640 px szuflada nad wykresem (przycisk, D, Esc w szufladzie); na telefonie pasek Pulse z SessionView
  const [dock, setDock] = useState(loadDock);
  const mode = useSyncExternalStore(subscribeDock, dockModeNow);
  const dockable = shown === 'session' && !narrow && mode !== 'none';
  const docked = dockable && mode === 'docked' && dock;
  const drawerOpen = dockable && mode === 'drawer' && drawer;
  const columnOn = mode === 'docked' ? dock : drawer;
  const dockBtnRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  // Otwarta szuflada dostaje fokus (Esc ją zamyka); zamknięcie z fokusem w szufladzie oddaje go przyciskowi
  useEffect(() => {
    if (drawerOpen) drawerRef.current?.focus({ preventScroll: true });
  }, [drawerOpen]);
  const shutDrawer = () => {
    if (drawerRef.current?.contains(document.activeElement)) dockBtnRef.current?.focus();
    setDrawer(false);
  };
  const toggleDock = () => {
    if (mode === 'drawer') return drawer ? shutDrawer() : setDrawer(true);
    setDock(!dock);
    saveDock(!dock);
  };
  const escDrawer = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    shutDrawer();
  };
  useEffect(() => {
    onMarket?.(first.coin);
  }, [first.coin, onMarket]);

  const save = (next: TabsState) => {
    setTabsState(next);
    saveTabs(next);
  };
  /**
   * Nowy stan kart z inną aktywną kartą (albo przywróconym wzorcem): wykresy od nowa z rynkiem i chwilą bieżącej karty.
   * `keepSaved` — karta otwiera się z rynkiem ze swojego zapisu (przywrócony dawny Start). Karta zostaje aktywną kartą
   * swojej fazy; karta innej fazy (skrót, nowa karta) przenosi widok do tej fazy.
   */
  const open = (next: TabsState, restore = false, keepSaved = false) => {
    const t = activeTab(next);
    // Ustawienia pierwszego panelu są zapisywane przy każdej zmianie, więc zapis ma bieżący rynek
    const carry = openCoin(tab.id, keepSaved);
    carryViewTime();
    if (restore) clearStation(t.id);
    const p = tabPhase(t);
    savePhaseActive({ ...loadPhaseActive(next), [p]: t.id });
    if (p !== shown && onPhase) {
      // Ekran innej fazy ma własne Wykresy: tu tylko zapis kart i rynek dla nich (znikający ekran nie buduje wykresów)
      saveTabs(next);
      handoff = { coin: carry, until: Date.now() + HANDOFF_MS };
      onPhase(p);
      return;
    }
    setCoin(carry);
    save(next);
    setLayoutState(tabLayout(t));
    setGen((g) => g + 1);
    if (p !== shown) setOwnPhase(p);
  };
  const select = (id: string) => id !== tab.id && open({ ...tabs, active: id });
  // Inna faza na ekranie (z `phase`): jej ostatnio wybrana karta
  useEffect(() => {
    if (!phaseTabs(tabs, shown).some((t) => t.id === tabs.active)) open({ ...tabs, active: loadPhaseActive(tabs)[shown] });
    // Tylko przy zmianie fazy; karty i open z tego samego renderu
  }, [shown]);
  /** Zestaw paneli układu: wykresy od nowa z ustawieniami pierwszego panelu po przełączeniu (zmiany użytkownika zostają). */
  const pickPanelSet = (id: string) => {
    const key = stationKey(tab.id, 0);
    const cur = loadSettings(key, stationPanel(station, 0, narrow));
    const next = switchPanelSet(station, cur, id, narrow);
    if (next === cur) return;
    carryViewTime();
    saveSettings(next, key);
    setCoin(null);
    setGen((g) => g + 1);
  };
  const close = (id: string) => {
    let next = closeTab(tabs, id);
    if (next === tabs) return;
    // Zamknięta aktywna karta: aktywną zostaje sąsiadka z kart tej fazy (nie karta innej fazy z całego paska)
    if (id === tabs.active) {
      const i = visible.findIndex((t) => t.id === id);
      const rest = visible.filter((t) => t.id !== id);
      const nb = rest[i] ?? rest[i - 1];
      if (nb) next = { ...next, active: nb.id };
    }
    const index = tabs.tabs.findIndex((t) => t.id === id);
    setUndo({ tab: tabs.tabs[index], index, snap: snapshotTab(id), active: id === tab.id });
    // Najpierw przełączenie (rynek i chwila z zamykanej karty), potem usunięcie jej zapisu
    if (next.active !== tabs.active) open(next);
    else save(next);
    clearStation(id);
  };
  const reopen = () => {
    if (!undo) return;
    restoreTab(undo.tab.id, undo.snap);
    const next = insertTab(tabs, undo.tab, undo.index, undo.active);
    setUndo(null);
    if (next.active !== tabs.active) open(next);
    else save(next);
  };
  const copy = (id: string) => {
    const src = tabs.tabs.find((t) => t.id === id);
    if (!src) return;
    const copyId = newTabId();
    const next = addTab(tabs, { id: copyId, preset: src.preset, name: `${tabName(src)} ${tr('(kopia)', '(copy)')}`.slice(0, 32) });
    if (next === tabs) return;
    restoreTab(copyId, snapshotTab(id));
    open(next);
  };
  const create = (how: NewTab) => {
    if (how === 'copy') return copy(tab.id);
    const next = addTab(tabs, how === 'blank' ? { id: newTabId(), preset: 'own', name: blankName(tabs) } : { id: newTabId(), preset: how, name: null });
    if (next === tabs) return;
    if (next.active !== tabs.active) open(next);
    else save(next);
  };
  const closeOffer = () => {
    try {
      dismissRestoreOffer(localStorage);
    } catch {
      // Pamięć niedostępna — pasek znika do końca sesji
    }
    setRestoreOffer(false);
  };
  /** Cała dawna wersja Startu jako karta własna „Moje dawne ustawienia”, od razu otwarta. */
  const restoreStart = () => {
    if (tabsFull(tabs)) return;
    let t: ChartTab;
    try {
      t = restoreLegacyStart(localStorage);
    } catch {
      return;
    }
    closeOffer();
    const next = addTab(tabs, t);
    // Cała dawna wersja, także jej rynek
    if (next !== tabs) open(next, false, true);
  };
  const actions: TabActions = {
    onSelect: select,
    onNew: create,
    onRename: (id, name) => save(renameTab(tabs, id, name)),
    onCopy: copy,
    onClose: close,
    onRestore: (id) => {
      const t = tabs.tabs.find((x) => x.id === id);
      if (t && canRestore(t)) open({ ...tabs, active: id }, true);
    },
    onMove: (id, to) => save(moveTab(tabs, id, to)),
  };

  // Alt+1…6: układ w kolejności faz (widok przechodzi do jego fazy), Alt+7…9: karty własne w kolejności paska;
  // Alt+↑/↓: karta fazy z wyższym / niższym interwałem głównego wykresu; D: kolumna DOM i taśmy (w sesji, od 640 px)
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    if (e.ctrlKey || e.metaKey || isTyping(e.target) || replay) return;
    if (!e.altKey) {
      if (e.key.toLowerCase() !== 'd' || !dockable) return;
      e.preventDefault();
      toggleDock();
      return;
    }
    const digit = /^Digit([1-9])$/.exec(e.code);
    let id: string | null = null;
    // Alt+1…6 — układy faz (shortcutTab), Alt+7…9 — karty własne
    if (digit) id = shortcutTab(tabs, Number(digit[1]));
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') id = ladderTab({ tabs: visible, active: tab.id }, (t) => tabIntervals(t, 1, narrow)[0], e.key === 'ArrowUp' ? 1 : -1);
    else return;
    e.preventDefault();
    if (id) select(id);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (replay) return <ReplayView key={replayHash(replay)} link={replay} />;
  return (
    <div ref={wsRef} className={fs ? 'flex flex-col gap-2 h-full p-2 bg-page' : ''}>
      {restoreOffer && !fs && (
        <div role="status" className="mb-2 flex flex-wrap items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-xl border border-line-strong bg-surface-2 text-xs">
          <span className="flex-1 min-w-[14rem] text-ink-2 leading-snug">
            {tr(
              'Wykresy mają teraz układy faz dnia. Kokpit przejął z Twojego dawnego wykresu rynek, interwał i wskaźniki; całą dawną wersję możesz przywrócić jako własną kartę.',
              'Charts now have layouts for the phases of the day. The Cockpit took the market, timeframe and indicators from your previous chart; you can restore the whole previous version as a tab of your own.'
            )}
          </span>
          <button
            type="button"
            onClick={restoreStart}
            disabled={tabsFull(tabs)}
            title={
              tabsFull(tabs)
                ? tr(`Masz już ${MAX_TABS} kart własnych — zamknij jedną, żeby przywrócić`, `You already have ${MAX_TABS} tabs of your own — close one to restore`)
                : undefined
            }
            className="shrink-0 min-h-11 sm:min-h-8 px-3 rounded-lg bg-surface-3 border border-line-strong font-medium text-ink-1 hover:bg-surface-1 disabled:opacity-40"
          >
            {tr('Przywróć moje poprzednie ustawienia', 'Restore my previous settings')}
          </button>
          <button
            type="button"
            onClick={closeOffer}
            aria-label={tr('Zamknij', 'Close')}
            title={tr('Zamknij: pasek już nie wróci', 'Close: the bar will not come back')}
            className="shrink-0 grid place-items-center w-11 h-11 sm:w-8 sm:h-8 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-surface-3"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {!narrow && (
        <div className={`flex items-center gap-2 min-w-0 ${fs ? '' : 'mb-2'}`}>
          <TabsBar st={tabs} tf={tf} a={actions} tabs={visible} presets={PHASE_LAYOUTS[shown]} phase={shown} />
          {/* Zestaw paneli pod wykresem (np. Aukcja | Absorpcja): należy do aktywnej karty */}
          {panelSet && <PanelSetSwitch sets={station.panelSets ?? []} value={panelSet.id} onChange={pickPanelSet} />}
          {honestyId && <HonestyButton key={`${tab.id}.${first.coin}`} store={storeFor(first.coin)} templateId={honestyId} />}
          <div className="ml-auto shrink-0 flex items-center gap-2">
            {dockable && (
              <button
                ref={dockBtnRef}
                type="button"
                onClick={toggleDock}
                aria-pressed={columnOn}
                aria-label={tr('Kolumna DOM i taśmy (D)', 'DOM & tape column (D)')}
                title={tr('Kolumna DOM i taśmy (D)', 'DOM & tape column (D)')}
                className={`grid place-items-center w-8 h-8 rounded-lg border transition-colors duration-150 ${columnOn ? 'bg-surface-3 border-line-strong text-ink-1' : 'border-line text-ink-2 hover:text-ink-1 hover:bg-surface-2'}`}
              >
                {columnOn ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
              </button>
            )}
            {/* Karta własna nie ma wzorca do przywrócenia */}
            {canRestore(tab) && (
              <button
                type="button"
                onClick={() => actions.onRestore(tab.id)}
                aria-label={tr(`Przywróć wzorzec karty ${tabName(tab)}`, `Restore the ${tabName(tab)} tab preset`)}
                title={tr(
                  `Przywróć wzorzec „${presetName(tab.preset)}” w karcie ${tabName(tab)}: Twoje zmiany w tej karcie (ustawienia wykresów i układ) zostaną zastąpione`,
                  `Restore the “${presetName(tab.preset)}” preset in the ${tabName(tab)} tab: your changes in this tab (chart settings and layout) will be replaced`
                )}
                className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-line text-xs font-medium text-ink-2 hover:text-ink-1 hover:bg-surface-2 transition-colors duration-150"
              >
                <RotateCcw className="w-4 h-4" />
                <span className="hidden sm:inline">{tr('Przywróć', 'Restore')}</span>
              </button>
            )}
          </div>
        </div>
      )}
      {/* Telefon: zestaw paneli nad wykresem (pasek kart jest listą w pasku wykresu) */}
      {narrow && panelSet && (
        <div className="mb-2 flex">
          <PanelSetSwitch sets={station.panelSets ?? []} value={panelSet.id} onChange={pickPanelSet} />
        </div>
      )}
      {/* Wiersz: wykresy i (w sesji) kolumna DOM i taśmy o wysokości wykresów, obok nich albo w szufladzie nad nimi */}
      <div className={`relative flex gap-2 ${fs ? 'flex-1 min-h-0' : ''}`}>
        {/* Ten sam kontener dla każdego układu: pierwszy panel nie tworzy się od nowa przy zmianie układu ani kolumny */}
        <div
          className={`flex-1 min-w-0 ${
            fs ? (n === 1 ? 'min-h-0 flex flex-col' : `min-h-0 grid grid-cols-2 ${n === 4 ? 'grid-rows-2' : 'grid-rows-1'} gap-2`) : n === 1 ? '' : 'grid grid-cols-2 gap-2'
          }`}
        >
          {Array.from({ length: n }, (_, i) => (
            <ProChart
              key={`${tab.id}.${gen}.${i}`}
              panel={i}
              station={station}
              tabId={tab.id}
              onSaved={onSaved}
              coin={coin}
              fromLink={gen === 0}
              layout={n}
              onLayout={i === 0 ? setLayout : undefined}
              layoutFs={narrow ? undefined : { active: fs, toggle: toggleFs }}
              // Pytanie karty i trzy liczby układu: nagłówek w pierwszym wykresie (na każdej szerokości)
              layoutHeader={i === 0}
              phoneTabs={
                narrow && i === 0
                  ? {
                      value: tab.id,
                      options: [
                        ...visible.map((t) => ({ value: t.id, label: `${tabName(t)} · ${tf(t)}` })),
                        { value: MANAGE, label: tr('Karty: nowa, nazwa, zamknij…', 'Tabs: new, rename, close…') },
                      ],
                      onChange: (id) => (id === MANAGE ? setSheet(true) : select(id)),
                      onRestore: canRestore(tab) ? () => actions.onRestore(tab.id) : undefined,
                    }
                  : undefined
              }
            />
          ))}
        </div>
        {/* Kolumna bez własnej wysokości (wypełnia wiersz), więc ma dokładnie wysokość wykresów */}
        {docked && (
          <aside aria-label={tr('DOM i taśma', 'DOM & tape')} className="relative shrink-0" style={{ width: DOCK_W }}>
            <div className="absolute inset-0">
              <FlowColumn coin={first.coin} narrow={false} variant="column" />
            </div>
          </aside>
        )}
        {/* Szuflada: ta sama kolumna nad prawą częścią wykresu (zewnętrzna ramka przycina wjazd z prawej); z-20 — pod
            przypiętym nagłówkiem aplikacji (z-30), gdy strona jest przewinięta */}
        {drawerOpen && (
          <div className="absolute inset-y-0 right-0 z-20 overflow-hidden rounded-l-xl shadow-2xl" style={{ width: 'min(400px, 92vw)' }}>
            <aside
              ref={drawerRef}
              tabIndex={-1}
              onKeyDown={escDrawer}
              aria-label={tr('DOM i taśma', 'DOM & tape')}
              className="hq-drawer-in h-full p-2 bg-page border-l border-line-strong rounded-l-xl outline-none"
            >
              <FlowColumn coin={first.coin} narrow={false} variant="column" />
            </aside>
          </div>
        )}
      </div>
      {sheet && narrow && (
        <TabsSheet
          st={tabs}
          tf={tf}
          a={actions}
          tabs={visible}
          presets={PHASE_LAYOUTS[shown]}
          phase={shown}
          onClose={() => setSheet(false)}
          activeExtra={honestyId ? <HonestyCard store={storeFor(first.coin)} templateId={honestyId} /> : undefined}
        />
      )}
      {undo && (
        <div role="status" className="fixed z-50 bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 max-w-[calc(100vw-32px)] pl-3 pr-1.5 py-1.5 rounded-xl border border-line-strong bg-surface-2 shadow-2xl text-xs">
          <span className="text-ink-2 truncate">{tr(`Zamknięto kartę „${tabName(undo.tab)}”`, `Closed the “${tabName(undo.tab)}” tab`)}</span>
          <button type="button" onClick={reopen} className="shrink-0 h-8 px-3 rounded-lg bg-surface-3 border border-line-strong font-medium text-ink-1 hover:bg-surface-1">
            {tr('Cofnij', 'Undo')}
          </button>
        </div>
      )}
    </div>
  );
};

export default ChartsView;
