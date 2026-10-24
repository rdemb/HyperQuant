import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Copy, Eye, EyeOff, Lock, LockOpen, Magnet, MousePointer2, PencilLine, Redo2, Trash2, Undo2 } from 'lucide-react';
import { DRAW_COLORS, DRAW_WIDTHS, Dash, TOOLS, ToolDef, ToolGroup, ToolKind, toolDef } from './model';
import type { DrawState, DrawingTools } from './tools';
import { tr } from '../../../i18n';

/**
 * Pionowy pasek narzędzi rysowania (grupy z rozwijaną listą jak w TradingView), pływający pasek stylu
 * zaznaczonego rysunku i podpowiedź do stawianego narzędzia.
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

const ToolIcon: React.FC<{ kind: ToolKind }> = ({ kind }) => (
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

const DASH_OPTIONS: { value: Dash; label: string; d: string }[] = [
  { value: 'solid', label: tr('Linia ciągła', 'Solid line'), d: '' },
  { value: 'dashed', label: tr('Linia przerywana', 'Dashed line'), d: '5 3' },
  { value: 'dotted', label: tr('Linia kropkowana', 'Dotted line'), d: '1.5 2.5' },
];

const HAS_TEXT = new Set<ToolKind>(['text', 'note', 'hline', 'hray']);

/** Pasek stylu zaznaczonego rysunku (prawy górny róg panelu, obok osi ceny): kolor, grubość, rodzaj linii, tekst, kopia i usunięcie. */
export const DrawStyleBar: React.FC<{ tools: DrawingTools | null }> = ({ tools }) => {
  const st = useDrawState(tools);
  const d = st.selected;
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (st.editTick > 0) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [st.editTick]);

  if (!d || !tools) return null;
  const s = d.style;
  return (
    <div
      role="toolbar"
      aria-label={tr('Styl rysunku', 'Drawing style')}
      className="absolute top-2 right-[68px] z-30 w-max max-w-[calc(100%-76px)] flex flex-nowrap items-center gap-1 overflow-x-auto [scrollbar-width:none] rounded-lg border border-line-strong bg-surface-2/95 px-1.5 py-1 shadow-2xl"
    >
      <span className="hidden sm:inline px-1.5 text-[11px] text-ink-3 whitespace-nowrap">{toolDef(d.kind).label}</span>
      <div className="flex items-center gap-0.5" role="radiogroup" aria-label={tr('Kolor', 'Colour')}>
        {DRAW_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={s.color === c}
            aria-label={tr(`Kolor ${c}`, `Colour ${c}`)}
            onClick={() => tools.styleSelected({ color: c })}
            className={`w-7 h-7 rounded-md flex items-center justify-center ${s.color === c ? 'bg-surface-3 ring-1 ring-ink-2' : 'hover:bg-surface-3'}`}
          >
            <span className="w-3.5 h-3.5 rounded-full" style={{ background: c }} />
          </button>
        ))}
      </div>
      <Sep />
      <div className="flex items-center gap-0.5" role="radiogroup" aria-label={tr('Grubość', 'Width')}>
        {DRAW_WIDTHS.map((w) => (
          <button
            key={w}
            type="button"
            role="radio"
            aria-checked={s.width === w}
            aria-label={tr(`Grubość ${w} px`, `Width ${w} px`)}
            onClick={() => tools.styleSelected({ width: w })}
            className={`w-7 h-7 rounded-md flex items-center justify-center ${s.width === w ? 'bg-surface-3 text-ink-1' : 'text-ink-2 hover:bg-surface-3'}`}
          >
            <span className="w-4 rounded-full bg-current" style={{ height: w }} />
          </button>
        ))}
      </div>
      <Sep />
      <div className="flex items-center gap-0.5" role="radiogroup" aria-label={tr('Rodzaj linii', 'Line style')}>
        {DASH_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={s.dash === o.value}
            aria-label={o.label}
            title={o.label}
            onClick={() => tools.styleSelected({ dash: o.value })}
            className={`w-7 h-7 rounded-md flex items-center justify-center ${s.dash === o.value ? 'bg-surface-3 text-ink-1' : 'text-ink-2 hover:bg-surface-3'}`}
          >
            <svg viewBox="0 0 18 4" className="w-[18px] h-1" aria-hidden>
              <path d="M1 2h16" stroke="currentColor" strokeWidth="1.6" strokeDasharray={o.d || undefined} strokeLinecap="round" />
            </svg>
          </button>
        ))}
      </div>
      {HAS_TEXT.has(d.kind) && (
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
            className="w-40 h-7 resize-none rounded-md border border-line bg-surface-1 px-2 py-1 text-xs leading-[18px] text-ink-1 outline-none focus:border-accent"
          />
        </>
      )}
      <Sep />
      <button
        type="button"
        title={tr('Kopia rysunku (Ctrl+C, Ctrl+V)', 'Copy drawing (Ctrl+C, Ctrl+V)')}
        aria-label={tr('Kopia rysunku', 'Copy drawing')}
        onClick={() => tools.cloneSelected()}
        className="w-7 h-7 rounded-md flex items-center justify-center text-ink-2 hover:text-ink-1 hover:bg-surface-3"
      >
        <Copy className="w-4 h-4" />
      </button>
      <button
        type="button"
        title={tr('Usuń rysunek (Delete)', 'Delete drawing (Delete)')}
        aria-label={tr('Usuń rysunek', 'Delete drawing')}
        onClick={() => tools.deleteSelected()}
        className="w-7 h-7 rounded-md flex items-center justify-center text-ink-2 hover:text-critical hover:bg-surface-3"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
};

const Sep = () => <span className="w-px h-5 bg-line mx-0.5" aria-hidden />;

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
