import React, { useEffect, useRef, useState } from 'react';
import { Copy, Layers3, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import { STATIONS, stationPanel } from './stations';
import { BUILT_IN_TEMPLATES, MTF_SETS } from './templates';
import { ChartTab, MAX_TABS, TabPreset, TabsState, presetName, presetQuestion, presetStation, setNewCount, tabName } from './tabs';
import { intervalById } from '../core/time';
import { tr } from '../../../i18n';

/** Sposób utworzenia nowej karty: pusta (ustawienia startowe), kopia aktywnej, z wzorca albo zestaw kart MTF. */
export type NewTab = 'blank' | 'copy' | TabPreset | `set:${string}`;

export interface TabActions {
  onSelect: (id: string) => void;
  onNew: (how: NewTab) => void;
  onRename: (id: string, name: string) => void;
  onCopy: (id: string) => void;
  onClose: (id: string) => void;
  onRestore: (id: string) => void;
  onMove: (id: string, to: number) => void;
}

/** Interwały paneli jako podpis: „30m · 4h”. */
export const tfLabel = (intervals: readonly string[]): string => intervals.map((i) => intervalById(i).label).join(' · ');

const presetTf = (p: TabPreset, tf?: string): string => {
  const st = presetStation(p, tf);
  return tfLabel(st.panels.map((_, i) => stationPanel(st, i, false).interval));
};

/** Interwały kart zestawu od góry: „1D → 4h → 1h → 30m → 5m → 1m”. */
const setTf = (set: (typeof MTF_SETS)[number]): string => set.tabs.map((e) => presetTf(e.preset as TabPreset, e.tf)).join(' → ');

const PRESETS: { title: string; items: { preset: TabPreset; hint: string }[] }[] = [
  {
    title: tr('Stacje robocze', 'Workstations'),
    items: STATIONS.filter((s) => s.id !== 'start').map((s) => ({ preset: s.id, hint: s.question })),
  },
  {
    title: tr('Szablony: jeden wykres', 'Templates: one chart'),
    items: BUILT_IN_TEMPLATES.map((t) => ({ preset: `tpl:${t.id}` as TabPreset, hint: presetQuestion(`tpl:${t.id}`) })),
  },
];

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

/** Lista „Nowa karta”: pusta, kopia aktywnej, stacje robocze i szablony (na komputerze w menu przycisku +, na telefonie w arkuszu). */
export const NewTabList: React.FC<{ st: TabsState; onNew: (how: NewTab) => void }> = ({ st, onNew }) => {
  const active = st.tabs.find((t) => t.id === st.active) ?? st.tabs[0];
  const full = st.tabs.length >= MAX_TABS;
  const item = 'w-full flex items-start gap-2 text-left px-2 py-1.5 rounded-lg hover:bg-surface-3 disabled:opacity-40 disabled:hover:bg-transparent';
  return (
    <div className="flex flex-col gap-2 text-xs">
      {full && <p className="px-2 text-[11px] leading-snug text-warn">{tr(`Masz już ${MAX_TABS} kart — zamknij jedną, żeby dodać nową.`, `You already have ${MAX_TABS} tabs — close one to add a new one.`)}</p>}
      <div className="flex flex-col">
        <button type="button" disabled={full} className={item} onClick={() => onNew('blank')}>
          <Plus className="w-4 h-4 mt-px shrink-0 text-ink-3" />
          <span className="min-w-0">
            <span className="block font-medium text-ink-1">{tr('Pusta karta', 'Blank tab')}</span>
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
        <div className="px-2 pb-1 text-[10px] uppercase tracking-[0.08em] text-ink-3 font-medium">{tr('Zestawy kart MTF: od wyższego interwału', 'MTF tab sets: from the higher timeframe')}</div>
        {MTF_SETS.map((set) => {
          const add = setNewCount(st, set.id);
          const fits = st.tabs.length + add <= MAX_TABS;
          return (
            <button
              key={set.id}
              type="button"
              disabled={!fits}
              title={fits ? set.tabs.map((e) => presetName(e.preset as TabPreset)).join(' → ') : tr(`Zestaw doda ${add} kart — zamknij część, żeby się zmieścił`, `The set adds ${add} tabs — close some to make room`)}
              className={item}
              onClick={() => onNew(`set:${set.id}`)}
            >
              <Layers3 className="w-4 h-4 mt-px shrink-0 text-accent" />
              <span className="min-w-0">
                <span className="block font-medium text-ink-1">{set.name}</span>
                <span className="block font-mono text-[10px] text-ink-3">{setTf(set)}</span>
                <span className="block text-[11px] text-ink-3">
                  {add === 0
                    ? tr('Wszystkie karty zestawu są już otwarte — przejdziesz do pierwszej', 'All tabs of the set are already open — you will go to the first one')
                    : tr(`Doda kart: ${add}; karty już otwarte zostają`, `Adds ${add} tabs; tabs already open stay`)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {PRESETS.map((g) => (
        <div key={g.title} className="flex flex-col">
          <div className="px-2 pb-1 text-[10px] uppercase tracking-[0.08em] text-ink-3 font-medium">{g.title}</div>
          {g.items.map(({ preset, hint }) => (
            <button key={preset} type="button" disabled={full} title={hint} className={item} onClick={() => onNew(preset)}>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="font-medium text-ink-1 truncate">{presetName(preset)}</span>
                  <span className="font-mono text-[10px] text-ink-3 shrink-0">{presetTf(preset)}</span>
                </span>
                <span className="text-[11px] text-ink-3 line-clamp-2">{hint}</span>
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
};

/**
 * Pasek kart układów nad wykresami (komputer i tablet): kliknięcie przełącza, dwuklik zmienia nazwę, prawy przycisk
 * otwiera menu karty, środkowy zamyka, przeciągnięcie zmienia kolejność. Podpis karty to interwały jej wykresów.
 */
export const TabsBar: React.FC<{ st: TabsState; tf: (t: ChartTab) => string; a: TabActions }> = ({ st, tf, a }) => {
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  useDismiss(menuRef, menu !== null, () => setMenu(null));
  useDismiss(addRef, adding, () => setAdding(false));
  const full = st.tabs.length >= MAX_TABS;
  // Aktywna karta zawsze widoczna na przewijanym pasku (np. po Alt+9)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [st.active]);
  const menuTab = menu ? st.tabs.find((t) => t.id === menu.id) : undefined;

  return (
    <div className="flex items-center gap-1 min-w-0">
      <div
        role="tablist"
        aria-label={tr('Karty układów', 'Layout tabs')}
        // Kółko myszy przewija pasek kart w poziomie (pasek bez widocznego suwaka)
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
        }}
        className="flex items-center gap-1 min-w-0 overflow-x-auto [scrollbar-width:none]"
      >
        {st.tabs.map((t, i) => {
          const on = t.id === st.active;
          const name = tabName(t);
          return (
            <div
              key={t.id}
              ref={on ? activeRef : undefined}
              draggable={editing !== t.id}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', t.id);
                setDrag({ id: t.id, over: i });
              }}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                if (drag.over !== i) setDrag({ ...drag, over: i });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag && drag.id !== t.id) a.onMove(drag.id, i);
                setDrag(null);
              }}
              onDragEnd={() => setDrag(null)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ id: t.id, x: e.clientX, y: e.clientY });
              }}
              onAuxClick={(e) => e.button === 1 && st.tabs.length > 1 && a.onClose(t.id)}
              className={`group shrink-0 flex items-center h-8 rounded-lg border transition-colors duration-150 ${
                on ? 'bg-surface-3 border-line-strong text-ink-1' : 'border-line text-ink-3 hover:text-ink-1 hover:bg-surface-2'
              } ${drag && drag.over === i && drag.id !== t.id ? 'ring-1 ring-accent' : ''} ${drag?.id === t.id ? 'opacity-50' : ''}`}
            >
              {editing === t.id ? (
                <NameInput
                  value={name}
                  className="w-36 ml-1"
                  onDone={(v) => {
                    setEditing(null);
                    if (v !== null) a.onRename(t.id, v);
                  }}
                />
              ) : (
                <button
                  type="button"
                  role="tab"
                  aria-selected={on}
                  title={`${name} · ${tf(t)}${i < 9 ? ` (Alt+${i + 1})` : ''} — ${tr('dwuklik: nazwa, prawy przycisk: menu', 'double-click: rename, right-click: menu')}`}
                  onClick={() => !on && a.onSelect(t.id)}
                  onDoubleClick={() => setEditing(t.id)}
                  className="flex items-baseline gap-1.5 h-full pl-2.5 pr-1 min-w-0"
                >
                  <span className="text-xs font-medium truncate max-w-[10rem]">{name}</span>
                  <span className={`font-mono text-[10px] whitespace-nowrap ${on ? 'text-accent' : 'text-ink-3'}`}>{tf(t)}</span>
                </button>
              )}
              {st.tabs.length > 1 && editing !== t.id && (
                <button
                  type="button"
                  aria-label={tr(`Zamknij kartę ${name}`, `Close the ${name} tab`)}
                  title={tr('Zamknij kartę', 'Close tab')}
                  onClick={() => a.onClose(t.id)}
                  className={`mr-1 grid place-items-center w-5 h-5 rounded text-ink-3 hover:text-ink-1 hover:bg-surface-1 ${on ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div ref={addRef} className="relative shrink-0">
        <button
          type="button"
          aria-label={tr('Nowa karta', 'New tab')}
          title={tr('Nowa karta: pusta, kopia albo z wzorca', 'New tab: blank, copy or from a preset')}
          aria-expanded={adding}
          onClick={() => setAdding((o) => !o)}
          className={`grid place-items-center w-8 h-8 rounded-lg border transition-colors duration-150 ${adding ? 'bg-surface-3 border-line-strong text-ink-1' : 'border-line text-ink-2 hover:text-ink-1 hover:bg-surface-2'}`}
        >
          <Plus className="w-4 h-4" />
        </button>
        {adding && (
          <div className="absolute left-0 top-9 z-40 w-[min(360px,calc(100vw-32px))] max-h-[min(560px,calc(100dvh-160px))] overflow-y-auto bg-surface-2 border border-line-strong rounded-xl p-1.5 shadow-2xl">
            <NewTabList
              st={st}
              onNew={(how) => {
                setAdding(false);
                a.onNew(how);
              }}
            />
          </div>
        )}
      </div>
      {menu && menuTab && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={tr('Menu karty', 'Tab menu')}
          style={{ left: Math.min(menu.x, window.innerWidth - 240), top: menu.y + 4 }}
          className="fixed z-50 w-56 bg-surface-2 border border-line-strong rounded-xl p-1.5 shadow-2xl flex flex-col text-xs"
        >
          {(
            [
              [Pencil, tr('Zmień nazwę', 'Rename'), () => setEditing(menuTab.id), false],
              [Copy, tr('Kopia karty', 'Copy tab'), () => a.onCopy(menuTab.id), full],
              [RotateCcw, tr(`Przywróć wzorzec: ${presetName(menuTab.preset)}`, `Restore preset: ${presetName(menuTab.preset)}`), () => a.onRestore(menuTab.id), false],
              [X, tr('Zamknij kartę', 'Close tab'), () => a.onClose(menuTab.id), st.tabs.length <= 1],
            ] as const
          ).map(([Icon, label, on, off]) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              disabled={off}
              onClick={() => {
                setMenu(null);
                on();
              }}
              className="flex items-center gap-2 min-h-8 px-2 rounded-lg text-left text-ink-2 hover:text-ink-1 hover:bg-surface-3 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Karty na telefonie (arkusz na cały ekran): lista kart z przełączeniem, nazwą, kopią i zamknięciem, pod nią nowe karty.
 * Szybkie przełączanie zostaje w liście w pasku wykresu.
 */
/** `activeExtra` — treść pod wierszem aktywnej karty (karta uczciwości szablonu). */
export const TabsSheet: React.FC<{ st: TabsState; tf: (t: ChartTab) => string; a: TabActions; onClose: () => void; activeExtra?: React.ReactNode }> = ({
  st,
  tf,
  a,
  onClose,
  activeExtra,
}) => {
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
          {st.tabs.map((t) => {
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
                <button type="button" aria-label={tr('Kopia karty', 'Copy tab')} disabled={st.tabs.length >= MAX_TABS} className={icon} onClick={() => a.onCopy(t.id)}>
                  <Copy className="w-4 h-4" />
                </button>
                <button type="button" aria-label={tr('Zamknij kartę', 'Close tab')} disabled={st.tabs.length <= 1} className={`${icon} mr-1`} onClick={() => a.onClose(t.id)}>
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
