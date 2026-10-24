import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { LessonsContent } from '../../lessons/content/types';
import { useDesk } from '../../state/DeskContext';
import { useFolkloreLab } from '../../state/useFolkloreLab';
import { Badge } from '../../ui';
import { LAB_TEXT, type HistVerdict } from '../../utils/folkloreLab';
import { BTN_LINK, fmtPct, fmtPp } from './format';

const VERDICT_TONE: Record<HistVerdict, 'model' | 'warn' | 'neutral'> = { support: 'model', against: 'warn', none: 'neutral', few: 'neutral' };

/** Mity i dane: popularne reguły zestawione z historią BTC (wyniki Laboratorium folkloru desku, odświeżane co godzinę). */
export const Myths: React.FC<{ c: LessonsContent }> = ({ c }) => {
  const { setView } = useDesk();
  const { status, report } = useFolkloreLab();
  const rows = report?.hypotheses.filter((h) => h.family === 'folklore') ?? [];
  const m = c.myths;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-2 max-w-prose leading-relaxed">{m.intro}</p>
      <p className="text-xs text-ink-3 max-w-prose leading-relaxed">{m.how}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-3 p-4 rounded-xl border border-line bg-surface-1" role="status">
          {status === 'loading' ? c.ui.labLoading : c.ui.labUnavailable}
        </p>
      ) : (
        <div className="rounded-xl border border-line bg-surface-1 overflow-hidden">
          <div className="hidden md:grid grid-cols-[minmax(0,1fr)_10rem_6rem_9rem] gap-3 px-4 py-2 border-b border-line text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">
            <span>{m.columns.claim}</span>
            <span className="text-right">{m.columns.result}</span>
            <span className="text-right">{m.columns.n}</span>
            <span>{m.columns.verdict}</span>
          </div>
          <ul>
            {rows.map((h) => {
              const txt = LAB_TEXT[h.id];
              return (
                <li key={h.id} className="grid grid-cols-2 md:grid-cols-[minmax(0,1fr)_10rem_6rem_9rem] gap-x-3 gap-y-1.5 px-4 py-3 border-b border-line last:border-b-0 items-baseline">
                  <span className="col-span-2 md:col-span-1 flex flex-col gap-0.5 min-w-0">
                    <span className="text-sm font-medium text-ink-1">{txt?.name ?? h.id}</span>
                    {txt && <span className="text-xs text-ink-3 leading-relaxed">{txt.claim}</span>}
                  </span>
                  <span className="md:text-right font-mono tabular-nums text-[13px] text-ink-1">
                    {fmtPct(h.hist.rate, c.locale)} <span className="text-ink-3">/ {fmtPct(h.hist.p0, c.locale)}</span>
                    <span className="block text-[11px] text-ink-3">{fmtPp(h.hist.effect, c.locale)}</span>
                  </span>
                  <span className="text-right font-mono tabular-nums text-[13px] text-ink-2">{h.hist.n}</span>
                  <span className="col-span-2 md:col-span-1" title={c.ui.labVerdict[h.hist.verdict]}>
                    <Badge tone={VERDICT_TONE[h.hist.verdict]}>{c.ui.labShort[h.hist.verdict]}</Badge>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <p className="text-xs text-ink-3 max-w-prose leading-relaxed">{m.footer}</p>
      <button
        type="button"
        onClick={() => {
          setView('plan');
          window.scrollTo({ top: 0 });
        }}
        className={`${BTN_LINK} self-start`}
      >
        {c.ui.labOpen}
        <ArrowRight className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
};
