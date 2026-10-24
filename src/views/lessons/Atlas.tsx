import React, { useEffect, useRef } from 'react';
import { ChartCandlestick, ChevronDown } from 'lucide-react';
import { saveStation, stationById } from '../../charts/pro/chart/stations';
import type { AtlasEntry, AtlasGroup, LessonsContent } from '../../lessons/content/types';
import { useDesk } from '../../state/DeskContext';
import { Figure, FigureStatus, useSlice } from './Figure';
import { BTN_SECONDARY } from './format';

const GROUPS: AtlasGroup[] = ['price', 'flow', 'book', 'context'];

/** Atlas wskaźników: hasła pogrupowane według pytania, które pomagają rozstrzygnąć; otwarte hasło ma rycinę z wycinka. */
export const Atlas: React.FC<{ c: LessonsContent; open: string | null; onOpen: (id: string | null) => void }> = ({ c, open, onOpen }) => {
  const opened = useRef<HTMLLIElement>(null);
  // Hasło otwarte z linku (ćwiczenie, adres) przewijamy do widoku
  useEffect(() => {
    if (open) opened.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [open]);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-ink-2 max-w-prose leading-relaxed">{c.atlas.intro}</p>
      {GROUPS.map((g) => (
        <section key={g} className="flex flex-col gap-2.5" aria-labelledby={`atlas-${g}`}>
          <h2 id={`atlas-${g}`} className="font-display text-base font-semibold text-ink-1">
            {c.atlas.groups[g]}
          </h2>
          <ul className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
            {c.atlas.entries
              .filter((e) => e.group === g)
              .map((e) => (
                <li key={e.id} ref={open === e.id ? opened : undefined} className={`scroll-mt-32 ${open === e.id ? 'lg:col-span-2' : ''}`}>
                  <Entry e={e} c={c} open={open === e.id} onToggle={() => onOpen(open === e.id ? null : e.id)} />
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
};

const Entry: React.FC<{ e: AtlasEntry; c: LessonsContent; open: boolean; onToggle: () => void }> = ({ e, c, open, onToggle }) => {
  const { setView } = useDesk();
  const station = stationById(e.station);
  const L = c.atlas.labels;
  return (
    <article className={`rounded-xl border bg-surface-1 ${open ? 'border-line-strong' : 'border-line'}`}>
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`atlas-body-${e.id}`}
          onClick={onToggle}
          className="w-full flex items-start justify-between gap-3 p-4 text-left hover:bg-surface-2/60 rounded-xl"
        >
          <span className="flex flex-col gap-1 min-w-0">
            <span className="text-sm font-semibold text-ink-1">{e.name}</span>
            <span className="text-[13px] text-ink-2 leading-relaxed">{e.what}</span>
          </span>
          <ChevronDown className={`shrink-0 mt-0.5 w-4 h-4 text-ink-3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </h3>
      {open && (
        <div id={`atlas-body-${e.id}`} className="px-4 pb-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="flex flex-col gap-3 min-w-0">
            <Block title={L.how}>
              <p>{e.how}</p>
            </Block>
            <Block title={L.read}>
              <List items={e.read} />
            </Block>
            <Block title={L.traps} tone="warn">
              <List items={e.traps} />
            </Block>
            <Block title={L.combine}>
              <List items={e.combine} />
            </Block>
            <Block title={L.where}>
              <p className="font-mono text-xs text-ink-1">{e.where}</p>
            </Block>
            <button
              type="button"
              className={`${BTN_SECONDARY} self-start`}
              onClick={() => {
                saveStation(station.id);
                setView('charts');
                window.scrollTo({ top: 0 });
              }}
            >
              <ChartCandlestick className="w-4 h-4" aria-hidden="true" />
              {c.ui.openStation(station.id, station.name)}
            </button>
          </div>
          {e.figure && <AtlasFigure f={e.figure} c={c} label={e.name} />}
        </div>
      )}
    </article>
  );
};

const AtlasFigure: React.FC<{ f: NonNullable<AtlasEntry['figure']>; c: LessonsContent; label: string }> = ({ f, c, label }) => {
  const { slice, failed } = useSlice(f.slice);
  return (
    <figure className="flex flex-col gap-2 min-w-0">
      {slice ? (
        <Figure slice={slice} view={f.view ?? 'candles'} layers={f.layers} cursor={f.at ? Date.parse(f.at) : slice.to} c={c} label={label} />
      ) : (
        <FigureStatus failed={failed} c={c} height={340} />
      )}
      <figcaption className="text-xs text-ink-3 leading-relaxed">{f.caption}</figcaption>
    </figure>
  );
};

const Block: React.FC<{ title: string; tone?: 'warn'; children: React.ReactNode }> = ({ title, tone, children }) => (
  <div className="flex flex-col gap-1 text-[13px] text-ink-2 leading-relaxed">
    <div className={`text-[11px] uppercase tracking-[0.08em] font-medium ${tone === 'warn' ? 'text-warn' : 'text-ink-3'}`}>{title}</div>
    {children}
  </div>
);

const List: React.FC<{ items: readonly string[] }> = ({ items }) => (
  <ul className="flex flex-col gap-1">
    {items.map((x) => (
      <li key={x} className="flex gap-2">
        <span className="shrink-0 mt-[8px] w-1 h-1 rounded-full bg-ink-3" aria-hidden="true" />
        <span>{x}</span>
      </li>
    ))}
  </ul>
);
