import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CircleHelp, RotateCcw, X } from 'lucide-react';
import { ProChart, subscribeNarrow } from '../charts/pro/ProChart';
import { ChartLayout, isNarrow, loadSettings } from '../charts/pro/chart/settings';
import { clearStation, saveStationLayout, stationKey, stationPanel } from '../charts/pro/chart/stations';
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
  loadTabs,
  migrateTabsV2,
  moveTab,
  newTabId,
  presetName,
  presetQuestion,
  renameTab,
  restoreLegacyStart,
  restoreTab,
  saveTabs,
  snapshotTab,
  tabIntervals,
  tabLayout,
  tabName,
  tabStation,
  tabsFull,
} from '../charts/pro/chart/tabs';
import { NewTab, TabActions, TabsBar, TabsSheet, tfLabel } from '../charts/pro/chart/TabsBar';
import { isTyping } from '../charts/pro/draw/tools';
import { type Market, storeFor } from '../charts/pro/store/proStore';
import { HonestyButton, HonestyCard, honestyTemplate } from '../charts/pro/chart/HonestyCard';
import { parseReplayLink, replayHash } from '../charts/pro/replay/link';
import { ReplayView } from '../charts/pro/replay/ReplayView';
import { tr } from '../i18n';

const WIDE = '(min-width: 1024px)';

const subscribeWide = (fn: () => void) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
};

const isWide = () => window.matchMedia(WIDE).matches;

/** Pozycja listy kart na telefonie, która otwiera arkusz zarządzania kartami. */
const MANAGE = '__tabs';
/** Jak długo widać „Cofnij” po zamknięciu karty. */
const UNDO_MS = 8000;

/**
 * Wykresy: świece i footprint perpów (BTC, ETH, SOL, HYPE) na silniku TradingView Lightweight Charts z danymi Hyperliquid
 * na żywo. Nad wykresami karty układów (na telefonie lista w pasku wykresu): każda karta ma własny układ 1, 2 albo 4
 * wykresów, a każdy wykres własny interwał, wskaźniki i warstwy. Przełączenie karty przenosi rynek i chwilę widoku
 * (wykres przewinięty w historię otwiera się w nowej karcie w tym samym miejscu), Alt+↑/↓ przechodzi do karty z wyższym
 * albo niższym interwałem. Link powtórki (#charts?replay=…) pokazuje zamiast nich nagranie z serwera.
 */
const ChartsView: React.FC = () => {
  // Migracja kart sprzed układów faz przed pierwszym odczytem kart; pasek przywrócenia dawnego Startu raz
  const [restoreOffer, setRestoreOffer] = useState(() => {
    try {
      return migrateTabsV2(localStorage).restoreStart;
    } catch {
      return false;
    }
  });
  const [tabs, setTabsState] = useState<TabsState>(loadTabs);
  const tab = activeTab(tabs);
  const station = tabStation(tab);
  const [layout, setLayoutState] = useState<ChartLayout>(() => tabLayout(tab));
  // Zmiana karty i przywrócenie wzorca tworzą wykresy od nowa; rynek bieżącego wykresu przechodzi do nowych
  const [gen, setGen] = useState(0);
  const [coin, setCoin] = useState<Market | null>(null);
  // Zapis ustawień wykresu zmienia podpis karty (interwały)
  const [, setSaved] = useState(0);
  const onSaved = useCallback(() => setSaved((v) => v + 1), []);
  const [sheet, setSheet] = useState(false);
  const [undo, setUndo] = useState<{ tab: ChartTab; index: number; snap: TabSnapshot; active: boolean } | null>(null);
  const wide = useSyncExternalStore(subscribeWide, isWide);
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow);
  const [replay, setReplay] = useState(() => parseReplayLink(window.location.hash));
  useEffect(() => {
    const onHash = () => setReplay(parseReplayLink(window.location.hash));
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
  // Karta uczciwości szablonu: rynek i interwał pierwszego wykresu karty (odczyt zapisu; zapis wykresu odświeża widok)
  const honestyId = honestyTemplate(tab.preset);
  const first = honestyId ? loadSettings(stationKey(tab.id, 0), stationPanel(station, 0, narrow)) : null;
  /** Podpis karty: interwały jej wykresów widocznych na tym ekranie (aktywna — bieżący układ). */
  const tf = (t: ChartTab) => tfLabel(tabIntervals(t, wide ? (t.id === tab.id ? layout : tabLayout(t)) : 1, narrow));

  const save = (next: TabsState) => {
    setTabsState(next);
    saveTabs(next);
  };
  /** Nowy stan kart z inną aktywną kartą (albo przywróconym wzorcem): wykresy od nowa z rynkiem i chwilą bieżącej karty. */
  const open = (next: TabsState, restore = false) => {
    // Ustawienia pierwszego panelu są zapisywane przy każdej zmianie, więc zapis ma bieżący rynek
    setCoin(loadSettings(stationKey(tab.id, 0)).coin);
    carryViewTime();
    const t = activeTab(next);
    if (restore) clearStation(t.id);
    save(next);
    setLayoutState(tabLayout(t));
    setGen((g) => g + 1);
  };
  const select = (id: string) => id !== tab.id && open({ ...tabs, active: id });
  const close = (id: string) => {
    const next = closeTab(tabs, id);
    if (next === tabs) return;
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
    if (next !== tabs) open(next);
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

  // Alt+1…9: karta o tym numerze (9 — ostatnia); Alt+↑/↓: karta z wyższym / niższym interwałem głównego wykresu
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target) || replay) return;
    const digit = /^Digit([1-9])$/.exec(e.code);
    let id: string | null = null;
    if (digit) id = (Number(digit[1]) === 9 ? tabs.tabs[tabs.tabs.length - 1] : tabs.tabs[Number(digit[1]) - 1])?.id ?? null;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') id = ladderTab(tabs, (t) => tabIntervals(t, 1, narrow)[0], e.key === 'ArrowUp' ? 1 : -1);
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
          <TabsBar st={tabs} tf={tf} a={actions} />
          {/* Pytanie karty (wzorca): od czego zacząć czytanie wykresów tej karty */}
          <p title={station.question} className="hidden xl:flex items-center gap-1.5 flex-1 min-w-[14rem] max-w-[30rem] text-[11px] text-ink-2">
            <CircleHelp className="w-3.5 h-3.5 shrink-0 text-ink-3" aria-label={tr('Pytanie karty', 'Tab question')} />
            <span className="truncate">{presetQuestion(tab.preset)}</span>
          </p>
          {honestyId && first && <HonestyButton key={`${tab.id}.${first.coin}`} store={storeFor(first.coin)} templateId={honestyId} tf={first.interval} />}
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
              className="ml-auto shrink-0 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-line text-xs font-medium text-ink-2 hover:text-ink-1 hover:bg-surface-2 transition-colors duration-150"
            >
              <RotateCcw className="w-4 h-4" />
              <span className="hidden sm:inline">{tr('Przywróć', 'Restore')}</span>
            </button>
          )}
        </div>
      )}
      {/* Ten sam kontener dla każdego układu: pierwszy panel nie tworzy się od nowa przy zmianie układu */}
      <div
        className={
          fs ? (n === 1 ? 'flex-1 min-h-0 flex flex-col' : `flex-1 min-h-0 grid grid-cols-2 ${n === 4 ? 'grid-rows-2' : 'grid-rows-1'} gap-2`) : n === 1 ? '' : 'grid grid-cols-2 gap-2'
        }
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
            phoneTabs={
              narrow && i === 0
                ? {
                    value: tab.id,
                    options: [
                      ...tabs.tabs.map((t) => ({ value: t.id, label: `${tabName(t)} · ${tf(t)}` })),
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
      {sheet && narrow && (
        <TabsSheet
          st={tabs}
          tf={tf}
          a={actions}
          onClose={() => setSheet(false)}
          activeExtra={honestyId && first ? <HonestyCard store={storeFor(first.coin)} templateId={honestyId} tf={first.interval} /> : undefined}
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
