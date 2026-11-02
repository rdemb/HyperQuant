import React from 'react';
import { tr } from '../../i18n';

/**
 * Pasek „co się dzieje teraz”: po jednym kaflu na panel widoku z jego najważniejszą liczbą. Na komputerze kafel
 * powiększa swój panel (drugie kliknięcie wraca do układu), na telefonie jest zakładką panelu.
 */

export type PanelId = 'dom' | 'tape' | 'who' | 'walls' | 'twap';

export interface PulseTile {
  id: PanelId;
  label: string;
  value: React.ReactNode;
  /** Dopisek pod liczbą (tylko komputer). */
  sub?: React.ReactNode;
  title: string;
}

export const Pulse: React.FC<{ tiles: PulseTile[]; active: PanelId | null; narrow: boolean; onPick: (id: PanelId) => void }> = ({ tiles, active, narrow, onPick }) => (
  <div
    role={narrow ? 'tablist' : 'toolbar'}
    aria-label={narrow ? tr('Panel', 'Panel') : tr('Co się dzieje teraz', 'What is happening now')}
    className={`grid ${narrow ? 'grid-cols-5 gap-1' : 'grid-cols-5 gap-2'} shrink-0`}
  >
    {tiles.map((t) => {
      const on = active === t.id;
      return (
        <button
          key={t.id}
          type="button"
          role={narrow ? 'tab' : undefined}
          aria-selected={narrow ? on : undefined}
          aria-pressed={narrow ? undefined : on}
          title={narrow ? t.title : `${t.title} ${on ? tr('Kliknij, żeby wrócić do układu.', 'Click to go back to the layout.') : tr('Kliknij, żeby powiększyć panel.', 'Click to enlarge the panel.')}`}
          onClick={() => onPick(t.id)}
          className={`min-w-0 text-left rounded-lg border bg-surface-1 transition-colors ${on ? 'border-accent' : 'border-line hover:border-ink-3'} ${narrow ? 'px-1.5 py-1' : 'px-3 py-1.5'}`}
        >
          <span className={`block truncate uppercase tracking-[0.06em] ${on ? 'text-accent' : 'text-ink-3'} ${narrow ? 'text-[9px]' : 'text-[10px]'}`}>{t.label}</span>
          <span className={`block truncate font-mono text-ink-1 ${narrow ? 'text-[11px]' : 'text-[13px] leading-tight'}`}>{t.value}</span>
          {/* Niski ekran (laptop 800 px): bez dopisku, żeby panele miały więcej wysokości */}
          {!narrow && t.sub && <span className="block truncate font-mono text-[10px] text-ink-3 [@media(max-height:860px)]:hidden">{t.sub}</span>}
        </button>
      );
    })}
  </div>
);
