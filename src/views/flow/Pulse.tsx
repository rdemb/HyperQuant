import React from 'react';
import { tr } from '../../i18n';

/**
 * Pasek „co się dzieje teraz”: po jednym kaflu na panel widoku z jego najważniejszą liczbą. Na komputerze kafel
 * powiększa swój panel (drugie kliknięcie wraca do układu), na telefonie jest zakładką panelu. Bez `onPick` kafle
 * tylko pokazują liczby (pasek przypięty nad wykresem na telefonie).
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

export const Pulse: React.FC<{
  tiles: PulseTile[];
  active: PanelId | null;
  narrow: boolean;
  onPick?: (id: PanelId) => void;
  /** Gęste kafle jak na telefonie, bez dopisku (wąska kolumna obok wykresu). */
  dense?: boolean;
}> = ({ tiles, active, narrow, onPick, dense = false }) => {
  const small = narrow || dense;
  const tabs = narrow && onPick !== undefined;
  const box = `min-w-0 text-left rounded-lg border bg-surface-1 transition-colors ${small ? 'px-1.5 py-1' : 'px-3 py-1.5'}`;
  const body = (t: PulseTile, on: boolean) => (
    <>
      <span className={`block truncate uppercase tracking-[0.06em] ${on ? 'text-accent' : 'text-ink-3'} ${small ? 'text-[9px]' : 'text-[10px]'}`}>{t.label}</span>
      <span className={`block truncate font-mono text-ink-1 ${small ? 'text-[11px]' : 'text-[13px] leading-tight'}`}>{t.value}</span>
      {/* Niski ekran (laptop 800 px): bez dopisku, żeby panele miały więcej wysokości */}
      {!small && t.sub && <span className="block truncate font-mono text-[10px] text-ink-3 [@media(max-height:860px)]:hidden">{t.sub}</span>}
    </>
  );
  return (
    <div
      role={tabs ? 'tablist' : onPick ? 'toolbar' : 'group'}
      aria-label={tabs ? tr('Panel', 'Panel') : tr('Co się dzieje teraz', 'What is happening now')}
      className={`grid grid-cols-5 ${small ? 'gap-1' : 'gap-2'} shrink-0`}
    >
      {tiles.map((t) => {
        if (!onPick)
          return (
            <div key={t.id} title={t.title} className={`${box} border-line`}>
              {body(t, false)}
            </div>
          );
        const on = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role={tabs ? 'tab' : undefined}
            aria-selected={tabs ? on : undefined}
            aria-pressed={tabs ? undefined : on}
            title={tabs ? t.title : `${t.title} ${on ? tr('Kliknij, żeby wrócić do układu.', 'Click to go back to the layout.') : tr('Kliknij, żeby powiększyć panel.', 'Click to enlarge the panel.')}`}
            onClick={() => onPick(t.id)}
            className={`${box} ${on ? 'border-accent' : 'border-line hover:border-ink-3'}`}
          >
            {body(t, on)}
          </button>
        );
      })}
    </div>
  );
};
