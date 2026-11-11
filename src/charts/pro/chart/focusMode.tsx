import React from 'react';
import { Minimize2 } from 'lucide-react';
import { tr } from '../../../i18n';

/**
 * Tryb skupienia na telefonie (sam wykres i dolne menu) i telefon poziomo (sam wykres): wejście zawsze pokazuje kartę
 * „Wykres” (karty Liczby, DOM i Taśma leżą na polu wykresu, a w skupieniu nie ma paska, którym można je zamknąć), a wyjście
 * jest stałym przyciskiem w rogu i klawiszem Escape — także z klawiatury i dla czytnika ekranu.
 */

export type PhoneTab = 'chart' | 'tape' | 'dom' | 'numbers';

/** Stan po wejściu w skupienie z dowolnej karty. */
export const focusOn = (_tab: PhoneTab): { focus: true; tab: 'chart' } => ({ focus: true, tab: 'chart' });

/** Czy klawisz kończy skupienie. */
export const focusExitKey = (key: string, active: boolean): boolean => active && key === 'Escape';

export const FocusExit: React.FC<{ onExit: () => void }> = ({ onExit }) => (
  <button
    type="button"
    onClick={onExit}
    aria-label={tr('Zamknij tryb skupienia (Esc)', 'Exit focus mode (Esc)')}
    title={tr('Zamknij tryb skupienia (Esc)', 'Exit focus mode (Esc)')}
    className="absolute right-1 top-1 z-30 grid place-items-center w-11 h-11 rounded-lg border border-line-strong bg-surface-2/90 text-ink-1 shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
  >
    <Minimize2 className="w-4 h-4" aria-hidden="true" />
  </button>
);
