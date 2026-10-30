import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bell,
  BringToFront,
  ChevronRight,
  Copy,
  CopyPlus,
  Ellipsis,
  Eye,
  EyeOff,
  GripVertical,
  Layers,
  ListTree,
  Lock,
  LockOpen,
  Magnet,
  MousePointer2,
  PaintBucket,
  PenLine,
  PencilLine,
  Plus,
  Redo2,
  SendToBack,
  Settings,
  Trash2,
  Undo2,
} from 'lucide-react';
import { DRAW_WIDTHS, Dash, Drawing, FILL_ALPHA, Order, PALETTE_ROWS, TEXT_SIZES, TOOLS, ToolDef, ToolGroup, ToolKind, styleCaps, textSize, toolDef } from './model';
import type { DrawState, DrawingTools } from './tools';
import { tr } from '../../../i18n';

/**
 * Pionowy pasek narzędzi rysowania (grupy z rozwijaną listą jak w TradingView), pływający pasek i menu
 * zaznaczonego rysunku oraz podpowiedź do stawianego narzędzia.
 */

const EMPTY: DrawState = {
  tool: null,
  selected: null,
  magnet: false,
  hidden: false,
  locked: false,
  keep: false,
  count: 0,
  canUndo: false,
  canRedo: false,
  editTick: 0,
  menu: null,
  settings: null,
  sel: [],
  drawings: [],
  list: false,
};

const noop = () => () => {};
const empty = () => EMPTY;

export function useDrawState(tools: DrawingTools | null): DrawState {
  return useSyncExternalStore(tools ? tools.subscribe : noop, tools ? tools.getState : empty);
}

const GROUPS: { id: ToolGroup; label: string }[] = [
  { id: 'lines', label: tr('Linie', 'Lines') },
  { id: 'fib', label: 'Fibonacci' },
  { id: 'shapes', label: tr('Kształty', 'Shapes') },
  { id: 'measure', label: tr('Pomiar i pozycja', 'Measure and position') },
  { id: 'text', label: tr('Opisy', 'Annotations') },
  { id: 'orderflow', label: 'Orderflow' },
];

/** Ikony narzędzi (24 × 24, kreska w kolorze tekstu). */
const ICON: Record<ToolKind, React.ReactNode> = {
  trend: (
    <>
      <path d="M6 18 18 6" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="6" r="2" />
    </>
  ),
  ray: (
    <>
      <path d="M6 18 21 3" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="13" cy="11" r="2" />
    </>
  ),
  extended: (
    <>
      <path d="M2 22 22 2" />
      <circle cx="9" cy="15" r="2" />
      <circle cx="15" cy="9" r="2" />
    </>
  ),
  hline: (
    <>
      <path d="M2 12h20" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
  hray: (
    <>
      <path d="M8 12h14" />
      <circle cx="6" cy="12" r="2" />
    </>
  ),
  vline: (
    <>
      <path d="M12 2v20" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
  channel: (
    <>
      <path d="M3 14 14 3M10 21 21 10" />
      <path d="M6.5 17.5 17.5 6.5" strokeDasharray="2 2" />
    </>
  ),
  fib: (
    <>
      <path d="M3 4h18M3 9h18M3 14h18M3 20h18" />
      <path d="M5 20 19 4" strokeDasharray="2 2" />
    </>
  ),
  fibext: (
    <>
      <path d="M11 5h10M11 10h10M11 15h10" />
      <path d="M3 20 7 9l3 7" strokeDasharray="2 2" />
    </>
  ),
  rect: <rect x="4" y="6" width="16" height="12" rx="1" />,
  arrow: (
    <>
      <path d="M5 19 18 6" />
      <path d="M10 6h8v8" />
    </>
  ),
  brush: <path d="M3 17c3-1 4-6 7-6s2 5 5 5 4-6 6-8" />,
  measure: (
    <>
      <path d="M12 3v18M3 12h18" />
      <path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
    </>
  ),
  long: (
    <>
      <rect x="4" y="4" width="16" height="8" fill="currentColor" fillOpacity="0.25" />
      <rect x="4" y="12" width="16" height="6" />
      <path d="M8 8h8" />
    </>
  ),
  short: (
    <>
      <rect x="4" y="6" width="16" height="6" />
      <rect x="4" y="12" width="16" height="8" fill="currentColor" fillOpacity="0.25" />
      <path d="M8 16h8" />
    </>
  ),
  text: <path d="M5 6V4h14v2M12 4v16M9 20h6" />,
  note: (
    <>
      <path d="M5 4h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 4v-4H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
      <path d="M8 8h8M8 11h5" />
    </>
  ),
  profile: (
    <>
      <path d="M4 3v18" />
      <path d="M4 5h6M4 8h10M4 11h16M4 14h12M4 17h7M4 20h4" />
    </>
  ),
  avwap: (
    <>
      <path d="M3 18c4 0 5-9 9-9s5 4 9 2" />
      <path d="m3 21 2-3 2 3Z" fill="currentColor" />
    </>
  ),
};

export const ToolIcon: React.FC<{ kind: ToolKind }> = ({ kind }) => (
  <svg
    viewBox="0 0 24 24"
    className="w-[18px] h-[18px]"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {ICON[kind]}
  </svg>
);

const hotkeyLabel = (t: ToolDef) => (t.hotkey ? `Alt+${t.hotkey}` : '');

const BTN =
  'inline-flex items-center justify-center w-9 h-9 rounded-md transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent outline-none';
const btnTone = (on: boolean) => (on ? 'bg-accent/15 text-accent' : 'text-ink-2 hover:text-ink-1 hover:bg-surface-3');

export const DrawToolbar: React.FC<{
  tools: DrawingTools | null;
  className?: string;
}> = ({ tools, className = '' }) => {
  const st = useDrawState(tools);
  const [open, setOpen] = useState<{
    group: ToolGroup;
    left: number;
    top: number;
  } | null>(null);
  const [current, setCurrent] = useState<Record<ToolGroup, ToolKind>>({
    lines: 'trend',
    fib: 'fib',
    shapes: 'rect',
    measure: 'measure',
    text: 'text',
    orderflow: 'profile',
  });
  const barRef = useRef<HTMLDivElement>(null);

  // Wybrane skrótem narzędzie staje się narzędziem swojej grupy
  useEffect(() => {
    if (st.tool) setCurrent((c) => ({ ...c, [toolDef(st.tool!).group]: st.tool! }));
  }, [st.tool]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (kind: ToolKind) => {
    setOpen(null);
    if (st.tool !== kind) tools?.setTool(kind);
  };

  return (
    <div
      ref={barRef}
      role="toolbar"
      aria-orientation="vertical"
      aria-label={tr('Narzędzia rysowania', 'Drawing tools')}
      className={`relative z-30 flex-col items-center gap-0.5 w-11 shrink-0 py-1.5 border-r border-line bg-surface-1 overflow-y-auto overflow-x-visible [scrollbar-width:none] ${className}`}
    >
      <button
        type="button"
        title={tr('Kursor (Esc)', 'Cursor (Esc)')}
        aria-label={tr('Kursor', 'Cursor')}
        aria-pressed={!st.tool}
        onClick={() => tools?.setTool(null)}
        className={`${BTN} ${btnTone(!st.tool)}`}
      >
        <MousePointer2 className="w-[18px] h-[18px]" />
      </button>
      {GROUPS.map((g) => {
        const kind = current[g.id];
        const def = toolDef(kind);
        const items = TOOLS.filter((t) => t.group === g.id);
        const active = st.tool !== null && toolDef(st.tool).group === g.id;
        return (
          <div key={g.id} className="relative flex items-center">
            <button
              type="button"
              title={`${def.label}${def.hotkey ? ` (${hotkeyLabel(def)})` : ''}`}
              aria-label={def.label}
              aria-pressed={st.tool === kind}
              onClick={() => tools?.setTool(kind)}
              className={`${BTN} ${btnTone(active)}`}
            >
              <ToolIcon kind={kind} />
            </button>
            {items.length > 1 && (
              <button
                type="button"
                aria-label={tr(`${g.label}: więcej narzędzi`, `${g.label}: more tools`)}
                aria-expanded={open?.group === g.id}
                onClick={(e) => {
                  // Lista obok przycisku grupy, poza przewijanym paskiem (nie jest przycinana)
                  const r = (e.currentTarget.parentElement ?? e.currentTarget).getBoundingClientRect();
                  setOpen((o) =>
                    o?.group === g.id
                      ? null
                      : {
                          group: g.id,
                          left: r.right + 6,
                          top: Math.max(8, Math.min(r.top, window.innerHeight - 320)),
                        }
                  );
                }}
                className="absolute -right-0.5 bottom-0.5 w-2.5 h-3.5 flex items-end justify-center text-ink-3 hover:text-ink-1"
              >
                <svg viewBox="0 0 6 6" className="w-1.5 h-1.5" aria-hidden>
                  <path d="M6 0v6H0Z" fill="currentColor" />
                </svg>
              </button>
            )}
            {open?.group === g.id && (
              <div
                role="menu"
                aria-label={g.label}
                className="fixed z-40 min-w-56 rounded-lg border border-line-strong bg-surface-2 p-1 shadow-2xl"
                style={{ left: open.left, top: open.top }}
              >
                <div className="px-2 pt-1 pb-1.5 text-[11px] uppercase tracking-[0.08em] text-ink-3">{g.label}</div>
                {items.map((t) => (
                  <button
                    key={t.kind}
                    type="button"
                    role="menuitem"
                    aria-label={t.label}
                    aria-keyshortcuts={t.hotkey ? `Alt+${t.hotkey}` : undefined}
                    onClick={() => pick(t.kind)}
                    className={`w-full flex items-center gap-2.5 min-h-9 px-2 rounded-md text-left text-xs ${st.tool === t.kind ? 'bg-accent/15 text-accent' : 'text-ink-1 hover:bg-surface-3'}`}
                  >
                    <ToolIcon kind={t.kind} />
                    <span className="flex-1">{t.label}</span>
                    <span className="font-mono text-[11px] text-ink-3">{hotkeyLabel(t)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="w-6 my-1 border-t border-line" />
      <Toggle on={st.magnet} label={tr('Magnes do OHLC świecy (Ctrl przy rysowaniu odwraca)', 'Magnet to candle OHLC (Ctrl while drawing inverts it)')} onClick={() => tools?.toggleMagnet()}>
        <Magnet className="w-[18px] h-[18px]" />
      </Toggle>
      <Toggle on={st.keep} label={tr('Rysuj dalej tym samym narzędziem', 'Keep drawing with the same tool')} onClick={() => tools?.toggleKeep()}>
        <PencilLine className="w-[18px] h-[18px]" />
      </Toggle>
      <Toggle on={st.locked} label={st.locked ? tr('Odblokuj rysunki', 'Unlock drawings') : tr('Zablokuj rysunki', 'Lock drawings')} onClick={() => tools?.toggleLocked()}>
        {st.locked ? <Lock className="w-[18px] h-[18px]" /> : <LockOpen className="w-[18px] h-[18px]" />}
      </Toggle>
      <Toggle on={st.hidden} label={st.hidden ? tr('Pokaż rysunki', 'Show drawings') : tr('Ukryj rysunki', 'Hide drawings')} onClick={() => tools?.toggleHidden()}>
        {st.hidden ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
      </Toggle>
      <Toggle on={st.list} label={tr(`Lista obiektów (${st.count})`, `Object list (${st.count})`)} onClick={() => tools?.toggleList()}>
        <ListTree className="w-[18px] h-[18px]" />
      </Toggle>
      <div className="w-6 my-1 border-t border-line" />
      <button
        type="button"
        title={tr('Cofnij (Ctrl+Z)', 'Undo (Ctrl+Z)')}
        aria-label={tr('Cofnij', 'Undo')}
        disabled={!st.canUndo}
        onClick={() => tools?.undo()}
        className={`${BTN} ${btnTone(false)} disabled:opacity-35 disabled:pointer-events-none`}
      >
        <Undo2 className="w-[18px] h-[18px]" />
      </button>
      <button
        type="button"
        title={tr('Ponów (Ctrl+Y)', 'Redo (Ctrl+Y)')}
        aria-label={tr('Ponów', 'Redo')}
        disabled={!st.canRedo}
        onClick={() => tools?.redo()}
        className={`${BTN} ${btnTone(false)} disabled:opacity-35 disabled:pointer-events-none`}
      >
        <Redo2 className="w-[18px] h-[18px]" />
      </button>
      <button
        type="button"
        title={tr(`Usuń wszystkie rysunki (${st.count})`, `Delete all drawings (${st.count})`)}
        aria-label={tr('Usuń wszystkie rysunki', 'Delete all drawings')}
        disabled={st.count === 0}
        onClick={() => tools?.clearAll()}
        className={`${BTN} text-ink-2 hover:text-critical hover:bg-surface-3 disabled:opacity-35 disabled:pointer-events-none`}
      >
        <Trash2 className="w-[18px] h-[18px]" />
      </button>
    </div>
  );
};

const Toggle: React.FC<{
  on: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ on, label, onClick, children }) => (
  <button type="button" title={label} aria-label={label} aria-pressed={on} onClick={onClick} className={`${BTN} ${btnTone(on)}`}>
    {children}
  </button>
);

export const DASH_OPTIONS: { value: Dash; label: string; d: string }[] = [
  { value: 'solid', label: tr('Linia ciągła', 'Solid line'), d: '' },
  { value: 'dashed', label: tr('Linia przerywana', 'Dashed line'), d: '5 3' },
  { value: 'dotted', label: tr('Linia kropkowana', 'Dotted line'), d: '1.5 2.5' },
];

export const DashIcon: React.FC<{ d: string }> = ({ d }) => (
  <svg viewBox="0 0 18 4" className="w-[18px] h-1" aria-hidden>
    <path d="M1 2h16" stroke="currentColor" strokeWidth="1.6" strokeDasharray={d || undefined} strokeLinecap="round" />
  </svg>
);

/** Położenie pływającego paska: ułamek wolnego miejsca w poziomie i pionie (0..1, domyślnie prawy górny róg), wspólne dla wszystkich paneli. */
interface BarPos {
  fx: number;
  fy: number;
}

const BAR_KEY = 'hq.charts.draw.bar.v1';
const unit = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : def);

function loadBarPos(): BarPos {
  try {
    const v = JSON.parse(localStorage.getItem(BAR_KEY) ?? 'null') as Partial<BarPos> | null;
    return { fx: unit(v?.fx, 1), fy: unit(v?.fy, 0) };
  } catch {
    return { fx: 1, fy: 0 };
  }
}

type PopId = 'color' | 'fill' | 'size' | 'width' | 'dash' | 'more';

/** Szerokość okienka (px) — do przesunięcia w lewo przy prawej krawędzi ekranu. */
const POP_W: Record<PopId, number> = { color: 272, fill: 272, size: 96, width: 120, dash: 168, more: 248 };

const BAR_BTN = 'h-8 min-w-7 sm:min-w-8 px-1 rounded-md inline-flex items-center justify-center gap-1 text-ink-2 hover:text-ink-1 hover:bg-surface-3 shrink-0';
const OPT = 'w-full flex items-center gap-2.5 min-h-8 px-2 rounded-md text-left text-xs';
const optTone = (on: boolean) => (on ? 'bg-accent/15 text-accent' : 'text-ink-1 hover:bg-surface-3');

/**
 * Pływający pasek zaznaczonego rysunku, jak w TradingView: uchwyt do przesuwania (położenie zapamiętane), kolor z kryciem,
 * tło kształtu, rozmiar tekstu, grubość i rodzaj linii, tekst, alarm, blokada, usunięcie i „więcej” (te same polecenia co menu
 * pod prawym przyciskiem). Pokazuje tylko ustawienia, które dane narzędzie ma.
 * `onAlert` — alarm na poziomie zaznaczonej linii poziomej (bez niego, np. w powtórce, przycisku nie ma).
 */
export const DrawStyleBar: React.FC<{ tools: DrawingTools | null; onAlert?: (price: number) => void }> = ({ tools, onAlert }) => {
  const st = useDrawState(tools);
  const d = st.selected;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(loadBarPos);
  const [pop, setPop] = useState<{ id: PopId; left: number; top: number; up: boolean } | null>(null);
  const grab = useRef<{ dx: number; dy: number } | null>(null);
  const id = d?.id;

  useEffect(() => {
    if (st.editTick > 0) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [st.editTick]);

  // Okienko zamyka zmiana zaznaczenia, kliknięcie poza paskiem i Esc
  useEffect(() => setPop(null), [id]);
  useEffect(() => {
    if (!pop) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !barRef.current?.contains(t)) setPop(null);
    };
    // Esc zamyka tylko okienko (w fazie przechwytywania, zanim obsługa rysunków zdejmie zaznaczenie)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setPop(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [pop]);

  // Okno ustawień zastępuje pasek, dopóki jest otwarte
  if (!d || !tools || st.settings) return null;
  const s = d.style;
  // Kilka zaznaczonych: kolor, linia, blokada i usunięcie dla wszystkich (każdy rysunek bierze to, co ma jego narzędzie)
  const multi = st.sel.length > 1;
  const caps = multi
    ? (() => {
        const all = st.drawings.filter((x) => st.sel.includes(x.id)).map((x) => styleCaps(x.kind));
        return { color: all.some((c) => c.color), stroke: all.some((c) => c.stroke), fill: false, size: false, text: false };
      })()
    : styleCaps(d.kind);
  const level = !multi && onAlert && (d.kind === 'hline' || d.kind === 'hray');

  const toggle = (pid: PopId) => (e: React.MouseEvent<HTMLButtonElement>) => {
    if (pop?.id === pid) return setPop(null);
    const r = e.currentTarget.getBoundingClientRect();
    const up = r.bottom > window.innerHeight * 0.6;
    setPop({ id: pid, left: Math.max(8, Math.min(r.left, window.innerWidth - POP_W[pid] - 8)), top: up ? r.top - 6 : r.bottom + 6, up });
  };

  // Przesuwanie paska za uchwyt: położenie jako ułamek wolnego miejsca, więc pasek nie wyjdzie poza wykres
  const onGripDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const bar = barRef.current;
    if (!bar) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = bar.getBoundingClientRect();
    grab.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    setPop(null);
  };
  const onGripMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const g = grab.current;
    const bar = barRef.current;
    const box = bar?.parentElement?.getBoundingClientRect();
    if (!g || !bar || !box) return;
    const fw = box.width - bar.offsetWidth;
    const fh = box.height - bar.offsetHeight;
    setPos({ fx: fw > 0 ? unit((e.clientX - g.dx - box.left) / fw, 1) : 1, fy: fh > 0 ? unit((e.clientY - g.dy - box.top) / fh, 0) : 0 });
  };
  const onGripUp = () => {
    if (!grab.current) return;
    grab.current = null;
    try {
      localStorage.setItem(BAR_KEY, JSON.stringify(pos));
    } catch {
      // Prywatne okno — położenie zostaje do zamknięcia strony
    }
  };

  const alpha = s.alpha ?? 1;
  const fill = s.fill ?? s.color;
  const fillAlpha = s.fillAlpha ?? FILL_ALPHA[d.kind] ?? 0.1;
  const size = textSize(d);

  return (
    <div className="absolute left-1 right-1 top-2 bottom-10 sm:left-2 sm:right-[68px] z-30 pointer-events-none">
      <div
        ref={barRef}
        role="toolbar"
        aria-label={multi ? tr(`Zaznaczone: ${drawingsLabel(st.sel.length)}`, `Selected: ${drawingsLabel(st.sel.length)}`) : tr(`Rysunek: ${toolDef(d.kind).label}`, `Drawing: ${toolDef(d.kind).label}`)}
        style={{ left: `${pos.fx * 100}%`, top: `${pos.fy * 100}%`, transform: `translate(${-pos.fx * 100}%, ${-pos.fy * 100}%)` }}
        className="absolute pointer-events-auto w-max max-w-full flex flex-nowrap items-center gap-0.5 overflow-x-auto [scrollbar-width:none] rounded-lg border border-line-strong bg-surface-2/95 p-0.5 shadow-2xl"
      >
        <button
          type="button"
          title={tr('Przeciągnij, żeby przesunąć pasek', 'Drag to move the toolbar')}
          aria-label={tr('Przesuń pasek', 'Move toolbar')}
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
          className="h-8 w-5 shrink-0 inline-flex items-center justify-center text-ink-3 hover:text-ink-1 cursor-grab active:cursor-grabbing touch-none"
        >
          <GripVertical className="w-4 h-4" />
        </button>
        {multi && <span className="px-1.5 text-xs text-ink-1 whitespace-nowrap">{drawingsLabel(st.sel.length)}</span>}
        {caps.color && (
          <BarBtn label={tr('Kolor', 'Colour')} open={pop?.id === 'color'} onClick={toggle('color')}>
            <Swatch icon={<PenLine className="w-4 h-4" />} color={s.color} alpha={alpha} />
          </BarBtn>
        )}
        {caps.fill && (
          <BarBtn label={tr('Tło', 'Background')} open={pop?.id === 'fill'} onClick={toggle('fill')}>
            <Swatch icon={<PaintBucket className="w-4 h-4" />} color={fill} alpha={fillAlpha} />
          </BarBtn>
        )}
        {caps.size && (
          <BarBtn label={tr('Rozmiar tekstu', 'Text size')} open={pop?.id === 'size'} onClick={toggle('size')}>
            <span className="px-1 font-mono text-xs text-ink-1 tabular-nums">{size}</span>
          </BarBtn>
        )}
        {caps.stroke && (
          <>
            <BarBtn label={tr('Grubość linii', 'Line width')} open={pop?.id === 'width'} onClick={toggle('width')}>
              <span className="w-3.5 rounded-full bg-current" style={{ height: s.width }} />
              <span className="hidden sm:inline font-mono text-[11px] text-ink-1">{s.width}px</span>
            </BarBtn>
            <BarBtn label={tr('Rodzaj linii', 'Line style')} open={pop?.id === 'dash'} onClick={toggle('dash')}>
              <DashIcon d={DASH_OPTIONS.find((o) => o.value === s.dash)?.d ?? ''} />
            </BarBtn>
          </>
        )}
        {caps.text && (
          <>
            <Sep />
            <textarea
              ref={inputRef}
              aria-label={tr('Tekst rysunku', 'Drawing text')}
              rows={1}
              maxLength={280}
              value={d.text ?? ''}
              placeholder={d.kind === 'hline' || d.kind === 'hray' ? tr('Opis poziomu', 'Level label') : tr('Tekst', 'Text')}
              onChange={(e) => tools.setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              className="w-28 sm:w-36 h-7 shrink-0 resize-none rounded-md border border-line bg-surface-1 px-2 py-1 text-xs leading-[18px] text-ink-1 outline-none focus:border-accent"
            />
          </>
        )}
        <Sep />
        {!multi && (
          <BarBtn label={tr('Ustawienia rysunku', 'Drawing settings')} onClick={() => tools.openSettings()}>
            <Settings className="w-4 h-4" />
          </BarBtn>
        )}
        {level && (
          <BarBtn label={tr('Alarm na tym poziomie', 'Alert at this level')} onClick={() => onAlert(d.pts[0].p)}>
            <Bell className="w-4 h-4 text-warn" />
          </BarBtn>
        )}
        <BarBtn label={d.locked ? tr('Odblokuj rysunek', 'Unlock drawing') : tr('Zablokuj rysunek', 'Lock drawing')} pressed={!!d.locked} onClick={() => tools.toggleLockSelected()}>
          {d.locked ? <Lock className="w-4 h-4" /> : <LockOpen className="w-4 h-4" />}
        </BarBtn>
        <BarBtn label={multi ? tr('Usuń zaznaczone (Delete)', 'Delete selected (Delete)') : tr('Usuń rysunek (Delete)', 'Delete drawing (Delete)')} danger onClick={() => tools.deleteSelected()}>
          <Trash2 className="w-4 h-4" />
        </BarBtn>
        {!multi && (
          <BarBtn label={tr('Więcej', 'More')} open={pop?.id === 'more'} onClick={toggle('more')}>
            <Ellipsis className="w-4 h-4" />
          </BarBtn>
        )}
      </div>
      {pop && (
        <div
          ref={popRef}
          role={pop.id === 'more' ? 'menu' : 'dialog'}
          aria-label={pop.id === 'more' ? tr('Więcej', 'More') : undefined}
          style={{ left: pop.left, top: pop.top, width: POP_W[pop.id], transform: pop.up ? 'translateY(-100%)' : undefined }}
          className="fixed z-50 pointer-events-auto rounded-lg border border-line-strong bg-surface-2 p-1.5 text-xs shadow-2xl"
        >
          {pop.id === 'color' && (
            <ColorPicker color={s.color} alpha={alpha} onColor={(color, merge) => tools.styleSelected({ color }, merge)} onAlpha={(a) => tools.styleSelected({ alpha: a }, true)} />
          )}
          {pop.id === 'fill' && (
            <ColorPicker color={fill} alpha={fillAlpha} onColor={(c, merge) => tools.styleSelected({ fill: c }, merge)} onAlpha={(a) => tools.styleSelected({ fillAlpha: a }, true)} />
          )}
          {pop.id === 'size' &&
            TEXT_SIZES.map((n) => (
              <button key={n} type="button" onClick={() => tools.styleSelected({ size: n })} className={`${OPT} font-mono tabular-nums ${optTone(size === n)}`}>
                {n}
              </button>
            ))}
          {pop.id === 'width' &&
            DRAW_WIDTHS.map((w) => (
              <button key={w} type="button" onClick={() => tools.styleSelected({ width: w })} className={`${OPT} ${optTone(s.width === w)}`}>
                <span className="w-8 rounded-full bg-current" style={{ height: w }} />
                <span className="font-mono">{w}px</span>
              </button>
            ))}
          {pop.id === 'dash' &&
            DASH_OPTIONS.map((o) => (
              <button key={o.value} type="button" onClick={() => tools.styleSelected({ dash: o.value })} className={`${OPT} ${optTone(s.dash === o.value)}`}>
                <DashIcon d={o.d} />
                {o.label}
              </button>
            ))}
          {pop.id === 'more' && <DrawActions tools={tools} d={d} onAlert={level ? onAlert : undefined} onDone={() => setPop(null)} />}
        </div>
      )}
    </div>
  );
};

const BarBtn: React.FC<{ label: string; open?: boolean; pressed?: boolean; danger?: boolean; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: React.ReactNode }> = ({
  label,
  open,
  pressed,
  danger,
  onClick,
  children,
}) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    aria-expanded={open}
    aria-pressed={pressed}
    onClick={onClick}
    className={`${BAR_BTN} ${open || pressed ? 'bg-surface-3 text-ink-1' : ''} ${danger ? 'hover:text-critical' : ''}`}
  >
    {children}
  </button>
);

/** Ikona z paskiem w wybranym kolorze pod spodem (jak przycisk koloru w TradingView). */
const Swatch: React.FC<{ icon: React.ReactNode; color: string; alpha: number }> = ({ icon, color, alpha }) => (
  <span className="flex flex-col items-center gap-0.5 text-ink-1">
    {icon}
    <span className="w-4 h-[3px] rounded-full" style={{ background: color, opacity: Math.max(alpha, 0.15) }} />
  </span>
);

/** Paleta (szarości i barwy w odcieniach), własny kolor i krycie. `merge` — zmiana z suwaka lub próbnika scalana w jeden krok cofania. */
export const ColorPicker: React.FC<{ color: string; alpha: number; onColor: (c: string, merge: boolean) => void; onAlpha: (a: number) => void }> = ({ color, alpha, onColor, onAlpha }) => {
  const pct = Math.round(alpha * 100);
  return (
    <div className="p-0.5">
      <div className="grid grid-cols-10 gap-1" role="radiogroup" aria-label={tr('Kolor', 'Colour')}>
        {PALETTE_ROWS.flat().map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color.toLowerCase() === c}
            aria-label={c}
            title={c}
            onClick={() => onColor(c, false)}
            className={`w-[22px] h-[22px] rounded ${color.toLowerCase() === c ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface-2' : 'hover:scale-110'} transition-transform`}
            style={{ background: c }}
          />
        ))}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <label title={tr('Własny kolor', 'Custom colour')} className="relative w-[22px] h-[22px] shrink-0 rounded border border-line-strong inline-flex items-center justify-center text-ink-2 hover:text-ink-1 cursor-pointer">
          <Plus className="w-3.5 h-3.5" />
          <input type="color" value={color} aria-label={tr('Własny kolor', 'Custom colour')} onChange={(e) => onColor(e.target.value, true)} className="absolute inset-0 opacity-0 cursor-pointer" />
        </label>
        <span className="text-ink-3 shrink-0">{tr('Krycie', 'Opacity')}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={pct}
          aria-label={tr('Krycie', 'Opacity')}
          onChange={(e) => onAlpha(Number(e.target.value) / 100)}
          className="flex-1 min-w-0 accent-accent cursor-pointer"
        />
        <span className="w-9 text-right font-mono tabular-nums text-ink-2">{pct}%</span>
      </div>
    </div>
  );
};

const ORDER: { value: Order; label: string; icon: React.ReactNode }[] = [
  { value: 'front', label: tr('Na wierzch', 'Bring to front'), icon: <BringToFront className="w-4 h-4" /> },
  { value: 'forward', label: tr('Do przodu', 'Bring forward'), icon: <ArrowUp className="w-4 h-4" /> },
  { value: 'backward', label: tr('Do tyłu', 'Send backward'), icon: <ArrowDown className="w-4 h-4" /> },
  { value: 'back', label: tr('Na spód', 'Send to back'), icon: <SendToBack className="w-4 h-4" /> },
];

/** Polecenia rysunku — wspólne dla menu pod prawym przyciskiem i „więcej” na pasku. */
const DrawActions: React.FC<{ tools: DrawingTools; d: Drawing; multi?: boolean; onAlert?: (price: number) => void; onDone: () => void }> = ({ tools, d, multi = false, onAlert, onDone }) => {
  const [order, setOrder] = useState(false);
  const item = (icon: React.ReactNode, label: string, keys: string, run: () => void, danger = false, indent = false) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        run();
        onDone();
      }}
      className={`flex items-center gap-2.5 w-full min-h-9 px-2.5 rounded-md text-left text-ink-1 hover:bg-surface-3 ${danger ? 'hover:text-critical' : ''} ${indent ? 'pl-8' : ''}`}
    >
      <span className="text-ink-3">{icon}</span>
      <span className="flex-1">{label}</span>
      {keys && <span className="hidden sm:inline font-mono text-[10px] text-ink-3 whitespace-nowrap">{keys}</span>}
    </button>
  );
  const lock = item(
    d.locked ? <LockOpen className="w-4 h-4" /> : <Lock className="w-4 h-4" />,
    d.locked ? tr('Odblokuj', 'Unlock') : tr('Zablokuj', 'Lock'),
    '',
    () => tools.toggleLockSelected()
  );
  const remove = item(<Trash2 className="w-4 h-4" />, tr('Usuń', 'Remove'), 'Delete', () => tools.deleteSelected(), true);
  // Kilka zaznaczonych: polecenia dla wszystkich naraz
  if (multi)
    return (
      <>
        {lock}
        <div className="my-1 border-t border-line" />
        {remove}
      </>
    );
  return (
    <>
      {item(<CopyPlus className="w-4 h-4" />, tr('Klonuj', 'Clone'), tr('Ctrl + przeciągnij', 'Ctrl + drag'), () => tools.cloneSelected())}
      {item(<Copy className="w-4 h-4" />, tr('Kopiuj', 'Copy'), 'Ctrl+C', () => tools.copySelected())}
      {lock}
      <button
        type="button"
        role="menuitem"
        aria-expanded={order}
        onClick={() => setOrder((o) => !o)}
        className="flex items-center gap-2.5 w-full min-h-9 px-2.5 rounded-md text-left text-ink-1 hover:bg-surface-3"
      >
        <span className="text-ink-3">
          <Layers className="w-4 h-4" />
        </span>
        <span className="flex-1">{tr('Kolejność', 'Visual order')}</span>
        <ChevronRight className={`w-4 h-4 text-ink-3 transition-transform ${order ? 'rotate-90' : ''}`} />
      </button>
      {order && ORDER.map((o) => <React.Fragment key={o.value}>{item(o.icon, o.label, '', () => tools.reorderSelected(o.value), false, true)}</React.Fragment>)}
      {onAlert && item(<Bell className="w-4 h-4" />, tr('Alarm na tym poziomie', 'Alert at this level'), '', () => onAlert(d.pts[0].p))}
      {item(<Settings className="w-4 h-4" />, tr('Ustawienia…', 'Settings…'), tr('dwuklik', 'double-click'), () => tools.openSettings())}
      <div className="my-1 border-t border-line" />
      {remove}
    </>
  );
};

/** Menu rysunku pod prawym przyciskiem: w prawo i w dół od kursora, przy krawędzi w lewo albo w górę, zawsze w całości w panelu. */
export const DrawMenu: React.FC<{ tools: DrawingTools | null; onAlert?: (price: number) => void }> = ({ tools, onAlert }) => {
  const st = useDrawState(tools);
  const ref = useRef<HTMLDivElement>(null);
  const at = st.menu;
  const d = st.selected;
  const [fit, setFit] = useState<{ left: number; top: number; maxH: number } | null>(null);

  // Miejsce liczone z wymiarów menu i panelu, także po rozwinięciu „Kolejności”
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!at || !el || !box) return setFit(null);
    const place = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const W = box.clientWidth;
      const H = box.clientHeight;
      setFit({
        left: at.x + w <= W - 4 ? at.x : Math.max(4, at.x - w),
        top: at.y + h <= H - 4 ? at.y : Math.max(4, Math.min(at.y - h, H - h - 4)),
        maxH: H - 8,
      });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [at]);

  useEffect(() => {
    if (!at || !tools) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) tools.closeMenu();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [at, tools]);

  if (!at || !d || !tools) return null;
  const multi = st.sel.length > 1;
  const title = multi ? drawingsLabel(st.sel.length) : toolDef(d.kind).label;
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={title}
      style={{ left: fit?.left ?? at.x, top: fit?.top ?? at.y, maxHeight: fit?.maxH, visibility: fit ? 'visible' : 'hidden' }}
      className="absolute z-40 w-60 overflow-y-auto rounded-xl border border-line-strong bg-surface-2 p-1.5 text-xs shadow-2xl"
    >
      <div className="px-2.5 pt-1 pb-1.5 text-[11px] text-ink-3">{title}</div>
      <DrawActions tools={tools} d={d} multi={multi} onAlert={onAlert && (d.kind === 'hline' || d.kind === 'hray') ? onAlert : undefined} onDone={() => tools.closeMenu()} />
    </div>
  );
};

const Sep = () => <span className="w-px h-5 bg-line mx-0.5" aria-hidden />;

/** „3 rysunki”, „5 rysunków”. */
export const drawingsLabel = (n: number): string => {
  const few = n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14);
  return tr(`${n} ${n === 1 ? 'rysunek' : few ? 'rysunki' : 'rysunków'}`, `${n} ${n === 1 ? 'drawing' : 'drawings'}`);
};

const HINTS: Partial<Record<ToolKind, string>> = {
  brush: tr('Przeciągnij, żeby rysować', 'Drag to draw'),
  channel: tr('Kliknij dwa punkty linii, potem trzeci dla szerokości kanału', 'Click two points of the line, then a third for the channel width'),
  fibext: tr('Kliknij początek i koniec ruchu, potem punkt odbicia', 'Click the start and end of the move, then the pullback point'),
  profile: tr('Zaznacz zakres świec: kliknij początek i koniec', 'Select a candle range: click the start and the end'),
  avwap: tr('Kliknij świecę, od której liczyć VWAP', 'Click the candle to anchor VWAP from'),
  measure: tr('Kliknij dwa punkty albo przeciągnij (Shift + przeciągnięcie działa zawsze)', 'Click two points or drag (Shift + drag always works)'),
  long: tr('Kliknij cenę wejścia; cel i stop przeciągniesz uchwytami', 'Click the entry price; drag the handles to set target and stop'),
  short: tr('Kliknij cenę wejścia; cel i stop przeciągniesz uchwytami', 'Click the entry price; drag the handles to set target and stop'),
};

/** Podpowiedź przy aktywnym narzędziu (dół panelu ceny). */
export const DrawHint: React.FC<{ tools: DrawingTools | null }> = ({ tools }) => {
  const st = useDrawState(tools);
  if (!st.tool) return null;
  const def = toolDef(st.tool);
  const hint = HINTS[st.tool] ?? (def.points === 1 ? tr('Kliknij na wykresie', 'Click on the chart') : tr('Kliknij dwa punkty albo przeciągnij', 'Click two points or drag'));
  return (
    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20 pointer-events-none rounded-md border border-line bg-surface-2/90 px-2.5 py-1 text-[11px] text-ink-2 whitespace-nowrap max-w-[calc(100%-16px)] overflow-hidden text-ellipsis">
      <span className="text-ink-1 font-medium">{def.label}</span> · {hint} · {tr('Esc anuluje', 'Esc cancels')}
    </div>
  );
};
