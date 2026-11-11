import React, { useEffect, useRef, useState } from 'react';
import { Copy, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import { type PanelSet, type PhaseId, STATIONS, StationId, stationPanel } from './stations';
import { ChartTab, MAX_TABS, TabsState, canClose, canRestore, presetName, presetQuestion, presetStation, tabName, tabShortcut, tabsFull } from './tabs';
import { intervalById } from '../core/time';
import { debouncedRadio } from '../../../ui/deferred';
import { Dropdown, DropdownSelect, MenuItem, MenuSection, MenuSeparator } from '../../../ui/Dropdown';
import { tr } from '../../../i18n';

/** Sposób utworzenia nowej karty: pusta (karta własna z ustawieniami startowymi), kopia aktywnej albo z wzorca układu. */
export type NewTab = 'blank' | 'copy' | StationId;

export interface TabActions {
  onSelect: (id: string) => void;
  onNew: (how: NewTab) => void;
  onRename: (id: string, name: string) => void;
  onCopy: (id: string) => void;
  onClose: (id: string) => void;
  onRestore: (id: string) => void;
  onMove: (id: string, to: number) => void;
}

/** Przerwa po ostatniej strzałce w przełączniku zestawu paneli, po której wykresy się przebudowują (ms). */
const PANEL_SET_DELAY_MS = 350;

/** Interwały paneli jako podpis: „30m · 4h”. */
export const tfLabel = (intervals: readonly string[]): string => intervals.map((i) => intervalById(i).label).join(' · ');

const presetTf = (p: StationId): string => {
  const st = presetStation(p);
  return tfLabel(st.panels.map((_, i) => stationPanel(st, i, false).interval));
};

/** Zamknięcie menu: Escape albo kliknięcie poza nim. */
function useDismiss(ref: React.RefObject<HTMLElement | null>, open: boolean, onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close.current();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [open, ref]);
}

/** Pole nazwy karty: Enter i opuszczenie pola zapisują, Escape anuluje. */
const NameInput: React.FC<{ value: string; onDone: (name: string | null) => void; className?: string }> = ({ value, onDone, className = '' }) => {
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <input
      autoFocus
      defaultValue={value}
      maxLength={32}
      aria-label={tr('Nazwa karty', 'Tab name')}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(e.currentTarget.value);
        else if (e.key === 'Escape') finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      className={`h-7 px-1.5 rounded-md border border-line-strong bg-page text-xs font-medium text-ink-1 outline-none ${className}`}
    />
  );
};

/** Podpis pustej karty: karty własne należą do W sesji, więc z innej fazy pusta karta przenosi tam i mówi o tym. */
export const blankTabLabel = (phase?: PhaseId): string =>
  phase && phase !== 'session' ? tr('Pusta karta (W sesji)', 'Blank tab (In session)') : tr('Pusta karta', 'Blank tab');

/**
 * Lista „Nowa karta”: pusta, kopia aktywnej i układy (na komputerze w menu przycisku +, na telefonie w arkuszu).
 * `presets` — układy do wyboru (układy fazy na ekranie), domyślnie wszystkie sześć; `phase` — faza na ekranie.
 */
export const NewTabList: React.FC<{ st: TabsState; onNew: (how: NewTab) => void; presets?: readonly StationId[]; phase?: PhaseId }> = ({ st, onNew, presets, phase }) => {
  const active = st.tabs.find((t) => t.id === st.active) ?? st.tabs[0];
  const full = tabsFull(st);
  const layouts = presets ? STATIONS.filter((s) => presets.includes(s.id)) : STATIONS;
  const item = 'w-full flex items-start gap-2 text-left px-2 py-1.5 rounded-lg hover:bg-surface-3 disabled:opacity-40 disabled:hover:bg-transparent';
  return (
    <div className="flex flex-col gap-2 text-xs">
      {full && <p className="px-2 text-[11px] leading-snug text-warn">{tr(`Masz już ${MAX_TABS} kart własnych — zamknij jedną, żeby dodać nową.`, `You already have ${MAX_TABS} tabs of your own — close one to add a new one.`)}</p>}
      <div className="flex flex-col">
        <button type="button" disabled={full} className={item} onClick={() => onNew('blank')}>
          <Plus className="w-4 h-4 mt-px shrink-0 text-ink-3" />
          <span className="min-w-0">
            <span className="block font-medium text-ink-1">{blankTabLabel(phase)}</span>
            <span className="block text-[11px] text-ink-3">{tr('Ustawienia startowe: footprint 5m z VWAP, profilem i poziomami dnia', 'Start settings: 5m footprint with VWAP, profile and daily levels')}</span>
          </span>
        </button>
        <button type="button" disabled={full} className={item} onClick={() => onNew('copy')}>
          <Copy className="w-4 h-4 mt-px shrink-0 text-ink-3" />
          <span className="min-w-0">
            <span className="block font-medium text-ink-1">{tr(`Kopia karty „${tabName(active)}”`, `Copy of the “${tabName(active)}” tab`)}</span>
            <span className="block text-[11px] text-ink-3">{tr('Te same wykresy, wskaźniki i układ — potem zmienisz interwał', 'The same charts, indicators and layout — then change the timeframe')}</span>
          </span>
        </button>
      </div>
      <div className="flex flex-col">
        <div className="px-2 pb-1 text-[10px] uppercase tracking-[0.08em] text-ink-3 font-medium">{tr('Układy: nowa karta z wzorca', 'Layouts: a new tab from the preset')}</div>
        {layouts.map((s) => (
          <button key={s.id} type="button" disabled={full} title={s.question} className={item} onClick={() => onNew(s.id)}>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="font-medium text-ink-1 truncate">{s.name}</span>
                <span className="font-mono text-[10px] text-ink-3 shrink-0">{presetTf(s.id)}</span>
              </span>
              <span className="text-[11px] text-ink-3 line-clamp-2">{s.question}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

/**
 * Lista „Układ ▾” w pasku wykresu (komputer i tablet) zamiast rzędu kart: karty fazy na ekranie (wybór, Alt+1…9 w
 * podpowiedzi, zamknięcie krzyżykiem, przeciągnięcie zmienia kolejność), czynności aktywnej karty (nazwa, kopia, wzorzec)
 * i nowa karta (pusta, kopia, układ fazy). Pytanie układu jest podpowiedzią przycisku.
 */
export const LayoutMenu: React.FC<{
  st: TabsState;
  tf: (t: ChartTab) => string;
  a: TabActions;
  tabs?: readonly ChartTab[];
  presets?: readonly StationId[];
  phase?: PhaseId;
  question: string;
}> = ({ st, tf, a, tabs = st.tabs, presets, phase, question }) => {
  const [editing, setEditing] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const active = st.tabs.find((t) => t.id === st.active) ?? st.tabs[0];
  const full = tabsFull(st);
  const layouts = presets ? STATIONS.filter((x) => presets.includes(x.id)) : STATIONS;
  const name = tabName(active);
  const key = tabShortcut(st, active.id);
  return (
    <Dropdown
      width="w-80"
      ariaLabel={tr(`Układ: ${name} (${tf(active)}). ${question}`, `Layout: ${name} (${tf(active)}). ${question}`)}
      title={`${question}${key !== null ? ` (Alt+${key})` : ''}`}
      menuLabel={tr('Karty układów', 'Layout tabs')}
      label={
        <span className="flex items-baseline gap-1.5 min-w-0">
          <span className="truncate max-w-[7rem] @min-[1180px]:max-w-[10rem] text-ink-1">{name}</span>
          <span className="font-mono text-[10px] text-accent">{tf(active)}</span>
        </span>
      }
    >
      {(close) => (
        <>
          <MenuSection title={tr('Karty układów', 'Layout tabs')} />
          {tabs.map((t) => {
            const on = t.id === st.active;
            const k = tabShortcut(st, t.id);
            if (editing === t.id)
              return (
                <NameInput
                  key={t.id}
                  value={tabName(t)}
                  className="mx-1 my-1 h-9"
                  onDone={(v) => {
                    setEditing(null);
                    if (v !== null) a.onRename(t.id, v);
                  }}
                />
              );
            return (
              <div
                key={t.id}
                role="none"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', t.id);
                  setDrag(t.id);
                }}
                onDragOver={(e) => drag && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drag && drag !== t.id) a.onMove(drag, st.tabs.findIndex((x) => x.id === t.id));
                  setDrag(null);
                }}
                onDragEnd={() => setDrag(null)}
                className={`flex items-center gap-0.5 ${drag === t.id ? 'opacity-50' : ''}`}
              >
                <MenuItem
                  kind="radio"
                  checked={on}
                  title={presetQuestion(t.preset)}
                  hint={`${tf(t)}${k !== null ? ` · Alt+${k}` : ''}`}
                  onSelect={() => {
                    close();
                    if (!on) a.onSelect(t.id);
                  }}
                >
                  {tabName(t)}
                </MenuItem>
                {canClose(st, t) && (
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    aria-label={tr(`Zamknij kartę ${tabName(t)}`, `Close the ${tabName(t)} tab`)}
                    title={tr('Zamknij kartę', 'Close tab')}
                    onClick={() => a.onClose(t.id)}
                    className="shrink-0 grid place-items-center w-11 h-11 sm:w-8 sm:h-8 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-surface-3 focus:bg-surface-3 focus:outline-none"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
          <MenuSeparator />
          <MenuSection title={tr(`Aktywna karta: ${name}`, `Active tab: ${name}`)} />
          <MenuItem icon={<Pencil className="w-4 h-4" />} onSelect={() => setEditing(active.id)}>
            {tr('Zmień nazwę', 'Rename')}
          </MenuItem>
          <MenuItem
            icon={<Copy className="w-4 h-4" />}
            disabled={full}
            onSelect={() => {
              close();
              a.onCopy(active.id);
            }}
          >
            {tr('Kopia karty', 'Copy tab')}
          </MenuItem>
          {canRestore(active) && (
            <MenuItem
              icon={<RotateCcw className="w-4 h-4" />}
              title={tr(
                `Przywróć wzorzec „${presetName(active.preset)}”: Twoje zmiany w tej karcie (ustawienia wykresów i układ) zostaną zastąpione`,
                `Restore the “${presetName(active.preset)}” preset: your changes in this tab (chart settings and layout) will be replaced`
              )}
              onSelect={() => {
                close();
                a.onRestore(active.id);
              }}
            >
              {tr(`Przywróć wzorzec: ${presetName(active.preset)}`, `Restore preset: ${presetName(active.preset)}`)}
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuSection title={tr('Nowa karta', 'New tab')} />
          {full && <p className="px-2.5 pb-1 text-[11px] leading-snug text-warn">{tr(`Masz już ${MAX_TABS} kart własnych — zamknij jedną, żeby dodać nową.`, `You already have ${MAX_TABS} tabs of your own — close one to add a new one.`)}</p>}
          <MenuItem
            icon={<Plus className="w-4 h-4" />}
            disabled={full}
            title={tr('Ustawienia startowe: footprint 5m z VWAP, profilem i poziomami dnia', 'Start settings: 5m footprint with VWAP, profile and daily levels')}
            onSelect={() => {
              close();
              a.onNew('blank');
            }}
          >
            {blankTabLabel(phase)}
          </MenuItem>
          {layouts.map((x) => (
            <MenuItem
              key={x.id}
              icon={<Plus className="w-4 h-4" />}
              disabled={full}
              title={x.question}
              hint={presetTf(x.id)}
              onSelect={() => {
                close();
                a.onNew(x.id);
              }}
            >
              {tr(`Z wzorca: ${x.name}`, `From preset: ${x.name}`)}
            </MenuItem>
          ))}
        </>
      )}
    </Dropdown>
  );
};

/**
 * Przełącznik zestawu paneli układu (np. Aukcja | Absorpcja w układzie Aukcja i otwarcie): w wierszu paska kart na
 * komputerze, nad wykresem na telefonie (cel dotyku 44 px). Podpisy to nazwy zestawów.
 */
export const PanelSetSwitch: React.FC<{ sets: readonly PanelSet[]; value: string; onChange: (id: string) => void; menu?: boolean }> = ({ sets, value, onChange, menu = false }) =>
  menu ? (
    // W pasku wykresu: lista rozwijana (mniej miejsca niż przełącznik)
    <DropdownSelect<string>
      ariaLabel={tr(`Zestaw paneli pod wykresem: ${sets.find((x) => x.id === value)?.name ?? ''}`, `Panel set below the chart: ${sets.find((x) => x.id === value)?.name ?? ''}`)}
      label={sets.find((x) => x.id === value)?.name ?? ''}
      value={value}
      options={sets.map((x) => ({ value: x.id, label: x.name, title: tr(`Panele pod wykresem: ${x.name}`, `Panels below the chart: ${x.name}`) }))}
      onChange={onChange}
      width="w-44"
    />
  ) : (
    <PanelSetRadio sets={sets} value={value} onChange={onChange} />
  );

const PanelSetRadio: React.FC<{ sets: readonly PanelSet[]; value: string; onChange: (id: string) => void }> = ({ sets, value, onChange }) => {
  // Strzałki jak w natywnej grupie radio: zaznaczenie i fokus od razu, zatwierdzenie (przebudowa wykresów) po przerwie
  // w naciskaniu; kliknięcie zatwierdza od razu (debouncedRadio)
  const [pending, setPending] = useState<string | null>(null);
  const shown = pending ?? value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const btns = useRef(new Map<string, HTMLButtonElement>());
  const [radio] = useState(() =>
    debouncedRadio(PANEL_SET_DELAY_MS, {
      focus: (id) => btns.current.get(id)?.focus(),
      change: (id) => onChangeRef.current(id),
      setPending,
    })
  );
  useEffect(() => radio.cancel, [radio]);
  return (
    <div
      role="radiogroup"
      aria-label={tr('Zestaw paneli pod wykresem', 'Panel set below the chart')}
      onKeyDown={(e) => {
        if (radio.key(e.key, sets.map((s) => s.id), value)) e.preventDefault();
      }}
      className="shrink-0 inline-flex items-center gap-0.5 bg-page border border-line rounded-lg p-0.5"
    >
      {sets.map((s) => {
        const on = s.id === shown;
        return (
          <button
            key={s.id}
            ref={(el) => {
              if (el) btns.current.set(s.id, el);
              else btns.current.delete(s.id);
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            title={tr(`Panele pod wykresem: ${s.name}`, `Panels below the chart: ${s.name}`)}
            onClick={() => radio.click(s.id, value)}
            className={`min-h-11 sm:min-h-0 sm:h-7 px-3 sm:px-2.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors duration-150 ${
              on ? 'bg-surface-3 text-ink-1 shadow-[inset_0_0_0_1px_var(--color-line-strong)]' : 'text-ink-3 hover:text-ink-1'
            }`}
          >
            {s.name}
          </button>
        );
      })}
    </div>
  );
};

/**
 * Karty na telefonie (arkusz na cały ekran): lista kart z przełączeniem, nazwą, kopią i zamknięciem, pod nią nowe karty.
 * Szybkie przełączanie zostaje w liście w pasku wykresu.
 */
/**
 * `activeExtra` — treść pod wierszem aktywnej karty (karta uczciwości szablonu); `tabs` — karty na liście (karty fazy
 * dnia na ekranie), domyślnie wszystkie; `presets` — układy w „Nowa karta”; `phase` — faza na ekranie.
 */
export const TabsSheet: React.FC<{
  st: TabsState;
  tf: (t: ChartTab) => string;
  a: TabActions;
  onClose: () => void;
  activeExtra?: React.ReactNode;
  tabs?: readonly ChartTab[];
  presets?: readonly StationId[];
  phase?: PhaseId;
}> = ({ st, tf, a, onClose, activeExtra, tabs = st.tabs, presets, phase }) => {
  const [editing, setEditing] = useState<string | null>(null);
  const icon = 'grid place-items-center w-9 h-9 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-surface-3 disabled:opacity-30';
  return (
    <div role="dialog" aria-modal="true" aria-label={tr('Karty układów', 'Layout tabs')} className="fixed inset-0 z-50 bg-page/95 backdrop-blur-sm overflow-y-auto">
      <div className="max-w-md mx-auto p-3 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-1">{tr('Karty układów', 'Layout tabs')}</h2>
          <button type="button" aria-label={tr('Zamknij', 'Close')} onClick={onClose} className={icon}>
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-[11px] leading-snug text-ink-3">
          {tr(
            'Każda karta pamięta swoje wykresy: interwał, wskaźniki i warstwy. Przełączasz je listą w pasku wykresu; widok przewinięty w historię otwiera się w nowej karcie w tej samej chwili.',
            'Each tab remembers its charts: timeframe, indicators and layers. Switch them with the list in the chart bar; a view scrolled into history opens in the new tab at the same moment.'
          )}
        </p>
        <ul className="flex flex-col gap-1">
          {tabs.map((t) => {
            const on = t.id === st.active;
            return (
              <React.Fragment key={t.id}>
                <li className={`flex items-center gap-1 rounded-xl border ${on ? 'border-line-strong bg-surface-2' : 'border-line'}`}>
                {editing === t.id ? (
                  <NameInput
                    value={tabName(t)}
                    className="flex-1 m-1.5 h-9 text-sm"
                    onDone={(v) => {
                      setEditing(null);
                      if (v !== null) a.onRename(t.id, v);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    aria-current={on}
                    onClick={() => {
                      if (!on) a.onSelect(t.id);
                      onClose();
                    }}
                    className="flex-1 min-w-0 px-3 py-2 text-left"
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-ink-1 truncate">{tabName(t)}</span>
                      <span className={`font-mono text-[11px] shrink-0 ${on ? 'text-accent' : 'text-ink-3'}`}>{tf(t)}</span>
                    </span>
                    {/* Pytanie karty (wzorca) */}
                    <span className="block text-[11px] leading-snug text-ink-3 line-clamp-2">{presetQuestion(t.preset)}</span>
                  </button>
                )}
                <button type="button" aria-label={tr('Zmień nazwę', 'Rename')} className={icon} onClick={() => setEditing(t.id)}>
                  <Pencil className="w-4 h-4" />
                </button>
                <button type="button" aria-label={tr('Kopia karty', 'Copy tab')} disabled={tabsFull(st)} className={icon} onClick={() => a.onCopy(t.id)}>
                  <Copy className="w-4 h-4" />
                </button>
                <button type="button" aria-label={tr('Zamknij kartę', 'Close tab')} disabled={!canClose(st, t)} className={`${icon} mr-1`} onClick={() => a.onClose(t.id)}>
                  <X className="w-4 h-4" />
                </button>
                </li>
                {on && activeExtra && <li>{activeExtra}</li>}
              </React.Fragment>
            );
          })}
        </ul>
        <div className="rounded-xl border border-line bg-surface-2 p-1.5">
          <div className="px-2 pt-1 pb-2 text-[10px] uppercase tracking-[0.08em] text-ink-3 font-medium">{tr('Nowa karta', 'New tab')}</div>
          <NewTabList
            st={st}
            presets={presets}
            phase={phase}
            onNew={(how) => {
              a.onNew(how);
              onClose();
            }}
          />
        </div>
      </div>
    </div>
  );
};
