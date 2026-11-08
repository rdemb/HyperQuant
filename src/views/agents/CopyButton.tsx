import React, { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { tr } from '../../i18n';

/**
 * Przycisk drugorzędny zakładki (kopiowanie, linki instalacji): wysokość dotykowa na telefonie, niższy od `sm`.
 * Niedostępny przez `aria-disabled` (zostaje osiągalny klawiaturą): przygaszony, bez podświetlenia.
 */
export const BTN_SECONDARY =
  'inline-flex items-center justify-center gap-1.5 min-h-11 sm:min-h-9 px-3 rounded-lg border border-line-strong bg-surface-2 text-ink-1 text-sm font-medium hover:bg-surface-3 transition-colors duration-150 aria-disabled:cursor-not-allowed aria-disabled:opacity-45 aria-disabled:hover:bg-surface-2';

/** Przycisk główny zakładki (pobranie, kopiowanie wiadomości instalacyjnej): wypełniony kolorem akcentu. */
export const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-1.5 min-h-11 sm:min-h-9 px-4 rounded-lg bg-accent text-page text-sm font-semibold hover:brightness-110 transition-[filter] duration-150';

/**
 * Kopiowanie tekstu do schowka z potwierdzeniem na przycisku (3 s). Region `role="status"` ogłasza wynik: sukces
 * („Skopiowano do schowka”) i porażkę (komunikat `fallback`, jak skopiować ręcznie, w kolorze ostrzeżenia).
 * `primary` daje styl przycisku głównego; `describedBy` to id podpisu, który czytnik ekranu czyta przy przycisku.
 */
export const CopyButton: React.FC<{ text: string; label: string; fallback: string; primary?: boolean; describedBy?: string }> = ({
  text,
  label,
  fallback,
  primary = false,
  describedBy,
}) => {
  const [state, setState] = useState<'idle' | 'done' | 'fail'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const id = window.setTimeout(() => setState('idle'), state === 'done' ? 3000 : 8000);
    return () => window.clearTimeout(id);
  }, [state]);

  const copy = () => {
    if (!navigator.clipboard) return setState('fail');
    navigator.clipboard.writeText(text).then(
      () => setState('done'),
      () => setState('fail')
    );
  };

  return (
    <span className="inline-flex flex-col items-start gap-1 min-w-0">
      <button type="button" onClick={copy} className={primary ? BTN_PRIMARY : BTN_SECONDARY} aria-describedby={describedBy}>
        {/* Na przycisku głównym (tło akcentu) znak w kolorze tekstu przycisku */}
        {state === 'done' ? <Check className={primary ? 'w-4 h-4' : 'w-4 h-4 text-accent'} aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
        {state === 'done' ? tr('Skopiowano', 'Copied') : label}
      </button>
      {/* Sukces widać na przycisku, więc w regionie tylko dla czytnika ekranu; porażka widoczna, w kolorze ostrzeżenia */}
      <span role="status" aria-live="polite" className={`text-xs leading-snug ${state === 'fail' ? 'text-warn' : 'text-ink-3'}`}>
        {state === 'fail' ? fallback : state === 'done' ? <span className="sr-only">{tr('Skopiowano do schowka', 'Copied to clipboard')}</span> : ''}
      </span>
    </span>
  );
};
