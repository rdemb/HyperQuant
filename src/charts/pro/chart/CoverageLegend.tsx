import React, { useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { DAY, fmtSince } from '../core/time';
import type { ProStore } from '../store/proStore';
import { type DataSource, SOURCE_INFO, coverageRows, storeSource } from './coverageStrip';
import { tapeCoveragePct } from './layerSources';
import { tr } from '../../../i18n';

const Dot: React.FC<{ color: string }> = ({ color }) => (
  <span aria-hidden="true" className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
);

/**
 * Legenda paska pokrycia danych w pasku stanu: jedna ikona z liczbą — pokrycie taśmą ostatniej doby (24 h) — po kliknięciu
 * (dotknięciu) lista potrzebnych źródeł z początkiem danych i liczbą luk. Bez potrzebnych źródeł (same świece) nic nie pokazuje.
 */
export const CoverageLegend: React.FC<{ store: ProStore; needs: readonly DataSource[]; narrow: boolean }> = ({ store, needs, narrow }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (needs.length === 0) return null;
  const now = store.serverNow();
  const rows = open ? coverageRows(storeSource(store), needs, now) : [];
  const pct = tapeCoveragePct(store.coverage, now - DAY, now);
  const tape = Number.isFinite(pct) ? `${Math.round(pct * 100)}%` : '—';
  return (
    // Okienko liczy położenie od paska stanu (`relative` u rodzica), żeby na telefonie mieściło się w szerokości wykresu
    <div ref={ref} className="shrink-0 h-full flex items-center pl-2 sm:pl-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        aria-label={tr(`Pokrycie danych: taśma ${tape} ostatnich 24 h`, `Data coverage: tape ${tape} of the last 24 h`)}
        title={tr(
          `Pokrycie taśmą ostatnich 24 h: ${tape}. Kliknij: gdzie wykres ma dane potrzebne włączonym warstwom i wskaźnikom`,
          `Tape coverage of the last 24 h: ${tape}. Click: where the chart has the data its enabled layers and indicators need`
        )}
        className={`inline-flex items-center gap-1 h-5 px-1.5 rounded border font-mono tabular-nums text-[10px] transition-colors duration-150 ${open ? 'border-line-strong bg-surface-2 text-ink-1' : 'border-line text-ink-2 hover:text-ink-1'}`}
      >
        <Activity aria-hidden="true" className="w-3 h-3" style={{ color: SOURCE_INFO.tape.color }} />
        <span>{tape}</span>
      </button>
      {open && (
        <div className="absolute z-40 left-2 bottom-full mb-1 w-[22rem] max-w-[calc(100%-16px)] rounded-lg border border-line-strong bg-surface-2 px-2.5 py-2 shadow-2xl text-[11px] leading-snug">
          <div className="flex items-baseline gap-2">
            <span className="uppercase tracking-[0.08em] text-ink-3 font-medium">{tr('Pokrycie danych', 'Data coverage')}</span>
            <span className="ml-auto font-mono tabular-nums text-ink-1">{tr(`taśma ${tape} z 24 h`, `tape ${tape} of 24 h`)}</span>
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {rows.map(({ src, spans }) => {
              if (src === 'all') return null;
              const info = SOURCE_INFO[src];
              const gaps = Math.max(0, spans.length - 1);
              return (
                <li key={src}>
                  <div className="flex items-center gap-1.5">
                    <Dot color={info.color} />
                    <span className="text-ink-1">{info.label}</span>
                    <span className="ml-auto font-mono tabular-nums text-ink-2">
                      {spans.length > 0 ? tr(`od ${fmtSince(spans[0][0], now)}`, `since ${fmtSince(spans[0][0], now)}`) : tr('brak', 'none')}
                      {gaps > 0 && (
                        <span className="text-warn">
                          {' '}
                          · {tr('luki', 'gaps')}: {gaps}
                        </span>
                      )}
                    </span>
                  </div>
                  <p className="pl-3 text-ink-3">{info.hint}</p>
                </li>
              );
            })}
          </ul>
          <p className="mt-1.5 text-ink-3">
            {narrow && needs.length > 1
              ? tr(
                  'Jasna linia na dole osi czasu: czas, w którym są naraz wszystkie te źródła. Ciemne tło to brak danych, a nie wartość zero.',
                  'The light line at the bottom of the time axis: time when all these sources are present at once. Dark background means no data, not a zero value.'
                )
              : tr(
                  'Linie na dole osi czasu w tych kolorach: czas, w którym jest to źródło. Ciemne tło to brak danych, a nie wartość zero.',
                  'Lines at the bottom of the time axis in these colours: time when the source is present. Dark background means no data, not a zero value.'
                )}
          </p>
        </div>
      )}
    </div>
  );
};
