import React from 'react';
import { Eye, EyeOff, Lock, LockOpen, Trash2, X } from 'lucide-react';
import { Drawing, toolDef } from './model';
import type { DrawingTools } from './tools';
import { ToolIcon, drawingsLabel, useDrawState } from './DrawToolbar';
import { fmtPx } from '../chart/layout';
import { fmtSince } from '../core/time';
import { tr } from '../../../i18n';

/**
 * Lista obiektów, jak drzewo obiektów w TradingView: rysunki rynku od najwyższego, zaznaczanie (Ctrl + klik — kilka),
 * ukrycie, blokada i usunięcie pojedynczego rysunku.
 */

/** Opis w wierszu: tekst rysunku, czas (linia pionowa, VWAP, profil) albo ceny pierwszych punktów. */
function detail(d: Drawing): string {
  const text = d.text?.split('\n')[0].trim();
  if (text) return text;
  if (d.kind === 'brush') return '';
  if (d.kind === 'vline' || d.kind === 'avwap' || d.kind === 'profile') return fmtSince(d.pts[0].t, Date.now());
  return d.pts
    .slice(0, d.kind === 'hline' || d.kind === 'hray' || d.kind === 'note' ? 1 : 2)
    .map((q) => fmtPx(q.p))
    .join(' · ');
}

const ROW_BTN = 'w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-md hover:text-ink-1 hover:bg-surface-3';

export const DrawList: React.FC<{ tools: DrawingTools | null }> = ({ tools }) => {
  const st = useDrawState(tools);
  if (!tools || !st.list) return null;
  const rows = [...st.drawings].reverse();
  return (
    <div
      role="dialog"
      aria-label={tr('Lista obiektów', 'Object list')}
      className="absolute left-2 top-2 z-30 w-[min(300px,calc(100%-16px))] max-h-[calc(100%-56px)] flex flex-col rounded-xl border border-line-strong bg-surface-2 text-xs shadow-2xl"
    >
      <div className="flex items-center gap-2 pl-3 pr-1 pt-1">
        <span className="flex-1 text-sm font-medium text-ink-1">{tr('Obiekty', 'Objects')}</span>
        <span className="text-ink-3">{drawingsLabel(rows.length)}</span>
        <button type="button" aria-label={tr('Zamknij', 'Close')} title={tr('Zamknij', 'Close')} onClick={() => tools.toggleList()} className={`${ROW_BTN} w-8 h-8 text-ink-3`}>
          <X className="w-4 h-4" />
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="px-3 pt-1 pb-3 text-ink-3">{tr('Na tym rynku nie ma jeszcze rysunków.', 'There are no drawings on this market yet.')}</p>
      ) : (
        <ul className="flex-1 min-h-0 overflow-y-auto p-1">
          {rows.map((d) => {
            const on = st.sel.includes(d.id);
            const label = toolDef(d.kind).label;
            const info = detail(d);
            return (
              <li
                key={d.id}
                className={`flex items-center gap-1 rounded-md pl-2 ${on ? 'bg-accent/15' : 'hover:bg-surface-3'} ${d.hidden ? 'opacity-50' : ''}`}
              >
                <button
                  type="button"
                  aria-pressed={on}
                  disabled={d.hidden}
                  title={tr('Kliknij, żeby zaznaczyć; Ctrl + klik dodaje do zaznaczenia', 'Click to select; Ctrl + click adds to the selection')}
                  onClick={(e) => tools.pick(d.id, e.ctrlKey || e.metaKey)}
                  className="flex flex-1 min-w-0 items-center gap-2 min-h-9 text-left disabled:cursor-default"
                >
                  <span className="shrink-0" style={{ color: d.style.color }}>
                    <ToolIcon kind={d.kind} />
                  </span>
                  <span className="flex flex-col min-w-0">
                    <span className={`truncate ${on ? 'text-accent' : 'text-ink-1'}`}>{label}</span>
                    {info && <span className="truncate font-mono text-[11px] text-ink-3">{info}</span>}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={d.hidden ? tr(`Pokaż: ${label}`, `Show: ${label}`) : tr(`Ukryj: ${label}`, `Hide: ${label}`)}
                  title={d.hidden ? tr('Pokaż', 'Show') : tr('Ukryj', 'Hide')}
                  aria-pressed={!!d.hidden}
                  onClick={() => tools.toggleDrawing(d.id, 'hidden')}
                  className={`${ROW_BTN} ${d.hidden ? 'text-ink-1' : 'text-ink-3'}`}
                >
                  {d.hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  aria-label={d.locked ? tr(`Odblokuj: ${label}`, `Unlock: ${label}`) : tr(`Zablokuj: ${label}`, `Lock: ${label}`)}
                  title={d.locked ? tr('Odblokuj', 'Unlock') : tr('Zablokuj', 'Lock')}
                  aria-pressed={!!d.locked}
                  onClick={() => tools.toggleDrawing(d.id, 'locked')}
                  className={`${ROW_BTN} ${d.locked ? 'text-ink-1' : 'text-ink-3'}`}
                >
                  {d.locked ? <Lock className="w-4 h-4" /> : <LockOpen className="w-4 h-4" />}
                </button>
                <button type="button" aria-label={tr(`Usuń: ${label}`, `Remove: ${label}`)} title={tr('Usuń', 'Remove')} onClick={() => tools.removeDrawing(d.id)} className={`${ROW_BTN} text-ink-3 hover:text-critical`}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="hidden sm:block px-3 py-2 border-t border-line text-[11px] leading-snug text-ink-3">
        {tr(
          'Ctrl + klik na wykresie albo na liście zaznacza kilka rysunków; przeciągnięcie jednego przesuwa wszystkie.',
          'Ctrl + click on the chart or in the list selects several drawings; dragging one moves them all.'
        )}
      </p>
    </div>
  );
};
