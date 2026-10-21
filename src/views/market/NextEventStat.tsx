import React from 'react';
import { DASH, Stat, fmtCountdown } from '../../ui';
import { KIND_LABEL, fmtEventEt, fmtEventLocal, nextEvent, sourceShort } from '../../data/macroCalendar';
import { useNow } from '../../utils/publicFeeds';

/** Kafel pasa Desk: najbliższa publikacja makro z odliczaniem (odświeżane co 30 s). */
export const NextEventStat: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const now = useNow(30000);
  const e = nextEvent(now);
  const soon = !!e && e.timeUtcMs - now < 24 * 3600000;

  return (
    <div className="bg-surface-1 border border-line rounded-xl p-3.5">
      <Stat
        label="Najbliższe makro"
        source={
          e
            ? { tone: soon ? 'warn' : 'neutral', label: soon ? '< 24 h' : sourceShort(e), title: `${e.name} · ${e.source}` }
            : undefined
        }
        value={
          e ? (
            <span className="text-base">
              {KIND_LABEL[e.kind]} <span className="text-ink-3">·</span> {fmtCountdown(e.timeUtcMs, now)}
            </span>
          ) : (
            DASH
          )
        }
        hint={
          e
            ? compact
              ? undefined
              : `${fmtEventLocal(e.timeUtcMs)} · ${fmtEventEt(e.timeUtcMs)}`
            : 'Tabela dat wymaga aktualizacji'
        }
      />
    </div>
  );
};
